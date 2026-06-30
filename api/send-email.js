import { Resend } from 'resend';
import { generateTicketPdf } from './_pdf.js';

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
  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaHeaders = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };

  // Declare these first — used both in PDF generation and email HTML
  const venueName = venue?.name || '';
  const venueAddress = venue?.location || '';

  const [checkRes, ticketsRes] = await Promise.all([
    fetch(`${supaUrl}/rest/v1/orders?id=eq.${orderId}&select=id,buyer_email,buyer_name,event_id&limit=1`, { headers: supaHeaders }),
    fetch(`${supaUrl}/rest/v1/tickets?order_id=eq.${orderId}&select=id,ticket_number,ticket_type_name&order=ticket_number.asc&limit=50`, { headers: supaHeaders }),
  ]);
  const rows = await checkRes.json();
  if (!Array.isArray(rows) || rows.length === 0) return res.status(200).json({ success: true });
  const toEmail = rows[0].buyer_email;
  if (!toEmail) return res.status(200).json({ success: true });
  const buyerName = rows[0].buyer_name || order.buyer_name || '';
  const eventId = rows[0].event_id || null;

  const ticketRows = await ticketsRes.json();
  let tickets = Array.isArray(ticketRows) ? ticketRows : [];

  // Lazy-generate ticket records from order_items for orders that predate fulfill_order
  if (tickets.length === 0) {
    try {
      const itemsRes = await fetch(
        `${supaUrl}/rest/v1/order_items?order_id=eq.${orderId}&select=ticket_type_name,quantity,is_addon&order=id.asc`,
        { headers: supaHeaders }
      );
      const orderItems = await itemsRes.json();
      const lineItems = (Array.isArray(orderItems) ? orderItems : []).filter(i => !i.is_addon);
      const toInsert = [];
      let num = 1;
      for (const li of lineItems) {
        for (let j = 0; j < (li.quantity || 1); j++) {
          toInsert.push({ order_id: orderId, event_id: eventId, ticket_type_name: li.ticket_type_name, ticket_number: num++, status: 'valid' });
        }
      }
      if (toInsert.length > 0) {
        const insRes = await fetch(`${supaUrl}/rest/v1/tickets`, {
          method: 'POST',
          headers: { ...supaHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=ignore-duplicates' },
          body: JSON.stringify(toInsert),
        });
        if (insRes.ok) {
          const inserted = await insRes.json();
          if (Array.isArray(inserted) && inserted.length > 0) {
            tickets = inserted.map(t => ({ id: t.id, ticket_number: t.ticket_number, ticket_type_name: t.ticket_type_name }));
          } else {
            // Conflict — tickets already exist, re-fetch
            const reRes = await fetch(
              `${supaUrl}/rest/v1/tickets?order_id=eq.${orderId}&select=id,ticket_number,ticket_type_name&order=ticket_number.asc&limit=50`,
              { headers: supaHeaders }
            );
            const reRows = await reRes.json();
            if (Array.isArray(reRows)) tickets = reRows;
          }
        }
      }
    } catch (e) {
      console.error('send-email: ticket lazy-generation failed:', e.message);
    }
  }

  let pdfBuffer = null;
  try {
    pdfBuffer = await generateTicketPdf({
      order: { ...order, buyer_name: buyerName },
      tickets,
      eventTitle: event.title,
      eventDate: event.date,
      eventTime: event.time,
      eventDoors: event.doors,
      venueName,
    });
  } catch (e) {
    console.error('send-email: PDF generation failed:', e.message);
  }

  const itemsHtml = (order.items || []).map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">${escHtml(i.qty)}× ${escHtml(i.type)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${(i.qty * i.price).toFixed(2)}</td>
    </tr>`).join('');

  const addonsHtml = (order.addonItems || []).map(ai => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#c8922a">🎁 ${escHtml(ai.qty)}× ${escHtml(ai.name)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#c8922a;text-align:right">$${(ai.qty * ai.price).toFixed(2)}</td>
    </tr>`).join('');

  const discountRow = order.discountAmount > 0 ? `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#4caf7d">Promo Discount</td>
      <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#4caf7d;text-align:right">-$${Number(order.discountAmount).toFixed(2)}</td>
    </tr>` : '';

  const emailPayload = {
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
      ${addonsHtml}
      ${discountRow}
      <tr><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Sales Tax (6%)</td><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(order.salesTax).toFixed(2)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Service Fees</td><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(order.serviceFees).toFixed(2)}</td></tr>
      ${Number(order.processingFee) > 0 ? `<tr><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Processing Fee</td><td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(order.processingFee).toFixed(2)}</td></tr>` : ''}
      <tr><td style="padding:10px 0;font-weight:700;color:#f0e9da;font-size:15px">Total</td><td style="padding:10px 0;font-weight:700;color:#c8922a;font-size:15px;text-align:right">$${Number(order.total).toFixed(2)}</td></tr>
    </table>
    <div style="margin-top:12px;font-size:11px;color:#7a6c54">Order ID: ${escHtml(order.id)}</div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px;text-align:center">
    <div style="font-size:32px;margin-bottom:10px">🎟️</div>
    <div style="font-size:15px;font-weight:700;color:#f0e9da;margin-bottom:8px">Your tickets are attached</div>
    <div style="font-size:13px;color:#b5a78a;line-height:1.7;margin-bottom:20px">
      Open <strong style="color:#f0e9da">tickets.pdf</strong> to see your QR codes — one per ticket.<br>
      Show your QR code at the door to be scanned in.
    </div>
    <a href="https://c8tickets.com/t/${encodeURIComponent(order.id)}" style="display:inline-block;background:#c8922a;color:#0c0a07;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;text-transform:uppercase;letter-spacing:1px">View My Tickets Online</a>
    <div style="margin-top:10px;font-size:12px;color:#7a6c54">No sign-in needed — opens directly to your tickets.</div>
    <div style="margin-top:14px;font-size:12px;color:#7a6c54">On iPhone? Open your tickets online and tap <strong style="color:#b5a78a">Add to Apple Wallet</strong> on each ticket.</div>
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
  };
  if (pdfBuffer) {
    emailPayload.attachments = [{ filename: 'tickets.pdf', content: pdfBuffer }];
  }
  const { error } = await resend.emails.send(emailPayload);

  if (error) { console.error(error); return res.status(400).json({ error }); }
  return res.status(200).json({ success: true });
}

