import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { paymentIntentId } = req.body || {};
  if (!paymentIntentId || typeof paymentIntentId !== 'string') {
    return res.status(400).json({ error: 'paymentIntentId required' });
  }

  // Verify with Stripe — never trust client-provided state
  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return res.status(400).json({ error: 'Invalid payment intent' });
  }

  if (pi.status !== 'succeeded') {
    return res.status(400).json({ error: 'Payment not completed' });
  }

  const m = pi.metadata || {};
  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' };

  let items = [];
  try { items = JSON.parse(m.items_json || '[]'); } catch {}
  let addonItems = [];
  try { addonItems = JSON.parse(m.addons_json || '[]'); } catch {}
  let tableSeatItems = [];
  try { tableSeatItems = JSON.parse(m.table_seat_items_json || '[]'); } catch {}

  // Idempotency: return existing order if already created (webhook or retry)
  const checkRes = await fetch(
    `${supaUrl}/rest/v1/orders?stripe_payment_intent_id=eq.${encodeURIComponent(pi.id)}&select=id`,
    { headers }
  );
  const existing = await checkRes.json();
  if (Array.isArray(existing) && existing.length > 0) {
    return res.status(200).json({ orderId: existing[0].id });
  }

  // Create the order
  const salesTax = Number(m.sales_tax || 0);
  const serviceFees = Number(m.service_fees || 0);
  const processingFee = Number(m.processing_fee || 0);
  const ticketSubtotal = pi.amount / 100 - salesTax - serviceFees - processingFee;

  const isDoorSale = m.is_door_sale === 'true';
  // Door sales are checked in at time of purchase unless the operator marked it a pre-sale
  const status = isDoorSale
    ? (req.body?.isPreSale ? 'valid' : 'checked_in')
    : 'confirmed';
  // Door sales don't send buyer info to create-payment-intent, so accept overrides in the save request
  const doorBuyerName = isDoorSale ? (req.body?.buyerName || '').trim() : '';
  const doorBuyerEmail = isDoorSale ? (req.body?.buyerEmail || '').trim() : '';
  const doorBuyerPhone = isDoorSale ? (req.body?.buyerPhone || '').trim() : '';

  const orderRes = await fetch(`${supaUrl}/rest/v1/orders`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      tenant_id: m.tenant_id,
      event_id: m.event_id,
      buyer_name: (isDoorSale ? doorBuyerName : m.buyer_name) || (isDoorSale ? 'Walk-In' : ''),
      buyer_email: (isDoorSale ? doorBuyerEmail : m.buyer_email) || '',
      buyer_phone: (isDoorSale ? doorBuyerPhone : m.buyer_phone) || '',
      status,
      total_amount: pi.amount / 100,
      ticket_subtotal: ticketSubtotal,
      sales_tax: salesTax,
      service_fees: serviceFees,
      processing_fee: processingFee,
      stripe_payment_intent_id: pi.id,
      source: isDoorSale ? 'door' : 'online',
      promo_code_id: m.promo_code_id || null,
    }),
  });

  // Handle the race where webhook created the order between our check and insert
  if (orderRes.status === 409) {
    const retryRes = await fetch(
      `${supaUrl}/rest/v1/orders?stripe_payment_intent_id=eq.${encodeURIComponent(pi.id)}&select=id`,
      { headers }
    );
    const retryExisting = await retryRes.json();
    if (Array.isArray(retryExisting) && retryExisting.length > 0) {
      return res.status(200).json({ orderId: retryExisting[0].id });
    }
  }

  const orderData = await orderRes.json();
  const order = Array.isArray(orderData) ? orderData[0] : orderData;

  if (!order?.id) {
    console.error('save-order: order creation failed', JSON.stringify(orderData));
    return res.status(500).json({ error: 'Order creation failed' });
  }

  // Atomically create order_items, increment sold counts, generate tickets
  if (items.length > 0) {
    const fulfillRes = await fetch(`${supaUrl}/rest/v1/rpc/fulfill_order`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_order_id: order.id, p_items: items, p_event_id: m.event_id, p_tenant_id: m.tenant_id }),
    });
    if (!fulfillRes.ok) {
      const err = await fulfillRes.text();
      console.error('save-order: fulfill_order failed', order.id, err);
      return res.status(500).json({ error: 'Order fulfillment failed', orderId: order.id });
    }
  }

  // Insert addon order_items
  if (addonItems.length > 0) {
    await fetch(`${supaUrl}/rest/v1/order_items`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(addonItems.map(ai => ({
        order_id: order.id,
        ticket_type_id: null,
        ticket_type_name: ai.name,
        quantity: ai.qty,
        unit_price: ai.price,
        is_addon: true,
      }))),
    }).catch(e => console.error('save-order addon items error:', e.message));
  }

  // Convert reserved table seats into sold tickets. Each item calls fulfill_table_seat_order,
  // which validates the reservation is still held (matching token + not expired), creates a
  // ticket per seat, links seats to this order, and inserts order_items for the audit trail.
  if (tableSeatItems.length > 0) {
    console.log('[table-seats] save-order fulfilling', tableSeatItems.length, 'section(s) for order', order.id);
    for (const tsi of tableSeatItems) {
      const fulfillRes = await fetch(`${supaUrl}/rest/v1/rpc/fulfill_table_seat_order`, {
        method: 'POST', headers,
        body: JSON.stringify({
          p_order_id: order.id,
          p_event_id: m.event_id,
          p_tenant_id: m.tenant_id,
          p_reservation_token: tsi.token,
          p_table_config_id: tsi.configId,
          p_unit_price: tsi.unitPrice,
          p_table_config_name: tsi.configName || 'Table Seating',
        }),
      });
      if (!fulfillRes.ok) {
        const err = await fulfillRes.text();
        console.error('[table-seats] fulfill_table_seat_order failed', order.id, tsi.configId, err);
        // Order + payment already recorded — surface partial-fulfillment status so the client can offer retry
        return res.status(500).json({ error: 'Table seat fulfillment failed after payment. Retry available.', orderId: order.id, partial: true });
      }
    }
  }

  return res.status(200).json({ orderId: order.id });
}
