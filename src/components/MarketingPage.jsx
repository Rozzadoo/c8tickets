import { useState, useEffect } from 'react';

const LOGO = '/logo-full.png';

const VENUE_TYPES = [
  { icon: '🍺', label: 'Bars & Taprooms' },
  { icon: '🎸', label: 'Concert Venues' },
  { icon: '🏆', label: 'Sports Leagues' },
  { icon: '🎪', label: 'Event Spaces' },
  { icon: '🎳', label: 'Bowling & Recreation' },
  { icon: '🏛️', label: 'Civic Organizations' },
  { icon: '🎭', label: 'Theaters' },
  { icon: '🍕', label: 'Restaurants & Breweries' },
];

const PRODUCTS = [
  {
    id: 'ticketing',
    icon: '🎫',
    title: 'Event Ticketing',
    tagline: 'Sell tickets online and at the door — without the big-platform fees.',
    desc: 'Set up an event in minutes. Customers buy online with instant QR-code confirmation emails. Staff scan tickets at the door from any phone or tablet. Watch check-ins happen in real time from the back office.',
    bullets: [
      'Online presale + door sales from one dashboard',
      'QR-code tickets delivered instantly by email',
      'Ticket scanning from any phone — no dedicated hardware',
      'Real-time inventory and check-in tracking',
      'Promo codes and percentage or flat-rate discounts',
      'Multiple ticket types per event (GA, VIP, early bird)',
      'Door price vs. presale price per ticket type',
      'CSV export for any event or date range',
    ],
  },
  {
    id: 'registration',
    icon: '📋',
    title: 'Registration Forms',
    tagline: 'Run structured sign-ups for leagues, tournaments, and community events.',
    desc: 'Build custom registration forms in minutes — per-person or per-team, paid or free. Set capacity limits, collect custom fields, and let the system handle waitlists automatically when spots fill up.',
    bullets: [
      'Individual or team-based registrations',
      'Custom fields: text, dropdowns, checkboxes, and more',
      'Automatic waitlist with promotion notifications',
      'Paid registrations via Stripe or free sign-ups',
      'Capacity management with fill-rate tracking',
      'Duplicate detection prevents double sign-ups',
      'Registrant management: search, filter, cancel, promote',
      'Full CSV export with all form responses',
    ],
  },
  {
    id: 'pos',
    icon: '🛒',
    title: 'Point of Sale',
    tagline: 'A tablet-friendly POS built for busy event nights and beer gardens.',
    desc: 'Manage your item catalog, ring up orders, and take card or cash payments — all from a tablet. Built-in shift management tracks your cash drawer from open to close. Keeps working even when your wifi doesn\'t.',
    bullets: [
      'Large-touch tablet interface optimized for speed',
      'Card payments via Stripe Terminal reader',
      'Cash payments with change calculation',
      'Item modifiers (sizes, add-ons, customizations)',
      'Shift management: opening cash, closing count, discrepancy report',
      'Offline mode — queues orders when wifi drops, syncs on reconnect',
      'Per-item tax rates and category organization',
      'Sales reports by item, category, and payment type',
    ],
  },
];

const STEPS = [
  { n: '1', title: 'Tell us about your venue', desc: 'Fill out the contact form. We\'ll reach out within one business day to learn about your events and what you need.' },
  { n: '2', title: 'We configure everything', desc: 'We set up your venue page, events, ticket types, and POS items. You\'re live and selling in under 24 hours.' },
  { n: '3', title: 'Sell and get paid', desc: 'Revenue from ticket and registration sales goes directly to your connected Stripe account. No waiting, no holding periods.' },
];

const FAQS = [
  {
    q: 'Do I need my own Stripe account?',
    a: 'Yes — payments go directly to your Stripe account, so you get paid instantly without any holding periods. If you don\'t already have one, it takes about five minutes to set up at stripe.com.',
  },
  {
    q: 'How long does it take to go live?',
    a: 'For most venues, under 24 hours. We handle the initial setup — you give us your event details, ticket types, and pricing and we take it from there.',
  },
  {
    q: 'Does the POS require special hardware?',
    a: 'The POS interface runs on any tablet or laptop. For card payments you\'ll need a Stripe Terminal reader (the Stripe Reader M2 is $59, the WisePOS E countertop unit is $249). Cash payments work without any additional hardware.',
  },
  {
    q: 'Can I use just one product, or do I need all three?',
    a: 'Use as much or as little as you need. Some venues just need event ticketing. Others add registration forms for leagues and tournaments. The POS is an add-on for venues that also want to manage bar or merch sales.',
  },
  {
    q: 'What does it cost?',
    a: 'We tailor pricing to your venue\'s size and which products you need. Reach out and we\'ll put together a proposal based on your specific situation.',
  },
  {
    q: 'Is there a contract or minimum commitment?',
    a: 'No long-term contracts. We believe if the platform is working for you, you\'ll stick around.',
  },
];

