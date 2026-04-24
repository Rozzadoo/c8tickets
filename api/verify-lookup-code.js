import { createHmac } from 'crypto';

function makeCode(email, slot) {
  const buf = createHmac('sha256', process.env.LOOKUP_CODE_SECRET || 'dev-secret')
    .update(`${email}:${slot}`)
    .digest('hex');
  return String(parseInt(buf.slice(0, 8), 16) % 1000000).padStart(6, '0');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Missing fields' });

  const normalized = email.toLowerCase().trim();
  const slot = Math.floor(Date.now() / (1000 * 60 * 60));

  // Accept current hour and the previous hour to handle boundary edge cases
  const valid = makeCode(normalized, slot) === code || makeCode(normalized, slot - 1) === code;
  if (!valid) return res.status(401).json({ error: 'Invalid or expired code' });

  const tenantId = process.env.VITE_TENANT_ID || '2c3f53cf-929d-4484-a637-1bc31cccdbe1';
  const url = `${process.env.VITE_SUPABASE_URL}/rest/v1/orders?buyer_email=eq.${encodeURIComponent(normalized)}&tenant_id=eq.${tenantId}&select=*,order_items(*)&order=created_at.desc`;
  const supaRes = await fetch(url, {
    headers: {
      apikey: process.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
    },
  });
  const orders = await supaRes.json();
  return res.status(200).json({ orders: Array.isArray(orders) ? orders : [] });
}
