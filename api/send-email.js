import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function requireAdmin(req, res) {
  const token = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  const userRes = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

async function sendConfirmation(res, { order, event, venue }) {
  const orderId = order?.id;
  if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    return res.status(400).json({ error: 'Invalid order ID' });
  }
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const checkRes = await fetch(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=id,buyer_email&limit=1`,
    { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
  );
  const rows = await checkRes.json();
  if (!Array.isArray(rows) || rows.length === 0) return res.status(200).json({ success: true });
  const toEmail = rows[0].buyer_email;
  if (!toEmail) return res.status(200).json({ success: true });

  const venueName = venue?.name || 'Crooked 8';
  const venueAddress = venue?.location || '1882 E King Rd, Kuna, ID 83634';

  const itemsHtml = (order.items || []).map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">${escHtml(i.qty)}× ${escHtml(i.type)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${(i.qty * i.price).toFixed(2)}</td>
    </tr>`).join('');

  const discountRow = order.discountAmount > 0 ? `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#4caf7d">Promo Discount</td>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#4caf7d;text-align:right">-$${Number(order.discountAmount).toFixed(2)}</td>
    </tr>` : '';

  const { error } = await resend.emails.send({
    from: 'C8Tickets <noreply@c8tickets.com>',
    to: toEmail,
    subject: `Your tickets for ${escHtml(event.title)}`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:40px 20px">
  <div style="text-align:center;margin-bottom:32px">
    <div style="font-size:28px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:3px">${escHtml(venueName)}</div>
    <div style="font-size:12px;color:#7a6c54;text-transform:uppercase;letter-spacing:2px;margin-top:4px">${escHtml(venueAddress)}</div>
  </div>
  <div style="text-align:center;margin-bottom:28px">
    <div style="font-size:36px;margin-bottom:8px">🎉</div>
    <div style="font-size:24px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:2px">You're In!</div>
    <div style="font-size:14px;color:#b5a78a;margin-top:6px">Your tickets have been confirmed</div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px">
    <div style="font-size:11px;color:#c8922a;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">${escHtml(event.category)}</div>
    <div style="font-size:22px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">${escHtml(event.title)}</div>
    <div style="font-size:13px;color:#b5a78a;line-height:1.8">
      📅 <strong style="color:#f0e9da">${escHtml(event.date)}</strong><br>
      🕐 <strong style="color:#f0e9da">${escHtml(event.time)}</strong><br>
      🚪 Doors <strong style="color:#f0e9da">${escHtml(event.doors)}</strong><br>
      📍 <strong style="color:#f0e9da">${escHtml(venueName)}</strong> — ${escHtml(venueAddress)}
    </div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px">
    <div style="font-size:13px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">Order Summary</div>
    <table style="width:100%;border-collapse:collapse">
      ${itemsHtml}
      ${discountRow}
      <tr><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Sales Tax (6%)</td><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(order.salesTax).toFixed(2)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Service Fees</td><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(order.serviceFees).toFixed(2)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Processing Fee</td><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(order.processingFee).toFixed(2)}</td></tr>
      <tr><td style="padding:10px 0;font-weight:700;color:#f0e9da;font-size:15px">Total</td><td style="padding:10px 0;font-weight:700;color:#c8922a;font-size:15px;text-align:right">$${Number(order.total).toFixed(2)}</td></tr>
    </table>
    <div style="margin-top:12px;font-size:11px;color:#7a6c54">Order ID: ${escHtml(order.id)}</div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px;text-align:center">
    <div style="font-size:13px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">Your Ticket</div>
    <div style="background:white;border-radius:10px;padding:14px;display:inline-block;margin-bottom:12px">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(order.id)}" alt="QR Code" width="180" height="180" style="display:block" />
    </div>
    <div style="font-family:monospace;font-size:11px;color:#7a6c54;letter-spacing:1.5px;margin-bottom:10px">${escHtml(order.id.toUpperCase())}</div>
    <div style="font-size:12px;color:#b5a78a;line-height:1.7">
      Show this QR code at the gate<br>
      Buying for a group? View and share individual tickets at:<br>
      <a href="https://c8tickets.com/t/${encodeURIComponent(order.id)}" style="color:#c8922a;font-weight:700">c8tickets.com/t/${order.id.slice(0,8).toLowerCase()}…</a>
    </div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.08);border-radius:10px;padding:14px 18px;margin-bottom:20px;text-align:center">
    <div style="font-size:11px;color:#7a6c54;line-height:1.8"><strong style="color:#b5a78a">Refund Policy:</strong> All ticket sales are final and non-refundable unless the event is cancelled by the organizer. Questions? <a href="mailto:support@c8tickets.com" style="color:#c8922a">support@c8tickets.com</a></div>
  </div>
  <div style="text-align:center;font-size:11px;color:#7a6c54;line-height:1.8">
    C8Tickets — <a href="https://c8tickets.com" style="color:#c8922a">c8tickets.com</a> —
    <a href="https://c8tickets.com/terms" style="color:#c8922a">Terms</a> —
    <a href="https://c8tickets.com/privacy" style="color:#c8922a">Privacy</a><br><br>
    <span style="color:#3a3028">You received this because you purchased tickets through C8Tickets.</span>
  </div>
