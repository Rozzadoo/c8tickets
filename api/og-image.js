import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const e = (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children.length ? children : undefined } });

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  let event = null;
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    try {
      const url = `${process.env.VITE_SUPABASE_URL}/rest/v1/events?id=eq.${id}&select=title,event_date,image_url&limit=1`;
      const resp = await fetch(url, {
        headers: {
          apikey: process.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
        },
      });
      const rows = await resp.json();
      event = rows?.[0] ?? null;
    } catch (_) {}
  }

  const title = event?.title ?? null;
  const imageUrl = event?.image_url ?? null;
  const date = event?.event_date
    ? new Date(event.event_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  // Event-specific card with photo
  if (event && imageUrl) {
    const titleFontSize = title && title.length > 30 ? 52 : title && title.length > 20 ? 62 : 72;
    return new ImageResponse(
      e('div', {
        style: { height: '100%', width: '100%', display: 'flex', position: 'relative', background: '#0c0a07' },
      },
        // Event photo (right portion bleeds through gradient)
        e('img', {
          src: imageUrl,
          style: { position: 'absolute', top: 0, right: 0, width: '60%', height: '100%', objectFit: 'cover', objectPosition: 'center' },
        }),
        // Gradient overlay: dark left → fades to let photo show right
        e('div', {
          style: { position: 'absolute', inset: 0, background: 'linear-gradient(to right, #0c0a07 42%, rgba(12,10,7,0.88) 62%, rgba(12,10,7,0.35) 100%)' },
        }),
        // Gold top bar
        e('div', {
          style: { position: 'absolute', top: 0, left: 0, right: 0, height: 6, background: 'linear-gradient(90deg, #8b6914, #c8922a, #e5a83a, #c8922a, #8b6914)' },
        }),
        // Text content
        e('div', {
          style: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '52px 64px', height: '100%', width: '60%' },
        },
          // Brand
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
            e('div', { style: { fontSize: 20, fontWeight: 900, color: '#c8922a', letterSpacing: 3, textTransform: 'uppercase', fontFamily: 'sans-serif' } }, 'Crooked 8'),
            e('div', { style: { width: 1, height: 16, background: '#c8922a', opacity: 0.5 } }),
            e('div', { style: { fontSize: 14, color: '#7a6c54', letterSpacing: 2, textTransform: 'uppercase', fontFamily: 'sans-serif' } }, 'Kuna, Idaho'),
          ),
          // Event title + date
          e('div', { style: { display: 'flex', flexDirection: 'column' } },
            e('div', { style: { width: 40, height: 3, background: '#c8922a', marginBottom: 20 } }),
            e('div', { style: { fontSize: titleFontSize, fontWeight: 900, color: '#f0e9da', lineHeight: 1.08, letterSpacing: -1, fontFamily: 'sans-serif', textTransform: 'uppercase' } }, title),
            date && e('div', { style: { marginTop: 18, fontSize: 22, color: '#c8922a', fontFamily: 'sans-serif', fontWeight: 600, letterSpacing: 0.5 } }, date),
            e('div', { style: { marginTop: 8, fontSize: 16, color: '#7a6c54', fontFamily: 'sans-serif', letterSpacing: 0.5 } }, 'Crooked 8 · Kuna, ID'),
          ),
          // CTA
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 20 } },
            e('div', { style: { background: '#c8922a', color: '#0c0a07', fontFamily: 'sans-serif', fontSize: 18, fontWeight: 700, padding: '13px 30px', borderRadius: 6, letterSpacing: 1, textTransform: 'uppercase' } }, 'Buy Tickets →'),
            e('div', { style: { fontSize: 14, color: '#5e5040', fontFamily: 'sans-serif', letterSpacing: 1 } }, 'c8tickets.com'),
          ),
        ),
      ),
      { width: 1200, height: 630 }
    );
  }

  // Generic branding card — belt buckle logo centered on dark background
  const BASE_URL = process.env.VITE_APP_URL || 'https://c8tickets.com';
  return new ImageResponse(
    e('div', {
      style: { height: '100%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0c0a07', position: 'relative' },
    },
      e('div', { style: { position: 'absolute', top: 0, left: 0, right: 0, height: 6, background: 'linear-gradient(90deg, #8b6914, #c8922a, #e5a83a, #c8922a, #8b6914)' } }),
      e('img', {
        src: `${BASE_URL}/logo-full.png`,
        style: { width: 540, height: 407 },
      }),
      e('div', { style: { marginTop: 12, fontSize: 18, color: '#7a6c54', fontFamily: 'sans-serif', letterSpacing: 4, textTransform: 'uppercase' } }, 'c8tickets.com'),
      e('div', { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, transparent, #c8922a, transparent)' } }),
    ),
    { width: 1200, height: 630 }
  );
}
