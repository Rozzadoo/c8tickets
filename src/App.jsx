import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import QRCodeLib from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { supabase } from './lib/supabase';
import { TENANT_ID, API_BASE, APP_URL } from './constants';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

// ── Logo as base64 PNG with transparency ──
const LOGO_SRC = "/logo-simple.png";
const LOGO_FULL = "/logo-full.png";
// ── Data & Storage ──
const DEFAULT_VENUE = {
  id: TENANT_ID, name: "Crooked 8",
  tagline: "Local Events, Easy Tickets.",
  location: "1882 E King Rd, Kuna, ID 83634",
  phone: "(208) 991-0788",
};

const TICKET_SIZES = [
  { id: 'strip',  label: 'Standard Strip',    sublabel: '5.5" × 2" — concert stub',        cols: 2, height: '2in',   photoW: '32%', fScale: 1.0 },
  { id: 'wide',   label: 'Wide Strip',         sublabel: '7" × 2.75" — standard ticket',    cols: 1, height: '2.75in',photoW: '33%', fScale: 1.2 },
  { id: 'half',   label: 'Half Page',          sublabel: '5.5" × 4.25" — premium ticket',   cols: 2, height: '3.8in', photoW: '36%', fScale: 1.6 },
  { id: 'full',   label: 'Full Page',          sublabel: '7.5" × 5" — collector\'s ticket', cols: 1, height: '4.8in', photoW: '42%', fScale: 2.0 },
  { id: 'custom', label: 'Custom',             sublabel: 'Enter your own dimensions',        cols: null, height: null, photoW: null, fScale: null },
];

const resolveCustomSize = (w, h) => {
  const wn = Math.max(2, Math.min(8.5, parseFloat(w) || 5.5));
  const hn = Math.max(1, Math.min(10,  parseFloat(h) || 2));
  return { id: 'custom', label: 'Custom', sublabel: `${wn}" × ${hn}"`, cols: wn <= 4.0 ? 2 : 1, height: `${hn}in`, photoW: hn > 3 ? '38%' : '32%', fScale: Math.max(0.8, Math.min(2.5, hn / 2)) };
};

const mapEvent = (e) => ({
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
  }))
});

const mapVenue = (v) => ({
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

const useStorage = () => {
  const [venues, setVenues] = useState([DEFAULT_VENUE]);
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: venueRows } = await supabase.from('tenants').select('*');
      if (venueRows?.length) setVenues(venueRows.map(mapVenue));

      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*, ticket_types(*)')
        .order('event_date', { ascending: true });

      if (eventsError) console.error(eventsError);
      else setEvents((eventsData || []).map(mapEvent));

      setLoaded(true);
    };
    load();

    const handleVisibility = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const updateEvents = useCallback((d) => setEvents(d), []);
  const updateVenues = useCallback((d) => setVenues(d), []);

  return { venues, events, loaded, updateEvents, updateVenues };
};

const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtCurrency = (n) => n === 0 ? "FREE" : "$" + Number(n).toFixed(2);
const fmtTime = (t) => t ? new Date('1970-01-01T' + t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const exportOrdersCSV = (orders, events, filename = 'orders.csv') => {
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

const buildGCalUrl = (ev, loc) => {
  const [y, m, d] = ev.date.split('-');
  const [h = '20', min = '00'] = (ev.time || '').split(':');
  const start = `${y}${m}${d}T${h}${min}00`;
  const end = `${y}${m}${d}T${String(Number(h) + 3).padStart(2,'0')}${min}00`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${start}/${end}&location=${encodeURIComponent(loc)}&ctz=America%2FBoise`;
};

const downloadIcs = (ev, loc) => {
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

// ── QR Code ──
const QRImg = ({ value, size = 160, style }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCodeLib.toDataURL(value, { width: size, margin: 1, color: { dark: '#1a1007', light: '#ffffff' } })
      .then(setSrc).catch(console.error);
  }, [value, size]);
  return src
    ? <img src={src} width={size} height={size} alt="QR Code" style={{ display: 'block', ...(style || {}) }} />
    : <div style={{ width: size, height: size, background: '#f0f0f0', borderRadius: 4, ...(style || {}) }} />;
};
// ── Stripe Checkout Form ──
const CheckoutForm = ({ cartTotal, totalTickets, paymentAmounts, onSuccess, onBack }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const submittingRef = useRef(false);
  const serviceFees = totalTickets * 2;
  const salesTax = paymentAmounts?.salesTax ?? 0;
  const processingFee = paymentAmounts?.processingFee ?? 0;
  const grandTotal = paymentAmounts?.grandTotal || (cartTotal + serviceFees);

  const handleSubmit = async () => {
    if (submittingRef.current || !stripe || !elements) return;
    submittingRef.current = true;
    setProcessing(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) { setError(submitError.message); setProcessing(false); return; }

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message);
      setProcessing(false);
      submittingRef.current = false;
    } else if (paymentIntent && paymentIntent.status === 'succeeded') {
      onSuccess(paymentIntent.id);
    }
  };

  return (
    <div>
      <div className="tkt-sec" style={{ marginBottom: 16 }}>
        <h3 className="dsp">Order Summary</h3>
        <div className="cart-ln"><span>Ticket Subtotal</span><span>{fmtCurrency(cartTotal)}</span></div>
        <div className="cart-ln"><span>Sales Tax (6%)</span><span>${Number(salesTax).toFixed(2)}</span></div>
        <div className="cart-ln"><span>Service Fee ({totalTickets} × $2.00)</span><span>{fmtCurrency(serviceFees)}</span></div>
        <div className="cart-ln"><span>Payment Processing Fee</span><span>${Number(processingFee).toFixed(2)}</span></div>
        <div className="cart-tot"><span>Total</span><span>{fmtCurrency(grandTotal)}</span></div>
      </div>
      <div className="tkt-sec" style={{ marginBottom: 16 }}>
        <h3 className="dsp" style={{ marginBottom: 16 }}>Payment</h3>
        <PaymentElement />
        {error && <p style={{ color: "var(--red)", fontSize: 12, marginTop: 10 }}>{error}</p>}
      </div>
      <label style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer",marginBottom:14,padding:"12px 14px",background:"var(--bg3)",borderRadius:"var(--rs)",border:`1px solid ${agreed?"rgba(200,146,42,.25)":"var(--bg4)"}`}}>
        <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{marginTop:2,accentColor:"var(--gold)",flexShrink:0,width:15,height:15,cursor:"pointer"}} />
        <span style={{fontSize:12,color:"var(--text2)",lineHeight:1.6}}>I understand that <strong style={{color:"var(--text)"}}>all sales are final and non-refundable</strong> unless the event is cancelled by the organizer. By completing this purchase I agree to the C8Tickets Terms of Service.</span>
      </label>
      <button className="buy" onClick={handleSubmit} disabled={!stripe || processing || !agreed}>
        {processing ? "Processing..." : `Pay ${fmtCurrency(grandTotal)}`}
      </button>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginTop:12,marginBottom:4}}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7a6c54" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span style={{fontSize:11,color:"var(--text3)"}}>Secured by</span>
        <svg width="34" height="14" viewBox="0 0 60 25" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.4 9.8c0-1.4 1.2-2 3-2 2.7 0 6.2.8 8.9 2.3V4.3C12.6 3 9.9 2.4 7.2 2.4 3.2 2.4.4 4.5.4 10c0 8.5 11.7 7.1 11.7 10.7 0 1.7-1.4 2.2-3.4 2.2-2.9 0-6.6-1.2-9.5-2.8v5.9c3.2 1.4 6.5 2 9.5 2 7.3 0 9.8-3.6 9.8-7.4-.1-9.2-11.1-7.5-11.1-10.8zM28 6.9l-3.8.8V2.9l-5.7 1.2v18.8H24V10c1.3-.4 3.4-.3 4.6.2V5.4c-1.3-.4-3.6-.3-4.6.2l4-.7zM33.5 4l5.7-1.2v18.7h-5.7V4zm0-3.8c0-1.7 1.3-2.7 3-2.1 1.6.4 2.7 2 2.7 3.7s-1.3 2.7-2.8 2.3c-1.7-.4-2.9-2.1-2.9-3.9zM48.3 7.6l-.4-1.7h-5v16h5.7V12c1.3-1.7 3.6-1.4 4.3-1.2V5.8c-.8-.2-3.3-.6-4.6 1.8zm10.4-3.4c-2 0-3.3.9-4 1.6l-.3-1.3H49v21.2l5.7-1.2V23c.7.5 1.8 1.1 3.6 1.1 3.6 0 6.9-2.9 6.9-9.3-.1-5.8-3.4-10.6-6.5-10.6zm-1.1 15c-1.2 0-1.9-.4-2.4-1V11.5c.5-.6 1.2-1 2.4-1 1.8 0 3.1 2 3.1 4.5s-1.3 4.2-3.1 4.2z" fill="#7a6c54"/></svg>
        <span style={{fontSize:11,color:"var(--text3)"}}>· Encrypted & secure</span>
      </div>
      <button className="btn" style={{ width: "100%", marginTop: 8 }} onClick={onBack}>← Back</button>
    </div>
  );
};

// ── Styles ──
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Barlow:wght@300;400;500;600;700&display=swap');
:root{--bg:#0c0a07;--bg2:#161310;--bg3:#211c14;--bg4:#2f271c;--text:#f0e9da;--text2:#b5a78a;--text3:#7a6c54;--gold:#c8922a;--gold-l:#e5a83a;--gold-d:#8b6914;--red:#b33a2a;--green:#5d8a3c;--r:10px;--rs:6px;--border:rgba(200,146,42,.12)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Barlow',sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;max-width:100vw}
.app{min-height:100vh;display:flex;flex-direction:column;overflow-x:hidden}
main{flex:1;width:100%;min-width:0;overflow-x:hidden}
.dsp{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:1.5px;font-weight:700}

.skip-link{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}.skip-link:focus{position:fixed;top:0;left:0;width:auto;height:auto;padding:10px 16px;background:var(--gold);color:var(--bg);font-weight:700;z-index:9999;text-decoration:none;border-radius:0 0 6px 0}
.nav{display:flex;align-items:center;justify-content:flex-start;gap:16px;padding:10px 20px;padding-top:calc(10px + env(safe-area-inset-top));background:var(--bg2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100;backdrop-filter:blur(12px);overflow:hidden}
.nav-logo{cursor:pointer;display:flex;align-items:center;gap:10px;flex-shrink:0}
.nav-logo img{height:64px;opacity:.95}
.nav-links{display:flex;gap:4px;overflow-x:auto;flex-shrink:1;min-width:0;-webkit-overflow-scrolling:touch;margin-left:auto}
.nav-links::-webkit-scrollbar{display:none}
@media(max-width:600px){.nav{padding:6px 12px;padding-top:calc(6px + env(safe-area-inset-top))}.nav-logo img{height:50px}.nav-links{gap:2px}.nav-links .btn{padding:5px 9px;font-size:11px;letter-spacing:0}}
.btn{background:none;border:1px solid transparent;color:var(--text2);padding:7px 14px;border-radius:99px;cursor:pointer;font-family:'Barlow',sans-serif;font-size:13px;font-weight:600;transition:all .2s;text-transform:uppercase;letter-spacing:.5px}
.btn:hover,.btn.on{background:var(--bg3);color:var(--text);border-color:var(--border)}
.btn.gold{background:linear-gradient(135deg,var(--gold),var(--gold-d));color:var(--bg);border-color:var(--gold)}
.btn.gold:hover{filter:brightness(1.15)}

.hero{padding:16px 20px 16px;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,rgba(200,146,42,.2) 0%,transparent 60%),radial-gradient(ellipse at 50% 120%,rgba(200,146,42,.07) 0%,transparent 55%);pointer-events:none}
.hero::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--gold-d),transparent)}
.hero-logo{width:clamp(280px,80vw,560px);height:auto;opacity:.97;margin-bottom:12px}
.hero p{color:var(--text2);font-size:clamp(13px,1.8vw,16px);font-weight:400;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:14px}
.hero-cta{display:inline-flex;align-items:center;gap:8px;padding:12px 32px;border:1px solid rgba(200,146,42,.5);border-radius:99px;color:var(--gold);font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;cursor:pointer;background:rgba(200,146,42,.06);transition:all .25s;margin-bottom:14px}
.hero-cta:hover{background:rgba(200,146,42,.14);border-color:var(--gold)}
.hero-sub{display:flex;justify-content:center;gap:16px;font-size:11px;color:var(--text3);flex-wrap:wrap}

.sec{padding:20px;max-width:1200px;margin:0 auto;width:100%;position:relative;z-index:1}
.sec-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px}
.sec-title{font-size:24px}
.filters{display:flex;gap:5px;flex-wrap:wrap}
.chip{padding:5px 12px;border-radius:99px;border:1px solid var(--bg4);background:transparent;color:var(--text2);cursor:pointer;font-size:11px;font-family:'Barlow',sans-serif;font-weight:600;transition:all .2s;text-transform:uppercase;letter-spacing:.5px}
.chip.on,.chip:hover{background:var(--gold);color:var(--bg);border-color:var(--gold)}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;cursor:pointer;transition:all .3s}
.card:hover{transform:translateY(-3px);box-shadow:0 10px 36px rgba(200,146,42,.1);border-color:rgba(200,146,42,.25)}
.card-img{height:190px;display:flex;align-items:center;justify-content:center;font-size:48px;background:linear-gradient(135deg,var(--bg3),var(--bg4));position:relative}
.card-cat{position:absolute;top:10px;right:10px;background:rgba(12,10,7,.8);backdrop-filter:blur(6px);padding:3px 10px;border-radius:99px;font-size:9px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;border:1px solid rgba(200,146,42,.2)}
.sold-out-badge{position:absolute;inset:0;background:rgba(12,10,7,.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(1px);font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:22px;letter-spacing:5px;text-transform:uppercase;color:#f0e9da;border:none}
.card-body{padding:16px}
.card-date{font-size:11px;color:var(--gold);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
.card-title{font-size:20px;margin-bottom:4px;line-height:1.2}
.card-desc{color:var(--text2);font-size:12px;line-height:1.5;margin-bottom:14px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-foot{display:flex;justify-content:space-between;align-items:center}
.card-price{font-weight:700;font-size:17px}
.card-price small{font-weight:400;font-size:11px;color:var(--text3)}

.feat{border-radius:var(--r);overflow:hidden;cursor:pointer;margin-bottom:28px;border:1px solid rgba(200,146,42,.2);transition:border-color .3s,box-shadow .3s}
.feat:hover{box-shadow:0 16px 48px rgba(200,146,42,.18);border-color:rgba(200,146,42,.4)}
.feat-bg{height:400px;background:linear-gradient(135deg,var(--bg3),var(--bg4));background-size:cover;background-position:center;position:relative;display:flex;align-items:flex-end}
.feat-grad{position:absolute;inset:0;background:linear-gradient(to top,rgba(12,10,7,1) 0%,rgba(12,10,7,.7) 40%,rgba(12,10,7,.05) 100%)}
.feat-body{position:relative;z-index:1;padding:28px 32px;width:100%}
.feat-eyebrow{display:inline-flex;align-items:center;gap:8px;background:rgba(200,146,42,.15);border:1px solid rgba(200,146,42,.35);color:var(--gold);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2.5px;padding:4px 12px;border-radius:99px;margin-bottom:14px}
.feat-title{font-family:'Barlow Condensed',sans-serif;font-size:clamp(28px,5vw,48px);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text);line-height:1.05;margin-bottom:8px}
.feat-date{font-size:12px;color:var(--gold);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:18px}
.feat-foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.feat-price{font-size:20px;font-weight:700;color:var(--text)}
@media(max-width:600px){.feat-bg{height:300px}.feat-body{padding:20px 22px}}

.back{display:inline-flex;align-items:center;gap:5px;color:var(--text2);cursor:pointer;font-size:13px;margin-bottom:20px;padding:6px 0;transition:color .2s;text-transform:uppercase;letter-spacing:1px;font-weight:600}
.back:hover{color:var(--gold)}
.d-hero{display:flex;align-items:center;justify-content:center;font-size:72px;height:180px;background:linear-gradient(135deg,var(--bg3),var(--bg4));border-radius:var(--r);margin-bottom:24px;border:1px solid var(--border)}
.d-meta{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px;font-size:13px;color:var(--text2)}
.d-meta strong{color:var(--text)}
.d-desc{color:var(--text2);line-height:1.7;font-size:14px;margin-bottom:28px;max-width:700px}
.directions-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:var(--rs);font-size:12px;font-weight:600;color:var(--text2);border:1px solid var(--border);text-decoration:none;margin-bottom:16px;transition:color .2s,border-color .2s}
.directions-btn:hover{color:var(--gold);border-color:var(--gold)}
.share-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.share-btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;cursor:pointer;text-decoration:none;border:none;transition:opacity .2s,transform .1s;flex-shrink:0}
.share-btn:hover{opacity:.85;transform:translateY(-1px)}
.share-fb{background:#1877f2;color:#fff}
.share-tw{background:#000;color:#fff;border:1px solid #333}
.share-ig{background:linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);color:#fff}
.share-sms{background:#5d8a3c;color:#fff}
.share-native{background:#c8922a;color:#fff}

.tkt-sec{background:var(--bg2);border-radius:var(--r);padding:24px;border:1px solid var(--border)}
.tkt-sec h3{font-size:20px;margin-bottom:16px}
.tkt-row{display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid rgba(200,146,42,.08);flex-wrap:wrap;gap:10px}
.tkt-row:last-of-type{border-bottom:none}
.tkt-info h4{font-size:14px;font-weight:600;margin-bottom:1px}
.tkt-info p{font-size:11px;color:var(--text3)}
.tkt-price{font-size:17px;font-weight:700;color:var(--gold);min-width:65px;text-align:right}
.qty{display:flex;align-items:center}
.qb{width:34px;height:34px;border:1px solid var(--bg4);background:var(--bg3);color:var(--text);border-radius:var(--rs);cursor:pointer;font-size:17px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.qb:hover{background:var(--gold);border-color:var(--gold);color:var(--bg)}
.qb:disabled{opacity:.3;cursor:not-allowed}.qb:disabled:hover{background:var(--bg3);border-color:var(--bg4);color:var(--text)}
.qv{width:40px;text-align:center;font-weight:700;font-size:15px}
.cart-sum{margin-top:20px;padding-top:16px;border-top:2px solid var(--bg4)}
.cart-ln{display:flex;justify-content:space-between;font-size:13px;color:var(--text2);margin-bottom:6px}
.cart-tot{display:flex;justify-content:space-between;font-size:20px;font-weight:700;margin-top:10px;padding-top:10px;border-top:1px solid var(--bg4)}
.buy{width:100%;margin-top:16px;padding:14px;background:linear-gradient(135deg,var(--gold),var(--gold-d));color:var(--bg);border:none;border-radius:var(--rs);font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:700;cursor:pointer;transition:all .2s;letter-spacing:2px;text-transform:uppercase}
.buy:hover{filter:brightness(1.15);transform:translateY(-1px)}
.buy:disabled{opacity:.4;cursor:not-allowed;transform:none;filter:none}

.fg{margin-bottom:14px}
.fl{display:block;font-size:10px;font-weight:700;color:var(--text3);margin-bottom:5px;text-transform:uppercase;letter-spacing:1.5px}
.fi{width:100%;padding:11px 14px;background:var(--bg3);border:1px solid var(--bg4);border-radius:var(--rs);color:var(--text);font-family:'Barlow',sans-serif;font-size:13px;transition:border-color .2s;outline:none}
.fi:focus{border-color:var(--gold)}
.fr{display:grid;grid-template-columns:1fr 1fr;gap:10px}

.tkt-disp{background:var(--bg2);border-radius:var(--r);padding:28px;text-align:center;border:1px solid var(--border);max-width:400px;margin:0 auto;position:relative;overflow:hidden}
.tkt-disp::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--gold-d),var(--gold),var(--gold-d))}
.tkt-disp .qr{background:white;border-radius:10px;padding:14px;display:inline-block;margin:16px 0}
.tkt-disp .cid{font-family:monospace;font-size:11px;color:var(--text3);margin-top:6px;letter-spacing:1.5px}
.tkt-items{text-align:left;background:var(--bg3);border-radius:var(--rs);padding:14px;margin:14px 0}
.tkt-items li{display:flex;justify-content:space-between;padding:3px 0;font-size:13px;list-style:none;color:var(--text2)}
.badge{display:inline-block;padding:3px 12px;border-radius:99px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px}
.badge-ok{background:rgba(93,138,60,.2);color:var(--green);border:1px solid rgba(93,138,60,.3)}
.badge-done{background:rgba(255,255,255,.05);color:var(--text3);border:1px solid rgba(255,255,255,.08)}
.badge-sold{background:rgba(179,58,42,.15);color:var(--red);border:1px solid rgba(179,58,42,.3)}
.badge-cancelled{background:rgba(255,255,255,.04);color:var(--text3);border:1px solid rgba(255,255,255,.08);text-decoration:line-through}
.tag{display:inline-block;padding:2px 9px;border-radius:99px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:rgba(200,146,42,.15);color:var(--gold)}

.admin{display:grid;grid-template-columns:200px 1fr;min-height:calc(100vh - 61px)}
@media(max-width:768px){.admin{grid-template-columns:1fr;align-content:start}}
.aside{background:var(--bg2);border-right:1px solid var(--border);padding:20px 14px;display:flex;flex-direction:column;gap:3px}
@media(max-width:768px){.aside{flex-direction:row;flex-wrap:nowrap;overflow-x:auto;padding:10px;border-right:none;border-bottom:1px solid var(--border)}}
.aside-btn{padding:9px 14px;border-radius:var(--rs);border:none;background:transparent;color:var(--text2);cursor:pointer;font-family:'Barlow',sans-serif;font-size:13px;text-align:left;transition:all .15s;white-space:nowrap;font-weight:500}
.aside-btn:hover,.aside-btn.on{background:var(--bg3);color:var(--gold)}
.amain{padding:28px;overflow-y:auto;overflow-x:hidden;max-width:100%}
@media(max-width:768px){.amain{padding:14px}}

.sg{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:28px}
.sc{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:18px}
.sc .l{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;font-weight:700}
.sc .v{font-size:28px;font-weight:700}
.sc .v.gd{color:var(--gold)}
.sc .s{font-size:11px;color:var(--text3);margin-top:3px}

.dt{width:100%;border-collapse:collapse}
.dt th{text-align:left;font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px;padding:10px 14px;border-bottom:1px solid var(--bg4);font-weight:700}
.dt td{padding:12px 14px;border-bottom:1px solid rgba(200,146,42,.05);font-size:13px}
.dt tr:hover td{background:rgba(200,146,42,.03)}

.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:200;padding:14px}
.modal{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:28px;max-width:540px;width:100%;max-height:90vh;overflow-y:auto}
.modal h2{font-size:22px;margin-bottom:20px}

.empty{text-align:center;padding:50px 20px;color:var(--text3)}
.empty .ic{font-size:40px;margin-bottom:12px}
.ci-btn{padding:5px 12px;border-radius:var(--rs);border:1px solid var(--green);background:transparent;color:var(--green);cursor:pointer;font-size:11px;font-weight:700;font-family:'Barlow',sans-serif;transition:all .15s;text-transform:uppercase;letter-spacing:.5px}
.ci-btn:hover{background:var(--green);color:var(--bg)}
.ci-btn.dn{border-color:var(--text3);color:var(--text3);cursor:default;opacity:.5}
.fade{animation:fi .35s ease}
@keyframes fi{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.footer{background:var(--bg2);border-top:1px solid var(--border);padding:28px 20px;text-align:center;margin-top:auto}
.footer-links{display:flex;justify-content:center;gap:20px;flex-wrap:wrap;margin-bottom:12px}
.footer-links a{color:var(--text3);font-size:12px;text-decoration:none;transition:color .2s}
.footer-links a:hover{color:var(--gold)}
.footer-copy{font-size:11px;color:var(--text3)}
.about-hero{text-align:center;padding:16px 20px 16px;border-bottom:1px solid var(--border)}
.about-hero h1{font-size:clamp(36px,7vw,64px);color:var(--gold);margin-bottom:12px;line-height:1}
.about-hero p{font-size:clamp(15px,2.5vw,19px);color:var(--text2);max-width:580px;margin:0 auto;line-height:1.7}
.about-sec{max-width:820px;margin:0 auto;padding:56px 20px}
.about-sec h2{font-size:clamp(24px,4vw,36px);color:var(--text);margin-bottom:16px}
.about-sec p{color:var(--text2);font-size:15px;line-height:1.8;margin-bottom:14px}
.about-divider{width:48px;height:3px;background:linear-gradient(90deg,var(--gold-d),var(--gold));border-radius:2px;margin:0 auto 48px}
.about-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:8px}
.about-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:24px;transition:border-color .2s}
.about-card:hover{border-color:rgba(200,146,42,.35)}
.about-card-icon{font-size:28px;margin-bottom:12px}
.about-card h3{font-size:15px;color:var(--text);margin-bottom:8px;text-transform:uppercase;letter-spacing:1.5px;font-family:'Barlow Condensed',sans-serif;font-weight:700}
.about-card p{color:var(--text2);font-size:13px;line-height:1.7;margin:0}
.about-cta{text-align:center;padding:56px 20px 72px;border-top:1px solid var(--border)}
.about-cta h2{font-size:clamp(24px,4vw,36px);color:var(--text);margin-bottom:12px}
.about-cta p{color:var(--text2);font-size:15px;margin-bottom:28px}
.about-cta a{color:var(--gold);font-size:18px;font-weight:700;text-decoration:none;border-bottom:1px solid rgba(200,146,42,.4);padding-bottom:2px;transition:border-color .2s}
.about-cta a:hover{border-color:var(--gold)}
.legal{max-width:700px;margin:0 auto;padding:40px 20px;color:var(--text2);line-height:1.8}
.legal h1{font-size:28px;margin-bottom:8px;color:var(--text)}
.legal h2{font-size:16px;margin:28px 0 10px;color:var(--text);text-transform:uppercase;letter-spacing:1px}
.legal p{margin-bottom:14px;font-size:14px}
.legal ul{margin:0 0 14px 20px;font-size:14px}
.legal ul li{margin-bottom:6px}
.legal .date{font-size:12px;color:var(--text3);margin-bottom:28px}
#gate-scanner,#admin-scanner{width:100%!important;border-radius:var(--r);overflow:hidden}
#gate-scanner video,#admin-scanner video{width:100%!important;border-radius:var(--r)}
#gate-scanner img,#admin-scanner img{display:none}
@media print{nav.nav,footer.footer,.back,button{display:none!important}body{background:#fff!important}.tkt-disp{border:1px solid #ddd;break-inside:avoid;margin-bottom:16px}.sec{padding:0!important}#ticket-print-area .tkt-disp{background:#fff;color:#000}}
`;

// ── QR Scanner ──
const ScannerWidget = ({ scannerId, onResult }) => {
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; });
  useEffect(() => {
    let qr;
    qr = new Html5Qrcode(scannerId);
    qr.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (text) => { qr.stop().catch(() => {}); onResultRef.current(text.trim()); },
      () => {}
    ).catch(console.error);
    return () => { if (qr) qr.stop().catch(() => {}); };
  }, [scannerId]);
  return <div id={scannerId} style={{width:'100%',minHeight:300,background:'var(--bg3)',borderRadius:'var(--r)'}} />;
};

