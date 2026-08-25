// Customer-facing seat reservation endpoint.
// POST body: { tableConfigId, qty, specificTableNumber?, wholeTable? }
// Returns:   { seats: [{seatId, tableNumber, seatLetter}], reservedUntil, reservationToken }
// The DB function `reserve_table_seats` is atomic — concurrent buyers cannot double-book.

const reserveLog = new Map();
function isRateLimited(key, maxPerHour) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const recent = (reserveLog.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= maxPerHour) return true;
  reserveLog.set(key, [...recent, now]);
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaKey) {
    console.error('[api/reserve-table-seats] SUPABASE_SERVICE_ROLE_KEY missing');
    return res.status(500).json({ error: 'Server misconfigured: service key missing' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
  if (isRateLimited(`ip:${ip}`, 20)) {
    return res.status(429).json({ error: 'Too many reservation attempts. Please wait a moment and try again.' });
  }

  const { tableConfigId, qty, specificTableNumber, wholeTable } = req.body || {};
  if (!tableConfigId || !/^[0-9a-f-]{36}$/i.test(tableConfigId)) {
    return res.status(400).json({ error: 'Invalid tableConfigId' });
  }
  const qtyNum = Number(qty);
  if (!Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > 20) {
    return res.status(400).json({ error: 'qty must be an integer between 1 and 20' });
  }
  let specificTableNum = null;
  if (specificTableNumber != null && specificTableNumber !== '') {
    specificTableNum = Number(specificTableNumber);
    if (!Number.isInteger(specificTableNum) || specificTableNum < 1) {
      return res.status(400).json({ error: 'Invalid specificTableNumber' });
    }
  }

  const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' };
  const rpcRes = await fetch(`${supaUrl}/rest/v1/rpc/reserve_table_seats`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_table_config_id: tableConfigId,
      p_qty: qtyNum,
      p_specific_table_number: specificTableNum,
      p_whole_table: wholeTable === true,
      p_hold_minutes: 10,
    }),
  });

  if (!rpcRes.ok) {
    const detail = await rpcRes.text();
    console.error('[api/reserve-table-seats] RPC failed', rpcRes.status, detail);
    // Map common PostgreSQL RAISE EXCEPTION messages to friendly errors
    let friendly = 'Could not reserve seats. Please refresh and try again.';
    if (detail.includes('No fully-available tables')) friendly = 'No full tables are available. Try picking individual seats or fewer seats.';
    else if (detail.includes('is not fully available')) friendly = 'That table just got taken. Please pick another.';
    else if (detail.includes('Not enough available seats at table')) friendly = 'That table no longer has enough open seats. Please pick another.';
    else if (detail.includes('Not enough seats available anywhere')) friendly = 'Not enough seats available in this section right now.';
    else if (detail.includes('Seat contention')) friendly = 'Another buyer snapped up a seat. Please try again.';
    else if (detail.includes('Table config not found')) friendly = 'This table section is no longer available.';
    return res.status(409).json({ error: friendly });
  }

  const rows = await rpcRes.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(500).json({ error: 'Reservation returned no seats' });
  }

  return res.status(200).json({
    seats: rows.map(r => ({ seatId: r.seat_id, tableNumber: r.table_number, seatLetter: r.seat_letter })),
    reservedUntil: rows[0].reserved_until,
    reservationToken: rows[0].reservation_token,
  });
}
