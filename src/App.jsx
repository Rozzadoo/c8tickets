import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from './lib/supabase';
import { CROOKED_8_TENANT_ID } from './constants';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

// ── Logo as base64 PNG with transparency ──
const LOGO_SRC = "/logo.jpg";
// ── Data & Storage ──
const DEFAULT_VENUE = {
  id: "crooked8", name: "Crooked 8",
  tagline: "Local Events. Easy Tickets.",
  location: "1882 E King Rd, Kuna, ID 83634",
  phone: "(208) 991-0788",
};

const mapEvent = (e) => ({
  id: e.id,
  venueId: "crooked8",
  title: e.title,
  date: e.event_date.slice(0, 10),
  time: new Date(e.event_date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  doors: e.doors_open ? new Date(e.doors_open).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
  description: e.description,
  image: e.image_url,
  category: e.category,
  tickets: (e.ticket_types || []).map(t => ({
    id: t.id,
    type: t.name,
    price: Number(t.price),
    available: t.quantity_total - t.quantity_sold,
  }))
});

const useStorage = () => {
  const [venues, setVenues] = useState([DEFAULT_VENUE]);
  const [events, setEvents] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: venueData } = await supabase
  .from('tenants')
  .select('*')
  .eq('id', CROOKED_8_TENANT_ID)
  .single();

if (venueData) {
  setVenues([{
    id: "crooked8",
    name: venueData.name,
    tagline: "Boise's Most Exciting Event & Concert Venue",
    location: "1882 E King Rd, Kuna, ID 83634",
    phone: venueData.contact_phone || "",
    email: venueData.contact_email || "",
    website: venueData.website || "",
  }]);
}
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*, ticket_types(*)')
        .eq('tenant_id', CROOKED_8_TENANT_ID)
        .eq('is_published', true)
        .order('event_date', { ascending: true });

      if (eventsError) console.error(eventsError);
      else setEvents((eventsData || []).map(mapEvent));

      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('tenant_id', CROOKED_8_TENANT_ID);

      if (ordersError) console.error(ordersError);
      else setOrders((ordersData || []).map(o => ({
        id: o.id,
        eventId: o.event_id,
        venueId: "crooked8",
        buyer: { name: o.buyer_name, email: o.buyer_email, phone: o.buyer_phone || "" },
        items: (o.order_items || []).map(i => ({ type: i.ticket_type_name, qty: i.quantity, price: Number(i.unit_price) })),
        total: Number(o.total_amount),
        date: o.created_at,
        checkedIn: o.status === 'checked_in',
      })));

      setLoaded(true);
    };
    load();
  }, []);

  const updateEvents = useCallback((d) => setEvents(d), []);
  const updateOrders = useCallback((d) => setOrders(d), []);

  return { venues, events, orders, loaded, updateEvents, updateOrders };
};

const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtCurrency = (n) => n === 0 ? "FREE" : "$" + Number(n).toFixed(2);
const genId = () => "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
body{background:var(--bg);color:var(--text);font-family:'Barlow',sans-serif;-webkit-font-smoothing:antialiased}
.app{min-height:100vh;display:flex;flex-direction:column}
.dsp{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:1.5px;font-weight:700}

