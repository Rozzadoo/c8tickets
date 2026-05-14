const supaUrl = () => process.env.VITE_SUPABASE_URL;
const supaHeaders = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
};

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
    `${supaUrl()}/rest/v1/promo_codes?code=eq.${encodeURIComponent(normalized)}&tenant_id=eq.${tenantId}&active=eq.true&select=id,uses_count&limit=1`,
    { headers: supaHeaders() }
  );
  const rows = await r.json();
  const promo = Array.isArray(rows) ? rows[0] : null;
  if (!promo) return res.status(200).json({ ok: true });

  await fetch(`${supaUrl()}/rest/v1/promo_codes?id=eq.${promo.id}`, {
    method: 'PATCH',
    headers: { ...supaHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ uses_count: promo.uses_count + 1 }),
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
  if (user?.user_metadata?.role === 'venue') { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

async function handleCreateVenueUser(req, res) {
  const { email, password, tenantId, tenantName } = req.body;
  if (!email || !password || !tenantId) return res.status(400).json({ error: 'Missing required fields' });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' });

  const r = await fetch(`${supaUrl()}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'venue', tenant_id: tenantId, tenant_name: tenantName || '' },
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
  const users = all.filter(u => u.user_metadata?.role === 'venue' || u.user_metadata?.role === 'gate');
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

export default async function handler(req, res) {
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

  return res.status(400).json({ error: 'Invalid action' });
}
