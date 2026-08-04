// Atomic cash-sale order creation for door staff.
// Requires an authenticated Supabase session (any staff role); uses service role key
// to insert the order and call fulfill_order (which creates order_items,
// increments quantity_sold, and generates tickets in one transaction).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supaKey) {
    console.error('[api/save-cash-order] SUPABASE_SERVICE_ROLE_KEY missing');
    return res.status(500).json({ error: 'Server misconfigured: service key missing' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const userRes = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authHeader },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });

  const { tenantId, eventId, items, buyerName, buyerEmail, buyerPhone, isPreSale, clientRef } = req.body || {};
  if (!tenantId || !eventId) return res.status(400).json({ error: 'tenantId and eventId required' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });
  for (const it of items) {
    if (!it.ticketTypeId || !Number.isInteger(it.qty) || it.qty < 1 || typeof it.price !== 'number' || it.price < 0) {
      return res.status(400).json({ error: 'Invalid item shape (need ticketTypeId, qty>=1, price>=0)' });
    }
  }

  const ticketTotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  // Cash sales at Crooked 8: face value only — no tax/service/processing collected from buyer
  const ref = clientRef || ('CASH-' + Date.now());
  const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' };

  // Idempotency — if the client retries with the same clientRef, return the existing order
  if (clientRef) {
    const checkRes = await fetch(
      `${supaUrl}/rest/v1/orders?stripe_payment_intent_id=eq.${encodeURIComponent(clientRef)}&select=id`,
      { headers }
    );
    const existing = await checkRes.json();
    if (Array.isArray(existing) && existing.length > 0) {
      return res.status(200).json({ orderId: existing[0].id, replay: true });
    }
  }

  const orderRes = await fetch(`${supaUrl}/rest/v1/orders`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      tenant_id: tenantId,
      event_id: eventId,
      buyer_name: (buyerName || '').trim() || 'Walk-In',
      buyer_email: (buyerEmail || '').trim(),
      buyer_phone: (buyerPhone || '').trim(),
      status: isPreSale ? 'valid' : 'checked_in',
      total_amount: ticketTotal,
      ticket_subtotal: ticketTotal,
      sales_tax: 0,
      service_fees: 0,
      processing_fee: 0,
      stripe_payment_intent_id: ref,
      source: 'door_cash',
    }),
  });

  if (!orderRes.ok) {
    const err = await orderRes.text();
    console.error('[api/save-cash-order] order insert failed', err);
    return res.status(500).json({ error: 'Order insert failed', detail: err });
  }
  const orderData = await orderRes.json();
  const order = Array.isArray(orderData) ? orderData[0] : orderData;
  if (!order?.id) return res.status(500).json({ error: 'Order insert returned no id' });

  // fulfill_order atomically: order_items + increment_sold + generate tickets
  const fulfillItems = items.map(i => ({ qty: i.qty, ticketTypeId: i.ticketTypeId, unit_price: i.price }));
  const fulfillRes = await fetch(`${supaUrl}/rest/v1/rpc/fulfill_order`, {
    method: 'POST', headers,
    body: JSON.stringify({ p_order_id: order.id, p_items: fulfillItems, p_event_id: eventId, p_tenant_id: tenantId }),
  });
  if (!fulfillRes.ok) {
    const err = await fulfillRes.text();
    console.error('[api/save-cash-order] fulfill_order failed', order.id, err);
    return res.status(500).json({ error: 'Fulfillment failed — order created but items/tickets not generated', orderId: order.id, detail: err });
  }

  return res.status(200).json({ orderId: order.id, ref });
}
