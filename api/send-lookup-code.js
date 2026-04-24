import { createHmac } from 'crypto';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function makeCode(email, slot) {
  const buf = createHmac('sha256', process.env.LOOKUP_CODE_SECRET || 'dev-secret')
    .update(`${email}:${slot}`)
    .digest('hex');
  return String(parseInt(buf.slice(0, 8), 16) % 1000000).padStart(6, '0');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const normalized = email.toLowerCase().trim();
  const slot = Math.floor(Date.now() / (1000 * 60 * 60));
  const code = makeCode(normalized, slot);

  await resend.emails.send({
    from: 'C8Tickets <noreply@c8tickets.com>',
    to: normalized,
    subject: 'Your C8Tickets verification code',
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
        <div style="max-width:480px;margin:0 auto;padding:40px 20px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:3px;margin-bottom:32px">C8Tickets</div>
          <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:32px">
            <p style="color:#b5a78a;font-size:14px;margin:0 0 20px">Use the code below to access your tickets. It expires in one hour.</p>
            <div style="font-size:42px;font-weight:700;letter-spacing:10px;color:#f0e9da;margin:0 0 20px">${code}</div>
            <p style="color:#7a6c54;font-size:12px;margin:0">If you didn't request this, you can ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  });

  // Always return 200 — don't reveal whether the email exists in our system
  return res.status(200).json({ ok: true });
}
