import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Html5Qrcode } from 'html5-qrcode';
import { supabase } from './lib/supabase';
import { TENANT_ID, API_BASE, APP_URL } from './constants';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

// ── Logo as base64 PNG with transparency ──
const LOGO_SRC = "/logo.jpg";
// ── Data & Storage ──
const DEFAULT_VENUE = {
  id: TENANT_ID, name: "Crooked 8",
  tagline: "Local Events, Easy Tickets.",
  location: "1882 E King Rd, Kuna, ID 83634",
  phone: "(208) 991-0788",
};

const mapEvent = (e) => ({
  id: e.id,
  venueId: TENANT_ID,
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

const useStorage = () => {
  const [venues, setVenues] = useState([DEFAULT_VENUE]);
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: venueData } = await supabase
  .from('tenants')
  .select('*')
  .eq('id', TENANT_ID)
  .single();

if (venueData) {
  setVenues([{
    id: TENANT_ID,
    name: venueData.name,
    tagline: "Local Events, Easy Tickets.",
    location: venueData.address || DEFAULT_VENUE.location,
    phone: venueData.contact_phone || "",
    email: venueData.contact_email || "",
    website: venueData.website || "",
  }]);
}
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*, ticket_types(*)')
        .eq('tenant_id', TENANT_ID)
        .order('event_date', { ascending: true });

      if (eventsError) console.error(eventsError);
      else setEvents((eventsData || []).map(mapEvent));

      setLoaded(true);
    };
    load();
  }, []);

  const updateEvents = useCallback((d) => setEvents(d), []);

  return { venues, events, loaded, updateEvents };
};

const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtCurrency = (n) => n === 0 ? "FREE" : "$" + Number(n).toFixed(2);
const fmtTime = (t) => t ? new Date('1970-01-01T' + t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

// ── QR Code ──
const QRCode = ({ value, size = 160 }) => {
  const cells = useMemo(() => { let h = 0; for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0; const g = [], n = 21; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const tl = r < 7 && c < 7, tr = r < 7 && c >= n - 7, bl = r >= n - 7 && c < 7; if (tl || tr || bl) { const lr = tl ? r : tr ? r : r - (n - 7), lc = tl ? c : tr ? c - (n - 7) : c; g.push({ r, c, on: lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4) }); } else { h = ((h * 1103515245 + 12345) & 0x7fffffff); g.push({ r, c, on: (h % 3) !== 0 }); } } return g; }, [value]);
  const s = size / 21;
  return (<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}><rect width={size} height={size} fill="white" rx="4" />{cells.filter(c => c.on).map((c, i) => <rect key={i} x={c.c * s} y={c.r * s} width={s + .5} height={s + .5} fill="#1a1007" rx=".5" />)}</svg>);
};
// ── Stripe Checkout Form ──
const CheckoutForm = ({ cartTotal, totalTickets, paymentAmounts, onSuccess, onBack }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const serviceFees = totalTickets * 2;
  const salesTax = paymentAmounts?.salesTax ?? 0;
  const processingFee = paymentAmounts?.processingFee ?? 0;
  const grandTotal = paymentAmounts?.grandTotal || (cartTotal + serviceFees);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
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
      <button className="buy" onClick={handleSubmit} disabled={!stripe || processing}>
        {processing ? "Processing..." : `Pay ${fmtCurrency(grandTotal)}`}
      </button>
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
.app{min-height:100vh;display:flex;flex-direction:column}
.dsp{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:1.5px;font-weight:700}

.nav{display:flex;align-items:center;justify-content:space-between;padding:10px 20px;padding-top:calc(10px + env(safe-area-inset-top));background:var(--bg2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100;backdrop-filter:blur(12px)}
.nav-logo{cursor:pointer;display:flex;align-items:center;gap:10px}
.nav-logo img{height:40px;filter:invert(1);opacity:.92}
.nav-links{display:flex;gap:4px}
.btn{background:none;border:1px solid transparent;color:var(--text2);padding:7px 14px;border-radius:99px;cursor:pointer;font-family:'Barlow',sans-serif;font-size:13px;font-weight:600;transition:all .2s;text-transform:uppercase;letter-spacing:.5px}
.btn:hover,.btn.on{background:var(--bg3);color:var(--text);border-color:var(--border)}
.btn.gold{background:linear-gradient(135deg,var(--gold),var(--gold-d));color:var(--bg);border-color:var(--gold)}
.btn.gold:hover{filter:brightness(1.15)}

.hero{padding:60px 20px 48px;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,rgba(200,146,42,.09) 0%,transparent 70%);pointer-events:none}
.hero::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--gold-d),transparent)}
.hero-logo{height:120px;filter:invert(1);opacity:.9;margin-bottom:12px}
.hero p{color:var(--text);font-size:18px;font-weight:400;letter-spacing:1.5px;text-transform:uppercase;opacity:.75}
.hero-sub{display:flex;justify-content:center;gap:16px;margin-top:12px;font-size:12px;color:var(--text3);flex-wrap:wrap}

