import { createHmac } from 'crypto';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const LOOKUP_CODE_SECRET = process.env.LOOKUP_CODE_SECRET;
if (!LOOKUP_CODE_SECRET) throw new Error('LOOKUP_CODE_SECRET env var is not set');

function makeCode(email, slot) {
  const buf = createHmac('sha256', LOOKUP_CODE_SECRET).update(`${email}:${slot}`).digest('hex');
  return String(parseInt(buf.slice(0, 8), 16) % 1000000).padStart(6, '0');
}

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

  const checkRes = await fetch(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/orders?buyer_email=eq.${encodeURIComponent(normalized)}&status=neq.cancelled&select=id&limit=1`,
    { headers: supaHeaders() }
  );
  const orders = await checkRes.json();
  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(200).json({ ok: true });
  }

  const slot = Math.floor(Date.now() / (1000 * 60 * 60));
  const code = makeCode(normalized, slot);

  await resend.emails.send({
    from: 'C8Tickets <noreply@c8tickets.com>',
    to: normalized,
    subject: 'Your C8Tickets verification code',
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;padding:40px 20px;text-align:center">
    <div style="font-size:24px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:3px;margin-bottom:32px">C8Tickets</div>
    <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:32px">
      <p style="color:#b5a78a;font-size:14px;margin:0 0 20px">Use the code below to access your tickets. It expires in one hour.</p>
      <div style="font-size:42px;font-weight:700;letter-spacing:10px;color:#f0e9da;margin:0 0 20px">${code}</div>
      <p style="color:#7a6c54;font-size:12px;margin:0">If you didn't request this, you can ignore this email.</p>
    </div>
  </div>
</body></html>`,
  });

  return res.status(200).json({ ok: true });
}

async function handleVerify(req, res) {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Missing fields' });
  const normalized = email.toLowerCase().trim();
  const slot = Math.floor(Date.now() / (1000 * 60 * 60));
  const valid = makeCode(normalized, slot) === code || makeCode(normalized, slot - 1) === code;
  if (!valid) return res.status(401).json({ error: 'Invalid or expired code' });

  const url = `${process.env.VITE_SUPABASE_URL}/rest/v1/orders?buyer_email=eq.${encodeURIComponent(normalized)}&status=neq.cancelled&select=*,order_items(*),events(title,event_date)&order=created_at.desc`;
  const supaRes = await fetch(url, { headers: supaHeaders() });
  const orders = await supaRes.json();
  return res.status(200).json({ orders: Array.isArray(orders) ? orders : [] });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { action } = req.body;
  if (action === 'send') return handleSend(req, res);
  if (action === 'verify') return handleVerify(req, res);
  return res.status(400).json({ error: 'Invalid action' });
}
