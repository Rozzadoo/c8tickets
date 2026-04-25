import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { paymentIntentId, orderId } = req.body;
    if (!paymentIntentId || !orderId) return res.status(400).json({ error: 'Missing fields' });

    const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });

    res.status(200).json({ success: true, refundId: refund.id, status: refund.status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
