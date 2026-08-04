export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const id = req.query.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid order ID' });
  }

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaKey) {
    console.error('[api/get-order] SUPABASE_SERVICE_ROLE_KEY missing — cannot bypass RLS');
    return res.status(500).json({ error: 'Server misconfigured: service key missing' });
  }
  const headers = {
    apikey: supaKey,
    Authorization: `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
  };

  // Check whether the caller is an authenticated admin — if so, return full PII
  const bearerToken = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  let isAdmin = false;
  if (bearerToken) {
    const userRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${bearerToken}` },
    });
    if (userRes.ok) isAdmin = true;
  }

  let scannedTicketId = null;

  const orderRes = await fetch(
    `${supaUrl}/rest/v1/orders?id=eq.${id}&select=*,order_items(*)&limit=1`,
    { headers }
  );
  const orders = await orderRes.json();
  let order = Array.isArray(orders) ? orders[0] : null;

  // If not found as an order ID, try looking up as an individual ticket ID
  if (!order) {
    const ticketLookupRes = await fetch(
      `${supaUrl}/rest/v1/tickets?id=eq.${id}&select=*&limit=1`,
      { headers }
    );
    const ticketLookupData = await ticketLookupRes.json();
    const matchedTicket = Array.isArray(ticketLookupData) ? ticketLookupData[0] : null;
    if (matchedTicket) {
      const orderByTicketRes = await fetch(
        `${supaUrl}/rest/v1/orders?id=eq.${matchedTicket.order_id}&select=*,order_items(*)&limit=1`,
        { headers }
      );
      const orderByTicketData = await orderByTicketRes.json();
      order = Array.isArray(orderByTicketData) ? orderByTicketData[0] : null;
      if (order) scannedTicketId = id;
    }
  }

  if (!order) return res.status(404).json({ error: 'Order not found' });

  let ticketsRes = await fetch(
    `${supaUrl}/rest/v1/tickets?order_id=eq.${order.id}&order=ticket_number.asc`,
    { headers }
  );
  let tickets = await ticketsRes.json();
  if (!Array.isArray(tickets)) tickets = [];

  // Lazy-generate individual tickets for orders created before the tickets table existed
  if (tickets.length === 0 && order.status !== 'cancelled') {
    const rows = [];
    let num = 1;
    for (const item of order.order_items || []) {
      for (let i = 0; i < item.quantity; i++) {
        rows.push({
          order_id: order.id,
          ticket_type_name: item.ticket_type_name,
          ticket_number: num++,
          event_id: order.event_id,
          tenant_id: order.tenant_id,
          status: order.status === 'checked_in' ? 'checked_in' : 'valid',
        });
      }
    }
    if (rows.length > 0) {
      const insertRes = await fetch(`${supaUrl}/rest/v1/tickets`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(rows),
      });
      const inserted = await insertRes.json();
      tickets = Array.isArray(inserted) ? inserted : [];
    }
  }

  if (!isAdmin) {
    delete order.buyer_email;
    delete order.buyer_phone;
  }

  return res.status(200).json({ order, tickets, ...(scannedTicketId ? { scannedTicketId } : {}) });
}