// ── Gate Check-In View ──
const GateView = ({ events, onLogout }) => {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [selGateEventId, setSelGateEventId] = useState('');
  const [groupConfirm, setGroupConfirm] = useState(false);
  const [groupCount, setGroupCount] = useState(1);

  useEffect(() => {
    if (selGateEventId || events.length === 0) return;
    const upcoming = [...events].filter(e => e.published !== false)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .find(e => new Date(e.date) >= new Date(Date.now() - 86400000));
    if (upcoming) setSelGateEventId(upcoming.id);
  }, [events, selGateEventId]);

  const next = () => { setResult(null); setGroupConfirm(false); setGroupCount(1); setScanning(true); };

  // Auto-advance to next scan 2 seconds after a successful check-in
  useEffect(() => {
    if (!result || result === 'loading' || !result.done) return;
    const t = setTimeout(next, 2000);
    return () => clearTimeout(t);
  }, [result]);

  const handleScan = async (rawId) => {
    setScanning(false);
    setResult('loading');
    setGroupCount(1);

    // Strip full URL prefix if scanned from a URL-format QR (e.g. https://c8tickets.com/t/{uuid}?receipt=1)
    const id = rawId.replace(/^https?:\/\/[^/]+\/t\//, '').split('?')[0].trim();

    // Try individual ticket lookup first
    const { data: ticket } = await supabase
      .from('tickets').select('*').eq('id', id).single();

    if (ticket) {
      const { data: order } = await supabase.from('orders').select('*, order_items(*)').eq('id', ticket.order_id).single();
      const ev = events.find(e => e.id === ticket.event_id);

      if (selGateEventId && ticket.event_id !== selGateEventId) {
        setResult({ found: true, wrongEvent: true, ticket, order, event: ev }); return;
      }
      if (ticket.status === 'cancelled' || order?.status === 'cancelled') {
        setResult({ found: true, cancelled: true, ticket, order }); return;
      }
      const { count } = await supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('order_id', ticket.order_id);
      setResult({ found: true, ticket, order, event: ev, alreadyIn: ticket.status === 'checked_in', done: false, ticketTotal: count });
      return;
    }

    // Fall back to order-level lookup (group / legacy QR)
    const { data: order, error } = await supabase.from('orders').select('*, order_items(*)').eq('id', id).single();
    if (error || !order) { setResult({ found: false }); return; }

    const ev = events.find(e => e.id === order.event_id);

    if (selGateEventId && order.event_id !== selGateEventId) {
      setResult({ found: true, wrongEvent: true, order, event: ev }); return;
    }
    if (order.status === 'cancelled') { setResult({ found: true, cancelled: true, order }); return; }

    // Fetch individual ticket rows so we can do partial group check-in
    const { data: orderTickets } = await supabase.from('tickets').select('*').eq('order_id', id).order('ticket_number');
    const unchecked = (orderTickets || []).filter(t => t.status !== 'checked_in' && t.status !== 'cancelled');

    if (orderTickets && orderTickets.length > 0) {
      setResult({ found: true, isGroupOrder: true, order, event: ev, orderTickets, uncheckedCount: unchecked.length, alreadyIn: unchecked.length === 0, done: false });
    } else {
      // Legacy: no individual ticket rows
      setResult({ found: true, order, event: ev, alreadyIn: order.status === 'checked_in', done: false });
    }
  };

  const doCheckin = async () => {
    const now = new Date().toISOString();
    if (result.ticket) {
      const { data: updated } = await supabase.from('tickets')
        .update({ status: 'checked_in', checked_in_at: now })
        .eq('id', result.ticket.id)
        .eq('status', 'valid')
        .select('id');
      if (!updated || updated.length === 0) {
        setResult({ ...result, alreadyIn: true, done: false });
        return;
      }
    } else {
      // Legacy order-level (no individual ticket rows)
      await supabase.from('orders').update({ status: 'checked_in' }).eq('id', result.order.id);
    }
    setResult({ ...result, alreadyIn: false, done: true });
  };

  const doGroupCheckin = async (count) => {
    const now = new Date().toISOString();
    const toCheckin = result.orderTickets.filter(t => t.status !== 'checked_in' && t.status !== 'cancelled').slice(0, count);
    let actualCheckedIn = 0;
    for (const t of toCheckin) {
      const { data: updated } = await supabase.from('tickets')
        .update({ status: 'checked_in', checked_in_at: now })
        .eq('id', t.id)
        .eq('status', 'valid')
        .select('id');
      if (updated && updated.length > 0) actualCheckedIn++;
    }
    if (result.uncheckedCount - actualCheckedIn <= 0) {
      await supabase.from('orders').update({ status: 'checked_in' }).eq('id', result.order.id);
    }
    setGroupConfirm(false);
    setResult({ ...result, alreadyIn: false, done: true, checkedInCount: actualCheckedIn });
  };

  const upcomingEvents = events.filter(e => e.published !== false);

  return (
    <div className="app">
      {groupConfirm && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
          <div style={{background:'var(--bg2)',border:'1px solid var(--gold)',borderRadius:12,padding:28,maxWidth:320,width:'100%',textAlign:'center'}}>
            <h3 className="dsp" style={{fontSize:20,marginBottom:12}}>Check In All?</h3>
            <p style={{color:'var(--text2)',fontSize:14,marginBottom:24}}>Check in all <strong style={{color:'var(--text)'}}>{result?.uncheckedCount} tickets</strong> for <strong style={{color:'var(--text)'}}>{result?.order?.buyer_name}</strong>?</p>
            <div style={{display:'flex',gap:10}}>
              <button className="btn" style={{flex:1}} onClick={() => setGroupConfirm(false)}>Cancel</button>
              <button className="buy" style={{flex:1}} onClick={() => doGroupCheckin(result.uncheckedCount)}>Yes, Check In All</button>
            </div>
          </div>
        </div>
      )}
      <nav className="nav">
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <img src={LOGO_SRC} alt="" style={{height:40,filter:'invert(1)',opacity:.9}} />
          <span className="dsp" style={{fontSize:12,color:'var(--gold)',letterSpacing:2}}>Gate Check-In</span>
        </div>
        <button className="btn" onClick={onLogout}>Logout</button>
      </nav>
      <div style={{maxWidth:440,margin:'0 auto',padding:'24px 16px',width:'100%'}}>
        {!scanning && !result && (
          <div style={{textAlign:'center',paddingTop:40}} className="fade">
            <div style={{fontSize:64,marginBottom:16}}>🎟️</div>
            <h2 className="dsp" style={{fontSize:28,marginBottom:8}}>Ready to Scan</h2>
            <p style={{color:'var(--text2)',fontSize:14,marginBottom:24}}>Point the camera at a buyer's QR code to check them in.</p>
            {upcomingEvents.length > 0 && (
              <div style={{marginBottom:28,textAlign:'left'}}>
                <label style={{fontSize:12,color:'var(--text2)',marginBottom:6,display:'block',textTransform:'uppercase',letterSpacing:1}}>Event Filter (optional)</label>
                <select className="fi" value={selGateEventId} onChange={e => setSelGateEventId(e.target.value)}>
                  <option value="">All Events</option>
                  {upcomingEvents.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
              </div>
            )}
            <button className="buy" style={{width:'100%'}} onClick={() => setScanning(true)}>Start Scanner</button>
          </div>
        )}
        {scanning && (
          <div className="fade">
            <h3 className="dsp" style={{fontSize:18,marginBottom:12,textAlign:'center'}}>Scan QR Code</h3>
            <ScannerWidget scannerId="gate-scanner" onResult={handleScan} />
            <button className="btn" style={{width:'100%',marginTop:10}} onClick={() => setScanning(false)}>Cancel</button>
          </div>
        )}
        {result === 'loading' && (
          <div style={{textAlign:'center',padding:60}}><p style={{color:'var(--text2)'}}>Looking up ticket...</p></div>
        )}
        {result && result !== 'loading' && (
          <div className="fade">
            <div className="tkt-sec" style={{marginBottom:14}}>
              {!result.found && (
                <div style={{textAlign:'center',padding:'20px 0'}}>
                  <div style={{fontSize:48,marginBottom:10}}>❌</div>
                  <h3 className="dsp" style={{color:'var(--red)',fontSize:22,marginBottom:8}}>Ticket Not Found</h3>
                  <p style={{color:'var(--text2)',fontSize:13}}>This QR code doesn't match any order.</p>
                </div>
              )}
              {result.found && result.wrongEvent && (
                <div style={{textAlign:'center',padding:'20px 0'}}>
                  <div style={{fontSize:48,marginBottom:10}}>⚠️</div>
                  <h3 className="dsp" style={{color:'var(--gold)',fontSize:22,marginBottom:8}}>Wrong Event</h3>
                  <p style={{fontWeight:700,fontSize:16}}>{result.order?.buyer_name}</p>
                  <p style={{color:'var(--text2)',fontSize:13,marginTop:6}}>This ticket is for <strong style={{color:'var(--gold)'}}>{result.event?.title || 'a different event'}</strong>.</p>
                </div>
              )}
              {result.found && result.cancelled && (
                <div style={{textAlign:'center',padding:'20px 0'}}>
                  <div style={{fontSize:48,marginBottom:10}}>🚫</div>
                  <h3 className="dsp" style={{color:'var(--red)',fontSize:22,marginBottom:8}}>Order Cancelled</h3>
                  <p style={{fontWeight:700,fontSize:16}}>{result.order?.buyer_name}</p>
                  <p style={{color:'var(--text2)',fontSize:13,marginTop:4}}>This order has been cancelled and refunded. Entry denied.</p>
                </div>
              )}
              {result.found && !result.cancelled && !result.wrongEvent && result.alreadyIn && (
                <div style={{textAlign:'center',padding:'20px 0'}}>
                  <div style={{fontSize:48,marginBottom:10}}>⚠️</div>
                  <h3 className="dsp" style={{color:'var(--gold)',fontSize:22,marginBottom:8}}>Already Checked In</h3>
                  <p style={{fontWeight:700,fontSize:16}}>{result.order?.buyer_name}</p>
                  <p style={{color:'var(--gold)',fontSize:13,marginTop:4}}>{result.event?.title}</p>
                </div>
              )}
              {result.found && !result.cancelled && !result.wrongEvent && result.done && (
                <div style={{textAlign:'center',padding:'20px 0'}}>
                  <div style={{fontSize:48,marginBottom:10}}>✅</div>
                  <h3 className="dsp" style={{color:'var(--green)',fontSize:22,marginBottom:8}}>
                    {result.checkedInCount ? `${result.checkedInCount} Checked In!` : 'Checked In!'}
                  </h3>
                  <p style={{fontWeight:700,fontSize:16}}>{result.order?.buyer_name}</p>
                  <p style={{color:'var(--gold)',fontSize:13,marginTop:4}}>{result.event?.title}</p>
                  <p style={{color:'var(--text3)',fontSize:12,marginTop:8}}>Scanning next in 2 seconds...</p>
                </div>
              )}
              {/* Individual ticket: valid, ready to check in */}
              {result.found && !result.cancelled && !result.wrongEvent && !result.alreadyIn && !result.done && !result.isGroupOrder && (
                <div>
                  <div style={{textAlign:'center',marginBottom:16}}>
                    <div style={{fontSize:48,marginBottom:10}}>✅</div>
                    <h3 className="dsp" style={{color:'var(--green)',fontSize:22,marginBottom:4}}>Valid Ticket</h3>
                    {result.ticket && <p style={{color:'var(--gold)',fontWeight:700,fontSize:13}}>Ticket {result.ticket.ticket_number}{result.ticketTotal ? ` of ${result.ticketTotal}` : ''}</p>}
                  </div>
                  <p style={{fontWeight:700,fontSize:17,marginBottom:2}}>{result.order?.buyer_name}</p>
                  <p style={{color:'var(--text2)',fontSize:13,marginBottom:4}}>{result.order?.buyer_email}</p>
                  <p style={{color:'var(--gold)',fontWeight:700,fontSize:14,marginBottom:14}}>{result.event?.title || 'Event'}</p>
                  <div style={{background:'var(--bg3)',borderRadius:'var(--rs)',padding:'10px 14px',marginBottom:16}}>
                    {result.ticket
                      ? <div style={{fontSize:13,color:'var(--text2)'}}>{result.ticket.ticket_type_name}</div>
                      : (result.order?.order_items || []).map((item, i) => (
                          <div key={i} style={{fontSize:13,color:'var(--text2)',padding:'2px 0'}}>{item.quantity}× {item.ticket_type_name}</div>
                        ))
                    }
                  </div>
                  <button className="buy" onClick={doCheckin}>✓ Check In</button>
                </div>
              )}
              {/* Group order: partial or full check-in */}
              {result.found && !result.cancelled && !result.wrongEvent && !result.alreadyIn && !result.done && result.isGroupOrder && (
                <div>
                  <div style={{textAlign:'center',marginBottom:16}}>
                    <div style={{fontSize:48,marginBottom:10}}>🎫</div>
                    <h3 className="dsp" style={{color:'var(--gold)',fontSize:22,marginBottom:4}}>Group Ticket</h3>
                    <p style={{color:'var(--text2)',fontSize:13}}>{result.uncheckedCount} of {result.orderTickets.length} not yet checked in</p>
                  </div>
                  <p style={{fontWeight:700,fontSize:17,marginBottom:2}}>{result.order?.buyer_name}</p>
                  <p style={{color:'var(--text2)',fontSize:13,marginBottom:4}}>{result.order?.buyer_email}</p>
                  <p style={{color:'var(--gold)',fontWeight:700,fontSize:14,marginBottom:14}}>{result.event?.title || 'Event'}</p>
                  <div style={{background:'var(--bg3)',borderRadius:'var(--rs)',padding:'10px 14px',marginBottom:16}}>
                    {result.orderTickets.map((t, i) => (
                      <div key={t.id} style={{fontSize:13,padding:'4px 0',display:'flex',justifyContent:'space-between',borderBottom: i < result.orderTickets.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'}}>
                        <span style={{color:'var(--text2)'}}>#{t.ticket_number} {t.ticket_type_name}</span>
                        <span className={`badge ${t.status === 'checked_in' ? 'badge-done' : 'badge-ok'}`} style={{fontSize:11}}>{t.status === 'checked_in' ? 'In' : 'Waiting'}</span>
                      </div>
                    ))}
                  </div>
                  {result.uncheckedCount > 1 && (
                    <div style={{marginBottom:14,display:'flex',alignItems:'center',gap:10}}>
                      <span style={{color:'var(--text2)',fontSize:13,flexShrink:0}}>How many entering?</span>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <button className="btn" style={{padding:'4px 12px',fontSize:18,lineHeight:1}} onClick={() => setGroupCount(c => Math.max(1, c - 1))}>−</button>
                        <span style={{fontWeight:700,fontSize:20,minWidth:28,textAlign:'center'}}>{groupCount}</span>
                        <button className="btn" style={{padding:'4px 12px',fontSize:18,lineHeight:1}} onClick={() => setGroupCount(c => Math.min(result.uncheckedCount, c + 1))}>+</button>
                        <span style={{color:'var(--text3)',fontSize:12}}>/ {result.uncheckedCount}</span>
                      </div>
                    </div>
                  )}
                  <div style={{display:'flex',gap:10}}>
                    {result.uncheckedCount > 1 && (
                      <button className="btn" style={{flex:1}} onClick={() => doGroupCheckin(groupCount)}>Check In {groupCount}</button>
                    )}
                    <button className="buy" style={{flex:1}} onClick={() => result.uncheckedCount > 1 ? setGroupConfirm(true) : doGroupCheckin(1)}>
                      Check In All ({result.uncheckedCount})
                    </button>
                  </div>
                </div>
              )}
            </div>
            {!result.done && (
              <button className="btn" style={{width:'100%'}} onClick={next}>
                {result.found && !result.cancelled && !result.wrongEvent && !result.alreadyIn ? 'Cancel' : 'Scan Next Ticket'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const DoorSales = ({ events, updateOrders, updateEvents, venue }) => {
  const [selEventId, setSelEventId] = useState('');
  const [doorCart, setDoorCart] = useState({});
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [step, setStep] = useState('select');
  const [clientSecret, setClientSecret] = useState(null);
  const [amounts, setAmounts] = useState(null);
  const [cashAmounts, setCashAmounts] = useState(null);
  const [tendered, setTendered] = useState('');
  const [lastSale, setLastSale] = useState(null);
  const [isPreSale, setIsPreSale] = useState(false);
  const [loadingIntent, setLoadingIntent] = useState(false);
  // Terminal reader state
  const [terminal, setTerminal] = useState(null);
  const [readers, setReaders] = useState([]);
  const [connectedReader, setConnectedReader] = useState(null);
  const [readerDiscovering, setReaderDiscovering] = useState(false);
  const [readerConnecting, setReaderConnecting] = useState(false);
  const [readerError, setReaderError] = useState('');
  const [terminalPaymentStatus, setTerminalPaymentStatus] = useState('idle');
  const [terminalAmounts, setTerminalAmounts] = useState(null);

  useEffect(() => {
    if (selEventId || events.length === 0) return;
    const upcoming = [...events].sort((a, b) => new Date(a.date) - new Date(b.date))
      .find(e => new Date(e.date) >= new Date(Date.now() - 86400000));
    setSelEventId(upcoming?.id || events[0]?.id || '');
  }, [events, selEventId]);

  const ev = events.find(e => e.id === selEventId);
  const cartItems = ev ? ev.tickets.map((t, i) => ({ ...t, qty: doorCart[i] || 0, effectivePrice: t.doorPrice ?? t.price })) : [];
  const cartN = cartItems.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cartItems.reduce((s, i) => s + i.qty * i.effectivePrice, 0);

  const startPayment = async () => {
    if (!ev || cartN === 0) return;
    setLoadingIntent(true);
    const items = cartItems.filter(i => i.qty > 0).map(i => ({ qty: i.qty, ticketTypeId: i.id }));
    const res = await fetch(API_BASE+'/api/create-payment-intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, eventId: selEventId, tenantId: TENANT_ID, isDoorSale: true }),
    });
    const data = await res.json();
    setLoadingIntent(false);
    if (!data.clientSecret) { alert('Payment setup failed. Please try again.'); return; }
    setClientSecret(data.clientSecret);
    setAmounts(data);
    setStep('payment');
  };

  const initAndDiscover = async () => {
    setReaderError('');
    setReaders([]);
    setReaderDiscovering(true);
    try {
      const { loadStripeTerminal } = await import('@stripe/terminal-js');
      const StripeTerminal = await loadStripeTerminal();
      const term = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const { data: { session: s } } = await supabase.auth.getSession();
          const r = await fetch(API_BASE + '/api/terminal?action=connection-token', {
            method: 'POST',
            headers: { Authorization: `Bearer ${s?.access_token || ''}` },
          });
          const d = await r.json();
          if (d.error) throw new Error(d.error);
          return d.secret;
        },
        onUnexpectedReaderDisconnect: () => {
          setConnectedReader(null);
          setTerminalPaymentStatus('idle');
          setReaderError('Reader disconnected unexpectedly.');
        },
      });
      setTerminal(term);
      const result = await term.discoverReaders({ simulated: false, discoveryMethod: 'internet' });
      setReaderDiscovering(false);
      if (result.error) {
        setReaderError(result.error.message);
      } else if (result.discoveredReaders.length === 0) {
        setReaderError('No readers found. Make sure the reader is powered on and on the same network.');
      } else {
        setReaders(result.discoveredReaders);
      }
    } catch (err) {
      setReaderDiscovering(false);
      setReaderError(err.message || 'Failed to initialize terminal.');
    }
  };

  const connectToReader = async (reader) => {
    if (!terminal) return;
    setReaderConnecting(true);
    setReaderError('');
    const result = await terminal.connectReader(reader, { fail_if_in_use: false });
    setReaderConnecting(false);
    if (result.error) {
      setReaderError(result.error.message);
    } else {
      setConnectedReader(result.reader);
      setReaders([]);
    }
  };

  const disconnectReader = async () => {
    if (terminal) await terminal.disconnectReader().catch(() => {});
    setConnectedReader(null);
    setTerminal(null);
    setReaders([]);
    setReaderError('');
  };

  const startTerminalPayment = async () => {
    if (!terminal || !connectedReader || cartN === 0) return;
    const { data: { session: doorSession } } = await supabase.auth.getSession();
    setLoadingIntent(true);
    const res = await fetch(API_BASE + '/api/terminal?action=payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doorSession?.access_token || ''}` },
      body: JSON.stringify({
        items: cartItems.filter(i => i.qty > 0).map(i => ({ qty: i.qty, ticketTypeId: i.id })),
        eventId: selEventId, tenantId: TENANT_ID,
        eventMeta: { title: ev?.title || '' },
      }),
    });
    const data = await res.json();
    setLoadingIntent(false);
    if (!data.clientSecret) { alert(data.error || 'Payment setup failed. Please try again.'); return; }
    setTerminalAmounts(data);
    setStep('terminal_payment');
    setTerminalPaymentStatus('waiting_for_card');
    const collectResult = await terminal.collectPaymentMethod(data.clientSecret);
    if (collectResult.error) {
      if (collectResult.error.code !== 'canceled') alert(collectResult.error.message);
      setStep('select'); setTerminalPaymentStatus('idle');
      return;
    }
    setTerminalPaymentStatus('processing');
    const processResult = await terminal.processPayment(collectResult.paymentIntent);
    if (processResult.error) {
      alert(processResult.error.message);
      setStep('select'); setTerminalPaymentStatus('idle');
      return;
    }
    setTerminalPaymentStatus('idle');
    await handleSuccess(processResult.paymentIntent.id, data);
  };

  const cancelTerminalPayment = async () => {
    if (terminal) await terminal.cancelCollectPaymentMethod().catch(() => {});
    setStep('select');
    setTerminalPaymentStatus('idle');
  };

  const handleSuccess = async (paymentIntentId, amountsData) => {
    const eff = amountsData || amounts;
    const { data: { session: doorSession } } = await supabase.auth.getSession();
    const soldItems = cartItems.filter(i => i.qty > 0).map(i => ({ type: i.type, qty: i.qty, price: i.effectivePrice, ticketTypeId: i.id }));
    const { data: order, error: orderError } = await supabase.from('orders').insert({
      tenant_id: TENANT_ID, event_id: selEventId,
      buyer_name: buyerName.trim() || 'Walk-In', buyer_email: buyerEmail.trim(), buyer_phone: '',
      status: isPreSale ? 'valid' : 'checked_in', total_amount: eff.grandTotal,
      ticket_subtotal: eff.ticketTotal, sales_tax: eff.salesTax,
      service_fees: eff.serviceFees, processing_fee: eff.processingFee,
      stripe_payment_intent_id: paymentIntentId, source: 'door',
    }).select().single();
    if (orderError) { alert('Order save failed. Payment ref: ' + paymentIntentId); return; }
    await supabase.from('order_items').insert(soldItems.map(i => ({
      order_id: order.id, ticket_type_id: i.ticketTypeId,
      ticket_type_name: i.type, quantity: i.qty, unit_price: i.price,
    })));
    for (const item of soldItems) await supabase.rpc('increment_sold', { tid: item.ticketTypeId, qty: item.qty });
    fetch(API_BASE+'/api/tag-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doorSession?.access_token || ''}` },
      body: JSON.stringify({
        paymentIntentId,
        orderId: order.id,
        buyerName: buyerName.trim() || 'Walk-In',
        eventTitle: ev?.title || '',
        ticketSummary: soldItems.map(i => `${i.qty}x ${i.type}`).join(', '),
      }),
    }).catch(() => {});
    if (buyerEmail.trim()) {
      fetch(API_BASE + '/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doorSession?.access_token || ''}` },
        body: JSON.stringify({
          order: {
            id: order.id,
            items: soldItems.map(i => ({ type: i.type, qty: i.qty, price: i.price })),
            salesTax: eff.salesTax,
            serviceFees: eff.serviceFees,
            processingFee: eff.processingFee,
            total: eff.grandTotal,
          },
          event: {
            title: ev?.title || '',
            category: ev?.category || '',
            date: fmtDate(ev?.date || ''),
            time: fmtTime(ev?.time || ''),
            doors: fmtTime(ev?.doors || ''),
          },
          venue: { name: venue.name, location: venue.location },
        }),
      }).catch(() => {});
    }
    const localOrder = {
      id: order.id, eventId: selEventId, venueId: venue.id,
      buyer: { name: buyerName.trim() || 'Walk-In', email: buyerEmail.trim(), phone: '' },
      items: soldItems.map(i => ({ type: i.type, qty: i.qty, price: i.price, ticketTypeId: i.ticketTypeId })),
      ticketTotal: eff.ticketTotal, salesTax: eff.salesTax,
      serviceFees: eff.serviceFees, processingFee: eff.processingFee,
      total: eff.grandTotal, date: new Date().toISOString(), checkedIn: !isPreSale, source: 'door',
      stripePaymentIntentId: paymentIntentId || null,
    };
    updateOrders(prev => [...prev, localOrder]);
    updateEvents(evts => evts.map(e => e.id !== selEventId ? e : {
      ...e, tickets: e.tickets.map((t, i) => ({ ...t, available: t.available - (doorCart[i] || 0) }))
    }));
    setLastSale(localOrder);
    setStep('confirm');
  };

  const startCash = () => {
    if (!ev || cartN === 0) return;
    const salesTax = Math.round(cartTotal * 0.06 * 100) / 100;
    const serviceFees = cartN * 2.00;
    setCashAmounts({ ticketTotal: cartTotal, salesTax, serviceFees, processingFee: 0, grandTotal: Math.round((cartTotal + salesTax + serviceFees) * 100) / 100 });
    setStep('cash');
  };

  const handleCashSale = async () => {
    const soldItems = cartItems.filter(i => i.qty > 0).map(i => ({ type: i.type, qty: i.qty, price: i.effectivePrice, ticketTypeId: i.id }));
    const ref = 'CASH-' + Date.now();
    const { data: { session: cashSession } } = await supabase.auth.getSession();
    const { data: order, error: orderError } = await supabase.from('orders').insert({
      tenant_id: TENANT_ID, event_id: selEventId,
      buyer_name: buyerName.trim() || 'Walk-In', buyer_email: buyerEmail.trim(), buyer_phone: '',
      status: isPreSale ? 'valid' : 'checked_in', total_amount: cashAmounts.grandTotal,
      ticket_subtotal: cashAmounts.ticketTotal, sales_tax: cashAmounts.salesTax,
      service_fees: cashAmounts.serviceFees, processing_fee: 0,
      stripe_payment_intent_id: ref, source: 'door_cash',
    }).select().single();
    if (orderError) { alert('Order save failed. Please try again.'); return; }
    await supabase.from('order_items').insert(soldItems.map(i => ({
      order_id: order.id, ticket_type_id: i.ticketTypeId,
      ticket_type_name: i.type, quantity: i.qty, unit_price: i.price,
    })));
    for (const item of soldItems) await supabase.rpc('increment_sold', { tid: item.ticketTypeId, qty: item.qty });
    if (buyerEmail.trim()) {
      fetch(API_BASE + '/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cashSession?.access_token || ''}` },
        body: JSON.stringify({
          order: {
            id: order.id,
            items: soldItems.map(i => ({ type: i.type, qty: i.qty, price: i.price })),
            salesTax: cashAmounts.salesTax,
            serviceFees: cashAmounts.serviceFees,
            processingFee: 0,
            total: cashAmounts.grandTotal,
          },
          event: {
            title: ev?.title || '',
            category: ev?.category || '',
            date: fmtDate(ev?.date || ''),
            time: fmtTime(ev?.time || ''),
            doors: fmtTime(ev?.doors || ''),
          },
          venue: { name: venue.name, location: venue.location },
        }),
      }).catch(() => {});
    }
    const localOrder = {
      id: order.id, eventId: selEventId, venueId: venue.id,
      buyer: { name: buyerName.trim() || 'Walk-In', email: buyerEmail.trim(), phone: '' },
      items: soldItems.map(i => ({ type: i.type, qty: i.qty, price: i.price })),
      ticketTotal: cashAmounts.ticketTotal, salesTax: cashAmounts.salesTax,
      serviceFees: cashAmounts.serviceFees, processingFee: 0,
      total: cashAmounts.grandTotal, date: new Date().toISOString(), checkedIn: !isPreSale, source: 'door_cash',
    };
    updateOrders(prev => [...prev, localOrder]);
    updateEvents(evts => evts.map(e => e.id !== selEventId ? e : {
      ...e, tickets: e.tickets.map((t, i) => ({ ...t, available: t.available - (doorCart[i] || 0) }))
    }));
    setLastSale(localOrder);
    setStep('confirm');
  };

  const reset = () => { setStep('select'); setDoorCart({}); setBuyerName(''); setBuyerEmail(''); setClientSecret(null); setAmounts(null); setCashAmounts(null); setTendered(''); setLastSale(null); setTerminalAmounts(null); setTerminalPaymentStatus('idle'); setIsPreSale(false); };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24,flexWrap:'wrap',gap:10}}>
        <h2 className="dsp" style={{fontSize:26}}>Door Sales</h2>
        {step !== 'select' && <button className="btn" onClick={reset}>← New Sale</button>}
      </div>

      {step === 'select' && <>
        <div className="fg" style={{marginBottom:16}}>
          <label className="fl">Event</label>
          <select className="fi" value={selEventId} onChange={e => { setSelEventId(e.target.value); setDoorCart({}); }}>
            <option value="">— Select Event —</option>
            {events.map(e => <option key={e.id} value={e.id}>{e.title} — {fmtDate(e.date)}</option>)}
          </select>
        </div>
        {ev && <>
          {ev.tickets.map((t, i) => {
            const dp = t.doorPrice ?? t.price;
            const qty = doorCart[i] || 0;
            return <div className="tkt-row" key={i}>
              <div className="tkt-info">
                <h4>{t.type}</h4>
                {t.doorPrice != null && t.doorPrice !== t.price
                  ? <p style={{fontSize:11,color:'var(--text3)'}}>Presale <s>{fmtCurrency(t.price)}</s> · Door <span style={{color:'var(--gold)'}}>{fmtCurrency(t.doorPrice)}</span></p>
                  : <p style={{fontSize:11,color:'var(--text3)'}}>Door price</p>}
              </div>
              <div className="tkt-price">{fmtCurrency(dp)}</div>
              <div className="qty">
                <button className="qb" disabled={qty===0} onClick={()=>setDoorCart({...doorCart,[i]:qty-1})}>−</button>
                <div className="qv">{qty}</div>
                <button className="qb" disabled={qty>=t.available||t.available===0} onClick={()=>setDoorCart({...doorCart,[i]:qty+1})}>+</button>
              </div>
            </div>;
          })}
          {cartN > 0 && <div className="cart-sum" style={{margin:'12px 0'}}>
            {cartItems.filter(i=>i.qty>0).map((t,i)=><div className="cart-ln" key={i}><span>{t.qty}× {t.type}</span><span>{fmtCurrency(t.qty*t.effectivePrice)}</span></div>)}
            <div className="cart-tot"><span>Subtotal (before fees)</span><span>{fmtCurrency(cartTotal)}</span></div>
          </div>}
          <div className="fg" style={{marginBottom:10,marginTop:4}}>
            <label className="fl">Customer Name <span style={{fontWeight:400,color:'var(--text3)'}}>(optional)</span></label>
            <input className="fi" value={buyerName} onChange={e=>setBuyerName(e.target.value)} placeholder="Walk-In" />
          </div>
          <div className="fg" style={{marginBottom:16}}>
            <label className="fl">Email for Receipt <span style={{fontWeight:400,color:'var(--text3)'}}>{isPreSale ? '(required for pre sale)' : '(optional)'}</span></label>
            <input className="fi" type="email" value={buyerEmail} onChange={e=>setBuyerEmail(e.target.value)} placeholder={isPreSale ? 'customer@email.com' : 'Leave blank to skip'} />
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16,padding:'10px 14px',background:'var(--surface2)',borderRadius:'var(--rs)',cursor:'pointer'}} onClick={()=>setIsPreSale(p=>!p)}>
            <input type="checkbox" id="presale-cb" checked={isPreSale} onChange={()=>{}} style={{width:17,height:17,accentColor:'var(--gold)',cursor:'pointer',flexShrink:0}} />
            <label htmlFor="presale-cb" style={{cursor:'pointer',fontWeight:600,fontSize:14,userSelect:'none'}}>Pre Sale — sell without checking in</label>
          </div>
          <div style={{display:'flex',gap:10}}>
            <button className="buy" style={{flex:1}} disabled={cartN===0||loadingIntent||(isPreSale&&!buyerEmail.trim())} onClick={connectedReader ? startTerminalPayment : startPayment}>
              {loadingIntent ? 'Preparing…' : connectedReader ? '💳 Charge Card (Reader)' : '💳 Charge Card (Online)'}
            </button>
            <button className="buy" style={{flex:1,background:'var(--green)',borderColor:'var(--green)'}} disabled={cartN===0||(isPreSale&&!buyerEmail.trim())} onClick={startCash}>
              💵 Cash Sale
            </button>
          </div>
          <div style={{marginTop:18,padding:'12px 16px',background:'var(--surface2)',borderRadius:'var(--rs)',fontSize:13}}>
            {connectedReader ? (
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
                <span style={{color:'var(--green)',fontWeight:600}}>Reader: {connectedReader.label || connectedReader.serial_number}</span>
                <button className="btn" style={{padding:'4px 10px',fontSize:12}} onClick={disconnectReader}>Disconnect</button>
              </div>
            ) : (
              <div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom: readers.length > 0 ? 10 : 0}}>
                  <span style={{color:'var(--text3)'}}>No reader connected</span>
                  <button className="btn" style={{padding:'4px 10px',fontSize:12}} disabled={readerDiscovering} onClick={initAndDiscover}>
                    {readerDiscovering ? 'Searching…' : 'Find Reader'}
                  </button>
                </div>
                {readerError && <p style={{color:'var(--red)',fontSize:12,marginTop:6,marginBottom:0}}>{readerError}</p>}
                {readers.length > 0 && (
                  <div style={{display:'flex',flexDirection:'column',gap:6}}>
                    {readers.map(r => (
                      <div key={r.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'var(--surface)',borderRadius:6,padding:'6px 10px'}}>
                        <span style={{fontSize:13}}>{r.label || r.serial_number}</span>
                        <button className="btn" style={{padding:'4px 10px',fontSize:12}} disabled={readerConnecting} onClick={() => connectToReader(r)}>
                          {readerConnecting ? 'Connecting…' : 'Connect'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>}
      </>}

      {step === 'cash' && cashAmounts && (
        <div style={{maxWidth:400}}>
          <h3 className="dsp" style={{fontSize:18,marginBottom:20}}>Collect Cash</h3>
          <div className="tkt-sec" style={{marginBottom:20}}>
            <div className="cart-ln"><span>Ticket Subtotal</span><span>{fmtCurrency(cashAmounts.ticketTotal)}</span></div>
            <div className="cart-ln"><span>Sales Tax (6%)</span><span>${cashAmounts.salesTax.toFixed(2)}</span></div>
            <div className="cart-ln"><span>Service Fee ({cartN} × $2.00)</span><span>{fmtCurrency(cashAmounts.serviceFees)}</span></div>
            <div className="cart-tot"><span>Collect From Customer</span><span>{fmtCurrency(cashAmounts.grandTotal)}</span></div>
          </div>
          <p style={{fontSize:12,color:'var(--text3)',marginBottom:16}}>No card processing fee — cash only.</p>
          <div className="fg" style={{marginBottom:12}}>
            <label className="fl">Amount Tendered</label>
            <input className="fi" type="number" min="0" step="0.01" placeholder={`${cashAmounts.grandTotal.toFixed(2)}`} value={tendered} onChange={e=>setTendered(e.target.value)} />
          </div>
          {tendered !== '' && (() => {
            const t = parseFloat(tendered); const change = t - cashAmounts.grandTotal;
            return change < 0
              ? <div style={{padding:'10px 14px',borderRadius:'var(--rs)',background:'rgba(179,58,42,.15)',color:'var(--red)',fontWeight:700,fontSize:14,marginBottom:12}}>Short by {fmtCurrency(Math.abs(change))}</div>
              : <div style={{padding:'10px 14px',borderRadius:'var(--rs)',background:'rgba(93,138,60,.15)',color:'var(--green)',fontWeight:700,fontSize:22,marginBottom:12,textAlign:'center'}}>Change: {fmtCurrency(change)}</div>;
          })()}
          <button className="buy" style={{background:'var(--green)',borderColor:'var(--green)',marginBottom:8}} disabled={tendered===''||parseFloat(tendered)<cashAmounts.grandTotal} onClick={handleCashSale}>
            ✓ Cash Collected — Complete Sale
          </button>
          <button className="btn" style={{width:'100%'}} onClick={()=>setStep('select')}>← Back</button>
        </div>
      )}

      {step === 'terminal_payment' && terminalAmounts && (
        <div style={{maxWidth:400,textAlign:'center',paddingTop:20}}>
          <h3 className="dsp" style={{fontSize:20,marginBottom:20}}>Card Reader</h3>
          <div className="tkt-sec" style={{marginBottom:24,textAlign:'left'}}>
            {terminalAmounts.resolvedItems?.map((i,idx) => (
              <div className="cart-ln" key={idx}><span>{i.qty}× {i.type}</span><span>{fmtCurrency(i.qty * i.price)}</span></div>
            ))}
            <div className="cart-ln"><span>Sales Tax (6%)</span><span>${terminalAmounts.salesTax?.toFixed(2)}</span></div>
            <div className="cart-ln"><span>Service Fee</span><span>{fmtCurrency(terminalAmounts.serviceFees)}</span></div>
            <div className="cart-ln"><span>Processing Fee</span><span>{fmtCurrency(terminalAmounts.processingFee)}</span></div>
            <div className="cart-tot"><span>Total</span><span>{fmtCurrency(terminalAmounts.grandTotal)}</span></div>
          </div>
          {terminalPaymentStatus === 'waiting_for_card' && (
            <>
              <div style={{fontSize:48,marginBottom:12}}>💳</div>
              <p style={{color:'var(--text2)',marginBottom:20}}>Present card to reader…</p>
              <button className="btn" style={{width:'100%'}} onClick={cancelTerminalPayment}>Cancel</button>
            </>
          )}
          {terminalPaymentStatus === 'processing' && (
            <>
              <div style={{fontSize:48,marginBottom:12}}>⏳</div>
              <p style={{color:'var(--text2)'}}>Processing payment…</p>
            </>
          )}
        </div>
      )}

      {step === 'payment' && clientSecret && (
        <Elements stripe={stripePromise} options={{clientSecret,appearance:{theme:'night',variables:{colorPrimary:'#c8922a',fontFamily:'Barlow, sans-serif'}}}}>
          <CheckoutForm cartTotal={cartTotal} totalTickets={cartN} paymentAmounts={amounts}
            onSuccess={handleSuccess}
            onBack={()=>{ setStep('select'); setClientSecret(null); setAmounts(null); }} />
        </Elements>
      )}

      {step === 'confirm' && lastSale && (
        <div style={{textAlign:'center',maxWidth:420,margin:'0 auto',paddingTop:20}}>
          <div style={{fontSize:48,marginBottom:12}}>✅</div>
          <h3 className="dsp" style={{fontSize:24,marginBottom:6}}>Sale Complete</h3>
          <p style={{color:'var(--text2)',fontSize:14,marginBottom:4}}>{lastSale.buyer.name}</p>
          <p style={{color:'var(--gold)',fontWeight:700,fontSize:20,marginBottom:24}}>{fmtCurrency(lastSale.total)}</p>
          <div style={{background:'white',borderRadius:12,padding:16,display:'inline-block',marginBottom:16}}>
            <QRImg value={`${APP_URL}/t/${lastSale.id}?receipt=1`} size={180} />
          </div>
          <p style={{fontFamily:'monospace',fontSize:11,color:'var(--gold)',letterSpacing:1,marginBottom:4,fontWeight:700}}>{lastSale.checkedIn ? `CHECKED IN${lastSale.source==='door_cash'?' · CASH':''}` : `PRE SALE${lastSale.source==='door_cash'?' · CASH':''} · TICKET EMAILED`}</p>
          <p style={{fontFamily:'monospace',fontSize:10,color:'var(--text3)',marginBottom:28,letterSpacing:.5}}>{lastSale.id.toUpperCase()}</p>
          <button className="buy" style={{maxWidth:260,margin:'0 auto',display:'block'}} onClick={reset}>+ New Sale</button>
        </div>
      )}
    </div>
  );
};

const LiveDash = ({ events, orders }) => {
  const [selEventId, setSelEventId] = useState('');
  const [checkedInIds, setCheckedInIds] = useState(new Set());

  useEffect(() => {
    if (selEventId || events.length === 0) return;
    const upcoming = [...events].sort((a, b) => new Date(a.date) - new Date(b.date))
      .find(e => new Date(e.date) >= new Date(Date.now() - 86400000));
    setSelEventId(upcoming?.id || events[0]?.id || '');
  }, [events, selEventId]);

  useEffect(() => {
    if (!selEventId) return;
    const refresh = async () => {
      const { data } = await supabase.from('orders').select('id, status').eq('event_id', selEventId);
      if (data) setCheckedInIds(new Set(data.filter(r => r.status === 'checked_in').map(r => r.id)));
    };
    refresh();
    const ch = supabase.channel('live-' + selEventId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `event_id=eq.${selEventId}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selEventId]);

  const ev = events.find(e => e.id === selEventId);
  const evOrders = orders.filter(o => o.eventId === selEventId && o.status !== 'cancelled');
  const ciOrders = evOrders.filter(o => checkedInIds.has(o.id));
  const totalTix = evOrders.reduce((s, o) => s + o.items.reduce((a, i) => a + i.qty, 0), 0);
  const ciTix = ciOrders.reduce((s, o) => s + o.items.reduce((a, i) => a + i.qty, 0), 0);
  const pct = totalTix > 0 ? Math.round(ciTix / totalTix * 100) : 0;
  const capacity = ev ? ev.tickets.reduce((s, t) => s + (t.total ?? t.available), 0) : 0;

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24,flexWrap:'wrap',gap:12}}>
        <h2 className="dsp" style={{fontSize:26}}>Live Check-In</h2>
        <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
          <select className="fi" style={{maxWidth:280,margin:0}} value={selEventId} onChange={e=>setSelEventId(e.target.value)}>
            {events.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <div style={{fontSize:11,color:'var(--green)',display:'flex',alignItems:'center',gap:5,fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:'var(--green)',display:'inline-block',animation:'pulse 2s ease-in-out infinite'}}></span>Live
          </div>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:12,marginBottom:24}}>
        {[{l:'Checked In',v:ciTix,c:'var(--green)'},{l:'Remaining',v:totalTix-ciTix,c:'var(--gold)'},{l:'Total Sold',v:totalTix},{l:'Capacity',v:capacity}].map(s=>(
          <div key={s.l} className="sc" style={{textAlign:'center'}}>
            <div className="l">{s.l}</div>
            <div className="v" style={{fontSize:42,color:s.c||'var(--text)'}}>{s.v}</div>
          </div>
        ))}
      </div>

      {totalTix > 0 && <div style={{marginBottom:24}}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text2)',marginBottom:8}}>
          <span>Check-in Progress</span>
          <span style={{color:'var(--gold)',fontWeight:700,fontSize:15}}>{pct}%</span>
        </div>
        <div style={{height:16,background:'var(--bg3)',borderRadius:99,overflow:'hidden'}}>
          <div style={{height:'100%',width:pct+'%',background:'linear-gradient(90deg,#5d8a3c,#7bc74d)',borderRadius:99,transition:'width .8s ease'}} />
        </div>
      </div>}

      {ev && ev.tickets.length > 0 && <div style={{marginBottom:24}}>
        <h3 className="dsp" style={{fontSize:15,marginBottom:14}}>By Ticket Type</h3>
        {ev.tickets.map(t=>{
          const tierSold = evOrders.reduce((s,o)=>s+o.items.filter(i=>i.type===t.type).reduce((a,i)=>a+i.qty,0),0);
          const tierCi = ciOrders.reduce((s,o)=>s+o.items.filter(i=>i.type===t.type).reduce((a,i)=>a+i.qty,0),0);
          const tPct = tierSold>0?Math.round(tierCi/tierSold*100):0;
          return <div key={t.id} style={{marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:5}}>
              <span style={{color:'var(--text)',fontWeight:600}}>{t.type}</span>
              <span style={{color:'var(--text2)'}}>{tierCi} / {tierSold} checked in &nbsp;·&nbsp; {t.total??t.available} cap</span>
            </div>
            <div style={{height:8,background:'var(--bg3)',borderRadius:99,overflow:'hidden'}}>
              <div style={{height:'100%',width:tPct+'%',background:'var(--gold)',borderRadius:99,transition:'width .8s ease'}} />
            </div>
          </div>;
        })}
      </div>}

      {ciOrders.length > 0
        ? <div><h3 className="dsp" style={{fontSize:15,marginBottom:12}}>Checked In ({ciOrders.length} orders)</h3>
            <div style={{overflowX:'auto'}}><table className="dt"><thead><tr><th>Name</th><th>Tickets</th></tr></thead>
              <tbody>{ciOrders.map(o=><tr key={o.id}><td>{o.buyer.name}</td><td style={{fontSize:11}}>{o.items.map(i=>`${i.qty}× ${i.type}`).join(', ')}</td></tr>)}</tbody>
            </table></div></div>
        : <div className="empty"><div className="ic">📡</div><p>{totalTix>0?'No check-ins yet — standing by…':'No orders found for this event.'}</p></div>
      }
    </div>
  );
};

export default function App() {
  const { venues, events, loaded, updateEvents, updateVenues } = useStorage();
  const [orders, setOrders] = useState([]);
  const updateOrders = useCallback((d) => setOrders(d), []);
  const [view, setView] = useState(() => window.location.pathname === '/sell' ? 'sell' : 'home');
  const [selId, setSelId] = useState(null);
  const [cart, setCart] = useState({});
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const [lastOrder, setLastOrder] = useState(null);
  const [aTab, setATab] = useState("dashboard");
  const [dashFilter, setDashFilter] = useState('month');
  const [dashCustomStart, setDashCustomStart] = useState('');
  const [dashCustomEnd, setDashCustomEnd] = useState('');
  const [reportFilter, setReportFilter] = useState('month');
  const [reportCustomStart, setReportCustomStart] = useState('');
  const [reportCustomEnd, setReportCustomEnd] = useState('');
  const [holdbackPct, setHoldbackPct] = useState(10);
  const [platformFeePct, setPlatformFeePct] = useState(2.5);
  const [bkVenueFilter, setBkVenueFilter] = useState('all');
  const [filter, setFilter] = useState("All");
  const [venueFilter, setVenueFilter] = useState('All');
  const [venueProfileId, setVenueProfileId] = useState(null);
  const [editEvt, setEditEvt] = useState(null);
  const [modal, setModal] = useState(false);
  const [session, setSession] = useState(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [clientSecret, setClientSecret] = useState(null);
  const [paymentAmounts, setPaymentAmounts] = useState(null);
  const [creatingPayment, setCreatingPayment] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
const [resetSent, setResetSent] = useState(false);
const [resetError, setResetError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [adminScan, setAdminScan] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);
  const [sendingReminder, setSendingReminder] = useState(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderSourceFilter, setOrderSourceFilter] = useState('all');
  const [soldOutError, setSoldOutError] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupStep, setLookupStep] = useState('email');
  const [lookupError, setLookupError] = useState('');
  const [ticketResendEmail, setTicketResendEmail] = useState('');
  const [ticketResendSending, setTicketResendSending] = useState(false);
  const [ticketResendSent, setTicketResendSent] = useState(false);
  const [generatingPhysical, setGeneratingPhysical] = useState(false);
  const [ticketSizeModal, setTicketSizeModal] = useState(null);
  const [ticketSizeSelected, setTicketSizeSelected] = useState('strip');
  const [ticketSizeCustomW, setTicketSizeCustomW] = useState('5.5');
  const [ticketSizeCustomH, setTicketSizeCustomH] = useState('2');
  const [editEmailOrder, setEditEmailOrder] = useState(null);
  const [editEmailValue, setEditEmailValue] = useState('');
  const [editEmailSaving, setEditEmailSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [ticketOrderId, setTicketOrderId] = useState(null);
  const [ticketPageData, setTicketPageData] = useState(null);
  const [ticketPageLoading, setTicketPageLoading] = useState(false);
  const [ticketReceiptMode, setTicketReceiptMode] = useState(false);
  const [ticketFilterId, setTicketFilterId] = useState(null);
  const [expandedOrders, setExpandedOrders] = useState(new Set());
  const [expandedTickets, setExpandedTickets] = useState({});
  const [togglingPublish, setTogglingPublish] = useState(new Set());
  const [expandedPromos, setExpandedPromos] = useState(new Set());
  const [promoUsage, setPromoUsage] = useState({});
  const [promoInput, setPromoInput] = useState('');
  const [promoApplied, setPromoApplied] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState('');
  const [promos, setPromos] = useState([]);
  const [promosLoaded, setPromosLoaded] = useState(false);
  const [promoForm, setPromoForm] = useState({ code: '', discountType: 'percent', discountValue: '', maxUses: '', eventId: '', expiresAt: '' });
  const [promoSaving, setPromoSaving] = useState(false);
  const [sellForm, setSellForm] = useState({ name:'', email:'', phone:'', eventName:'', location:'', date:'', attendance:'', channel:'both', notes:'' });
  const [sellStatus, setSellStatus] = useState('idle');
  const [venueUsers, setVenueUsers] = useState([]);
  const [venueUsersLoaded, setVenueUsersLoaded] = useState(false);
  const [venueUserForm, setVenueUserForm] = useState({ email:'', password:'', tenantId:'', role:'venue' });
  const [venueUserSaving, setVenueUserSaving] = useState(false);
  const [venueUserError, setVenueUserError] = useState('');
  const [venueUserSuccess, setVenueUserSuccess] = useState('');
  const [venueFormOpen, setVenueFormOpen] = useState(false);
  const [editingVenueId, setEditingVenueId] = useState(null);
  const [venueForm, setVenueForm] = useState({ name:'', address:'', contactPhone:'', contactEmail:'', website:'', ownerName:'', ownerPhone:'', notes:'' });
  const [venueSaving, setVenueSaving] = useState(false);
  const [venueError, setVenueError] = useState('');
  const [venueSuccess, setVenueSuccess] = useState('');

  const venue = venues.find(v => v.id === TENANT_ID) || venues[0] || DEFAULT_VENUE;
  const sel = events.find(e => e.id === selId) || null;
  const selVenue = (sel ? venues.find(v => v.id === sel.venueId) : null) || venue;
  const isGate = session?.user?.user_metadata?.role === 'gate';
  const isVenueUser = session?.user?.user_metadata?.role === 'venue';
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (_event === 'PASSWORD_RECOVERY') setView('reset');
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    const LIMIT = 2 * 60 * 60 * 1000;
    const stamp = () => localStorage.setItem('_c8last', String(Date.now()));
    stamp();
    const evts = ['mousedown', 'keydown', 'touchstart', 'pointermove'];
    evts.forEach(e => window.addEventListener(e, stamp, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - parseInt(localStorage.getItem('_c8last') || '0', 10) > LIMIT) {
        supabase.auth.signOut().then(() => setView('home'));
      }
    }, 60_000);
    return () => { evts.forEach(e => window.removeEventListener(e, stamp)); clearInterval(timer); };
  }, [session]);

  useEffect(() => {
    if (!session) { setOrders([]); return; }
    supabase
      .from('orders')
      .select('*, order_items(*)')
      .then(({ data, error }) => {
        if (error) { console.error(error); return; }
        setOrders((data || []).map(o => ({
          id: o.id,
          eventId: o.event_id,
          venueId: o.tenant_id,
          buyer: { name: o.buyer_name, email: o.buyer_email, phone: o.buyer_phone || "" },
          items: (o.order_items || []).map(i => ({ type: i.ticket_type_name, qty: i.quantity, price: Number(i.unit_price), ticketTypeId: i.ticket_type_id })),
          total: Number(o.total_amount),
          ticketSubtotal: o.ticket_subtotal != null ? Number(o.ticket_subtotal) : null,
          salesTax: o.sales_tax != null ? Number(o.sales_tax) : null,
          serviceFees: o.service_fees != null ? Number(o.service_fees) : null,
          processingFee: o.processing_fee != null ? Number(o.processing_fee) : null,
          date: o.created_at,
          status: o.status,
          checkedIn: o.status === 'checked_in',
          stripePaymentIntentId: o.stripe_payment_intent_id || null,
          source: o.source || 'online',
        })));
      });
  }, [session]);

  useEffect(() => {
    if (!loaded) return;
    const pathMatch = window.location.pathname.match(/^\/e\/([0-9a-f-]{36})$/i);
    const eventId = pathMatch ? pathMatch[1] : new URLSearchParams(window.location.search).get('event');
    if (eventId) {
      const ev = events.find(e => e.id === eventId);
      if (ev && ev.published === false && !session) { setView('home'); }
      else { setSelId(eventId); setCart({}); setView('detail'); }
    }
    const ticketMatch = window.location.pathname.match(/^\/t\/([0-9a-f-]{36})$/i);
    if (ticketMatch) {
      const params = new URLSearchParams(window.location.search);
      setTicketOrderId(ticketMatch[1]);
      setTicketReceiptMode(params.get('receipt') === '1');
      setTicketFilterId(params.get('ticket') || null);
      setTicketResendEmail(''); setTicketResendSent(false);
      setView('mytickets');
    }
    const venueMatch = window.location.pathname.match(/^\/v\/([^/]+)$/i);
    if (venueMatch) {
      const slugMatch = venues.find(v => v.slug === venueMatch[1]);
      if (slugMatch) { setVenueProfileId(slugMatch.id); setView('venue'); }
    }
  }, [loaded, venues]);

  useEffect(() => {
    if (view !== 'mytickets' || !ticketOrderId) return;
    setTicketPageLoading(true);
    setTicketPageData(null);
    (async () => {
      const res = await fetch(`${API_BASE}/api/get-order?id=${ticketOrderId}`);
      if (!res.ok) { setTicketPageLoading(false); return; }
      const { order, tickets } = await res.json();
      setTicketPageData({ order, tickets });
      setTicketPageLoading(false);
    })();
  }, [view, ticketOrderId]);

  useEffect(() => {
    const base = 'C8Tickets';
    const selTitle = events.find(e => e.id === selId)?.title;
    let title = base;
    let desc = 'Buy tickets to live events at Crooked 8 in Kuna, Idaho. Concerts, rodeos, and more — get your tickets online in minutes.';
    let path = '/';

    if (view === 'detail' && selTitle) { title = `${selTitle} — ${base}`; }
    else if (view === 'checkout') { title = `Checkout — ${base}`; }
    else if (view === 'ticket' || view === 'mytickets') { title = `Your Tickets — ${base}`; }
    else if (view === 'admin') { title = `Admin — ${base}`; }
    else if (view === 'lookup') { title = `Find My Tickets — ${base}`; }
    else if (view === 'venue') { const vp = venues.find(v => v.id === venueProfileId); if (vp) title = `${vp.name} — ${base}`; }
    else if (view === 'sell') {
      title = 'Sell Event Tickets Online — Treasure Valley & Idaho | C8Tickets';
      desc = 'C8Tickets is the local ticketing platform built for bars, venues, and event organizers in Boise, Nampa, Meridian, Kuna, and across the Treasure Valley. Online sales, door sales, QR check-in, and real-time dashboards — no setup fees.';
      path = '/sell';
    }

    document.title = title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', desc);

    if (window.location.pathname !== path) {
      window.history.replaceState(null, '', path);
    }
  }, [view, selId, events, venue]);

const login = async () => {
  setAuthError('');
  const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
  if (error) { setAuthError(error.message); return; }
  const role = data.user?.user_metadata?.role;
  if (role === 'gate') setView('gate');
  else if (role === 'admin' || role === 'venue') setView('admin');
  else { await supabase.auth.signOut(); setAuthError('Access denied. Contact your administrator.'); }
};

const sendReset = async () => {
  setResetError('');
  const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
    redirectTo: 'https://c8tickets.com/?reset=true',
  });
  if (error) setResetError(error.message);
  else setResetSent(true);
};

const updatePassword = async (newPassword) => {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) setAuthError(error.message);
  else setView('home');
};

const logout = async () => {
  await supabase.auth.signOut();
  setView('home');
};

const confirmCancelOrder = async () => {
  const o = cancelTarget;
  if (!o) return;
  setCancelling(true);
  const { data: { session: adminSession } } = await supabase.auth.getSession();
  try {
    if (o.stripePaymentIntentId && !o.stripePaymentIntentId.startsWith('CASH-')) {
      const refundRes = await fetch(API_BASE + '/api/refund-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminSession?.access_token || ''}` },
        body: JSON.stringify({ paymentIntentId: o.stripePaymentIntentId, orderId: o.id }),
      });
      const refundData = await refundRes.json();
      if (!refundRes.ok) {
        alert(`Refund failed: ${refundData.error || 'Unknown error'}. The order was not cancelled.`);
        return;
      }
    } else {
      await supabase.from('orders').update({ status: 'cancelled' }).eq('id', o.id);
    }
    for (const item of o.items) {
      if (item.ticketTypeId) await supabase.rpc('decrement_sold', { tid: item.ticketTypeId, qty: item.qty });
    }
    updateOrders(orders.map(ord => ord.id === o.id ? { ...ord, status: 'cancelled', checkedIn: false } : ord));
    updateEvents(events.map(ev => ev.id !== o.eventId ? ev : ({
      ...ev, tickets: ev.tickets.map(t => {
        const item = o.items.find(i => i.ticketTypeId === t.id);
        return item ? { ...t, available: t.available + item.qty } : t;
      })
    })));
    setCancelTarget(null);

    const ev = events.find(e => e.id === o.eventId);
    if (o.buyer?.email) {
      fetch(API_BASE + '/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminSession?.access_token || ''}` },
        body: JSON.stringify({
          type: 'cancellation',
          order: o,
          event: {
            title: ev?.title || '',
            date: ev ? fmtDate(ev.date) : '',
            time: ev ? fmtTime(ev.time) : '',
            category: ev?.category || '',
          },
          venue: { name: venue.name, location: venue.location },
        }),
      }).catch(err => console.error('Cancellation email error:', err));
    }
  } finally {
    setCancelling(false);
  }
};

