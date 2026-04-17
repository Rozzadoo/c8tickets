import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SERVICE_FEE = 2.00;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { items, eventId, tenantId } = req.body;

    // Calculate total: sum of (qty * price) + $2 service fee per ticket
    const ticketTotal = items.reduce((sum, item) => sum + (item.qty * item.price), 0);
    const totalTickets = items.reduce((sum, item) => sum + item.qty, 0);
    const serviceFees = totalTickets * SERVICE_FEE;
    const grandTotal = ticketTotal + serviceFees;

    // Stripe amounts are in cents
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(grandTotal * 100),
      currency: 'usd',
      metadata: {
        eventId,
        tenantId,
      },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      ticketTotal,
      serviceFees,
      grandTotal,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}