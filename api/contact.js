import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { name, email, venue, message } = req.body || {};

  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email' });

  try {
    await resend.emails.send({
      from: 'C8 Tickets <noreply@c8tickets.com>',
      to: 'hello@c8tickets.com',
      replyTo: email,
      subject: `New contact: ${esc(name)} — ${esc(venue || 'no venue')}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;color:#1a1a1a">
          <h2 style="margin-bottom:4px">New Contact Form Submission</h2>
          <p style="color:#666;font-size:13px;margin-top:0">${new Date().toLocaleString('en-US',{timeZone:'America/Boise'})}</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px">
            <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:700;width:120px">Name</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(name)}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:700">Email</td><td style="padding:8px 0;border-bottom:1px solid #eee"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:700">Venue</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(venue || '—')}</td></tr>
          </table>
          <div style="margin-top:20px;padding:16px;background:#f5f5f5;border-radius:8px;white-space:pre-wrap;font-size:14px">${esc(message || '(no message)')}</div>
        </div>
      `,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('contact email error', err);
    return res.status(500).json({ error: 'Failed to send' });
  }
}