const sendReminder = async (ev) => {
  const { data: { session: adminSession } } = await supabase.auth.getSession();
  setSendingReminder(ev.id);
  try {
    const res = await fetch(API_BASE + '/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminSession?.access_token || ''}` },
      body: JSON.stringify({ type: 'reminder', eventId: ev.id }),
    });
    const data = await res.json();
    if (!res.ok) { alert(`Failed to send reminders: ${data.error || 'Unknown error'}`); return; }
    alert(data.sent === 0 ? 'No confirmed orders found for this event.' : `Reminder sent to ${data.sent} of ${data.total} buyer${data.total !== 1 ? 's' : ''}.`);
  } catch {
    alert('Failed to send reminders — please try again.');
  } finally {
    setSendingReminder(null);
  }
};

const resendEmail = async (o) => {
  const ev = events.find(e => e.id === o.eventId);
  if (!o.buyer.email) { alert('No email address on file for this order.'); return; }
  const { data: { session: adminSession } } = await supabase.auth.getSession();
  const ticketTotal = o.items.reduce((s, i) => s + i.qty * i.price, 0);
  const totalQty = o.items.reduce((s, i) => s + i.qty, 0);
  const salesTax = Math.round(ticketTotal * 0.06 * 100) / 100;
  const serviceFees = totalQty * 2;
  const processingFee = Math.max(0, Math.round((o.total - ticketTotal - salesTax - serviceFees) * 100) / 100);
  const res = await fetch(API_BASE+'/api/send-email', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminSession?.access_token || ''}` },
    body: JSON.stringify({
      order: { id: o.id, buyer: o.buyer, items: o.items, salesTax, serviceFees, processingFee, total: o.total },
      event: { title: ev?.title || 'Event', category: ev?.category || '', date: fmtDate(ev?.date || ''), time: fmtTime(ev?.time || ''), doors: fmtTime(ev?.doors || '') },
      venue: { name: venue.name, location: venue.location },
    }),
  });
  alert(res.ok ? `Confirmation resent to ${o.buyer.email}` : 'Failed to send — check the email address and try again.');
};

const updateOrderEmail = async () => {
  if (!editEmailOrder) return;
  const newEmail = editEmailValue.trim();
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return;
  setEditEmailSaving(true);
  await supabase.from('orders').update({ buyer_email: newEmail }).eq('id', editEmailOrder.id);
  updateOrders(orders.map(o => o.id === editEmailOrder.id ? { ...o, buyer: { ...o.buyer, email: newEmail } } : o));
  setEditEmailSaving(false);
  setEditEmailOrder(null);
  setEditEmailValue('');
};

const applyPromo = async () => {
  const code = promoInput.trim().toUpperCase();
  if (!code) return;
  setPromoLoading(true);
  setPromoError('');
  try {
    const res = await fetch(API_BASE + '/api/promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'validate', code, eventId: sel?.id, tenantId: TENANT_ID }),
    });
    const data = await res.json();
    if (!res.ok) { setPromoError(data.error || 'Invalid promo code'); return; }
    setPromoApplied({ code, ...data });
    setPromoInput('');
  } catch { setPromoError('Could not validate code. Please try again.'); }
  finally { setPromoLoading(false); }
};

const loadPromos = async () => {
  const { data: { session: s } } = await supabase.auth.getSession();
  const res = await fetch(API_BASE + '/api/promo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token || ''}` },
    body: JSON.stringify({ action: 'list', tenantId: TENANT_ID }),
  });
  const data = await res.json();
  setPromos(data.promos || []);
  setPromosLoaded(true);
};

const savePromo = async () => {
  setPromoSaving(true);
  try {
    const { data: { session: s } } = await supabase.auth.getSession();
    const res = await fetch(API_BASE + '/api/promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token || ''}` },
      body: JSON.stringify({ action: 'create', tenantId: TENANT_ID, ...promoForm }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to create promo code'); return; }
    setPromos(prev => [data.promo, ...prev]);
    setPromoForm({ code: '', discountType: 'percent', discountValue: '', maxUses: '', eventId: '', expiresAt: '' });
  } catch { alert('Failed to create promo code'); }
  finally { setPromoSaving(false); }
};

const togglePromo = async (id, active) => {
  const { data: { session: s } } = await supabase.auth.getSession();
  await fetch(API_BASE + '/api/promo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token || ''}` },
    body: JSON.stringify({ action: 'toggle', id, active }),
  });
  setPromos(prev => prev.map(p => p.id === id ? { ...p, active } : p));
};

const deletePromo = async (id) => {
  if (!confirm('Delete this promo code?')) return;
  const { data: { session: s } } = await supabase.auth.getSession();
  await fetch(API_BASE + '/api/promo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token || ''}` },
    body: JSON.stringify({ action: 'delete', id }),
  });
  setPromos(prev => prev.filter(p => p.id !== id));
};

const loadPromoUsage = async (id) => {
  if (promoUsage[id]) return;
  const { data: { session: s } } = await supabase.auth.getSession();
  const res = await fetch(API_BASE + '/api/promo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token || ''}` },
    body: JSON.stringify({ action: 'usage', id }),
  });
  const data = await res.json();
  setPromoUsage(prev => ({ ...prev, [id]: data.orders || [] }));
};

const sendLookupCode = async () => {
  const email = lookupEmail.toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  setLookupLoading(true);
  setLookupError('');
  await fetch(API_BASE+'/api/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', email }) });
  setLookupLoading(false);
  setLookupStep('sent');
};

const sendTicketResend = async () => {
  const email = ticketResendEmail.toLowerCase().trim();
  if (!email || !ticketOrderId) return;
  setTicketResendSending(true);
  await fetch(API_BASE+'/api/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resend', orderId: ticketOrderId, email }) });
  setTicketResendSending(false);
  setTicketResendSent(true);
};

