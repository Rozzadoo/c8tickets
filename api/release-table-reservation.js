// Customer-facing endpoint to release held seats before the 10-min timer expires.
// POST body: { reservationToken }
// Only clears seats matching the token that are still held (not sold, not expired).
// Safe if token is stale — returns released=0 without error.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaKey) {
    console.error('[api/release-table-reservation] SUPABASE_SERVICE_ROLE_KEY missing');
    return res.status(500).json({ error: 'Server misconfigured: service key missing' });
  }

  const { reservationToken } = req.body || {};
  if (!reservationToken || typeof reservationToken !== 'string' || reservationToken.length > 128) {
    return res.status(400).json({ error: 'Invalid reservationToken' });
  }

  const nowIso = new Date().toISOString();
  const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' };
  const patchRes = await fetch(
    `${supaUrl}/rest/v1/table_seats?reservation_token=eq.${encodeURIComponent(reservationToken)}&order_id=is.null&reserved_until=gt.${encodeURIComponent(nowIso)}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ reservation_token: null, reserved_until: null }),
    }
  );

  if (!patchRes.ok) {
    const detail = await patchRes.text();
    console.error('[api/release-table-reservation] PATCH failed', patchRes.status, detail);
    return res.status(500).json({ error: 'Release failed' });
  }

  const rows = await patchRes.json();
  return res.status(200).json({ released: Array.isArray(rows) ? rows.length : 0 });
}
