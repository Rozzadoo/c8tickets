import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

export default function handler() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0c0a07',
          position: 'relative',
        }}
      >
        {/* Gold accent bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            background: 'linear-gradient(90deg, #8b6914, #c8922a, #e5a83a, #c8922a, #8b6914)',
          }}
        />
        {/* Subtle radial glow */}
        <div
          style={{
            position: 'absolute',
            top: '-20%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 800,
            height: 500,
            background: 'radial-gradient(ellipse, rgba(200,146,42,0.12) 0%, transparent 70%)',
            borderRadius: '50%',
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div
            style={{
              fontSize: 108,
              fontWeight: 900,
              color: '#c8922a',
              letterSpacing: '-3px',
              lineHeight: 1,
              marginBottom: 24,
              fontFamily: 'sans-serif',
            }}
          >
            C8Tickets
          </div>
          <div
            style={{
              fontSize: 28,
              color: '#b5a78a',
              letterSpacing: '6px',
              textTransform: 'uppercase',
              fontFamily: 'sans-serif',
              marginBottom: 12,
            }}
          >
            Local Events · Easy Tickets
          </div>
          <div
            style={{
              fontSize: 20,
              color: '#7a6c54',
              letterSpacing: '4px',
              textTransform: 'uppercase',
              fontFamily: 'sans-serif',
            }}
          >
            Kuna, Idaho
          </div>
        </div>

        {/* Bottom gold line */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 3,
            background: 'linear-gradient(90deg, transparent, #c8922a, transparent)',
          }}
        />
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
