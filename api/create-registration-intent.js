import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SALES_TAX_RATE = 0.06;
const PROCESSING_FEE_RATE = 0.035;
const PROCESSING_FEE_FLAT = 0.30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { formId, tenantId, registrantName, registrantEmail } = req.body;

    if (!formId || !UUID_RE.test(formId)) return res.status(400).json({ error: 'Invalid form ID' });

    const headers = {
      apikey: process.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
    };
    const base = process.env.VITE_SUPABASE_URL;

    // Authoritative price lookup — never trust client-provided price
    const formRes = await fetch(
      `${base}/rest/v1/registration_forms?id=eq.${formId}&select=id,title,price_per_entry,capacity,status,tenant_id&limit=1`,
      { headers }
    );
    const forms = await formRes.json();
    const form = forms?.[0];
    if (!form) return res.status(404).json({ error: 'Registration form not found' });
    if (form.status !== 'published') return res.status(400).json({ error: 'This registration is not currently open' });

    const price = parseFloat(form.price_per_entry) || 0;
    if (price <= 0) return res.status(400).json({ error: 'This is a free registration — no payment needed' });

    // Capacity check
    if (form.capacity) {
      const countRes = await fetch(
        `${base}/rest/v1/registrations?form_id=eq.${formId}&status=neq.cancelled&select=id`,
        { headers }
      );
      const rows = await countRes.json();
      if (Array.isArray(rows) && rows.length >= form.capacity) {
        return res.status(400).json({ error: 'This registration is at capacity' });
      }
    }

    const salesTax = Math.round(price * SALES_TAX_RATE * 100) / 100;
    const subtotal = price + salesTax;
    const processingFee = Math.round((subtotal * PROCESSING_FEE_RATE + PROCESSING_FEE_FLAT) * 100) / 100;
    const grandTotal = subtotal + processingFee;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(grandTotal * 100),
      currency: 'usd',
      metadata: {
        type: 'registration',
        form_id: formId,
        tenant_id: tenantId || form.tenant_id || '',
        form_title: form.title || '',
        registrant_name: (registrantName || '').slice(0, 200),
        registrant_email: (registrantEmail || '').slice(0, 200),
      },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      entryPrice: price,
      salesTax,
      processingFee,
      grandTotal,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
