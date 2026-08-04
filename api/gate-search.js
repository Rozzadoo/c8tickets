// Server-side order search for gate staff — bypasses RLS (gate role can't SELECT orders directly).
// GET /api/gate-search?q=<name-or-email>&eventId=<optional>
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supaKey) {
    console.error('[api/gate-search] SUPABASE_SERVICE_ROLE_KEY missing');
    return res.status(500).json({ error: 'Server misconfigured: service key missing' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const userRes = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authHeader },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });

  const q = (req.query.q || '').trim();
  const eventId = (req.query.eventId || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Query must be 2+ characters' });

  // Restrict search to the caller's tenant
  const user = await userRes.json();
  const userId = user?.id;
  const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };

  const tuRes = await fetch(
    `${supaUrl}/rest/v1/tenant_users?user_id=eq.${userId}&select=tenant_id&limit=1`,
    { headers }
  );
  const tu = await tuRes.json();
  const tenantId = Array.isArray(tu) && tu[0]?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'No tenant assignment' });

  const esc = encodeURIComponent(`*${q}*`);
  const filter = `tenant_id=eq.${tenantId}&status=neq.cancelled&or=(buyer_name.ilike.${esc},buyer_email.ilike.${esc})`;
  const eventFilter = eventId ? `&event_id=eq.${eventId}` : '';
  const ordersRes = await fetch(
    `${supaUrl}/rest/v1/orders?${filter}${eventFilter}&select=id,buyer_name,buyer_email,event_id,status,created_at&order=created_at.desc&limit=25`,
    { headers }
  );
  const orders = await ordersRes.json();
  if (!Array.isArray(orders)) return res.status(500).json({ error: 'Search failed' });
  if (orders.length === 0) return res.status(200).json({ orders: [] });

  const orderIds = orders.map(o => o.id);
  const idList = orderIds.map(id => `"${id}"`).join(',');
  const ticketsRes = await fetch(
    `${supaUrl}/rest/v1/tickets?order_id=in.(${idList})&select=id,order_id,ticket_type_name,status,checked_in_at,ticket_number&order=ticket_number.asc`,
    { headers }
  );
  const tickets = await ticketsRes.json();
  const ticketsByOrder = {};
  if (Array.isArray(tickets)) {
    for (const t of tickets) {
      (ticketsByOrder[t.order_id] ||= []).push(t);
    }
  }

  const results = orders.map(o => {
    const ts = ticketsByOrder[o.id] || [];
    return {
      id: o.id,
      buyer_name: o.buyer_name,
      buyer_email: o.buyer_email,
      event_id: o.event_id,
      status: o.status,
      created_at: o.created_at,
      tickets: ts,
      ticketsTotal: ts.length,
      ticketsCheckedIn: ts.filter(t => t.status === 'checked_in').length,
    };
  });

  return res.status(200).json({ orders: results });
}