const openPrintPage = async (ev, tickets, venue, size = TICKET_SIZES[0]) => {
  const fs = size.fScale ?? 1;
  const r = (n) => Math.round(n * fs);
  const qrSz = r(88);
  const stubW = r(108);
  const qrDataUrls = await Promise.all(tickets.map(t => QRCodeLib.toDataURL(t.id, { width: qrSz, margin: 1 })));
  const hasImg = !!(ev.image && ev.image.startsWith('http'));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Physical Tickets — ${ev.title}</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#fff;font-family:'Helvetica Neue',Arial,sans-serif}
.toolbar{padding:16px 24px;background:#f5f3ef;border-bottom:1px solid #d9d0c0;display:flex;align-items:center;gap:16px}
.toolbar button{background:#c8922a;color:#fff;border:none;padding:10px 28px;font-size:14px;font-weight:700;border-radius:6px;cursor:pointer;letter-spacing:1px;text-transform:uppercase}
.toolbar p{font-size:13px;color:#6b5e47}
.sheet{padding:0.3in;display:grid;grid-template-columns:repeat(${size.cols},1fr);gap:0.15in}
.tkt{width:100%;${size.height?`min-height:${size.height};`:''}background:#1c1914;border:1.5px solid #c8922a;border-radius:8px;display:flex;overflow:hidden;position:relative;page-break-inside:avoid}
.tkt-img{position:absolute;inset:0;background-size:cover;background-repeat:no-repeat;opacity:0.18}
.tkt-body{flex:1;padding:${r(14)}px ${r(12)}px ${r(12)}px;display:flex;flex-direction:column;justify-content:space-between;border-right:1.5px dashed rgba(200,146,42,.35);position:relative;z-index:1}
.tkt-stub{width:${stubW}px;flex-shrink:0;padding:${r(12)}px ${r(10)}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${r(6)}px;position:relative;z-index:1}
.gold-bar{position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#c8922a,#f0c050,#c8922a);z-index:2}
.brand{font-size:${r(13)}px;font-weight:900;color:#c8922a;text-transform:uppercase;letter-spacing:3px;line-height:1}
.brand-loc{font-size:${r(7.5)}px;color:#7a6c54;text-transform:uppercase;letter-spacing:1.5px;margin-top:2px}
.evt-title{font-size:${r(15)}px;font-weight:800;color:#f0e9da;text-transform:uppercase;letter-spacing:.8px;line-height:1.2;margin:${r(8)}px 0 ${r(6)}px}
.evt-meta{font-size:${r(8.5)}px;color:#b5a78a;text-transform:uppercase;letter-spacing:.8px;line-height:2}
.tkt-type{margin-top:${r(8)}px;font-size:${r(8)}px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:2px;border:1px solid rgba(200,146,42,.5);border-radius:3px;padding:2px 7px;display:inline-block}
.admit{font-size:${r(7.5)}px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:2px}
.qr-wrap{background:#fff;padding:5px;border-radius:4px}
.tkt-id{font-size:${r(6.5)}px;color:#7a6c54;font-family:monospace;letter-spacing:.5px;text-align:center;word-break:break-all;line-height:1.4}
@media print{.toolbar{display:none}.sheet{padding:0.2in}.tkt{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:letter portrait;margin:0}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">🖨 Print / Save as PDF</button><p>${tickets.length} ticket${tickets.length!==1?'s':''} &nbsp;·&nbsp; ${size.sublabel} &nbsp;·&nbsp; Use "Save as PDF" to send to a print shop</p></div>
<div class="sheet">
${tickets.map((t,i)=>`<div class="tkt"><div class="gold-bar"></div>${hasImg?`<div class="tkt-img" style="background-image:url('${ev.image}');background-position:${ev.focalX??50}% ${ev.focalY??50}%"></div>`:''}<div class="tkt-body"><div><div class="brand">${venue.name}</div><div class="brand-loc">${venue.location}</div></div><div class="evt-title">${t.eventTitle}</div><div class="evt-meta">📅 ${t.date}${t.time?'<br>🕐 '+t.time:''}<br>📍 ${venue.location}</div><div><span class="tkt-type">${t.type}</span></div></div><div class="tkt-stub"><div class="admit">Admit One</div><div class="qr-wrap"><img src="${qrDataUrls[i]}" width="${qrSz}" height="${qrSz}" alt="QR"></div><div class="tkt-id">${t.id.slice(0,8).toUpperCase()}<br>${t.id.slice(9,17).toUpperCase()}</div></div></div>`).join('\n')}
</div></body></html>`;
  const win = window.open('', '_blank');
  if (!win) { alert('Pop-up blocked. Please allow pop-ups for this site and try again.'); return; }
  win.document.write(html); win.document.close();
};

const openPhotoPage = async (ev, tickets, venue, size = TICKET_SIZES[0]) => {
  const fs = size.fScale ?? 1;
  const r = (n) => Math.round(n * fs);
  const qrSz = r(72);
  const qrDataUrls = await Promise.all(tickets.map(t => QRCodeLib.toDataURL(t.id, { width: qrSz, margin: 1 })));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Photo Tickets — ${ev.title}</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f0ede8;font-family:'Helvetica Neue',Arial,sans-serif}
.toolbar{padding:16px 24px;background:#f5f3ef;border-bottom:1px solid #d9d0c0;display:flex;align-items:center;gap:16px}
.toolbar button{background:#c8922a;color:#fff;border:none;padding:10px 28px;font-size:14px;font-weight:700;border-radius:6px;cursor:pointer;letter-spacing:1px;text-transform:uppercase}
.toolbar p{font-size:13px;color:#6b5e47}
.sheet{padding:0.3in;display:grid;grid-template-columns:repeat(${size.cols},1fr);gap:0.18in}
.tkt{display:flex;height:${size.height ?? '2.4in'};background:#1c1914;border:1.5px solid #c8922a;border-radius:8px;overflow:hidden;page-break-inside:avoid;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.tkt-photo{width:${size.photoW ?? '33%'};flex-shrink:0;background-size:cover;background-repeat:no-repeat;position:relative}
.tkt-photo::after{content:'';position:absolute;inset:0;background:linear-gradient(to right,rgba(28,25,20,0) 40%,rgba(28,25,20,.75) 100%)}
.tkt-stripe{width:3px;flex-shrink:0;background:linear-gradient(to bottom,#c8922a,#f0c050,#c8922a)}
.tkt-main{flex:1;padding:${r(13)}px ${r(12)}px ${r(11)}px ${r(14)}px;display:flex;flex-direction:column;justify-content:space-between;min-width:0}
.brand{font-size:${r(11.5)}px;font-weight:900;color:#c8922a;text-transform:uppercase;letter-spacing:3px;line-height:1}
.brand-sub{font-size:${r(7)}px;color:#7a6c54;text-transform:uppercase;letter-spacing:1.5px;margin-top:2px}
.gold-rule{width:${r(32)}px;height:2px;background:#c8922a;margin:${r(7)}px 0 ${r(8)}px}
.evt-name{font-size:${r(15.5)}px;font-weight:800;color:#f0e9da;text-transform:uppercase;letter-spacing:.7px;line-height:1.18;margin-bottom:${r(5)}px}
.evt-date{font-size:${r(8)}px;color:#b5a78a;text-transform:uppercase;letter-spacing:1px;margin-bottom:${r(3)}px}
.evt-venue{font-size:${r(7)}px;color:#5e5040;text-transform:uppercase;letter-spacing:.5px}
.tkt-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:${r(8)}px}
.tier-label{font-size:${r(6.5)}px;color:#c8922a;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:${r(3)}px}
.tier-name{font-size:${r(10)}px;font-weight:800;color:#f0e9da;text-transform:uppercase;letter-spacing:1px;margin-bottom:${r(4)}px}
.tkt-code{font-size:${r(6.5)}px;color:#7a6c54;font-family:monospace;letter-spacing:1px}
.qr-box{background:#fff;padding:4px;border-radius:4px;flex-shrink:0}
.qr-box img{display:block}
.no-photo{background:linear-gradient(135deg,#2a2218 0%,#1c1914 60%,#0e0c09 100%)}
@media print{.toolbar{display:none}.sheet{padding:0.2in}.tkt{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-shadow:none}@page{size:letter portrait;margin:0}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">🖨 Print / Save as PDF</button><p>${tickets.length} ticket${tickets.length!==1?'s':''} &nbsp;·&nbsp; ${size.sublabel} &nbsp;·&nbsp; Save as PDF and send to your print shop</p></div>
<div class="sheet">
${tickets.map((t,i)=>{const hasImg=t.image&&t.image.startsWith('http');return`<div class="tkt">
  <div class="tkt-photo ${hasImg?'':'no-photo'}" style="${hasImg?`background-image:url('${t.image}');background-position:${t.focalX??50}% ${t.focalY??50}%`:''}"></div>
  <div class="tkt-stripe"></div>
  <div class="tkt-main">
    <div>
      <div class="brand">${venue.name}</div>
      <div class="brand-sub">${venue.location}</div>
      <div class="gold-rule"></div>
      <div class="evt-name">${t.eventTitle}</div>
      <div class="evt-date">${t.date}${t.time?' &nbsp;·&nbsp; '+t.time:''}</div>
      <div class="evt-venue">${venue.location}</div>
    </div>
    <div class="tkt-foot">
      <div>
        <div class="tier-label">Admit One</div>
        <div class="tier-name">${t.type}</div>
        <div class="tkt-code">#${t.id.slice(0,8).toUpperCase()}</div>
      </div>
      <div class="qr-box"><img src="${qrDataUrls[i]}" width="${qrSz}" height="${qrSz}" alt="QR"></div>
    </div>
  </div>
</div>`;}).join('\n')}
</div></body></html>`;
  const win = window.open('', '_blank');
  if (!win) { alert('Pop-up blocked. Please allow pop-ups for this site and try again.'); return; }
  win.document.write(html); win.document.close();
};

const fetchOrCreatePhysicalOrders = async (ev) => {
  const { data: existing } = await supabase
    .from('orders').select('id, order_items(ticket_type_name)')
    .eq('event_id', ev.id).eq('source', 'physical');
  if (existing && existing.length > 0) {
    return existing.map(o => ({ id: o.id, type: o.order_items?.[0]?.ticket_type_name || 'Ticket' }));
  }
  const results = [];
  for (const tier of ev.tickets.filter(t => (t.physicalQty ?? 0) > 0)) {
    for (let n = 0; n < tier.physicalQty; n++) {
      const { data: order, error } = await supabase.from('orders').insert({
        tenant_id: TENANT_ID, event_id: ev.id,
        buyer_name: 'Walk-In', buyer_email: 'physical@c8tickets.com', buyer_phone: '',
        status: 'confirmed', total_amount: tier.price, source: 'physical',
      }).select().single();
      if (error) { console.error(error); continue; }
      await supabase.from('order_items').insert({
        order_id: order.id, ticket_type_id: tier.id,
        ticket_type_name: tier.type, quantity: 1, unit_price: tier.price,
      });
      await supabase.rpc('increment_sold', { tid: tier.id, qty: 1 });
      results.push({ id: order.id, type: tier.type });
    }
  }
  return results;
};

const generatePhysicalTickets = async (ev, size = TICKET_SIZES[0]) => {
  if (!ev.tickets.some(t => (t.physicalQty ?? 0) > 0)) {
    alert('No physical tickets allocated. Edit the event and set a "Physical" quantity on at least one ticket tier.');
    return;
  }
  setGeneratingPhysical(ev.id);
  const orders = await fetchOrCreatePhysicalOrders(ev);
  setGeneratingPhysical(false);
  if (orders.length > 0) await openPrintPage(ev, orders.map(o => ({ ...o, eventTitle: ev.title, date: fmtDate(ev.date), time: fmtTime(ev.time) })), venue, size);
};

const generatePhotoTickets = async (ev, size = TICKET_SIZES[0]) => {
  if (!ev.tickets.some(t => (t.physicalQty ?? 0) > 0)) {
    alert('No physical tickets allocated. Edit the event and set a "Physical" quantity on at least one ticket tier.');
    return;
  }
  setGeneratingPhysical(ev.id + '-photo');
  const orders = await fetchOrCreatePhysicalOrders(ev);
  setGeneratingPhysical(false);
  if (orders.length > 0) await openPhotoPage(ev, orders.map(o => ({ ...o, eventTitle: ev.title, date: fmtDate(ev.date), time: fmtTime(ev.time), image: ev.image, focalX: ev.focalX, focalY: ev.focalY })), venue, size);
};
  const vEvents = events.filter(e => e.venueId === venue.id);
  const allPublicEvents = events.filter(e => e.published !== false);
  const publicEvents = venueFilter === 'All' ? allPublicEvents : allPublicEvents.filter(e => e.venueId === venueFilter);
  const CATS = ["All", "Live Music", "Rodeo", "Family", "Other Events"];
  const filtered = (filter === "All" ? publicEvents : publicEvents.filter(e => e.category === filter));
  const cartTotal = useMemo(() => sel ? sel.tickets.reduce((s, t, i) => s + (cart[i] || 0) * t.price, 0) : 0, [cart, sel]);
  const cartN = Object.values(cart).reduce((a, b) => a + b, 0);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email);
  const nameValid = buyer.name.trim().length >= 2;
  const buyerReady = nameValid && emailValid;


  const createPaymentIntent = async () => {
    setCreatingPayment(true);
    try {
      const items = sel.tickets.map((t, i) => ({ qty: cart[i] || 0, ticketTypeId: t.id })).filter(i => i.qty > 0);
      const res = await fetch(API_BASE + '/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          eventId: sel.id,
          tenantId: TENANT_ID,
          buyer: { name: buyer.name.trim(), email: buyer.email.trim(), phone: buyer.phone.trim() },
          eventMeta: { title: sel.title, date: fmtDate(sel.date), time: fmtTime(sel.time), doors: fmtTime(sel.doors), category: sel.category || '' },
          venueMeta: { name: selVenue.name, address: selVenue.location },
          promoCode: promoApplied?.code || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || 'Payment setup failed. Please try again.';
        if (res.status === 400 && data.error?.includes('remaining')) {
          setSoldOutError(data.error);
          // Refresh ticket availability so the cart reflects reality
          const { data: fresh } = await supabase.from('events').select('*, ticket_types(*)').eq('id', sel.id).single();
          if (fresh) updateEvents(events.map(e => e.id === sel.id ? mapEvent(fresh) : e));
          setCart({});
        } else {
          alert(msg);
        }
        return;
      }
      if (!data.clientSecret) { alert('Payment setup failed. Please try again.'); return; }
      setSoldOutError('');
      setClientSecret(data.clientSecret);
      setPaymentAmounts({ ticketTotal: data.ticketTotal, discountAmount: data.discountAmount || 0, salesTax: data.salesTax, serviceFees: data.serviceFees, processingFee: data.processingFee, grandTotal: data.grandTotal });
    } catch {
      alert('Payment setup failed. Please try again.');
    } finally {
      setCreatingPayment(false);
    }
  };

  const open = (id) => { setSelId(id); setCart({}); setView("detail"); window.history.pushState({}, '', `/e/${id}`); };
  const goHome = () => { setView("home"); window.history.pushState({}, '', '/'); };

  const submitSellInquiry = async () => {
    if (!sellForm.name || !sellForm.email) return;
    setSellStatus('sending');
    try {
      const r = await fetch(API_BASE + '/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'organizer_inquiry', form: sellForm }),
      });
      if (!r.ok) throw new Error('failed');
      setSellStatus('sent');
    } catch {
      setSellStatus('error');
    }
  };


  const promoApiCall = async (action, body = {}) => {
    const { data: { session: s } } = await supabase.auth.getSession();
    return fetch(API_BASE + '/api/promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ action, ...body }),
    });
  };

  const loadVenueUsers = async () => {
    const r = await promoApiCall('list_venue_users');
    const data = await r.json();
    setVenueUsers(data.users || []);
    setVenueUsersLoaded(true);
  };

  const createVenueUser = async () => {
    if (!venueUserForm.email || !venueUserForm.password || !venueUserForm.tenantId) return;
    setVenueUserSaving(true); setVenueUserError(''); setVenueUserSuccess('');
    const selectedVenue = venues.find(v => v.id === venueUserForm.tenantId);
    const r = await promoApiCall('create_venue_user', {
      email: venueUserForm.email,
      password: venueUserForm.password,
      tenantId: venueUserForm.tenantId,
      tenantName: selectedVenue?.name || '',
      role: venueUserForm.role,
    });
    const data = await r.json();
    setVenueUserSaving(false);
    if (!r.ok) { setVenueUserError(data.error || 'Failed to create account'); }
    else { setVenueUserSuccess(`Account created for ${venueUserForm.email}`); setVenueUserForm({ email:'', password:'', tenantId:'', role:'venue' }); loadVenueUsers(); }
  };

  const deleteVenueUser = async (userId, email) => {
    if (!window.confirm(`Delete account for ${email}? They will no longer be able to log in.`)) return;
    await promoApiCall('delete_venue_user', { userId });
    setVenueUsers(prev => prev.filter(u => u.id !== userId));
  };

  const loadVenues = async () => {
    const r = await promoApiCall('list_venues');
    const data = await r.json();
    if (data.venues) updateVenues(data.venues.map(mapVenue));
  };

  const saveVenue = async () => {
    if (!venueForm.name.trim()) return;
    setVenueSaving(true); setVenueError(''); setVenueSuccess('');
    const action = editingVenueId ? 'update_venue' : 'create_venue';
    const body = { ...venueForm, ...(editingVenueId ? { id: editingVenueId } : {}) };
    const r = await promoApiCall(action, body);
    const data = await r.json();
    setVenueSaving(false);
    if (!r.ok) { setVenueError(data.error || 'Failed to save venue'); return; }
    setVenueSuccess(editingVenueId ? 'Venue updated.' : 'Venue created.');
    setVenueFormOpen(false);
    setEditingVenueId(null);
    setVenueForm({ name:'', address:'', contactPhone:'', contactEmail:'', website:'', ownerName:'', ownerPhone:'', notes:'' });
    await loadVenues();
  };

  const toggleVenue = async (id, active) => {
    await promoApiCall('toggle_venue', { id, active });
    updateVenues(venues.map(v => v.id === id ? { ...v, active } : v));
  };

  const startEditVenue = (v) => {
    setEditingVenueId(v.id);
    setVenueForm({ name: v.name, address: v.location, contactPhone: v.phone, contactEmail: v.email, website: v.website, ownerName: v.ownerName, ownerPhone: v.ownerPhone, notes: v.notes });
    setVenueFormOpen(true);
    setVenueError(''); setVenueSuccess('');
  };

  const checkin = async (oid) => {
    await supabase.from('orders').update({ status: 'checked_in' }).eq('id', oid);
    await supabase.from('tickets').update({ status: 'checked_in', checked_in_at: new Date().toISOString() }).eq('order_id', oid).eq('status', 'valid');
    updateOrders(orders.map(o => o.id === oid ? { ...o, checkedIn: true } : o));
  };

  const handleAdminScan = async (id) => {
    setAdminScan(false);
    // Try individual ticket lookup first
    const { data: ticket } = await supabase.from('tickets').select('*').eq('id', id).single();
    if (ticket) {
      const order = orders.find(o => o.id === ticket.order_id);
      if (!order || order.venueId !== venue.id) { setScanMsg({ ok: false, text: 'This ticket is not for an event at this venue.' }); return; }
      if (ticket.status === 'cancelled' || order.status === 'cancelled') { setScanMsg({ ok: false, text: 'This order has been cancelled and refunded.' }); return; }
      if (ticket.status === 'checked_in') { setScanMsg({ ok: false, text: `Ticket ${ticket.ticket_number} (${ticket.ticket_type_name}) already checked in.` }); return; }
      await supabase.from('tickets').update({ status: 'checked_in', checked_in_at: new Date().toISOString() }).eq('id', ticket.id).eq('status', 'valid');
      setExpandedTickets(prev => ({ ...prev, [ticket.order_id]: (prev[ticket.order_id] || []).map(t => t.id === ticket.id ? { ...t, status: 'checked_in' } : t) }));
      setScanMsg({ ok: true, text: `✓ Ticket ${ticket.ticket_number} — ${ticket.ticket_type_name} — checked in!` });
      setTimeout(() => setScanMsg(null), 4000);
      return;
    }
    // Fall back to order-level
    const order = orders.find(o => o.id === id && o.venueId === venue.id);
    if (!order) { setScanMsg({ ok: false, text: 'No order found for that QR code.' }); return; }
    if (order.status === 'cancelled') { setScanMsg({ ok: false, text: 'This order has been cancelled and refunded.' }); return; }
    if (order.checkedIn) { setScanMsg({ ok: false, text: `${order.buyer.name} is already checked in.` }); return; }
    await checkin(id);
    setScanMsg({ ok: true, text: `✓ ${order.buyer.name} checked in!` });
    setTimeout(() => setScanMsg(null), 4000);
  };
  const blank = () => ({ id: null, venueId: venue.id, title: "", date: "", time: "", doors: "", description: "", image: "🎵", focalX: 50, focalY: 50, published: true, category: "Live Music", tickets: [{ type: "General Admission", price: 25, available: 100, physicalQty: 0, doorPrice: null }] });
  const saveEvt = async (e) => {
  setIsSaving(true);
  try {
  let imageUrl = e.image;

  // Upload new image if one was selected
  if (e._imageFile) {
    const fileExt = e._imageFile.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('event-images')
      .upload(fileName, e._imageFile, { upsert: true });
    
    if (uploadError) { console.error('Image upload error:', uploadError); return; }
    
    const { data: urlData } = supabase.storage
      .from('event-images')
      .getPublicUrl(fileName);
    
    imageUrl = urlData.publicUrl;
  }

  if (e.id) {
    await supabase.from('events').update({
      title: e.title,
      description: e.description,
      category: e.category,
      event_date: e.date + 'T' + (e.time || '00:00') + ':00',
      doors_open: e.date + 'T' + (e.doors || '00:00') + ':00',
      image_url: imageUrl,
      focal_x: e.focalX ?? 50,
      focal_y: e.focalY ?? 50,
      is_published: e.published ?? true,
    }).eq('id', e.id);
    for (const t of e.tickets) {
      if (t.id) await supabase.from('ticket_types').update({
        name: t.type,
        price: t.price,
        quantity_total: (t.sold ?? 0) + Math.max(0, t.available),
        physical_qty: t.physicalQty ?? 0,
        door_price: t.doorPrice ?? null,
      }).eq('id', t.id);
    }
    updateEvents(events.map(x => x.id === e.id ? {...e, image: imageUrl, focalX: e.focalX ?? 50, focalY: e.focalY ?? 50, published: e.published ?? true} : x));
  } else {
    const { data: newEvt, error } = await supabase.from('events').insert({
      tenant_id: TENANT_ID,
      title: e.title,
      description: e.description,
      category: e.category,
      event_date: e.date + 'T' + (e.time || '00:00') + ':00',
      doors_open: e.date + 'T' + (e.doors || '00:00') + ':00',
      image_url: imageUrl,
      focal_x: e.focalX ?? 50,
      focal_y: e.focalY ?? 50,
      venue_name: venue.name,
      is_published: e.published ?? true,
    }).select().single();
    if (error) { console.error(error); return; }
    await supabase.from('ticket_types').insert(
      e.tickets.map(t => ({
        event_id: newEvt.id,
        name: t.type,
        price: t.price,
        quantity_total: t.available,
        quantity_sold: 0,
        physical_qty: t.physicalQty ?? 0,
        door_price: t.doorPrice ?? null,
      }))
    );
    const { data: freshEvt } = await supabase.from('events').select('*, ticket_types(*)').eq('id', newEvt.id).single();
    const mapped = freshEvt ? mapEvent(freshEvt) : { ...e, id: newEvt.id, venueId: venue.id, image: imageUrl, focalX: e.focalX ?? 50, focalY: e.focalY ?? 50, published: e.published ?? true };
    updateEvents([...events, mapped]);
  }
  setModal(false);
  setEditEvt(null);
  } finally {
    setIsSaving(false);
  }
};
  const delEvt = async (id) => {
  const target = events.find(e => e.id === id);
  const orderCount = orders.filter(o => o.eventId === id).length;
  const msg = orderCount > 0
    ? `Delete "${target?.title}"?\n\nThis will remove the event and its ticket types. The ${orderCount} existing order record${orderCount !== 1 ? 's' : ''} will be kept for your records.\n\nThis cannot be undone.`
    : `Delete "${target?.title}"? This cannot be undone.`;
  if (!window.confirm(msg)) return;
  await supabase.from('tickets').delete().eq('event_id', id);
  await supabase.from('ticket_types').delete().eq('event_id', id);
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) { alert(`Failed to delete event: ${error.message}`); return; }
  updateEvents(events.filter(e => e.id !== id));
};
  const togglePublish = async (ev) => {
  if (togglingPublish.has(ev.id)) return;
  setTogglingPublish(prev => new Set([...prev, ev.id]));
  const next = !ev.published;
  await supabase.from('events').update({ is_published: next }).eq('id', ev.id);
  updateEvents(events.map(e => e.id === ev.id ? { ...e, published: next } : e));
  setTogglingPublish(prev => { const s = new Set(prev); s.delete(ev.id); return s; });
};

  if (!loaded) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0c0a07" }}><img src={LOGO_FULL} alt="C8 Tickets" style={{ width: 'clamp(240px,70vw,480px)', height: 'auto', opacity: .95, animation: "fi .6s ease" }} /></div>;

  return (
    <><style>{CSS}</style>
      <div className="app">
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <nav className="nav" aria-label="Main navigation">
          <div className="nav-logo" onClick={goHome} onKeyDown={e=>{if(e.key==='Enter')goHome();}} role="button" tabIndex={0} aria-label="Go to home page">
            <img src={LOGO_SRC} alt="C8 Tickets" />
          </div>
          <div className="nav-links">
            <button className={`btn ${["home","detail"].includes(view) ? "on" : ""}`} onClick={goHome}>Events</button>
            <button className={`btn ${view === "lookup" || view === "mytickets" ? "on" : ""}`} onClick={() => { setLookupEmail(''); setLookupStep('email'); setLookupError(''); setView("lookup"); }}>My Tickets</button>
            {!session && <button className={`btn ${view === "about" ? "on" : ""}`} onClick={() => setView("about")}>About</button>}
            {!session && <button className={`btn ${view === "sell" ? "on" : ""}`} onClick={() => { setSellForm({ name:'', email:'', phone:'', eventName:'', location:'', date:'', attendance:'', channel:'both', notes:'' }); setSellStatus('idle'); setView("sell"); }}>Sell Tickets</button>}
            {session && <button className={`btn ${view === "admin" || view === "gate" ? "on" : ""}`} onClick={() => setView(isGate ? 'gate' : 'admin')}>{isGate ? 'Check-In' : 'Admin'}</button>}
            {session && <button className="btn" onClick={logout}>Logout</button>}
          </div>
        </nav>

        <main id="main-content">
        {view === "home" && <div className="fade">
          <div className="hero">
            <img src={LOGO_FULL} alt="C8 Tickets" className="hero-logo" />
            <p>{venue.tagline}</p>
            <button className="hero-cta" onClick={()=>document.getElementById('events')?.scrollIntoView({behavior:'smooth'})}>
              See What's On
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div className="hero-sub"><span>Questions? <a href="mailto:support@c8tickets.com" style={{color:"var(--text3)"}}>support@c8tickets.com</a></span></div>
          </div>
          <div className="sec" id="events">
            {(() => {
              const oa = (t) => Math.max(0, t.available - (t.physicalQty ?? 0));
              const sorted = [...publicEvents].sort((a,b) => new Date(a.date)-new Date(b.date));
              const featuredEv = filter === 'All' ? (sorted.find(ev=>ev.tickets.some(t=>oa(t)>0)) ?? sorted[0] ?? null) : null;
              const gridEvents = featuredEv ? filtered.filter(ev=>ev.id!==featuredEv.id) : filtered;
              return <>
                {featuredEv && (()=>{
                  const fSoldOut=featuredEv.tickets.every(t=>oa(t)<=0);
                  const fMp=featuredEv.tickets.length>0?Math.min(...featuredEv.tickets.map(t=>t.price)):0;
                  const fAvail=featuredEv.tickets.reduce((s,t)=>s+oa(t),0);
                  const fCap=featuredEv.tickets.reduce((s,t)=>s+(t.total??t.available),0);
                  const fLow=!fSoldOut&&fCap>0&&fAvail/fCap<=0.25;
                  return (
                    <div className="feat" onClick={()=>open(featuredEv.id)}>
                      <div className="feat-bg" style={{backgroundImage:featuredEv.image&&featuredEv.image.startsWith('http')?`url(${featuredEv.image})`:'none',backgroundPosition:`${featuredEv.focalX??50}% ${featuredEv.focalY??50}%`}}>
                        {(!featuredEv.image||!featuredEv.image.startsWith('http'))&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:80,opacity:.1}}>🎵</div>}
                        <div className="feat-grad"/>
                        <div className="feat-body">
                          <div className="feat-eyebrow"><span style={{width:6,height:6,borderRadius:'50%',background:'var(--gold)',display:'inline-block',flexShrink:0}}/>Up Next</div>
                          <div className="feat-title">{featuredEv.title}</div>
                          <div className="feat-date">{fmtDate(featuredEv.date)} · {fmtTime(featuredEv.time)}{featuredEv.doors?` · Doors ${featuredEv.doors}`:''}</div>
                          <div className="feat-foot">
                            <div className="feat-price">{fSoldOut?<span style={{color:'var(--text3)',fontSize:14,fontWeight:600,textTransform:'uppercase',letterSpacing:1}}>Sold Out</span>:<>{fmtCurrency(fMp)}{fMp>0&&<small style={{fontSize:12,fontWeight:400,color:'var(--text2)'}}> & up</small>}</>}</div>
                            {fSoldOut?<span className="badge badge-sold">Sold Out</span>:<button className="btn gold" style={{padding:'10px 28px',fontSize:14}} onClick={e=>{e.stopPropagation();open(featuredEv.id);}}>{fLow?'Get Tickets — Selling Fast':'Get Tickets'}</button>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <div style={{marginBottom:20}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:12,marginBottom:14,flexWrap:'wrap'}}>
                    <div className="sec-title dsp" style={{fontSize:'clamp(26px,4vw,36px)',letterSpacing:2}}>Upcoming Events</div>
                    <div style={{height:2,flex:1,minWidth:32,background:'linear-gradient(90deg,rgba(200,146,42,.35),transparent)',borderRadius:2,alignSelf:'center'}}/>
                  </div>
                  {venues.length > 1 && <div className="filters" style={{marginBottom:8}}>
                    <button className={`chip ${venueFilter==='All'?'on':''}`} aria-pressed={venueFilter==='All'} onClick={()=>setVenueFilter('All')}>All Venues</button>
                    {venues.map(v=><button key={v.id} className={`chip ${venueFilter===v.id?'on':''}`} aria-pressed={venueFilter===v.id} onClick={()=>setVenueFilter(v.id)}>{v.name}</button>)}
                  </div>}
                  <div className="filters" role="group" aria-label="Filter by category">{CATS.map(c=><button key={c} className={`chip ${filter===c?"on":""}`} aria-pressed={filter===c} onClick={()=>setFilter(c)}>{c}</button>)}</div>
                </div>
                {gridEvents.length===0?(
                  publicEvents.length===0
                    ? <div className="empty"><p style={{fontSize:16,color:"var(--text2)",marginBottom:8}}>No upcoming events right now.</p><p style={{fontSize:13,color:"var(--text3)"}}>Check back soon, or email us at <a href="mailto:support@c8tickets.com" style={{color:"var(--gold)"}}>support@c8tickets.com</a></p></div>
                    : <div className="empty"><div className="ic">📭</div><p>No events in this category</p></div>
                ):
                  <div className="grid">{gridEvents.map(ev=>{const mp=ev.tickets.length>0?Math.min(...ev.tickets.map(t=>t.price)):0;const soldOut=ev.tickets.every(t=>oa(t)<=0);const totalAvail=ev.tickets.reduce((s,t)=>s+oa(t),0);const totalCap=ev.tickets.reduce((s,t)=>s+(t.total??t.available),0);const lowTickets=!soldOut&&totalCap>0&&totalAvail/totalCap<=0.25;return(
                    <div key={ev.id} className="card" role="button" tabIndex={0} onClick={()=>open(ev.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(ev.id);}}} style={soldOut?{opacity:.55,filter:'grayscale(0.3)'}:{}}>
                      <div className="card-img">
                        {ev.image&&ev.image.startsWith('http')
                          ?<img src={ev.image} alt={ev.title} loading="lazy" style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',objectPosition:`${ev.focalX??50}% ${ev.focalY??50}%`}} />
                          :<span style={{fontSize:48}}>🎵</span>}
                        <div className="card-cat">{ev.category}</div>
                        {soldOut&&<div style={{position:'absolute',inset:0,background:'rgba(12,10,7,.6)',display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(1px)'}}><span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:22,letterSpacing:5,textTransform:'uppercase',color:'#f0e9da',border:'2px solid rgba(240,233,218,.6)',padding:'6px 20px',borderRadius:4}}>Sold Out</span></div>}
                        {lowTickets&&<div style={{position:'absolute',bottom:10,left:10,background:'rgba(179,58,42,.92)',backdropFilter:'blur(4px)',padding:'3px 10px',borderRadius:99,fontSize:9,fontWeight:700,color:'#f0e9da',textTransform:'uppercase',letterSpacing:1.5,border:'1px solid rgba(240,120,100,.3)'}}>Selling Fast</div>}
                      </div>
                      <div className="card-body">
                        <div className="card-date">{fmtDate(ev.date)} - {fmtTime(ev.time)}</div>
                        <div className="card-title dsp">{ev.title}</div>
                        {venues.length > 1 && <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1.5,fontWeight:700,marginBottom:4}}>{venues.find(v=>v.id===ev.venueId)?.name||''}</div>}
                        <div className="card-desc">{ev.description}</div>
                        <div className="card-foot"><div className="card-price">{soldOut?<span style={{color:'var(--text3)',fontWeight:600,fontSize:14,textTransform:'uppercase',letterSpacing:1}}>Sold Out</span>:<>{fmtCurrency(mp)}{mp>0&&<small> & up</small>}</>}</div>{soldOut?null:<button className="btn gold" onClick={e=>{e.stopPropagation();open(ev.id);}}>Tickets</button>}</div>
                      </div>
                    </div>);})}</div>}
              </>;
            })()}
          </div>
        </div>}

        {view === "detail" && sel && sel.published === false && !session && (() => { goHome(); return null; })()}
        {view === "detail" && sel && (sel.published !== false || session) && <div className="sec fade" style={{ maxWidth: 800 }}>
          <div className="back" onClick={goHome}>← Events</div>
          <div className="d-hero" style={{backgroundImage: sel.image && sel.image.startsWith('http') ? `url(${sel.image})` : 'none', backgroundSize:'cover', backgroundPosition:`${sel.focalX ?? 50}% ${sel.focalY ?? 50}%`}}>
  {(!sel.image || !sel.image.startsWith('http')) && <span style={{fontSize:72}}>🎵</span>}
</div>
          <div style={{ marginBottom: 6 }}><span className="tag">{sel.category}</span></div>
          <h1 className="dsp" style={{ fontSize: "clamp(26px,5vw,42px)", lineHeight: 1.1, marginBottom: 14 }}>{sel.title}</h1>
          <div className="share-row">
            {'share' in navigator
              ? <button className="share-btn share-native" title="Share" onClick={async () => { try { await navigator.share({ title: sel.title, text: sel.title+' — grab your tickets!', url: APP_URL+'/e/'+sel.id }); } catch(e) {} }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                </button>
              : <>
                  <a className="share-btn share-fb" title="Share on Facebook" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(APP_URL+'/e/'+sel.id)}`} target="_blank" rel="noopener noreferrer">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                  </a>
                  <a className="share-btn share-tw" title="Share on X / Twitter" href={`https://x.com/intent/tweet?text=${encodeURIComponent(sel.title+' — grab your tickets!')}&url=${encodeURIComponent(APP_URL+'/e/'+sel.id)}`} target="_blank" rel="noopener noreferrer">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  </a>
                  <button className="share-btn share-ig" title={copiedLink ? "Copied!" : "Copy link for Instagram"} onClick={() => { navigator.clipboard.writeText(APP_URL+'/e/'+sel.id); setCopiedLink(true); setTimeout(()=>setCopiedLink(false),2000); }}>
                    {copiedLink ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>}
                  </button>
                  <a className="share-btn share-sms" title="Share via Text Message" href={`sms:?body=${encodeURIComponent(sel.title+' — get tickets: '+APP_URL+'/e/'+sel.id)}`}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  </a>
                </>
            }
          </div>
          <div className="d-meta">
  <span>📅 <strong>{fmtDate(sel.date)}</strong></span>
  <span>🕐 <strong>{fmtTime(sel.time)}</strong></span>
  <span>🚪 Doors <strong>{fmtTime(sel.doors)}</strong></span>
  <span>📍 <strong><button style={{background:'none',border:'none',padding:0,color:'var(--gold)',cursor:'pointer',fontWeight:700,fontSize:'inherit'}} onClick={()=>{setVenueProfileId(selVenue.id);setView('venue');window.history.pushState({},'',(selVenue.slug&&selVenue.slug!==selVenue.id)?`/v/${selVenue.slug}`:`/v/${selVenue.id}`);}}>{selVenue.name}</button></strong> — {selVenue.location}</span>
  {selVenue.phone && <span>📞 <strong>{selVenue.phone}</strong></span>}
  {selVenue.email && <span>✉️ <a href={`mailto:${selVenue.email}`} style={{color:"var(--gold)"}}>{selVenue.email}</a></span>}
  {selVenue.website && <span>🌐 <a href={selVenue.website} target="_blank" rel="noopener noreferrer" style={{color:"var(--gold)"}}>{selVenue.website.replace('https://','')}</a></span>}
</div>
          <a className="directions-btn" href={`https://maps.google.com/?q=${encodeURIComponent(selVenue.location)}`} target="_blank" rel="noopener noreferrer">📍 Get Directions</a>
          <p className="d-desc">{sel.description}</p>
          <div className="tkt-sec"><h3 className="dsp">Select Tickets</h3>
            {sel.tickets.map((t, i) => { const oa = Math.max(0, t.available - (t.physicalQty ?? 0)); const total = t.total ?? t.available; const lowStock = oa > 0 && total > 0 && oa / total <= 0.25; return <div className="tkt-row" key={i}><div className="tkt-info"><h4>{t.type}</h4>{oa === 0 ? <p>Sold Out</p> : lowStock ? <p style={{color:'var(--red)',fontWeight:700,fontSize:12}}>Almost Gone — Grab Yours Now!</p> : null}</div><div className="tkt-price">{fmtCurrency(t.price)}</div><div className="qty"><button className="qb" aria-label={`Remove one ${t.type}`} disabled={!cart[i]} onClick={() => setCart({ ...cart, [i]: (cart[i]||0)-1 })}>−</button><div className="qv" aria-live="polite" aria-label={`${cart[i]||0} ${t.type} selected`}>{cart[i]||0}</div><button className="qb" aria-label={`Add one ${t.type}`} disabled={(cart[i]||0) >= oa || oa === 0} onClick={() => setCart({ ...cart, [i]: (cart[i]||0)+1 })}>+</button></div></div>; })}
            {cartN > 0 && <div className="cart-sum">{sel.tickets.map((t,i) => cart[i] > 0 && <div className="cart-ln" key={i}><span>{cart[i]}× {t.type}</span><span>{fmtCurrency(cart[i]*t.price)}</span></div>)}<div className="cart-tot"><span>Total</span><span>{fmtCurrency(cartTotal)}</span></div></div>}
            <div style={{background:"var(--bg3)",borderRadius:"var(--rs)",padding:"12px 14px",marginBottom:12,fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
              <span style={{color:"var(--text2)",fontWeight:600}}>Fees:</span> Ticket prices are subject to 6% Idaho sales tax, a $2.00 service fee per ticket, and a payment processing fee (3.5% + $0.30). All fees are itemized at checkout.
              </div>
            <button className="buy" disabled={cartN===0} onClick={() => { if (cartN === 0) return; setSoldOutError(''); setView("checkout"); }}>{cartN===0 ? "Select Tickets" : `Checkout - ${fmtCurrency(cartTotal + cartN * 2)}`}</button>
          </div>
        </div>}

        {view === "checkout" && sel && (
  <div className="sec fade" style={{ maxWidth: 500 }}>
    <div className="back" onClick={() => { if (clientSecret) { setClientSecret(null); setPaymentAmounts(null); } else { setView("detail"); } }}>{clientSecret ? "← Your Info" : "← Tickets"}</div>
    <h1 className="dsp" style={{ fontSize: 28, marginBottom: 6 }}>Checkout</h1>
    <p style={{ color: "var(--text2)", marginBottom: 24, fontSize: 13 }}>{sel.title} - {fmtDate(sel.date)}</p>
    {!clientSecret && (
      <>
        <div className="tkt-sec" style={{ marginBottom: 20 }}>
          <h3 className="dsp">Your Info</h3>
          <div className="fg"><label className="fl" htmlFor="buyer-name">Full Name *</label><input id="buyer-name" className="fi" autoComplete="name" value={buyer.name} onChange={e => setBuyer({...buyer,name:e.target.value})} placeholder="Jane Doe" />{buyer.name.length > 0 && !nameValid && <p style={{fontSize:11,color:"var(--red)",marginTop:3}}>Please enter your full name.</p>}</div>
          <div className="fr">
            <div className="fg"><label className="fl" htmlFor="buyer-email">Email *</label><input id="buyer-email" className="fi" type="email" autoComplete="email" value={buyer.email} onChange={e => setBuyer({...buyer,email:e.target.value})} placeholder="jane@email.com" />{buyer.email.length > 0 && !emailValid && <p style={{fontSize:11,color:"var(--red)",marginTop:3}}>Please enter a valid email.</p>}</div>
            <div className="fg"><label className="fl" htmlFor="buyer-phone">Phone</label><input id="buyer-phone" className="fi" type="tel" autoComplete="tel" value={buyer.phone} onChange={e => setBuyer({...buyer,phone:e.target.value})} placeholder="(208) 555-1234" /></div>
          </div>
        </div>
        {!buyerReady && (
          <p style={{ color: "var(--text3)", fontSize: 12, textAlign: "center", marginTop: 10 }}>Enter a valid name and email above to continue.</p>
        )}
        {buyerReady && (() => {
          const discount = promoApplied
            ? promoApplied.discountType === 'percent'
              ? Math.round(cartTotal * promoApplied.discountValue / 100 * 100) / 100
              : Math.min(promoApplied.discountValue, cartTotal)
            : 0;
          const discounted = cartTotal - discount;
          const tax = Math.round(discounted * 0.06 * 100) / 100;
          const svcFees = cartN * 2.00;
          const subtotal = discounted + tax + svcFees;
          const procFee = Math.round((subtotal * 0.035 + 0.30) * 100) / 100;
          const grand = subtotal + procFee;
          return (
            <div className="tkt-sec" style={{ marginBottom: 20 }}>
              <h3 className="dsp">Order Summary</h3>
              <div className="cart-sum">
                {sel.tickets.map((t, i) => cart[i] > 0 && <div className="cart-ln" key={i}><span>{cart[i]}× {t.type}</span><span>{fmtCurrency(cart[i] * t.price)}</span></div>)}
                {promoApplied && <div className="cart-ln" style={{color:'var(--green)'}}><span>Promo: {promoApplied.code}</span><span>-{fmtCurrency(discount)}</span></div>}
                <div className="cart-ln"><span>Sales Tax (6%)</span><span>{fmtCurrency(tax)}</span></div>
                <div className="cart-ln"><span>Service Fees</span><span>{fmtCurrency(svcFees)}</span></div>
                <div className="cart-ln"><span>Processing Fee</span><span>{fmtCurrency(procFee)}</span></div>
                <div className="cart-tot"><span>Total</span><span>{fmtCurrency(grand)}</span></div>
              </div>
              <div style={{marginTop:14}}>
                {!promoApplied ? (
                  <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                    <div style={{flex:1}}>
                      <input className="fi" style={{margin:0,textTransform:'uppercase',letterSpacing:1}} placeholder="Promo code" value={promoInput} onChange={e=>setPromoInput(e.target.value.toUpperCase())} onKeyDown={e=>e.key==='Enter'&&applyPromo()} aria-label="Promo code" />
                      {promoError && <p style={{fontSize:11,color:'var(--red)',marginTop:4}}>{promoError}</p>}
                    </div>
                    <button className="btn" style={{flexShrink:0,padding:'10px 16px'}} disabled={promoLoading||!promoInput.trim()} onClick={applyPromo}>{promoLoading?'Checking…':'Apply'}</button>
                  </div>
                ) : (
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'rgba(76,175,125,.1)',border:'1px solid rgba(76,175,125,.3)',borderRadius:'var(--rs)',padding:'10px 14px',fontSize:13}}>
                    <span style={{color:'var(--green)',fontWeight:600}}>{promoApplied.description}</span>
                    <button style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:18,lineHeight:1,padding:'0 4px'}} onClick={()=>{setPromoApplied(null);setPromoError('');}} aria-label="Remove promo code">×</button>
                  </div>
                )}
              </div>
              {soldOutError && <div style={{background:"rgba(179,58,42,.12)",border:"1px solid rgba(179,58,42,.35)",borderRadius:"var(--rs)",padding:"12px 14px",marginTop:12,marginBottom:4,color:"var(--red)",fontSize:13}}>Availability changed: {soldOutError}. Your cart has been cleared — please select new quantities.</div>}
              <button className="buy" style={{ marginTop: 12 }} onClick={createPaymentIntent} disabled={creatingPayment || !!soldOutError}>
                {creatingPayment ? "Setting up payment..." : `Continue to Payment — ${fmtCurrency(grand)}`}
              </button>
            </div>
          );
        })()}
      </>
    )}
    {clientSecret && (
      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#c8922a', borderRadius: '6px' }}}}>
        <CheckoutForm
        cartTotal={paymentAmounts.ticketTotal}
        totalTickets={Object.values(cart).reduce((a,b) => a+b, 0)}
        paymentAmounts={paymentAmounts}
        onBack={() => { setClientSecret(null); setPaymentAmounts(null); }}
        onSuccess={async (paymentIntentId) => {
            const items = sel.tickets
              .map((t, i) => ({ type: t.type, qty: cart[i] || 0, price: t.price, ticketTypeId: t.id }))
              .filter(i => i.qty > 0);

            const { data: order, error: orderError } = await supabase
              .from('orders')
              .insert({
                tenant_id: TENANT_ID,
                event_id: sel.id,
                buyer_name: buyer.name,
                buyer_email: buyer.email,
                buyer_phone: buyer.phone,
                status: 'confirmed',
                total_amount: paymentAmounts.grandTotal,
                ticket_subtotal: paymentAmounts.ticketTotal,
                sales_tax: paymentAmounts.salesTax,
                service_fees: paymentAmounts.serviceFees,
                processing_fee: paymentAmounts.processingFee,
                stripe_payment_intent_id: paymentIntentId,
                source: 'online',
                promo_code_id: promoApplied?.id || null,
              })
              .select()
              .single();

            if (orderError) {
              // 23505 = unique_violation: webhook already created this order — payment is fine, just exit
              if (orderError.code === '23505') return;
              console.error(orderError);
              alert(`Your payment was successful but there was a problem saving your order record. Please email support@c8tickets.com immediately and include this payment reference so we can issue your tickets manually:\n\n${paymentIntentId}`);
              return;
            }

            const { error: fulfillError } = await supabase.rpc('fulfill_order', {
              p_order_id: order.id,
              p_items: items,
              p_event_id: sel.id,
              p_tenant_id: TENANT_ID,
            });

            if (fulfillError) {
              console.error(fulfillError);
              await supabase.from('orders').delete().eq('id', order.id);
              const msg = fulfillError.message?.includes('remaining')
                ? `Sorry, some tickets in your order are no longer available. Your payment was captured — please email support@c8tickets.com with your payment reference: ${paymentIntentId}`
                : `There was a problem saving your order. Your payment was captured — please email support@c8tickets.com with payment reference: ${paymentIntentId}`;
              alert(msg);
              return;
            }

            const localOrder = {
              id: order.id, eventId: sel.id, venueId: venue.id,
              buyer: { ...buyer },
              items: items.map(i => ({ type: i.type, qty: i.qty, price: i.price, ticketTypeId: i.ticketTypeId })),
              ticketTotal: paymentAmounts.ticketTotal,
              salesTax: paymentAmounts.salesTax,
              serviceFees: paymentAmounts.serviceFees,
              processingFee: paymentAmounts.processingFee,
              total: paymentAmounts.grandTotal, date: new Date().toISOString(), checkedIn: false,
              stripePaymentIntentId: paymentIntentId, source: 'online',
            };
            updateOrders([...orders, localOrder]);
            updateEvents(events.map(ev => ev.id !== sel.id ? ev : {
              ...ev, tickets: ev.tickets.map((t, i) => ({ ...t, available: t.available - (cart[i] || 0) }))
            }));
            setLastOrder(localOrder);
            setView("ticket");
            setBuyer({ name: "", email: "", phone: "" });
            setCart({});
            setClientSecret(null);
            if (promoApplied) {
              fetch(API_BASE + '/api/promo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'redeem', code: promoApplied.code, tenantId: TENANT_ID }),
              }).catch(() => {});
              setPromoApplied(null);
            }
            setPromoInput('');

fetch(API_BASE+'/api/send-email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    order: { ...localOrder, discountAmount: paymentAmounts.discountAmount || 0 },
    event: {
      title: sel.title,
      date: fmtDate(sel.date),
      time: fmtTime(sel.time),
      doors: fmtTime(sel.doors),
      category: sel.category,
    },
    venue: {
      name: venue.name,
      location: venue.location,
    },
  }),
}).catch(err => console.error('Email error:', err));
          }}
        />
      </Elements>
    )}
  </div>
)}

        {view === "ticket" && lastOrder && (() => { const ev = events.find(e => e.id === lastOrder.eventId); return (
          <div className="sec fade" style={{ maxWidth: 500 }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}><div style={{fontSize:40,marginBottom:6}}>🎉</div><h1 className="dsp" style={{fontSize:28}}>You're In!</h1><p style={{color:"var(--text2)",fontSize:13}}>Show this QR code at the gate</p></div>
            <div className="tkt-disp">
              <div className="dsp" style={{fontSize:22,marginBottom:3}}>{ev?.title}</div>
              <div style={{color:"var(--gold)",fontWeight:700,fontSize:13,marginBottom:14,textTransform:"uppercase",letterSpacing:1}}>{ev ? fmtDate(ev.date) : ""} - {fmtTime(ev?.time)}</div>
              <div><span className="badge badge-ok">✓ Valid</span></div>
              <div className="qr"><QRImg value={lastOrder.id} size={160} /></div>
              <div className="cid">ID: {lastOrder.id.toUpperCase()}</div>
              <ul className="tkt-items">
                {lastOrder.items.map((it,i) => <li key={i}><span>{it.qty}× {it.type}</span><span>{fmtCurrency(it.qty*it.price)}</span></li>)}
                {lastOrder.salesTax > 0 && <li><span>Sales Tax (6%)</span><span>${Number(lastOrder.salesTax).toFixed(2)}</span></li>}
                {lastOrder.serviceFees > 0 && <li><span>Service Fees</span><span>{fmtCurrency(lastOrder.serviceFees)}</span></li>}
                {lastOrder.processingFee > 0 && <li><span>Processing Fee</span><span>${Number(lastOrder.processingFee).toFixed(2)}</span></li>}
                <li style={{fontWeight:700,color:"var(--text)",borderTop:"1px solid var(--bg4)",paddingTop:6,marginTop:6}}><span>Total</span><span>{fmtCurrency(lastOrder.total)}</span></li>
                </ul>
              <p style={{fontSize:11,color:"var(--text3)",marginTop:10}}>{lastOrder.buyer.name} - {lastOrder.buyer.email}<br/>{venue.name} - {venue.location}</p>
            </div>
            {ev && <div style={{display:"flex",gap:8,marginTop:12}}>
              <a href={buildGCalUrl(ev, venue.location)} target="_blank" rel="noopener noreferrer" className="btn" style={{flex:1,textAlign:"center",textDecoration:"none"}}>Google Calendar</a>
              <button className="btn" style={{flex:1}} onClick={()=>downloadIcs(ev, venue.location)}>Download .ics</button>
            </div>}
            <button className="buy" style={{marginTop:12}} onClick={goHome}>Browse More Events</button>
          </div>); })()}
        {view === "mytickets" && (
          <div className="sec fade" style={{maxWidth:520}}>
            <div className="back" onClick={goHome}>← Back to Events</div>
            <h1 className="dsp" style={{fontSize:28,marginBottom:6}}>{ticketFilterId ? 'Your Ticket' : 'Your Tickets'}</h1>
            {ticketPageLoading && <p style={{color:"var(--text2)",fontSize:13,marginTop:20,textAlign:"center"}}>Loading your tickets…</p>}
            {!ticketPageLoading && !ticketPageData && <p style={{color:"var(--red)",fontSize:13,marginTop:20,textAlign:"center"}}>Order not found.</p>}
            {!ticketPageLoading && ticketPageData && (() => {
              const { order, tickets } = ticketPageData;
              const displayTickets = ticketFilterId ? tickets.filter(t => t.id === ticketFilterId) : tickets;
              const ev = events.find(e => e.id === order.event_id);
              const evTitle = ev?.title || '';
              const evDate = ev ? fmtDate(ev.date) : '';
              const evTime = ev ? fmtTime(ev.time) : '';
              const evDoors = ev ? fmtTime(ev.doors) : '';
              const hasReceipt = ticketReceiptMode && order.ticket_subtotal != null;
              const shareAll = async () => {
                const url = `${APP_URL}/t/${ticketOrderId}`;
                if (navigator.share) { try { await navigator.share({ title: `${evTitle} — Tickets`, url }); } catch {} }
                else { navigator.clipboard?.writeText(url); }
              };
              return <>
                <p style={{color:"var(--text2)",fontSize:13,marginBottom:24}}>{evTitle}{evDate ? ` — ${evDate}` : ''}</p>
                {order.status === 'cancelled' && <div style={{background:"rgba(179,58,42,.12)",border:"1px solid rgba(179,58,42,.35)",borderRadius:"var(--rs)",padding:"14px 16px",marginBottom:20,color:"var(--red)",fontSize:13,fontWeight:600}}>This order has been cancelled and refunded.</div>}
                {hasReceipt && (
                  <div style={{marginBottom:20,padding:"16px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--rs)"}}>
                    <p style={{fontSize:12,fontWeight:700,color:"var(--gold)",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Purchase Receipt</p>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      {(order.order_items||[]).map((i,idx) => <tr key={idx}>
                        <td style={{padding:"4px 0",fontSize:13,color:"var(--text2)"}}>{i.quantity}× {i.ticket_type_name}</td>
                        <td style={{padding:"4px 0",fontSize:13,color:"var(--text2)",textAlign:"right"}}>{fmtCurrency(i.quantity*Number(i.unit_price))}</td>
                      </tr>)}
                      <tr><td colSpan={2} style={{padding:"8px 0 4px",borderTop:"1px solid var(--border)"}}></td></tr>
                      <tr><td style={{fontSize:12,color:"var(--text3)"}}>Sales Tax (6%)</td><td style={{fontSize:12,color:"var(--text3)",textAlign:"right"}}>{fmtCurrency(order.sales_tax)}</td></tr>
                      <tr><td style={{fontSize:12,color:"var(--text3)"}}>Service Fees</td><td style={{fontSize:12,color:"var(--text3)",textAlign:"right"}}>{fmtCurrency(order.service_fees)}</td></tr>
                      {order.processing_fee > 0 && <tr><td style={{fontSize:12,color:"var(--text3)"}}>Processing Fee</td><td style={{fontSize:12,color:"var(--text3)",textAlign:"right"}}>{fmtCurrency(order.processing_fee)}</td></tr>}
                      <tr><td style={{padding:"8px 0 0",fontWeight:700,fontSize:14,color:"var(--text)"}}>Total Paid</td><td style={{padding:"8px 0 0",fontWeight:700,fontSize:14,color:"var(--gold)",textAlign:"right"}}>{fmtCurrency(order.total_amount)}</td></tr>
                    </table>
                  </div>
                )}
                {!ticketFilterId && order.status !== 'cancelled' && <div style={{marginBottom:16,display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button className="btn" style={{flex:1}} onClick={() => window.print()}>Print All</button>
                  <button className="btn" style={{flex:1}} onClick={shareAll}>Share All Tickets</button>
                  {ev && <a href={buildGCalUrl(ev, venue.location)} target="_blank" rel="noopener noreferrer" className="btn" style={{flex:1,textAlign:"center",textDecoration:"none"}}>Google Calendar</a>}
                  {ev && <button className="btn" style={{flex:1}} onClick={() => downloadIcs(ev, venue.location)}>Download .ics</button>}
                </div>}
                <div style={{marginBottom:24,padding:"20px 16px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--rs)"}}>
                  <p style={{fontSize:13,color:"var(--text2)",marginBottom:10}}>Want a copy in your inbox?</p>
                  {ticketResendSent
                    ? <p style={{fontSize:13,color:"var(--gold)",fontWeight:600}}>Sent! Check your inbox.</p>
                    : <div style={{display:"flex",gap:8}}>
                        <input className="fi" type="email" placeholder="your@email.com" value={ticketResendEmail} onChange={e=>setTicketResendEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendTicketResend()} style={{flex:1,padding:"8px 10px",fontSize:13}} />
                        <button className="btn" onClick={sendTicketResend} disabled={ticketResendSending||!ticketResendEmail} style={{flexShrink:0}}>{ticketResendSending?"Sending…":"Email Me"}</button>
                      </div>
                  }
                </div>
                <div id="ticket-print-area">
                  {displayTickets.map((t, idx) => {
                    const shareTicket = async () => {
                      const url = `${APP_URL}/t/${ticketOrderId}?ticket=${t.id}`;
                      if (navigator.share) { try { await navigator.share({ title: `${evTitle} — Ticket ${t.ticket_number}`, url }); } catch {} }
                      else { navigator.clipboard?.writeText(url); }
                    };
                    return (
                      <div key={t.id} className="tkt-disp" style={{marginBottom:20,pageBreakInside:'avoid'}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                          <div>
                            <div style={{fontSize:11,color:"var(--gold)",fontWeight:700,textTransform:"uppercase",letterSpacing:1.5,marginBottom:4}}>{evDate}{evTime ? ` · ${evTime}` : ''}</div>
                            <div className="dsp" style={{fontSize:18,marginBottom:2}}>{evTitle}</div>
                            <div style={{fontSize:13,color:"var(--gold)",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>{t.ticket_type_name}</div>
                          </div>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <div style={{fontSize:11,color:"var(--text3)"}}>Ticket</div>
                            <div style={{fontSize:22,fontWeight:700,color:"var(--text)"}}>{t.ticket_number}<span style={{fontSize:13,color:"var(--text3)",fontWeight:400}}> / {tickets.length}</span></div>
                          </div>
                        </div>
                        {evDoors && <div style={{fontSize:12,color:"var(--text2)",marginBottom:10}}>Doors {evDoors} · {venue.name} · {venue.location}</div>}
                        <div style={{textAlign:"center",margin:"12px 0"}}>
                          <div style={{background:"white",borderRadius:8,padding:10,display:"inline-block"}}>
                            <QRImg value={t.id} size={160} />
                          </div>
                          <div style={{fontSize:11,color:"var(--gold)",fontWeight:700,textTransform:"uppercase",letterSpacing:1.5,marginTop:8}}>Present at Door</div>
                          <div style={{fontFamily:"monospace",fontSize:10,color:"var(--text3)",marginTop:4,letterSpacing:1}}>{t.id.toUpperCase()}</div>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:"var(--text2)"}}>
                          <span>{order.buyer_name}</span>
                          <span className={`badge ${t.status==='checked_in'?'badge-done':t.status==='cancelled'?'badge-cancelled':'badge-ok'}`}>{t.status==='checked_in'?'Checked In':t.status==='cancelled'?'Cancelled':'Valid'}</span>
                        </div>
                        <button className="btn" style={{width:"100%",marginTop:10,fontSize:12}} onClick={shareTicket}>Save / Share Ticket {t.ticket_number}</button>
                      </div>
                    );
                  })}
                </div>
              </>;
            })()}
          </div>
        )}

        {view === "lookup" && <div className="sec fade" style={{maxWidth:520}}>
          <div className="back" onClick={goHome}>← Back to Events</div>
          <h1 className="dsp" style={{fontSize:28,marginBottom:6}}>Find My Tickets</h1>
          {lookupStep === 'email' && <>
            <p style={{color:"var(--text2)",fontSize:13,marginBottom:24}}>Enter the email address you used when purchasing. We'll send you a direct link to your tickets.</p>
            <div className="tkt-sec" style={{marginBottom:20}}>
              <div className="fg"><label className="fl" htmlFor="lookup-email">Email Address</label><input id="lookup-email" className="fi" type="email" value={lookupEmail} onChange={e=>setLookupEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendLookupCode()} placeholder="jane@email.com" /></div>
              <button className="buy" style={{width:"100%",marginTop:10}} disabled={lookupLoading||!lookupEmail} onClick={sendLookupCode}>{lookupLoading?"Sending…":"Send My Ticket Links"}</button>
            </div>
          </>}
          {lookupStep === 'sent' && <div className="tkt-sec" style={{textAlign:"center",padding:"32px 20px"}}>
            <div style={{fontSize:32,marginBottom:16}}>✉️</div>
            <p style={{color:"var(--text1)",fontWeight:700,fontSize:16,marginBottom:8}}>Check your inbox!</p>
            <p style={{color:"var(--text2)",fontSize:13,marginBottom:24}}>If we have tickets for <strong style={{color:"var(--text1)"}}>{lookupEmail}</strong>, we've sent you direct links to access them.</p>
            <button style={{background:"none",border:"none",color:"var(--text3)",fontSize:12,cursor:"pointer",padding:4}} onClick={()=>{setLookupStep('email');setLookupEmail('');setLookupError('');}}>Try a different email</button>
          </div>}
        </div>}

        {view === "venue" && (() => {
          const vp = venues.find(v => v.id === venueProfileId) || venue;
          const vpEvents = allPublicEvents
            .filter(e => e.venueId === vp.id)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
          return (
            <div className="fade">
              <div className="back" onClick={goHome}>← All Events</div>
              <div style={{maxWidth:820,margin:'0 auto',padding:'0 0 60px'}}>
                <div style={{borderBottom:'1px solid var(--border)',paddingBottom:32,marginBottom:40}}>
                  <h1 className="dsp" style={{fontSize:'clamp(28px,5vw,48px)',marginBottom:8}}>{vp.name}</h1>
                  <div style={{display:'flex',flexWrap:'wrap',gap:'16px 24px',fontSize:14,color:'var(--text2)',marginTop:16}}>
                    {vp.location && <span style={{display:'flex',alignItems:'center',gap:6}}><span style={{color:'var(--gold)'}}>Location</span>{vp.location}</span>}
                    {vp.phone && <span style={{display:'flex',alignItems:'center',gap:6}}><span style={{color:'var(--gold)'}}>Phone</span>{vp.phone}</span>}
                    {vp.email && <span style={{display:'flex',alignItems:'center',gap:6}}><span style={{color:'var(--gold)'}}>Email</span><a href={`mailto:${vp.email}`} style={{color:'inherit'}}>{vp.email}</a></span>}
                    {vp.website && <span style={{display:'flex',alignItems:'center',gap:6}}><span style={{color:'var(--gold)'}}>Web</span><a href={vp.website} target="_blank" rel="noopener noreferrer" style={{color:'var(--gold)'}}>{vp.website.replace(/^https?:\/\//,'')}</a></span>}
                  </div>
                  {vp.location && <a className="directions-btn" style={{marginTop:20,display:'inline-block'}} href={`https://maps.google.com/?q=${encodeURIComponent(vp.location)}`} target="_blank" rel="noopener noreferrer">Get Directions</a>}
                </div>
                <h2 className="dsp" style={{fontSize:22,marginBottom:24}}>Upcoming Events</h2>
                {vpEvents.length === 0
                  ? <div className="empty"><div className="ic" style={{fontSize:36}}>🎟</div><p>No upcoming events at this venue.</p></div>
                  : <div className="grid">
                      {vpEvents.map(ev => {
                        const soldOut = ev.tickets?.every(t => t.available <= 0);
                        return (
                          <div key={ev.id} className="card" role="button" tabIndex={0} onClick={() => { setSelId(ev.id); setCart({}); setView('detail'); window.history.pushState({}, '', `/e/${ev.id}`); }} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelId(ev.id);setCart({});setView('detail');window.history.pushState({},'',(ev.id));}}}>
                            <div className="card-img">
                              {ev.image
                                ? <img src={ev.image} alt={ev.title} loading="lazy" style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:`${(ev.focalX??50)}% ${(ev.focalY??50)}%`}} />
                                : <div style={{width:'100%',height:'100%',background:'var(--bg3)'}} />}
                              {soldOut && <div className="sold-out-badge">Sold Out</div>}
                            </div>
                            <div className="card-body">
                              <div className="card-cat">{ev.category}</div>
                              <div className="card-title">{ev.title}</div>
                              <div className="card-date">{fmtDate(ev.date)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                }
              </div>
            </div>
          );
        })()}

        {view === "about" && <div className="fade">
          <div className="about-hero">
            <img src={LOGO_FULL} alt="C8 Tickets" style={{width:'clamp(280px,80vw,560px)',height:'auto',opacity:.97,marginBottom:12}} />
            <h1 className="dsp">Local Events,<br/>Easy Tickets.</h1>
            <p>A ticketing platform built from the ground up for the venues, organizers, and communities that make local events worth attending.</p>
          </div>

          <div className="about-sec">
            <h2 className="dsp">Our Story</h2>
            <div className="about-divider" style={{margin:'0 0 28px'}}></div>
            <p>C8Tickets was built out of years of firsthand frustration. Event organizers across the Treasure Valley were piecing together solutions never designed for selling tickets — Facebook events with Venmo payment links, handwritten lists, cash at the door — while the platforms actually built for ticketing were designed for arenas and stadium tours, not local bars, rodeos, and community gatherings.</p>
            <p>When something went wrong with those big platforms, support meant navigating a phone tree to reach someone in another time zone who had never heard of your venue. When you needed a quick fix the night of an event, you were on your own.</p>
            <p>We built C8Tickets to change that. Local events deserve a local solution — one built specifically for the small venue, backed by people who understand what it takes to put on an event in your own community.</p>
          </div>

          <div style={{background:'var(--bg2)',borderTop:'1px solid var(--border)',borderBottom:'1px solid var(--border)',padding:'56px 20px'}}>
            <div style={{maxWidth:820,margin:'0 auto'}}>
              <h2 className="dsp" style={{fontSize:'clamp(24px,4vw,36px)',marginBottom:8,textAlign:'center'}}>Who We're Built For</h2>
              <div className="about-divider" style={{marginBottom:28}}></div>
              <p style={{color:'var(--text2)',fontSize:15,lineHeight:1.8,textAlign:'center',maxWidth:620,margin:'0 auto 36px'}}>From intimate bar shows and local rodeos to community fairs, fundraisers, and multi-night festivals — if you're putting on an event for your community, C8Tickets was built for you. We specialize in the events the big platforms overlook: the ones under a few hundred people, run by real people, that mean the most to the communities they serve.</p>
              <div className="about-grid">
                {[['Bars & Venues','Small clubs, bars, and music venues hosting local talent and ticketed events.'],['Rodeos & Fairs','Community rodeos, county fairs, and seasonal events that bring people together.'],['Live Music','Local and regional artists, tribute nights, open mic events, and more.'],['Community Events','Fundraisers, charity events, festivals, and neighborhood gatherings of all sizes.']].map(([title,desc])=>(
                  <div className="about-card" key={title}>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="about-sec">
            <h2 className="dsp" style={{textAlign:'center'}}>Why C8Tickets</h2>
            <div className="about-divider" style={{marginBottom:28}}></div>
            <div className="about-grid">
              {[
                ['Local Support','We\'re based in Kuna, Idaho. When you email us, a real person reads it and responds — not a ticketing system, not an overseas support center. We know what it\'s like to manage an event night, and we\'re here when you need us.'],
                ['Transparent Fees','Competitive, straightforward pricing with no hidden charges or surprise deductions. The big platforms take a significant cut and make it hard to understand what you\'re actually paying. We keep it simple so more of your revenue stays where it belongs — with you.'],
                ['Built for Small Venues','Every feature in C8Tickets was designed with the small event organizer in mind. Ticket tiers, door sales, check-in tools, physical ticket printing, live dashboards. The tools you actually need, without the complexity you don\'t.'],
                ['Easy by Design','Create an event in minutes. Your customers get a clean, mobile-friendly buying experience. You get real-time sales data, a built-in check-in scanner, and an at-door sales terminal — all from one place, on any device.'],
              ].map(([title,desc])=>(
                <div className="about-card" key={title}>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="about-cta">
            <h2 className="dsp">Ready to Sell Tickets?</h2>
            <p>Reach out and we'll get your events set up quickly.</p>
            <a href="#" onClick={e=>{e.preventDefault();setView('sell');}}>Get Started</a>
          </div>
        </div>}

        {view === "sell" && <div className="fade">
          <div className="back" onClick={() => setView("home")}>← Back</div>
          <div className="about-hero">
            <img src={LOGO_FULL} alt="C8 Tickets" style={{width:'clamp(280px,80vw,560px)',height:'auto',opacity:.97,marginBottom:12}} />
            <h1 className="dsp">Sell Event Tickets<br/>in the Treasure Valley</h1>
            <p>The local ticketing platform built for bars, venues, and event organizers in Boise, Nampa, Meridian, Kuna, and across Idaho. Get your event live in minutes.</p>
          </div>
          <div style={{background:'var(--bg2)',borderTop:'1px solid var(--border)',borderBottom:'1px solid var(--border)',padding:'56px 20px'}}>
            <div style={{maxWidth:820,margin:'0 auto'}}>
              <h2 className="dsp" style={{fontSize:'clamp(20px,3.5vw,30px)',marginBottom:8,textAlign:'center'}}>Everything You Need to Sell Tickets</h2>
              <div className="about-divider" style={{marginBottom:28}}></div>
              <div className="about-grid">
                {[
                  ['Fast Setup','Create your event, set ticket tiers and pricing, and go live — all in minutes. No waiting on approvals or account reps.'],
                  ['Online & Door Sales','Customers buy in advance from any device. Staff sell at the door using a card reader or manual entry, all through the same system.'],
                  ['Automatic QR Tickets','Every buyer gets an instant confirmation email with their QR code the moment their payment clears. No manual follow-up needed.'],
                  ['Gate Check-In','Scan QR codes at the entrance from any phone or tablet. No paper lists, no spreadsheets — works for groups too.'],
                  ['Real-Time Sales Dashboard','Track ticket sales, revenue, and check-in counts as they come in, from any device, at any time.'],
                  ['No Setup Fees','You pay nothing to get started. Fees are transparently shown to buyers at checkout — no surprise deductions from your payout.'],
                ].map(([title,desc])=>(
                  <div className="about-card" key={title}><h3>{title}</h3><p>{desc}</p></div>
                ))}
              </div>
            </div>
          </div>
          <div className="about-sec" style={{maxWidth:580}}>
            <h2 className="dsp" style={{textAlign:'center'}}>Built for Treasure Valley Venues</h2>
            <div className="about-divider" style={{marginBottom:20}}></div>
            <p style={{color:'var(--text2)',fontSize:14,lineHeight:1.7,marginBottom:28,textAlign:'center'}}>Whether you're running a concert at a Boise bar, a rodeo in Nampa, a community event in Meridian, or anything in between — C8Tickets was built for exactly this. Fill out the form and we'll have you set up fast.</p>
            {sellStatus === 'sent' ? (
              <div style={{textAlign:'center',padding:'40px 20px',background:'var(--bg2)',border:'1px solid rgba(200,146,42,.2)',borderRadius:'var(--r)'}}>
                <div style={{fontSize:17,fontWeight:700,color:'var(--text)',marginBottom:8,textTransform:'uppercase',letterSpacing:1}}>Inquiry Received</div>
                <p style={{color:'var(--text2)',fontSize:14,lineHeight:1.7,margin:0}}>Thanks, {sellForm.name.split(' ')[0]}. We'll be in touch at {sellForm.email} shortly.</p>
              </div>
            ) : (<>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 16px'}}>
                <div className="fg"><label className="fl" htmlFor="sell-name">Your Name *</label><input id="sell-name" className="fi" value={sellForm.name} onChange={e=>setSellForm(p=>({...p,name:e.target.value}))} placeholder="Jane Smith" /></div>
                <div className="fg"><label className="fl" htmlFor="sell-phone">Phone Number</label><input id="sell-phone" className="fi" type="tel" value={sellForm.phone} onChange={e=>setSellForm(p=>({...p,phone:e.target.value}))} placeholder="(208) 555-1234" /></div>
              </div>
              <div className="fg"><label className="fl" htmlFor="sell-email">Email Address *</label><input id="sell-email" className="fi" type="email" value={sellForm.email} onChange={e=>setSellForm(p=>({...p,email:e.target.value}))} placeholder="jane@youremail.com" /></div>
              <div className="fg"><label className="fl" htmlFor="sell-event-name">Event Name / Type *</label><input id="sell-event-name" className="fi" value={sellForm.eventName} onChange={e=>setSellForm(p=>({...p,eventName:e.target.value}))} placeholder="e.g. Summer Concert, Charity Gala, Rodeo Night" /></div>
              <div className="fg"><label className="fl" htmlFor="sell-location">Event Location</label><input id="sell-location" className="fi" value={sellForm.location} onChange={e=>setSellForm(p=>({...p,location:e.target.value}))} placeholder="Venue name and/or address" /></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 16px'}}>
                <div className="fg"><label className="fl" htmlFor="sell-date">Event Date</label><input id="sell-date" className="fi" type="date" value={sellForm.date} onChange={e=>setSellForm(p=>({...p,date:e.target.value}))} /></div>
                <div className="fg"><label className="fl" htmlFor="sell-attendance">Expected Attendance</label><input id="sell-attendance" className="fi" value={sellForm.attendance} onChange={e=>setSellForm(p=>({...p,attendance:e.target.value}))} placeholder="e.g. 150–200" /></div>
              </div>
              <div className="fg">
                <label className="fl">How Will You Sell Tickets?</label>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {[['online','Online only'],['door','At the door only'],['both','Online and at the door']].map(([val,label])=>(
                    <button key={val} type="button" className={`btn${sellForm.channel===val?' on':''}`} style={{fontSize:12,padding:'8px 14px'}} onClick={()=>setSellForm(p=>({...p,channel:val}))}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="fg"><label className="fl" htmlFor="sell-notes">Anything Else?</label><textarea id="sell-notes" className="fi" rows={4} style={{resize:'vertical'}} value={sellForm.notes} onChange={e=>setSellForm(p=>({...p,notes:e.target.value}))} placeholder="Ticket tiers, special requirements, questions, or anything else we should know…" /></div>
              {sellStatus === 'error' && <p style={{fontSize:12,color:'var(--red)',marginBottom:12}}>Something went wrong. Please try again or email support@c8tickets.com directly.</p>}
              <button className="buy" disabled={!sellForm.name||!sellForm.email||sellStatus==='sending'} onClick={submitSellInquiry}>{sellStatus==='sending'?'Sending…':'Send Inquiry'}</button>
            </>)}
          </div>
        </div>}

        {view === "terms" && <div className="legal fade">
  <div className="back" onClick={() => setView("home")}>← Back</div>
  <h1 className="dsp">Terms of Service</h1>
  <p className="date">Effective Date: April 21, 2026</p>

  <h2>1. About C8Tickets</h2>
  <p>C8Tickets is a ticketing platform operated in Kuna, Idaho. We provide ticket sales services on behalf of event organizers. C8Tickets is the ticketing platform — we are not the event organizer and are not responsible for the events themselves.</p>

  <h2>2. Ticket Sales</h2>
  <p>All ticket sales are final. We do not offer refunds except in the case of event cancellation by the organizer. If an event is cancelled, refund policies are determined by the event organizer.</p>

  <h2>3. Fees</h2>
  <p>Ticket purchases are subject to the following fees in addition to the base ticket price:</p>
  <ul>
    <li>Idaho State Sales Tax (6%) on ticket subtotal</li>
    <li>Service fee of $2.00 per ticket</li>
    <li>Payment processing fee of 3.5% + $0.30 per transaction</li>
  </ul>
  <p>All fees are displayed and itemized before you complete your purchase.</p>

  <h2>4. Payment</h2>
  <p>Payments are processed securely through Stripe. C8Tickets does not store your credit card information. By completing a purchase you agree to Stripe's terms of service.</p>

  <h2>5. Tickets and Entry</h2>
  <p>Your ticket confirmation and QR code will be emailed to you after purchase. You are responsible for presenting your QR code at the event. C8Tickets is not responsible for lost or stolen tickets.</p>

  <h2>6. Limitation of Liability</h2>
  <p>C8Tickets is not liable for any damages arising from your use of this platform, attendance at events, or event cancellations. Our liability is limited to the amount you paid for your tickets.</p>

  <h2>7. Contact</h2>
  <p>For questions or support, contact us at <a href="mailto:support@c8tickets.com" style={{color:"var(--gold)"}}>support@c8tickets.com</a>.</p>
</div>}

{view === "privacy" && <div className="legal fade">
  <div className="back" onClick={() => setView("home")}>← Back</div>
  <h1 className="dsp">Privacy Policy</h1>
  <p className="date">Effective Date: April 21, 2026</p>

  <h2>1. Information We Collect</h2>
  <p>When you purchase tickets through C8Tickets, we collect:</p>
  <ul>
    <li>Your name, email address, and phone number</li>
    <li>Payment information (processed securely by Stripe — we do not store card numbers)</li>
    <li>Order details including events attended and tickets purchased</li>
  </ul>

  <h2>2. How We Use Your Information</h2>
  <p>We use your information to:</p>
  <ul>
    <li>Process and confirm your ticket purchase</li>
    <li>Send you your ticket confirmation and QR code</li>
    <li>Provide customer support</li>
    <li>Comply with applicable tax and legal requirements</li>
  </ul>

  <h2>3. Payment Processing</h2>
  <p>All payments are processed by Stripe, Inc. Your credit card information is transmitted directly to Stripe and is never stored on our servers. Stripe's privacy policy is available at stripe.com/privacy.</p>

  <h2>4. Data Sharing</h2>
  <p>We do not sell your personal information. We may share your information with event organizers for the purpose of event entry and check-in. We may also disclose information as required by law.</p>

  <h2>5. Data Retention</h2>
  <p>We retain order and customer data for a minimum of 7 years as required for tax and accounting purposes.</p>

  <h2>6. Your Rights</h2>
  <p>You may request access to or deletion of your personal data by contacting us at <a href="mailto:support@c8tickets.com" style={{color:"var(--gold)"}}>support@c8tickets.com</a>. Note that some data may be retained as required by law.</p>

  <h2>7. Jurisdiction</h2>
  <p>This platform is operated from Kuna, Idaho, USA. By using this platform you agree that any disputes will be governed by the laws of the State of Idaho.</p>

  <h2>8. Contact</h2>
  <p>For privacy questions, contact us at <a href="mailto:support@c8tickets.com" style={{color:"var(--gold)"}}>support@c8tickets.com</a>.</p>
</div>}
        {view === "forgot" && <div className="sec fade" style={{ maxWidth: 400, paddingTop: 60 }}>
  <div className="back" onClick={() => { setView("login"); setResetSent(false); setResetError(''); }}>← Back to Login</div>
  <h1 className="dsp" style={{ fontSize: 28, marginBottom: 6 }}>Reset Password</h1>
  <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 24 }}>Enter your email and we'll send you a reset link.</p>
  <div className="tkt-sec">
    {!resetSent ? <>
      <div className="fg">
        <label className="fl" htmlFor="reset-email">Email</label>
        <input id="reset-email" className="fi" type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder="your@email.com" />
      </div>
      {resetError && <p style={{ color: "var(--red)", fontSize: 12, marginBottom: 10 }}>{resetError}</p>}
      <button className="buy" onClick={sendReset} disabled={!resetEmail}>Send Reset Link</button>
    </> : <div style={{textAlign:"center",padding:"20px 0"}}>
      <div style={{fontSize:32,marginBottom:12}}>✉️</div>
      <p style={{color:"var(--text2)",fontSize:14}}>Reset link sent to <strong style={{color:"var(--text)"}}>{resetEmail}</strong></p>
      <p style={{color:"var(--text3)",fontSize:12,marginTop:8}}>Check your inbox and follow the link to reset your password.</p>
    </div>}
  </div>
</div>}
        {view === "reset" && <div className="sec fade" style={{ maxWidth: 400, paddingTop: 60 }}>
  <h1 className="dsp" style={{ fontSize: 28, marginBottom: 6 }}>New Password</h1>
  <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 24 }}>Enter your new password below.</p>
  <div className="tkt-sec">
    <div className="fg">
      <label className="fl" htmlFor="new-password">New Password</label>
      <input id="new-password" className="fi" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Minimum 6 characters" />
    </div>
    <button className="buy" onClick={() => { if (newPassword.length >= 6) { updatePassword(newPassword); setNewPassword(''); } }}>Update Password</button>
  </div>
</div>}
        {view === "login" && <div className="sec fade" style={{ maxWidth: 400, paddingTop: 60 }}>
  <h1 className="dsp" style={{ fontSize: 28, marginBottom: 6 }}>Staff Login</h1>
  <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 24 }}>Enter your staff credentials</p>
  <div className="tkt-sec">
    <div className="fg">
      <label className="fl" htmlFor="auth-email">Email</label>
      <input id="auth-email" className="fi" type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} placeholder="admin@crooked8.com" />
    </div>
    <div className="fg">
      <label className="fl" htmlFor="auth-password">Password</label>
      <input id="auth-password" className="fi" type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} placeholder="••••••••" />
    </div>
    {authError && <p style={{ color: "var(--red)", fontSize: 12, marginBottom: 10 }}>{authError}</p>}
    <button className="buy" onClick={login}>Sign In</button>
<button className="btn" style={{width:"100%",marginTop:8}} onClick={() => setView("forgot")}>Forgot Password?</button>
  </div>
</div>}
        {view === "gate" && <GateView events={events} onLogout={logout} />}

        {view === "admin" && <div className="admin fade">
          <div className="aside">{[
            ['dashboard','Dashboard',<svg key="d" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>],
            ['events','Events',<svg key="e" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>],
            ['orders','Orders',<svg key="o" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>],
            ['check-in','Check-In',<svg key="c" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>],
            ['door','Door Sales',<svg key="ds" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>],
            ['live','Live',<svg key="l" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>],
            ['reports','Reports',<svg key="r" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>],
            ['promos','Promo Codes',<svg key="p" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>],
            ...(!isVenueUser ? [['accounts','Accounts',<svg key="ac" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>]] : []),
          ].map(([t,label,icon]) => <button key={t} className={`aside-btn ${aTab===t?"on":""}`} onClick={() => { setATab(t); if(t==='promos'&&!promosLoaded) loadPromos(); if(t==='accounts'&&!venueUsersLoaded) loadVenueUsers(); }} style={{display:'flex',alignItems:'center',gap:8}}>{icon}{label}</button>)}</div>
          <div className="amain">
            {aTab === "dashboard" && (() => {
              const now = new Date();
              const inRange = (o) => {
                const d = new Date(o.date);
                if (dashFilter==='month') return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
                if (dashFilter==='prev_month') { const p=new Date(now.getFullYear(),now.getMonth()-1,1); return d.getMonth()===p.getMonth()&&d.getFullYear()===p.getFullYear(); }
                if (dashFilter==='ytd') return d.getFullYear()===now.getFullYear();
                if (dashFilter==='last_year') return d.getFullYear()===now.getFullYear()-1;
                if (dashFilter==='custom') { const s=dashCustomStart?new Date(dashCustomStart+'T00:00:00'):null; const e=dashCustomEnd?new Date(dashCustomEnd+'T23:59:59'):null; if(s&&d<s)return false; if(e&&d>e)return false; return true; }
                return true;
              };
              const vo=orders.filter(o=>o.venueId===venue.id&&o.status!=='cancelled'&&inRange(o));
              const tix=vo.reduce((s,o)=>s+o.items.reduce((a,b)=>a+b.qty,0),0);
              const ci=vo.filter(o=>o.checkedIn).length;
              const venueRev=vo.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0);
              const salesTax=Math.round(venueRev*0.06*100)/100;
              const serviceFees=tix*2;
              const processingFees=Math.max(0,Math.round((vo.reduce((s,o)=>s+o.total,0)-venueRev-salesTax-serviceFees)*100)/100);
              const filterLabels={month:'This Month',prev_month:'Prev Month',ytd:'Year to Date',last_year:'Last Year',all:'All Time',custom:'Custom Range'};
              return <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
                <h2 className="dsp" style={{fontSize:26}}>Dashboard</h2>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {Object.entries(filterLabels).map(([v,l])=><button key={v} className={`btn${dashFilter===v?' gold':''}`} style={{fontSize:11,padding:"5px 10px"}} onClick={()=>setDashFilter(v)}>{l}</button>)}
                </div>
              </div>
              {dashFilter==='custom'&&<div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}><label style={{fontSize:11,color:"var(--text3)",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>From</label><input className="fi" type="date" value={dashCustomStart} onChange={e=>setDashCustomStart(e.target.value)} style={{width:160,margin:0}} /></div>
                <div style={{display:"flex",alignItems:"center",gap:6}}><label style={{fontSize:11,color:"var(--text3)",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>To</label><input className="fi" type="date" value={dashCustomEnd} onChange={e=>setDashCustomEnd(e.target.value)} style={{width:160,margin:0}} /></div>
              </div>}
              <div className="sg"><div className="sc"><div className="l">Venue Revenue</div><div className="v gd">{venueRev===0?"$0":"$"+venueRev.toFixed(2)}</div><div className="s">Owed to organizer</div></div>{!isVenueUser&&<><div className="sc"><div className="l">Service Revenue</div><div className="v gd">{serviceFees===0?"$0":"$"+serviceFees.toFixed(2)}</div><div className="s">Service fees</div></div><div className="sc"><div className="l">Processing Fees</div><div className="v">{processingFees===0?"$0":"$"+processingFees.toFixed(2)}</div><div className="s">Remit to Stripe</div></div><div className="sc"><div className="l">Sales Tax</div><div className="v">{salesTax===0?"$0":"$"+salesTax.toFixed(2)}</div><div className="s">Remit to Idaho</div></div></>}<div className="sc"><div className="l">Tickets Sold</div><div className="v">{tix}</div></div><div className="sc"><div className="l">Orders</div><div className="v">{vo.length}</div></div><div className="sc"><div className="l">Checked In</div><div className="v">{ci}</div><div className="s">{vo.length>0?Math.round(ci/vo.length*100):0}%</div></div><div className="sc"><div className="l">Active Events</div><div className="v">{vEvents.length}</div></div></div>
              <h3 className="dsp" style={{fontSize:20,marginBottom:14}}>By Event</h3>
              {(()=>{
                const evRows=vEvents.map(ev=>{
                  const eo=vo.filter(o=>o.eventId===ev.id);
                  if(!eo.length) return null;
                  const etix=eo.reduce((s,o)=>s+o.items.reduce((a,b)=>a+b.qty,0),0);
                  const erev=eo.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0);
                  const etax=Math.round(erev*0.06*100)/100;
                  const esvc=etix*2;
                  const eproc=Math.max(0,Math.round((eo.reduce((s,o)=>s+o.total,0)-erev-etax-esvc)*100)/100);
                  const eci=eo.filter(o=>o.checkedIn).length;
                  return {ev,eo,etix,erev,etax,esvc,eproc,eci};
                }).filter(Boolean);
                if(!evRows.length) return <div className="empty" style={{marginBottom:28}}><p>No event data for this period.</p></div>;
                return <div style={{overflowX:"auto",marginBottom:28}}><table className="dt"><thead><tr><th>Event</th><th>Date</th><th>Orders</th><th>Tickets</th><th>Venue Rev</th>{!isVenueUser&&<><th>Svc Rev</th><th>Processing</th><th>Tax</th></>}<th>Check-in</th></tr></thead><tbody>{evRows.map(({ev,eo,etix,erev,etax,esvc,eproc,eci})=><tr key={ev.id}><td style={{fontWeight:600}}>{ev.title}</td><td style={{fontSize:11}}>{fmtDate(ev.date)}</td><td>{eo.length}</td><td>{etix}</td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(erev)}</td>{!isVenueUser&&<><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(esvc)}</td><td style={{fontSize:12}}>{fmtCurrency(eproc)}</td><td style={{fontSize:12}}>{fmtCurrency(etax)}</td></>}<td style={{fontSize:12}}>{eo.length>0?Math.round(eci/eo.length*100):0}%</td></tr>)}</tbody></table></div>;
              })()}
              <h3 className="dsp" style={{fontSize:20,marginBottom:14}}>Recent Orders</h3>
              {vo.length===0?<div className="empty"><div className="ic">📭</div><p>No orders yet.</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th>Order</th><th>Buyer</th><th>Event</th><th>Total</th><th>Status</th></tr></thead><tbody>{vo.slice(-10).reverse().map(o=>{const ev=events.find(e=>e.id===o.eventId);return <tr key={o.id}><td style={{fontFamily:"monospace",fontSize:11}}>{o.id.slice(0,12)}</td><td>{o.buyer.name}</td><td>{ev?.title||"—"}</td><td style={{fontWeight:700}}>{fmtCurrency(o.total)}</td><td><span className={`badge ${o.checkedIn?"badge-done":"badge-ok"}`}>{o.checkedIn?"Checked In":"Valid"}</span></td></tr>})}</tbody></table></div>}
            </>; })()}

            {aTab === "events" && <><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}><h2 className="dsp" style={{fontSize:26}}>Manage Events</h2><button className="btn gold" onClick={()=>{setEditEvt(blank());setModal(true);}}>+ New Event</button></div>
              {vEvents.length===0?<div className="empty"><div className="ic">🎫</div><p>No events.</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th>Event</th><th>Date</th><th>Category</th><th>Remaining</th><th>Status</th><th>Actions</th></tr></thead><tbody>{vEvents.map(ev=><tr key={ev.id}><td style={{fontWeight:600}}>{ev.title}</td><td>{fmtDate(ev.date)}</td><td>{ev.category}</td><td>{ev.tickets.reduce((s,t)=>s+t.available,0)}</td><td><span className={`badge ${ev.published!==false?"badge-ok":"badge-sold"}`}>{ev.published!==false?"Live":"Hidden"}</span></td><td style={{display:"flex",gap:6}}><button className="btn" style={{fontSize:11,padding:"5px 10px"}} onClick={()=>{setEditEvt({...ev});setModal(true);}}>Edit</button><button className="btn" style={{fontSize:11,padding:"5px 10px",color:ev.published!==false?"var(--text2)":"var(--gold)"}} disabled={togglingPublish.has(ev.id)} onClick={()=>togglePublish(ev)}>{togglingPublish.has(ev.id)?"Saving…":ev.published!==false?"Unpublish":"Publish"}</button>{ev.tickets.some(t=>(t.physicalQty??0)>0)&&<><button className="btn gold" style={{fontSize:11,padding:"5px 10px"}} disabled={!!generatingPhysical} onClick={()=>{setTicketSizeSelected('strip');setTicketSizeModal({ev,mode:'print'});}}>{generatingPhysical===ev.id?"Generating…":"🖨 Print"}</button><button className="btn gold" style={{fontSize:11,padding:"5px 10px"}} disabled={!!generatingPhysical} onClick={()=>{setTicketSizeSelected('strip');setTicketSizeModal({ev,mode:'photo'});}}>{generatingPhysical===ev.id+'-photo'?"Generating…":"📸 Photo PDF"}</button></>}<button className="btn" style={{fontSize:11,padding:"5px 10px"}} disabled={sendingReminder===ev.id} onClick={()=>sendReminder(ev)}>{sendingReminder===ev.id?'Sending…':'Remind All'}</button><button className="btn" style={{fontSize:11,padding:"5px 10px"}} onClick={()=>exportOrdersCSV(orders.filter(o=>o.eventId===ev.id),events,`${ev.title.replace(/[^\w\s-]/g,'').replace(/\s+/g,'-')}-orders.csv`)}>Export CSV</button><button className="btn" style={{fontSize:11,padding:"5px 10px",color:"var(--red)"}} onClick={()=>delEvt(ev.id)}>Delete</button></td></tr>)}</tbody></table></div>}</>}

            {aTab === "orders" && (()=>{
              const vo=orders.filter(o=>o.venueId===venue.id);
              const vs=orderSourceFilter==='all'?vo:vo.filter(o=>orderSourceFilter==='online'?(o.source==='online'||!o.source):o.source==='door'||o.source==='door_cash');
              const q=orderSearch.toLowerCase().trim();
              const fo=q?vs.filter(o=>{const ev=events.find(e=>e.id===o.eventId);return o.buyer.name.toLowerCase().includes(q)||o.buyer.email.toLowerCase().includes(q)||(ev?.title||'').toLowerCase().includes(q);}):vs;
              return <>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:10}}>
                  <h2 className="dsp" style={{fontSize:26}}>All Orders</h2>
                  <input className="fi" style={{maxWidth:260,margin:0}} placeholder="Search name, email, or event…" value={orderSearch} onChange={e=>setOrderSearch(e.target.value)} />
                </div>
                <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
                  {[['all','All'],['online','Online'],['door','Door']].map(([val,label])=>(
                    <button key={val} className={`chip ${orderSourceFilter===val?'on':''}`} onClick={()=>setOrderSourceFilter(val)}>{label}</button>
                  ))}
                  <span style={{fontSize:12,color:"var(--text3)",alignSelf:"center",marginLeft:4}}>{fo.length} order{fo.length!==1?'s':''}</span>
                  {fo.length>0&&<button className="btn" style={{fontSize:11,padding:"4px 10px",marginLeft:"auto"}} onClick={()=>exportOrdersCSV(fo,events,`orders-${new Date().toISOString().slice(0,10)}.csv`)}>Export CSV</button>}
                </div>
                {fo.length===0?<div className="empty"><div className="ic">📋</div><p>{q?"No matching orders.":"No orders."}</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th></th><th>Order</th><th>Date</th><th>Buyer</th><th>Email</th><th>Event</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>{fo.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).flatMap(o=>{const ev=events.find(e=>e.id===o.eventId);const cancelled=o.status==='cancelled';const isExp=expandedOrders.has(o.id);const tix=expandedTickets[o.id]||[];const toggleExp=async()=>{const next=new Set(expandedOrders);if(isExp){next.delete(o.id);setExpandedOrders(next);}else{next.add(o.id);setExpandedOrders(next);if(!expandedTickets[o.id]){const{data:t}=await supabase.from('tickets').select('*').eq('order_id',o.id).order('ticket_number');setExpandedTickets(prev=>({...prev,[o.id]:t||[]}));}}};return[<tr key={o.id} style={{opacity:cancelled?.5:1}}><td style={{width:28,paddingRight:0}}><button style={{background:'none',border:'none',cursor:'pointer',color:'var(--text3)',fontSize:11,padding:'2px 4px'}} onClick={toggleExp}>{isExp?'▲':'▼'}</button></td><td style={{fontFamily:"monospace",fontSize:11}}>{o.id.slice(0,12)}{o.stripePaymentIntentId&&<div style={{color:"var(--text3)",fontSize:10,marginTop:2}}>{o.stripePaymentIntentId.slice(0,22)}</div>}</td><td style={{fontSize:11}}>{new Date(o.date).toLocaleDateString()}<br/><span style={{color:"var(--text3)"}}>{new Date(o.date).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}</span></td><td>{o.buyer.name}</td><td style={{fontSize:11}}>{o.buyer.email}</td><td>{ev?.title||"—"}</td><td style={{fontSize:11}}>{o.items.map(i=>`${i.qty}× ${i.type}`).join(", ")}</td><td style={{fontWeight:700}}>{fmtCurrency(o.total)}</td><td><span className={`badge ${cancelled?'badge-cancelled':o.checkedIn?'badge-done':'badge-ok'}`}>{cancelled?'Cancelled':o.checkedIn?'Checked In':'Valid'}</span></td><td style={{display:"flex",gap:4,flexWrap:"wrap"}}><button className="btn" style={{fontSize:11,padding:"4px 8px"}} onClick={()=>{setEditEmailOrder(o);setEditEmailValue(o.buyer.email||'');}}>Edit Email</button>{!cancelled&&<><button className="btn" style={{fontSize:11,padding:"4px 8px"}} onClick={()=>resendEmail(o)}>Resend</button><button className="btn" style={{fontSize:11,padding:"4px 8px",color:"var(--red)"}} onClick={()=>setCancelTarget(o)}>Cancel</button></>}</td></tr>,isExp&&<tr key={o.id+'-tix'}><td colSpan={10} style={{padding:'0 14px 12px 42px',background:'var(--bg3)'}}>{tix.length===0?<p style={{fontSize:12,color:'var(--text3)',padding:'8px 0'}}>Loading tickets…</p>:<div style={{display:'flex',flexWrap:'wrap',gap:6,paddingTop:8}}>{tix.map(t=><div key={t.id} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 10px',background:'var(--bg2)',borderRadius:'var(--rs)',border:'1px solid var(--bg4)'}}><span style={{fontSize:12,color:'var(--text2)'}}>#{t.ticket_number} — {t.ticket_type_name}</span><span className={`badge ${t.status==='checked_in'?'badge-done':t.status==='cancelled'?'badge-cancelled':'badge-ok'}`} style={{fontSize:9}}>{t.status==='checked_in'?'Checked In':t.status==='cancelled'?'Voided':'Valid'}</span>{t.status==='valid'&&<button className="btn" style={{fontSize:10,padding:'2px 8px',color:'var(--red)'}} onClick={async()=>{if(!confirm(`Void ticket #${t.ticket_number}?`))return;await supabase.from('tickets').update({status:'cancelled'}).eq('id',t.id);setExpandedTickets(prev=>({...prev,[o.id]:prev[o.id].map(x=>x.id===t.id?{...x,status:'cancelled'}:x)}));}}>Void</button>}</div>)}</div>}</td></tr>].filter(Boolean);})}</tbody></table></div>}
              </>; })()}

            {aTab === "check-in" && (()=>{ const vo=orders.filter(o=>o.venueId===venue.id&&o.status!=='cancelled'); return <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,flexWrap:"wrap",gap:10}}>
                <h2 className="dsp" style={{fontSize:26}}>Check-In</h2>
                {!adminScan && <button className="btn gold" onClick={()=>{setAdminScan(true);setScanMsg(null);}}>📷 Scan Ticket</button>}
              </div>
              {adminScan && <div style={{marginBottom:16,maxWidth:400}}>
                <ScannerWidget scannerId="admin-scanner" onResult={handleAdminScan} />
                <button className="btn" style={{width:"100%",marginTop:8}} onClick={()=>setAdminScan(false)}>Cancel</button>
              </div>}
              {scanMsg && <div style={{marginBottom:16,padding:"10px 14px",borderRadius:"var(--rs)",background:scanMsg.ok?"rgba(93,138,60,.15)":"rgba(179,58,42,.15)",color:scanMsg.ok?"var(--green)":"var(--red)",fontSize:13,fontWeight:600}}>{scanMsg.text}</div>}
              <p style={{color:"var(--text2)",fontSize:13,marginBottom:20}}>Or manually mark attendees below. Tap an order to see individual tickets.</p>
              {vo.length===0?<div className="empty"><div className="ic">✅</div><p>No tickets.</p></div>:<div>{vo.map(o=>{
                const ev=events.find(e=>e.id===o.eventId);
                const isExpanded=expandedOrders.has(o.id);
                const toggleExpand=async()=>{
                  const next=new Set(expandedOrders);
                  if(isExpanded){next.delete(o.id);setExpandedOrders(next);}
                  else{
                    next.add(o.id);setExpandedOrders(next);
                    if(!expandedTickets[o.id]){
                      const{data:tix}=await supabase.from('tickets').select('*').eq('order_id',o.id).order('ticket_number');
                      setExpandedTickets(prev=>({...prev,[o.id]:tix||[]}));
                    }
                  }
                };
                const tix=expandedTickets[o.id]||[];
                const totalTix=o.items.reduce((s,i)=>s+i.qty,0);
                const checkedInCount=tix.filter(t=>t.status==='checked_in').length;
                return <div key={o.id} style={{border:"1px solid var(--bg4)",borderRadius:"var(--rs)",marginBottom:8,overflow:"hidden"}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",cursor:"pointer",background:"var(--bg2)"}} onClick={toggleExpand}>
                    <span style={{fontSize:13,flex:1}}>
                      <strong>{o.buyer.name}</strong>
                      <span style={{color:"var(--text3)",fontSize:11,marginLeft:8}}>{ev?.title||"—"}</span>
                    </span>
                    <span style={{fontSize:11,color:"var(--text2)"}}>{o.items.map(i=>`${i.qty}× ${i.type}`).join(", ")}</span>
                    {tix.length>0&&<span style={{fontSize:11,color:checkedInCount===totalTix?"var(--green)":"var(--text3)"}}>{checkedInCount}/{totalTix} in</span>}
                    {tix.length===0&&<span className={`badge ${o.checkedIn?"badge-done":"badge-ok"}`} style={{fontSize:10}}>{o.checkedIn?"Checked In":"Valid"}</span>}
                    <span style={{color:"var(--text3)",fontSize:12}}>{isExpanded?"▲":"▼"}</span>
                  </div>
                  {isExpanded&&<div style={{padding:"8px 14px 12px",borderTop:"1px solid var(--bg4)"}}>
                    {tix.length===0?<p style={{fontSize:12,color:"var(--text3)",margin:"8px 0"}}>Loading tickets…</p>
                    :tix.map(t=><div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid var(--bg4)"}}>
                      <span style={{fontSize:12,flex:1,color:"var(--text2)"}}>#{t.ticket_number} — {t.ticket_type_name}</span>
                      <span className={`badge ${t.status==='checked_in'?'badge-done':'badge-ok'}`} style={{fontSize:10}}>{t.status==='checked_in'?'In':'Valid'}</span>
                      <button className={`ci-btn ${t.status==='checked_in'?"dn":""}`} style={{fontSize:11,padding:"4px 10px"}} disabled={t.status==='checked_in'} onClick={async()=>{
                        await supabase.from('tickets').update({status:'checked_in',checked_in_at:new Date().toISOString()}).eq('id',t.id).eq('status','valid');
                        setExpandedTickets(prev=>({...prev,[o.id]:prev[o.id].map(x=>x.id===t.id?{...x,status:'checked_in'}:x)}));
                      }}>{t.status==='checked_in'?'Done':'Check In'}</button>
                    </div>)}
                  </div>}
                </div>;
              })}</div>}
            </>; })()}

            {aTab === "door" && <DoorSales events={vEvents} updateOrders={updateOrders} updateEvents={updateEvents} venue={venue} />}

            {aTab === "live" && <LiveDash events={vEvents} orders={orders} />}

            {aTab === "reports" && (() => {
              const now = new Date();
              const inRange = (o) => {
                const d = new Date(o.date);
                if (reportFilter==='month') return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
                if (reportFilter==='prev_month') { const p=new Date(now.getFullYear(),now.getMonth()-1,1); return d.getMonth()===p.getMonth()&&d.getFullYear()===p.getFullYear(); }
                if (reportFilter==='ytd') return d.getFullYear()===now.getFullYear();
                if (reportFilter==='last_year') return d.getFullYear()===now.getFullYear()-1;
                if (reportFilter==='custom') { const s=reportCustomStart?new Date(reportCustomStart+'T00:00:00'):null; const e=reportCustomEnd?new Date(reportCustomEnd+'T23:59:59'):null; if(s&&d<s)return false; if(e&&d>e)return false; return true; }
                return true;
              };
              const vo=orders.filter(o=>o.venueId===venue.id&&o.status!=='cancelled'&&inRange(o));
              const filterLabels={month:'This Month',prev_month:'Prev Month',ytd:'Year to Date',last_year:'Last Year',all:'All Time',custom:'Custom Range'};

              const typeMap={};
              for(const o of vo){for(const item of o.items){if(!typeMap[item.type])typeMap[item.type]={qty:0,rev:0};typeMap[item.type].qty+=item.qty;typeMap[item.type].rev+=item.qty*item.price;}}
              const totalTix=Object.values(typeMap).reduce((s,t)=>s+t.qty,0);
              const typeRows=Object.entries(typeMap).sort((a,b)=>b[1].qty-a[1].qty);

              const venueRev=vo.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0);
              const avgOrderTotal=vo.length>0?vo.reduce((s,o)=>s+o.total,0)/vo.length:0;
              const evAvgRows=vEvents.map(ev=>{const eo=vo.filter(o=>o.eventId===ev.id);if(!eo.length)return null;const capacity=ev.tickets.reduce((s,t)=>s+(t.total??t.available),0);const evTotalSold=ev.tickets.reduce((s,t)=>s+(t.sold??0),0);const sellThru=capacity>0?Math.round(evTotalSold/capacity*100):0;return{ev,count:eo.length,totalTix:eo.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0),totalRev:eo.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0),capacity,evTotalSold,sellThru};}).filter(Boolean);

              const isDoor = o => o.source==='door'||o.source==='door_cash';
              const doorOrders=vo.filter(isDoor);
              const onlineOrders=vo.filter(o=>!isDoor(o));
              const doorTix=doorOrders.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0);
              const onlineTix=onlineOrders.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0);
              const doorRev=doorOrders.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0);
              const onlineRev=onlineOrders.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0);

              const allVenueOrders=orders.filter(o=>o.venueId===venue.id&&o.status!=='cancelled');
              const buyerMap={};
              for(const o of allVenueOrders){const key=(o.buyer.email||'').toLowerCase().trim()||o.buyer.name;if(!buyerMap[key])buyerMap[key]={email:o.buyer.email,name:o.buyer.name,orders:0,total:0,tix:0};buyerMap[key].orders++;buyerMap[key].total+=o.total;buyerMap[key].tix+=o.items.reduce((s,i)=>s+i.qty,0);}
              const repeatBuyers=Object.values(buyerMap).filter(b=>b.orders>=2).sort((a,b)=>b.orders-a.orders);

              const ciTypeMap={};
              for(const o of vo){for(const item of o.items){if(!ciTypeMap[item.type])ciTypeMap[item.type]={sold:0,checkedIn:0};ciTypeMap[item.type].sold+=item.qty;if(o.checkedIn)ciTypeMap[item.type].checkedIn+=item.qty;}}
              const ciTypeRows=Object.entries(ciTypeMap).sort((a,b)=>b[1].sold-a[1].sold);

              // Bookkeeping calculations
              const allDateOrders = orders.filter(o => o.status !== 'cancelled' && inRange(o));
              const bkOrders = bkVenueFilter === 'all' ? allDateOrders : allDateOrders.filter(o => o.venueId === bkVenueFilter);
              const PLATFORM_PCT = platformFeePct / 100;
              const bkFees = (o) => {
                const ticketSub = o.items.reduce((s,i)=>s+i.qty*i.price,0);
                const qty = o.items.reduce((s,i)=>s+i.qty,0);
                const tax = Math.round(ticketSub*0.06*100)/100;
                const svc = qty*2;
                const isCash = o.source==='door_cash';
                const proc = isCash ? 0 : Math.max(0, Math.round((o.total-ticketSub-tax-svc)*100)/100);
                return {ticketSub, tax, svc, proc, isCash};
              };
              const bk = bkOrders.reduce((acc,o)=>{
                const f=bkFees(o);
                acc.ticketRev+=f.ticketSub; acc.tax+=f.tax; acc.svc+=f.svc; acc.proc+=f.proc;
                acc.grossCard+=f.isCash?0:o.total; acc.grossCash+=f.isCash?o.total:0;
                return acc;
              },{ticketRev:0,tax:0,svc:0,proc:0,grossCard:0,grossCash:0});
              const hbRate = holdbackPct/100;
              const platformFees = Math.round(bk.ticketRev*PLATFORM_PCT*100)/100;
              const venueGross = Math.round((bk.ticketRev-platformFees)*100)/100;
              const holdbackAmt = Math.round(venueGross*hbRate*100)/100;
              const venuePayNow = Math.round((venueGross-holdbackAmt)*100)/100;
              const netStripeDeposit = Math.round((bk.grossCard-bk.proc)*100)/100;
              const c8Rev = Math.round((bk.svc+platformFees)*100)/100;

              // Weekly venue payout grouping (Mon–Sun weeks)
              const weekStart = (d) => { const dt=new Date(d); const day=dt.getDay(); dt.setDate(dt.getDate()-((day+6)%7)); const y=dt.getFullYear(),mo=String(dt.getMonth()+1).padStart(2,'0'),dd=String(dt.getDate()).padStart(2,'0'); return `${y}-${mo}-${dd}`; };
              const weekMap={};
              for(const o of bkOrders){
                const k=weekStart(o.date);
                if(!weekMap[k])weekMap[k]={orders:0,tickets:0,ticketRev:0,svcFees:0};
                const f=bkFees(o);
                weekMap[k].orders++; weekMap[k].tickets+=o.items.reduce((s,i)=>s+i.qty,0); weekMap[k].ticketRev+=f.ticketSub; weekMap[k].svcFees+=f.svc;
              }
              const weekRows=Object.entries(weekMap).sort(([a],[b])=>a.localeCompare(b)).map(([wk,d])=>{
                const pf=Math.round(d.ticketRev*PLATFORM_PCT*100)/100;
                const vg=Math.round((d.ticketRev-pf)*100)/100;
                const hb=Math.round(vg*hbRate*100)/100;
                return{week:wk,...d,platformFee:pf,venueGross:vg,holdback:hb,payNow:Math.round((vg-hb)*100)/100,c8Total:Math.round((pf+d.svcFees)*100)/100};
              });

              const downloadBookkeepingCSV = () => {
                const fmt = (n) => Number(n).toFixed(2);
                const q = (s) => `"${String(s).replace(/"/g,'""')}"`;
                const rows = [];
                const bkVenueName = bkVenueFilter === 'all' ? 'All Venues' : (venues.find(v=>v.id===bkVenueFilter)?.name || bkVenueFilter);
                rows.push(['C8 Tickets Bookkeeping Export']);
                rows.push([`Organizer: ${bkVenueName}`]);
                rows.push([`Period: ${filterLabels[reportFilter]}`]);
                rows.push([`Generated: ${new Date().toLocaleDateString('en-US')}`]);
                rows.push([]);
                rows.push(['TRANSACTION DETAIL']);
                rows.push(['Date','Order ID','Event','Buyer Name','Channel','Qty Tickets','Ticket Subtotal','Sales Tax (6%)','Service Fees ($2/tkt)','Processing Fee','Grand Total','Net Bank Deposit']);
                for(const o of bkOrders){
                  const evTitle=events.find(e=>e.id===o.eventId)?.title||o.eventId;
                  const f=bkFees(o);
                  const ch=o.source==='door_cash'?'Door – Cash':o.source==='door'?'Door – Card':'Online';
                  rows.push([
                    new Date(o.date).toLocaleDateString('en-US'),
                    o.id.slice(0,8).toUpperCase(),
                    evTitle, o.buyer.name, ch,
                    o.items.reduce((s,i)=>s+i.qty,0),
                    fmt(f.ticketSub), fmt(f.tax), fmt(f.svc),
                    f.isCash?'0.00':fmt(f.proc),
                    fmt(o.total),
                    f.isCash?'Cash ('+fmt(o.total)+')':fmt(o.total-f.proc),
                  ]);
                }
                rows.push([]);
                rows.push(['FINANCIAL SUMMARY']);
                rows.push(['Item','Amount']);
                rows.push(['Gross Collected — Card (online + door)',fmt(bk.grossCard)]);
                rows.push(['Gross Collected — Cash (door)',fmt(bk.grossCash)]);
                rows.push(['Total Gross Collected',fmt(bk.grossCard+bk.grossCash)]);
                rows.push(['Less: Stripe Processing Fees','-'+fmt(bk.proc)]);
                rows.push(['Net Stripe Bank Deposit',fmt(netStripeDeposit)]);
                rows.push(['Cash Collected (door, not via Stripe)',fmt(bk.grossCash)]);
                rows.push(['Total Funds Received',fmt(netStripeDeposit+bk.grossCash)]);
                rows.push([]);
                rows.push(['ALLOCATIONS']);
                rows.push(['Idaho Sales Tax — Remit to State',fmt(bk.tax)]);
                rows.push([`Venue Payout (before ${holdbackPct}% holdback)`,fmt(venuePayNow)]);
                rows.push([`Holdback Retained (${holdbackPct}% of venue gross)`,fmt(holdbackAmt)]);
                rows.push(['C8Tickets Revenue — Service Fees ($2/ticket)',fmt(bk.svc)]);
                rows.push([`C8Tickets Revenue — Platform Fee (${platformFeePct}% of ticket rev)`,fmt(platformFees)]);
                rows.push(['Total C8Tickets Revenue',fmt(c8Rev)]);
                rows.push([]);
                rows.push(['WEEKLY VENUE PAYOUT']);
                rows.push(['Week','Orders','Tickets','Ticket Revenue','Service Fees ($2/tkt)',`Platform Fee (${platformFeePct}%)`,'Venue Gross',`Holdback (${holdbackPct}%)`,'Pay to Venue','Your Revenue (Svc + Platform)']);
                for(const r of weekRows){
                  const ws=new Date(r.week+'T12:00:00'); const we=new Date(ws); we.setDate(ws.getDate()+6);
                  rows.push([
                    `${ws.toLocaleDateString('en-US')} – ${we.toLocaleDateString('en-US')}`,
                    r.orders, r.tickets, fmt(r.ticketRev), fmt(r.svcFees), fmt(r.platformFee), fmt(r.venueGross), fmt(r.holdback), fmt(r.payNow), fmt(r.c8Total),
                  ]);
                }
                const csvTotals=[weekRows.reduce((s,r)=>s+r.orders,0),weekRows.reduce((s,r)=>s+r.tickets,0),fmt(weekRows.reduce((s,r)=>s+r.ticketRev,0)),fmt(weekRows.reduce((s,r)=>s+r.svcFees,0)),fmt(weekRows.reduce((s,r)=>s+r.platformFee,0)),fmt(weekRows.reduce((s,r)=>s+r.venueGross,0)),fmt(weekRows.reduce((s,r)=>s+r.holdback,0)),fmt(weekRows.reduce((s,r)=>s+r.payNow,0)),fmt(weekRows.reduce((s,r)=>s+r.c8Total,0))];
                rows.push(['TOTAL',...csvTotals]);
                const csv=rows.map(r=>r.map(c=>typeof c==='string'&&(c.includes(',')||c.includes('"'))?q(c):c).join(',')).join('\n');
                const blob=new Blob([csv],{type:'text/csv'});
                const url=URL.createObjectURL(blob);
                const a=document.createElement('a');
                const bkSlug = bkVenueFilter === 'all' ? 'all-venues' : bkVenueName.toLowerCase().replace(/[^\w]+/g,'-');
                a.href=url; a.download=`c8tickets-bookkeeping-${bkSlug}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
                URL.revokeObjectURL(url);
              };

              // ── Week-over-week trend ──
              const wowWeekStart = new Date(now);
              wowWeekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
              wowWeekStart.setHours(0,0,0,0);
              const wowLastStart = new Date(wowWeekStart); wowLastStart.setDate(wowWeekStart.getDate()-7);

              const allActive = orders.filter(o => o.venueId===venue.id && o.status!=='cancelled');
              const wowThis = allActive.filter(o => new Date(o.date) >= wowWeekStart);
              const wowLast = allActive.filter(o => { const d=new Date(o.date); return d>=wowLastStart && d<wowWeekStart; });

              const wowRev  = arr => arr.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0);
              const wowTix  = arr => arr.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0);
              const thisRev=wowRev(wowThis), lastRev=wowRev(wowLast);
              const thisOrd=wowThis.length,   lastOrd=wowLast.length;
              const thisTix=wowTix(wowThis),  lastTix=wowTix(wowLast);

              const wowPct = (curr,prev) => prev===0&&curr===0 ? null : prev===0 ? 100 : Math.round((curr-prev)/prev*100);
              const TrendBadge = ({curr,prev}) => {
                const p=wowPct(curr,prev);
                if(p===null) return <span style={{color:'var(--text3)',fontSize:11}}>No data</span>;
                const up=p>=0;
                return <span style={{color:up?'var(--green)':'var(--red)',fontWeight:700,fontSize:13,display:'inline-flex',alignItems:'center',gap:2}}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d={up?'M5 1 L9 8 L1 8 Z':'M5 9 L9 2 L1 2 Z'}/></svg>
                  {Math.abs(p)}%
                </span>;
              };

              const dayRevThis=Array(7).fill(0), dayRevLast=Array(7).fill(0);
              const dayTixThis=Array(7).fill(0), dayTixLast=Array(7).fill(0);
              for(const o of wowThis){const idx=(new Date(o.date).getDay()+6)%7; dayRevThis[idx]+=o.items.reduce((a,i)=>a+i.qty*i.price,0); dayTixThis[idx]+=o.items.reduce((a,i)=>a+i.qty,0);}
              for(const o of wowLast){const idx=(new Date(o.date).getDay()+6)%7; dayRevLast[idx]+=o.items.reduce((a,i)=>a+i.qty*i.price,0); dayTixLast[idx]+=o.items.reduce((a,i)=>a+i.qty,0);}
              const barMax=Math.max(...dayRevThis,...dayRevLast,1);
              const todayIdx=(now.getDay()+6)%7;
              const DAY_LABELS=['M','T','W','T','F','S','S'];

              return <>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
                  <h2 className="dsp" style={{fontSize:26}}>Reports</h2>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {Object.entries(filterLabels).map(([v,l])=><button key={v} className={`btn${reportFilter===v?' gold':''}`} style={{fontSize:11,padding:"5px 10px"}} onClick={()=>setReportFilter(v)}>{l}</button>)}
                  </div>
                </div>
                {reportFilter==='custom'&&<div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><label style={{fontSize:11,color:"var(--text3)",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>From</label><input className="fi" type="date" value={reportCustomStart} onChange={e=>setReportCustomStart(e.target.value)} style={{width:160,margin:0}} /></div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><label style={{fontSize:11,color:"var(--text3)",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>To</label><input className="fi" type="date" value={reportCustomEnd} onChange={e=>setReportCustomEnd(e.target.value)} style={{width:160,margin:0}} /></div>
                </div>}

                <h3 className="dsp" style={{fontSize:18,marginBottom:12}}>This Week vs Last Week</h3>
                <div className="tkt-sec" style={{marginBottom:32,padding:'20px 20px 16px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:20}}>
                    {[['Revenue','$'+thisRev.toFixed(2),'$'+lastRev.toFixed(2),thisRev,lastRev],['Orders',thisOrd,lastOrd,thisOrd,lastOrd],['Tickets',thisTix,lastTix,thisTix,lastTix]].map(([label,curr,prev,c,p])=>(
                      <div key={label} style={{background:'var(--bg3)',borderRadius:'var(--rs)',padding:'12px 14px'}}>
                        <div style={{fontSize:11,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>{label}</div>
                        <div style={{fontSize:20,fontWeight:700,color:'var(--text)',marginBottom:2}}>{curr}</div>
                        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                          <TrendBadge curr={c} prev={p}/>
                          <span style={{fontSize:11,color:'var(--text3)'}}>vs {prev}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{display:'flex',gap:3,alignItems:'flex-end',height:64}}>
                      {DAY_LABELS.map((d,i)=>{
                        const hThis=barMax>0?Math.round((dayRevThis[i]/barMax)*60):0;
                        const hLast=barMax>0?Math.round((dayRevLast[i]/barMax)*60):0;
                        const isFuture=i>todayIdx;
                        return(
                          <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                            <div style={{width:'100%',display:'flex',gap:1,alignItems:'flex-end',height:60}}>
                              <div title={`Last week: $${dayRevLast[i].toFixed(2)}`} style={{flex:1,height:hLast||1,background:'rgba(200,146,42,0.25)',borderRadius:'2px 2px 0 0',transition:'height .3s'}}/>
                              <div title={`This week: $${dayRevThis[i].toFixed(2)}`} style={{flex:1,height:hThis||1,background:isFuture?'rgba(200,146,42,0.15)':'var(--gold)',borderRadius:'2px 2px 0 0',transition:'height .3s'}}/>
                            </div>
                            <div style={{fontSize:10,color:i===todayIdx?'var(--gold)':'var(--text3)',fontWeight:i===todayIdx?700:400}}>{d}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{display:'flex',gap:14,marginTop:8,justifyContent:'flex-end'}}>
                      <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--text3)'}}><div style={{width:10,height:10,background:'rgba(200,146,42,0.25)',borderRadius:2}}/> Last week</div>
                      <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--text3)'}}><div style={{width:10,height:10,background:'var(--gold)',borderRadius:2}}/> This week</div>
                    </div>
                  </div>
                </div>

                <h3 className="dsp" style={{fontSize:18,marginBottom:12}}>Performance Snapshot</h3>
                <div className="sg" style={{marginBottom:32}}>
                  <div className="sc"><div className="l">Total Venue Revenue</div><div className="v gd">{venueRev===0?"$0":"$"+venueRev.toFixed(2)}</div><div className="s">Period total</div></div>
                  <div className="sc"><div className="l">Total Tickets Sold</div><div className="v">{totalTix}</div><div className="s">Period total</div></div>
                  <div className="sc"><div className="l">Total Orders</div><div className="v">{vo.length}</div></div>
                  <div className="sc"><div className="l">Avg Order Value</div><div className="v gd">{vo.length>0?"$"+avgOrderTotal.toFixed(2):"—"}</div></div>
                </div>

                <h3 className="dsp" style={{fontSize:18,marginBottom:12}}>Ticket Type Breakdown</h3>
                {typeRows.length===0
                  ?<div className="empty" style={{marginBottom:28}}><p>No ticket sales in this period.</p></div>
                  :<div style={{overflowX:"auto",marginBottom:32}}><table className="dt"><thead><tr><th>Ticket Type</th><th>Qty Sold</th><th>% of Sales</th><th>Revenue</th></tr></thead><tbody>{typeRows.map(([type,d])=>{const pct=totalTix>0?Math.round(d.qty/totalTix*100):0;return<tr key={type}><td style={{fontWeight:600}}>{type}</td><td>{d.qty}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:80}}><div style={{height:"100%",width:pct+"%",background:"var(--gold)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right"}}>{pct}%</span></div></td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(d.rev)}</td></tr>;})}</tbody></table></div>
                }

                <h3 className="dsp" style={{fontSize:18,marginBottom:4}}>Event Performance</h3>
                <p style={{color:"var(--text3)",fontSize:12,marginBottom:12}}>Orders, tickets, and revenue are for the selected period. Capacity and sell-through reflect all-time totals for each event.</p>
                {evAvgRows.length===0
                  ?<div className="empty" style={{marginBottom:28}}><p>No event data for this period.</p></div>
                  :<div style={{overflowX:"auto",marginBottom:32}}><table className="dt"><thead><tr><th>Event</th><th>Orders</th><th>Total Tickets Sold</th><th>Total Venue Revenue</th><th>Capacity</th><th>Sell-Through</th></tr></thead><tbody>{evAvgRows.map(({ev,count,totalTix,totalRev,capacity,evTotalSold,sellThru})=><tr key={ev.id}><td style={{fontWeight:600}}>{ev.title}</td><td>{count}</td><td>{totalTix}</td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(totalRev)}</td><td style={{color:"var(--text2)"}}>{capacity||"—"}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:60}}><div style={{height:"100%",width:sellThru+"%",background:sellThru>=80?"var(--green)":sellThru>=50?"var(--gold)":"var(--red)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right",color:sellThru>=80?"var(--green)":sellThru>=50?"var(--gold)":"var(--red)",fontWeight:700}}>{capacity?sellThru+"%":"—"}</span></div></td></tr>)}</tbody></table></div>
                }

                <h3 className="dsp" style={{fontSize:18,marginBottom:12}}>Sales Channel</h3>
                <div style={{overflowX:"auto",marginBottom:32}}><table className="dt"><thead><tr><th>Channel</th><th>Orders</th><th>Tickets</th><th>Revenue</th><th>% of Revenue</th></tr></thead><tbody>
                  <tr><td style={{fontWeight:600}}>Online</td><td>{onlineOrders.length}</td><td>{onlineTix}</td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(onlineRev)}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:80}}><div style={{height:"100%",width:(venueRev>0?Math.round(onlineRev/venueRev*100):0)+"%",background:"var(--gold)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right"}}>{venueRev>0?Math.round(onlineRev/venueRev*100):0}%</span></div></td></tr>
                  <tr><td style={{fontWeight:600}}>Door — Card</td><td>{doorOrders.filter(o=>o.source==='door').length}</td><td>{doorOrders.filter(o=>o.source==='door').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0)}</td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(doorOrders.filter(o=>o.source==='door').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0))}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:80}}><div style={{height:"100%",width:(venueRev>0?Math.round(doorOrders.filter(o=>o.source==='door').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0)/venueRev*100):0)+"%",background:"var(--gold)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right"}}>{venueRev>0?Math.round(doorOrders.filter(o=>o.source==='door').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0)/venueRev*100):0}%</span></div></td></tr>
                  <tr><td style={{fontWeight:600}}>Door — Cash</td><td>{doorOrders.filter(o=>o.source==='door_cash').length}</td><td>{doorOrders.filter(o=>o.source==='door_cash').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0)}</td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(doorOrders.filter(o=>o.source==='door_cash').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0))}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:80}}><div style={{height:"100%",width:(venueRev>0?Math.round(doorOrders.filter(o=>o.source==='door_cash').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0)/venueRev*100):0)+"%",background:"var(--gold)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right"}}>{venueRev>0?Math.round(doorOrders.filter(o=>o.source==='door_cash').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0)/venueRev*100):0}%</span></div></td></tr>
                </tbody></table></div>

                <h3 className="dsp" style={{fontSize:18,marginBottom:12}}>Check-In Rate by Ticket Type</h3>
                {ciTypeRows.length===0
                  ?<div className="empty" style={{marginBottom:28}}><p>No data for this period.</p></div>
                  :<div style={{overflowX:"auto",marginBottom:32}}><table className="dt"><thead><tr><th>Ticket Type</th><th>Sold</th><th>Checked In</th><th>Rate</th></tr></thead><tbody>{ciTypeRows.map(([type,d])=>{const pct=d.sold>0?Math.round(d.checkedIn/d.sold*100):0;return<tr key={type}><td style={{fontWeight:600}}>{type}</td><td>{d.sold}</td><td>{d.checkedIn}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:80}}><div style={{height:"100%",width:pct+"%",background:"var(--green)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right"}}>{pct}%</span></div></td></tr>;})}</tbody></table></div>
                }

                <h3 className="dsp" style={{fontSize:18,marginBottom:6}}>Repeat Buyers</h3>
                <p style={{color:"var(--text3)",fontSize:12,marginBottom:12}}>Buyers with 2 or more orders all-time.</p>
                {repeatBuyers.length===0
                  ?<div className="empty" style={{marginBottom:28}}><p>No repeat buyers yet.</p></div>
                  :<div style={{overflowX:"auto",marginBottom:28}}><table className="dt"><thead><tr><th>Buyer</th><th>Email</th><th>Orders</th><th>Tickets</th><th>Total Spent</th></tr></thead><tbody>{repeatBuyers.map((b,i)=><tr key={i}><td style={{fontWeight:600}}>{b.name}</td><td style={{fontSize:12}}>{b.email}</td><td style={{color:"var(--gold)",fontWeight:700}}>{b.orders}</td><td>{b.tix}</td><td style={{fontWeight:700}}>{fmtCurrency(b.total)}</td></tr>)}</tbody></table></div>
                }

                {!isVenueUser && <div style={{borderTop:'1px solid var(--border)',paddingTop:28,marginTop:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6,flexWrap:'wrap',gap:10}}>
                    <h3 className="dsp" style={{fontSize:18}}>Bookkeeping & Payouts</h3>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <label style={{fontSize:11,color:'var(--text3)',fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>Organizer</label>
                      <select className="fi" style={{margin:0,width:'auto',minWidth:160}} value={bkVenueFilter} onChange={e=>setBkVenueFilter(e.target.value)}>
                        <option value="all">All Venues</option>
                        {venues.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <p style={{color:'var(--text3)',fontSize:12,marginBottom:16}}>Fee structure: 6% Idaho sales tax · $2.00/ticket service fee · {platformFeePct}% platform fee · 3.5% + $0.30 processing fee charged to customers (Stripe's actual cost: 2.9% + $0.30 — the 0.6% spread is additional C8Tickets revenue). Cash sales carry no processing fee. All figures are for the selected period.</p>
                  <div style={{display:'flex',alignItems:'center',gap:20,marginBottom:20,flexWrap:'wrap'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <label style={{fontSize:12,color:'var(--text3)',fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>Platform Fee %</label>
                      <input className="fi" type="number" min="0" max="100" step="0.5" value={platformFeePct} onChange={e=>setPlatformFeePct(Math.max(0,Math.min(100,Number(e.target.value))))} style={{width:70,margin:0}} />
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <label style={{fontSize:12,color:'var(--text3)',fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>Holdback %</label>
                      <input className="fi" type="number" min="0" max="100" step="1" value={holdbackPct} onChange={e=>setHoldbackPct(Math.max(0,Math.min(100,Number(e.target.value))))} style={{width:70,margin:0}} />
                    </div>
                    <span style={{fontSize:12,color:'var(--text3)'}}>Set Platform Fee to 0% for venues not yet on the platform fee. Holdback is a reserve withheld from each payout.</span>
                  </div>
                  {vo.length===0
                    ?<div className="empty" style={{marginBottom:28}}><p>No orders in this period.</p></div>
                    :<>
                      <div style={{overflowX:'auto',marginBottom:28}}>
                        <table className="dt">
                          <thead><tr><th style={{width:'62%'}}>Item</th><th style={{textAlign:'right'}}>Amount</th></tr></thead>
                          <tbody>
                            <tr><td style={{fontWeight:700,paddingTop:10}}>Gross Collected</td><td style={{textAlign:'right',fontWeight:700,color:'var(--gold)'}}>{fmtCurrency(bk.grossCard+bk.grossCash)}</td></tr>
                            <tr><td style={{paddingLeft:20,color:'var(--text3)',fontSize:13}}>Card payments (online + door)</td><td style={{textAlign:'right',fontSize:13}}>{fmtCurrency(bk.grossCard)}</td></tr>
                            <tr><td style={{paddingLeft:20,color:'var(--text3)',fontSize:13}}>Cash collected at door</td><td style={{textAlign:'right',fontSize:13}}>{fmtCurrency(bk.grossCash)}</td></tr>
                            <tr><td style={{paddingLeft:20,color:'var(--red)',fontSize:13}}>Less: Stripe processing fees</td><td style={{textAlign:'right',color:'var(--red)',fontSize:13}}>−{fmtCurrency(bk.proc)}</td></tr>
                            <tr style={{borderTop:'1px solid var(--border)'}}><td style={{fontWeight:700}}>Net Deposited to Bank</td><td style={{textAlign:'right',fontWeight:700}}>{fmtCurrency(netStripeDeposit+bk.grossCash)}</td></tr>

                            <tr><td colSpan={2} style={{paddingTop:16,paddingBottom:2,fontSize:11,color:'var(--text3)',fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>Allocations from Your Account</td></tr>
                            <tr><td style={{paddingLeft:20,color:'var(--text3)',fontSize:13}}>Idaho sales tax — remit to state (6%)</td><td style={{textAlign:'right',color:'var(--text3)',fontSize:13}}>−{fmtCurrency(bk.tax)}</td></tr>
                            <tr><td style={{paddingLeft:20,color:'var(--text3)',fontSize:13}}>Venue payout (after {platformFeePct}% platform fee)</td><td style={{textAlign:'right',color:'var(--text3)',fontSize:13}}>−{fmtCurrency(venuePayNow)}</td></tr>
                            <tr><td style={{paddingLeft:20,color:'var(--text3)',fontSize:13}}>Holdback retained ({holdbackPct}% of venue gross)</td><td style={{textAlign:'right',color:'var(--text3)',fontSize:13}}>+{fmtCurrency(holdbackAmt)}</td></tr>

                            <tr style={{borderTop:'1px solid var(--border)'}}><td style={{fontWeight:700}}>C8Tickets Revenue</td><td style={{textAlign:'right',fontWeight:700,color:'var(--green)'}}>{fmtCurrency(c8Rev)}</td></tr>
                            <tr><td style={{paddingLeft:20,color:'var(--text3)',fontSize:13}}>Service fees ($2/ticket × {bkOrders.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0)})</td><td style={{textAlign:'right',fontSize:13}}>{fmtCurrency(bk.svc)}</td></tr>
                            <tr><td style={{paddingLeft:20,color:'var(--text3)',fontSize:13}}>Platform fee ({platformFeePct}% of ${bk.ticketRev.toFixed(2)} ticket rev)</td><td style={{textAlign:'right',fontSize:13}}>{fmtCurrency(platformFees)}</td></tr>
                          </tbody>
                        </table>
                      </div>

                      {weekRows.length>0&&(()=>{
                        const fmtWeekRange = (wk) => {
                          const s=new Date(wk+'T12:00:00');
                          const e=new Date(s); e.setDate(s.getDate()+6);
                          const so=s.toLocaleDateString('en-US',{month:'short',day:'numeric'});
                          const eo=e.toLocaleDateString('en-US',{month:'short',day:'numeric'});
                          return `${so} – ${eo}`;
                        };
                        const totOrders=weekRows.reduce((s,r)=>s+r.orders,0);
                        const totTickets=weekRows.reduce((s,r)=>s+r.tickets,0);
                        const totTicketRev=weekRows.reduce((s,r)=>s+r.ticketRev,0);
                        const totSvcFees=weekRows.reduce((s,r)=>s+r.svcFees,0);
                        const totPlatformFee=weekRows.reduce((s,r)=>s+r.platformFee,0);
                        const totVenueGross=weekRows.reduce((s,r)=>s+r.venueGross,0);
                        const totHoldback=weekRows.reduce((s,r)=>s+r.holdback,0);
                        const totPayNow=weekRows.reduce((s,r)=>s+r.payNow,0);
                        const totC8=weekRows.reduce((s,r)=>s+r.c8Total,0);
                        return <>
                          <h4 className="dsp" style={{fontSize:15,marginBottom:10}}>Weekly Venue Payout Schedule</h4>
                          <div style={{overflowX:'auto',marginBottom:20}}>
                            <table className="dt">
                              <thead><tr><th>Week</th><th>Orders</th><th>Tickets</th><th>Ticket Rev</th><th>Service Fees</th><th>Platform Fee</th><th>Venue Gross</th><th>Holdback</th><th style={{color:'var(--gold)'}}>Pay Venue</th><th style={{color:'var(--green)'}}>Your Revenue</th></tr></thead>
                              <tbody>
                                {weekRows.map(r=>(
                                  <tr key={r.week}>
                                    <td style={{fontWeight:600,whiteSpace:'nowrap'}}>{fmtWeekRange(r.week)}</td>
                                    <td>{r.orders}</td><td>{r.tickets}</td>
                                    <td>{fmtCurrency(r.ticketRev)}</td>
                                    <td style={{color:'var(--green)',fontWeight:600}}>{fmtCurrency(r.svcFees)}</td>
                                    <td style={{color:'var(--green)',fontWeight:600}}>{fmtCurrency(r.platformFee)}</td>
                                    <td>{fmtCurrency(r.venueGross)}</td>
                                    <td style={{color:'var(--text3)'}}>−{fmtCurrency(r.holdback)}</td>
                                    <td style={{fontWeight:700,color:'var(--gold)'}}>{fmtCurrency(r.payNow)}</td>
                                    <td style={{fontWeight:700,color:'var(--green)'}}>{fmtCurrency(r.c8Total)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr style={{borderTop:'2px solid var(--border)'}}>
                                  <td style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:.5,color:'var(--text2)'}}>Total</td>
                                  <td style={{fontWeight:700}}>{totOrders}</td>
                                  <td style={{fontWeight:700}}>{totTickets}</td>
                                  <td style={{fontWeight:700}}>{fmtCurrency(totTicketRev)}</td>
                                  <td style={{fontWeight:700,color:'var(--green)'}}>{fmtCurrency(totSvcFees)}</td>
                                  <td style={{fontWeight:700,color:'var(--green)'}}>{fmtCurrency(totPlatformFee)}</td>
                                  <td style={{fontWeight:700}}>{fmtCurrency(totVenueGross)}</td>
                                  <td style={{fontWeight:700,color:'var(--text3)'}}>−{fmtCurrency(totHoldback)}</td>
                                  <td style={{fontWeight:700,color:'var(--gold)',fontSize:15}}>{fmtCurrency(totPayNow)}</td>
                                  <td style={{fontWeight:700,color:'var(--green)',fontSize:15}}>{fmtCurrency(totC8)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </>;
                      })()}

                      <button className="btn gold" onClick={downloadBookkeepingCSV}>Download CSV for QuickBooks</button>
                      <p style={{fontSize:11,color:'var(--text3)',marginTop:6}}>Exports transaction detail, financial summary, and weekly payout schedule for the selected period.</p>
                    </>
                  }
                </div>}
              </>;
            })()}

            {aTab === "promos" && <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:10}}>
                <h2 className="dsp" style={{fontSize:26}}>Promo Codes</h2>
              </div>

              <div className="tkt-sec" style={{marginBottom:28}}>
                <h3 className="dsp" style={{fontSize:16,marginBottom:14}}>Create New Code</h3>
                <div className="fr">
                  <div className="fg"><label className="fl">Code</label><input className="fi" style={{textTransform:'uppercase',letterSpacing:1}} value={promoForm.code} onChange={e=>setPromoForm({...promoForm,code:e.target.value.toUpperCase().replace(/\s/g,'')})} placeholder="SUMMER20" /></div>
                  <div className="fg"><label className="fl">Type</label><select className="fi" value={promoForm.discountType} onChange={e=>setPromoForm({...promoForm,discountType:e.target.value})}><option value="percent">% Off</option><option value="flat">$ Off</option></select></div>
                  <div className="fg"><label className="fl">{promoForm.discountType==='percent'?'Percent':'Amount ($)'}</label><input className="fi" type="number" min="0" step={promoForm.discountType==='percent'?'1':'0.01'} value={promoForm.discountValue} onChange={e=>setPromoForm({...promoForm,discountValue:e.target.value})} placeholder={promoForm.discountType==='percent'?'20':'5.00'} /></div>
                </div>
                <div className="fr">
                  <div className="fg"><label className="fl">Max Uses <span style={{fontWeight:400,color:'var(--text3)'}}>(blank = unlimited)</span></label><input className="fi" type="number" min="1" value={promoForm.maxUses} onChange={e=>setPromoForm({...promoForm,maxUses:e.target.value})} placeholder="Unlimited" /></div>
                  <div className="fg"><label className="fl">Expires <span style={{fontWeight:400,color:'var(--text3)'}}>(blank = no expiry)</span></label><input className="fi" type="date" value={promoForm.expiresAt} onChange={e=>setPromoForm({...promoForm,expiresAt:e.target.value})} /></div>
                  <div className="fg"><label className="fl">Event <span style={{fontWeight:400,color:'var(--text3)'}}>(blank = all events)</span></label><select className="fi" value={promoForm.eventId} onChange={e=>setPromoForm({...promoForm,eventId:e.target.value})}><option value="">All Events</option>{vEvents.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</select></div>
                </div>
                <button className="buy" style={{marginTop:8}} disabled={promoSaving||!promoForm.code||!promoForm.discountValue} onClick={savePromo}>{promoSaving?'Saving…':'Create Promo Code'}</button>
              </div>

              <h3 className="dsp" style={{fontSize:16,marginBottom:14}}>Existing Codes</h3>
              {!promosLoaded
                ? <p style={{color:'var(--text3)',fontSize:13}}>Loading…</p>
                : promos.length === 0
                  ? <div className="empty"><p>No promo codes yet.</p></div>
                  : <div style={{overflowX:'auto'}}><table className="dt"><thead><tr><th></th><th>Code</th><th>Discount</th><th>Uses</th><th>Event</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
                      {promos.flatMap(p => {
                        const ev = p.event_id ? vEvents.find(e=>e.id===p.event_id) : null;
                        const expired = p.expires_at && new Date(p.expires_at) < new Date();
                        const maxed = p.max_uses !== null && p.uses_count >= p.max_uses;
                        const isExp = expandedPromos.has(p.id);
                        const usage = promoUsage[p.id];
                        const togglePromoExp = () => {
                          const next = new Set(expandedPromos);
                          if (isExp) { next.delete(p.id); setExpandedPromos(next); }
                          else { next.add(p.id); setExpandedPromos(next); loadPromoUsage(p.id); }
                        };
                        return [
                          <tr key={p.id}>
                            <td style={{width:28,paddingRight:0}}><button style={{background:'none',border:'none',cursor:'pointer',color:'var(--text3)',fontSize:11,padding:'2px 4px'}} onClick={togglePromoExp}>{isExp?'▲':'▼'}</button></td>
                            <td style={{fontFamily:'monospace',fontWeight:700,letterSpacing:1}}>{p.code}</td>
                            <td>{p.discount_type==='percent'?`${p.discount_value}% off`:`$${Number(p.discount_value).toFixed(2)} off`}</td>
                            <td>{p.uses_count}{p.max_uses!==null?` / ${p.max_uses}`:''}</td>
                            <td style={{fontSize:12}}>{ev?ev.title:'All Events'}</td>
                            <td style={{fontSize:12}}>{p.expires_at?new Date(p.expires_at).toLocaleDateString():'-'}</td>
                            <td><span className={`badge ${p.active&&!expired&&!maxed?'badge-ok':'badge-cancelled'}`}>{expired?'Expired':maxed?'Maxed':p.active?'Active':'Inactive'}</span></td>
                            <td style={{display:'flex',gap:4}}>
                              <button className="btn" style={{fontSize:11,padding:'4px 8px'}} onClick={()=>togglePromo(p.id,!p.active)}>{p.active?'Disable':'Enable'}</button>
                              <button className="btn" style={{fontSize:11,padding:'4px 8px',color:'var(--red)'}} onClick={()=>deletePromo(p.id)}>Delete</button>
                            </td>
                          </tr>,
                          isExp && <tr key={p.id+'-usage'}><td colSpan={8} style={{padding:'0 14px 12px 42px',background:'var(--bg3)'}}>
                            {!usage ? <p style={{fontSize:12,color:'var(--text3)',padding:'8px 0'}}>Loading…</p>
                              : usage.length === 0 ? <p style={{fontSize:12,color:'var(--text3)',padding:'8px 0'}}>No orders have used this code yet.</p>
                              : <table className="dt" style={{marginTop:6}}><thead><tr><th>Order ID</th><th>Buyer</th><th>Email</th><th>Date</th><th>Total</th><th>Status</th></tr></thead><tbody>
                                {usage.map(u => <tr key={u.id}>
                                  <td style={{fontFamily:'monospace',fontSize:11}}>{u.id.slice(0,12)}</td>
                                  <td style={{fontSize:12}}>{u.buyer_name}</td>
                                  <td style={{fontSize:11}}>{u.buyer_email}</td>
                                  <td style={{fontSize:11}}>{new Date(u.created_at).toLocaleDateString()}</td>
                                  <td style={{fontSize:12,fontWeight:700}}>{fmtCurrency(u.total_amount)}</td>
                                  <td><span className={`badge ${u.status==='cancelled'?'badge-cancelled':'badge-ok'}`} style={{fontSize:9}}>{u.status}</span></td>
                                </tr>)}
                              </tbody></table>
                            }
                          </td></tr>
                        ].filter(Boolean);
                      })}
                    </tbody></table></div>
              }
            </div>}

            {aTab === 'accounts' && !isVenueUser && <div>

              {/* ── Venues ── */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
                <h2 className="dsp" style={{fontSize:26}}>Venues</h2>
                <button className="btn gold" style={{fontSize:12,padding:'6px 16px'}} onClick={()=>{ setEditingVenueId(null); setVenueForm({name:'',address:'',contactPhone:'',contactEmail:'',website:'',ownerName:'',ownerPhone:'',notes:''}); setVenueError(''); setVenueSuccess(''); setVenueFormOpen(v=>!v); }}>
                  {venueFormOpen && !editingVenueId ? 'Cancel' : '+ Add Venue'}
                </button>
              </div>

              {venueFormOpen && <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r)',padding:24,marginBottom:24,maxWidth:560}}>
                <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1.5,marginBottom:16}}>{editingVenueId ? 'Edit Venue' : 'New Venue'}</div>
                <div className="fr">
                  <div className="fg"><label className="fl">Venue Name *</label><input className="fi" value={venueForm.name} onChange={e=>setVenueForm(p=>({...p,name:e.target.value}))} placeholder="e.g. The Rusty Nail" /></div>
                  <div className="fg"><label className="fl">Address</label><input className="fi" value={venueForm.address} onChange={e=>setVenueForm(p=>({...p,address:e.target.value}))} placeholder="123 Main St, City, ID" /></div>
                </div>
                <div className="fr">
                  <div className="fg"><label className="fl">Venue Phone</label><input className="fi" type="tel" value={venueForm.contactPhone} onChange={e=>setVenueForm(p=>({...p,contactPhone:e.target.value}))} placeholder="(208) 555-0100" /></div>
                  <div className="fg"><label className="fl">Venue Email</label><input className="fi" type="email" value={venueForm.contactEmail} onChange={e=>setVenueForm(p=>({...p,contactEmail:e.target.value}))} placeholder="info@venue.com" /></div>
                </div>
                <div className="fg"><label className="fl">Website</label><input className="fi" type="url" value={venueForm.website} onChange={e=>setVenueForm(p=>({...p,website:e.target.value}))} placeholder="https://venue.com" /></div>
                <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1.5,margin:'16px 0 10px'}}>Owner / Contact</div>
                <div className="fr">
                  <div className="fg"><label className="fl">Owner Name</label><input className="fi" value={venueForm.ownerName} onChange={e=>setVenueForm(p=>({...p,ownerName:e.target.value}))} placeholder="Full name" /></div>
                  <div className="fg"><label className="fl">Owner Phone</label><input className="fi" type="tel" value={venueForm.ownerPhone} onChange={e=>setVenueForm(p=>({...p,ownerPhone:e.target.value}))} placeholder="(208) 555-0101" /></div>
                </div>
                <div className="fg"><label className="fl">Notes</label><input className="fi" value={venueForm.notes} onChange={e=>setVenueForm(p=>({...p,notes:e.target.value}))} placeholder="Internal notes (not visible to venue)" /></div>
                {venueError && <p style={{fontSize:12,color:'var(--red)',marginBottom:10}}>{venueError}</p>}
                {venueSuccess && <p style={{fontSize:12,color:'var(--green)',marginBottom:10}}>{venueSuccess}</p>}
                <div style={{display:'flex',gap:10,marginTop:4}}>
                  <button className="btn gold" disabled={!venueForm.name.trim()||venueSaving} onClick={saveVenue}>{venueSaving?'Saving…':editingVenueId?'Save Changes':'Create Venue'}</button>
                  {editingVenueId && <button className="btn" onClick={()=>{ setVenueFormOpen(false); setEditingVenueId(null); }}>Cancel</button>}
                </div>
              </div>}

              <div style={{overflowX:'auto',marginBottom:40}}>
                <table className="dt"><thead><tr><th>Name</th><th>Location</th><th>Owner</th><th>Contact</th><th>Status</th><th></th></tr></thead>
                  <tbody>{venues.map(v=>(
                    <tr key={v.id} style={{opacity: v.active===false ? 0.5 : 1}}>
                      <td style={{fontWeight:600}}>{v.name}</td>
                      <td style={{fontSize:12}}>{v.location||'—'}</td>
                      <td style={{fontSize:12}}>{v.ownerName||'—'}</td>
                      <td style={{fontSize:11}}>{v.phone||v.email||'—'}</td>
                      <td><span className={`badge ${v.active===false?'badge-cancelled':'badge-ok'}`} style={{fontSize:9}}>{v.active===false?'Inactive':'Active'}</span></td>
                      <td style={{display:'flex',gap:6}}>
                        <button className="btn" style={{fontSize:11,padding:'4px 10px'}} onClick={()=>startEditVenue(v)}>Edit</button>
                        <button className="btn" style={{fontSize:11,padding:'4px 10px',color:v.active===false?'var(--gold)':'var(--red)'}} onClick={()=>toggleVenue(v.id, v.active===false)}>{v.active===false?'Activate':'Deactivate'}</button>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>

              {/* ── Venue Accounts ── */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,flexWrap:'wrap',gap:10}}>
                <h2 className="dsp" style={{fontSize:22}}>Venue Accounts</h2>
              </div>
              <p style={{color:'var(--text2)',fontSize:13,marginBottom:20,maxWidth:560}}>Create login credentials for venue operators. Venue accounts can view their own events, orders, and check-in data but cannot see C8Tickets service revenue or manage other venues.</p>
              <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r)',padding:24,marginBottom:32,maxWidth:480}}>
                <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1.5,marginBottom:16}}>Create Venue Account</div>
                <div className="fg"><label className="fl" htmlFor="vu-email">Email Address</label><input id="vu-email" className="fi" type="email" value={venueUserForm.email} onChange={e=>setVenueUserForm(p=>({...p,email:e.target.value}))} placeholder="owner@venuename.com" /></div>
                <div className="fg"><label className="fl" htmlFor="vu-password">Password</label><input id="vu-password" className="fi" type="password" value={venueUserForm.password} onChange={e=>setVenueUserForm(p=>({...p,password:e.target.value}))} placeholder="Minimum 6 characters" /></div>
                <div className="fg">
                  <label className="fl" htmlFor="vu-venue">Venue</label>
                  <select id="vu-venue" className="fi" value={venueUserForm.tenantId} onChange={e=>setVenueUserForm(p=>({...p,tenantId:e.target.value}))}>
                    <option value="">Select a venue…</option>
                    {venues.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label className="fl" htmlFor="vu-role">Role</label>
                  <select id="vu-role" className="fi" value={venueUserForm.role} onChange={e=>setVenueUserForm(p=>({...p,role:e.target.value}))}>
                    <option value="venue">Venue Admin — full access for their venue</option>
                    <option value="gate">Gate / Door — check-in scanner only</option>
                  </select>
                </div>
                {venueUserError && <p style={{fontSize:12,color:'var(--red)',marginBottom:12}}>{venueUserError}</p>}
                {venueUserSuccess && <p style={{fontSize:12,color:'var(--green)',marginBottom:12}}>{venueUserSuccess}</p>}
                <button className="btn gold" disabled={!venueUserForm.email||!venueUserForm.password||!venueUserForm.tenantId||venueUserSaving} onClick={createVenueUser}>{venueUserSaving?'Creating…':'Create Account'}</button>
              </div>
              <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1.5,marginBottom:12}}>Existing Venue Accounts</div>
              {!venueUsersLoaded
                ? <button className="btn" onClick={loadVenueUsers}>Load Accounts</button>
                : venueUsers.length === 0
                  ? <p style={{color:'var(--text2)',fontSize:13}}>No venue accounts yet.</p>
                  : <div style={{overflowX:'auto'}}>
                      <table className="dt"><thead><tr><th>Email</th><th>Venue</th><th>Role</th><th>Created</th><th></th></tr></thead>
                        <tbody>{venueUsers.map(u=>(
                          <tr key={u.id}>
                            <td>{u.email}</td>
                            <td style={{fontSize:12}}>{u.user_metadata?.tenant_name || '—'}</td>
                            <td><span className="badge badge-ok" style={{fontSize:9,textTransform:'uppercase'}}>{u.user_metadata?.role || '—'}</span></td>
                            <td style={{fontSize:11}}>{new Date(u.created_at).toLocaleDateString()}</td>
                            <td><button className="btn" style={{fontSize:11,padding:'4px 10px',color:'var(--red)'}} onClick={()=>deleteVenueUser(u.id,u.email)}>Remove</button></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
              }
            </div>}
          </div>
        </div>}

        {modal && editEvt && <div className="modal-bg" onClick={()=>setModal(false)}><div className="modal" onClick={e=>e.stopPropagation()}>
          <h2 className="dsp">{events.find(e=>e.id===editEvt.id)?"Edit Event":"New Event"}</h2>
          <div className="fg"><label className="fl">Title</label><input className="fi" value={editEvt.title} onChange={e=>setEditEvt({...editEvt,title:e.target.value})} placeholder="e.g. Neon Rodeo Night"/></div>
          <div className="fr"><div className="fg"><label className="fl">Date</label><input className="fi" type="date" value={editEvt.date} onChange={e=>setEditEvt({...editEvt,date:e.target.value})}/></div><div className="fg"><label className="fl">Show Time</label><input className="fi" type="time" value={editEvt.time} onChange={e=>setEditEvt({...editEvt,time:e.target.value})} /></div></div>
          <div className="fr"><div className="fg"><label className="fl">Doors</label><input className="fi" type="time" value={editEvt.doors} onChange={e=>setEditEvt({...editEvt,doors:e.target.value})} /></div><div className="fg"><label className="fl">Category</label><select className="fi" value={editEvt.category} onChange={e=>setEditEvt({...editEvt,category:e.target.value})}>{["Live Music","Rodeo","Family","Other Events"].map(c=><option key={c} value={c}>{c}</option>)}</select></div></div>
          <div className="fg">
  <label className="fl">Event Image</label>
  {(editEvt._imagePreview || (editEvt.image && editEvt.image.startsWith('http'))) && (
    <div
      onClick={(ev) => {
        const rect = ev.currentTarget.getBoundingClientRect();
        const x = Math.round(((ev.clientX - rect.left) / rect.width) * 100);
        const y = Math.round(((ev.clientY - rect.top) / rect.height) * 100);
        setEditEvt(prev => ({...prev, focalX: x, focalY: y}));
      }}
      style={{position:'relative',width:'100%',height:160,backgroundImage:`url(${editEvt._imagePreview || editEvt.image})`,backgroundSize:'cover',backgroundPosition:`${editEvt.focalX ?? 50}% ${editEvt.focalY ?? 50}%`,borderRadius:'var(--rs)',marginBottom:8,cursor:'crosshair',overflow:'hidden'}}
    >
      <div style={{position:'absolute',left:`${editEvt.focalX ?? 50}%`,top:`${editEvt.focalY ?? 50}%`,transform:'translate(-50%,-50%)',width:18,height:18,borderRadius:'50%',background:'var(--gold)',border:'2px solid white',boxShadow:'0 0 0 1px rgba(0,0,0,.5)',pointerEvents:'none'}} />
      <div style={{position:'absolute',bottom:6,left:6,fontSize:10,color:'white',background:'rgba(0,0,0,.6)',padding:'2px 8px',borderRadius:4,pointerEvents:'none'}}>Click to set focal point</div>
    </div>
  )}
  <input
    className="fi"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    style={{padding:"8px 14px"}}
    onChange={async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5MB. Please choose a smaller file.'); e.target.value = ''; return; }
      const preview = URL.createObjectURL(file);
      setEditEvt(prev => ({...prev, _imageFile: file, _imagePreview: preview}));
    }}
  />
  <p style={{fontSize:11,color:"var(--text3)",marginTop:4}}>JPG, PNG or WebP. Max 5MB.</p>
</div>
          <div className="fg"><label className="fl">Description</label><textarea className="fi" rows={3} value={editEvt.description} onChange={e=>setEditEvt({...editEvt,description:e.target.value})} placeholder="What should people expect?"/></div>
          <h3 className="dsp" style={{fontSize:16,margin:"16px 0 10px"}}>Ticket Tiers</h3>
          {editEvt.tickets.map((t,i)=><div key={i} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr auto",gap:6,marginBottom:6,alignItems:"end"}}><div className="fg" style={{margin:0}}>{i===0&&<label className="fl">Type</label>}<input className="fi" value={t.type} onChange={e=>{const x=[...editEvt.tickets];x[i]={...x[i],type:e.target.value};setEditEvt({...editEvt,tickets:x})}}/></div><div className="fg" style={{margin:0}}>{i===0&&<label className="fl">Presale $</label>}<input className="fi" type="number" value={t.price} onChange={e=>{const x=[...editEvt.tickets];x[i]={...x[i],price:+e.target.value};setEditEvt({...editEvt,tickets:x})}}/></div><div className="fg" style={{margin:0}}>{i===0&&<label className="fl" title="Door price shown in the at-door sales terminal. Leave blank to use presale price.">Door $</label>}<input className="fi" type="number" min="0" placeholder="same" value={t.doorPrice??''} onChange={e=>{const x=[...editEvt.tickets];x[i]={...x[i],doorPrice:e.target.value===''?null:+e.target.value};setEditEvt({...editEvt,tickets:x})}}/></div><div className="fg" style={{margin:0}}>{i===0&&<label className="fl">Qty</label>}<input className="fi" type="number" value={t.available} onChange={e=>{const x=[...editEvt.tickets];x[i]={...x[i],available:+e.target.value};setEditEvt({...editEvt,tickets:x})}}/></div><div className="fg" style={{margin:0}}>{i===0&&<label className="fl" title="Reserve this many tickets for physical/in-person sale. They won't be available online.">Physical</label>}<input className="fi" type="number" min="0" value={t.physicalQty??0} onChange={e=>{const x=[...editEvt.tickets];x[i]={...x[i],physicalQty:+e.target.value};setEditEvt({...editEvt,tickets:x})}}/></div><button className="qb" onClick={()=>{const x=editEvt.tickets.filter((_,j)=>j!==i);setEditEvt({...editEvt,tickets:x.length?x:[{type:"General Admission",price:25,available:100,physicalQty:0,doorPrice:null}]})}}>×</button></div>)}
          <button className="btn" style={{fontSize:11,marginTop:3}} onClick={()=>setEditEvt({...editEvt,tickets:[...editEvt.tickets,{type:"",price:0,available:100}]})}>+ Add Tier</button>
          <div style={{display:"flex",gap:10,marginTop:24}}><button className="buy" style={{flex:1}} disabled={!editEvt.title||!editEvt.date||isSaving} onClick={()=>saveEvt(editEvt)}>{isSaving?"Saving…":"Save Event"}</button><button className="btn" style={{padding:"10px 20px"}} onClick={()=>setModal(false)}>Cancel</button></div>
        </div></div>}

        {editEmailOrder && <div className="modal-bg" onClick={()=>{setEditEmailOrder(null);setEditEmailValue('');}}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div style={{background:"rgba(179,58,42,.12)",border:"1px solid rgba(179,58,42,.35)",borderRadius:"var(--rs)",padding:"14px 16px",marginBottom:20,display:"flex",gap:12,alignItems:"flex-start"}}>
              <span style={{fontSize:20,lineHeight:1,flexShrink:0}}>⚠️</span>
              <div>
                <div style={{fontWeight:700,color:"var(--red)",fontSize:13,marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>Warning — Email Change</div>
                <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.6}}>You are changing the buyer's email address on this order. The buyer will only receive future emails (resends) at the new address. This action does not automatically resend the confirmation.</div>
              </div>
            </div>
            <h2 className="dsp" style={{fontSize:20,marginBottom:16}}>Edit Order Email</h2>
            <div style={{marginBottom:16,padding:"10px 14px",background:"var(--bg3)",borderRadius:"var(--rs)",fontSize:12,lineHeight:1.8}}>
              <span style={{color:"var(--text3)"}}>Order: </span><span style={{fontFamily:"monospace",color:"var(--text)"}}>{editEmailOrder.id.slice(0,12).toUpperCase()}</span><br/>
              <span style={{color:"var(--text3)"}}>Buyer: </span><span style={{color:"var(--text)"}}>{editEmailOrder.buyer.name}</span><br/>
              <span style={{color:"var(--text3)"}}>Current email: </span><span style={{color:"var(--gold)",fontWeight:600}}>{editEmailOrder.buyer.email||"(none)"}</span>
            </div>
            <div className="fg">
              <label className="fl">New Email Address</label>
              <input className="fi" type="email" value={editEmailValue} onChange={e=>setEditEmailValue(e.target.value)} onKeyDown={e=>e.key==='Enter'&&updateOrderEmail()} placeholder="corrected@email.com" autoFocus />
            </div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button className="buy" style={{flex:1,background:"var(--red)",borderColor:"var(--red)"}} disabled={!editEmailValue.trim()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editEmailValue.trim())||editEmailSaving} onClick={updateOrderEmail}>{editEmailSaving?"Saving…":"Save Email"}</button>
              <button className="btn" style={{padding:"10px 20px"}} onClick={()=>{setEditEmailOrder(null);setEditEmailValue('');}}>Cancel</button>
            </div>
          </div>
        </div>}

        {cancelTarget && <div className="modal-bg" onClick={()=>{ if (!cancelling) setCancelTarget(null); }}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div style={{background:"rgba(179,58,42,.12)",border:"1px solid rgba(179,58,42,.35)",borderRadius:"var(--rs)",padding:"14px 16px",marginBottom:20,display:"flex",gap:12,alignItems:"flex-start"}}>
              <span style={{fontSize:20,lineHeight:1,flexShrink:0}}>⚠️</span>
              <div>
                <div style={{fontWeight:700,color:"var(--red)",fontSize:13,marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>Warning — Refund & Cancellation</div>
                <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.6}}>
                  {cancelTarget.stripePaymentIntentId && !cancelTarget.stripePaymentIntentId.startsWith('CASH-')
                    ? <>Cancelling this order will <strong style={{color:"var(--text)"}}>immediately issue a full refund</strong> to the buyer's original payment method via Stripe. Tickets will be returned to available inventory. This action cannot be undone.</>
                    : <>Cancelling this order will return tickets to available inventory. <strong style={{color:"var(--text)"}}>No Stripe refund will be issued</strong> — you will need to handle any cash or manual refund separately. This action cannot be undone.</>
                  }
                </div>
              </div>
            </div>
            <h2 className="dsp" style={{fontSize:20,marginBottom:16}}>Cancel Order</h2>
            <div style={{marginBottom:20,padding:"10px 14px",background:"var(--bg3)",borderRadius:"var(--rs)",fontSize:12,lineHeight:1.8}}>
              <span style={{color:"var(--text3)"}}>Order: </span><span style={{fontFamily:"monospace",color:"var(--text)"}}>{cancelTarget.id.slice(0,12).toUpperCase()}</span><br/>
              <span style={{color:"var(--text3)"}}>Buyer: </span><span style={{color:"var(--text)"}}>{cancelTarget.buyer.name}</span><br/>
              <span style={{color:"var(--text3)"}}>Email: </span><span style={{color:"var(--text)"}}>{cancelTarget.buyer.email||"—"}</span><br/>
              <span style={{color:"var(--text3)"}}>Amount to refund: </span><span style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(cancelTarget.total)}</span>
              {!cancelTarget.stripePaymentIntentId && <><br/><span style={{color:"var(--red)"}}>No Stripe payment on file — order will be cancelled without a refund.</span></>}
            </div>
            <div style={{display:"flex",gap:10,marginTop:4}}>
              <button className="buy" style={{flex:1,background:"var(--red)",borderColor:"var(--red)"}} disabled={cancelling} onClick={confirmCancelOrder}>{cancelling ? "Processing..." : "Confirm — Cancel & Refund"}</button>
              <button className="btn" style={{padding:"10px 20px"}} disabled={cancelling} onClick={()=>setCancelTarget(null)}>Go Back</button>
            </div>
          </div>
        </div>}

        {ticketSizeModal && <div className="modal-bg" onClick={()=>setTicketSizeModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:540}}>
            <h2 className="dsp" style={{fontSize:22,marginBottom:6}}>Choose Ticket Size</h2>
            <p style={{color:"var(--text2)",fontSize:13,marginBottom:20}}>{ticketSizeModal.mode==='photo'?'Photo PDF — event image on left panel':'Text layout — event photo as subtle background texture'}</p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
              {TICKET_SIZES.map(s=><button key={s.id} onClick={()=>setTicketSizeSelected(s.id)} style={{padding:"14px 16px",textAlign:"left",border:`2px solid ${ticketSizeSelected===s.id?"var(--gold)":"var(--border)"}`,borderRadius:8,background:ticketSizeSelected===s.id?"rgba(200,146,42,0.1)":"var(--card)",cursor:"pointer",color:"var(--text)"}}>
                <div style={{fontWeight:700,fontSize:13}}>{s.label}</div>
                <div style={{fontSize:11,color:"var(--text2)",marginTop:3}}>{s.sublabel}</div>
              </button>)}
            </div>
            {ticketSizeSelected==='custom'&&<div style={{display:"flex",gap:12,marginBottom:20,alignItems:"flex-end"}}>
              <div className="fg" style={{margin:0,flex:1}}><label className="fl">Width (inches)</label><input className="fi" type="number" step="0.25" min="2" max="8.5" value={ticketSizeCustomW} onChange={e=>setTicketSizeCustomW(e.target.value)}/></div>
              <div style={{fontSize:22,paddingBottom:10,color:"var(--text2)"}}>×</div>
              <div className="fg" style={{margin:0,flex:1}}><label className="fl">Height (inches)</label><input className="fi" type="number" step="0.25" min="1" max="10" value={ticketSizeCustomH} onChange={e=>setTicketSizeCustomH(e.target.value)}/></div>
            </div>}
            <div style={{display:"flex",gap:10}}>
              <button className="buy" style={{flex:1}} disabled={!!generatingPhysical} onClick={async()=>{
                const size=ticketSizeSelected==='custom'?resolveCustomSize(ticketSizeCustomW,ticketSizeCustomH):TICKET_SIZES.find(s=>s.id===ticketSizeSelected);
                const{ev,mode}=ticketSizeModal;
                setTicketSizeModal(null);
                if(mode==='print') await generatePhysicalTickets(ev,size);
                else await generatePhotoTickets(ev,size);
              }}>{generatingPhysical?"Generating…":"Generate PDF"}</button>
              <button className="btn" style={{padding:"10px 20px"}} onClick={()=>setTicketSizeModal(null)}>Cancel</button>
            </div>
          </div>
        </div>}
        </main>

      <footer className="footer">
          <div className="footer-links">
            <a href="#" onClick={e => { e.preventDefault(); setView("home"); }}>Events</a>
            <a href="#" onClick={e => { e.preventDefault(); setView("about"); }}>About C8Tickets</a>
            <a href="#" onClick={e => { e.preventDefault(); setSellForm({ name:'', email:'', phone:'', eventName:'', location:'', date:'', attendance:'', channel:'both', notes:'' }); setSellStatus('idle'); setView("sell"); }}>Sell Tickets</a>
            <a href="#" onClick={e => { e.preventDefault(); setLookupEmail(''); setLookupStep('email'); setLookupError(''); setView("lookup"); }}>Find My Tickets</a>
            <a href="#" onClick={e => { e.preventDefault(); setView("terms"); }}>Terms of Service</a>
            <a href="#" onClick={e => { e.preventDefault(); setView("privacy"); }}>Privacy Policy</a>
            <a href="mailto:support@c8tickets.com">Contact Support</a>
          </div>
          <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:20,flexWrap:"wrap",marginBottom:14,paddingBottom:14,borderBottom:"1px solid var(--border)"}}>
            <span style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--text3)"}}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Payments secured by Stripe
            </span>
            <span style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--text3)"}}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              Tickets delivered by email instantly
            </span>
            <span style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--text3)"}}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Locally owned &amp; operated · Kuna, Idaho
            </span>
            <a href="mailto:support@c8tickets.com" style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--text3)",textDecoration:"none"}}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6 19.79 19.79 0 0 1 1.63 5 2 2 0 0 1 3.62 3h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 10.8a16 16 0 0 0 6.29 6.29l1.16-1.86a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              support@c8tickets.com
            </a>
          </div>
          <div className="footer-copy">Copyright 2026 C8Tickets - Kuna, Idaho - All rights reserved</div>
          <div style={{marginTop:12}}><a href="#" style={{fontSize:11,color:"var(--text3)"}} onClick={e => { e.preventDefault(); setView("login"); }}>Staff Login</a></div>
        </footer>
      </div>
    </>
    );
}