export default function MarketingPage() {
  const [contactSent, setContactSent] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', venue: '', message: '' });
  const [sending, setSending] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'C8 Tickets — Venue Management Platform | Ticketing, Registration & POS';

    const setMeta = (sel, attr, val) => {
      let el = document.querySelector(sel);
      if (!el) { el = document.createElement('meta'); document.head.appendChild(el); }
      el.setAttribute(attr, val);
    };
    const prevDesc = document.querySelector('meta[name="description"]')?.getAttribute('content');
    setMeta('meta[name="description"]', 'content', 'C8 Tickets is an all-in-one venue management platform for bars, venues, and event spaces. Sell tickets online, run registration forms, and manage bar sales — all in one place. Built for independent venues in Idaho and beyond.');
    setMeta('meta[property="og:title"]', 'content', 'C8 Tickets — Venue Management Platform');
    setMeta('meta[property="og:description"]', 'content', 'Ticketing, event registration, and point-of-sale for independent venues. Get set up and selling in under 24 hours.');
    setMeta('meta[property="og:url"]', 'content', 'https://platform.c8tickets.com');
    setMeta('meta[name="keywords"]', 'content', 'venue ticketing software, event ticketing platform, small venue ticketing, bar event ticketing, venue management software, event registration software, venue POS system, independent venue ticketing, Idaho event ticketing, Stripe terminal venue');

    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'mkt-ld';
    ld.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'C8 Tickets',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: 'https://platform.c8tickets.com',
      description: 'All-in-one venue management platform: event ticketing, registration forms, and point-of-sale for bars, venues, and event spaces.',
      offers: { '@type': 'Offer', availability: 'https://schema.org/InStock' },
      provider: { '@type': 'Organization', name: 'C8 Tickets', url: 'https://platform.c8tickets.com', email: 'hello@c8tickets.com' },
      featureList: ['Event Ticketing', 'Registration Forms', 'Point of Sale', 'QR Code Check-in', 'Stripe Payments', 'Offline Mode'],
    });
    document.head.appendChild(ld);

    return () => {
      document.title = prevTitle;
      if (prevDesc) setMeta('meta[name="description"]', 'content', prevDesc);
      document.getElementById('mkt-ld')?.remove();
    };
  }, []);

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

  const gold = '#c8922a';
  const bg = '#0c0a07';
  const text = '#e8e0d0';
  const text2 = 'rgba(232,224,208,.65)';
  const text3 = 'rgba(232,224,208,.35)';
  const border = 'rgba(255,255,255,.08)';
  const card = 'rgba(255,255,255,.04)';

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: bg, color: text, minHeight: '100vh' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .mkt-btn { display:inline-block; padding:14px 28px; border-radius:8px; font-weight:700; font-size:15px; cursor:pointer; border:none; text-decoration:none; transition:opacity .15s; line-height:1; }
        .mkt-btn:hover { opacity:.85; }
        .mkt-btn-gold { background:${gold}; color:${bg}; }
        .mkt-btn-outline { background:transparent; color:${text}; border:2px solid rgba(232,224,208,.2); }
        .mkt-fi { width:100%; padding:12px 14px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); border-radius:8px; color:${text}; font-size:15px; outline:none; margin-bottom:12px; font-family:inherit; }
        .mkt-fi:focus { border-color:${gold}; }
        .mkt-fi::placeholder { color:rgba(232,224,208,.3); }
        .mkt-ta { resize:vertical; min-height:110px; }
        .mkt-w { max-width:1080px; margin:0 auto; padding:0 24px; }
        .mkt-section { padding:88px 0; }
        .mkt-check { color:${gold}; font-weight:700; flex-shrink:0; margin-top:1px; }
        @media(max-width:700px) { .mkt-section{padding:56px 0;} .mkt-hide-sm{display:none!important;} }
        @media(max-width:580px) { .mkt-grid-2{grid-template-columns:1fr!important;} }
      `}</style>

      {/* Nav */}
      <nav style={{ borderBottom: `1px solid ${border}`, position: 'sticky', top: 0, background: 'rgba(12,10,7,.92)', backdropFilter: 'blur(12px)', zIndex: 100 }}>
        <div className="mkt-w" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <img src={LOGO} alt="C8 Tickets" style={{ height: 30, objectFit: 'contain' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <a href="#features" className="mkt-hide-sm" style={{ fontSize: 14, color: text2, textDecoration: 'none' }}>Features</a>
            <a href="#how-it-works" className="mkt-hide-sm" style={{ fontSize: 14, color: text2, textDecoration: 'none' }}>How It Works</a>
            <a href="#faq" className="mkt-hide-sm" style={{ fontSize: 14, color: text2, textDecoration: 'none' }}>FAQ</a>
            <a href="#contact" className="mkt-btn mkt-btn-gold" style={{ padding: '8px 18px', fontSize: 13 }}>Get Started</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div style={{ padding: '100px 24px 80px', textAlign: 'center', borderBottom: `1px solid ${border}` }}>
        <div style={{ display: 'inline-block', background: 'rgba(200,146,42,.12)', color: gold, borderRadius: 20, padding: '5px 16px', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 28 }}>
          All-in-One Venue Platform
        </div>
        <h1 style={{ fontSize: 'clamp(38px,7vw,72px)', fontWeight: 800, lineHeight: 1.08, marginBottom: 24, letterSpacing: -1.5 }}>
          Run your venue.<br /><span style={{ color: gold }}>Not your software.</span>
        </h1>
        <p style={{ fontSize: 'clamp(17px,2.2vw,21px)', color: text2, maxWidth: 600, margin: '0 auto 44px', lineHeight: 1.65 }}>
          Event ticketing, registration forms, and point-of-sale — purpose-built for bars, venues, and independent event spaces. Set up in under 24 hours.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="#contact" className="mkt-btn mkt-btn-gold">Talk to Us</a>
          <a href="#features" className="mkt-btn mkt-btn-outline">See What's Included</a>
        </div>
      </div>

      {/* Venue types */}
      <div style={{ borderBottom: `1px solid ${border}`, padding: '36px 24px' }}>
        <div className="mkt-w">
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: text3, textAlign: 'center', marginBottom: 20 }}>Built for venues like yours</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {VENUE_TYPES.map(v => (
              <div key={v.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 20, border: `1px solid ${border}`, fontSize: 13, color: text2, background: card }}>
                <span>{v.icon}</span> {v.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Products overview */}
      <div id="features" className="mkt-section">
        <div className="mkt-w">
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2 style={{ fontSize: 'clamp(28px,4vw,42px)', fontWeight: 800, letterSpacing: -0.5, marginBottom: 16 }}>Three products. One platform.</h2>
            <p style={{ fontSize: 17, color: text2, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>Use what you need. Add more as your venue grows. Everything shares the same dashboard and reporting.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 2 }}>
            {PRODUCTS.map(p => (
              <div key={p.id} style={{ background: card, border: `1px solid ${border}`, padding: '36px 32px' }}>
                <div style={{ fontSize: 40, marginBottom: 20 }}>{p.icon}</div>
                <h3 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{p.title}</h3>
                <p style={{ fontSize: 14, color: gold, fontWeight: 600, marginBottom: 16 }}>{p.tagline}</p>
                <p style={{ fontSize: 14, color: text2, lineHeight: 1.7, marginBottom: 24 }}>{p.desc}</p>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {p.bullets.map(b => (
                    <li key={b} style={{ fontSize: 13, color: 'rgba(232,224,208,.8)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span className="mkt-check">✓</span> {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How it works */}
      <div id="how-it-works" style={{ background: 'rgba(255,255,255,.025)', borderTop: `1px solid ${border}`, borderBottom: `1px solid ${border}` }}>
        <div className="mkt-w mkt-section">
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2 style={{ fontSize: 'clamp(28px,4vw,42px)', fontWeight: 800, letterSpacing: -0.5, marginBottom: 16 }}>Up and running in a day</h2>
            <p style={{ fontSize: 17, color: text2, maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>No IT team required. No weeks-long onboarding. We do the setup, you do the selling.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 40 }}>
            {STEPS.map(s => (
              <div key={s.n} style={{ display: 'flex', gap: 20 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: gold, color: bg, fontWeight: 800, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.n}</div>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{s.title}</h3>
                  <p style={{ fontSize: 14, color: text2, lineHeight: 1.65 }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Testimonial */}
      <div className="mkt-section">
        <div className="mkt-w" style={{ maxWidth: 760 }}>
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 20, padding: 'clamp(28px,5vw,52px)', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 24, opacity: 0.4 }}>"</div>
            <p style={{ fontSize: 'clamp(18px,2.5vw,24px)', lineHeight: 1.6, fontWeight: 500, marginBottom: 32, color: text }}>
              C8 Tickets completely changed how we run events. We went from juggling spreadsheets and a generic Square terminal to having one system that handles tickets, league sign-ups, and bar sales. Setup was painless and we were live the next day.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: gold, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, color: bg }}>C8</div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Crooked 8</div>
                <div style={{ fontSize: 13, color: text2 }}>Bar & Event Venue — Kuna, Idaho</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div id="faq" style={{ borderTop: `1px solid ${border}` }}>
        <div className="mkt-w mkt-section" style={{ maxWidth: 760 }}>
          <h2 style={{ fontSize: 'clamp(28px,4vw,42px)', fontWeight: 800, letterSpacing: -0.5, textAlign: 'center', marginBottom: 48 }}>Common questions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {FAQS.map((f, i) => (
              <div key={i} style={{ border: `1px solid ${border}`, borderRadius: openFaq === i ? 12 : 10, background: openFaq === i ? 'rgba(255,255,255,.05)' : 'transparent', overflow: 'hidden', transition: 'background .15s' }}>
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} style={{ width: '100%', background: 'none', border: 'none', color: text, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', textAlign: 'left', gap: 16 }}>
                  <span style={{ fontWeight: 600, fontSize: 16 }}>{f.q}</span>
                  <span style={{ fontSize: 20, color: gold, flexShrink: 0, transform: openFaq === i ? 'rotate(45deg)' : 'none', transition: 'transform .2s' }}>+</span>
                </button>
                {openFaq === i && (
                  <div style={{ padding: '0 24px 20px', fontSize: 15, color: text2, lineHeight: 1.7 }}>{f.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Contact */}
      <div id="contact" style={{ borderTop: `1px solid ${border}`, background: 'rgba(255,255,255,.015)' }}>
        <div className="mkt-w mkt-section" style={{ maxWidth: 640 }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 'clamp(28px,4vw,42px)', fontWeight: 800, letterSpacing: -0.5, marginBottom: 16 }}>Ready to get started?</h2>
            <p style={{ fontSize: 17, color: text2, lineHeight: 1.6 }}>Tell us about your venue. We'll reach out within one business day with next steps.</p>
          </div>
          {contactSent ? (
            <div style={{ textAlign: 'center', padding: '48px 32px', background: 'rgba(93,138,60,.08)', border: '1px solid rgba(93,138,60,.2)', borderRadius: 16 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
              <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Message received!</h3>
              <p style={{ color: text2, fontSize: 15, lineHeight: 1.6 }}>We'll be in touch within one business day. In the meantime, feel free to email us directly at <a href="mailto:hello@c8tickets.com" style={{ color: gold }}>hello@c8tickets.com</a>.</p>
            </div>
          ) : (
            <form onSubmit={handleContact} style={{ background: card, border: `1px solid ${border}`, borderRadius: 16, padding: 'clamp(24px,4vw,40px)' }}>
              <div className="mkt-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <input className="mkt-fi" style={{ margin: 0 }} placeholder="Your name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                <input className="mkt-fi" type="email" style={{ margin: 0 }} placeholder="Email address" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
              </div>
              <input className="mkt-fi" placeholder="Venue name" value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} />
              <textarea className="mkt-fi mkt-ta" placeholder="Tell us about your venue — what kinds of events do you run, how often, and what challenges are you trying to solve?" value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} />
              <button type="submit" className="mkt-btn mkt-btn-gold" style={{ width: '100%', fontSize: 16, padding: '16px 28px' }} disabled={sending}>
                {sending ? 'Sending…' : 'Send Message'}
              </button>
              <p style={{ fontSize: 12, color: text3, textAlign: 'center', marginTop: 14 }}>We respond within one business day. No sales pressure.</p>
            </form>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${border}`, padding: '36px 24px' }}>
        <div className="mkt-w" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <img src={LOGO} alt="C8 Tickets" style={{ height: 22, objectFit: 'contain', opacity: 0.5 }} />
          <p style={{ fontSize: 12, color: text3 }}>© {new Date().getFullYear()} C8 Tickets. All rights reserved.</p>
          <a href="mailto:hello@c8tickets.com" style={{ fontSize: 12, color: text3, textDecoration: 'none' }}>hello@c8tickets.com</a>
        </div>
      </footer>
    </div>
  );
}