.sec{padding:20px;max-width:1200px;margin:0 auto;width:100%;position:relative;z-index:1}
.sec-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px}
.sec-title{font-size:24px}
.filters{display:flex;gap:5px;flex-wrap:wrap}
.chip{padding:5px 12px;border-radius:99px;border:1px solid var(--bg4);background:transparent;color:var(--text2);cursor:pointer;font-size:11px;font-family:'Barlow',sans-serif;font-weight:600;transition:all .2s;text-transform:uppercase;letter-spacing:.5px}
.chip.on,.chip:hover{background:var(--gold);color:var(--bg);border-color:var(--gold)}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;cursor:pointer;transition:all .3s}
.card:hover{transform:translateY(-3px);box-shadow:0 10px 36px rgba(200,146,42,.1);border-color:rgba(200,146,42,.25)}
.card-img{height:130px;display:flex;align-items:center;justify-content:center;font-size:48px;background:linear-gradient(135deg,var(--bg3),var(--bg4));position:relative}
.card-cat{position:absolute;top:10px;right:10px;background:rgba(12,10,7,.8);backdrop-filter:blur(6px);padding:3px 10px;border-radius:99px;font-size:9px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;border:1px solid rgba(200,146,42,.2)}
.card-body{padding:16px}
.card-date{font-size:11px;color:var(--gold);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
.card-title{font-size:20px;margin-bottom:4px;line-height:1.2}
.card-desc{color:var(--text2);font-size:12px;line-height:1.5;margin-bottom:14px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-foot{display:flex;justify-content:space-between;align-items:center}
.card-price{font-weight:700;font-size:17px}
.card-price small{font-weight:400;font-size:11px;color:var(--text3)}

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
@media(max-width:768px){.admin{grid-template-columns:1fr}}
.aside{background:var(--bg2);border-right:1px solid var(--border);padding:20px 14px;display:flex;flex-direction:column;gap:3px}
@media(max-width:768px){.aside{flex-direction:row;overflow-x:auto;padding:10px;border-right:none;border-bottom:1px solid var(--border)}}
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
.about-hero{text-align:center;padding:72px 20px 56px;border-bottom:1px solid var(--border)}
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

  const handleScan = async (id) => {
    setScanning(false);
    setResult('loading');
    const { data: order, error } = await supabase
      .from('orders').select('*, order_items(*)')
      .eq('id', id).single();
    if (error || !order) { setResult({ found: false }); return; }
    const ev = events.find(e => e.id === order.event_id);
    setResult({ found: true, order, event: ev, alreadyIn: order.status === 'checked_in', done: false });
  };

  const doCheckin = async () => {
    await supabase.from('orders').update({ status: 'checked_in' }).eq('id', result.order.id);
    setResult({ ...result, alreadyIn: false, done: true });
  };

  const next = () => { setResult(null); setScanning(true); };

  return (
    <div className="app">
      <nav className="nav">
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <img src={LOGO_SRC} alt="" style={{height:40,filter:'invert(1)',opacity:.9}} />
          <span className="dsp" style={{fontSize:12,color:'var(--gold)',letterSpacing:2}}>Gate Check-In</span>
        </div>
        <button className="btn" onClick={onLogout}>Logout</button>
      </nav>
      <div style={{maxWidth:440,margin:'0 auto',padding:'24px 16px',width:'100%'}}>
        {!scanning && !result && (
          <div style={{textAlign:'center',paddingTop:60}} className="fade">
            <div style={{fontSize:64,marginBottom:16}}>🎟️</div>
            <h2 className="dsp" style={{fontSize:28,marginBottom:8}}>Ready to Scan</h2>
            <p style={{color:'var(--text2)',fontSize:14,marginBottom:32}}>Point the camera at a buyer's QR code to check them in.</p>
            <button className="buy" onClick={() => setScanning(true)}>Start Scanner</button>
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
              {result.found && result.alreadyIn && (
                <div style={{textAlign:'center',padding:'20px 0'}}>
                  <div style={{fontSize:48,marginBottom:10}}>⚠️</div>
                  <h3 className="dsp" style={{color:'var(--gold)',fontSize:22,marginBottom:8}}>Already Checked In</h3>
                  <p style={{fontWeight:700,fontSize:16}}>{result.order.buyer_name}</p>
                  <p style={{color:'var(--gold)',fontSize:13,marginTop:4}}>{result.event?.title}</p>
                </div>
              )}
              {result.found && result.done && (
                <div style={{textAlign:'center',padding:'20px 0'}}>
                  <div style={{fontSize:48,marginBottom:10}}>✅</div>
                  <h3 className="dsp" style={{color:'var(--green)',fontSize:22,marginBottom:8}}>Checked In!</h3>
                  <p style={{fontWeight:700,fontSize:16}}>{result.order.buyer_name}</p>
                  <p style={{color:'var(--gold)',fontSize:13,marginTop:4}}>{result.event?.title}</p>
                </div>
              )}
              {result.found && !result.alreadyIn && !result.done && (
                <div>
                  <div style={{textAlign:'center',marginBottom:16}}>
                    <div style={{fontSize:48,marginBottom:10}}>✅</div>
                    <h3 className="dsp" style={{color:'var(--green)',fontSize:22,marginBottom:4}}>Valid Ticket</h3>
                  </div>
                  <p style={{fontWeight:700,fontSize:17,marginBottom:2}}>{result.order.buyer_name}</p>
                  <p style={{color:'var(--text2)',fontSize:13,marginBottom:4}}>{result.order.buyer_email}</p>
                  <p style={{color:'var(--gold)',fontWeight:700,fontSize:14,marginBottom:14}}>{result.event?.title || 'Event'}</p>
                  <div style={{background:'var(--bg3)',borderRadius:'var(--rs)',padding:'10px 14px',marginBottom:16}}>
                    {(result.order.order_items || []).map((item, i) => (
                      <div key={i} style={{fontSize:13,color:'var(--text2)',padding:'2px 0'}}>{item.quantity}× {item.ticket_type_name}</div>
                    ))}
                  </div>
                  <button className="buy" onClick={doCheckin}>✓ Check In</button>
                </div>
              )}
            </div>
            <button className="btn" style={{width:'100%'}} onClick={next}>
              {result.found && !result.alreadyIn && !result.done ? 'Cancel' : 'Scan Next Ticket'}
            </button>
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
  const [step, setStep] = useState('select');
  const [clientSecret, setClientSecret] = useState(null);
  const [amounts, setAmounts] = useState(null);
  const [cashAmounts, setCashAmounts] = useState(null);
  const [tendered, setTendered] = useState('');
  const [lastSale, setLastSale] = useState(null);
  const [loadingIntent, setLoadingIntent] = useState(false);

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

  const handleSuccess = async (paymentIntentId) => {
    const soldItems = cartItems.filter(i => i.qty > 0).map(i => ({ type: i.type, qty: i.qty, price: i.effectivePrice, ticketTypeId: i.id }));
    const { data: order, error: orderError } = await supabase.from('orders').insert({
      tenant_id: TENANT_ID, event_id: selEventId,
      buyer_name: buyerName.trim() || 'Walk-In', buyer_email: '', buyer_phone: '',
      status: 'checked_in', total_amount: amounts.grandTotal,
      stripe_payment_intent_id: paymentIntentId, source: 'door',
    }).select().single();
    if (orderError) { alert('Order save failed. Payment ref: ' + paymentIntentId); return; }
    await supabase.from('order_items').insert(soldItems.map(i => ({
      order_id: order.id, ticket_type_id: i.ticketTypeId,
      ticket_type_name: i.type, quantity: i.qty, unit_price: i.price,
    })));
    for (const item of soldItems) await supabase.rpc('increment_sold', { tid: item.ticketTypeId, qty: item.qty });
    const localOrder = {
      id: order.id, eventId: selEventId, venueId: venue.id,
      buyer: { name: buyerName.trim() || 'Walk-In', email: '', phone: '' },
      items: soldItems.map(i => ({ type: i.type, qty: i.qty, price: i.price })),
      ticketTotal: amounts.ticketTotal, salesTax: amounts.salesTax,
      serviceFees: amounts.serviceFees, processingFee: amounts.processingFee,
      total: amounts.grandTotal, date: new Date().toISOString(), checkedIn: true, source: 'door',
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
    const { data: order, error: orderError } = await supabase.from('orders').insert({
      tenant_id: TENANT_ID, event_id: selEventId,
      buyer_name: buyerName.trim() || 'Walk-In', buyer_email: '', buyer_phone: '',
      status: 'checked_in', total_amount: cashAmounts.grandTotal,
      stripe_payment_intent_id: ref, source: 'door_cash',
    }).select().single();
    if (orderError) { alert('Order save failed. Please try again.'); return; }
    await supabase.from('order_items').insert(soldItems.map(i => ({
      order_id: order.id, ticket_type_id: i.ticketTypeId,
      ticket_type_name: i.type, quantity: i.qty, unit_price: i.price,
    })));
    for (const item of soldItems) await supabase.rpc('increment_sold', { tid: item.ticketTypeId, qty: item.qty });
    const localOrder = {
      id: order.id, eventId: selEventId, venueId: venue.id,
      buyer: { name: buyerName.trim() || 'Walk-In', email: '', phone: '' },
      items: soldItems.map(i => ({ type: i.type, qty: i.qty, price: i.price })),
      ticketTotal: cashAmounts.ticketTotal, salesTax: cashAmounts.salesTax,
      serviceFees: cashAmounts.serviceFees, processingFee: 0,
      total: cashAmounts.grandTotal, date: new Date().toISOString(), checkedIn: true, source: 'door_cash',
    };
    updateOrders(prev => [...prev, localOrder]);
    updateEvents(evts => evts.map(e => e.id !== selEventId ? e : {
      ...e, tickets: e.tickets.map((t, i) => ({ ...t, available: t.available - (doorCart[i] || 0) }))
    }));
    setLastSale(localOrder);
    setStep('confirm');
  };

  const reset = () => { setStep('select'); setDoorCart({}); setBuyerName(''); setClientSecret(null); setAmounts(null); setCashAmounts(null); setTendered(''); setLastSale(null); };

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
          <div className="fg" style={{marginBottom:16,marginTop:4}}>
            <label className="fl">Customer Name <span style={{fontWeight:400,color:'var(--text3)'}}>(optional)</span></label>
            <input className="fi" value={buyerName} onChange={e=>setBuyerName(e.target.value)} placeholder="Walk-In" />
          </div>
          <div style={{display:'flex',gap:10}}>
            <button className="buy" style={{flex:1}} disabled={cartN===0||loadingIntent} onClick={startPayment}>
              {loadingIntent?'Preparing…':'💳 Charge Card'}
            </button>
            <button className="buy" style={{flex:1,background:'var(--green)',borderColor:'var(--green)'}} disabled={cartN===0} onClick={startCash}>
              💵 Cash Sale
            </button>
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
          <button className="buy" style={{background:'var(--green)',borderColor:'var(--green)',marginBottom:8}} disabled={tendered!==''&&parseFloat(tendered)<cashAmounts.grandTotal} onClick={handleCashSale}>
            ✓ Cash Collected — Complete Sale
          </button>
          <button className="btn" style={{width:'100%'}} onClick={()=>setStep('select')}>← Back</button>
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
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${lastSale.id}`} width={180} height={180} alt="QR" style={{display:'block'}} />
          </div>
          <p style={{fontFamily:'monospace',fontSize:11,color:'var(--gold)',letterSpacing:1,marginBottom:4,fontWeight:700}}>CHECKED IN {lastSale.source==='door_cash'?'· CASH':''}</p>
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
    const poll = setInterval(refresh, 20000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [selEventId]);

  const ev = events.find(e => e.id === selEventId);
  const evOrders = orders.filter(o => o.eventId === selEventId);
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
  const { venues, events, loaded, updateEvents } = useStorage();
  const [orders, setOrders] = useState([]);
  const updateOrders = useCallback((d) => setOrders(d), []);
  const [view, setView] = useState("home");
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
  const [filter, setFilter] = useState("All");
  const [editEvt, setEditEvt] = useState(null);
  const [modal, setModal] = useState(false);
  const [session, setSession] = useState(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [clientSecret, setClientSecret] = useState(null);
  const [paymentAmounts, setPaymentAmounts] = useState(null);
  const [resetEmail, setResetEmail] = useState('');
const [resetSent, setResetSent] = useState(false);
const [resetError, setResetError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [adminScan, setAdminScan] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupOrders, setLookupOrders] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupStep, setLookupStep] = useState('email');
  const [lookupCode, setLookupCode] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [generatingPhysical, setGeneratingPhysical] = useState(false);

  const venue = venues[0] || DEFAULT_VENUE;
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
      .eq('tenant_id', TENANT_ID)
      .then(({ data, error }) => {
        if (error) { console.error(error); return; }
        setOrders((data || []).map(o => ({
          id: o.id,
          eventId: o.event_id,
          venueId: TENANT_ID,
          buyer: { name: o.buyer_name, email: o.buyer_email, phone: o.buyer_phone || "" },
          items: (o.order_items || []).map(i => ({ type: i.ticket_type_name, qty: i.quantity, price: Number(i.unit_price), ticketTypeId: i.ticket_type_id })),
          total: Number(o.total_amount),
          date: o.created_at,
          status: o.status,
          checkedIn: o.status === 'checked_in',
        })));
      });
  }, [session]);

  useEffect(() => {
    if (!loaded) return;
    const pathMatch = window.location.pathname.match(/^\/e\/([0-9a-f-]{36})$/i);
    const eventId = pathMatch ? pathMatch[1] : new URLSearchParams(window.location.search).get('event');
    if (eventId) { setSelId(eventId); setCart({}); setView('detail'); }
  }, [loaded]);

  useEffect(() => {
    const base = 'C8Tickets';
    const selTitle = events.find(e => e.id === selId)?.title;
    if (view === 'detail' && selTitle) document.title = `${selTitle} — ${base}`;
    else if (view === 'checkout') document.title = `Checkout — ${base}`;
    else if (view === 'ticket') document.title = `Your Tickets — ${base}`;
    else if (view === 'admin') document.title = `Admin — ${base}`;
    else if (view === 'lookup') document.title = `Find My Tickets — ${base}`;
    else document.title = `${venue.name} Events — ${base}`;
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
    redirectTo: 'https://www.c8tickets.com/?reset=true',
  });
  if (error) setResetError(error.message);
  else setResetSent(true);
};

const updatePassword = async (newPassword) => {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) console.error(error);
  else setView('home');
};

const logout = async () => {
  await supabase.auth.signOut();
  setView('home');
};

const cancelOrder = async (o) => {
  if (!window.confirm(`Cancel order for ${o.buyer.name}? This will restore their tickets to available inventory.`)) return;
  await supabase.from('orders').update({ status: 'cancelled' }).eq('id', o.id);
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
};

const resendEmail = async (o) => {
  const ev = events.find(e => e.id === o.eventId);
  if (!o.buyer.email) { alert('No email address on file for this order.'); return; }
  const ticketTotal = o.items.reduce((s, i) => s + i.qty * i.price, 0);
  const totalQty = o.items.reduce((s, i) => s + i.qty, 0);
  const salesTax = Math.round(ticketTotal * 0.06 * 100) / 100;
  const serviceFees = totalQty * 2;
  const processingFee = Math.max(0, Math.round((o.total - ticketTotal - salesTax - serviceFees) * 100) / 100);
  const res = await fetch(API_BASE+'/api/send-confirmation', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order: { id: o.id, buyer: o.buyer, items: o.items, salesTax, serviceFees, processingFee, total: o.total },
      event: { title: ev?.title || 'Event', category: ev?.category || '', date: fmtDate(ev?.date || ''), time: fmtTime(ev?.time || ''), doors: fmtTime(ev?.doors || '') },
      venue: { name: venue.name, location: venue.location },
    }),
  });
  alert(res.ok ? `Confirmation resent to ${o.buyer.email}` : 'Failed to send — check the email address and try again.');
};

const sendLookupCode = async () => {
  const email = lookupEmail.toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  setLookupLoading(true);
  setLookupError('');
  await fetch(API_BASE+'/api/send-lookup-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  setLookupLoading(false);
  setLookupStep('code');
};

const verifyLookupCode = async () => {
  const email = lookupEmail.toLowerCase().trim();
  if (!email || !lookupCode.trim()) return;
  setLookupLoading(true);
  setLookupError('');
  const res = await fetch(API_BASE+'/api/verify-lookup-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code: lookupCode.trim() }) });
  const data = await res.json();
  setLookupLoading(false);
  if (!res.ok) { setLookupError('That code is incorrect or has expired. Please try again.'); return; }
  setLookupOrders(data.orders || []);
};

const openPrintPage = (ev, tickets, venue) => {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Physical Tickets — ${ev.title}</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#fff;font-family:'Helvetica Neue',Arial,sans-serif}
.toolbar{padding:16px 24px;background:#f5f3ef;border-bottom:1px solid #d9d0c0;display:flex;align-items:center;gap:16px}
.toolbar button{background:#c8922a;color:#fff;border:none;padding:10px 28px;font-size:14px;font-weight:700;border-radius:6px;cursor:pointer;letter-spacing:1px;text-transform:uppercase}
.toolbar p{font-size:13px;color:#6b5e47}
.sheet{padding:0.3in;display:grid;grid-template-columns:1fr 1fr;gap:0.15in}
.tkt{width:100%;background:#1c1914;border:1.5px solid #c8922a;border-radius:8px;display:flex;overflow:hidden;position:relative;page-break-inside:avoid}
.tkt-body{flex:1;padding:14px 12px 12px;display:flex;flex-direction:column;justify-content:space-between;border-right:1.5px dashed rgba(200,146,42,.35)}
.tkt-stub{width:108px;flex-shrink:0;padding:12px 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.gold-bar{position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#c8922a,#f0c050,#c8922a)}
.brand{font-size:13px;font-weight:900;color:#c8922a;text-transform:uppercase;letter-spacing:3px;line-height:1}
.brand-loc{font-size:7.5px;color:#7a6c54;text-transform:uppercase;letter-spacing:1.5px;margin-top:2px}
.evt-title{font-size:15px;font-weight:800;color:#f0e9da;text-transform:uppercase;letter-spacing:.8px;line-height:1.2;margin:8px 0 6px}
.evt-meta{font-size:8.5px;color:#b5a78a;text-transform:uppercase;letter-spacing:.8px;line-height:2}
.tkt-type{margin-top:8px;font-size:8px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:2px;border:1px solid rgba(200,146,42,.5);border-radius:3px;padding:2px 7px;display:inline-block}
.admit{font-size:7.5px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:2px}
.qr-wrap{background:#fff;padding:5px;border-radius:4px}
.tkt-id{font-size:6.5px;color:#7a6c54;font-family:monospace;letter-spacing:.5px;text-align:center;word-break:break-all;line-height:1.4}
@media print{.toolbar{display:none}.sheet{padding:0.2in}.tkt{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:letter portrait;margin:0}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">🖨 Print / Save as PDF</button><p>${tickets.length} ticket${tickets.length!==1?'s':''} &nbsp;·&nbsp; Use "Save as PDF" in the print dialog to send to a print shop</p></div>
<div class="sheet">
${tickets.map(t=>`<div class="tkt"><div class="gold-bar"></div><div class="tkt-body"><div><div class="brand">${venue.name}</div><div class="brand-loc">${venue.location}</div></div><div class="evt-title">${t.eventTitle}</div><div class="evt-meta">📅 ${t.date}${t.time?'<br>🕐 '+t.time:''}<br>📍 ${venue.location}</div><div><span class="tkt-type">${t.type}</span></div></div><div class="tkt-stub"><div class="admit">Admit One</div><div class="qr-wrap"><img src="https://api.qrserver.com/v1/create-qr-code/?size=88x88&data=${t.id}" width="88" height="88" alt="QR"></div><div class="tkt-id">${t.id.slice(0,8).toUpperCase()}<br>${t.id.slice(9,17).toUpperCase()}</div></div></div>`).join('\n')}
</div></body></html>`;
  const win = window.open('', '_blank');
  if (!win) { alert('Pop-up blocked. Please allow pop-ups for this site and try again.'); return; }
  win.document.write(html); win.document.close();
};

const openPhotoPage = (ev, tickets, venue) => {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Photo Tickets — ${ev.title}</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f0ede8;font-family:'Helvetica Neue',Arial,sans-serif}
.toolbar{padding:16px 24px;background:#f5f3ef;border-bottom:1px solid #d9d0c0;display:flex;align-items:center;gap:16px}
.toolbar button{background:#c8922a;color:#fff;border:none;padding:10px 28px;font-size:14px;font-weight:700;border-radius:6px;cursor:pointer;letter-spacing:1px;text-transform:uppercase}
.toolbar p{font-size:13px;color:#6b5e47}
.sheet{padding:0.3in;display:grid;grid-template-columns:1fr 1fr;gap:0.18in}
.tkt{display:flex;height:2.4in;background:#1c1914;border:1.5px solid #c8922a;border-radius:8px;overflow:hidden;page-break-inside:avoid;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.tkt-photo{width:33%;flex-shrink:0;background-size:cover;background-repeat:no-repeat;position:relative}
.tkt-photo::after{content:'';position:absolute;inset:0;background:linear-gradient(to right,rgba(28,25,20,0) 40%,rgba(28,25,20,.75) 100%)}
.tkt-stripe{width:3px;flex-shrink:0;background:linear-gradient(to bottom,#c8922a,#f0c050,#c8922a)}
.tkt-main{flex:1;padding:13px 12px 11px 14px;display:flex;flex-direction:column;justify-content:space-between;min-width:0}
.brand{font-size:11.5px;font-weight:900;color:#c8922a;text-transform:uppercase;letter-spacing:3px;line-height:1}
.brand-sub{font-size:7px;color:#7a6c54;text-transform:uppercase;letter-spacing:1.5px;margin-top:2px}
.gold-rule{width:32px;height:2px;background:#c8922a;margin:7px 0 8px}
.evt-name{font-size:15.5px;font-weight:800;color:#f0e9da;text-transform:uppercase;letter-spacing:.7px;line-height:1.18;margin-bottom:5px}
.evt-date{font-size:8px;color:#b5a78a;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px}
.evt-venue{font-size:7px;color:#5e5040;text-transform:uppercase;letter-spacing:.5px}
.tkt-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:8px}
.tier-label{font-size:6.5px;color:#c8922a;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:3px}
.tier-name{font-size:10px;font-weight:800;color:#f0e9da;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.tkt-code{font-size:6.5px;color:#7a6c54;font-family:monospace;letter-spacing:1px}
.qr-box{background:#fff;padding:4px;border-radius:4px;flex-shrink:0}
.qr-box img{display:block}
.no-photo{background:linear-gradient(135deg,#2a2218 0%,#1c1914 60%,#0e0c09 100%)}
@media print{.toolbar{display:none}.sheet{padding:0.2in}.tkt{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-shadow:none}@page{size:letter portrait;margin:0}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">🖨 Print / Save as PDF</button><p>${tickets.length} ticket${tickets.length!==1?'s':''} &nbsp;·&nbsp; Save as PDF and send to your print shop for professional printing</p></div>
<div class="sheet">
${tickets.map(t=>{const hasImg=t.image&&t.image.startsWith('http');return`<div class="tkt">
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
      <div class="qr-box"><img src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=${t.id}" width="72" height="72" alt="QR"></div>
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
      results.push({ id: order.id, type: tier.type });
    }
  }
  return results;
};

const generatePhysicalTickets = async (ev) => {
  if (!ev.tickets.some(t => (t.physicalQty ?? 0) > 0)) {
    alert('No physical tickets allocated. Edit the event and set a "Physical" quantity on at least one ticket tier.');
    return;
  }
  setGeneratingPhysical(ev.id);
  const orders = await fetchOrCreatePhysicalOrders(ev);
  setGeneratingPhysical(false);
  if (orders.length > 0) openPrintPage(ev, orders.map(o => ({ ...o, eventTitle: ev.title, date: fmtDate(ev.date), time: fmtTime(ev.time) })), venue);
};

const generatePhotoTickets = async (ev) => {
  if (!ev.tickets.some(t => (t.physicalQty ?? 0) > 0)) {
    alert('No physical tickets allocated. Edit the event and set a "Physical" quantity on at least one ticket tier.');
    return;
  }
  setGeneratingPhysical(ev.id + '-photo');
  const orders = await fetchOrCreatePhysicalOrders(ev);
  setGeneratingPhysical(false);
  if (orders.length > 0) openPhotoPage(ev, orders.map(o => ({ ...o, eventTitle: ev.title, date: fmtDate(ev.date), time: fmtTime(ev.time), image: ev.image, focalX: ev.focalX, focalY: ev.focalY })), venue);
};
  const vEvents = events.filter(e => e.venueId === venue.id);
  const publicEvents = vEvents.filter(e => e.published !== false);
  const CATS = ["All", "Live Music", "Rodeo", "Family", "Other Events"];
  const filtered = (filter === "All" ? publicEvents : publicEvents.filter(e => e.category === filter));
  const sel = events.find(e => e.id === selId);
  const cartTotal = useMemo(() => sel ? sel.tickets.reduce((s, t, i) => s + (cart[i] || 0) * t.price, 0) : 0, [cart, sel]);
  const cartN = Object.values(cart).reduce((a, b) => a + b, 0);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email);
  const nameValid = buyer.name.trim().length >= 2;
  const buyerReady = nameValid && emailValid;

  const open = (id) => { setSelId(id); setCart({}); setView("detail"); window.history.pushState({}, '', `/e/${id}`); };
  const goHome = () => { setView("home"); window.history.pushState({}, '', '/'); };


  const checkin = async (oid) => {
    await supabase.from('orders').update({ status: 'checked_in' }).eq('id', oid);
    updateOrders(orders.map(o => o.id === oid ? { ...o, checkedIn: true } : o));
  };

  const handleAdminScan = async (id) => {
    setAdminScan(false);
    const order = orders.find(o => o.id === id);
    if (!order) { setScanMsg({ ok: false, text: 'No order found for that QR code.' }); return; }
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
      if (t.id) await supabase.from('ticket_types').update({ physical_qty: t.physicalQty ?? 0, door_price: t.doorPrice ?? null }).eq('id', t.id);
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
    const mapped = { ...e, id: newEvt.id, venueId: venue.id, image: imageUrl, focalX: e.focalX ?? 50, focalY: e.focalY ?? 50, published: e.published ?? true };
    updateEvents([...events, mapped]);
  }
  setModal(false);
  setEditEvt(null);
  } finally {
    setIsSaving(false);
  }
};
  const delEvt = async (id) => {
  await supabase.from('events').delete().eq('id', id);
  updateEvents(events.filter(e => e.id !== id));
};
  const togglePublish = async (ev) => {
  const next = !ev.published;
  await supabase.from('events').update({ is_published: next }).eq('id', ev.id);
  updateEvents(events.map(e => e.id === ev.id ? { ...e, published: next } : e));
};

  if (!loaded) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0c0a07" }}><img src={LOGO_SRC} alt="Crooked 8" style={{ height: 80, filter: "invert(1)", opacity: .7, animation: "fi .6s ease" }} /></div>;

  return (
    <><style>{CSS}</style>
      <div className="app">
        <nav className="nav">
          <div className="nav-logo" onClick={goHome} style={{position:"relative"}}>
            <img src={LOGO_SRC} alt="Crooked 8" />
            <div style={{position:"absolute",bottom:-4,left:"50%",transform:"translateX(-50%)",background:"var(--gold)",color:"var(--bg)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:8,letterSpacing:3,textTransform:"uppercase",padding:"2px 6px",borderRadius:2,whiteSpace:"nowrap"}}>TICKETS</div>
            </div>
          <div className="nav-links">
            <button className={`btn ${["home","detail"].includes(view) ? "on" : ""}`} onClick={goHome}>Events</button>
            <button className={`btn ${view === "about" ? "on" : ""}`} onClick={() => setView("about")}>About</button>
            {session && <button className={`btn ${view === "admin" || view === "gate" ? "on" : ""}`} onClick={() => setView(isGate ? 'gate' : 'admin')}>{isGate ? 'Check-In' : 'Admin'}</button>}
            <button className="btn" onClick={() => session ? logout() : setView("login")}>{session ? "Logout" : "Login"}</button>
          </div>
        </nav>

        {view === "home" && <div className="fade">
          <div className="hero">
            <div style={{position:"relative",display:"inline-block",marginBottom:16}}>
              <img src={LOGO_SRC} alt="Crooked 8" className="hero-logo" style={{marginBottom:0}} />
              <div style={{position:"absolute",bottom:-12,left:"50%",transform:"translateX(-50%)",background:"var(--gold)",color:"var(--bg)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:14,letterSpacing:4,textTransform:"uppercase",padding:"3px 16px",borderRadius:2,whiteSpace:"nowrap"}}>TICKETS</div>
              </div>
            <p>{venue.tagline}</p>
            <div className="hero-sub"><span>Questions? <a href="mailto:support@c8tickets.com" style={{color:"var(--text2)"}}>support@c8tickets.com</a></span></div>
          </div>
          <div className="sec">
            <div className="sec-hdr"><div className="sec-title dsp">Upcoming Events</div>
              <div className="filters">{CATS.map(c => <button key={c} className={`chip ${filter === c ? "on" : ""}`} onClick={() => setFilter(c)}>{c}</button>)}</div>
            </div>
            {filtered.length === 0 ? <div className="empty"><div className="ic">📭</div><p>No events in this category</p></div> :
              <div className="grid">{filtered.map(ev => { const mp = Math.min(...ev.tickets.map(t => t.price)); const onlineAvail = (t) => Math.max(0, t.available - (t.physicalQty ?? 0)); const soldOut = ev.tickets.every(t => onlineAvail(t) <= 0); return (
                <div key={ev.id} className="card" onClick={() => open(ev.id)}>
                  <div className="card-img" style={{backgroundImage: ev.image && ev.image.startsWith('http') ? `url(${ev.image})` : 'none', backgroundSize:'cover', backgroundPosition:`${ev.focalX ?? 50}% ${ev.focalY ?? 50}%`}}>
  {(!ev.image || !ev.image.startsWith('http')) && <span style={{fontSize:48}}>🎵</span>}
  <div className="card-cat">{ev.category}</div>
</div>
                  <div className="card-body">
                    <div className="card-date">{fmtDate(ev.date)} - {fmtTime(ev.time)}</div>
                    <div className="card-title dsp">{ev.title}</div>
                    <div className="card-desc">{ev.description}</div>
                    <div className="card-foot"><div className="card-price">{soldOut ? "Sold Out" : <>{fmtCurrency(mp)}{mp > 0 && <small> & up</small>}</>}</div>{soldOut ? <span className="badge badge-sold">Sold Out</span> : <button className="btn gold" onClick={e => { e.stopPropagation(); open(ev.id); }}>Tickets</button>}</div>
                  </div>
                </div>); })}</div>}
          </div>
        </div>}

        {view === "detail" && sel && <div className="sec fade" style={{ maxWidth: 800 }}>
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
  <span>📍 <strong>{venue.name}</strong> — {venue.location}</span>
  {venue.phone && <span>📞 <strong>{venue.phone}</strong></span>}
  {venue.email && <span>✉️ <a href={`mailto:${venue.email}`} style={{color:"var(--gold)"}}>{venue.email}</a></span>}
  {venue.website && <span>🌐 <a href={venue.website} target="_blank" rel="noopener noreferrer" style={{color:"var(--gold)"}}>{venue.website.replace('https://','')}</a></span>}
</div>
          <a className="directions-btn" href={`https://maps.google.com/?q=${encodeURIComponent(venue.location)}`} target="_blank" rel="noopener noreferrer">📍 Get Directions</a>
          <p className="d-desc">{sel.description}</p>
          <div className="tkt-sec"><h3 className="dsp">Select Tickets</h3>
            {sel.tickets.map((t, i) => { const oa = Math.max(0, t.available - (t.physicalQty ?? 0)); const total = t.total ?? t.available; const lowStock = oa > 0 && total > 0 && oa / total <= 0.25; return <div className="tkt-row" key={i}><div className="tkt-info"><h4>{t.type}</h4>{oa === 0 ? <p>Sold Out</p> : lowStock ? <p style={{color:'var(--red)',fontWeight:700,fontSize:12}}>Almost Gone — Grab Yours Now!</p> : null}</div><div className="tkt-price">{fmtCurrency(t.price)}</div><div className="qty"><button className="qb" disabled={!cart[i]} onClick={() => setCart({ ...cart, [i]: (cart[i]||0)-1 })}>−</button><div className="qv">{cart[i]||0}</div><button className="qb" disabled={(cart[i]||0) >= oa || oa === 0} onClick={() => setCart({ ...cart, [i]: (cart[i]||0)+1 })}>+</button></div></div>; })}
            {cartN > 0 && <div className="cart-sum">{sel.tickets.map((t,i) => cart[i] > 0 && <div className="cart-ln" key={i}><span>{cart[i]}× {t.type}</span><span>{fmtCurrency(cart[i]*t.price)}</span></div>)}<div className="cart-tot"><span>Total</span><span>{fmtCurrency(cartTotal)}</span></div></div>}
            <div style={{background:"var(--bg3)",borderRadius:"var(--rs)",padding:"12px 14px",marginBottom:12,fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
              <span style={{color:"var(--text2)",fontWeight:600}}>Fees:</span> Ticket prices are subject to 6% Idaho sales tax, a $2.00 service fee per ticket, and a payment processing fee (3.5% + $0.30). All fees are itemized at checkout.
              </div>
            <button className="buy" disabled={cartN===0} onClick={async () => {
  if (cartN === 0) return;
  const items = sel.tickets.map((t, i) => ({ qty: cart[i] || 0, ticketTypeId: t.id })).filter(i => i.qty > 0);
  const res = await fetch(API_BASE+'/api/create-payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, eventId: sel.id, tenantId: TENANT_ID }),
  });
  const data = await res.json();
  setClientSecret(data.clientSecret);
  setPaymentAmounts({ ticketTotal: data.ticketTotal, salesTax: data.salesTax, serviceFees: data.serviceFees, processingFee: data.processingFee, grandTotal: data.grandTotal });
  setView("checkout");
}}>{cartN===0 ? "Select Tickets" : `Checkout - ${fmtCurrency(cartTotal + cartN * 2)}`}</button>
          </div>
        </div>}

        {view === "checkout" && sel && clientSecret && (
  <div className="sec fade" style={{ maxWidth: 500 }}>
    <div className="back" onClick={() => setView("detail")}>← Tickets</div>
    <h1 className="dsp" style={{ fontSize: 28, marginBottom: 6 }}>Checkout</h1>
    <p style={{ color: "var(--text2)", marginBottom: 24, fontSize: 13 }}>{sel.title} - {fmtDate(sel.date)}</p>
    <div className="tkt-sec" style={{ marginBottom: 20 }}>
      <h3 className="dsp">Your Info</h3>
      <div className="fg"><label className="fl">Full Name *</label><input className="fi" value={buyer.name} onChange={e => setBuyer({...buyer,name:e.target.value})} placeholder="Jane Doe" />{buyer.name.length > 0 && !nameValid && <p style={{fontSize:11,color:"var(--red)",marginTop:3}}>Please enter your full name.</p>}</div>
      <div className="fr">
        <div className="fg"><label className="fl">Email *</label><input className="fi" type="email" value={buyer.email} onChange={e => setBuyer({...buyer,email:e.target.value})} placeholder="jane@email.com" />{buyer.email.length > 0 && !emailValid && <p style={{fontSize:11,color:"var(--red)",marginTop:3}}>Please enter a valid email.</p>}</div>
        <div className="fg"><label className="fl">Phone</label><input className="fi" type="tel" value={buyer.phone} onChange={e => setBuyer({...buyer,phone:e.target.value})} placeholder="(208) 555-1234" /></div>
      </div>
    </div>
    {buyerReady && (
      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#c8922a', borderRadius: '6px' }}}}>
        <CheckoutForm
        cartTotal={paymentAmounts.ticketTotal}
        totalTickets={Object.values(cart).reduce((a,b) => a+b, 0)}
        paymentAmounts={paymentAmounts}
        onBack={() => setView("detail")}
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
                stripe_payment_intent_id: paymentIntentId,
              })
              .select()
              .single();

            if (orderError) { console.error(orderError); return; }

            const { error: itemsError } = await supabase.from('order_items').insert(
              items.map(i => ({
                order_id: order.id,
                ticket_type_id: i.ticketTypeId,
                ticket_type_name: i.type,
                quantity: i.qty,
                unit_price: i.price,
              }))
            );

            if (itemsError) {
              console.error(itemsError);
              await supabase.from('orders').delete().eq('id', order.id);
              alert(`There was a problem saving your order. Your payment was captured — please email support@c8tickets.com with payment reference: ${paymentIntentId}`);
              return;
            }

            for (const item of items) {
              const { error: soldError } = await supabase.rpc('increment_sold', { tid: item.ticketTypeId, qty: item.qty });
              if (soldError) {
                console.error('increment_sold failed for order', order.id, soldError);
              }
            }

            const localOrder = {
              id: order.id, eventId: sel.id, venueId: venue.id,
              buyer: { ...buyer },
              items: items.map(i => ({ type: i.type, qty: i.qty, price: i.price })),
              ticketTotal: paymentAmounts.ticketTotal,
              salesTax: paymentAmounts.salesTax,
              serviceFees: paymentAmounts.serviceFees,
              processingFee: paymentAmounts.processingFee,
              total: paymentAmounts.grandTotal, date: new Date().toISOString(), checkedIn: false,
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

// Send confirmation email
fetch(API_BASE+'/api/send-confirmation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    order: localOrder,
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
    {!buyerReady && (
      <p style={{ color: "var(--text3)", fontSize: 12, textAlign: "center", marginTop: 10 }}>Enter a valid name and email above to continue to payment.</p>
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
              <div className="qr"><img src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${lastOrder.id}`} alt="Ticket QR Code" width={160} height={160} style={{display:"block"}} /></div>
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
            <button className="buy" style={{marginTop:20}} onClick={goHome}>Browse More Events</button>
          </div>); })()}
        {view === "lookup" && <div className="sec fade" style={{maxWidth:520}}>
          <div className="back" onClick={goHome}>← Back to Events</div>
          <h1 className="dsp" style={{fontSize:28,marginBottom:6}}>Find My Tickets</h1>
          {lookupStep === 'email' && <>
            <p style={{color:"var(--text2)",fontSize:13,marginBottom:24}}>Enter the email address you used when purchasing. We'll send a verification code to confirm it's you.</p>
            <div className="tkt-sec" style={{marginBottom:20}}>
              <div className="fg"><label className="fl">Email Address</label><input className="fi" type="email" value={lookupEmail} onChange={e=>setLookupEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendLookupCode()} placeholder="jane@email.com" /></div>
              <button className="buy" style={{width:"100%",marginTop:10}} disabled={lookupLoading||!lookupEmail} onClick={sendLookupCode}>{lookupLoading?"Sending…":"Send Verification Code"}</button>
            </div>
          </>}
          {lookupStep === 'code' && lookupOrders === null && <>
            <p style={{color:"var(--text2)",fontSize:13,marginBottom:24}}>A 6-digit code was sent to <strong style={{color:"var(--text1)"}}>{lookupEmail}</strong>. Enter it below. It's valid for one hour.</p>
            <div className="tkt-sec" style={{marginBottom:20}}>
              <div className="fg"><label className="fl">Verification Code</label><input className="fi" type="text" inputMode="numeric" maxLength={6} value={lookupCode} onChange={e=>setLookupCode(e.target.value.replace(/\D/g,''))} onKeyDown={e=>e.key==='Enter'&&verifyLookupCode()} placeholder="000000" style={{letterSpacing:6,fontSize:22,textAlign:"center"}} /></div>
              {lookupError && <p style={{fontSize:12,color:"var(--red)",marginTop:6}}>{lookupError}</p>}
              <button className="buy" style={{width:"100%",marginTop:10}} disabled={lookupLoading||lookupCode.length!==6} onClick={verifyLookupCode}>{lookupLoading?"Verifying…":"Access My Tickets"}</button>
              <button style={{width:"100%",marginTop:8,background:"none",border:"none",color:"var(--text3)",fontSize:12,cursor:"pointer",padding:4}} onClick={()=>{setLookupStep('email');setLookupCode('');setLookupError('');}}>Use a different email</button>
            </div>
          </>}
          {lookupOrders !== null && (lookupOrders.length === 0
            ? <div className="empty"><div className="ic">🎫</div><p>No tickets found for that email address.</p></div>
            : lookupOrders.map(o => {
                const ev = events.find(e => e.id === o.event_id);
                return <div key={o.id} className="tkt-disp" style={{marginBottom:20}}>
                  <div className="dsp" style={{fontSize:20,marginBottom:4}}>{ev?.title||"Event"}</div>
                  <div style={{color:"var(--gold)",fontWeight:700,fontSize:12,marginBottom:12,textTransform:"uppercase",letterSpacing:1}}>{ev?fmtDate(ev.date):""}</div>
                  <div style={{marginBottom:12}}>{(o.order_items||[]).map((i,idx)=><div key={idx} style={{fontSize:13,color:"var(--text2)"}}>{i.quantity}× {i.ticket_type_name}</div>)}</div>
                  <span className={`badge ${o.status==="checked_in"?"badge-done":"badge-ok"}`} style={{marginBottom:12,display:"inline-block"}}>{o.status==="checked_in"?"Checked In":"Valid"}</span>
                  <div className="qr"><img src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(o.id)}`} alt="QR Code" width={150} height={150} style={{display:"block"}} /></div>
                  <div className="cid">ID: {o.id.toUpperCase()}</div>
                </div>;
              })
          )}
        </div>}

        {view === "about" && <div className="fade">
          <div className="about-hero">
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
            <p>Reach out and we'll get your events set up — usually the same day.</p>
            <a href="mailto:support@c8tickets.com">support@c8tickets.com</a>
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
  <div className="back" onClick={() => setView("login")}>← Back to Login</div>
  <h1 className="dsp" style={{ fontSize: 28, marginBottom: 6 }}>Reset Password</h1>
  <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 24 }}>Enter your email and we'll send you a reset link.</p>
  <div className="tkt-sec">
    {!resetSent ? <>
      <div className="fg">
        <label className="fl">Email</label>
        <input className="fi" type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder="your@email.com" />
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
      <label className="fl">New Password</label>
      <input className="fi" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Minimum 6 characters" />
    </div>
    <button className="buy" onClick={() => { if (newPassword.length >= 6) { updatePassword(newPassword); setNewPassword(''); } }}>Update Password</button>
  </div>
</div>}
        {view === "login" && <div className="sec fade" style={{ maxWidth: 400, paddingTop: 60 }}>
  <h1 className="dsp" style={{ fontSize: 28, marginBottom: 6 }}>Staff Login</h1>
  <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 24 }}>Enter your staff credentials</p>
  <div className="tkt-sec">
    <div className="fg">
      <label className="fl">Email</label>
      <input className="fi" type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="admin@crooked8.com" />
    </div>
    <div className="fg">
      <label className="fl">Password</label>
      <input className="fi" type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="••••••••" />
    </div>
    {authError && <p style={{ color: "var(--red)", fontSize: 12, marginBottom: 10 }}>{authError}</p>}
    <button className="buy" onClick={login}>Sign In</button>
<button className="btn" style={{width:"100%",marginTop:8}} onClick={() => setView("forgot")}>Forgot Password?</button>
  </div>
</div>}
        {view === "gate" && <GateView events={events} onLogout={logout} />}

        {view === "admin" && <div className="admin fade">
          <div className="aside">{["dashboard","events","orders","check-in","door","live","reports"].map(t => <button key={t} className={`aside-btn ${aTab===t?"on":""}`} onClick={() => setATab(t)}>{t==="dashboard"?"📊 ":t==="events"?"🎫 ":t==="orders"?"📋 ":t==="check-in"?"✅ ":t==="door"?"🏪 ":t==="live"?"📡 ":"📈 "}{t==="check-in"?"Check-In":t==="door"?"Door Sales":t==="reports"?"Reports":t.charAt(0).toUpperCase()+t.slice(1)}</button>)}</div>
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
              <div className="sg"><div className="sc"><div className="l">Venue Revenue</div><div className="v gd">{venueRev===0?"$0":"$"+venueRev.toFixed(2)}</div><div className="s">Owed to organizer</div></div>{!isVenueUser&&<><div className="sc"><div className="l">My Revenue</div><div className="v gd">{serviceFees===0?"$0":"$"+serviceFees.toFixed(2)}</div><div className="s">Service fees</div></div><div className="sc"><div className="l">Processing Fees</div><div className="v">{processingFees===0?"$0":"$"+processingFees.toFixed(2)}</div><div className="s">Remit to Stripe</div></div><div className="sc"><div className="l">Sales Tax</div><div className="v">{salesTax===0?"$0":"$"+salesTax.toFixed(2)}</div><div className="s">Remit to Idaho</div></div></>}<div className="sc"><div className="l">Tickets Sold</div><div className="v">{tix}</div></div><div className="sc"><div className="l">Orders</div><div className="v">{vo.length}</div></div><div className="sc"><div className="l">Checked In</div><div className="v">{ci}</div><div className="s">{vo.length>0?Math.round(ci/vo.length*100):0}%</div></div><div className="sc"><div className="l">Active Events</div><div className="v">{vEvents.length}</div></div></div>
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
                return <div style={{overflowX:"auto",marginBottom:28}}><table className="dt"><thead><tr><th>Event</th><th>Date</th><th>Orders</th><th>Tickets</th><th>Venue Rev</th>{!isVenueUser&&<><th>My Rev</th><th>Processing</th><th>Tax</th></>}<th>Check-in</th></tr></thead><tbody>{evRows.map(({ev,eo,etix,erev,etax,esvc,eproc,eci})=><tr key={ev.id}><td style={{fontWeight:600}}>{ev.title}</td><td style={{fontSize:11}}>{fmtDate(ev.date)}</td><td>{eo.length}</td><td>{etix}</td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(erev)}</td>{!isVenueUser&&<><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(esvc)}</td><td style={{fontSize:12}}>{fmtCurrency(eproc)}</td><td style={{fontSize:12}}>{fmtCurrency(etax)}</td></>}<td style={{fontSize:12}}>{eo.length>0?Math.round(eci/eo.length*100):0}%</td></tr>)}</tbody></table></div>;
              })()}
              <h3 className="dsp" style={{fontSize:20,marginBottom:14}}>Recent Orders</h3>
              {vo.length===0?<div className="empty"><div className="ic">📭</div><p>No orders yet.</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th>Order</th><th>Buyer</th><th>Event</th><th>Total</th><th>Status</th></tr></thead><tbody>{vo.slice(-10).reverse().map(o=>{const ev=events.find(e=>e.id===o.eventId);return <tr key={o.id}><td style={{fontFamily:"monospace",fontSize:11}}>{o.id.slice(0,12)}</td><td>{o.buyer.name}</td><td>{ev?.title||"—"}</td><td style={{fontWeight:700}}>{fmtCurrency(o.total)}</td><td><span className={`badge ${o.checkedIn?"badge-done":"badge-ok"}`}>{o.checkedIn?"Checked In":"Valid"}</span></td></tr>})}</tbody></table></div>}
            </>; })()}

            {aTab === "events" && <><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}><h2 className="dsp" style={{fontSize:26}}>Manage Events</h2><button className="btn gold" onClick={()=>{setEditEvt(blank());setModal(true);}}>+ New Event</button></div>
              {vEvents.length===0?<div className="empty"><div className="ic">🎫</div><p>No events.</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th>Event</th><th>Date</th><th>Category</th><th>Remaining</th><th>Status</th><th>Actions</th></tr></thead><tbody>{vEvents.map(ev=><tr key={ev.id}><td style={{fontWeight:600}}>{ev.title}</td><td>{fmtDate(ev.date)}</td><td>{ev.category}</td><td>{ev.tickets.reduce((s,t)=>s+t.available,0)}</td><td><span className={`badge ${ev.published!==false?"badge-ok":"badge-sold"}`}>{ev.published!==false?"Live":"Hidden"}</span></td><td style={{display:"flex",gap:6}}><button className="btn" style={{fontSize:11,padding:"5px 10px"}} onClick={()=>{setEditEvt({...ev});setModal(true);}}>Edit</button><button className="btn" style={{fontSize:11,padding:"5px 10px",color:ev.published!==false?"var(--text2)":"var(--gold)"}} onClick={()=>togglePublish(ev)}>{ev.published!==false?"Unpublish":"Publish"}</button>{ev.tickets.some(t=>(t.physicalQty??0)>0)&&<><button className="btn gold" style={{fontSize:11,padding:"5px 10px"}} disabled={!!generatingPhysical} onClick={()=>generatePhysicalTickets(ev)}>{generatingPhysical===ev.id?"Generating…":"🖨 Print"}</button><button className="btn gold" style={{fontSize:11,padding:"5px 10px"}} disabled={!!generatingPhysical} onClick={()=>generatePhotoTickets(ev)}>{generatingPhysical===ev.id+'-photo'?"Generating…":"📸 Photo PDF"}</button></>}<button className="btn" style={{fontSize:11,padding:"5px 10px",color:"var(--red)"}} onClick={()=>{ if (window.confirm(`Delete "${ev.title}"? This cannot be undone.`)) delEvt(ev.id); }}>Delete</button></td></tr>)}</tbody></table></div>}</>}

            {aTab === "orders" && (()=>{
              const vo=orders.filter(o=>o.venueId===venue.id);
              const q=orderSearch.toLowerCase().trim();
              const fo=q?vo.filter(o=>{const ev=events.find(e=>e.id===o.eventId);return o.buyer.name.toLowerCase().includes(q)||o.buyer.email.toLowerCase().includes(q)||(ev?.title||'').toLowerCase().includes(q);}):vo;
              return <>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
                  <h2 className="dsp" style={{fontSize:26}}>All Orders</h2>
                  <input className="fi" style={{maxWidth:260,margin:0}} placeholder="Search name, email, or event…" value={orderSearch} onChange={e=>setOrderSearch(e.target.value)} />
                </div>
                {fo.length===0?<div className="empty"><div className="ic">📋</div><p>{q?"No matching orders.":"No orders."}</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th>Order</th><th>Date</th><th>Buyer</th><th>Email</th><th>Event</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>{fo.slice().reverse().map(o=>{const ev=events.find(e=>e.id===o.eventId);const cancelled=o.status==='cancelled';return <tr key={o.id} style={{opacity:cancelled?.5:1}}><td style={{fontFamily:"monospace",fontSize:11}}>{o.id.slice(0,12)}</td><td style={{fontSize:11}}>{new Date(o.date).toLocaleDateString()}<br/><span style={{color:"var(--text3)"}}>{new Date(o.date).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}</span></td><td>{o.buyer.name}</td><td style={{fontSize:11}}>{o.buyer.email}</td><td>{ev?.title||"—"}</td><td style={{fontSize:11}}>{o.items.map(i=>`${i.qty}× ${i.type}`).join(", ")}</td><td style={{fontWeight:700}}>{fmtCurrency(o.total)}</td><td><span className={`badge ${cancelled?'badge-cancelled':o.checkedIn?'badge-done':'badge-ok'}`}>{cancelled?'Cancelled':o.checkedIn?'Checked In':'Valid'}</span></td><td style={{display:"flex",gap:4}}>{!cancelled&&<><button className="btn" style={{fontSize:11,padding:"4px 8px"}} onClick={()=>resendEmail(o)}>Resend</button><button className="btn" style={{fontSize:11,padding:"4px 8px",color:"var(--red)"}} onClick={()=>cancelOrder(o)}>Cancel</button></>}</td></tr>;})}</tbody></table></div>}
              </>; })()}

            {aTab === "check-in" && (()=>{ const vo=orders.filter(o=>o.venueId===venue.id); return <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,flexWrap:"wrap",gap:10}}>
                <h2 className="dsp" style={{fontSize:26}}>Check-In</h2>
                {!adminScan && <button className="btn gold" onClick={()=>{setAdminScan(true);setScanMsg(null);}}>📷 Scan Ticket</button>}
              </div>
              {adminScan && <div style={{marginBottom:16,maxWidth:400}}>
                <ScannerWidget scannerId="admin-scanner" onResult={handleAdminScan} />
                <button className="btn" style={{width:"100%",marginTop:8}} onClick={()=>setAdminScan(false)}>Cancel</button>
              </div>}
              {scanMsg && <div style={{marginBottom:16,padding:"10px 14px",borderRadius:"var(--rs)",background:scanMsg.ok?"rgba(93,138,60,.15)":"rgba(179,58,42,.15)",color:scanMsg.ok?"var(--green)":"var(--red)",fontSize:13,fontWeight:600}}>{scanMsg.text}</div>}
              <p style={{color:"var(--text2)",fontSize:13,marginBottom:20}}>Or manually mark attendees below.</p>
              {vo.length===0?<div className="empty"><div className="ic">✅</div><p>No tickets.</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th>Order</th><th>Name</th><th>Event</th><th>Tickets</th><th>Status</th><th></th></tr></thead><tbody>{vo.map(o=>{const ev=events.find(e=>e.id===o.eventId);return <tr key={o.id}><td style={{fontFamily:"monospace",fontSize:11}}>{o.id.slice(0,10)}</td><td>{o.buyer.name}</td><td>{ev?.title||"—"}</td><td style={{fontSize:11}}>{o.items.map(i=>`${i.qty}× ${i.type}`).join(", ")}</td><td><span className={`badge ${o.checkedIn?"badge-done":"badge-ok"}`}>{o.checkedIn?"Checked In":"Valid"}</span></td><td><button className={`ci-btn ${o.checkedIn?"dn":""}`} disabled={o.checkedIn} onClick={()=>checkin(o.id)}>{o.checkedIn?"Done":"Check In"}</button></td></tr>})}</tbody></table></div>}
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

              const avgOrderTotal=vo.length>0?vo.reduce((s,o)=>s+o.total,0)/vo.length:0;
              const avgVenueRev=vo.length>0?vo.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0)/vo.length:0;
              const evAvgRows=vEvents.map(ev=>{const eo=vo.filter(o=>o.eventId===ev.id);if(!eo.length)return null;return{ev,count:eo.length,avg:eo.reduce((s,o)=>s+o.total,0)/eo.length,avgRev:eo.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0)/eo.length,avgTix:eo.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0)/eo.length};}).filter(Boolean);

              const buyerMap={};
              for(const o of vo){const key=(o.buyer.email||'').toLowerCase().trim()||o.buyer.name;if(!buyerMap[key])buyerMap[key]={email:o.buyer.email,name:o.buyer.name,orders:0,total:0,tix:0};buyerMap[key].orders++;buyerMap[key].total+=o.total;buyerMap[key].tix+=o.items.reduce((s,i)=>s+i.qty,0);}
              const repeatBuyers=Object.values(buyerMap).filter(b=>b.orders>=2).sort((a,b)=>b.orders-a.orders);

              const ciTypeMap={};
              for(const o of vo){for(const item of o.items){if(!ciTypeMap[item.type])ciTypeMap[item.type]={sold:0,checkedIn:0};ciTypeMap[item.type].sold+=item.qty;if(o.checkedIn)ciTypeMap[item.type].checkedIn+=item.qty;}}
              const ciTypeRows=Object.entries(ciTypeMap).sort((a,b)=>b[1].sold-a[1].sold);

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

                <h3 className="dsp" style={{fontSize:18,marginBottom:12}}>Ticket Type Breakdown</h3>
                {typeRows.length===0
                  ?<div className="empty" style={{marginBottom:28}}><p>No ticket sales in this period.</p></div>
                  :<div style={{overflowX:"auto",marginBottom:32}}><table className="dt"><thead><tr><th>Ticket Type</th><th>Qty Sold</th><th>% of Sales</th><th>Revenue</th></tr></thead><tbody>{typeRows.map(([type,d])=>{const pct=totalTix>0?Math.round(d.qty/totalTix*100):0;return<tr key={type}><td style={{fontWeight:600}}>{type}</td><td>{d.qty}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:80}}><div style={{height:"100%",width:pct+"%",background:"var(--gold)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right"}}>{pct}%</span></div></td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(d.rev)}</td></tr>;})}</tbody></table></div>
                }

                <h3 className="dsp" style={{fontSize:18,marginBottom:12}}>Average Order Value</h3>
                <div className="sg" style={{marginBottom:evAvgRows.length?16:32}}>
                  <div className="sc"><div className="l">Avg Total per Order</div><div className="v gd">{vo.length>0?"$"+avgOrderTotal.toFixed(2):"—"}</div></div>
                  <div className="sc"><div className="l">Avg Venue Rev per Order</div><div className="v gd">{vo.length>0?"$"+avgVenueRev.toFixed(2):"—"}</div></div>
                  <div className="sc"><div className="l">Total Orders</div><div className="v">{vo.length}</div></div>
                </div>
                {evAvgRows.length>0&&<div style={{overflowX:"auto",marginBottom:32}}><table className="dt"><thead><tr><th>Event</th><th>Orders</th><th>Avg Tix/Order</th><th>Avg Venue Rev</th><th>Avg Total</th></tr></thead><tbody>{evAvgRows.map(({ev,count,avg,avgRev,avgTix})=><tr key={ev.id}><td style={{fontWeight:600}}>{ev.title}</td><td>{count}</td><td>{avgTix.toFixed(1)}</td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(avgRev)}</td><td style={{fontWeight:700}}>{fmtCurrency(avg)}</td></tr>)}</tbody></table></div>}

                <h3 className="dsp" style={{fontSize:18,marginBottom:12}}>Check-In Rate by Ticket Type</h3>
                {ciTypeRows.length===0
                  ?<div className="empty" style={{marginBottom:28}}><p>No data for this period.</p></div>
                  :<div style={{overflowX:"auto",marginBottom:32}}><table className="dt"><thead><tr><th>Ticket Type</th><th>Sold</th><th>Checked In</th><th>Rate</th></tr></thead><tbody>{ciTypeRows.map(([type,d])=>{const pct=d.sold>0?Math.round(d.checkedIn/d.sold*100):0;return<tr key={type}><td style={{fontWeight:600}}>{type}</td><td>{d.sold}</td><td>{d.checkedIn}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:80}}><div style={{height:"100%",width:pct+"%",background:"var(--green)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right"}}>{pct}%</span></div></td></tr>;})}</tbody></table></div>
                }

                <h3 className="dsp" style={{fontSize:18,marginBottom:6}}>Repeat Buyers</h3>
                <p style={{color:"var(--text3)",fontSize:12,marginBottom:12}}>Buyers with 2 or more orders in this period.</p>
                {repeatBuyers.length===0
                  ?<div className="empty" style={{marginBottom:28}}><p>No repeat buyers in this period.</p></div>
                  :<div style={{overflowX:"auto",marginBottom:28}}><table className="dt"><thead><tr><th>Buyer</th><th>Email</th><th>Orders</th><th>Tickets</th><th>Total Spent</th></tr></thead><tbody>{repeatBuyers.map((b,i)=><tr key={i}><td style={{fontWeight:600}}>{b.name}</td><td style={{fontSize:12}}>{b.email}</td><td style={{color:"var(--gold)",fontWeight:700}}>{b.orders}</td><td>{b.tix}</td><td style={{fontWeight:700}}>{fmtCurrency(b.total)}</td></tr>)}</tbody></table></div>
                }
              </>;
            })()}
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
      <footer className="footer">
          <div className="footer-links">
            <a href="#" onClick={e => { e.preventDefault(); setView("home"); }}>Events</a>
            <a href="#" onClick={e => { e.preventDefault(); setView("about"); }}>About C8Tickets</a>
            <a href="#" onClick={e => { e.preventDefault(); setLookupEmail(''); setLookupOrders(null); setLookupStep('email'); setLookupCode(''); setLookupError(''); setView("lookup"); }}>Find My Tickets</a>
            <a href="#" onClick={e => { e.preventDefault(); setView("terms"); }}>Terms of Service</a>
            <a href="#" onClick={e => { e.preventDefault(); setView("privacy"); }}>Privacy Policy</a>
            <a href="mailto:support@c8tickets.com">Contact Support</a>
          </div>
          <div className="footer-copy">Copyright 2026 C8Tickets - Kuna, Idaho - All rights reserved</div>
        </footer>
      </div>
    </>
    );
}