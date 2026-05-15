import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const APP_URL = process.env.VITE_APP_URL || 'https://c8tickets.com';

const sendLog = new Map();
function isRateLimited(key, maxPerHour) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const recent = (sendLog.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= maxPerHour) return true;
  sendLog.set(key, [...recent, now]);
  return false;
}

const supaHeaders = () => {
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  return { apikey: supaKey, Authorization: `Bearer ${supaKey}` };
};

function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

async function handleSend(req, res) {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  const normalized = email.toLowerCase().trim();
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';

  if (isRateLimited(`ip:${ip}`, 10) || isRateLimited(`email:${normalized}`, 5)) {
    return res.status(200).json({ ok: true });
  }

  const ordersRes = await fetch(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/orders?buyer_email=eq.${encodeURIComponent(normalized)}&status=neq.cancelled&select=id,events(title,event_date)&order=created_at.desc`,
    { headers: supaHeaders() }
  );
  const orders = await ordersRes.json();
  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(200).json({ ok: true });
  }

  const linksHtml = orders.map(o => {
    const title = o.events?.title || 'Event';
    const date = fmtDate(o.events?.event_date);
    const url = `${APP_URL}/t/${o.id}`;
    return `<div style="margin-bottom:12px;padding:16px;background:#1a1510;border:1px solid rgba(200,146,42,.15);border-radius:8px">
      <div style="font-size:14px;font-weight:700;color:#f0e9da;margin-bottom:${date ? 4 : 12}px">${title}</div>
      ${date ? `<div style="font-size:12px;color:#b5a78a;margin-bottom:12px">${date}</div>` : ''}
      <a href="${url}" style="display:inline-block;background:#c8922a;color:#0c0a07;font-weight:700;font-size:13px;padding:10px 20px;border-radius:6px;text-decoration:none;letter-spacing:.5px">View Tickets</a>
    </div>`;
  }).join('');

  await resend.emails.send({
    from: 'C8Tickets <noreply@c8tickets.com>',
    to: normalized,
    subject: 'Your C8Tickets — Access Your Tickets',
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;padding:40px 20px">
    <div style="font-size:24px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:3px;margin-bottom:32px;text-align:center">C8Tickets</div>
    <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:32px">
      <p style="color:#b5a78a;font-size:14px;margin:0 0 20px">Here are your tickets. Click any event below to view and share.</p>
      ${linksHtml}
      <p style="color:#7a6c54;font-size:12px;margin:20px 0 0">If you didn't request this, you can ignore this email.</p>
    </div>
  </div>
</body></html>`,
  });

  return res.status(200).json({ ok: true });
}

async function handleResend(req, res) {
  const { orderId, email } = req.body;
  if (!orderId || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const normalized = email.toLowerCase().trim();
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';

  if (isRateLimited(`resend:${orderId}:${ip}`, 5)) {
    return res.status(200).json({ ok: true });
  }

  const orderRes = await fetch(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=id,events(title,event_date)&limit=1`,
    { headers: supaHeaders() }
  );
  const rows = await orderRes.json();
  const order = Array.isArray(rows) ? rows[0] : null;
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const title = order.events?.title || 'Event';
  const date = fmtDate(order.events?.event_date);
  const url = `${APP_URL}/t/${orderId}`;

  await resend.emails.send({
    from: 'C8Tickets <noreply@c8tickets.com>',
    to: normalized,
    subject: `Your Tickets — ${title}`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;padding:40px 20px;text-align:center">
    <div style="font-size:24px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:3px;margin-bottom:32px">C8Tickets</div>
    <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:32px">
      <p style="color:#b5a78a;font-size:14px;margin:0 0 8px">Your tickets for</p>
      <p style="color:#f0e9da;font-size:18px;font-weight:700;margin:0 0 4px">${title}</p>
      ${date ? `<p style="color:#b5a78a;font-size:13px;margin:0 0 28px">${date}</p>` : '<div style="margin-bottom:28px"></div>'}
      <a href="${url}" style="display:inline-block;background:#c8922a;color:#0c0a07;font-weight:700;font-size:14px;padding:14px 32px;border-radius:6px;text-decoration:none;letter-spacing:.5px">View My Tickets</a>
      <p style="color:#7a6c54;font-size:12px;margin:24px 0 0">Bookmark this link for easy access anytime.</p>
    </div>
  </div>
</body></html>`,
  });

  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { action } = req.body;
  if (action === 'send') return handleSend(req, res);
  if (action === 'resend') return handleResend(req, res);
  return res.status(400).json({ error: 'Invalid action' });
}