</div>
</body></html>`,
  });

  if (error) { console.error(error); return res.status(400).json({ error }); }
  return res.status(200).json({ success: true });
}

async function sendCancellation(res, { order, event, venue }) {
  if (!order?.buyer?.email) return res.status(400).json({ error: 'Missing buyer email' });
  const venueName = venue?.name || 'Crooked 8';
  const venueAddress = venue?.location || '';
  const itemsHtml = (order.items || []).map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">${escHtml(i.qty)}× ${escHtml(i.type)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${(i.qty * i.price).toFixed(2)}</td>
    </tr>`).join('');

  await resend.emails.send({
    from: 'C8Tickets <noreply@c8tickets.com>',
    to: order.buyer.email,
    subject: `Your order has been cancelled — ${escHtml(event?.title || 'C8Tickets')}`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:40px 20px">
  <div style="text-align:center;margin-bottom:32px">
    <div style="font-size:28px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:3px">${escHtml(venueName)}</div>
    <div style="font-size:12px;color:#7a6c54;text-transform:uppercase;letter-spacing:2px;margin-top:4px">${escHtml(venueAddress)}</div>
  </div>
  <div style="text-align:center;margin-bottom:28px">
    <div style="font-size:24px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:2px">Order Cancelled</div>
    <div style="font-size:14px;color:#b5a78a;margin-top:6px">Your order has been cancelled and a full refund has been issued</div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px">
    <div style="font-size:11px;color:#c8922a;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">${escHtml(event?.category || '')}</div>
    <div style="font-size:22px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">${escHtml(event?.title || '')}</div>
    <div style="font-size:13px;color:#b5a78a;line-height:1.8">
      📅 <strong style="color:#f0e9da">${escHtml(event?.date || '')}</strong><br>
      🕐 <strong style="color:#f0e9da">${escHtml(event?.time || '')}</strong><br>
      📍 <strong style="color:#f0e9da">${escHtml(venueName)}</strong> — ${escHtml(venueAddress)}
    </div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px">
    <div style="font-size:13px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">Cancelled Order Summary</div>
    <table style="width:100%;border-collapse:collapse">
      ${itemsHtml}
      <tr><td style="padding:10px 0;font-weight:700;color:#f0e9da;font-size:15px">Refund Amount</td><td style="padding:10px 0;font-weight:700;color:#c8922a;font-size:15px;text-align:right">$${Number(order.total).toFixed(2)}</td></tr>
    </table>
    <div style="margin-top:12px;font-size:11px;color:#7a6c54">Order ID: ${escHtml(order.id)}</div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.08);border-radius:10px;padding:20px 24px;margin-bottom:20px">
    <div style="font-size:13px;font-weight:700;color:#f0e9da;margin-bottom:10px">About Your Refund</div>
    <div style="font-size:12px;color:#b5a78a;line-height:1.8">Your refund of <strong style="color:#f0e9da">$${Number(order.total).toFixed(2)}</strong> has been submitted to your original payment method. Refunds typically appear within <strong style="color:#f0e9da">5–10 business days</strong>.</div>
  </div>
  <div style="text-align:center;font-size:11px;color:#7a6c54;line-height:1.8">
    Questions? <a href="mailto:support@c8tickets.com" style="color:#c8922a">support@c8tickets.com</a><br>
    C8Tickets — <a href="https://c8tickets.com" style="color:#c8922a">c8tickets.com</a>
  </div>
</div>
</body></html>`,
  });

  return res.status(200).json({ success: true });
}

async function sendReminder(res, { eventId }) {
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    return res.status(400).json({ error: 'Invalid eventId' });
  }
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };

  const [eventRes, ordersRes] = await Promise.all([
    fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/events?id=eq.${eventId}&select=*,ticket_types(*)&limit=1`, { headers }),
    fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/orders?event_id=eq.${eventId}&status=eq.confirmed&select=id,buyer_email,buyer_name`, { headers }),
  ]);
  const events = await eventRes.json();
  const orders = await ordersRes.json();
  const ev = Array.isArray(events) ? events[0] : null;
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  if (!Array.isArray(orders) || orders.length === 0) return res.status(200).json({ sent: 0 });

  const eventDate = new Date(ev.event_date);
  const dateStr = eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const doorsStr = ev.doors_open ? new Date(ev.doors_open).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;

  const results = await Promise.allSettled(
    orders.map(order =>
      resend.emails.send({
        from: 'C8Tickets <noreply@c8tickets.com>',
        to: order.buyer_email,
        subject: `Tonight's the night — ${escHtml(ev.title)}`,
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:40px 20px">
  <div style="text-align:center;margin-bottom:32px">
    <div style="font-size:28px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:3px">Crooked 8</div>
    <div style="font-size:12px;color:#7a6c54;text-transform:uppercase;letter-spacing:2px;margin-top:4px">1882 E King Rd, Kuna, ID 83634</div>
  </div>
  <div style="text-align:center;margin-bottom:28px">
    <div style="font-size:24px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:2px">Your Event is Coming Up</div>
    <div style="font-size:14px;color:#b5a78a;margin-top:6px">Don't forget — you've got tickets</div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px">
    <div style="font-size:11px;color:#c8922a;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">${escHtml(ev.category || '')}</div>
    <div style="font-size:22px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">${escHtml(ev.title)}</div>
    <div style="font-size:13px;color:#b5a78a;line-height:1.8">
      📅 <strong style="color:#f0e9da">${escHtml(dateStr)}</strong><br>
      🕐 <strong style="color:#f0e9da">${escHtml(timeStr)}</strong><br>
      ${doorsStr ? `🚪 Doors <strong style="color:#f0e9da">${escHtml(doorsStr)}</strong><br>` : ''}
      📍 <strong style="color:#f0e9da">Crooked 8</strong> — 1882 E King Rd, Kuna, ID 83634
    </div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px;text-align:center">
    <div style="font-size:13px;color:#b5a78a;margin-bottom:16px">Your tickets are ready. Show your QR code at the gate.</div>
    <a href="https://c8tickets.com/t/${encodeURIComponent(order.id)}" style="display:inline-block;background:#c8922a;color:#0c0a07;font-weight:700;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:8px;text-transform:uppercase;letter-spacing:1px">View My Tickets</a>
  </div>
  <div style="text-align:center;font-size:11px;color:#7a6c54;line-height:1.8">
    Questions? <a href="mailto:support@c8tickets.com" style="color:#c8922a">support@c8tickets.com</a><br>
    C8Tickets — <a href="https://c8tickets.com" style="color:#c8922a">c8tickets.com</a>
  </div>
</div>
</body></html>`,
      })
    )
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.length - sent;
  if (failed > 0) console.error(`send-email reminder: ${failed} failed for event ${eventId}`);
  return res.status(200).json({ sent, total: orders.length });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type } = req.body;

  if (type === 'reminder') {
    const ok = await requireAdmin(req, res);
    if (!ok) return;
    return sendReminder(res, req.body);
  }

  if (type === 'cancellation') {
    const ok = await requireAdmin(req, res);
    if (!ok) return;
    return sendCancellation(res, req.body);
  }

  try {
    return await sendConfirmation(res, req.body);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
