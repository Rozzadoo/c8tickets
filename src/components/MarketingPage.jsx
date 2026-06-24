import { useState } from 'react';

const LOGO = '/logo-full.png';

const FEATURES = [
  {
    icon: '🎫',
    title: 'Event Ticketing',
    desc: 'Sell tickets online with Stripe-powered payments, QR-code confirmation emails, real-time inventory, and door-side check-in scanning.',
    bullets: ['Online sales + door sales', 'QR code tickets via email', 'Live check-in dashboard', 'Promo codes & discounts'],
  },
  {
    icon: '📋',
    title: 'Registration Forms',
    desc: 'Run leagues, tournaments, classes, and signups with flexible per-person or per-team registration forms and automatic waitlists.',
    bullets: ['Custom capacity & waitlists', 'Per-person or per-team', 'Payment collection built in', 'CSV export anytime'],
  },
  {
    icon: '🛒',
    title: 'Point of Sale',
    desc: 'Sell food, drinks, and merch at your venue with a tablet-friendly POS terminal, Stripe card reader support, and cash drawer tracking.',
    bullets: ['Stripe Terminal card reader', 'Cash & card payments', 'Shift & drawer management', 'Works offline'],
  },
];

const STEPS = [
  { n: '1', title: 'We set you up', desc: 'We configure your venue, events, and pricing. You\'re live in under a day.' },
  { n: '2', title: 'Sell everywhere', desc: 'Customers buy tickets online. Staff sell at the door. POS handles the bar.' },
  { n: '3', title: 'You get paid', desc: 'Revenue goes directly to your Stripe account. No monthly minimums.' },
];

