import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const userRes = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' });

  const { eventId } = req.body;
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
  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(200).json({ sent: 0 });
  }

  const eventDate = new Date(ev.event_date);
  const dateStr = eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const doorsStr = ev.doors_open
    ? new Date(ev.doors_open).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;

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
    C8Tickets — <a href="https://c8tickets.com" style="color:#c8922a">c8tickets.com</a><br><br>
    <span style="color:#3a3028">You received this because you have tickets for this event.</span>
  </div>

</div>
</body></html>`,
      })
    )
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.length - sent;
  if (failed > 0) console.error(`send-reminder: ${failed} email(s) failed for event ${eventId}`);

  return res.status(200).json({ sent, total: orders.length });
}
