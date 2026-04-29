import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const e = (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children.length ? children : undefined } });

export default function handler() {
  return new ImageResponse(
    e('div', {
      style: {
        height: '100%', width: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#0c0a07', position: 'relative',
      },
    },
      e('div', {
        style: {
          position: 'absolute', top: 0, left: 0, right: 0, height: 6,
          background: 'linear-gradient(90deg, #8b6914, #c8922a, #e5a83a, #c8922a, #8b6914)',
        },
      }),
      e('div', {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
      },
        e('div', {
          style: {
            fontSize: 108, fontWeight: 900, color: '#c8922a',
            letterSpacing: '-3px', lineHeight: 1, marginBottom: 24,
            fontFamily: 'sans-serif',
          },
        }, 'C8Tickets'),
        e('div', {
          style: {
            fontSize: 28, color: '#b5a78a', letterSpacing: '6px',
            textTransform: 'uppercase', fontFamily: 'sans-serif', marginBottom: 12,
          },
        }, 'Local Events · Easy Tickets'),
        e('div', {
          style: {
            fontSize: 20, color: '#7a6c54', letterSpacing: '4px',
            textTransform: 'uppercase', fontFamily: 'sans-serif',
          },
        }, 'Kuna, Idaho'),
      ),
      e('div', {
        style: {
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
          background: 'linear-gradient(90deg, transparent, #c8922a, transparent)',
        },
      }),
    ),
    { width: 1200, height: 630 }
  );
}
