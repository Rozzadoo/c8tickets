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
    const { items, eventId, tenantId } = req.body;

    const ticketTotal = items.reduce((sum, item) => sum + (item.qty * item.price), 0);
    const totalTickets = items.reduce((sum, item) => sum + item.qty, 0);
    const salesTax = Math.round(ticketTotal * SALES_TAX_RATE * 100) / 100;
    const serviceFees = totalTickets * SERVICE_FEE_PER_TICKET;
    const subtotal = ticketTotal + salesTax + serviceFees;
    const processingFee = Math.round((subtotal * PROCESSING_FEE_RATE + PROCESSING_FEE_FLAT) * 100) / 100;
    const grandTotal = subtotal + processingFee;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(grandTotal * 100),
      currency: 'usd',
      metadata: { eventId, tenantId },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
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