const BOT_RE = /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|twitterbot|linkedinbot|whatsapp|slackbot|telegrambot|applebot|rogerbot|semrushbot|ahrefsbot|mj12bot/i;

export default async function handler(req, res) {
  const id = req.query.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.redirect(302, '/');
  }

  let event = null;
  try {
    const url = `${process.env.VITE_SUPABASE_URL}/rest/v1/events?id=eq.${id}&select=title,description,category,event_date,image_url,ticket_types(name,price,quantity_total,quantity_sold)&limit=1`;
    const resp = await fetch(url, {
      headers: {
        apikey: process.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
      },
    });
    const rows = await resp.json();
    event = rows?.[0] ?? null;
  } catch (_) {}

  if (!event) return res.redirect(302, '/');

  const isBot = BOT_RE.test(req.headers['user-agent'] || '');
  const title = event.title ?? 'Event';
  const description = event.description ? event.description.slice(0, 200) : 'Buy tickets at C8Tickets';
  const image = `https://c8tickets.com/api/og-image?id=${id}`;
  const canonical = `https://c8tickets.com/e/${id}`;
  const dest = `/?event=${id}`;

  const date = event.event_date
    ? new Date(event.event_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  const metaDescription = date
    ? `${date} at Crooked 8 in Kuna, ID. ${description}`
    : description;

  const tickets = Array.isArray(event.ticket_types) ? event.ticket_types : [];
  const offers = tickets.map(t => ({
    '@type': 'Offer',
    name: t.name,
    price: Number(t.price).toFixed(2),
    priceCurrency: 'USD',
    availability: (t.quantity_total - t.quantity_sold) > 0
      ? 'https://schema.org/InStock'
      : 'https://schema.org/SoldOut',
    url: canonical,
    seller: { '@type': 'Organization', name: 'C8Tickets' },
  }));

  const isMusic = event.category === 'Live Music';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: title,
    description,
    startDate: event.event_date,
    image,
    url: canonical,
    location: {
      '@type': 'Place',
      name: 'Crooked 8',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '1882 E King Rd',
        addressLocality: 'Kuna',
        addressRegion: 'ID',
        postalCode: '83634',
        addressCountry: 'US',
      },
    },
    organizer: {
      '@type': 'Organization',
      name: 'C8Tickets',
      url: 'https://c8tickets.com',
    },
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(offers.length > 0 && { offers }),
    ...(isMusic && { performer: { '@type': 'MusicGroup', name: title } }),
  };

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(title)} — C8Tickets</title>
<meta name="description" content="${escHtml(metaDescription)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(date ? date + ' · ' + description : description)}">
<meta property="og:image" content="${escHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="C8Tickets">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(date ? date + ' · ' + description : description)}">
<meta name="twitter:image" content="${escHtml(image)}">
<link rel="canonical" href="${canonical}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
${isBot ? '' : `<meta http-equiv="refresh" content="0;url=${dest}">
<script>window.location.replace("${dest}");</script>`}
</head>
<body style="margin:0;background:#0c0a07;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#f0e9da">
<p>Redirecting to <a href="${dest}" style="color:#c8922a">${escHtml(title)}</a>…</p>
</body>
</html>`);
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
