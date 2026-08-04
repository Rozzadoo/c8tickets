import { Resend } from 'resend';

const supaUrl = () => process.env.VITE_SUPABASE_URL;
const supaHeaders = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
};

const promoLog = new Map();
function isRateLimited(key, maxPerHour) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const recent = (promoLog.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= maxPerHour) return true;
  promoLog.set(key, [...recent, now]);
  return false;
}

async function requireAdmin(req, res) {
  const token = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  const r = await fetch(`${supaUrl()}/auth/v1/user`, {
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

async function handleValidate(req, res) {
  const { code, eventId, tenantId } = req.body;
  if (!code || !tenantId) return res.status(400).json({ error: 'Missing fields' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
  if (isRateLimited(`promo:${ip}`, 20)) {
    return res.status(400).json({ error: 'Invalid promo code' });
  }

  const normalized = code.trim().toUpperCase();
  const filter = `code=eq.${encodeURIComponent(normalized)}&tenant_id=eq.${tenantId}&active=eq.true&select=*&limit=1`;
  const r = await fetch(`${supaUrl()}/rest/v1/promo_codes?${filter}`, { headers: supaHeaders() });
  const rows = await r.json();
  const promo = Array.isArray(rows) ? rows[0] : null;

  if (!promo) return res.status(404).json({ error: 'Invalid promo code' });
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This promo code has expired' });
  }
  if (promo.max_uses !== null && promo.uses_count >= promo.max_uses) {
    return res.status(400).json({ error: 'This promo code has reached its maximum uses' });
  }
  if (promo.event_id && eventId && promo.event_id !== eventId) {
    return res.status(400).json({ error: 'This promo code is not valid for this event' });
  }

  return res.status(200).json({
    valid: true,
    id: promo.id,
    discountType: promo.discount_type,
    discountValue: Number(promo.discount_value),
    description: promo.discount_type === 'percent'
      ? `${promo.discount_value}% off tickets`
      : `$${Number(promo.discount_value).toFixed(2)} off tickets`,
  });
}

async function handleRedeem(req, res) {
  const { code, tenantId } = req.body;
  if (!code || !tenantId) return res.status(200).json({ ok: true });

  const normalized = code.trim().toUpperCase();
  const r = await fetch(
    `${supaUrl()}/rest/v1/promo_codes?code=eq.${encodeURIComponent(normalized)}&tenant_id=eq.${tenantId}&active=eq.true&select=id&limit=1`,
    { headers: supaHeaders() }
  );
  const rows = await r.json();
  const promo = Array.isArray(rows) ? rows[0] : null;
  if (!promo) return res.status(200).json({ ok: true });

  // Atomic increment via RPC — avoids read-modify-write race condition
  await fetch(`${supaUrl()}/rest/v1/rpc/increment_promo_uses`, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify({ pid: promo.id }),
  });

  return res.status(200).json({ ok: true });
}

async function handleList(req, res) {
  const { tenantId } = req.body;
  if (!tenantId) return res.status(400).json({ error: 'Missing tenantId' });
  const r = await fetch(
    `${supaUrl()}/rest/v1/promo_codes?tenant_id=eq.${tenantId}&order=created_at.desc&select=*`,
    { headers: supaHeaders() }
  );
  const rows = await r.json();
  return res.status(200).json({ promos: Array.isArray(rows) ? rows : [] });
}

async function handleCreate(req, res) {
  const { tenantId, code, discountType, discountValue, maxUses, eventId, expiresAt } = req.body;
  if (!tenantId || !code || !discountType || !discountValue) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!['percent', 'flat'].includes(discountType)) {
    return res.status(400).json({ error: 'Invalid discount type' });
  }
  const val = Number(discountValue);
  if (isNaN(val) || val <= 0) return res.status(400).json({ error: 'Invalid discount value' });
  if (discountType === 'percent' && val > 100) return res.status(400).json({ error: 'Percent discount cannot exceed 100' });

  const payload = {
    tenant_id: tenantId,
    code: code.trim().toUpperCase(),
    discount_type: discountType,
    discount_value: val,
    max_uses: maxUses ? Number(maxUses) : null,
    event_id: eventId || null,
    expires_at: expiresAt || null,
    active: true,
  };

  const r = await fetch(`${supaUrl()}/rest/v1/promo_codes`, {
    method: 'POST',
    headers: { ...supaHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  const result = await r.json();
  if (!r.ok) {
    const msg = result?.message || result?.[0]?.message || 'Failed to create promo code';
    return res.status(400).json({ error: msg });
  }
  return res.status(200).json({ promo: Array.isArray(result) ? result[0] : result });
}

async function handleToggle(req, res) {
  const { id, active } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  await fetch(`${supaUrl()}/rest/v1/promo_codes?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...supaHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ active: !!active }),
  });
  return res.status(200).json({ ok: true });
}

async function handleDelete(req, res) {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  await fetch(`${supaUrl()}/rest/v1/promo_codes?id=eq.${id}`, {
    method: 'DELETE',
    headers: supaHeaders(),
  });
  return res.status(200).json({ ok: true });
}

async function requireSuperAdmin(req, res) {
  const token = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  const r = await fetch(`${supaUrl()}/auth/v1/user`, {
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  const user = await r.json();
  if (user?.app_metadata?.role === 'venue') { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

async function handleCreateVenueUser(req, res) {
  const { email, password, tenantId, tenantName, role } = req.body;
  if (!email || !password || !tenantId) return res.status(400).json({ error: 'Missing required fields' });
  const allowedRoles = ['venue', 'gate'];
  const assignedRole = allowedRoles.includes(role) ? role : 'venue';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' });

  const r = await fetch(`${supaUrl()}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: assignedRole, tenant_id: tenantId, tenant_name: tenantName || '' },
    }),
  });
  const data = await r.json();
  if (!r.ok) return res.status(400).json({ error: data.msg || data.message || 'Failed to create user' });
  return res.status(200).json({ success: true, userId: data.id });
}

async function handleListVenueUsers(req, res) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' });

  const r = await fetch(`${supaUrl()}/auth/v1/admin/users?per_page=100`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const data = await r.json();
  const all = Array.isArray(data) ? data : (data.users || []);
  const users = all.filter(u => u.app_metadata?.role === 'venue' || u.app_metadata?.role === 'gate');
  return res.status(200).json({ users });
}

async function handleDeleteVenueUser(req, res) {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' });

  const r = await fetch(`${supaUrl()}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) return res.status(400).json({ error: 'Failed to delete user' });
  return res.status(200).json({ success: true });
}

async function handleListVenues(req, res) {
  const r = await fetch(`${supaUrl()}/rest/v1/tenants?order=name.asc&select=*`, { headers: supaHeaders() });
  const rows = await r.json();
  return res.status(200).json({ venues: Array.isArray(rows) ? rows : [] });
}

async function handleCreateVenue(req, res) {
  const { name, address, contactPhone, contactEmail, website, ownerName, ownerPhone, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Venue name is required' });

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const payload = {
    name: name.trim(),
    slug,
    address: address || null,
    contact_phone: contactPhone || null,
    contact_email: contactEmail || null,
    website: website || null,
    owner_name: ownerName || null,
    owner_phone: ownerPhone || null,
    notes: notes || null,
    active: true,
  };

  const r = await fetch(`${supaUrl()}/rest/v1/tenants`, {
    method: 'POST',
    headers: { ...supaHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  const result = await r.json();
  if (!r.ok) {
    const msg = result?.message || result?.[0]?.message || 'Failed to create venue';
    return res.status(400).json({ error: msg });
  }
  return res.status(200).json({ venue: Array.isArray(result) ? result[0] : result });
}

async function handleUpdateVenue(req, res) {
  const { id, name, address, contactPhone, contactEmail, website, ownerName, ownerPhone, notes } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const payload = {};
  if (name !== undefined) { payload.name = name.trim(); payload.slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  if (address !== undefined) payload.address = address || null;
  if (contactPhone !== undefined) payload.contact_phone = contactPhone || null;
  if (contactEmail !== undefined) payload.contact_email = contactEmail || null;
  if (website !== undefined) payload.website = website || null;
  if (ownerName !== undefined) payload.owner_name = ownerName || null;
  if (ownerPhone !== undefined) payload.owner_phone = ownerPhone || null;
  if (notes !== undefined) payload.notes = notes || null;

  await fetch(`${supaUrl()}/rest/v1/tenants?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...supaHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  });
  return res.status(200).json({ ok: true });
}

