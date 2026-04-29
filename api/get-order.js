export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const id = req.query.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid order ID' });
  }

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.VITE_SUPABASE_ANON_KEY;
  const headers = {
    apikey: supaKey,
    Authorization: `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
  };

  const orderRes = await fetch(
    `${supaUrl}/rest/v1/orders?id=eq.${id}&select=*,order_items(*)&limit=1`,
    { headers }
  );
  const orders = await orderRes.json();
  const order = Array.isArray(orders) ? orders[0] : null;
  if (!order) return res.status(404).json({ error: 'Order not found' });

  let ticketsRes = await fetch(
    `${supaUrl}/rest/v1/tickets?order_id=eq.${id}&order=ticket_number.asc`,
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
          status: 'valid',
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

  return res.status(200).json({ order, tickets });
}
