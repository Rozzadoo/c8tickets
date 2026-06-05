import forge from 'node-forge';
import JSZip from 'jszip';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const PASS_TYPE_ID = 'pass.com.c8tickets.ticket';

function fmtDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(str) {
  if (!str) return '';
  const [h, m] = str.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h % 12) || 12)}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { id } = req.query;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid order ID' });
  }

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };

  const [orderRes, eventsRes] = await Promise.all([
    fetch(`${supaUrl}/rest/v1/orders?id=eq.${id}&select=*,order_items(*)&limit=1`, { headers }),
    fetch(`${supaUrl}/rest/v1/events?select=id,title,event_date,doors_open,venue_name&limit=200`, { headers }),
  ]);

  const orders = await orderRes.json();
  const order = Array.isArray(orders) ? orders[0] : null;
  if (!order || order.status === 'cancelled') return res.status(404).json({ error: 'Order not found' });

  const events = await eventsRes.json();
  const ev = Array.isArray(events) ? events.find(e => e.id === order.event_id) : null;

  const items = (order.order_items || []).filter(i => !i.is_addon);
  const ticketSummary = items.map(i => `${i.quantity}× ${i.ticket_type_name}`).join(', ') || 'Ticket';

  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID,
    serialNumber: order.id,
    teamIdentifier: process.env.APPLE_TEAM_ID,
    organizationName: 'C8Tickets',
    description: ev?.title || 'Event Ticket',
    foregroundColor: 'rgb(240, 233, 218)',
    backgroundColor: 'rgb(22, 19, 16)',
    labelColor: 'rgb(200, 146, 42)',
    logoText: 'C8TICKETS',
    eventTicket: {
      primaryFields: [
        { key: 'event', label: 'EVENT', value: ev?.title || 'Event' }
      ],
      secondaryFields: [
        { key: 'date', label: 'DATE', value: fmtDate(ev?.event_date) },
        { key: 'doors', label: 'DOORS', value: fmtTime(ev?.doors_open) }
      ],
      auxiliaryFields: [
        { key: 'venue', label: 'VENUE', value: ev?.venue_name || 'Crooked 8' },
        { key: 'tickets', label: 'TICKETS', value: ticketSummary }
      ],
      backFields: [
        { key: 'orderId', label: 'ORDER ID', value: order.id.toUpperCase() },
        { key: 'buyer', label: 'PURCHASED BY', value: order.buyer_name || '' },
        { key: 'total', label: 'TOTAL PAID', value: `$${Number(order.total_amount).toFixed(2)}` },
        { key: 'refund', label: 'REFUND POLICY', value: 'All ticket sales are final and non-refundable unless the event is cancelled by the organizer. Questions? support@c8tickets.com' }
      ]
    },
    barcodes: [
      { message: order.id, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' }
    ]
  };

  // Load images
  const cwd = process.cwd();
  const icon    = readFileSync(join(cwd, 'public/pass-assets/icon.png'));
  const icon2x  = readFileSync(join(cwd, 'public/pass-assets/icon@2x.png'));
  const icon3x  = readFileSync(join(cwd, 'public/pass-assets/icon@3x.png'));
  const logo    = readFileSync(join(cwd, 'public/pass-assets/logo.png'));
  const logo2x  = readFileSync(join(cwd, 'public/pass-assets/logo@2x.png'));

  const passJsonBuf = Buffer.from(JSON.stringify(passJson));
  const files = new Map([
    ['pass.json',    passJsonBuf],
    ['icon.png',     icon],
    ['icon@2x.png',  icon2x],
    ['icon@3x.png',  icon3x],
    ['logo.png',     logo],
    ['logo@2x.png',  logo2x],
  ]);

  // Build manifest
  const manifest = {};
  for (const [name, data] of files) {
    manifest[name] = crypto.createHash('sha1').update(data).digest('hex');
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest));

  // Parse P12 → extract signer cert + key
  const p12Der = Buffer.from(process.env.PASS_CERTIFICATE_BASE64, 'base64');
  const wwdrDer = Buffer.from(process.env.PASS_WWDR_BASE64, 'base64');

  const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12Der.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, process.env.PASS_CERTIFICATE_PASSWORD);

  let signerCert = null, signerKey = null;
  for (const safeContents of p12.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) {
        signerKey = safeBag.key;
      } else if (safeBag.type === forge.pki.oids.certBag) {
        signerCert = safeBag.cert;
      }
    }
  }
  if (!signerCert || !signerKey) throw new Error('Could not extract cert/key from P12');

  const wwdrAsn1 = forge.asn1.fromDer(forge.util.createBuffer(wwdrDer.toString('binary')));
  const wwdrCert = forge.pki.certificateFromAsn1(wwdrAsn1);

  // PKCS7 detached signature over manifest.json
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifestBuf.toString('binary'));
  p7.addCertificate(wwdrCert);
  p7.addCertificate(signerCert);
  p7.addSigner({
    key: signerKey,
    certificate: signerCert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids['data'] },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() }
    ],
  });
  p7.sign({ detached: true });
  const signature = Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');

  // Build .pkpass ZIP (no compression — Apple requires STORE)
  const zip = new JSZip();
  for (const [name, data] of files) zip.file(name, data, { compression: 'STORE' });
  zip.file('manifest.json', manifestBuf, { compression: 'STORE' });
  zip.file('signature', signature, { compression: 'STORE' });

  const passBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });

  res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
  res.setHeader('Content-Disposition', `attachment; filename="ticket-${order.id.slice(0, 8)}.pkpass"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(passBuffer);
}