async function handleToggleVenue(req, res) {
  const { id, active } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  await fetch(`${supaUrl()}/rest/v1/tenants?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...supaHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ active: !!active }),
  });
  return res.status(200).json({ ok: true });
}

async function handleUsage(req, res) {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const r = await fetch(
    `${supaUrl()}/rest/v1/orders?promo_code_id=eq.${id}&select=id,buyer_name,buyer_email,created_at,total_amount,status&order=created_at.desc`,
    { headers: supaHeaders() }
  );
  const rows = await r.json();
  return res.status(200).json({ orders: Array.isArray(rows) ? rows : [] });
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function handleWeeklyVenueReport() {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('Service key not configured');

  // Week boundaries in Mountain Time (UTC-7 MDT)
  // Cron fires Monday 4pm UTC = Monday 9am MDT
  const now = new Date();
  const thisMon = new Date(now);
  thisMon.setUTCHours(7, 0, 0, 0); // midnight MDT (UTC-7) = 7am UTC
  const weekEnd = new Date(thisMon);
  const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prevWeekEnd = weekStart;
  const prevWeekStart = new Date(prevWeekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  const fmtD = (d) => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const weekLabel = `${fmtD(weekStart)} – ${fmtD(new Date(weekEnd.getTime() - 1))}`;

  // Fetch all venue admin users
  const usersRes = await fetch(`${supaUrl()}/auth/v1/admin/users?per_page=100`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const usersData = await usersRes.json();
  const venueAdmins = (Array.isArray(usersData) ? usersData : (usersData.users || []))
    .filter(u => u.app_metadata?.role === 'venue');

  // Group by tenant_id
  const tenantMap = {};
  for (const u of venueAdmins) {
    const tid = u.app_metadata?.tenant_id;
    if (!tid) continue;
    if (!tenantMap[tid]) tenantMap[tid] = { users: [], name: u.app_metadata?.tenant_name || 'Your Venue' };
    tenantMap[tid].users.push(u);
  }

  let sent = 0;
  for (const [tenantId, { users, name: venueName }] of Object.entries(tenantMap)) {
    // Fetch this week's orders
    const [thisRes, prevRes, eventsRes] = await Promise.all([
      fetch(`${supaUrl()}/rest/v1/orders?tenant_id=eq.${tenantId}&status=neq.cancelled&created_at=gte.${weekStart.toISOString()}&created_at=lt.${weekEnd.toISOString()}&select=id,total_amount,ticket_subtotal,sales_tax,service_fees,processing_fee,event_id,order_items(quantity)`, { headers: supaHeaders() }),
      fetch(`${supaUrl()}/rest/v1/orders?tenant_id=eq.${tenantId}&status=neq.cancelled&created_at=gte.${prevWeekStart.toISOString()}&created_at=lt.${prevWeekEnd.toISOString()}&select=id,total_amount,ticket_subtotal,sales_tax,service_fees,processing_fee,order_items(quantity)`, { headers: supaHeaders() }),
      fetch(`${supaUrl()}/rest/v1/events?tenant_id=eq.${tenantId}&is_published=eq.true&select=id,title,event_date`, { headers: supaHeaders() }),
    ]);
    const [thisOrders, prevOrders, activeEvents] = await Promise.all([thisRes.json(), prevRes.json(), eventsRes.json()]);

    const toArr = (v) => Array.isArray(v) ? v : [];
    const thisOrd = toArr(thisOrders);
    const prevOrd = toArr(prevOrders);
    const events = toArr(activeEvents);

    if (thisOrd.length === 0) continue; // no activity this week — skip

    const calcStats = (orders) => {
      let revenue = 0, orderCount = orders.length, ticketCount = 0;
      for (const o of orders) {
        const sub = o.ticket_subtotal != null
          ? Number(o.ticket_subtotal)
          : Number(o.total_amount) - Number(o.sales_tax || 0) - Number(o.service_fees || 0) - Number(o.processing_fee || 0);
        revenue += sub;
        ticketCount += (o.order_items || []).reduce((s, i) => s + Number(i.quantity), 0);
      }
      return { revenue, orderCount, ticketCount };
    };
    const thisStats = calcStats(thisOrd);
    const prevStats = calcStats(prevOrd);

    // Per-event breakdown
    const evMap = {};
    for (const o of thisOrd) {
      const ev = events.find(e => e.id === o.event_id);
      const key = o.event_id || 'other';
      if (!evMap[key]) evMap[key] = { title: ev?.title || 'Other', date: ev?.event_date || '', tickets: 0, revenue: 0 };
      const sub = o.ticket_subtotal != null
        ? Number(o.ticket_subtotal)
        : Number(o.total_amount) - Number(o.sales_tax || 0) - Number(o.service_fees || 0) - Number(o.processing_fee || 0);
      evMap[key].tickets += (o.order_items || []).reduce((s, i) => s + Number(i.quantity), 0);
      evMap[key].revenue += sub;
    }

    const pctChange = (curr, prev) => {
      if (prev === 0) return null;
      return Math.round(((curr - prev) / prev) * 100);
    };
    const pctLabel = (curr, prev) => {
      const p = pctChange(curr, prev);
      if (p === null) return '<span style="color:#7a6c54">—</span>';
      const color = p >= 0 ? '#4caf72' : '#e05252';
      const arrow = p >= 0 ? '▲' : '▼';
      return `<span style="color:${color}">${arrow} ${Math.abs(p)}% vs prior week</span>`;
    };

    const statCard = (label, value, pctHtml) => `
      <td style="width:33%;padding:0 6px;vertical-align:top">
        <div style="background:#1a1510;border:1px solid rgba(200,146,42,.12);border-radius:8px;padding:16px 12px;text-align:center">
          <div style="font-size:10px;color:#7a6c54;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">${label}</div>
          <div style="font-size:24px;font-weight:700;color:#f0e9da;margin-bottom:6px">${escHtml(String(value))}</div>
          <div style="font-size:11px;line-height:1.4">${pctHtml}</div>
        </div>
      </td>`;

    const evRows = Object.values(evMap).sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(ev => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #2f271c;color:#f0e9da;font-size:13px">${escHtml(ev.title)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #2f271c;color:#b5a78a;font-size:13px;text-align:center">${ev.tickets}</td>
        <td style="padding:10px 0;border-bottom:1px solid #2f271c;color:#c8922a;font-size:13px;text-align:right;font-weight:700">$${ev.revenue.toFixed(2)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0c0a07;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:540px;margin:0 auto;padding:40px 20px">
  <div style="text-align:center;margin-bottom:32px">
    <div style="font-size:22px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:3px">C8Tickets</div>
    <div style="font-size:11px;color:#7a6c54;text-transform:uppercase;letter-spacing:2px;margin-top:4px">Weekly Sales Report</div>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.2);border-radius:10px;padding:20px 24px;margin-bottom:20px">
    <div style="font-size:11px;color:#c8922a;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px">${escHtml(venueName)}</div>
    <div style="font-size:20px;font-weight:700;color:#f0e9da">${escHtml(weekLabel)}</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px"><tr>
    ${statCard('Total Revenue', `$${thisStats.revenue.toFixed(2)}`, pctLabel(thisStats.revenue, prevStats.revenue))}
    ${statCard('Orders', thisStats.orderCount, pctLabel(thisStats.orderCount, prevStats.orderCount))}
    ${statCard('Tickets Sold', thisStats.ticketCount, pctLabel(thisStats.ticketCount, prevStats.ticketCount))}
  </tr></table>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.15);border-radius:10px;padding:24px;margin-bottom:20px">
    <div style="font-size:11px;font-weight:700;color:#f0e9da;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">Event Breakdown</div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;padding-bottom:10px;border-bottom:1px solid #2f271c;font-size:10px;color:#7a6c54;text-transform:uppercase;letter-spacing:1px">Event</th>
        <th style="text-align:center;padding-bottom:10px;border-bottom:1px solid #2f271c;font-size:10px;color:#7a6c54;text-transform:uppercase;letter-spacing:1px">Tickets</th>
        <th style="text-align:right;padding-bottom:10px;border-bottom:1px solid #2f271c;font-size:10px;color:#7a6c54;text-transform:uppercase;letter-spacing:1px">Revenue</th>
      </tr></thead>
      <tbody>${evRows}</tbody>
    </table>
  </div>
  <div style="background:#161310;border:1px solid rgba(200,146,42,.08);border-radius:10px;padding:14px 18px;margin-bottom:20px">
    <div style="font-size:11px;color:#7a6c54;line-height:1.8;text-align:center">Revenue figures show ticket subtotal (before C8Tickets platform fee). Questions? <a href="mailto:support@c8tickets.com" style="color:#c8922a">support@c8tickets.com</a></div>
  </div>
  <div style="text-align:center;font-size:11px;color:#7a6c54;line-height:1.8">
    C8Tickets — <a href="https://c8tickets.com" style="color:#c8922a">c8tickets.com</a>
  </div>
</div>
</body></html>`;

    for (const user of users) {
      await resend.emails.send({
        from: 'C8Tickets <noreply@c8tickets.com>',
        to: user.email,
        subject: `Weekly Sales Report — ${venueName} — ${weekLabel}`,
        html,
      }).catch(e => console.error(`Weekly report error for ${user.email}:`, e.message));
      sent++;
    }
  }

  return { ok: true, sent };
}

