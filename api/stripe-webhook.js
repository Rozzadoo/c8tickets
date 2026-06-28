import Stripe from 'stripe';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export const config = { api: { bodyParser: false } };

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('Webhook: STRIPE_WEBHOOK_SECRET is not set');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook signature error: ${err.message}` });
    }

    if (event.type !== 'payment_intent.succeeded') {
      return res.status(200).json({ received: true });
    }

    const pi = event.data.object;
    const m = pi.metadata || {};

    // Skip door sales — created by staff on a reliable connection
    if (m.is_door_sale === 'true') return res.status(200).json({ received: true, skipped: 'door_sale' });

    // Skip if no buyer email in metadata — old PI before webhook support
    if (!m.buyer_email) return res.status(200).json({ received: true, skipped: 'no_buyer_info' });

    // Wait 4s so the browser gets first chance to create the order
    await new Promise(r => setTimeout(r, 4000));

    const supaUrl = process.env.VITE_SUPABASE_URL;
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' };

    // Parse items early — needed for both the recovery path and the main path
    let items = [];
    try { items = JSON.parse(m.items_json || '[]'); } catch {}
    let addonItems = [];
    try { addonItems = JSON.parse(m.addons_json || '[]'); } catch {}

    // Idempotency: check if an order already exists for this payment intent
    const checkRes = await fetch(
      `${supaUrl}/rest/v1/orders?stripe_payment_intent_id=eq.${encodeURIComponent(pi.id)}&select=id,order_items(id)`,
      { headers }
    );
    const existing = await checkRes.json();
    if (Array.isArray(existing) && existing.length > 0) {
      const existingOrder = existing[0];
      if (existingOrder.order_items?.length > 0) {
        // Fully fulfilled — nothing to do
        return res.status(200).json({ received: true, skipped: 'order_already_exists' });
      }
      // Order was created but fulfillment failed on a previous attempt — recover
      if (items.length > 0) {
        await fetch(`${supaUrl}/rest/v1/rpc/fulfill_order`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ p_order_id: existingOrder.id, p_items: items, p_event_id: m.event_id, p_tenant_id: m.tenant_id }),
        });
      }
      return res.status(200).json({ received: true, recovered: 'fulfilled_existing_order' });
    }

    // Create the order
    const salesTax = Number(m.sales_tax || 0);
    const serviceFees = Number(m.service_fees || 0);
    const processingFee = Number(m.processing_fee || 0);
    const ticketSubtotal = pi.amount / 100 - salesTax - serviceFees - processingFee;
    const orderRes = await fetch(`${supaUrl}/rest/v1/orders`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: m.tenant_id,
        event_id: m.event_id,
        buyer_name: m.buyer_name || 'Unknown',
        buyer_email: m.buyer_email,
        buyer_phone: m.buyer_phone || '',
        status: 'confirmed',
        total_amount: pi.amount / 100,
        ticket_subtotal: ticketSubtotal,
        sales_tax: salesTax,
        service_fees: serviceFees,
        processing_fee: processingFee,
        stripe_payment_intent_id: pi.id,
        source: 'online',
      }),
    });
    const orderData = await orderRes.json();
    const order = Array.isArray(orderData) ? orderData[0] : orderData;

    if (!order?.id) {
      console.error('Webhook: failed to create order', orderData);
      return res.status(500).json({ error: 'Order creation failed' });
    }

    // Atomically create order_items, increment sold counts, and generate tickets
    if (items.length > 0) {
      const fulfillRes = await fetch(`${supaUrl}/rest/v1/rpc/fulfill_order`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_order_id: order.id, p_items: items, p_event_id: m.event_id, p_tenant_id: m.tenant_id }),
      });
      if (!fulfillRes.ok) {
        const err = await fulfillRes.text();
        console.error('Webhook: fulfill_order failed for order', order.id, err);
        return res.status(500).json({ error: 'Order fulfillment failed' });
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
      }).catch(e => console.error('Webhook addon order_items error:', e.message));
    }

    // Tag the PI with the order ID
    await stripe.paymentIntents.update(pi.id, {
      description: `C8Tickets — ${m.event_title || 'Event'} — Order ${order.id.slice(0, 8).toUpperCase()}`,
      metadata: { ...m, order_id: order.id },
    }).catch(e => console.error('PI tag error:', e.message));

    // Send confirmation email
    const qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(order.id)}&color=1a1007&bgcolor=ffffff&margin=8`;

    const itemsHtml = items.map(i => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">${escHtml(i.qty)}× ${escHtml(i.type)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${(i.qty * i.price).toFixed(2)}</td>
      </tr>`).join('');

    const addonsHtml = addonItems.map(ai => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#c8922a">🎁 ${escHtml(ai.qty)}× ${escHtml(ai.name)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#c8922a;text-align:right">$${(ai.qty * ai.price).toFixed(2)}</td>
      </tr>`).join('');

    await resend.emails.send({
      from: 'C8Tickets <noreply@c8tickets.com>',
      to: m.buyer_email,
      subject: `Your tickets for ${escHtml(m.event_title || 'the event')}`,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:40px 20px">
  <div style="text-align:center;margin-bottom:32px">
    <div style="font-size:28px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:3px">${escHtml(m.venue_name || '')}</div>
    <div style="font-size:12px;color:#7a6c54;text-transform:uppercase;letter-spacing:2px;margin-top:4px">${escHtml(m.venue_address || '')}</div>
  </div>
  <div style="text-align:center;margin-bottom:28px">
    <div style="font-size:36px;margin-bottom:8px">🎉</div>
    <div style="font-size:24px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:2px">You're In!</div>
    <div style="font-size:14px;color:#b5a78a;margin-top:6px">Your tickets have been confirmed</div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px">
    <div style="font-size:11px;color:#c8922a;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">${escHtml(m.event_category || '')}</div>
    <div style="font-size:22px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">${escHtml(m.event_title || '')}</div>
    <div style="font-size:13px;color:#b5a78a;line-height:1.8">
      📅 <strong style="color:#f0e9da">${escHtml(m.event_date || '')}</strong><br>
      🕐 <strong style="color:#f0e9da">${escHtml(m.event_time || '')}</strong><br>
      🚪 Doors <strong style="color:#f0e9da">${escHtml(m.event_doors || '')}</strong><br>
      📍 <strong style="color:#f0e9da">${escHtml(m.venue_name || '')}</strong> — ${escHtml(m.venue_address || '')}
    </div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px">
    <div style="font-size:13px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">Order Summary</div>
    <table style="width:100%;border-collapse:collapse">
      ${itemsHtml}
      ${addonsHtml}
      <tr><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Sales Tax (6%)</td><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(m.sales_tax||0).toFixed(2)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Service Fees</td><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(m.service_fees||0).toFixed(2)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Processing Fee</td><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(m.processing_fee||0).toFixed(2)}</td></tr>
      <tr><td style="padding:10px 0;font-weight:700;color:#f0e9da;font-size:15px">Total</td><td style="padding:10px 0;font-weight:700;color:#c8922a;font-size:15px;text-align:right">$${(pi.amount/100).toFixed(2)}</td></tr>
    </table>
    <div style="margin-top:12px;font-size:11px;color:#7a6c54">Order ID: ${escHtml(order.id)}</div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px;text-align:center">
    <div style="font-size:13px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">Your Ticket</div>
    <div style="background:white;border-radius:10px;padding:14px;display:inline-block;margin-bottom:12px">
      <img src="${qrDataUrl}" width="180" height="180" alt="QR Code" style="display:block;border-radius:4px">
    </div>
    <div style="font-family:monospace;font-size:11px;color:#7a6c54;letter-spacing:1.5px;margin-bottom:10px">${escHtml(order.id.toUpperCase())}</div>
    <div style="font-size:12px;color:#b5a78a;line-height:1.7;margin-bottom:16px">📱 <strong style="color:#f0e9da">Show this QR code at the door.</strong><br>Attending with others? View individual tickets to share each person's QR code:</div>
    <a href="https://c8tickets.com/t/${encodeURIComponent(order.id)}" style="display:inline-block;background:#c8922a;color:#0c0a07;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;text-transform:uppercase;letter-spacing:1px">View My Tickets</a>
    <div style="margin-top:10px;font-size:12px;color:#7a6c54">No sign-in needed — opens directly to your tickets.</div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.08);border-radius:10px;padding:14px 18px;margin-bottom:20px;text-align:center">
    <div style="font-size:11px;color:#7a6c54;line-height:1.8"><strong style="color:#b5a78a">Refund Policy:</strong> All ticket sales are final and non-refundable unless the event is cancelled by the organizer. Questions? <a href="mailto:support@c8tickets.com" style="color:#c8922a">support@c8tickets.com</a></div>
  </div>
  <div style="text-align:center;font-size:11px;color:#7a6c54;line-height:1.8">
    Questions? <a href="mailto:support@c8tickets.com" style="color:#c8922a">support@c8tickets.com</a><br>
    C8Tickets — <a href="https://c8tickets.com" style="color:#c8922a">c8tickets.com</a> — <a href="https://c8tickets.com/terms" style="color:#c8922a">Terms</a> — <a href="https://c8tickets.com/privacy" style="color:#c8922a">Privacy</a><br><br>
    <span style="color:#3a3028">You received this email because you purchased tickets through C8Tickets.</span>
  </div>
</div>
</body></html>`,
    }).catch(e => console.error('Webhook email error:', e.message));

    console.log('Webhook recovered order', order.id, 'for PI', pi.id);
    return res.status(200).json({ received: true, orderId: order.id });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
