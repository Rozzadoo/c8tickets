export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;

  if (!serviceKey || !superAdminEmail) {
    return res.status(500).json({ error: 'Super-admin not configured' });
  }

  // Verify the JWT and confirm it belongs to the super-admin
  const userRes = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authHeader },
  });
  const userData = await userRes.json();
  if (!userRes.ok || userData.email !== superAdminEmail) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const { since, until } = req.query;
  const untilTs = until || new Date().toISOString();
  const dateFilter = since
    ? `&created_at=gte.${encodeURIComponent(since)}&created_at=lte.${encodeURIComponent(untilTs)}`
    : `&created_at=lte.${encodeURIComponent(untilTs)}`;

  const [tenantsRes, ordersRes, regsRes, posRes] = await Promise.all([
    fetch(`${supaUrl}/rest/v1/tenants?select=id,name,slug,active&order=name.asc`, { headers: h }),
    fetch(`${supaUrl}/rest/v1/orders?status=eq.confirmed&select=tenant_id,total_amount,ticket_subtotal,service_fees,processing_fee,sales_tax,created_at${dateFilter}&limit=5000`, { headers: h }),
    fetch(`${supaUrl}/rest/v1/registrations?status=eq.confirmed&select=tenant_id,amount_paid,created_at${dateFilter}&limit=5000`, { headers: h }),
    fetch(`${supaUrl}/rest/v1/pos_orders?status=eq.paid&select=tenant_id,total,payment_type,created_at${dateFilter}&limit=5000`, { headers: h }),
  ]);

  const [tenants, orders, registrations, posOrders] = await Promise.all([
    tenantsRes.json(), ordersRes.json(), regsRes.json(), posRes.json(),
  ]);

  if (!Array.isArray(tenants)) {
    return res.status(500).json({ error: 'Failed to load venue data' });
  }

  // Build per-venue aggregates
  const vm = {};
  for (const t of tenants) {
    vm[t.id] = { id: t.id, name: t.name, slug: t.slug, active: t.active, ticketRev: 0, serviceFees: 0, orders: 0, regRev: 0, posRev: 0 };
  }
  for (const o of (Array.isArray(orders) ? orders : [])) {
    if (!vm[o.tenant_id]) continue;
    // Use ticket_subtotal if stored; fall back to deriving it from total minus fees
    const ticketRev = o.ticket_subtotal != null
      ? parseFloat(o.ticket_subtotal)
      : parseFloat(o.total_amount || 0) - parseFloat(o.service_fees || 0) - parseFloat(o.processing_fee || 0) - parseFloat(o.sales_tax || 0);
    vm[o.tenant_id].ticketRev += ticketRev;
    vm[o.tenant_id].serviceFees += parseFloat(o.service_fees || 0);
    vm[o.tenant_id].orders++;
  }
  for (const r of (Array.isArray(registrations) ? registrations : [])) {
    if (!vm[r.tenant_id]) continue;
    vm[r.tenant_id].regRev += parseFloat(r.amount_paid || 0);
  }
  for (const p of (Array.isArray(posOrders) ? posOrders : [])) {
    if (!vm[p.tenant_id]) continue;
    vm[p.tenant_id].posRev += parseFloat(p.total || 0);
  }

  const venues = Object.values(vm)
    .map(v => ({ ...v, total: v.ticketRev + v.regRev + v.posRev }))
    .sort((a, b) => b.total - a.total);

  const totalTicketRev = venues.reduce((s, v) => s + v.ticketRev, 0);
  const totalServiceFees = venues.reduce((s, v) => s + v.serviceFees, 0);
  const totalRegRev = venues.reduce((s, v) => s + v.regRev, 0);
  const totalPosRev = venues.reduce((s, v) => s + v.posRev, 0);

  // Cross-venue activity feed (most recent 25)
  const activity = [
    ...(Array.isArray(orders) ? orders : []).map(o => ({ type: 'ticket', tenant_id: o.tenant_id, amount: parseFloat(o.total_amount || 0), created_at: o.created_at })),
    ...(Array.isArray(registrations) ? registrations : []).map(r => ({ type: 'reg', tenant_id: r.tenant_id, amount: parseFloat(r.amount_paid || 0), created_at: r.created_at })),
    ...(Array.isArray(posOrders) ? posOrders : []).map(p => ({ type: 'pos', tenant_id: p.tenant_id, amount: parseFloat(p.total || 0), created_at: p.created_at })),
  ]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 25)
    .map(a => ({ ...a, venueName: vm[a.tenant_id]?.name || 'Unknown' }));

  return res.status(200).json({
    venues,
    summary: {
      totalRev: totalTicketRev + totalRegRev + totalPosRev,
      totalTicketRev,
      totalRegRev,
      totalPosRev,
      totalServiceFees,
      totalOrders: venues.reduce((s, v) => s + v.orders, 0),
      activeVenues: venues.filter(v => v.active).length,
      totalVenues: tenants.length,
    },
    activity,
  });
}
