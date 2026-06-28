import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const GOLD    = '#c8922a';
const BG      = '#0c0a07';
const TEXT    = '#f0e9da';
const TEXT2   = '#b5a78a';
const TEXT3   = '#7a6c54';
const DIM     = '#3a3028';
const DIVIDER = '#2f271c';

const W      = 360;
const H      = 420;
const MX     = 24;
const QR_SZ  = 140;
const QR_PAD = 8;
const QR_BOX = QR_SZ + QR_PAD * 2;

export async function generateTicketPdf({ order, tickets, eventTitle, eventDate, eventTime, eventDoors, venueName }) {
  if (!tickets?.length) return null;

  const qrBuffers = await Promise.all(
    tickets.map(t =>
      QRCode.toBuffer(t.id, { type: 'png', width: 200, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
    )
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [W, H],
      margin: 0,
      autoFirstPage: false,
      info: { Title: `Tickets — ${eventTitle || 'Event'}`, Author: 'C8Tickets' },
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];
      doc.addPage();

      // Background + top bar
      doc.rect(0, 0, W, H).fill(BG);
      doc.rect(0, 0, W, 6).fill(GOLD);

      // Venue name
      doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD)
        .text((venueName || 'CROOKED 8').toUpperCase(), MX, 16, { width: W - MX * 2, align: 'center', characterSpacing: 2 });

      // Event title
      doc.font('Helvetica-Bold').fontSize(14).fillColor(TEXT)
        .text(eventTitle || 'Event', MX, 30, { width: W - MX * 2, align: 'center', lineGap: 2 });

      let y = doc.y + 8;

      // Date · Time · Doors
      const dateLine = [eventDate, eventTime ? `· ${eventTime}` : '', eventDoors ? `· Doors ${eventDoors}` : ''].filter(Boolean).join(' ');
      if (dateLine) {
        doc.font('Helvetica').fontSize(8.5).fillColor(TEXT2)
          .text(dateLine, MX, y, { width: W - MX * 2, align: 'center' });
        y = doc.y + 8;
      }

      // Divider
      doc.moveTo(MX, y).lineTo(W - MX, y).lineWidth(0.5).stroke(DIVIDER);
      y += 12;

      // QR code in white box, centered
      const qrLeft = (W - QR_BOX) / 2;
      doc.roundedRect(qrLeft, y, QR_BOX, QR_BOX, 5).fill('#ffffff');
      doc.image(qrBuffers[i], qrLeft + QR_PAD, y + QR_PAD, { width: QR_SZ, height: QR_SZ });
      y += QR_BOX + 12;

      // Present at door
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GOLD)
        .text('PRESENT AT DOOR', MX, y, { width: W - MX * 2, align: 'center', characterSpacing: 2 });
      y = doc.y + 6;

      // Ticket type
      doc.font('Helvetica-Bold').fontSize(12).fillColor(TEXT)
        .text(t.ticket_type_name || 'General Admission', MX, y, { width: W - MX * 2, align: 'center' });
      y = doc.y + 5;

      // Ticket N of M
      doc.font('Helvetica').fontSize(8.5).fillColor(TEXT3)
        .text(`TICKET ${t.ticket_number} OF ${tickets.length}`, MX, y, { width: W - MX * 2, align: 'center', characterSpacing: 1 });
      y = doc.y + 10;

      // Divider
      doc.moveTo(MX, y).lineTo(W - MX, y).lineWidth(0.5).stroke(DIVIDER);
      y += 10;

      // Buyer name
      doc.font('Helvetica').fontSize(8.5).fillColor(TEXT2)
        .text(order.buyer_name || '', MX, y, { width: W - MX * 2, align: 'center' });
      y = doc.y + 5;

      // Ticket UUID
      doc.font('Helvetica').fontSize(6).fillColor(DIM)
        .text(t.id.toUpperCase(), MX, y, { width: W - MX * 2, align: 'center', characterSpacing: 0.3 });

      // Footer branding + bottom bar
      doc.font('Helvetica').fontSize(7).fillColor(DIM)
        .text('c8tickets.com', MX, H - 22, { width: W - MX * 2, align: 'center' });
      doc.rect(0, H - 8, W, 8).fill(GOLD);
    }

    doc.end();
  });
}
