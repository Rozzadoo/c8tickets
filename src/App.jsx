import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from './lib/supabase';
import { CROOKED_8_TENANT_ID } from './constants';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

// ── Logo as base64 PNG with transparency ──
const LOGO_SRC = "data:image/png;base64,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";

// ── Data & Storage ──
const DEFAULT_VENUE = {
  id: "crooked8", name: "Crooked 8",
  tagline: "Boise's Most Exciting Event & Concert Venue",
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
  const [venues] = useState([DEFAULT_VENUE]);
  const [events, setEvents] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
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
const CheckoutForm = ({ cartTotal, totalTickets, onSuccess, onBack }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const serviceFees = totalTickets * 2;
  const grandTotal = cartTotal + serviceFees;

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
        <div className="cart-ln"><span>Service Fee ({totalTickets} × $2.00)</span><span>{fmtCurrency(serviceFees)}</span></div>
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

  const venue = venues[0] || DEFAULT_VENUE;
  useEffect(() => {
  supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
  return () => subscription.unsubscribe();
}, []);

const login = async () => {
  setAuthError('');
  const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
  if (error) setAuthError(error.message);
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
      event_date: e.date + 'T' + (e.time || '00:00'),
      doors_open: e.date + 'T' + (e.doors || '00:00'),
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
      event_date: e.date + 'T' + (e.time || '00:00'),
      doors_open: e.date + 'T' + (e.doors || '00:00'),
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
          <div className="nav-logo" onClick={() => setView("home")}><img src={LOGO_SRC} alt="Crooked 8" /></div>
          <div className="nav-links">
            <button className={`btn ${["home","detail"].includes(view) ? "on" : ""}`} onClick={() => setView("home")}>Events</button>
            {session && <button className={`btn ${view === "admin" ? "on" : ""}`} onClick={() => setView("admin")}>Admin</button>}
            <button className="btn" onClick={() => session ? logout() : setView("login")}>{session ? "Logout" : "Login"}</button>
          </div>
        </nav>

        {view === "home" && <div className="fade">
          <div className="hero">
            <img src={LOGO_SRC} alt="Crooked 8" className="hero-logo" />
            <p>{venue.tagline}</p>
            <div className="hero-sub"><span>📍 {venue.location}</span><span>📞 {venue.phone}</span></div>
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
                    <div className="card-date">{fmtDate(ev.date)} · {ev.time}</div>
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
          <div className="d-meta"><span>📅 <strong>{fmtDate(sel.date)}</strong></span><span>🕐 <strong>{sel.time}</strong></span><span>🚪 Doors <strong>{sel.doors}</strong></span><span>📍 <strong>Crooked 8</strong> — Kuna, ID</span></div>
          <p className="d-desc">{sel.description}</p>
          <div className="tkt-sec"><h3 className="dsp">Select Tickets</h3>
            {sel.tickets.map((t, i) => <div className="tkt-row" key={i}><div className="tkt-info"><h4>{t.type}</h4><p>{t.available} left</p></div><div className="tkt-price">{fmtCurrency(t.price)}</div><div className="qty"><button className="qb" disabled={!cart[i]} onClick={() => setCart({ ...cart, [i]: (cart[i]||0)-1 })}>−</button><div className="qv">{cart[i]||0}</div><button className="qb" disabled={(cart[i]||0) >= t.available} onClick={() => setCart({ ...cart, [i]: (cart[i]||0)+1 })}>+</button></div></div>)}
            {cartN > 0 && <div className="cart-sum">{sel.tickets.map((t,i) => cart[i] > 0 && <div className="cart-ln" key={i}><span>{cart[i]}× {t.type}</span><span>{fmtCurrency(cart[i]*t.price)}</span></div>)}<div className="cart-tot"><span>Total</span><span>{fmtCurrency(cartTotal)}</span></div></div>}
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
  setPaymentAmounts({ ticketTotal: data.ticketTotal, serviceFees: data.serviceFees, grandTotal: data.grandTotal });
  setView("checkout");
}}>{cartN===0 ? "Select Tickets" : `Checkout · ${fmtCurrency(cartTotal + cartN * 2)}`}</button>
          </div>
        </div>}

        {view === "checkout" && sel && clientSecret && (
  <div className="sec fade" style={{ maxWidth: 500 }}>
    <div className="back" onClick={() => setView("detail")}>← Tickets</div>
    <h1 className="dsp" style={{ fontSize: 28, marginBottom: 6 }}>Checkout</h1>
    <p style={{ color: "var(--text2)", marginBottom: 24, fontSize: 13 }}>{sel.title} · {fmtDate(sel.date)}</p>
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
              <div style={{color:"var(--gold)",fontWeight:700,fontSize:13,marginBottom:14,textTransform:"uppercase",letterSpacing:1}}>{ev ? fmtDate(ev.date) : ""} · {ev?.time}</div>
              <div><span className="badge badge-ok">✓ Valid</span></div>
              <div className="qr"><QRCode value={lastOrder.id} size={160} /></div>
              <div className="cid">ID: {lastOrder.id.toUpperCase()}</div>
              <ul className="tkt-items">{lastOrder.items.map((it,i) => <li key={i}><span>{it.qty}× {it.type}</span><span>{fmtCurrency(it.qty*it.price)}</span></li>)}<li style={{fontWeight:700,color:"var(--text)",borderTop:"1px solid var(--bg4)",paddingTop:6,marginTop:6}}><span>Total</span><span>{fmtCurrency(lastOrder.total)}</span></li></ul>
              <p style={{fontSize:11,color:"var(--text3)",marginTop:10}}>{lastOrder.buyer.name} · {lastOrder.buyer.email}<br/>Crooked 8 · {venue.location}</p>
            </div>
            <button className="buy" style={{marginTop:20}} onClick={() => setView("home")}>Browse More Events</button>
          </div>); })()}
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
      </div>
    </>
  );
}
