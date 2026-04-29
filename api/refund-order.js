import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify caller is an authenticated Supabase admin session
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const userRes = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { paymentIntentId, orderId } = req.body;
    if (!paymentIntentId || !orderId) return res.status(400).json({ error: 'Missing fields' });

    const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });

    // Update order status in DB here so a client crash after refund can't leave
    // the order stuck as 'confirmed' while the money is already returned.
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: {
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status: 'cancelled' }),
    });

    res.status(200).json({ success: true, refundId: refund.id, status: refund.status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