export default function MarketingPage() {
  const [contactSent, setContactSent] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', venue: '', message: '' });
  const [sending, setSending] = useState(false);

  async function handleContact(e) {
    e.preventDefault();
    setSending(true);
    try {
      await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    } catch (_) { /* best-effort */ }
    setSending(false);
    setContactSent(true);
  }

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: '#0c0a07', color: '#e8e0d0', minHeight: '100vh' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .mkt-btn { display:inline-block; padding:14px 28px; border-radius:8px; font-weight:700; font-size:15px; cursor:pointer; border:none; text-decoration:none; transition:opacity .15s; }
        .mkt-btn:hover { opacity:.85; }
        .mkt-btn-gold { background:#c8922a; color:#0c0a07; }
        .mkt-btn-outline { background:transparent; color:#e8e0d0; border:2px solid rgba(232,224,208,.25); }
        .mkt-fi { width:100%; padding:12px 14px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); border-radius:8px; color:#e8e0d0; font-size:15px; outline:none; margin-bottom:12px; }
        .mkt-fi:focus { border-color:#c8922a; }
        .mkt-fi::placeholder { color:rgba(232,224,208,.35); }
        .mkt-ta { resize:vertical; min-height:100px; }
        section { padding:72px 24px; max-width:1080px; margin:0 auto; }
        @media(max-width:700px){ section{padding:48px 20px;} }
      `}</style>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,.07)', padding: '0 24px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <img src={LOGO} alt="C8 Tickets" style={{ height: 32, objectFit: 'contain' }} />
          <a href="mailto:hello@c8tickets.com" className="mkt-btn mkt-btn-gold" style={{ padding: '8px 20px', fontSize: 13 }}>Get in Touch</a>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '96px 24px 80px' }}>
        <div style={{ display: 'inline-block', background: 'rgba(200,146,42,.12)', color: '#c8922a', borderRadius: 20, padding: '4px 14px', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 24 }}>
          Venue Management Platform
        </div>
        <h1 style={{ fontSize: 'clamp(36px,7vw,68px)', fontWeight: 800, lineHeight: 1.1, marginBottom: 24, letterSpacing: -1 }}>
          Everything your venue<br />
          <span style={{ color: '#c8922a' }}>needs to run</span>
        </h1>
        <p style={{ fontSize: 'clamp(16px,2vw,20px)', color: 'rgba(232,224,208,.65)', maxWidth: 560, margin: '0 auto 40px', lineHeight: 1.6 }}>
          Ticket sales, event registrations, and point-of-sale — all in one platform built for bars, venues, and event spaces.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="#contact" className="mkt-btn mkt-btn-gold">Get Started</a>
          <a href="#features" className="mkt-btn mkt-btn-outline">See Features</a>
        </div>
      </section>

      {/* Features */}
      <section id="features">
        <h2 style={{ fontSize: 32, fontWeight: 800, textAlign: 'center', marginBottom: 48, letterSpacing: -0.5 }}>Three products. One platform.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 24 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 16, padding: 28 }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>{f.icon}</div>
              <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{f.title}</h3>
              <p style={{ fontSize: 14, color: 'rgba(232,224,208,.6)', lineHeight: 1.6, marginBottom: 20 }}>{f.desc}</p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {f.bullets.map(b => (
                  <li key={b} style={{ fontSize: 13, color: 'rgba(232,224,208,.8)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#c8922a', fontWeight: 700 }}>✓</span> {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section style={{ background: 'rgba(255,255,255,.02)', borderTop: '1px solid rgba(255,255,255,.06)', borderBottom: '1px solid rgba(255,255,255,.06)', maxWidth: '100%', padding: '72px 24px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <h2 style={{ fontSize: 32, fontWeight: 800, textAlign: 'center', marginBottom: 48, letterSpacing: -0.5 }}>Up and running fast</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 32 }}>
            {STEPS.map(s => (
              <div key={s.n} style={{ textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#c8922a', color: '#0c0a07', fontWeight: 800, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>{s.n}</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{s.title}</h3>
                <p style={{ fontSize: 14, color: 'rgba(232,224,208,.6)', lineHeight: 1.6 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" style={{ maxWidth: 600, margin: '0 auto' }}>
        <h2 style={{ fontSize: 32, fontWeight: 800, textAlign: 'center', marginBottom: 12, letterSpacing: -0.5 }}>Let's talk</h2>
        <p style={{ textAlign: 'center', color: 'rgba(232,224,208,.55)', marginBottom: 40, fontSize: 15, lineHeight: 1.6 }}>
          Tell us about your venue. We'll get you set up and selling within 24 hours.
        </p>
        {contactSent ? (
          <div style={{ textAlign: 'center', padding: 40, background: 'rgba(93,138,60,.1)', border: '1px solid rgba(93,138,60,.25)', borderRadius: 16 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>✓</div>
            <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>We'll be in touch!</h3>
            <p style={{ color: 'rgba(232,224,208,.6)', fontSize: 14 }}>Expect a reply within one business day.</p>
          </div>
        ) : (
          <form onSubmit={handleContact} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 16, padding: 32 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 0 }}>
              <input className="mkt-fi" style={{ margin: 0 }} placeholder="Your name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              <input className="mkt-fi" type="email" style={{ margin: 0 }} placeholder="Email address" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div style={{ height: 12 }} />
            <input className="mkt-fi" placeholder="Venue name" value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} />
            <textarea className="mkt-fi mkt-ta" placeholder="Tell us about your venue and what you need…" value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} />
            <button type="submit" className="mkt-btn mkt-btn-gold" style={{ width: '100%' }} disabled={sending}>
              {sending ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        )}
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,.07)', padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <img src={LOGO} alt="C8 Tickets" style={{ height: 24, objectFit: 'contain', opacity: 0.6 }} />
          <p style={{ fontSize: 12, color: 'rgba(232,224,208,.35)' }}>© {new Date().getFullYear()} C8 Tickets. All rights reserved.</p>
          <a href="mailto:hello@c8tickets.com" style={{ fontSize: 12, color: 'rgba(232,224,208,.4)', textDecoration: 'none' }}>hello@c8tickets.com</a>
        </div>
      </footer>
    </div>
  );
}
