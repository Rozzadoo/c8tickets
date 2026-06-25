import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// One-time recovery endpoint — super-admin only
// GET /api/recover-orders?since=2026-06-01&until=2026-06-10&action=preview
// GET /api/recover-orders?since=2026-06-01&until=2026-06-10&action=restore

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;

  const userRes = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authHeader },
  });
  const userData = await userRes.json();
  if (!userRes.ok || userData.email !== superAdminEmail) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { since, until, action = 'preview' } = req.query;
  if (!since || !until) return res.status(400).json({ error: 'since and until required (YYYY-MM-DD)' });

  const sinceTs = Math.floor(new Date(since + 'T00:00:00Z').getTime() / 1000);
  const untilTs = Math.floor(new Date(until + 'T23:59:59Z').getTime() / 1000);

  // Fetch all payment intents from Stripe in the date range
  const pis = [];
  let hasMore = true;
  let startingAfter = undefined;
  while (hasMore) {
    const page = await stripe.paymentIntents.list({
      created: { gte: sinceTs, lte: untilTs },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    pis.push(...page.data.filter(pi => pi.status === 'succeeded'));
    hasMore = page.has_more;
    if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
  }

  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  // Check which PIs already have orders in the DB
  const piIds = pis.map(pi => pi.id);
  const existingRes = await fetch(
    `${supaUrl}/rest/v1/orders?stripe_payment_intent_id=in.(${piIds.map(id => `"${id}"`).join(',')})&select=stripe_payment_intent_id`,
    { headers: h }
  );
  const existing = await existingRes.json();
  const existingPiIds = new Set((Array.isArray(existing) ? existing : []).map(o => o.stripe_payment_intent_id));

  const missing = pis.filter(pi => !existingPiIds.has(pi.id) && pi.metadata?.tenant_id);

  if (action === 'preview') {
    return res.status(200).json({
      total_pis: pis.length,
      already_in_db: existingPiIds.size,
      missing_count: missing.length,
      missing: missing.map(pi => ({
        pi_id: pi.id,
        amount: pi.amount / 100,
        event_title: pi.metadata?.event_title || '?',
        event_id: pi.metadata?.event_id || null,
        buyer_name: pi.metadata?.buyer_name || '?',
        buyer_email: pi.metadata?.buyer_email || '?',
        is_door_sale: pi.metadata?.is_door_sale === 'true',
        created: new Date(pi.created * 1000).toISOString(),
      })),
    });
  }

  if (action !== 'restore') return res.status(400).json({ error: 'action must be preview or restore' });

  const results = [];
  for (const pi of missing) {
    const m = pi.metadata || {};
    let items = [];
    try { items = JSON.parse(m.items_json || '[]'); } catch {}
    let addonItems = [];
    try { addonItems = JSON.parse(m.addons_json || '[]'); } catch {}

    const salesTax = Number(m.sales_tax || 0);
    const serviceFees = Number(m.service_fees || 0);
    const processingFee = Number(m.processing_fee || 0);
    const ticketSubtotal = pi.amount / 100 - salesTax - serviceFees - processingFee;

    const orderRes = await fetch(`${supaUrl}/rest/v1/orders`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: m.tenant_id,
        event_id: m.event_id || null,
        buyer_name: m.buyer_name || 'Unknown',
        buyer_email: m.buyer_email || 'unknown@recovered.c8tickets.com',
        buyer_phone: m.buyer_phone || '',
        status: 'confirmed',
        total_amount: pi.amount / 100,
        ticket_subtotal: ticketSubtotal,
        sales_tax: salesTax,
        service_fees: serviceFees,
        processing_fee: processingFee,
        stripe_payment_intent_id: pi.id,
        source: m.is_door_sale === 'true' ? 'door' : 'online',
      }),
    });
    const orderData = await orderRes.json();
    const order = Array.isArray(orderData) ? orderData[0] : orderData;

    if (!order?.id) {
      results.push({ pi_id: pi.id, status: 'error', detail: JSON.stringify(orderData) });
      continue;
    }

    if (items.length > 0) {
      await fetch(`${supaUrl}/rest/v1/rpc/fulfill_order`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ p_order_id: order.id, p_items: items, p_event_id: m.event_id || null, p_tenant_id: m.tenant_id }),
      });
    }

    if (addonItems.length > 0) {
      await fetch(`${supaUrl}/rest/v1/order_items`, {
        method: 'POST',
        headers: { ...h, Prefer: 'return=minimal' },
        body: JSON.stringify(addonItems.map(ai => ({
          order_id: order.id, ticket_type_id: null,
          ticket_type_name: ai.name, quantity: ai.qty, unit_price: ai.price, is_addon: true,
        }))),
      }).catch(() => {});
    }

    results.push({ pi_id: pi.id, order_id: order.id, status: 'restored', amount: pi.amount / 100, buyer: m.buyer_name });
  }

  return res.status(200).json({ restored: results.filter(r => r.status === 'restored').length, results });
}
