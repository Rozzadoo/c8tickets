import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SERVICE_FEE_PER_TICKET = 2.00;
const PROCESSING_FEE_RATE = 0.035;
const PROCESSING_FEE_FLAT = 0.30;
const SALES_TAX_RATE = 0.06; // Idaho state sales tax - confirm with accountant

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { items, eventId, tenantId, isDoorSale, buyer, eventMeta, venueMeta } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid items' });
    }

    // Look up authoritative prices from Supabase — never trust client-provided prices
    const ids = items.map(i => i.ticketTypeId).filter(Boolean);
    if (ids.length !== items.length) {
      return res.status(400).json({ error: 'Missing ticketTypeId' });
    }

    const inClause = ids.map(id => `"${id}"`).join(',');
    const supaUrl = `${process.env.VITE_SUPABASE_URL}/rest/v1/ticket_types?id=in.(${inClause})&select=id,name,price,door_price`;
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
      const unitPrice = isDoorSale && row.door_price != null ? Number(row.door_price) : Number(row.price);
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
        sales_tax: String(salesTax),
        service_fees: String(serviceFees),
        processing_fee: String(processingFee),
        // Items — for order_items creation and email line items
        items_json: JSON.stringify(resolvedItems),
      },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      ticketTotal,
      salesTax,
      serviceFees,
      processingFee,
      grandTotal,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