async function sendCancellation(res, { order, event, venue }) {
  if (!order?.buyer?.email) return res.status(400).json({ error: 'Missing buyer email' });
  const venueName = venue?.name || '';
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

async function sendOrganizerInquiry(res, { form }) {
  const { name, email, phone, eventName, location, date, attendance, channel, notes } = form || {};
  if (!name || !email) return res.status(400).json({ error: 'Missing required fields' });

  const channelLabel = { online: 'Online only', door: 'At the door only', both: 'Online and at the door' }[channel] || channel;
  const dateLabel = date ? new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Not specified';

  const row = (label, value) => value
    ? `<tr><td style="padding:8px 12px;font-size:12px;color:#7a6c54;font-weight:700;text-transform:uppercase;letter-spacing:1px;white-space:nowrap;vertical-align:top">${escHtml(label)}</td><td style="padding:8px 12px;font-size:14px;color:#f0e9da;vertical-align:top">${escHtml(value)}</td></tr>`
    : '';

  await resend.emails.send({
    from: 'C8Tickets <noreply@c8tickets.com>',
    to: 'support@c8tickets.com',
    replyTo: email,
    subject: `New organizer inquiry — ${escHtml(eventName || 'unnamed event')} from ${escHtml(name)}`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:540px;margin:0 auto;padding:40px 20px">
  <div style="font-size:20px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:2px;margin-bottom:24px">New Organizer Inquiry</div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.2);border-radius:10px;overflow:hidden;margin-bottom:20px">
    <table style="width:100%;border-collapse:collapse">
      ${row('Name', name)}
      ${row('Email', email)}
      ${row('Phone', phone)}
      ${row('Event Name / Type', eventName)}
      ${row('Location', location)}
      ${row('Event Date', dateLabel)}
      ${row('Expected Attendance', attendance)}
      ${row('Sales Channel', channelLabel)}
      ${row('Notes', notes)}
    </table>
  </div>
  <div style="font-size:11px;color:#7a6c54">Reply directly to this email to respond to ${escHtml(name)}.</div>
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
  const tz = { timeZone: 'America/Boise' };
  const dateStr = eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...tz });
  const timeStr = eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...tz });
  const doorsStr = ev.doors_open ? new Date(ev.doors_open).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...tz }) : null;

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
    <div style="font-size:28px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:3px">${escHtml(ev.venue_name || '')}</div>
    <div style="font-size:12px;color:#7a6c54;text-transform:uppercase;letter-spacing:2px;margin-top:4px">C8Tickets</div>
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
      📍 <strong style="color:#f0e9da">${escHtml(ev.venue_name || '')}</strong>
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