export default async function handler(req, res) {
  // Vercel Cron: GET with Authorization: Bearer <CRON_SECRET>
  if (req.method === 'GET') {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const result = await handleWeeklyVenueReport();
      return res.status(200).json(result);
    } catch (err) {
      console.error('Weekly report cron error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { action } = req.body;

  if (action === 'validate') return handleValidate(req, res);
  if (action === 'redeem') return handleRedeem(req, res);

  // Admin-only actions
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  if (action === 'list') return handleList(req, res);
  if (action === 'create') return handleCreate(req, res);
  if (action === 'toggle') return handleToggle(req, res);
  if (action === 'delete') return handleDelete(req, res);
  if (action === 'usage') return handleUsage(req, res);

  // Super-admin-only actions (venue users blocked)
  const superOk = await requireSuperAdmin(req, res);
  if (!superOk) return;

  if (action === 'create_venue_user') return handleCreateVenueUser(req, res);
  if (action === 'list_venue_users') return handleListVenueUsers(req, res);
  if (action === 'delete_venue_user') return handleDeleteVenueUser(req, res);
  if (action === 'list_venues') return handleListVenues(req, res);
  if (action === 'create_venue') return handleCreateVenue(req, res);
  if (action === 'update_venue') return handleUpdateVenue(req, res);
  if (action === 'toggle_venue') return handleToggleVenue(req, res);

  return res.status(400).json({ error: 'Invalid action' });
}
