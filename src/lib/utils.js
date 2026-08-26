export const DEFAULT_VENUE = {
  id: '2c3f53cf-929d-4484-a637-1bc31cccdbe1', name: "Crooked 8",
  tagline: "Local Events, Easy Tickets.",
  location: "1882 E King Rd, Kuna, ID 83634",
  phone: "(208) 991-0788",
};

export const TICKET_SIZES = [
  { id: 'strip',  label: 'Standard Strip',    sublabel: '5.5" × 2" — concert stub',        cols: 2, height: '2in',   photoW: '32%', fScale: 1.0 },
  { id: 'wide',   label: 'Wide Strip',         sublabel: '7" × 2.75" — standard ticket',    cols: 1, height: '2.75in',photoW: '33%', fScale: 1.2 },
  { id: 'half',   label: 'Half Page',          sublabel: '5.5" × 4.25" — premium ticket',   cols: 2, height: '3.8in', photoW: '36%', fScale: 1.6 },
  { id: 'full',   label: 'Full Page',          sublabel: '7.5" × 5" — collector\'s ticket', cols: 1, height: '4.8in', photoW: '42%', fScale: 2.0 },
  { id: 'custom', label: 'Custom',             sublabel: 'Enter your own dimensions',        cols: null, height: null, photoW: null, fScale: null },
];

export const resolveCustomSize = (w, h) => {
  const wn = Math.max(2, Math.min(8.5, parseFloat(w) || 5.5));
  const hn = Math.max(1, Math.min(10,  parseFloat(h) || 2));
  return { id: 'custom', label: 'Custom', sublabel: `${wn}" × ${hn}"`, cols: wn <= 4.0 ? 2 : 1, height: `${hn}in`, photoW: hn > 3 ? '38%' : '32%', fScale: Math.max(0.8, Math.min(2.5, hn / 2)) };
};

export const mapEvent = (e) => ({
  id: e.id,
  venueId: e.tenant_id,
  title: e.title,
  date: e.event_date.slice(0, 10),
  time: e.event_date.slice(11, 16),
  doors: e.doors_open ? e.doors_open.slice(11, 16) : "",
  description: e.description,
  image: e.image_url,
  focalX: e.focal_x ?? 50,
  focalY: e.focal_y ?? 50,
  published: e.is_published ?? true,
  category: e.category,
  tickets: (e.ticket_types || []).map(t => ({
    id: t.id,
    type: t.name,
    price: Number(t.price),
    doorPrice: t.door_price != null ? Number(t.door_price) : null,
    available: t.quantity_total - t.quantity_sold,
    total: t.quantity_total,
    sold: t.quantity_sold,
    physicalQty: t.physical_qty ?? 0,
  })),
  addons: e.addons || [],
  checkoutNotice: e.checkout_notice || '',
  checkoutNoticeRequired: e.checkout_notice_required || false,
});

export const mapVenue = (v) => ({
  id: v.id,
  name: v.name,
  slug: v.slug || v.id,
  tagline: "Local Events, Easy Tickets.",
  location: v.address || DEFAULT_VENUE.location,
  phone: v.contact_phone || '',
  email: v.contact_email || '',
  website: v.website || '',
  ownerName: v.owner_name || '',
  ownerPhone: v.owner_phone || '',
  notes: v.notes || '',
  active: v.active !== false,
});

export const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
export const fmtCurrency = (n) => n === 0 ? "FREE" : "$" + Number(n).toFixed(2);
export const fmtTime = (t) => t ? new Date('1970-01-01T' + t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

// Table seat items are stored one-per-seat with names like "Config Name — Table 3 Seat B".
// This regex + grouper collapses them into human-readable rows for display.
const TABLE_SEAT_RE = /^(.+?) — Table (\d+) Seat (\w+)$/;
export const summarizeOrderItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  const rows = [];
  const groups = new Map(); // key: `${configName}|${tableNumber}` -> {configName, tableNumber, seats:[], totalPrice}
  for (const it of items) {
    const match = TABLE_SEAT_RE.exec(String(it.type || ''));
    if (match) {
      const [, configName, tableNumberStr, seatLetter] = match;
      const key = `${configName}|${tableNumberStr}`;
      if (!groups.has(key)) groups.set(key, { configName, tableNumber: Number(tableNumberStr), seats: [], totalPrice: 0 });
      const g = groups.get(key);
      g.seats.push(seatLetter);
      g.totalPrice += Number(it.price || 0) * (it.qty || 1);
    } else {
      rows.push({ type: it.type, qty: it.qty, price: Number(it.price || 0), lineTotal: Number(it.price || 0) * (it.qty || 1) });
    }
  }
  for (const g of groups.values()) {
    g.seats.sort();
    rows.push({
      type: `${g.configName} — Table ${g.tableNumber} (${g.seats.length} seat${g.seats.length !== 1 ? 's' : ''})`,
      qty: g.seats.length,
      price: g.totalPrice / g.seats.length,
      lineTotal: g.totalPrice,
      isTableSeat: true,
      tableNumber: g.tableNumber,
      seatLetters: g.seats,
    });
  }
  return rows;
};

export const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// fetch with an AbortController timeout. Throws Error('timeout') if the request exceeds ms.
// Use for any staff-facing operation where a hang would cause a double-submit (payments, order saves).
export const fetchWithTimeout = async (url, options = {}, ms = 15000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('timeout');
    throw e;
  } finally {
    clearTimeout(t);
  }
};

export const exportOrdersCSV = (orders, events, filename = 'orders.csv') => {
  const headers = ['Order ID','Date','Buyer Name','Buyer Email','Buyer Phone','Event','Items','Subtotal','Total','Status','Source','Stripe PI'];
  const rows = orders.slice().reverse().map(o => {
    const ev = events.find(e => e.id === o.eventId);
    return [
      o.id,
      new Date(o.date).toLocaleString('en-US'),
      o.buyer?.name || '',
      o.buyer?.email || '',
      o.buyer?.phone || '',
      ev?.title || '',
      o.items.map(i => `${i.qty}x ${i.type}`).join('; '),
      Number(o.ticketSubtotal ?? o.total).toFixed(2),
      Number(o.total).toFixed(2),
      o.status,
      o.source || 'online',
      o.stripePaymentIntentId || '',
    ].map(csvCell).join(',');
  });
  const csv = [headers.map(csvCell).join(','), ...rows].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
    download: filename,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

export const buildGCalUrl = (ev, loc) => {
  const [y, m, d] = ev.date.split('-');
  const [h = '20', min = '00'] = (ev.time || '').split(':');
  const start = `${y}${m}${d}T${h}${min}00`;
  const end = `${y}${m}${d}T${String(Number(h) + 3).padStart(2,'0')}${min}00`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${start}/${end}&location=${encodeURIComponent(loc)}&ctz=America%2FBoise`;
};

export const downloadIcs = (ev, loc) => {
  const [y, m, d] = ev.date.split('-');
  const [h = '20', min = '00'] = (ev.time || '').split(':');
  const start = `${y}${m}${d}T${h}${min}00`;
  const end = `${y}${m}${d}T${String(Number(h) + 3).padStart(2,'0')}${min}00`;
  const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//C8Tickets//EN','BEGIN:VEVENT',
    `DTSTART;TZID=America/Boise:${start}`,`DTEND;TZID=America/Boise:${end}`,`SUMMARY:${ev.title}`,`LOCATION:${loc}`,
    `DESCRIPTION:C8Tickets — ${ev.title}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' })),
    download: `${ev.title.replace(/[^\w\s-]/g,'')}.ics`,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};
