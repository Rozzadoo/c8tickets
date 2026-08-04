export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supaKey) {
    console.error('[api/gate-checkin] SUPABASE_SERVICE_ROLE_KEY missing — cannot bypass RLS');
    return res.status(500).json({ error: 'Server misconfigured: service key missing' });
  }

  // Require an authenticated Supabase session — prevents anyone with a ticket UUID from checking it in.
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const userRes = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authHeader },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });

  const { ticketId, orderId, groupTicketIds } = req.body || {};
  const headers = {
    apikey: supaKey,
    Authorization: `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  const now = new Date().toISOString();

  if (groupTicketIds && Array.isArray(groupTicketIds) && groupTicketIds.length > 0) {
    let checkedIn = 0;
    for (const tid of groupTicketIds) {
      const r = await fetch(
        `${supaUrl}/rest/v1/tickets?id=eq.${tid}&status=eq.valid`,
        { method: 'PATCH', headers, body: JSON.stringify({ status: 'checked_in', checked_in_at: now }) }
      );
      const d = await r.json();
      if (Array.isArray(d) && d.length > 0) checkedIn++;
    }
    if (orderId) {
      const remainingRes = await fetch(
        `${supaUrl}/rest/v1/tickets?order_id=eq.${orderId}&status=eq.valid&select=id&limit=1`,
        { headers }
      );
      const remaining = await remainingRes.json();
      if (Array.isArray(remaining) && remaining.length === 0) {
        await fetch(
          `${supaUrl}/rest/v1/orders?id=eq.${orderId}`,
          { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'checked_in' }) }
        );
      }
    }
    return res.status(200).json({ success: true, checkedIn });
  }

  if (ticketId) {
    const r = await fetch(
      `${supaUrl}/rest/v1/tickets?id=eq.${ticketId}&status=eq.valid`,
      { method: 'PATCH', headers, body: JSON.stringify({ status: 'checked_in', checked_in_at: now }) }
    );
    const d = await r.json();
    const didCheckin = Array.isArray(d) && d.length > 0;
    return res.status(200).json({ success: true, alreadyIn: !didCheckin });
  }

  if (orderId) {
    await fetch(
      `${supaUrl}/rest/v1/orders?id=eq.${orderId}`,
      { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'checked_in' }) }
    );
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Missing ticketId, groupTicketIds, or orderId' });
}
