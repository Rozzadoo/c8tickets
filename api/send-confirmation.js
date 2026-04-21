import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { order, event } = req.body;

    const itemsHtml = order.items.map(i => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">${i.qty}× ${i.type}</td>
        <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${(i.qty * i.price).toFixed(2)}</td>
      </tr>
    `).join('');

    const { data, error } = await resend.emails.send({
      from: 'C8Tickets <noreply@c8tickets.com>',
      to: order.buyer.email,
      subject: `Your tickets for ${event.title}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
          <div style="max-width:520px;margin:0 auto;padding:40px 20px">
            
            <!-- Header -->
            <div style="text-align:center;margin-bottom:32px">
              <div style="font-size:28px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:3px">Crooked 8</div>
              <div style="font-size:12px;color:#7a6c54;text-transform:uppercase;letter-spacing:2px;margin-top:4px">Kuna, Idaho</div>
            </div>

            <!-- You're In -->
            <div style="text-align:center;margin-bottom:28px">
              <div style="font-size:36px;margin-bottom:8px">🎉</div>
              <div style="font-size:24px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:2px">You're In!</div>
              <div style="font-size:14px;color:#b5a78a;margin-top:6px">Your tickets have been confirmed</div>
            </div>

            <!-- Event Card -->
            <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px">
              <div style="font-size:11px;color:#c8922a;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">${event.category}</div>
              <div style="font-size:22px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">${event.title}</div>
              <div style="font-size:13px;color:#b5a78a;line-height:1.8">
                📅 <strong style="color:#f0e9da">${event.date}</strong><br>
                🕐 <strong style="color:#f0e9da">${event.time}</strong><br>
                🚪 Doors <strong style="color:#f0e9da">${event.doors}</strong><br>
                📍 <strong style="color:#f0e9da">Crooked 8</strong> — 1882 E King Rd, Kuna, ID 83634
              </div>
            </div>

            <!-- Order Summary -->
            <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px">
              <div style="font-size:13px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">Order Summary</div>
              <table style="width:100%;border-collapse:collapse">
                ${itemsHtml}
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Sales Tax (6%)</td>
                  <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(order.salesTax).toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Service Fees</td>
                  <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(order.serviceFees).toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a">Processing Fee</td>
                  <td style="padding:8px 0;border-bottom:1px solid #2f271c;color:#b5a78a;text-align:right">$${Number(order.processingFee).toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding:10px 0;font-weight:700;color:#f0e9da;font-size:15px">Total</td>
                  <td style="padding:10px 0;font-weight:700;color:#c8922a;font-size:15px;text-align:right">$${Number(order.total).toFixed(2)}</td>
                </tr>
              </table>
              <div style="margin-top:12px;font-size:11px;color:#7a6c54">Order ID: ${order.id}</div>
            </div>

            <!-- QR Code -->
            <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px;text-align:center">
            <div style="font-size:13px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">Your Ticket</div>
            <div style="background:white;border-radius:10px;padding:14px;display:inline-block;margin-bottom:12px">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${order.id}" alt="QR Code" width="180" height="180" style="display:block" />
            </div>
            <div style="font-family:monospace;font-size:11px;color:#7a6c54;letter-spacing:1.5px;margin-bottom:10px">${order.id.toUpperCase()}</div>
            <div style="font-size:12px;color:#b5a78a;line-height:1.7">
            📱 <strong style="color:#f0e9da">Show this QR code at the gate</strong><br>
            You can also access your ticket at <a href="https://c8tickets.com" style="color:#c8922a">c8tickets.com</a>
            </div>
            </div>

            <!-- Footer -->
            <div style="text-align:center;font-size:11px;color:#7a6c54;line-height:1.8">
            Questions? Contact us at <a href="mailto:support@c8tickets.com" style="color:#c8922a">support@c8tickets.com</a><br>
            C8Tickets - Kuna, ID 83634<br>
            <a href="https://c8tickets.com" style="color:#c8922a">c8tickets.com</a> - 
            <a href="https://c8tickets.com/terms" style="color:#c8922a">Terms</a> - 
            <a href="https://c8tickets.com/privacy" style="color:#c8922a">Privacy</a><br><br>
            <span style="color:#3a3028">You received this email because you purchased tickets through C8Tickets. This is a transactional email confirming your order.</span>
            </div>

          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error(error);
      return res.status(400).json({ error });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}