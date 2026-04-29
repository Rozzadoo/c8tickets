import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const userRes = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { order, event, venue } = req.body;
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
    <div style="font-size:12px;color:#b5a78a;line-height:1.8">Your refund of <strong style="color:#f0e9da">$${Number(order.total).toFixed(2)}</strong> has been submitted to your original payment method. Refunds typically appear within <strong style="color:#f0e9da">5–10 business days</strong> depending on your bank or card issuer.</div>
  </div>

  <div style="text-align:center;font-size:11px;color:#7a6c54;line-height:1.8">
    Questions? <a href="mailto:support@c8tickets.com" style="color:#c8922a">support@c8tickets.com</a><br>
    C8Tickets — <a href="https://c8tickets.com" style="color:#c8922a">c8tickets.com</a><br><br>
    <span style="color:#3a3028">You received this email because an order was cancelled on your account.</span>
  </div>

</div>
</body></html>`,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