async function sendRegistrationConfirmation(res, { registrationId, venueName }) {
  if (!registrationId || !/^[0-9a-f-]{36}$/i.test(registrationId)) {
    return res.status(400).json({ error: 'Invalid registration ID' });
  }
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const base = process.env.VITE_SUPABASE_URL;
  const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };

  const regRes = await fetch(
    `${base}/rest/v1/registrations?id=eq.${registrationId}&select=id,registrant_name,registrant_email,team_name,status,total_amount,form_id&limit=1`,
    { headers }
  );
  const regRows = await regRes.json();
  const reg = regRows?.[0];
  if (!reg || !reg.registrant_email) return res.status(200).json({ success: true });

  const formRes = await fetch(
    `${base}/rest/v1/registration_forms?id=eq.${reg.form_id}&select=title,category&limit=1`,
    { headers }
  );
  const formRows = await formRes.json();
  const form = formRows?.[0];

  const responsesRes = await fetch(
    `${base}/rest/v1/registration_responses?registration_id=eq.${registrationId}&select=field_label,response_value`,
    { headers }
  );
  const responses = await responsesRes.json() || [];

  const membersRes = await fetch(
    `${base}/rest/v1/registration_members?registration_id=eq.${registrationId}&select=member_name,member_email`,
    { headers }
  );
  const members = await membersRes.json() || [];

  const isWaitlist = reg.status === 'waitlisted';
  const formTitle = escHtml(form?.title || 'Registration');
  const qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(registrationId)}&color=1a1007&bgcolor=ffffff&margin=8`;

  const responsesHtml = responses.length > 0
    ? responses.map(r => `<tr><td style="padding:6px 0;border-bottom:1px solid #2f271c;color:#b5a78a">${escHtml(r.field_label)}</td><td style="padding:6px 0;border-bottom:1px solid #2f271c;color:#e8dcc8;text-align:right">${escHtml(r.response_value || '—')}</td></tr>`).join('')
    : '';

  const membersHtml = members.length > 0
    ? `<p style="color:#b5a78a;font-size:13px;margin:16px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:1px">Team Members</p>
       ${members.map(m => `<p style="color:#e8dcc8;font-size:13px;margin:4px 0">${escHtml(m.member_name)}${m.member_email ? ` &lt;${escHtml(m.member_email)}&gt;` : ''}</p>`).join('')}`
    : '';

  const subject = isWaitlist
    ? `Waitlist confirmation — ${form?.title || 'Registration'}`
    : `Registration confirmed — ${form?.title || 'Registration'}`;

  const { error } = await resend.emails.send({
    from: 'C8Tickets <noreply@c8tickets.com>',
    to: reg.registrant_email,
    subject,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td align="center" style="padding-bottom:24px">
    <span style="font-size:28px;font-weight:900;letter-spacing:2px;color:#c8922a;text-transform:uppercase">${escHtml(venueName || 'C8Tickets')}</span>
  </td></tr>
  <tr><td style="background:#161310;border:1px solid #2f271c;border-radius:8px;padding:28px">
    <p style="color:${isWaitlist ? '#c8922a' : '#4caf7d'};font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0 0 16px">${isWaitlist ? '⏳ You\'re on the waitlist' : '✓ Registration Confirmed'}</p>
    <h1 style="color:#e8dcc8;font-size:22px;font-weight:700;margin:0 0 8px">${formTitle}</h1>
    ${reg.team_name ? `<p style="color:#c8922a;font-size:14px;font-weight:700;margin:0 0 16px">Team: ${escHtml(reg.team_name)}</p>` : ''}
    <p style="color:#b5a78a;font-size:13px;margin:0 0 20px">${isWaitlist ? "We'll email you if a spot opens up." : "You're all set. Bring this confirmation or your registration ID to the event."}</p>
    ${!isWaitlist ? `<div style="text-align:center;margin:20px 0"><img src="${qrDataUrl}" width="180" height="180" alt="Registration QR Code" style="border-radius:8px"/><p style="color:#b5a78a;font-size:11px;margin:8px 0 0">Scan at check-in</p></div>` : ''}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0">
      <tr><td style="padding:6px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Registrant</td><td style="padding:6px 0;border-bottom:1px solid #2f271c;color:#e8dcc8;text-align:right">${escHtml(reg.registrant_name)}</td></tr>
      ${responsesHtml}
      ${parseFloat(reg.total_amount) > 0 ? `<tr><td style="padding:6px 0;color:#b5a78a">Amount Paid</td><td style="padding:6px 0;color:#c8922a;font-weight:700;text-align:right">$${parseFloat(reg.total_amount).toFixed(2)}</td></tr>` : ''}
    </table>
    ${membersHtml}
    <p style="color:#5a5040;font-size:11px;margin:20px 0 0">Registration ID: ${escHtml(registrationId)}</p>
  </td></tr>
  <tr><td align="center" style="padding-top:20px"><p style="color:#5a5040;font-size:11px;margin:0">Powered by <a href="https://c8tickets.com" style="color:#c8922a;text-decoration:none">C8Tickets</a></p></td></tr>
</table></td></tr></table></body></html>`,
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type } = req.body;

  if (type === 'organizer_inquiry') {
    try { return await sendOrganizerInquiry(res, req.body); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }

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

  if (type === 'registration') {
    try { return await sendRegistrationConfirmation(res, req.body); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // Confirmation emails are sent by the customer's browser right after payment —
  // no admin session exists at that point. The destination email is always fetched
  // from Supabase (not the request body), so this path cannot be used to spam
  // arbitrary addresses.
  try {
    return await sendConfirmation(res, req.body);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
