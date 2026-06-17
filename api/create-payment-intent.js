import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Fee structure matches src/constants.js — keep in sync
const SALES_TAX_RATE = 0.06;
const SERVICE_FEE_PER_TICKET = 2.00;
const PROCESSING_FEE_RATE = 0.035;
const PROCESSING_FEE_FLAT = 0.30;

const intentLog = new Map();
function isRateLimited(key, maxPerHour) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const recent = (intentLog.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= maxPerHour) return true;
  intentLog.set(key, [...recent, now]);
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { items, eventId, tenantId, isDoorSale, buyer, eventMeta, venueMeta, promoCode, addonItems, utm } = req.body;

    // Rate limit online purchases — door sales are admin-initiated, no limit needed
    if (!isDoorSale) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
      const email = (buyer?.email || '').toLowerCase().trim();
      if (isRateLimited(`ip:${ip}`, 10) || (email && isRateLimited(`email:${email}`, 5))) {
        return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid items' });
    }

    // Look up authoritative prices from Supabase — never trust client-provided prices
    const ids = items.map(i => i.ticketTypeId).filter(Boolean);
    if (ids.length !== items.length) {
      return res.status(400).json({ error: 'Missing ticketTypeId' });
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!ids.every(id => UUID_RE.test(id))) {
      return res.status(400).json({ error: 'Invalid ticketTypeId' });
    }

    // Validate quantities before hitting Supabase
    for (const item of items) {
      if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 20) {
        return res.status(400).json({ error: 'Invalid quantity' });
      }
    }

    const inClause = ids.map(id => `"${id}"`).join(',');
    const supaUrl = `${process.env.VITE_SUPABASE_URL}/rest/v1/ticket_types?id=in.(${inClause})&select=id,name,price,door_price,quantity_total,quantity_sold`;
    const supaRes = await fetch(supaUrl, {
      headers: {
        apikey: process.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
      },
    });
    const rows = await supaRes.json();
    if (!Array.isArray(rows)) {
      return res.status(500).json({ error: 'Price lookup failed' });
    }
    const priceMap = Object.fromEntries(rows.map(r => [r.id, r]));

    let ticketTotal = 0;
    let totalTickets = 0;
    const resolvedItems = [];
    for (const item of items) {
      const row = priceMap[item.ticketTypeId];
      if (!row) return res.status(400).json({ error: 'Unknown ticket type' });
      const available = row.quantity_total - row.quantity_sold;
      if (item.qty > available) {
        return res.status(400).json({ error: `Only ${available} ticket(s) remaining for "${row.name}"` });
      }
      const unitPrice = isDoorSale && row.door_price != null ? Number(row.door_price) : Number(row.price);
      ticketTotal += item.qty * unitPrice;
      totalTickets += item.qty;
      resolvedItems.push({ ticketTypeId: item.ticketTypeId, type: row.name, qty: item.qty, price: unitPrice });
    }

    // Per-email purchase limit: max 3 orders per email per event in a rolling 24h window (online only)
    if (!isDoorSale && buyer?.email && eventId) {
      const email = buyer.email.toLowerCase().trim();
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const chkRes = await fetch(
        `${process.env.VITE_SUPABASE_URL}/rest/v1/orders?buyer_email=eq.${encodeURIComponent(email)}&event_id=eq.${eventId}&status=neq.cancelled&created_at=gte.${encodeURIComponent(since)}&select=id&limit=4`,
        { headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}` } }
      );
      const existing = await chkRes.json();
      if (Array.isArray(existing) && existing.length >= 3) {
        return res.status(400).json({ error: 'Maximum of 3 orders per person per event. Contact the venue if you need more tickets.' });
      }
    }

    // Validate and apply promo code if provided
    let discountAmount = 0;
    let promoId = null;
    if (promoCode && tenantId) {
      const normalized = promoCode.trim().toUpperCase();
      const promoRes = await fetch(
        `${process.env.VITE_SUPABASE_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(normalized)}&tenant_id=eq.${tenantId}&active=eq.true&select=*&limit=1`,
        { headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}` } }
      );
      const promoRows = await promoRes.json();
      const promo = Array.isArray(promoRows) ? promoRows[0] : null;
      if (promo) {
        const notExpired = !promo.expires_at || new Date(promo.expires_at) >= new Date();
        const notMaxed = promo.max_uses === null || promo.uses_count < promo.max_uses;
        const eventOk = !promo.event_id || promo.event_id === eventId;
        if (notExpired && notMaxed && eventOk) {
          if (promo.discount_type === 'percent') {
            discountAmount = Math.round(ticketTotal * Number(promo.discount_value) / 100 * 100) / 100;
          } else {
            discountAmount = Math.min(Number(promo.discount_value), ticketTotal);
            discountAmount = Math.round(discountAmount * 100) / 100;
          }
          promoId = promo.id;
        }
      }
    }

    // Validate and price add-on items
    let addonTotal = 0;
    const resolvedAddonItems = [];
    if (Array.isArray(addonItems) && addonItems.length > 0) {
      if (!eventId || !UUID_RE.test(eventId)) {
        return res.status(400).json({ error: 'Invalid eventId for add-on validation' });
      }
      const evRes = await fetch(
        `${process.env.VITE_SUPABASE_URL}/rest/v1/events?id=eq.${eventId}&select=addons&limit=1`,
        { headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}` } }
      );
      const evRows = await evRes.json();
      const eventAddons = evRows?.[0]?.addons || [];
      for (const ai of addonItems) {
        if (!Number.isInteger(ai.qty) || ai.qty < 1 || ai.qty > 20) {
          return res.status(400).json({ error: 'Invalid add-on quantity' });
        }
        const def = eventAddons.find(a => a.id === ai.addonId && a.active !== false);
        if (!def) return res.status(400).json({ error: 'Add-on not available' });
        if (def.maxPerOrder != null && ai.qty > def.maxPerOrder) {
          return res.status(400).json({ error: `Max ${def.maxPerOrder} of "${def.name}" per order` });
        }
        resolvedAddonItems.push({ addonId: ai.addonId, name: def.name, qty: ai.qty, price: Number(def.price) });
        addonTotal += ai.qty * Number(def.price);
      }
    }

    const discountedTicketTotal = ticketTotal - discountAmount;
    const taxableBase = discountedTicketTotal + addonTotal;
    const salesTax = Math.round(taxableBase * SALES_TAX_RATE * 100) / 100;
    const serviceFees = totalTickets * SERVICE_FEE_PER_TICKET;
    const subtotal = taxableBase + salesTax + serviceFees;
    const processingFee = Math.round((subtotal * PROCESSING_FEE_RATE + PROCESSING_FEE_FLAT) * 100) / 100;
    const grandTotal = subtotal + processingFee;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(grandTotal * 100),
      currency: 'usd',
      metadata: {
        event_id: eventId || '',
        tenant_id: tenantId || '',
        ticket_count: String(totalTickets),
        is_door_sale: isDoorSale ? 'true' : 'false',
        // Buyer info — needed by webhook to create order and send email
        buyer_name: buyer?.name || '',
        buyer_email: buyer?.email || '',
        buyer_phone: buyer?.phone || '',
        // Event info — for confirmation email
        event_title: eventMeta?.title || '',
        event_date: eventMeta?.date || '',
        event_time: eventMeta?.time || '',
        event_doors: eventMeta?.doors || '',
        event_category: eventMeta?.category || '',
        // Venue info — for confirmation email
        venue_name: venueMeta?.name || '',
        venue_address: venueMeta?.address || '',
        // Fee breakdown — for confirmation email
        discount_amount: String(discountAmount),
        promo_code_id: promoId || '',
        sales_tax: String(salesTax),
        service_fees: String(serviceFees),
        processing_fee: String(processingFee),
        // Items — for order_items creation and email line items
        items_json: (() => {
          const s = JSON.stringify(resolvedItems);
          if (s.length > 490) throw new Error('Your cart contains too many ticket types to process online. Please contact the venue or reduce your selection.');
          return s;
        })(),
        addons_json: (() => {
          if (resolvedAddonItems.length === 0) return '[]';
          const s = JSON.stringify(resolvedAddonItems);
          if (s.length > 490) throw new Error('Too many add-ons selected. Please reduce your selection.');
          return s;
        })(),
        ...(utm && typeof utm === 'object' ? {
          utm_source: String(utm.source || '').slice(0, 100),
          utm_medium: String(utm.medium || '').slice(0, 100),
          utm_campaign: String(utm.campaign || '').slice(0, 100),
        } : {}),
      },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      ticketTotal,
      addonTotal,
      discountAmount,
      salesTax,
      serviceFees,
      processingFee,
      grandTotal,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
