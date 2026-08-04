// Lightweight check-in stats for the gate scanner — bypasses RLS.
// GET /api/gate-stats?eventId=<uuid>
// Returns { totalValid, totalCheckedIn, totalCancelled, byType: [{name, valid, checkedIn}] }
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supaKey) {
    console.error('[api/gate-stats] SUPABASE_SERVICE_ROLE_KEY missing');
    return res.status(500).json({ error: 'Server misconfigured: service key missing' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const userRes = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authHeader },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });

  const eventId = (req.query.eventId || '').trim();
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) return res.status(400).json({ error: 'eventId required' });

  const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };
  const ticketsRes = await fetch(
    `${supaUrl}/rest/v1/tickets?event_id=eq.${eventId}&select=ticket_type_name,status&limit=10000`,
    { headers }
  );
  const tickets = await ticketsRes.json();
  if (!Array.isArray(tickets)) return res.status(500).json({ error: 'Failed to load tickets' });

  const byTypeMap = {};
  let totalValid = 0, totalCheckedIn = 0, totalCancelled = 0;
  for (const t of tickets) {
    const name = t.ticket_type_name || '—';
    if (!byTypeMap[name]) byTypeMap[name] = { name, valid: 0, checkedIn: 0 };
    if (t.status === 'checked_in') { byTypeMap[name].checkedIn++; totalCheckedIn++; }
    else if (t.status === 'cancelled') { totalCancelled++; }
    else { byTypeMap[name].valid++; totalValid++; }
  }
  return res.status(200).json({
    totalValid, totalCheckedIn, totalCancelled,
    byType: Object.values(byTypeMap).sort((a, b) => (b.checkedIn + b.valid) - (a.checkedIn + a.valid)),
  });
}