.nav{display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:var(--bg2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100;backdrop-filter:blur(12px)}
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
.hero-logo{height:80px;filter:invert(1);opacity:.9;margin-bottom:12px}
.hero p{color:var(--text2);font-size:15px;font-weight:300;letter-spacing:.3px}
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
.tag{display:inline-block;padding:2px 9px;border-radius:99px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:rgba(200,146,42,.15);color:var(--gold)}

.admin{display:grid;grid-template-columns:200px 1fr;min-height:calc(100vh - 61px)}
@media(max-width:768px){.admin{grid-template-columns:1fr}}
.aside{background:var(--bg2);border-right:1px solid var(--border);padding:20px 14px;display:flex;flex-direction:column;gap:3px}
@media(max-width:768px){.aside{flex-direction:row;overflow-x:auto;padding:10px;border-right:none;border-bottom:1px solid var(--border)}}
.aside-btn{padding:9px 14px;border-radius:var(--rs);border:none;background:transparent;color:var(--text2);cursor:pointer;font-family:'Barlow',sans-serif;font-size:13px;text-align:left;transition:all .15s;white-space:nowrap;font-weight:500}
.aside-btn:hover,.aside-btn.on{background:var(--bg3);color:var(--gold)}
.amain{padding:28px;overflow-y:auto}
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
.footer{background:var(--bg2);border-top:1px solid var(--border);padding:28px 20px;text-align:center;margin-top:auto}
.footer-links{display:flex;justify-content:center;gap:20px;flex-wrap:wrap;margin-bottom:12px}
.footer-links a{color:var(--text3);font-size:12px;text-decoration:none;transition:color .2s}
.footer-links a:hover{color:var(--gold)}
.footer-copy{font-size:11px;color:var(--text3)}
.legal{max-width:700px;margin:0 auto;padding:40px 20px;color:var(--text2);line-height:1.8}
.legal h1{font-size:28px;margin-bottom:8px;color:var(--text)}
.legal h2{font-size:16px;margin:28px 0 10px;color:var(--text);text-transform:uppercase;letter-spacing:1px}
.legal p{margin-bottom:14px;font-size:14px}
.legal ul{margin:0 0 14px 20px;font-size:14px}
.legal ul li{margin-bottom:6px}
.legal .date{font-size:12px;color:var(--text3);margin-bottom:28px}
`;

export default function App() {
  const { venues, events, orders, loaded, updateEvents, updateOrders } = useStorage();
  const [view, setView] = useState("home");
  const [selId, setSelId] = useState(null);
  const [cart, setCart] = useState({});
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const [lastOrder, setLastOrder] = useState(null);
  const [aTab, setATab] = useState("dashboard");
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
const [view2, setView2] = useState(null);

  const venue = venues[0] || DEFAULT_VENUE;
  useEffect(() => {
  supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    setSession(session);
    if (_event === 'PASSWORD_RECOVERY') setView('reset');
  });
  return () => subscription.unsubscribe();
}, []);

const login = async () => {
  setAuthError('');
  const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
  if (error) setAuthError(error.message);
  else setView('admin');
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
  const vEvents = events.filter(e => e.venueId === venue.id);
  const CATS = ["All", "Live Music", "Rodeo", "Family", "Other Events"];
  const filtered = filter === "All" ? vEvents : vEvents.filter(e => e.category === filter);
  const sel = events.find(e => e.id === selId);
  const cartTotal = useMemo(() => sel ? sel.tickets.reduce((s, t, i) => s + (cart[i] || 0) * t.price, 0) : 0, [cart, sel]);
  const cartN = Object.values(cart).reduce((a, b) => a + b, 0);

  const open = (id) => { setSelId(id); setCart({}); setView("detail"); };

  const purchase = async () => {
  if (!buyer.name || !buyer.email) return;

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      tenant_id: CROOKED_8_TENANT_ID,
      event_id: sel.id,
      buyer_name: buyer.name,
      buyer_email: buyer.email,
      buyer_phone: buyer.phone,
      status: 'confirmed',
      total_amount: cartTotal,
    })
    .select()
    .single();

  if (orderError) { console.error(orderError); return; }

  const items = sel.tickets
    .map((t, i) => ({ type: t.type, qty: cart[i] || 0, price: t.price, ticketTypeId: t.id }))
    .filter(i => i.qty > 0);

  await supabase.from('order_items').insert(
    items.map(i => ({
      order_id: order.id,
      ticket_type_id: i.ticketTypeId,
      ticket_type_name: i.type,
      quantity: i.qty,
      unit_price: i.price,
    }))
  );

  for (const item of items) {
    await supabase.rpc('increment_sold', { tid: item.ticketTypeId, qty: item.qty });
  }

  const localOrder = {
    id: order.id, eventId: sel.id, venueId: "crooked8",
    buyer: { ...buyer },
    items: items.map(i => ({ type: i.type, qty: i.qty, price: i.price })),
    total: cartTotal, date: new Date().toISOString(), checkedIn: false,
  };
  updateOrders([...orders, localOrder]);
  updateEvents(events.map(ev => ev.id !== sel.id ? ev : {
    ...ev, tickets: ev.tickets.map((t, i) => ({ ...t, available: t.available - (cart[i] || 0) }))
  }));
  setLastOrder(localOrder);
  setView("ticket");
  setBuyer({ name: "", email: "", phone: "" });
  setCart({});
};

  const checkin = async (oid) => {
  await supabase.from('orders').update({ status: 'checked_in' }).eq('id', oid);
  updateOrders(orders.map(o => o.id === oid ? { ...o, checkedIn: true } : o));
  };
  const blank = () => ({ id: null, venueId: venue.id, title: "", date: "", time: "", doors: "", description: "", image: "🎵", category: "Live Music", tickets: [{ type: "General Admission", price: 25, available: 100 }] });
  const saveEvt = async (e) => {
  if (e.id) {
    // Update existing event
    await supabase.from('events').update({
      title: e.title,
      description: e.description,
      category: e.category,
      event_date: e.date + 'T00:00:00',
      doors_open: e.date + 'T00:00:00',
      image_url: e.image,
    }).eq('id', e.id);
    updateEvents(events.map(x => x.id === e.id ? e : x));
  } else {
    // Insert new event
    const { data: newEvt, error } = await supabase.from('events').insert({
      tenant_id: CROOKED_8_TENANT_ID,
      title: e.title,
      description: e.description,
      category: e.category,
      event_date: e.date + 'T00:00:00',
      doors_open: e.date + 'T00:00:00',
      image_url: e.image,
      venue_name: 'Crooked 8',
      is_published: true,
    }).select().single();
    if (error) { console.error(error); return; }
    // Insert ticket types
    await supabase.from('ticket_types').insert(
      e.tickets.map(t => ({
        event_id: newEvt.id,
        name: t.type,
        price: t.price,
        quantity_total: t.available,
        quantity_sold: 0,
      }))
    );
    // Add to local state with real ID
    const mapped = { ...e, id: newEvt.id, venueId: "crooked8" };
    updateEvents([...events, mapped]);
  }
  setModal(false);
  setEditEvt(null);
};
  const delEvt = async (id) => {
  await supabase.from('events').delete().eq('id', id);
  updateEvents(events.filter(e => e.id !== id));
};

  if (!loaded) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0c0a07" }}><img src={LOGO_SRC} alt="Crooked 8" style={{ height: 80, filter: "invert(1)", opacity: .7, animation: "fi .6s ease" }} /></div>;

  return (
    <><style>{CSS}</style>
      <div className="app">
        <nav className="nav">
          <div className="nav-logo" onClick={() => setView("home")} style={{position:"relative"}}>
            <img src={LOGO_SRC} alt="Crooked 8" />
            <div style={{position:"absolute",bottom:-4,left:"50%",transform:"translateX(-50%)",background:"var(--gold)",color:"var(--bg)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:8,letterSpacing:3,textTransform:"uppercase",padding:"2px 6px",borderRadius:2,whiteSpace:"nowrap"}}>TICKETS</div>
            </div>
          <div className="nav-links">
            <button className={`btn ${["home","detail"].includes(view) ? "on" : ""}`} onClick={() => setView("home")}>Events</button>
            {session && <button className={`btn ${view === "admin" ? "on" : ""}`} onClick={() => setView("admin")}>Admin</button>}
            <button className="btn" onClick={() => session ? logout() : setView("login")}>{session ? "Logout" : "Login"}</button>
          </div>
        </nav>

        {view === "home" && <div className="fade">
          <div className="hero">
            <div style={{position:"relative",display:"inline-block",marginBottom:16}}>
              <img src={LOGO_SRC} alt="Crooked 8" className="hero-logo" style={{marginBottom:0}} />
              <div style={{position:"absolute",bottom:-10,left:"50%",transform:"translateX(-50%)",background:"var(--gold)",color:"var(--bg)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:13,letterSpacing:4,textTransform:"uppercase",padding:"3px 14px",borderRadius:2,whiteSpace:"nowrap"}}>TICKETS</div>
              </div>
            <p>{venue.tagline}</p>
            <div className="hero-sub"><span>Questions? <a href="mailto:support@c8tickets.com" style={{color:"var(--text2)"}}>support@c8tickets.com</a></span></div>
          </div>
          <div className="sec">
            <div className="sec-hdr"><div className="sec-title dsp">Upcoming Events</div>
              <div className="filters">{CATS.map(c => <button key={c} className={`chip ${filter === c ? "on" : ""}`} onClick={() => setFilter(c)}>{c}</button>)}</div>
            </div>
            {filtered.length === 0 ? <div className="empty"><div className="ic">📭</div><p>No events in this category</p></div> :
              <div className="grid">{filtered.map(ev => { const mp = Math.min(...ev.tickets.map(t => t.price)); return (
                <div key={ev.id} className="card" onClick={() => open(ev.id)}>
                  <div className="card-img">{ev.image}<div className="card-cat">{ev.category}</div></div>
                  <div className="card-body">
                    <div className="card-date">{fmtDate(ev.date)} - {ev.time}</div>
                    <div className="card-title dsp">{ev.title}</div>
                    <div className="card-desc">{ev.description}</div>
                    <div className="card-foot"><div className="card-price">{fmtCurrency(mp)} {mp > 0 && <small>& up</small>}</div><button className="btn gold" onClick={e => { e.stopPropagation(); open(ev.id); }}>Tickets</button></div>
                  </div>
                </div>); })}</div>}
          </div>
        </div>}

        {view === "detail" && sel && <div className="sec fade" style={{ maxWidth: 800 }}>
          <div className="back" onClick={() => setView("home")}>← Events</div>
          <div className="d-hero">{sel.image}</div>
          <div style={{ marginBottom: 6 }}><span className="tag">{sel.category}</span></div>
          <h1 className="dsp" style={{ fontSize: "clamp(26px,5vw,42px)", marginBottom: 10, lineHeight: 1.1 }}>{sel.title}</h1>
          <div className="d-meta">
  <span>📅 <strong>{fmtDate(sel.date)}</strong></span>
  <span>🕐 <strong>{sel.time}</strong></span>
  <span>🚪 Doors <strong>{sel.doors}</strong></span>
  <span>📍 <strong>{venue.name}</strong> — {venue.location}</span>
  {venue.phone && <span>📞 <strong>{venue.phone}</strong></span>}
  {venue.email && <span>✉️ <a href={`mailto:${venue.email}`} style={{color:"var(--gold)"}}>{venue.email}</a></span>}
  {venue.website && <span>🌐 <a href={venue.website} target="_blank" rel="noopener noreferrer" style={{color:"var(--gold)"}}>{venue.website.replace('https://','')}</a></span>}
</div>
          <p className="d-desc">{sel.description}</p>
          <div className="tkt-sec"><h3 className="dsp">Select Tickets</h3>
            {sel.tickets.map((t, i) => <div className="tkt-row" key={i}><div className="tkt-info"><h4>{t.type}</h4><p>{t.available} left</p></div><div className="tkt-price">{fmtCurrency(t.price)}</div><div className="qty"><button className="qb" disabled={!cart[i]} onClick={() => setCart({ ...cart, [i]: (cart[i]||0)-1 })}>−</button><div className="qv">{cart[i]||0}</div><button className="qb" disabled={(cart[i]||0) >= t.available} onClick={() => setCart({ ...cart, [i]: (cart[i]||0)+1 })}>+</button></div></div>)}
            {cartN > 0 && <div className="cart-sum">{sel.tickets.map((t,i) => cart[i] > 0 && <div className="cart-ln" key={i}><span>{cart[i]}× {t.type}</span><span>{fmtCurrency(cart[i]*t.price)}</span></div>)}<div className="cart-tot"><span>Total</span><span>{fmtCurrency(cartTotal)}</span></div></div>}
            <div style={{background:"var(--bg3)",borderRadius:"var(--rs)",padding:"12px 14px",marginBottom:12,fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
              <span style={{color:"var(--text2)",fontWeight:600}}>Fees:</span> Ticket prices are subject to 6% Idaho sales tax, a $2.00 service fee per ticket, and a payment processing fee (3.5% + $0.30). All fees are itemized at checkout.
              </div>
            <button className="buy" disabled={cartN===0} onClick={async () => {
  if (cartN === 0) return;
  const items = sel.tickets.map((t, i) => ({ qty: cart[i] || 0, price: t.price })).filter(i => i.qty > 0);
  const res = await fetch('/api/create-payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, eventId: sel.id, tenantId: CROOKED_8_TENANT_ID }),
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
      <div className="fg"><label className="fl">Full Name *</label><input className="fi" value={buyer.name} onChange={e => setBuyer({...buyer,name:e.target.value})} placeholder="Jane Doe" /></div>
      <div className="fr">
        <div className="fg"><label className="fl">Email *</label><input className="fi" type="email" value={buyer.email} onChange={e => setBuyer({...buyer,email:e.target.value})} placeholder="jane@email.com" /></div>
        <div className="fg"><label className="fl">Phone</label><input className="fi" type="tel" value={buyer.phone} onChange={e => setBuyer({...buyer,phone:e.target.value})} placeholder="(208) 555-1234" /></div>
      </div>
    </div>
    {buyer.name && buyer.email && (
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
                tenant_id: CROOKED_8_TENANT_ID,
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

            await supabase.from('order_items').insert(
              items.map(i => ({
                order_id: order.id,
                ticket_type_id: i.ticketTypeId,
                ticket_type_name: i.type,
                quantity: i.qty,
                unit_price: i.price,
              }))
            );

            for (const item of items) {
              await supabase.rpc('increment_sold', { tid: item.ticketTypeId, qty: item.qty });
            }

            const localOrder = {
              id: order.id, eventId: sel.id, venueId: "crooked8",
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
fetch('/api/send-confirmation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    order: localOrder,
    event: {
      title: sel.title,
      date: fmtDate(sel.date),
      time: sel.time,
      doors: sel.doors,
      category: sel.category,
    },
  }),
}).catch(err => console.error('Email error:', err));
          }}
        />
      </Elements>
    )}
    {(!buyer.name || !buyer.email) && (
      <p style={{ color: "var(--text3)", fontSize: 12, textAlign: "center", marginTop: 10 }}>Fill in your name and email above to continue to payment.</p>
    )}
  </div>
)}

        {view === "ticket" && lastOrder && (() => { const ev = events.find(e => e.id === lastOrder.eventId); return (
          <div className="sec fade" style={{ maxWidth: 500 }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}><div style={{fontSize:40,marginBottom:6}}>🎉</div><h1 className="dsp" style={{fontSize:28}}>You're In!</h1><p style={{color:"var(--text2)",fontSize:13}}>Show this QR code at the gate</p></div>
            <div className="tkt-disp">
              <div className="dsp" style={{fontSize:22,marginBottom:3}}>{ev?.title}</div>
              <div style={{color:"var(--gold)",fontWeight:700,fontSize:13,marginBottom:14,textTransform:"uppercase",letterSpacing:1}}>{ev ? fmtDate(ev.date) : ""} - {ev?.time}</div>
              <div><span className="badge badge-ok">✓ Valid</span></div>
              <div className="qr"><QRCode value={lastOrder.id} size={160} /></div>
              <div className="cid">ID: {lastOrder.id.toUpperCase()}</div>
              <ul className="tkt-items">
                {lastOrder.items.map((it,i) => <li key={i}><span>{it.qty}× {it.type}</span><span>{fmtCurrency(it.qty*it.price)}</span></li>)}
                {lastOrder.salesTax > 0 && <li><span>Sales Tax (6%)</span><span>${Number(lastOrder.salesTax).toFixed(2)}</span></li>}
                {lastOrder.serviceFees > 0 && <li><span>Service Fees</span><span>{fmtCurrency(lastOrder.serviceFees)}</span></li>}
                {lastOrder.processingFee > 0 && <li><span>Processing Fee</span><span>${Number(lastOrder.processingFee).toFixed(2)}</span></li>}
                <li style={{fontWeight:700,color:"var(--text)",borderTop:"1px solid var(--bg4)",paddingTop:6,marginTop:6}}><span>Total</span><span>{fmtCurrency(lastOrder.total)}</span></li>
                </ul>
              <p style={{fontSize:11,color:"var(--text3)",marginTop:10}}>{lastOrder.buyer.name} - {lastOrder.buyer.email}<br/>Crooked 8 - {venue.location}</p>
            </div>
            <button className="buy" style={{marginTop:20}} onClick={() => setView("home")}>Browse More Events</button>
          </div>); })()}
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
      <input className="fi" type="password" id="newpw" placeholder="Minimum 6 characters" />
    </div>
    <button className="buy" onClick={() => {
      const pw = document.getElementById('newpw').value;
      if (pw.length >= 6) updatePassword(pw);
    }}>Update Password</button>
  </div>
</div>}
        {view === "login" && <div className="sec fade" style={{ maxWidth: 400, paddingTop: 60 }}>
  <h1 className="dsp" style={{ fontSize: 28, marginBottom: 6 }}>Admin Login</h1>
  <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 24 }}>Crooked 8 staff only</p>
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
        {view === "admin" && <div className="admin fade">
          <div className="aside">{["dashboard","events","orders","check-in"].map(t => <button key={t} className={`aside-btn ${aTab===t?"on":""}`} onClick={() => setATab(t)}>{t==="dashboard"?"📊 ":t==="events"?"🎫 ":t==="orders"?"📋 ":"✅ "}{t.charAt(0).toUpperCase()+t.slice(1)}</button>)}</div>
          <div className="amain">
            {aTab === "dashboard" && (() => { const vo=orders.filter(o=>o.venueId===venue.id),rev=vo.reduce((s,o)=>s+o.total,0),tix=vo.reduce((s,o)=>s+o.items.reduce((a,b)=>a+b.qty,0),0),ci=vo.filter(o=>o.checkedIn).length; return <>
              <h2 className="dsp" style={{fontSize:26,marginBottom:20}}>Dashboard</h2>
              <div className="sg"><div className="sc"><div className="l">Revenue</div><div className="v gd">{rev===0?"$0":"$"+rev.toFixed(2)}</div></div><div className="sc"><div className="l">Tickets Sold</div><div className="v">{tix}</div></div><div className="sc"><div className="l">Orders</div><div className="v">{vo.length}</div></div><div className="sc"><div className="l">Checked In</div><div className="v">{ci}</div><div className="s">{vo.length>0?Math.round(ci/vo.length*100):0}%</div></div><div className="sc"><div className="l">Active Events</div><div className="v">{vEvents.length}</div></div></div>
              <h3 className="dsp" style={{fontSize:20,marginBottom:14}}>Recent Orders</h3>
              {vo.length===0?<div className="empty"><div className="ic">📭</div><p>No orders yet.</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th>Order</th><th>Buyer</th><th>Event</th><th>Total</th><th>Status</th></tr></thead><tbody>{vo.slice(-10).reverse().map(o=>{const ev=events.find(e=>e.id===o.eventId);return <tr key={o.id}><td style={{fontFamily:"monospace",fontSize:11}}>{o.id.slice(0,12)}</td><td>{o.buyer.name}</td><td>{ev?.title||"—"}</td><td style={{fontWeight:700}}>{fmtCurrency(o.total)}</td><td><span className={`badge ${o.checkedIn?"badge-done":"badge-ok"}`}>{o.checkedIn?"Checked In":"Valid"}</span></td></tr>})}</tbody></table></div>}
            </>; })()}

            {aTab === "events" && <><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}><h2 className="dsp" style={{fontSize:26}}>Manage Events</h2><button className="btn gold" onClick={()=>{setEditEvt(blank());setModal(true);}}>+ New Event</button></div>
              {vEvents.length===0?<div className="empty"><div className="ic">🎫</div><p>No events.</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th>Event</th><th>Date</th><th>Category</th><th>Remaining</th><th>Actions</th></tr></thead><tbody>{vEvents.map(ev=><tr key={ev.id}><td style={{fontWeight:600}}>{ev.image} {ev.title}</td><td>{fmtDate(ev.date)}</td><td>{ev.category}</td><td>{ev.tickets.reduce((s,t)=>s+t.available,0)}</td><td style={{display:"flex",gap:6}}><button className="btn" style={{fontSize:11,padding:"5px 10px"}} onClick={()=>{setEditEvt({...ev});setModal(true);}}>Edit</button><button className="btn" style={{fontSize:11,padding:"5px 10px",color:"var(--red)"}} onClick={()=>delEvt(ev.id)}>Delete</button></td></tr>)}</tbody></table></div>}</>}

            {aTab === "orders" && (()=>{ const vo=orders.filter(o=>o.venueId===venue.id); return <><h2 className="dsp" style={{fontSize:26,marginBottom:20}}>All Orders</h2>{vo.length===0?<div className="empty"><div className="ic">📋</div><p>No orders.</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th>Order</th><th>Date</th><th>Buyer</th><th>Email</th><th>Event</th><th>Items</th><th>Total</th></tr></thead><tbody>{vo.slice().reverse().map(o=>{const ev=events.find(e=>e.id===o.eventId);return <tr key={o.id}><td style={{fontFamily:"monospace",fontSize:11}}>{o.id.slice(0,12)}</td><td style={{fontSize:11}}>{new Date(o.date).toLocaleDateString()}</td><td>{o.buyer.name}</td><td style={{fontSize:11}}>{o.buyer.email}</td><td>{ev?.title||"—"}</td><td style={{fontSize:11}}>{o.items.map(i=>`${i.qty}× ${i.type}`).join(", ")}</td><td style={{fontWeight:700}}>{fmtCurrency(o.total)}</td></tr>})}</tbody></table></div>}</>; })()}

            {aTab === "check-in" && (()=>{ const vo=orders.filter(o=>o.venueId===venue.id); return <><h2 className="dsp" style={{fontSize:26,marginBottom:6}}>Check-In</h2><p style={{color:"var(--text2)",fontSize:13,marginBottom:20}}>Mark attendees as arrived at the gate.</p>{vo.length===0?<div className="empty"><div className="ic">✅</div><p>No tickets.</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th>Order</th><th>Name</th><th>Event</th><th>Tickets</th><th>Status</th><th></th></tr></thead><tbody>{vo.map(o=>{const ev=events.find(e=>e.id===o.eventId);return <tr key={o.id}><td style={{fontFamily:"monospace",fontSize:11}}>{o.id.slice(0,10)}</td><td>{o.buyer.name}</td><td>{ev?.title||"—"}</td><td style={{fontSize:11}}>{o.items.map(i=>`${i.qty}× ${i.type}`).join(", ")}</td><td><span className={`badge ${o.checkedIn?"badge-done":"badge-ok"}`}>{o.checkedIn?"Checked In":"Valid"}</span></td><td><button className={`ci-btn ${o.checkedIn?"dn":""}`} disabled={o.checkedIn} onClick={()=>checkin(o.id)}>{o.checkedIn?"Done":"Check In"}</button></td></tr>})}</tbody></table></div>}</>; })()}
          </div>
        </div>}

        {modal && editEvt && <div className="modal-bg" onClick={()=>setModal(false)}><div className="modal" onClick={e=>e.stopPropagation()}>
          <h2 className="dsp">{events.find(e=>e.id===editEvt.id)?"Edit Event":"New Event"}</h2>
          <div className="fg"><label className="fl">Title</label><input className="fi" value={editEvt.title} onChange={e=>setEditEvt({...editEvt,title:e.target.value})} placeholder="e.g. Neon Rodeo Night"/></div>
          <div className="fr"><div className="fg"><label className="fl">Date</label><input className="fi" type="date" value={editEvt.date} onChange={e=>setEditEvt({...editEvt,date:e.target.value})}/></div><div className="fg"><label className="fl">Show Time</label><input className="fi" value={editEvt.time} onChange={e=>setEditEvt({...editEvt,time:e.target.value})} placeholder="7:00 PM"/></div></div>
          <div className="fr"><div className="fg"><label className="fl">Doors</label><input className="fi" value={editEvt.doors} onChange={e=>setEditEvt({...editEvt,doors:e.target.value})} placeholder="6:00 PM"/></div><div className="fg"><label className="fl">Category</label><select className="fi" value={editEvt.category} onChange={e=>setEditEvt({...editEvt,category:e.target.value})}>{["Live Music","Rodeo","Family","Other Events"].map(c=><option key={c} value={c}>{c}</option>)}</select></div></div>
          <div className="fg"><label className="fl">Emoji</label><input className="fi" value={editEvt.image} onChange={e=>setEditEvt({...editEvt,image:e.target.value})} placeholder="🎵" style={{maxWidth:80}}/></div>
          <div className="fg"><label className="fl">Description</label><textarea className="fi" rows={3} value={editEvt.description} onChange={e=>setEditEvt({...editEvt,description:e.target.value})} placeholder="What should people expect?"/></div>
          <h3 className="dsp" style={{fontSize:16,margin:"16px 0 10px"}}>Ticket Tiers</h3>
          {editEvt.tickets.map((t,i)=><div key={i} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr auto",gap:6,marginBottom:6,alignItems:"end"}}><div className="fg" style={{margin:0}}>{i===0&&<label className="fl">Type</label>}<input className="fi" value={t.type} onChange={e=>{const x=[...editEvt.tickets];x[i]={...x[i],type:e.target.value};setEditEvt({...editEvt,tickets:x})}}/></div><div className="fg" style={{margin:0}}>{i===0&&<label className="fl">Price</label>}<input className="fi" type="number" value={t.price} onChange={e=>{const x=[...editEvt.tickets];x[i]={...x[i],price:+e.target.value};setEditEvt({...editEvt,tickets:x})}}/></div><div className="fg" style={{margin:0}}>{i===0&&<label className="fl">Qty</label>}<input className="fi" type="number" value={t.available} onChange={e=>{const x=[...editEvt.tickets];x[i]={...x[i],available:+e.target.value};setEditEvt({...editEvt,tickets:x})}}/></div><button className="qb" onClick={()=>{const x=editEvt.tickets.filter((_,j)=>j!==i);setEditEvt({...editEvt,tickets:x.length?x:[{type:"General Admission",price:25,available:100}]})}}>×</button></div>)}
          <button className="btn" style={{fontSize:11,marginTop:3}} onClick={()=>setEditEvt({...editEvt,tickets:[...editEvt.tickets,{type:"",price:0,available:100}]})}>+ Add Tier</button>
          <div style={{display:"flex",gap:10,marginTop:24}}><button className="buy" style={{flex:1}} disabled={!editEvt.title||!editEvt.date} onClick={()=>saveEvt(editEvt)}>Save Event</button><button className="btn" style={{padding:"10px 20px"}} onClick={()=>setModal(false)}>Cancel</button></div>
        </div></div>}
      <footer className="footer">
          <div className="footer-links">
            <a href="#" onClick={e => { e.preventDefault(); setView("home"); }}>Events</a>
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