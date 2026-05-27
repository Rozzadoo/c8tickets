const TENANT_ID = '2c3f53cf-929d-4484-a637-1bc31cccdbe1';
const BASE = 'https://c8tickets.com';

export default async function handler(req, res) {
  let events = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(
      `${process.env.VITE_SUPABASE_URL}/rest/v1/events?tenant_id=eq.${TENANT_ID}&is_published=eq.true&select=id,updated_at&order=event_date.asc`,
      {
        headers: {
          apikey: process.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    const data = await resp.json();
    if (Array.isArray(data)) events = data;
  } catch (_) {}

  const urls = [
    url(BASE + '/', 'daily', '1.0'),
    url(BASE + '/sell', 'monthly', '0.9'),
    ...events.map(e => url(`${BASE}/e/${e.id}`, 'weekly', '0.8', e.updated_at?.slice(0, 10))),
  ];

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  res.status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`
  );
}

function url(loc, changefreq, priority, lastmod) {
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].filter(Boolean).join('\n');
}
