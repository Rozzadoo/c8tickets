import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { paymentIntentId, orderId, buyerName, eventTitle, ticketSummary } = req.body;
    if (!paymentIntentId || !orderId) return res.status(400).json({ error: 'Missing fields' });
    await stripe.paymentIntents.update(paymentIntentId, {
      description: `C8Tickets — ${eventTitle || 'Event'} — Order ${orderId.slice(0, 8).toUpperCase()}`,
      metadata: {
        order_id: orderId,
        buyer: buyerName || '',
        event: eventTitle || '',
        tickets: ticketSummary || '',
      },
    });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
