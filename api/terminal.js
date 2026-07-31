import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SERVICE_FEE_PER_TICKET = 2.00;
const PROCESSING_FEE_RATE = 0.035;
const PROCESSING_FEE_FLAT = 0.30;
const SALES_TAX_RATE = 0.06;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '') || null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const userRes = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' });

  const action = req.query.action;

  if (action === 'connection-token') {
    try {
      const connectionToken = await stripe.terminal.connectionTokens.create({});
      return res.json({ secret: connectionToken.secret });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === 'payment-intent') {
    try {
      const { items, eventId, tenantId, eventMeta } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Invalid items' });
      }

      const ids = items.map(i => i.ticketTypeId).filter(Boolean);
      if (ids.length !== items.length) return res.status(400).json({ error: 'Missing ticketTypeId' });

      for (const item of items) {
        if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 20) {
          return res.status(400).json({ error: 'Invalid quantity' });
        }
      }

      const inClause = ids.map(id => `"${id}"`).join(',');
      const supaRes = await fetch(
        `${process.env.VITE_SUPABASE_URL}/rest/v1/ticket_types?id=in.(${inClause})&select=id,name,price,door_price,quantity_total,quantity_sold`,
        { headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}` } }
      );
      const rows = await supaRes.json();
      if (!Array.isArray(rows)) return res.status(500).json({ error: 'Price lookup failed' });

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
        const unitPrice = row.door_price != null ? Number(row.door_price) : Number(row.price);
        ticketTotal += item.qty * unitPrice;
        totalTickets += item.qty;
        resolvedItems.push({ ticketTypeId: item.ticketTypeId, type: row.name, qty: item.qty, price: unitPrice });
      }

      const salesTax = Math.round(ticketTotal * SALES_TAX_RATE * 100) / 100;
      const serviceFees = totalTickets * SERVICE_FEE_PER_TICKET;
      const subtotal = ticketTotal + salesTax + serviceFees;
      const processingFee = Math.round((subtotal * PROCESSING_FEE_RATE + PROCESSING_FEE_FLAT) * 100) / 100;
      const grandTotal = subtotal + processingFee;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(grandTotal * 100),
        currency: 'usd',
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        metadata: {
          event_id: eventId || '',
          tenant_id: tenantId || '',
          is_door_sale: 'true',
          event_title: eventMeta?.title || '',
          items_json: JSON.stringify(resolvedItems),
        },
      });

      return res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        ticketTotal,
        salesTax,
        serviceFees,
        processingFee,
        grandTotal,
        resolvedItems,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === 'pos-payment-intent') {
    try {
      const { cartItems, tenantId } = req.body;
      if (!Array.isArray(cartItems) || cartItems.length === 0)
        return res.status(400).json({ error: 'Empty cart' });

      const ids = [...new Set(cartItems.map(i => i.itemId).filter(Boolean))];
      if (ids.length === 0) return res.status(400).json({ error: 'Invalid items' });

      const inClause = ids.map(id => `"${id}"`).join(',');
      const itemRes = await fetch(
        `${process.env.VITE_SUPABASE_URL}/rest/v1/pos_items?id=in.(${inClause})&select=id,name,price,tax_rate,available`,
        { headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}` } }
      );
      const dbItems = await itemRes.json();
      if (!Array.isArray(dbItems)) return res.status(500).json({ error: 'Item lookup failed' });

      const dbMap = Object.fromEntries(dbItems.map(i => [i.id, i]));
      let subtotal = 0, tax = 0;

      for (const ci of cartItems) {
        if (!Number.isInteger(ci.qty) || ci.qty < 1 || ci.qty > 99)
          return res.status(400).json({ error: 'Invalid quantity' });
        const db = dbMap[ci.itemId];
        if (!db) return res.status(400).json({ error: 'Unknown item' });
        if (!db.available) return res.status(400).json({ error: `"${db.name}" is not currently available` });
        const modDelta = Math.max(0, parseFloat(ci.modifierDelta) || 0);
        const unitPrice = parseFloat(db.price) + modDelta;
        const lineTotal = unitPrice * ci.qty;
        subtotal += lineTotal;
        tax += lineTotal * parseFloat(db.tax_rate || 0.06);
      }

      subtotal = Math.round(subtotal * 100) / 100;
      tax = Math.round(tax * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;

      if (total < 0.50) return res.status(400).json({ error: 'Total is below the minimum charge amount ($0.50)' });

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(total * 100),
        currency: 'usd',
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        metadata: {
          type: 'pos',
          tenant_id: tenantId || '',
          item_count: String(cartItems.reduce((s, i) => s + i.qty, 0)),
        },
      });

      return res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        subtotal,
        tax,
        total,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
}
