import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function requireAuth(req, res) {
  const token = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  const r = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  return await r.json();
}

async function handleTag(req, res) {
  const { paymentIntentId, orderId, buyerName, eventTitle, ticketSummary } = req.body;
  if (!paymentIntentId || !orderId) return res.status(400).json({ error: 'Missing fields' });
  await stripe.paymentIntents.update(paymentIntentId, {
    description: `C8Tickets — ${eventTitle || 'Event'} — Order ${orderId.slice(0, 8).toUpperCase()}`,
    metadata: { order_id: orderId, buyer: buyerName || '', event: eventTitle || '', tickets: ticketSummary || '' },
  });
  return res.status(200).json({ success: true });
}

async function handleRefund(req, res, adminEmail) {
  const { paymentIntentId, orderId, amount, partialOnly, cancelledBy } = req.body;
  if (!paymentIntentId || !orderId) return res.status(400).json({ error: 'Missing fields' });

  const by = cancelledBy || adminEmail || '';

  if (partialOnly) {
    const amountCents = Math.round(Number(amount) * 100);
    if (!amountCents || amountCents <= 0) return res.status(400).json({ error: 'Invalid partial refund amount' });
    const refund = await stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountCents });
    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: { partial_refund_amount: String(amount), partial_refund_by: by },
    }).catch(() => {});
    return res.status(200).json({ success: true, refundId: refund.id, status: refund.status, partial: true });
  }

  let refundId = null;
  let refundStatus = 'already_refunded';
  try {
    const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });
    refundId = refund.id;
    refundStatus = refund.status;
  } catch (stripeErr) {
    if (stripeErr.code !== 'charge_already_refunded') throw stripeErr;
  }

  await stripe.paymentIntents.update(paymentIntentId, {
    metadata: { cancelled_by: by },
  }).catch(() => {});

  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
    method: 'PATCH',
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'cancelled' }),
  });

  return res.status(200).json({ success: true, refundId, status: refundStatus });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    const { action } = req.body;
    if (action === 'tag') return handleTag(req, res);
    if (action === 'refund') return handleRefund(req, res, user.email);
    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
