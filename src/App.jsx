import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from './lib/supabase';
import { TENANT_ID, API_BASE, APP_URL } from './constants';
import { DEFAULT_VENUE, TICKET_SIZES, resolveCustomSize, mapEvent, mapVenue, fmtDate, fmtCurrency, fmtTime, csvCell, exportOrdersCSV, buildGCalUrl, downloadIcs } from './lib/utils';
import CSS from './styles';
import ScannerWidget from './components/ScannerWidget';
import QRImg from './components/QRImg';
import CheckoutForm from './components/CheckoutForm';
import LiveDash from './components/LiveDash';
import DoorSales from './components/DoorSales';
import GateView from './components/GateView';
import { Elements } from '@stripe/react-stripe-js';
import { stripePromise } from './lib/stripe';

// ── Logo as base64 PNG with transparency ──
const LOGO_SRC = "/logo-simple.webp";
const LOGO_FULL = "/logo-full.webp";
// ── Data & Storage ──

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
  const [reportTickets, setReportTickets] = useState([]);
  const [reportTicketsLoaded, setReportTicketsLoaded] = useState(false);
  const [holdbackPct, setHoldbackPct] = useState(() => Number(localStorage.getItem('c8_holdbackPct') ?? 10) || 10);
  const [platformFeePct, setPlatformFeePct] = useState(() => Number(localStorage.getItem('c8_platformFeePct') ?? 2.5) || 2.5);
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
  const [evtErr, setEvtErr] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [adminScan, setAdminScan] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);
  const [scanKey, setScanKey] = useState(0);
  const [checkInEventFilter, setCheckInEventFilter] = useState('');
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
  const [resentOrderId, setResentOrderId] = useState(null);
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
  const [addonCart, setAddonCart] = useState({});
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState('');
  const [promos, setPromos] = useState([]);
  const [promosLoaded, setPromosLoaded] = useState(false);
  const [promoForm, setPromoForm] = useState({ code: '', discountType: 'percent', discountValue: '', maxUses: '', eventId: '', expiresAt: '' });
  const [promoSaving, setPromoSaving] = useState(false);
  const [venuePayouts, setVenuePayouts] = useState([]);
  const [payoutForm, setPayoutForm] = useState({ amount: '', date: new Date().toISOString().slice(0,10), notes: '' });
  const [savingPayout, setSavingPayout] = useState(false);
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
  const [refundMode, setRefundMode] = useState('full');
  const [partialRefundAmt, setPartialRefundAmt] = useState('');
  const [compModal, setCompModal] = useState(false);
  const [compForm, setCompForm] = useState({ eventId: '', ticketTypeId: '', qty: 1, name: '', email: '' });
  const [compSaving, setCompSaving] = useState(false);
  const [ordersPage, setOrdersPage] = useState(0);
  const [alreadyPurchased, setAlreadyPurchased] = useState(false);
  const [noticeAgreed, setNoticeAgreed] = useState(false);
  const [waitlistName, setWaitlistName] = useState('');
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [venueSaving, setVenueSaving] = useState(false);
  const [venueError, setVenueError] = useState('');
  const [venueSuccess, setVenueSuccess] = useState('');

  const venue = venues.find(v => v.id === TENANT_ID) || venues[0] || DEFAULT_VENUE;
  const sel = events.find(e => e.id === selId) || null;
  const selVenue = (sel ? venues.find(v => v.id === sel.venueId) : null) || venue;
  const isGate = session?.user?.app_metadata?.role === 'gate';
  const isVenueUser = session?.user?.app_metadata?.role === 'venue';
  const utmRef = useRef({});
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const utm = {};
    ['source','medium','campaign','term','content'].forEach(k => { const v = p.get('utm_'+k); if (v) utm[k] = v; });
    if (Object.keys(utm).length > 0) { utmRef.current = utm; sessionStorage.setItem('c8_utm', JSON.stringify(utm)); }
    else { try { utmRef.current = JSON.parse(sessionStorage.getItem('c8_utm') || '{}'); } catch {} }
    // Inject Plausible analytics if configured
    const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN;
    if (domain && !document.querySelector('script[data-domain]')) {
      const s = document.createElement('script');
      s.defer = true; s.dataset.domain = domain;
      s.src = 'https://plausible.io/js/script.js';
      document.head.appendChild(s);
    }
    window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments); };
  }, []);
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

  useEffect(() => { localStorage.setItem('c8_holdbackPct', String(holdbackPct)); }, [holdbackPct]);
  useEffect(() => { localStorage.setItem('c8_platformFeePct', String(platformFeePct)); }, [platformFeePct]);

  const reloadOrders = useCallback(async () => {
    const { data, error } = await supabase.from('orders').select('*, order_items(*)');
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
  }, []);

  useEffect(() => {
    if (!session) { setOrders([]); return; }
    reloadOrders();
  }, [session, reloadOrders]);

  useEffect(() => {
    if (!session) return;
    const ch = supabase.channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => reloadOrders())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, reloadOrders]);

  useEffect(() => {
    if (aTab !== 'reports' || !session) return;
    setReportTicketsLoaded(false);
    supabase.from('tickets')
      .select('order_id,ticket_type_name,status')
      .eq('tenant_id', TENANT_ID)
      .then(({ data }) => { setReportTickets(data || []); setReportTicketsLoaded(true); });
  }, [aTab, session]);

  useEffect(() => {
    if (aTab !== 'reports' || !session) return;
    supabase.from('venue_payouts').select('*').order('paid_at', { ascending: false })
      .then(({ data }) => setVenuePayouts(data || []));
  }, [aTab, session]);

  useEffect(() => {
    if (!loaded) return;
    const pathMatch = window.location.pathname.match(/^\/e\/([0-9a-f-]{36})$/i);
    const eventId = pathMatch ? pathMatch[1] : new URLSearchParams(window.location.search).get('event');
    if (eventId) {
      const ev = events.find(e => e.id === eventId);
      if (ev && ev.published === false && !session) { setView('home'); }
      else { setSelId(eventId); setCart({}); setAddonCart({}); setView('detail'); }
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
    let desc = 'Buy tickets for concerts, shows, and local events across the Treasure Valley — Boise, Meridian, Nampa, Kuna, and beyond. C8Tickets makes it easy to buy online or at the door.';
    let path = '/';

    if (view === 'detail' && selTitle) { title = `${selTitle} — ${base}`; }
    else if (view === 'checkout') { title = `Checkout — ${base}`; }
    else if (view === 'ticket') { title = `Your Tickets — ${base}`; }
    else if (view === 'mytickets' && ticketOrderId) {
      const evTitle = ticketPageData ? (events.find(e => e.id === ticketPageData.order?.event_id)?.title || '') : '';
      title = evTitle ? `${evTitle} — Your Tickets — ${base}` : `Your Tickets — ${base}`;
      path = `/t/${ticketOrderId}`;
    }
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

    // Update OG / Twitter meta tags for event detail pages
    const setMeta = (sel, val) => { const el = document.querySelector(sel); if (el) el.setAttribute('content', val); };
    const setLink = (sel, val) => { const el = document.querySelector(sel); if (el) el.setAttribute('href', val); };
    if (view === 'detail' && sel) {
      const evTitle = `${sel.title} — C8Tickets`;
      const evDesc = sel.description ? sel.description.slice(0, 160) : `Get tickets for ${sel.title} on ${fmtDate(sel.date)} at ${selVenue.name} — ${selVenue.location}`;
      const evImg = sel.image && sel.image.startsWith('http') ? sel.image : 'https://c8tickets.com/api/og-image';
      const evUrl = `${APP_URL}/e/${sel.id}`;
      setMeta('meta[property="og:title"]', evTitle);
      setMeta('meta[property="og:description"]', evDesc);
      setMeta('meta[property="og:image"]', evImg);
      setMeta('meta[property="og:url"]', evUrl);
      setMeta('meta[name="twitter:title"]', evTitle);
      setMeta('meta[name="twitter:description"]', evDesc);
      setMeta('meta[name="twitter:image"]', evImg);
      setLink('link[rel="canonical"]', evUrl);
    } else {
      setMeta('meta[property="og:title"]', 'C8Tickets — Event Tickets in Boise & Treasure Valley, Idaho');
      setMeta('meta[property="og:description"]', desc);
      setMeta('meta[property="og:image"]', 'https://c8tickets.com/api/og-image');
      setMeta('meta[property="og:url"]', 'https://c8tickets.com/');
      setMeta('meta[name="twitter:title"]', 'C8Tickets — Event Tickets in Boise & Treasure Valley, Idaho');
      setMeta('meta[name="twitter:description"]', desc);
      setMeta('meta[name="twitter:image"]', 'https://c8tickets.com/api/og-image');
      setLink('link[rel="canonical"]', 'https://c8tickets.com/');
    }

    if (window.location.pathname !== path) {
      window.history.replaceState(null, '', path);
    }
  }, [view, selId, sel, selVenue, events, venue, ticketOrderId, ticketPageData]);

  // Inject / remove Google Event structured data
  useEffect(() => {
    let script = document.getElementById('event-ld');
    if (view === 'detail' && sel) {
      if (!script) {
        script = document.createElement('script');
        script.id = 'event-ld';
        script.type = 'application/ld+json';
        document.head.appendChild(script);
      }
      const soldOut = sel.tickets.every(t => Math.max(0, t.available - (t.physicalQty ?? 0)) === 0);
      const minPrice = sel.tickets.length > 0 ? Math.min(...sel.tickets.map(t => t.price)) : 0;
      script.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: sel.title,
        description: sel.description || '',
        startDate: `${sel.date}T${sel.time || '00:00'}`,
        location: { '@type': 'Place', name: selVenue.name, address: { '@type': 'PostalAddress', streetAddress: selVenue.location } },
        image: sel.image && sel.image.startsWith('http') ? sel.image : undefined,
        url: `${APP_URL}/e/${sel.id}`,
        organizer: { '@type': 'Organization', name: selVenue.name, url: APP_URL },
        offers: { '@type': 'Offer', url: `${APP_URL}/e/${sel.id}`, price: minPrice.toFixed(2), priceCurrency: 'USD', availability: soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock' },
      });
    } else if (script) {
      script.remove();
    }
  }, [view, selId, sel, selVenue]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (modal) { setModal(false); return; }
      if (editEmailOrder) { setEditEmailOrder(null); setEditEmailValue(''); return; }
      if (cancelTarget && !cancelling) { setCancelTarget(null); setRefundMode('full'); setPartialRefundAmt(''); return; }
      if (compModal) { setCompModal(false); return; }
      if (ticketSizeModal) { setTicketSizeModal(null); return; }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal, editEmailOrder, cancelTarget, cancelling, compModal, ticketSizeModal]);

  useEffect(() => {
    const email = buyer?.email?.toLowerCase().trim();
    if (!email || !email.includes('@') || !selId || view !== 'checkout') { setAlreadyPurchased(false); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('orders').select('id').eq('event_id', selId).eq('buyer_email', email).neq('status', 'cancelled').limit(1);
      setAlreadyPurchased(Array.isArray(data) && data.length > 0);
    }, 600);
    return () => clearTimeout(t);
  }, [buyer?.email, selId, view]);

const login = async () => {
  setAuthError('');
  const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
  if (error) { setAuthError(error.message); return; }
  const role = data.user?.app_metadata?.role;
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
  const hasStripe = o.stripePaymentIntentId && !o.stripePaymentIntentId.startsWith('CASH-') && !o.stripePaymentIntentId.startsWith('COMP-');
  const isPartial = refundMode === 'partial' && hasStripe;
  if (isPartial) {
    const amt = parseFloat(partialRefundAmt);
    if (isNaN(amt) || amt <= 0 || amt > o.total) {
      alert(`Enter a valid partial refund amount between $0.01 and ${fmtCurrency(o.total)}.`);
      return;
    }
  }
  setCancelling(true);
  const { data: { session: adminSession } } = await supabase.auth.getSession();
  const adminEmail = adminSession?.user?.email || '';
  try {
    if (hasStripe) {
      const refundBody = {
        action: 'refund', paymentIntentId: o.stripePaymentIntentId, orderId: o.id, cancelledBy: adminEmail,
        ...(isPartial ? { amount: parseFloat(partialRefundAmt), partialOnly: true } : {}),
      };
      const refundRes = await fetch(API_BASE + '/api/stripe-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminSession?.access_token || ''}` },
        body: JSON.stringify(refundBody),
      });
      const refundData = await refundRes.json();
      if (!refundRes.ok) {
        alert(`Refund failed: ${refundData.error || 'Unknown error'}. The order was not cancelled.`);
        return;
      }
      if (isPartial) {
        setCancelTarget(null);
        setRefundMode('full');
        setPartialRefundAmt('');
        alert(`Partial refund of ${fmtCurrency(parseFloat(partialRefundAmt))} issued. The order remains valid.`);
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
    setRefundMode('full');
    setPartialRefundAmt('');
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

const saveComp = async () => {
  const ev = events.find(e => e.id === compForm.eventId);
  const tt = ev?.tickets.find(t => t.id === compForm.ticketTypeId);
  if (!ev || !tt || !compForm.name.trim() || compForm.qty < 1) {
    alert('Please fill in all required fields.');
    return;
  }
  setCompSaving(true);
  try {
    const { data: { session: s } } = await supabase.auth.getSession();
    const compRef = 'COMP-' + Date.now();
    const { data: order, error: orderError } = await supabase.from('orders').insert({
      tenant_id: TENANT_ID, event_id: compForm.eventId,
      buyer_name: compForm.name.trim(), buyer_email: compForm.email.trim(), buyer_phone: '',
      status: 'confirmed', total_amount: 0, ticket_subtotal: 0,
      sales_tax: 0, service_fees: 0, processing_fee: 0,
      stripe_payment_intent_id: compRef, source: 'comp',
    }).select().single();
    if (orderError) { alert('Failed to create comp order: ' + orderError.message); return; }
    await supabase.from('order_items').insert([{
      order_id: order.id, ticket_type_id: compForm.ticketTypeId,
      ticket_type_name: tt.type, quantity: compForm.qty, unit_price: 0,
    }]);
    await supabase.rpc('increment_sold', { tid: compForm.ticketTypeId, qty: compForm.qty });
    if (compForm.email.trim()) {
      fetch(API_BASE + '/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token || ''}` },
        body: JSON.stringify({
          order: { id: order.id, items: [{ type: tt.type, qty: compForm.qty, price: 0 }], salesTax: 0, serviceFees: 0, processingFee: 0, total: 0 },
          event: { title: ev.title, category: ev.category || '', date: fmtDate(ev.date), time: fmtTime(ev.time), doors: fmtTime(ev.doors || '') },
          venue: { name: venue.name, location: venue.location },
        }),
      }).catch(() => {});
    }
    updateOrders(prev => [...prev, {
      id: order.id, eventId: compForm.eventId, venueId: venue.id,
      buyer: { name: compForm.name.trim(), email: compForm.email.trim(), phone: '' },
      items: [{ type: tt.type, qty: compForm.qty, price: 0, ticketTypeId: compForm.ticketTypeId }],
      total: 0, date: new Date().toISOString(), checkedIn: false, source: 'comp',
      stripePaymentIntentId: compRef,
    }]);
    updateEvents(evts => evts.map(e => e.id !== compForm.eventId ? e : {
      ...e, tickets: e.tickets.map(t => t.id === compForm.ticketTypeId ? { ...t, available: t.available - compForm.qty } : t)
    }));
    setCompModal(false);
    setCompForm({ eventId: '', ticketTypeId: '', qty: 1, name: '', email: '' });
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    setCompSaving(false);
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
  if (res.ok) { setResentOrderId(o.id); setTimeout(() => setResentOrderId(id => id === o.id ? null : id), 4000); }
  else alert('Failed to send — check the email address and try again.');
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

const savePayout = async () => {
  if (!payoutForm.amount || !payoutForm.date) return;
  setSavingPayout(true);
  const targetVenueId = bkVenueFilter === 'all' ? venue.id : bkVenueFilter;
  const { data, error } = await supabase.from('venue_payouts').insert({
    tenant_id: targetVenueId,
    amount: Number(payoutForm.amount),
    notes: payoutForm.notes || null,
    paid_at: payoutForm.date,
  }).select().single();
  if (!error && data) {
    setVenuePayouts([data, ...venuePayouts]);
    setPayoutForm({ amount: '', date: new Date().toISOString().slice(0,10), notes: '' });
  }
  setSavingPayout(false);
};

const deletePayout = async (id) => {
  if (!window.confirm('Remove this payment record? This cannot be undone.')) return;
  await supabase.from('venue_payouts').delete().eq('id', id);
  setVenuePayouts(venuePayouts.filter(p => p.id !== id));
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
  const addonTotal = useMemo(() => sel ? (sel.addons || []).reduce((s, a) => s + a.price * (addonCart[a.id] || 0), 0) : 0, [addonCart, sel]);
  const cartN = Object.values(cart).reduce((a, b) => a + b, 0);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email);
  const nameValid = buyer.name.trim().length >= 2;
  const buyerReady = nameValid && emailValid;


  const createPaymentIntent = async () => {
    setCreatingPayment(true);
    try {
      const items = sel.tickets.map((t, i) => ({ qty: cart[i] || 0, ticketTypeId: t.id })).filter(i => i.qty > 0);
      const addonItemsReq = (sel.addons || [])
        .filter(a => a.active !== false && (addonCart[a.id] || 0) > 0)
        .map(a => ({ addonId: a.id, name: a.name, qty: addonCart[a.id], price: a.price }));
      const res = await fetch(API_BASE + '/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          addonItems: addonItemsReq,
          eventId: sel.id,
          tenantId: TENANT_ID,
          buyer: { name: buyer.name.trim(), email: buyer.email.trim(), phone: buyer.phone.trim() },
          eventMeta: { title: sel.title, date: fmtDate(sel.date), time: fmtTime(sel.time), doors: fmtTime(sel.doors), category: sel.category || '' },
          venueMeta: { name: selVenue.name, address: selVenue.location },
          promoCode: promoApplied?.code || null,
          utm: Object.keys(utmRef.current).length > 0 ? utmRef.current : undefined,
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
          setAddonCart({});
        } else {
          alert(msg);
        }
        return;
      }
      if (!data.clientSecret) { alert('Payment setup failed. Please try again.'); return; }
      setSoldOutError('');
      setClientSecret(data.clientSecret);
      setPaymentAmounts({ ticketTotal: data.ticketTotal, addonTotal: data.addonTotal || 0, discountAmount: data.discountAmount || 0, salesTax: data.salesTax, serviceFees: data.serviceFees, processingFee: data.processingFee, grandTotal: data.grandTotal });
    } catch {
      alert('Payment setup failed. Please try again.');
    } finally {
      setCreatingPayment(false);
    }
  };

  const open = (id) => {
    const ev = events.find(e => e.id === id);
    setSelId(id); setCart({}); setAddonCart({}); setView("detail");
    setWaitlistName(''); setWaitlistEmail(''); setWaitlistSubmitted(false);
    setNoticeAgreed(false); setAlreadyPurchased(false);
    window.plausible?.('ViewEvent', { props: { event: ev?.title || id } });
    window.history.pushState({}, '', `/e/${id}`);
  };
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

  const handleAdminScan = async (rawId) => {
    setAdminScan(false);
    const id = rawId.replace(/^https?:\/\/[^/]+\/t\//, '').split('?')[0].trim();
    const showMsg = (msg, delay = 3000) => {
      setScanMsg(msg);
      setTimeout(() => { setScanMsg(null); setScanKey(k => k + 1); setAdminScan(true); }, delay);
    };
    // Try individual ticket lookup first
    const { data: ticket } = await supabase.from('tickets').select('*').eq('id', id).single();
    if (ticket) {
      const order = orders.find(o => o.id === ticket.order_id);
      if (!order || order.venueId !== venue.id) { showMsg({ ok: false, text: 'This ticket is not for an event at this venue.' }); return; }
      if (ticket.status === 'cancelled' || order.status === 'cancelled') { showMsg({ ok: false, text: 'This order has been cancelled and refunded.' }); return; }
      if (ticket.status === 'checked_in') { showMsg({ ok: false, text: `Ticket ${ticket.ticket_number} (${ticket.ticket_type_name}) already checked in.` }); return; }
      await supabase.from('tickets').update({ status: 'checked_in', checked_in_at: new Date().toISOString() }).eq('id', ticket.id).eq('status', 'valid');
      setExpandedTickets(prev => ({ ...prev, [ticket.order_id]: (prev[ticket.order_id] || []).map(t => t.id === ticket.id ? { ...t, status: 'checked_in' } : t) }));
      showMsg({ ok: true, text: `✓ Ticket ${ticket.ticket_number} — ${ticket.ticket_type_name} — checked in!` });
      return;
    }
    // Fall back to order-level
    const order = orders.find(o => o.id === id && o.venueId === venue.id);
    if (!order) { showMsg({ ok: false, text: 'No order found for that QR code.' }); return; }
    if (order.status === 'cancelled') { showMsg({ ok: false, text: 'This order has been cancelled and refunded.' }); return; }
    if (order.checkedIn) { showMsg({ ok: false, text: `${order.buyer.name} is already checked in.` }); return; }
    await checkin(id);
    showMsg({ ok: true, text: `✓ ${order.buyer.name} checked in!` });
  };
  const blank = () => ({ id: null, venueId: venue.id, title: "", date: "", time: "", doors: "", description: "", image: "🎵", focalX: 50, focalY: 50, published: true, category: "Live Music", tickets: [{ type: "General Admission", price: 25, available: 100, physicalQty: 0, doorPrice: null }], addons: [], checkoutNotice: "", checkoutNoticeRequired: false });
  const saveEvt = async (e) => {
  setEvtErr('');
  const errs = [];
  if (!e.title.trim()) errs.push('Event name is required.');
  if (!e.date) errs.push('Event date is required.');
  if (!e.time) errs.push('Show time is required.');
  if (e.tickets.some(t => !t.type.trim())) errs.push('All ticket tiers need a name.');
  if (e.tickets.some(t => t.available < 1)) errs.push('Each ticket tier needs a quantity of at least 1.');
  if (errs.length) { setEvtErr(errs.join(' ')); return; }
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
    
    if (uploadError) { setEvtErr(`Image upload failed: ${uploadError.message}`); return; }
    
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
      addons: e.addons || [],
      checkout_notice: e.checkoutNotice || null,
      checkout_notice_required: e.checkoutNoticeRequired || false,
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
      addons: e.addons || [],
      checkout_notice: e.checkoutNotice || null,
      checkout_notice_required: e.checkoutNoticeRequired || false,
    }).select().single();
    if (error) { setEvtErr(`Failed to save event: ${error.message}`); return; }
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
    ? `Delete "${target?.title}"?\n\n⚠️ This event has ${orderCount} order${orderCount !== 1 ? 's' : ''} on record. Deleting it will remove those orders from all reports and analytics — this data cannot be recovered.\n\nIf you want to hide this event without losing report data, use Unpublish instead.\n\nThis cannot be undone.`
    : `Delete "${target?.title}"?\n\nThis will permanently remove the event and all its ticket types. This cannot be undone.`;
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
              const todayStr = new Date().toLocaleDateString('en-CA');
              const sorted = [...publicEvents].filter(e => e.date >= todayStr).sort((a,b) => new Date(a.date)-new Date(b.date));
              const allVenueEvents = venueFilter === 'All' ? events : events.filter(e => e.venueId === venueFilter);
              const pastEvents = allVenueEvents.filter(e => e.date < todayStr).sort((a,b) => new Date(b.date)-new Date(a.date));
              const featuredEv = filter === 'All' ? (sorted.find(ev=>ev.tickets.some(t=>oa(t)>0)) ?? sorted[0] ?? null) : null;
              const upcomingFiltered = filter === 'All' ? sorted : sorted.filter(e => e.category === filter);
              const pastFiltered = filter === 'All' ? pastEvents : pastEvents.filter(e => e.category === filter);
              const gridEvents = featuredEv ? upcomingFiltered.filter(ev=>ev.id!==featuredEv.id) : upcomingFiltered;
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
                  sorted.length===0
                    ? <div style={{textAlign:'center',padding:'48px 20px'}}>
                        <div style={{fontSize:48,marginBottom:16}}>🎵</div>
                        <div style={{fontSize:20,fontWeight:700,color:'var(--text)',marginBottom:8,fontFamily:"'Barlow Condensed',sans-serif",textTransform:'uppercase',letterSpacing:2}}>No Upcoming Events</div>
                        <p style={{fontSize:14,color:'var(--text2)',marginBottom:24,maxWidth:360,margin:'0 auto 24px'}}>Nothing on the calendar yet — check back soon or follow {venue.name} for announcements.</p>
                        <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap'}}>
                          <a href={`mailto:${venue.email||'support@c8tickets.com'}`} className="btn" style={{textDecoration:'none'}}>✉️ Get Notified</a>
                          {pastEvents.length>0&&<button className="btn gold" onClick={()=>document.getElementById('past-events-section')?.scrollIntoView({behavior:'smooth'})}>View Past Events ↓</button>}
                        </div>
                      </div>
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
                        {lowTickets&&<div style={{position:'absolute',bottom:10,left:10,background:'rgba(200,146,42,.97)',backdropFilter:'blur(4px)',padding:'3px 10px',borderRadius:99,fontSize:9,fontWeight:700,color:'#0c0a07',textTransform:'uppercase',letterSpacing:1.5,border:'1px solid rgba(255,200,80,.4)',boxShadow:'0 1px 4px rgba(0,0,0,.4)'}}>Selling Fast</div>}
                      </div>
                      <div className="card-body">
                        <div className="card-date">{fmtDate(ev.date)} - {fmtTime(ev.time)}</div>
                        <div className="card-title dsp">{ev.title}</div>
                        {venues.length > 1 && <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1.5,fontWeight:700,marginBottom:4}}>{venues.find(v=>v.id===ev.venueId)?.name||''}</div>}
                        <div className="card-desc">{ev.description}</div>
                        <div className="card-foot"><div className="card-price">{soldOut?<span style={{color:'var(--text3)',fontWeight:600,fontSize:14,textTransform:'uppercase',letterSpacing:1}}>Sold Out</span>:<>{fmtCurrency(mp)}{mp>0&&<small> & up</small>}</>}</div>{soldOut?null:<button className="btn gold" onClick={e=>{e.stopPropagation();open(ev.id);}}>Tickets</button>}</div>
                      </div>
                    </div>);})}</div>}
                {pastFiltered.length > 0 && <div id="past-events-section" style={{marginTop:52}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:12,marginBottom:14,flexWrap:'wrap'}}>
                    <div className="sec-title dsp" style={{fontSize:'clamp(20px,3vw,26px)',letterSpacing:2,opacity:.55}}>Past Events</div>
                    <div style={{height:2,flex:1,minWidth:32,background:'linear-gradient(90deg,rgba(200,146,42,.15),transparent)',borderRadius:2,alignSelf:'center'}}/>
                  </div>
                  <div className="grid">{pastFiltered.map(ev=>(
                    <div key={ev.id} className="card" role="button" tabIndex={0} onClick={()=>open(ev.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(ev.id);}}} style={{opacity:.45,filter:'grayscale(0.4)'}}>
                      <div className="card-img">
                        {ev.image&&ev.image.startsWith('http')
                          ?<img src={ev.image} alt={ev.title} loading="lazy" style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',objectPosition:`${ev.focalX??50}% ${ev.focalY??50}%`}} />
                          :<span style={{fontSize:48}}>🎵</span>}
                        <div className="card-cat">{ev.category}</div>
                        <div style={{position:'absolute',inset:0,background:'rgba(12,10,7,.5)',display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:20,letterSpacing:4,textTransform:'uppercase',color:'rgba(240,233,218,.7)',border:'1px solid rgba(240,233,218,.3)',padding:'5px 16px',borderRadius:4}}>Past Event</span></div>
                      </div>
                      <div className="card-body">
                        <div className="card-date">{fmtDate(ev.date)} - {fmtTime(ev.time)}</div>
                        <div className="card-title dsp">{ev.title}</div>
                        {venues.length > 1 && <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1.5,fontWeight:700,marginBottom:4}}>{venues.find(v=>v.id===ev.venueId)?.name||''}</div>}
                        <div className="card-desc">{ev.description}</div>
                      </div>
                    </div>
                  ))}</div>
                </div>}
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
              ? <button className="share-btn share-native" title="Share" aria-label="Share this event" onClick={async () => { try { await navigator.share({ title: sel.title, text: sel.title+' — grab your tickets!', url: APP_URL+'/e/'+sel.id }); } catch(e) {} }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                </button>
              : <>
                  <a className="share-btn share-fb" title="Share on Facebook" aria-label="Share on Facebook" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(APP_URL+'/e/'+sel.id)}`} target="_blank" rel="noopener noreferrer">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                  </a>
                  <a className="share-btn share-tw" title="Share on X / Twitter" aria-label="Share on X / Twitter" href={`https://x.com/intent/tweet?text=${encodeURIComponent(sel.title+' — grab your tickets!')}&url=${encodeURIComponent(APP_URL+'/e/'+sel.id)}`} target="_blank" rel="noopener noreferrer">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  </a>
                  <button className="share-btn share-ig" title={copiedLink ? "Copied!" : "Copy link for Instagram"} aria-label={copiedLink ? "Link copied!" : "Copy link for Instagram"} onClick={() => { navigator.clipboard.writeText(APP_URL+'/e/'+sel.id); setCopiedLink(true); setTimeout(()=>setCopiedLink(false),2000); }}>
                    {copiedLink ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>}
                  </button>
                  <a className="share-btn share-sms" title="Share via Text Message" aria-label="Share via Text Message" href={`sms:?body=${encodeURIComponent(sel.title+' — get tickets: '+APP_URL+'/e/'+sel.id)}`}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  </a>
                </>
            }
          </div>
          <div className="d-meta">
  <span>📅 <strong>{fmtDate(sel.date)}</strong></span>
  <span>🕐 <strong>{fmtTime(sel.time)}</strong></span>
  {sel.doors && <span>🚪 Doors <strong>{fmtTime(sel.doors)}</strong></span>}
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
            {(() => {
              const allSoldOut = sel.tickets.every(t => Math.max(0, t.available - (t.physicalQty ?? 0)) === 0);
              if (!allSoldOut) return (
                <>
                  <div style={{background:"var(--bg3)",borderRadius:"var(--rs)",padding:"12px 14px",marginBottom:12,fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
                    <span style={{color:"var(--text2)",fontWeight:600}}>Fees:</span> Ticket prices are subject to 6% Idaho sales tax, a $2.00 service fee per ticket, and a payment processing fee (3.5% + $0.30). All fees are itemized at checkout.
                  </div>
                  <button className="buy" disabled={cartN===0} onClick={() => { if (cartN === 0) return; setSoldOutError(''); setNoticeAgreed(false); setView("checkout"); }}>{cartN===0 ? "Select Tickets" : `Checkout - ${fmtCurrency(cartTotal + cartN * 2)}`}</button>
                </>
              );
              return (
                <div style={{marginTop:8}}>
                  <div style={{background:"rgba(179,58,42,.08)",border:"1px solid rgba(179,58,42,.2)",borderRadius:"var(--rs)",padding:"16px",marginBottom:16,textAlign:"center"}}>
                    <div style={{fontSize:18,fontWeight:700,color:"var(--text)",textTransform:"uppercase",letterSpacing:2,marginBottom:4}}>Sold Out</div>
                    <div style={{fontSize:13,color:"var(--text2)"}}>All tickets for this event have been sold.</div>
                  </div>
                  <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--rs)",padding:"16px",marginBottom:12}}>
                    <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:4}}>Already have tickets?</div>
                    <div style={{fontSize:12,color:"var(--text2)",marginBottom:10}}>Find your tickets and QR code below.</div>
                    <button className="btn" style={{width:"100%"}} onClick={()=>{setLookupEmail('');setLookupStep('email');setLookupError('');setView('lookup');}}>Find My Tickets →</button>
                  </div>
                  {!waitlistSubmitted ? (
                    <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--rs)",padding:"16px"}}>
                      <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:4}}>Join the Waitlist</div>
                      <div style={{fontSize:12,color:"var(--text2)",marginBottom:12}}>We'll let you know if tickets become available.</div>
                      <div className="fg" style={{marginBottom:8}}><input className="fi" style={{margin:0}} placeholder="Your name" value={waitlistName} onChange={e=>setWaitlistName(e.target.value)} /></div>
                      <div className="fg" style={{marginBottom:10}}><input className="fi" type="email" style={{margin:0}} placeholder="your@email.com" value={waitlistEmail} onChange={e=>setWaitlistEmail(e.target.value)} /></div>
                      <button className="buy" disabled={!waitlistName.trim()||!waitlistEmail.includes('@')||waitlistSubmitting} onClick={async()=>{
                        setWaitlistSubmitting(true);
                        try {
                          await supabase.from('waitlist_entries').insert({ event_id: sel.id, tenant_id: TENANT_ID, name: waitlistName.trim(), email: waitlistEmail.trim().toLowerCase() });
                          setWaitlistSubmitted(true);
                        } catch(e) { alert('Could not join waitlist. Please try again.'); }
                        finally { setWaitlistSubmitting(false); }
                      }}>{waitlistSubmitting ? 'Joining…' : 'Join Waitlist'}</button>
                    </div>
                  ) : (
                    <div style={{background:"rgba(93,138,60,.1)",border:"1px solid rgba(93,138,60,.3)",borderRadius:"var(--rs)",padding:"16px",textAlign:"center"}}>
                      <div style={{fontSize:15,fontWeight:700,color:"var(--green)",marginBottom:4}}>You're on the list!</div>
                      <div style={{fontSize:12,color:"var(--text2)"}}>We'll email {waitlistEmail} if tickets open up.</div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>}

        {view === "checkout" && sel && (
  <div className="sec fade" style={{ maxWidth: 500 }}>
    <div className="back" onClick={() => { if (clientSecret) { setClientSecret(null); setPaymentAmounts(null); } else { setView("detail"); } }}>{clientSecret ? "← Your Info" : "← Tickets"}</div>
    <h1 className="dsp" style={{ fontSize: 28, marginBottom: 6 }}>Checkout</h1>
    <p style={{ color: "var(--text2)", marginBottom: 24, fontSize: 13 }}>{sel.title} - {fmtDate(sel.date)}</p>
    {!clientSecret && (
      <>
        {alreadyPurchased && <div style={{background:"rgba(200,146,42,.1)",border:"1px solid rgba(200,146,42,.3)",borderRadius:"var(--rs)",padding:"12px 14px",marginBottom:16,fontSize:13,color:"var(--gold)"}}>
          <strong>Heads up:</strong> We found an existing order for this email at this event. Double-check before purchasing again — <button style={{background:'none',border:'none',padding:0,color:'var(--gold)',cursor:'pointer',textDecoration:'underline',fontSize:13}} onClick={()=>{setLookupEmail(buyer.email);setLookupStep('email');setView('lookup');}}>find your existing tickets here</button>.
        </div>}
        <div className="tkt-sec" style={{ marginBottom: 20 }}>
          <h3 className="dsp">Your Info</h3>
          <div className="fg"><label className="fl" htmlFor="buyer-name">Full Name *</label><input id="buyer-name" className="fi" autoComplete="name" value={buyer.name} onChange={e => setBuyer({...buyer,name:e.target.value})} placeholder="Jane Doe" />{buyer.name.length > 0 && !nameValid && <p style={{fontSize:11,color:"var(--red)",marginTop:3}}>Please enter your full name.</p>}</div>
          <div className="fr">
            <div className="fg"><label className="fl" htmlFor="buyer-email">Email *</label><input id="buyer-email" className="fi" type="email" autoComplete="email" value={buyer.email} onChange={e => setBuyer({...buyer,email:e.target.value})} placeholder="jane@email.com" />{buyer.email.length > 0 && !emailValid && <p style={{fontSize:11,color:"var(--red)",marginTop:3}}>Please enter a valid email.</p>}</div>
            <div className="fg"><label className="fl" htmlFor="buyer-phone">Phone <span style={{fontWeight:400,color:'var(--text3)'}}>(optional)</span></label><input id="buyer-phone" className="fi" type="tel" autoComplete="tel" value={buyer.phone} onChange={e => setBuyer({...buyer,phone:e.target.value})} placeholder="(208) 555-1234" /></div>
          </div>
        </div>
        {(sel.addons||[]).filter(a=>a.active!==false).length > 0 && (
          <div className="tkt-sec" style={{marginBottom:20}}>
            <h3 className="dsp">Add-ons</h3>
            {(sel.addons||[]).filter(a=>a.active!==false).map(a => {
              const aqty = addonCart[a.id] || 0;
              const maxAqty = a.maxPerOrder || 10;
              return (
                <div className="tkt-row" key={a.id}>
                  <div className="tkt-info"><h4>{a.name}</h4>{a.description && <p style={{fontSize:12,color:'var(--text2)'}}>{a.description}</p>}</div>
                  <div className="tkt-price">{fmtCurrency(a.price)}</div>
                  <div className="qty">
                    <button className="qb" aria-label={`Remove one ${a.name}`} disabled={!aqty} onClick={()=>setAddonCart({...addonCart,[a.id]:aqty-1})}>−</button>
                    <div className="qv">{aqty}</div>
                    <button className="qb" aria-label={`Add one ${a.name}`} disabled={aqty>=maxAqty} onClick={()=>setAddonCart({...addonCart,[a.id]:aqty+1})}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
          const tax = Math.round((discounted + addonTotal) * 0.06 * 100) / 100;
          const svcFees = cartN * 2.00;
          const subtotal = discounted + addonTotal + tax + svcFees;
          const procFee = Math.round((subtotal * 0.035 + 0.30) * 100) / 100;
          const grand = subtotal + procFee;
          return (
            <div className="tkt-sec" style={{ marginBottom: 20 }}>
              <h3 className="dsp">Order Summary</h3>
              <div className="cart-sum">
                {sel.tickets.map((t, i) => cart[i] > 0 && <div className="cart-ln" key={i}><span>{cart[i]}× {t.type}</span><span>{fmtCurrency(cart[i] * t.price)}</span></div>)}
                {(sel.addons||[]).filter(a=>a.active!==false&&(addonCart[a.id]||0)>0).map(a=>(
                  <div className="cart-ln" key={a.id} style={{color:'var(--gold)'}}><span>{addonCart[a.id]}× {a.name}</span><span>{fmtCurrency(addonCart[a.id]*a.price)}</span></div>
                ))}
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
              {sel.checkoutNotice && <div style={{background:"rgba(200,146,42,.08)",border:"1px solid rgba(200,146,42,.2)",borderRadius:"var(--rs)",padding:"12px 14px",marginTop:12,fontSize:13,color:"var(--text2)",lineHeight:1.6}}>
                <strong style={{color:"var(--gold)"}}>Notice: </strong>{sel.checkoutNotice}
                {sel.checkoutNoticeRequired && <div style={{display:'flex',alignItems:'center',gap:10,marginTop:10}}>
                  <input type="checkbox" id="notice-agree-cb" checked={noticeAgreed} onChange={e=>setNoticeAgreed(e.target.checked)} style={{width:16,height:16,accentColor:'var(--gold)',cursor:'pointer',flexShrink:0}} />
                  <label htmlFor="notice-agree-cb" style={{fontSize:12,cursor:'pointer',userSelect:'none'}}>I have read and understand the above</label>
                </div>}
              </div>}
              {soldOutError && <div style={{background:"rgba(179,58,42,.12)",border:"1px solid rgba(179,58,42,.35)",borderRadius:"var(--rs)",padding:"12px 14px",marginTop:12,marginBottom:4,color:"var(--red)",fontSize:13}}><strong>Tickets no longer available:</strong> {soldOutError}. Please go back and choose different quantities.</div>}
              <button className="buy" style={{ marginTop: 12 }} onClick={createPaymentIntent} disabled={creatingPayment || !!soldOutError || (sel.checkoutNoticeRequired && !noticeAgreed)}>
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
              console.error('Order save error (payment succeeded, webhook will recover):', orderError);
              alert(`Your payment went through successfully!\n\nYour confirmation email with tickets is on its way — please allow 1–2 minutes for delivery and check your spam folder if it doesn't arrive.\n\nIf you don't receive it within 10 minutes, contact support@c8tickets.com with this reference:\n${paymentIntentId}`);
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
              const msg = fulfillError.message?.includes('remaining')
                ? `Sorry, some tickets in your order are no longer available. Your payment was captured — please email support@c8tickets.com with your payment reference: ${paymentIntentId}`
                : `There was a problem saving your order. Your payment was captured — please email support@c8tickets.com with payment reference: ${paymentIntentId}`;
              alert(msg);
              return;
            }

            const currentAddonItems = (sel.addons || [])
              .filter(a => a.active !== false && (addonCart[a.id] || 0) > 0)
              .map(a => ({ addonId: a.id, name: a.name, qty: addonCart[a.id], price: a.price }));

            if (currentAddonItems.length > 0) {
              await supabase.from('order_items').insert(
                currentAddonItems.map(ai => ({
                  order_id: order.id,
                  ticket_type_id: null,
                  ticket_type_name: ai.name,
                  quantity: ai.qty,
                  unit_price: ai.price,
                  is_addon: true,
                }))
              );
            }

            const localOrder = {
              id: order.id, eventId: sel.id, venueId: venue.id,
              buyer: { ...buyer },
              items: items.map(i => ({ type: i.type, qty: i.qty, price: i.price, ticketTypeId: i.ticketTypeId })),
              addonItems: currentAddonItems,
              ticketTotal: paymentAmounts.ticketTotal,
              addonTotal: paymentAmounts.addonTotal || 0,
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
            window.plausible?.('Purchase', { props: { event: sel.title, amount: String(localOrder.total) } });
            setBuyer({ name: "", email: "", phone: "" });
            setCart({});
            setAddonCart({});
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
              <p style={{fontSize:11,color:"var(--text3)",marginTop:8,lineHeight:1.6}}>A confirmation email with your QR code has been sent to <strong style={{color:"var(--text2)"}}>{lastOrder.buyer.email}</strong>. If you don't see it, check your spam or junk folder.</p>
            </div>
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button className="btn" style={{flex:1}} onClick={async () => {
                const url = `${APP_URL}/t/${lastOrder.id}`;
                if (navigator.share) { try { await navigator.share({ title: 'Your Tickets', url }); } catch {} }
                else { navigator.clipboard?.writeText(url); }
              }}>Save / Share Ticket</button>
              <button className="btn" style={{flex:1}} onClick={() => window.print()}>Print / Save PDF</button>
            </div>
            {ev && <div style={{display:"flex",gap:8,marginTop:8}}>
              <a href={buildGCalUrl(ev, venue.location)} target="_blank" rel="noopener noreferrer" className="btn" style={{flex:1,textAlign:"center",textDecoration:"none"}}>Google Calendar</a>
              <button className="btn" style={{flex:1}} onClick={()=>downloadIcs(ev, venue.location)}>Download .ics</button>
            </div>}
            <a href={`${API_BASE}/api/wallet-pass?id=${lastOrder.id}`} style={{display:"block",marginTop:10,textAlign:"center"}}>
              <img src="/add-to-apple-wallet.svg" alt="Add to Apple Wallet" style={{height:44}} />
            </a>
            <button className="buy" style={{marginTop:8}} onClick={goHome}>Browse More Events</button>
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
                          <span className={`badge ${t.status==='checked_in'?'badge-done':t.status==='cancelled'?'badge-cancelled':'badge-ok'}`}>
                            {t.status==='checked_in'
                              ? <>Checked In{t.checked_in_at&&<span style={{fontWeight:400,marginLeft:4,opacity:.75}}>{new Date(t.checked_in_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/Boise'})}</span>}</>
                              : t.status==='cancelled'?'Cancelled':'Valid'}
                          </span>
                        </div>
                        <button className="btn" style={{width:"100%",marginTop:10,fontSize:12}} onClick={shareTicket}>Save / Share Ticket {t.ticket_number}</button>
                      </div>
                    );
                  })}
                </div>
                {order.status !== 'cancelled' && (
                  <a href={`${API_BASE}/api/wallet-pass?id=${order.id}`} style={{display:"block",textAlign:"center",marginBottom:16}}>
                    <img src="/add-to-apple-wallet.svg" alt="Add to Apple Wallet" style={{height:44}} />
                  </a>
                )}
                <div style={{marginBottom:24,padding:"20px 16px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--rs)"}}>
                  <p style={{fontSize:13,color:"var(--text2)",marginBottom:10}}>{hasReceipt ? 'Save a copy to your email' : 'Want another copy in your inbox?'}</p>
                  {ticketResendSent
                    ? <p style={{fontSize:13,color:"var(--gold)",fontWeight:600}}>Sent! Check your inbox.</p>
                    : <div style={{display:"flex",gap:8}}>
                        <input className="fi" type="email" placeholder="your@email.com" value={ticketResendEmail} onChange={e=>setTicketResendEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendTicketResend()} style={{flex:1,padding:"8px 10px",fontSize:13}} />
                        <button className="btn" onClick={sendTicketResend} disabled={ticketResendSending||!ticketResendEmail} style={{flexShrink:0}}>{ticketResendSending?"Sending…":"Email Me"}</button>
                      </div>
                  }
                </div>
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
                          <div key={ev.id} className="card" role="button" tabIndex={0} onClick={() => { setSelId(ev.id); setCart({}); setAddonCart({}); setView('detail'); window.history.pushState({}, '', `/e/${ev.id}`); }} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelId(ev.id);setCart({});setAddonCart({});setView('detail');window.history.pushState({},'',(ev.id));}}}>
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
      <input id="auth-email" className="fi" type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} placeholder="admin@yourdomain.com" />
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
          ].map(([t,label,icon]) => <button key={t} className={`aside-btn ${aTab===t?"on":""}`} onClick={() => { setATab(t); if(t==='promos'&&!promosLoaded) loadPromos(); if(t==='accounts'&&!venueUsersLoaded) loadVenueUsers(); }} style={{display:'flex',alignItems:'center',gap:8}} title={label}>{icon}<span className="aside-label">{label}</span></button>)}</div>
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
              {vEvents.length===0?<div className="empty"><div className="ic">🎫</div><p>No events.</p></div>:<div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th>Event</th><th>Date</th><th>Category</th><th>Remaining</th><th>Status</th><th>Actions</th></tr></thead><tbody>{vEvents.map(ev=><tr key={ev.id}><td style={{fontWeight:600}}>{ev.title}</td><td>{fmtDate(ev.date)}</td><td>{ev.category}</td><td>{ev.tickets.reduce((s,t)=>s+t.available,0)}</td><td><span className={`badge ${ev.published!==false?"badge-ok":"badge-sold"}`}>{ev.published!==false?"Live":"Hidden"}</span></td><td style={{display:"flex",gap:6,flexWrap:"wrap"}}><button className="btn" style={{fontSize:11,padding:"5px 10px"}} onClick={()=>{setEditEvt({...ev});setModal(true);}}>Edit</button><button className="btn" style={{fontSize:11,padding:"5px 10px"}} onClick={()=>{const {_imageFile:_f,_imagePreview:_p,...rest}=ev;setEditEvt({...rest,id:null,title:'Copy of '+ev.title,date:'',time:'',published:false});setModal(true);}}>Duplicate</button><button className="btn" style={{fontSize:11,padding:"5px 10px",color:ev.published!==false?"var(--text2)":"var(--gold)"}} disabled={togglingPublish.has(ev.id)} onClick={()=>togglePublish(ev)}>{togglingPublish.has(ev.id)?"Saving…":ev.published!==false?"Unpublish":"Publish"}</button>{ev.tickets.some(t=>(t.physicalQty??0)>0)&&<><button className="btn gold" style={{fontSize:11,padding:"5px 10px"}} disabled={!!generatingPhysical} onClick={()=>{setTicketSizeSelected('strip');setTicketSizeModal({ev,mode:'print'});}}>{generatingPhysical===ev.id?"Generating…":"🖨 Print"}</button><button className="btn gold" style={{fontSize:11,padding:"5px 10px"}} disabled={!!generatingPhysical} onClick={()=>{setTicketSizeSelected('strip');setTicketSizeModal({ev,mode:'photo'});}}>{generatingPhysical===ev.id+'-photo'?"Generating…":"📸 Photo PDF"}</button></>}<button className="btn" style={{fontSize:11,padding:"5px 10px"}} disabled={sendingReminder===ev.id} onClick={()=>sendReminder(ev)}>{sendingReminder===ev.id?'Sending…':'Remind All'}</button><button className="btn" style={{fontSize:11,padding:"5px 10px"}} onClick={()=>exportOrdersCSV(orders.filter(o=>o.eventId===ev.id),events,`${ev.title.replace(/[^\w\s-]/g,'').replace(/\s+/g,'-')}-orders.csv`)}>Export CSV</button><button className="btn" style={{fontSize:11,padding:"5px 10px",color:"var(--red)"}} onClick={()=>delEvt(ev.id)}>Delete</button></td></tr>)}</tbody></table></div>}</>}

            {aTab === "orders" && (()=>{
              const vo=orders.filter(o=>o.venueId===venue.id);
              const vs=orderSourceFilter==='all'?vo:vo.filter(o=>orderSourceFilter==='online'?(o.source==='online'||!o.source):o.source==='door'||o.source==='door_cash'||o.source==='comp');
              const q=orderSearch.toLowerCase().trim();
              const fo=q?vs.filter(o=>{const ev=events.find(e=>e.id===o.eventId);return (o.buyer.name||'').toLowerCase().includes(q)||(o.buyer.email||'').toLowerCase().includes(q)||(ev?.title||'').toLowerCase().includes(q);}):vs;
              const PAGE_SIZE=50;const sortedFo=fo.slice().sort((a,b)=>new Date(b.date)-new Date(a.date));const totalPages=Math.ceil(sortedFo.length/PAGE_SIZE)||1;const safePage=Math.min(ordersPage,totalPages-1);const pagedFo=sortedFo.slice(safePage*PAGE_SIZE,(safePage+1)*PAGE_SIZE);
              return <>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:10}}>
                  <h2 className="dsp" style={{fontSize:26}}>All Orders</h2>
                  <input className="fi" style={{maxWidth:260,margin:0}} placeholder="Search name, email, or event…" value={orderSearch} onChange={e=>{setOrderSearch(e.target.value);setOrdersPage(0);}} />
                </div>
                <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
                  {[['all','All'],['online','Online'],['door','Door']].map(([val,label])=>(
                    <button key={val} className={`chip ${orderSourceFilter===val?'on':''}`} onClick={()=>{setOrderSourceFilter(val);setOrdersPage(0);}}>{label}</button>
                  ))}
                  <span style={{fontSize:12,color:"var(--text3)",alignSelf:"center",marginLeft:4}}>{fo.length} order{fo.length!==1?'s':''}</span>
                  <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                    <button className="btn gold" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>{setCompForm({eventId:'',ticketTypeId:'',qty:1,name:'',email:''});setCompModal(true);}}>+ Comp</button>
                    {fo.length>0&&<button className="btn" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>exportOrdersCSV(fo,events,`orders-${new Date().toISOString().slice(0,10)}.csv`)}>Export CSV</button>}
                  </div>
                </div>
                {fo.length===0?<div className="empty"><div className="ic">📋</div><p>{q?"No matching orders.":"No orders."}</p></div>:<><div style={{overflowX:"auto"}}><table className="dt"><thead><tr><th></th><th>Order</th><th>Date</th><th>Buyer</th><th>Email</th><th>Event</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>{pagedFo.flatMap(o=>{const ev=events.find(e=>e.id===o.eventId);const cancelled=o.status==='cancelled';const isComp=o.source==='comp';const isExp=expandedOrders.has(o.id);const tix=expandedTickets[o.id]||[];const toggleExp=async()=>{const next=new Set(expandedOrders);if(isExp){next.delete(o.id);setExpandedOrders(next);}else{next.add(o.id);setExpandedOrders(next);if(!expandedTickets[o.id]){const{data:t}=await supabase.from('tickets').select('*').eq('order_id',o.id).order('ticket_number');setExpandedTickets(prev=>({...prev,[o.id]:t||[]}));}}};return[<tr key={o.id} style={{opacity:cancelled?.5:1}}><td style={{width:28,paddingRight:0}}><button style={{background:'none',border:'none',cursor:'pointer',color:'var(--text3)',fontSize:11,padding:'2px 4px'}} onClick={toggleExp}>{isExp?'▲':'▼'}</button></td><td style={{fontFamily:"monospace",fontSize:11}}>{o.id.slice(0,12)}{o.stripePaymentIntentId&&<div style={{color:"var(--text3)",fontSize:10,marginTop:2}}>{o.stripePaymentIntentId.slice(0,22)}</div>}{isComp&&<div style={{color:"var(--gold)",fontSize:10,fontWeight:700}}>COMP</div>}</td><td style={{fontSize:11}}>{new Date(o.date).toLocaleDateString()}<br/><span style={{color:"var(--text3)"}}>{new Date(o.date).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}</span></td><td>{o.buyer.name}</td><td style={{fontSize:11}}>{o.buyer.email}</td><td>{ev?.title||"—"}</td><td style={{fontSize:11}}>{o.items.map(i=>`${i.qty}× ${i.type}`).join(", ")}</td><td style={{fontWeight:700}}>{isComp?<span style={{color:"var(--gold)"}}>COMP</span>:fmtCurrency(o.total)}</td><td><span className={`badge ${cancelled?'badge-cancelled':o.checkedIn?'badge-done':'badge-ok'}`}>{cancelled?'Cancelled':o.checkedIn?'Checked In':'Valid'}</span></td><td style={{display:"flex",gap:4,flexWrap:"wrap"}}><button className="btn" style={{fontSize:11,padding:"4px 8px"}} onClick={()=>{setEditEmailOrder(o);setEditEmailValue(o.buyer.email||'');}}>Edit Email</button>{!cancelled&&<>{resentOrderId===o.id?<span style={{fontSize:11,color:'var(--green)',fontWeight:700,padding:'4px 8px'}}>Sent ✓</span>:<button className="btn" style={{fontSize:11,padding:"4px 8px"}} onClick={()=>resendEmail(o)}>Resend</button>}<button className="btn" style={{fontSize:11,padding:"4px 8px",color:"var(--red)"}} onClick={()=>setCancelTarget(o)}>Cancel</button></>}</td></tr>,isExp&&<tr key={o.id+'-tix'}><td colSpan={10} style={{padding:'0 14px 12px 42px',background:'var(--bg3)'}}>{!expandedTickets[o.id]?<p style={{fontSize:12,color:'var(--text3)',padding:'8px 0'}}>Loading tickets…</p>:tix.length===0?<p style={{fontSize:12,color:'var(--text3)',padding:'8px 0'}}>No individual ticket records for this order.</p>:<div style={{display:'flex',flexWrap:'wrap',gap:6,paddingTop:8}}>{tix.map(t=><div key={t.id} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 10px',background:'var(--bg2)',borderRadius:'var(--rs)',border:'1px solid var(--bg4)'}}><span style={{fontSize:12,color:'var(--text2)'}}>#{t.ticket_number} — {t.ticket_type_name}</span><span className={`badge ${t.status==='checked_in'?'badge-done':t.status==='cancelled'?'badge-cancelled':'badge-ok'}`} style={{fontSize:9}}>{t.status==='checked_in'?'Checked In':t.status==='cancelled'?'Voided':'Valid'}</span>{t.status==='valid'&&<button className="btn" style={{fontSize:10,padding:'2px 8px',color:'var(--red)'}} onClick={async()=>{if(!confirm(`Void ticket #${t.ticket_number}?`))return;await supabase.from('tickets').update({status:'cancelled'}).eq('id',t.id);setExpandedTickets(prev=>({...prev,[o.id]:prev[o.id].map(x=>x.id===t.id?{...x,status:'cancelled'}:x)}));}}>Void</button>}</div>)}</div>}</td></tr>].filter(Boolean);})}  </tbody></table></div>
                {totalPages>1&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginTop:14}}><button className="btn" style={{padding:"5px 14px",fontSize:12}} disabled={safePage===0} onClick={()=>setOrdersPage(p=>Math.max(0,p-1))}>← Prev</button><span style={{fontSize:12,color:"var(--text3)"}}>Page {safePage+1} of {totalPages}</span><button className="btn" style={{padding:"5px 14px",fontSize:12}} disabled={safePage>=totalPages-1} onClick={()=>setOrdersPage(p=>Math.min(totalPages-1,p+1))}>Next →</button></div>}
                </>}
              </>; })()}

            {aTab === "check-in" && (()=>{ const vo=orders.filter(o=>o.venueId===venue.id&&o.status!=='cancelled'&&(!checkInEventFilter||o.eventId===checkInEventFilter)); const ciq=orderSearch.toLowerCase().trim(); const vof=ciq?vo.filter(o=>(o.buyer.name||'').toLowerCase().includes(ciq)||(o.buyer.email||'').toLowerCase().includes(ciq)):vo; const ciCheckedIn=vof.filter(o=>o.checkedIn).length; const ciTotal=vof.length; return <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,flexWrap:"wrap",gap:10}}>
                <h2 className="dsp" style={{fontSize:26}}>Check-In</h2>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn" style={{fontSize:12,padding:"4px 10px"}} onClick={()=>{ reloadOrders(); setExpandedTickets({}); }}>↻ Refresh</button>
                  {!adminScan && <button className="btn gold" onClick={()=>{setAdminScan(true);setScanMsg(null);}}>📷 Scan Ticket</button>}
                </div>
              </div>
              {adminScan && <div style={{marginBottom:16,maxWidth:400}}>
                <ScannerWidget key={scanKey} scannerId="admin-scanner" onResult={handleAdminScan} />
                <button className="btn" style={{width:"100%",marginTop:8}} onClick={()=>setAdminScan(false)}>Cancel</button>
              </div>}
              {scanMsg && <div style={{marginBottom:16,padding:"10px 14px",borderRadius:"var(--rs)",background:scanMsg.ok?"rgba(93,138,60,.15)":"rgba(179,58,42,.15)",color:scanMsg.ok?"var(--green)":"var(--red)",fontSize:13,fontWeight:600}}>{scanMsg.text}</div>}
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>
                <select className="fi" style={{maxWidth:240,margin:0}} value={checkInEventFilter} onChange={e=>setCheckInEventFilter(e.target.value)}>
                  <option value="">All Events</option>
                  {events.filter(e=>e.published!==false).sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=><option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
                <input className="fi" style={{maxWidth:220,margin:0}} placeholder="Search name or email…" value={orderSearch} onChange={e=>setOrderSearch(e.target.value)} />
              </div>
              <div style={{marginBottom:16,fontSize:12,color:"var(--text3)"}}>{ciCheckedIn} / {ciTotal} checked in{checkInEventFilter?` — ${events.find(e=>e.id===checkInEventFilter)?.title||''}`:''}</div>
              {vof.length===0?<div className="empty"><div className="ic">✅</div><p>{ciq?"No matching attendees.":"No tickets."}</p></div>:<div>{vof.map(o=>{
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
                    :<>{tix.filter(t=>t.status==='valid').length>1&&<button className="ci-btn" style={{width:"100%",marginBottom:10,fontSize:12,padding:"6px 10px"}} onClick={async()=>{
                        const now=new Date().toISOString();
                        const unchecked=tix.filter(t=>t.status==='valid');
                        await supabase.from('tickets').update({status:'checked_in',checked_in_at:now}).in('id',unchecked.map(t=>t.id));
                        const newTix=tix.map(t=>t.status==='valid'?{...t,status:'checked_in',checked_in_at:now}:t);
                        setExpandedTickets(prev=>({...prev,[o.id]:newTix}));
                        await supabase.from('orders').update({status:'checked_in'}).eq('id',o.id);
                        updateOrders(orders.map(ord=>ord.id===o.id?{...ord,checkedIn:true}:ord));
                      }}>✓ Check In All ({tix.filter(t=>t.status==='valid').length} remaining)</button>}
                    {tix.map(t=><div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid var(--bg4)"}}>
                      <span style={{fontSize:12,flex:1,color:"var(--text2)"}}>#{t.ticket_number} — {t.ticket_type_name}</span>
                      <span className={`badge ${t.status==='checked_in'?'badge-done':'badge-ok'}`} style={{fontSize:10}}>{t.status==='checked_in'?'In':'Valid'}</span>
                      {t.status==='checked_in'
                        ? <button className="btn" style={{fontSize:11,padding:"4px 10px",color:'var(--text3)'}} onClick={async()=>{
                            const {error} = await supabase.from('tickets').update({status:'valid',checked_in_at:null}).eq('id',t.id);
                            if (error) { alert('Undo failed: ' + error.message); return; }
                            const newTix = (expandedTickets[o.id]||[]).map(x=>x.id===t.id?{...x,status:'valid',checked_in_at:null}:x);
                            setExpandedTickets(prev=>({...prev,[o.id]:newTix}));
                            await supabase.from('orders').update({status:'confirmed'}).eq('id',o.id);
                            updateOrders(orders.map(ord=>ord.id===o.id?{...ord,checkedIn:false}:ord));
                          }}>Undo</button>
                        : <button className="ci-btn" style={{fontSize:11,padding:"4px 10px"}} onClick={async()=>{
                            const {error} = await supabase.from('tickets').update({status:'checked_in',checked_in_at:new Date().toISOString()}).eq('id',t.id).eq('status','valid');
                            if (error) { alert('Check-in failed: ' + error.message); return; }
                            const newTix = (expandedTickets[o.id]||[]).map(x=>x.id===t.id?{...x,status:'checked_in'}:x);
                            setExpandedTickets(prev=>({...prev,[o.id]:newTix}));
                            if (newTix.filter(x=>x.status!=='cancelled').every(x=>x.status==='checked_in')) {
                              await supabase.from('orders').update({status:'checked_in'}).eq('id',o.id);
                              updateOrders(orders.map(ord=>ord.id===o.id?{...ord,checkedIn:true}:ord));
                            }
                          }}>Check In</button>
                      }
                    </div>)}</>}
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
              const evAvgRows=[...new Set(vo.map(o=>o.eventId))].map(evId=>{const ev=vEvents.find(e=>e.id===evId);const eo=vo.filter(o=>o.eventId===evId);if(!eo.length)return null;const capacity=ev?ev.tickets.reduce((s,t)=>s+(t.total??t.available),0):null;const evTotalSold=ev?ev.tickets.reduce((s,t)=>s+(t.sold??0),0):null;const sellThru=capacity?Math.round(evTotalSold/capacity*100):0;const remaining=capacity!=null?Math.max(0,capacity-evTotalSold):null;return{ev:ev||{id:evId,title:'[Deleted Event]',date:''},count:eo.length,totalTix:eo.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0),totalRev:eo.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0),capacity,evTotalSold,sellThru,remaining};}).filter(Boolean);

              const isDoor = o => o.source==='door'||o.source==='door_cash';
              const doorOrders=vo.filter(isDoor);
              const onlineOrders=vo.filter(o=>!isDoor(o));
              const doorTix=doorOrders.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0);
              const onlineTix=onlineOrders.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0);
              const doorRev=doorOrders.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0);
              const onlineRev=onlineOrders.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0);

              const allVenueOrders=orders.filter(o=>o.venueId===venue.id&&o.status!=='cancelled');
              const buyerMap={};
              for(const o of allVenueOrders){const key=(o.buyer.email||'').toLowerCase().trim()||o.buyer.name;if(!buyerMap[key])buyerMap[key]={email:o.buyer.email,name:o.buyer.name,orders:0,total:0,tix:0,lastPurchase:null};buyerMap[key].orders++;buyerMap[key].total+=o.total;buyerMap[key].tix+=o.items.reduce((s,i)=>s+i.qty,0);if(!buyerMap[key].lastPurchase||new Date(o.date)>new Date(buyerMap[key].lastPurchase))buyerMap[key].lastPurchase=o.date;}
              const repeatBuyers=Object.values(buyerMap).filter(b=>b.orders>=2).sort((a,b)=>b.orders-a.orders);

              const ciTypeMap={};
              const voOrderIds=new Set(vo.map(o=>o.id));
              if(reportTicketsLoaded&&reportTickets.length>0){
                for(const t of reportTickets){
                  if(!voOrderIds.has(t.order_id)||t.status==='cancelled')continue;
                  if(!ciTypeMap[t.ticket_type_name])ciTypeMap[t.ticket_type_name]={sold:0,checkedIn:0};
                  ciTypeMap[t.ticket_type_name].sold++;
                  if(t.status==='checked_in')ciTypeMap[t.ticket_type_name].checkedIn++;
                }
              } else {
                for(const o of vo){for(const item of o.items){if(!ciTypeMap[item.type])ciTypeMap[item.type]={sold:0,checkedIn:0};ciTypeMap[item.type].sold+=item.qty;if(o.checkedIn)ciTypeMap[item.type].checkedIn+=item.qty;}}
              }
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
                rows.push(['Week','Orders','Tickets','Ticket Revenue','Service Fees ($2/tkt)',`Platform Fee (${platformFeePct}%)`,'Venue Gross',`Holdback (${holdbackPct}%)`,'Pay Venue','Your Revenue (Svc + Platform)']);
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

              const downloadSalesCSV = () => {
                const fmt = n => Number(n).toFixed(2);
                const q = s => `"${String(s).replace(/"/g,'""')}"`;
                const rows = [];
                rows.push(['C8 Tickets Sales Report']);
                rows.push([`Venue: ${venue.name}`]);
                rows.push([`Period: ${filterLabels[reportFilter]}`]);
                rows.push([`Generated: ${new Date().toLocaleDateString('en-US')}`]);
                rows.push([]);
                rows.push(['PERFORMANCE SUMMARY']);
                rows.push(['Metric','Value']);
                rows.push(['Total Venue Revenue',fmt(venueRev)]);
                rows.push(['Total Tickets Sold',totalTix]);
                rows.push(['Total Orders',vo.length]);
                rows.push(['Average Order Value',vo.length>0?fmt(avgOrderTotal):'0.00']);
                rows.push([]);
                rows.push(['TICKET TYPE BREAKDOWN']);
                rows.push(['Ticket Type','Qty Sold','% of Sales','Revenue']);
                for(const [type,d] of typeRows){const pct=totalTix>0?Math.round(d.qty/totalTix*100):0;rows.push([type,d.qty,pct+'%',fmt(d.rev)]);}
                rows.push([]);
                rows.push(['EVENT PERFORMANCE']);
                rows.push(['Event','Orders','Tickets Sold','Revenue','Capacity','Remaining','Sell-Through']);
                for(const {ev,count,totalTix:tix,totalRev,capacity,remaining,sellThru} of evAvgRows){rows.push([ev.title,count,tix,fmt(totalRev),capacity||'—',remaining!==null?remaining:'—',capacity?sellThru+'%':'—']);}
                rows.push([]);
                const dcOrds=doorOrders.filter(o=>o.source==='door'),cashOrds=doorOrders.filter(o=>o.source==='door_cash');
                const dcRev=dcOrds.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0),cashRev=cashOrds.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0);
                const dcTix=dcOrds.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0),cashTix=cashOrds.reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0);
                const pctRev=r=>venueRev>0?Math.round(r/venueRev*100)+'%':'0%';
                rows.push(['SALES CHANNEL']);
                rows.push(['Channel','Orders','Tickets','Revenue','% of Revenue']);
                rows.push(['Online',onlineOrders.length,onlineTix,fmt(onlineRev),pctRev(onlineRev)]);
                rows.push(['Door — Card',dcOrds.length,dcTix,fmt(dcRev),pctRev(dcRev)]);
                rows.push(['Door — Cash',cashOrds.length,cashTix,fmt(cashRev),pctRev(cashRev)]);
                rows.push([]);
                const dwR=Array(7).fill(0),dwO=Array(7).fill(0),dwT=Array(7).fill(0);
                for(const o of vo){const i=(new Date(o.date).getDay()+6)%7;dwR[i]+=o.items.reduce((s,x)=>s+x.qty*x.price,0);dwO[i]++;dwT[i]+=o.items.reduce((s,x)=>s+x.qty,0);}
                rows.push(['SALES BY DAY OF WEEK']);
                rows.push(['Day','Orders','Tickets','Revenue','Avg Order Value']);
                ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].forEach((d,i)=>{if(dwO[i]>0)rows.push([d,dwO[i],dwT[i],fmt(dwR[i]),fmt(dwR[i]/dwO[i])]);});
                const csv=rows.map(r=>r.map(c=>typeof c==='string'&&(c.includes(',')||c.includes('"'))?q(c):c).join(',')).join('\n');
                const blob=new Blob([csv],{type:'text/csv'});
                const url=URL.createObjectURL(blob);
                const a=document.createElement('a');
                a.href=url;a.download=`c8tickets-sales-${venue.name.toLowerCase().replace(/[^\w]+/g,'-')}-${new Date().toISOString().slice(0,10)}.csv`;a.click();
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

                <h3 className="dsp" style={{fontSize:18,marginBottom:4}}>This Week vs Last Week</h3>
                <p style={{color:'var(--text3)',fontSize:12,marginBottom:12}}>Always showing live current data — not affected by the period filter above.</p>
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
                  :<div style={{overflowX:"auto",marginBottom:32}}><table className="dt"><thead><tr><th>Event</th><th>Orders</th><th>Tickets Sold</th><th>Revenue</th><th>Capacity</th><th>Remaining</th><th>Sell-Through</th></tr></thead><tbody>{evAvgRows.map(({ev,count,totalTix,totalRev,capacity,evTotalSold,sellThru,remaining})=><tr key={ev.id}><td style={{fontWeight:600}}>{ev.title}</td><td>{count}</td><td>{totalTix}</td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(totalRev)}</td><td style={{color:"var(--text2)"}}>{capacity||"—"}</td><td style={{fontWeight:700,color:remaining===null?"var(--text2)":remaining===0?"var(--red)":remaining/capacity<0.15?"var(--gold)":"var(--green)"}}>{remaining!==null?remaining:"—"}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:60}}><div style={{height:"100%",width:sellThru+"%",background:sellThru>=80?"var(--green)":sellThru>=50?"var(--gold)":"var(--red)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right",color:sellThru>=80?"var(--green)":sellThru>=50?"var(--gold)":"var(--red)",fontWeight:700}}>{capacity?sellThru+"%":"—"}</span></div></td></tr>)}</tbody></table></div>
                }

                <h3 className="dsp" style={{fontSize:18,marginBottom:12}}>Sales Channel</h3>
                <div style={{overflowX:"auto",marginBottom:32}}><table className="dt"><thead><tr><th>Channel</th><th>Orders</th><th>Tickets</th><th>Revenue</th><th>% of Revenue</th></tr></thead><tbody>
                  <tr><td style={{fontWeight:600}}>Online</td><td>{onlineOrders.length}</td><td>{onlineTix}</td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(onlineRev)}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:80}}><div style={{height:"100%",width:(venueRev>0?Math.round(onlineRev/venueRev*100):0)+"%",background:"var(--gold)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right"}}>{venueRev>0?Math.round(onlineRev/venueRev*100):0}%</span></div></td></tr>
                  <tr><td style={{fontWeight:600}}>Door — Card</td><td>{doorOrders.filter(o=>o.source==='door').length}</td><td>{doorOrders.filter(o=>o.source==='door').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0)}</td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(doorOrders.filter(o=>o.source==='door').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0))}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:80}}><div style={{height:"100%",width:(venueRev>0?Math.round(doorOrders.filter(o=>o.source==='door').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0)/venueRev*100):0)+"%",background:"var(--gold)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right"}}>{venueRev>0?Math.round(doorOrders.filter(o=>o.source==='door').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0)/venueRev*100):0}%</span></div></td></tr>
                  <tr><td style={{fontWeight:600}}>Door — Cash</td><td>{doorOrders.filter(o=>o.source==='door_cash').length}</td><td>{doorOrders.filter(o=>o.source==='door_cash').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty,0),0)}</td><td style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(doorOrders.filter(o=>o.source==='door_cash').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0))}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:80}}><div style={{height:"100%",width:(venueRev>0?Math.round(doorOrders.filter(o=>o.source==='door_cash').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0)/venueRev*100):0)+"%",background:"var(--gold)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right"}}>{venueRev>0?Math.round(doorOrders.filter(o=>o.source==='door_cash').reduce((s,o)=>s+o.items.reduce((a,i)=>a+i.qty*i.price,0),0)/venueRev*100):0}%</span></div></td></tr>
                </tbody></table></div>

                <h3 className="dsp" style={{fontSize:18,marginBottom:12}}>Sales by Day of Week</h3>
                {vo.length===0
                  ?<div className="empty" style={{marginBottom:28}}><p>No sales data for this period.</p></div>
                  :(() => {
                    const dowRev=Array(7).fill(0),dowOrders=Array(7).fill(0),dowTix=Array(7).fill(0);
                    for(const o of vo){const idx=(new Date(o.date).getDay()+6)%7;dowRev[idx]+=o.items.reduce((s,i)=>s+i.qty*i.price,0);dowOrders[idx]++;dowTix[idx]+=o.items.reduce((s,i)=>s+i.qty,0);}
                    const DOW_FULL=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
                    const dowMax=Math.max(...dowRev,1);
                    const bestIdx=dowRev.indexOf(Math.max(...dowRev));
                    return <div className="tkt-sec" style={{marginBottom:32,padding:'20px 20px 16px'}}>
                      <div style={{display:'flex',gap:4,alignItems:'flex-end',height:80,marginBottom:8}}>
                        {DOW_FULL.map((d,i)=>{
                          const h=Math.round((dowRev[i]/dowMax)*72);
                          return <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                            <div title={`${d}: $${dowRev[i].toFixed(2)} · ${dowOrders[i]} orders`} style={{width:'100%',height:h||2,background:i===bestIdx?'var(--gold)':'rgba(200,146,42,0.35)',borderRadius:'3px 3px 0 0',transition:'height .3s',minHeight:2}}/>
                            <div style={{fontSize:11,color:i===bestIdx?'var(--gold)':'var(--text3)',fontWeight:i===bestIdx?700:400}}>{d}</div>
                          </div>;
                        })}
                      </div>
                      <div style={{overflowX:'auto',marginTop:12}}><table className="dt"><thead><tr><th>Day</th><th>Orders</th><th>Tickets</th><th>Revenue</th><th>Avg Order</th></tr></thead><tbody>
                        {DOW_FULL.map((d,i)=>dowOrders[i]>0&&<tr key={d} style={i===bestIdx?{background:'rgba(200,146,42,0.06)'}:{}}><td style={{fontWeight:i===bestIdx?700:400,color:i===bestIdx?'var(--gold)':'inherit'}}>{d}{i===bestIdx&&<span style={{marginLeft:6,fontSize:10,color:'var(--gold)',fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>Best</span>}</td><td>{dowOrders[i]}</td><td>{dowTix[i]}</td><td style={{color:'var(--gold)',fontWeight:700}}>{fmtCurrency(dowRev[i])}</td><td style={{color:'var(--text3)'}}>{fmtCurrency(dowRev[i]/dowOrders[i])}</td></tr>)}
                      </tbody></table></div>
                    </div>;
                  })()
                }

                <h3 className="dsp" style={{fontSize:18,marginBottom:4}}>Check-In Rate by Ticket Type</h3>
                <p style={{color:'var(--text3)',fontSize:12,marginBottom:12}}>{reportTicketsLoaded?'Per-ticket accuracy — each ticket counted individually.':'Loading ticket data…'}</p>
                {ciTypeRows.length===0
                  ?<div className="empty" style={{marginBottom:28}}><p>No data for this period.</p></div>
                  :<div style={{overflowX:"auto",marginBottom:32}}><table className="dt"><thead><tr><th>Ticket Type</th><th>Sold</th><th>Checked In</th><th>Rate</th></tr></thead><tbody>{ciTypeRows.map(([type,d])=>{const pct=d.sold>0?Math.round(d.checkedIn/d.sold*100):0;return<tr key={type}><td style={{fontWeight:600}}>{type}</td><td>{d.sold}</td><td>{d.checkedIn}</td><td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"var(--bg4)",borderRadius:99,minWidth:80}}><div style={{height:"100%",width:pct+"%",background:"var(--green)",borderRadius:99}}/></div><span style={{fontSize:12,minWidth:35,textAlign:"right"}}>{pct}%</span></div></td></tr>;})}</tbody></table></div>
                }

                <h3 className="dsp" style={{fontSize:18,marginBottom:6}}>Repeat Buyers</h3>
                <p style={{color:"var(--text3)",fontSize:12,marginBottom:12}}>Buyers with 2 or more orders all-time.</p>
                {repeatBuyers.length===0
                  ?<div className="empty" style={{marginBottom:28}}><p>No repeat buyers yet.</p></div>
                  :<div style={{overflowX:"auto",marginBottom:28}}><table className="dt"><thead><tr><th>Buyer</th><th>Email</th><th>Orders</th><th>Tickets</th><th>Total Spent</th><th>Last Purchase</th></tr></thead><tbody>{repeatBuyers.map((b,i)=><tr key={i}><td style={{fontWeight:600}}>{b.name}</td><td style={{fontSize:12}}>{b.email}</td><td style={{color:"var(--gold)",fontWeight:700}}>{b.orders}</td><td>{b.tix}</td><td style={{fontWeight:700}}>{fmtCurrency(b.total)}</td><td style={{fontSize:12,color:'var(--text3)'}}>{b.lastPurchase?new Date(b.lastPurchase).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'}</td></tr>)}</tbody></table></div>
                }

                <div style={{borderTop:'1px solid var(--border)',paddingTop:20,marginTop:8,marginBottom:isVenueUser?0:28}}>
                  <button className="btn gold" onClick={downloadSalesCSV} disabled={vo.length===0}>Download Sales Report CSV</button>
                  <p style={{fontSize:11,color:'var(--text3)',marginTop:6}}>Exports performance summary, ticket type breakdown, event performance, sales channel, and day-of-week data for the selected period.</p>
                </div>
                {isVenueUser && <div style={{color:'var(--text3)',fontSize:13,marginTop:4}}>Bookkeeping & payout details are visible to C8Tickets administrators only.</div>}
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
                  <ul style={{color:'var(--text3)',fontSize:12,marginBottom:16,paddingLeft:18,lineHeight:1.9}}>
                    <li>6% Idaho sales tax (remitted to state)</li>
                    <li>$2.00/ticket service fee (C8Tickets revenue)</li>
                    <li>{platformFeePct}% platform fee on ticket subtotal (C8Tickets revenue)</li>
                    <li>3.5% + $0.30 processing fee — charged to customers; Stripe's actual rate is 2.9% + $0.30, the 0.6% spread is additional C8Tickets revenue</li>
                    <li>Cash sales carry no processing fee · All figures are for the selected period</li>
                  </ul>
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
                            <tr><td style={{paddingLeft:20,color:'var(--text3)',fontSize:13}}>Pay Venue (after {platformFeePct}% platform fee)</td><td style={{textAlign:'right',color:'var(--text3)',fontSize:13}}>−{fmtCurrency(venuePayNow)}</td></tr>
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

                  {/* Venue Payment Tracker */}
                  {(() => {
                    const trackerVenueId = bkVenueFilter === 'all' ? venue.id : bkVenueFilter;
                    const trackerVenueName = venues.find(v => v.id === trackerVenueId)?.name || 'Venue';
                    const allTrackerOrders = orders.filter(o => o.venueId === trackerVenueId && o.status !== 'cancelled');
                    const allTimeOwed = allTrackerOrders.reduce((s, o) => {
                      const f = bkFees(o);
                      const pf = Math.round(f.ticketSub * PLATFORM_PCT * 100) / 100;
                      const vg = f.ticketSub - pf;
                      const hb = Math.round(vg * hbRate * 100) / 100;
                      return s + (vg - hb);
                    }, 0);
                    const trackerPayouts = venuePayouts.filter(p => p.tenant_id === trackerVenueId);
                    const totalEverPaid = trackerPayouts.reduce((s, p) => s + Number(p.amount), 0);
                    const outstandingBalance = Math.round((allTimeOwed - totalEverPaid) * 100) / 100;
                    return (
                      <div style={{borderTop:'1px solid var(--border)',paddingTop:28,marginTop:24}}>
                        <h3 className="dsp" style={{fontSize:18,marginBottom:16}}>Venue Payment Tracker</h3>
                        <div style={{display:'flex',gap:12,marginBottom:20,flexWrap:'wrap'}}>
                          <div style={{flex:1,minWidth:130,background:'var(--bg3)',borderRadius:'var(--rs)',padding:'14px 18px'}}>
                            <div style={{fontSize:11,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>All-Time Owed</div>
                            <div style={{fontSize:22,fontWeight:700,color:'var(--text)'}}>{fmtCurrency(allTimeOwed)}</div>
                            <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>{trackerVenueName}</div>
                          </div>
                          <div style={{flex:1,minWidth:130,background:'var(--bg3)',borderRadius:'var(--rs)',padding:'14px 18px'}}>
                            <div style={{fontSize:11,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Total Paid</div>
                            <div style={{fontSize:22,fontWeight:700,color:'var(--green)'}}>{fmtCurrency(totalEverPaid)}</div>
                            <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>{trackerPayouts.length} payment{trackerPayouts.length!==1?'s':''}</div>
                          </div>
                          <div style={{flex:1,minWidth:130,background:outstandingBalance>0.005?'rgba(200,146,42,.1)':'rgba(76,175,125,.08)',border:`1px solid ${outstandingBalance>0.005?'rgba(200,146,42,.3)':'rgba(76,175,125,.25)'}`,borderRadius:'var(--rs)',padding:'14px 18px'}}>
                            <div style={{fontSize:11,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Outstanding</div>
                            <div style={{fontSize:22,fontWeight:700,color:outstandingBalance>0.005?'var(--gold)':'var(--green)'}}>{fmtCurrency(outstandingBalance)}</div>
                            <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>{outstandingBalance<=0.005?'All paid up':'Balance due'}</div>
                          </div>
                        </div>
                        <p style={{fontSize:11,color:'var(--text3)',marginBottom:20,lineHeight:1.6}}>
                          Based on all-time non-cancelled orders using current platform fee ({platformFeePct}%) and holdback ({holdbackPct}%) settings. Changing these settings will update the calculation.
                        </p>
                        <div style={{background:'var(--bg3)',borderRadius:'var(--rs)',padding:'16px 18px',marginBottom:20}}>
                          <div style={{fontSize:12,fontWeight:700,color:'var(--text)',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>Record a Payment</div>
                          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'flex-end'}}>
                            <div className="fg" style={{margin:0,minWidth:110}}>
                              <label className="fl">Amount $</label>
                              <input className="fi" type="number" min="0" step="0.01" value={payoutForm.amount} onChange={e=>setPayoutForm({...payoutForm,amount:e.target.value})} placeholder="0.00" />
                            </div>
                            <div className="fg" style={{margin:0,minWidth:150}}>
                              <label className="fl">Date Paid</label>
                              <input className="fi" type="date" value={payoutForm.date} onChange={e=>setPayoutForm({...payoutForm,date:e.target.value})} />
                            </div>
                            <div className="fg" style={{margin:0,flex:1,minWidth:180}}>
                              <label className="fl">Notes (optional)</label>
                              <input className="fi" value={payoutForm.notes} onChange={e=>setPayoutForm({...payoutForm,notes:e.target.value})} placeholder="e.g. Feb 2025 payout" />
                            </div>
                            <button className="btn gold" style={{flexShrink:0,padding:'10px 18px'}} disabled={!payoutForm.amount||!payoutForm.date||savingPayout} onClick={savePayout}>{savingPayout?'Saving…':'Record Payment'}</button>
                          </div>
                        </div>
                        {trackerPayouts.length > 0
                          ? <div style={{overflowX:'auto'}}>
                              <table className="dt">
                                <thead><tr><th>Date</th><th>Amount</th><th>Notes</th><th>Recorded</th><th></th></tr></thead>
                                <tbody>
                                  {trackerPayouts.map(p=>(
                                    <tr key={p.id}>
                                      <td style={{whiteSpace:'nowrap',fontWeight:600}}>{new Date(p.paid_at+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
                                      <td style={{fontWeight:700,color:'var(--green)'}}>{fmtCurrency(Number(p.amount))}</td>
                                      <td style={{color:'var(--text3)',fontSize:13}}>{p.notes||'—'}</td>
                                      <td style={{fontSize:11,color:'var(--text3)'}}>{new Date(p.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</td>
                                      <td><button className="btn" style={{fontSize:11,padding:'4px 10px',color:'var(--red)'}} onClick={()=>deletePayout(p.id)}>Remove</button></td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr style={{borderTop:'2px solid var(--border)'}}>
                                    <td style={{fontWeight:700}}>Total Paid</td>
                                    <td style={{fontWeight:700,color:'var(--green)',fontSize:15}}>{fmtCurrency(totalEverPaid)}</td>
                                    <td colSpan={3}></td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          : <p style={{fontSize:13,color:'var(--text3)'}}>No payments recorded yet — use the form above to log each payout.</p>
                        }
                      </div>
                    );
                  })()}
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
                  <div className="fg"><label className="fl">Type</label><select className="fi" value={promoForm.discountType} onChange={e=>setPromoForm({...promoForm,discountType:e.target.value,discountValue:''})}><option value="percent">% Off</option><option value="flat">$ Off</option></select></div>
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
                            <td style={{fontFamily:'monospace',fontWeight:700,letterSpacing:1}}>
                              {p.code}
                              <button style={{marginLeft:6,background:'none',border:'none',cursor:'pointer',color:'var(--text3)',fontSize:11,padding:'0 2px'}} title="Copy code" onClick={()=>navigator.clipboard.writeText(p.code)}>⧉</button>
                            </td>
                            <td>{p.discount_type==='percent'?`${p.discount_value}% off`:`$${Number(p.discount_value).toFixed(2)} off`}</td>
                            <td>{p.uses_count}{p.max_uses!==null?` / ${p.max_uses}`:''}</td>
                            <td style={{fontSize:12}}>{ev?ev.title:'All Events'}</td>
                            <td style={{fontSize:12}}>{p.expires_at?new Date(p.expires_at).toLocaleDateString():'-'}</td>
                            <td><span className={`badge ${p.active&&!expired&&!maxed?'badge-ok':expired||!p.active?'badge-cancelled':maxed?'badge-warn':'badge-cancelled'}`}>{expired?'Expired':maxed?'Maxed Out':p.active?'Active':'Inactive'}</span></td>
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
                    <option value="venue">Venue Admin — orders, events &amp; reports; no C8Tickets fee data</option>
                    <option value="gate">Gate / Door — scanner only; no orders, revenue, or event management</option>
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

        {modal && editEvt && <div className="modal-bg" onClick={()=>setModal(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-event-heading" onClick={e=>e.stopPropagation()}>
          <h2 id="dlg-event-heading" className="dsp">{events.find(e=>e.id===editEvt.id)?"Edit Event":"New Event"}</h2>
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
          <h3 className="dsp" style={{fontSize:16,margin:"20px 0 4px"}}>Add-ons <span style={{fontWeight:400,fontSize:11,color:"var(--text3)"}}>shown at checkout (drink tokens, VIP, etc.)</span></h3>
          {(editEvt.addons||[]).map((a,i)=>(
            <div key={a.id||i} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr auto",gap:6,marginBottom:6,alignItems:"end"}}>
              <div className="fg" style={{margin:0}}>{i===0&&<label className="fl">Name</label>}<input className="fi" value={a.name} placeholder="Drink Token" onChange={e=>{const x=[...(editEvt.addons||[])];x[i]={...x[i],name:e.target.value};setEditEvt({...editEvt,addons:x})}}/></div>
              <div className="fg" style={{margin:0}}>{i===0&&<label className="fl">Price $</label>}<input className="fi" type="number" min="0" step="0.01" value={a.price} onChange={e=>{const x=[...(editEvt.addons||[])];x[i]={...x[i],price:+e.target.value};setEditEvt({...editEvt,addons:x})}}/></div>
              <div className="fg" style={{margin:0}}>{i===0&&<label className="fl" title="Max per order (blank = unlimited)">Max/order</label>}<input className="fi" type="number" min="1" placeholder="∞" value={a.maxPerOrder??''} onChange={e=>{const x=[...(editEvt.addons||[])];x[i]={...x[i],maxPerOrder:e.target.value===''?null:+e.target.value};setEditEvt({...editEvt,addons:x})}}/></div>
              <button className="qb" style={{marginTop:i===0?22:0}} onClick={()=>{const x=(editEvt.addons||[]).filter((_,j)=>j!==i);setEditEvt({...editEvt,addons:x})}}>×</button>
            </div>
          ))}
          <button className="btn" style={{fontSize:11,marginTop:3}} onClick={()=>setEditEvt({...editEvt,addons:[...(editEvt.addons||[]),{id:`ao_${Date.now().toString(36)}`,name:"",price:0,maxPerOrder:null,active:true}]})}>+ Add Add-on</button>
          <h3 className="dsp" style={{fontSize:16,margin:"20px 0 4px"}}>Checkout Notice <span style={{fontWeight:400,fontSize:11,color:"var(--text3)"}}>shown to buyers before payment (age limits, ID required, etc.)</span></h3>
          <div className="fg"><textarea className="fi" rows={2} value={editEvt.checkoutNotice||''} onChange={e=>setEditEvt({...editEvt,checkoutNotice:e.target.value})} placeholder="e.g. This is a 21+ event. Valid ID required at the door." /></div>
          {(editEvt.checkoutNotice||'').trim() && <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:'var(--bg3)',borderRadius:'var(--rs)'}}>
            <input type="checkbox" id="notice-required-cb" checked={editEvt.checkoutNoticeRequired||false} onChange={e=>setEditEvt({...editEvt,checkoutNoticeRequired:e.target.checked})} style={{width:16,height:16,accentColor:'var(--gold)',cursor:'pointer',flexShrink:0}} />
            <label htmlFor="notice-required-cb" style={{fontSize:13,cursor:'pointer',userSelect:'none'}}>Require buyers to check a box confirming they read this</label>
          </div>}
          {evtErr && <div style={{marginTop:16,padding:'10px 14px',background:'rgba(220,50,50,0.12)',border:'1px solid rgba(220,50,50,0.4)',borderRadius:'var(--rs)',color:'#e05555',fontSize:13}}>{evtErr}</div>}
          <div style={{display:"flex",gap:10,marginTop:12}}><button className="buy" style={{flex:1}} disabled={isSaving} onClick={()=>saveEvt(editEvt)}>{isSaving?"Saving…":"Save Event"}</button><button className="btn" style={{padding:"10px 20px"}} onClick={()=>{setModal(false);setEvtErr('');}}>Cancel</button></div>
        </div></div>}

        {editEmailOrder && <div className="modal-bg" onClick={()=>{setEditEmailOrder(null);setEditEmailValue('');}}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-email-heading" onClick={e=>e.stopPropagation()}>
            <div style={{background:"rgba(179,58,42,.12)",border:"1px solid rgba(179,58,42,.35)",borderRadius:"var(--rs)",padding:"14px 16px",marginBottom:20,display:"flex",gap:12,alignItems:"flex-start"}}>
              <span style={{fontSize:20,lineHeight:1,flexShrink:0}} aria-hidden="true">⚠️</span>
              <div>
                <div style={{fontWeight:700,color:"var(--red)",fontSize:13,marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>Warning — Email Change</div>
                <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.6}}>You are changing the buyer's email address on this order. The buyer will only receive future emails (resends) at the new address. This action does not automatically resend the confirmation.</div>
              </div>
            </div>
            <h2 id="dlg-email-heading" className="dsp" style={{fontSize:20,marginBottom:16}}>Edit Order Email</h2>
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

        {cancelTarget && (()=>{
          const hasStripe = cancelTarget.stripePaymentIntentId && !cancelTarget.stripePaymentIntentId.startsWith('CASH-') && !cancelTarget.stripePaymentIntentId.startsWith('COMP-');
          const isPartial = refundMode === 'partial' && hasStripe;
          return <div className="modal-bg" onClick={()=>{ if (!cancelling) { setCancelTarget(null); setRefundMode('full'); setPartialRefundAmt(''); } }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-cancel-heading" onClick={e=>e.stopPropagation()}>
            <div style={{background:"rgba(179,58,42,.12)",border:"1px solid rgba(179,58,42,.35)",borderRadius:"var(--rs)",padding:"14px 16px",marginBottom:20,display:"flex",gap:12,alignItems:"flex-start"}}>
              <span style={{fontSize:20,lineHeight:1,flexShrink:0}} aria-hidden="true">⚠️</span>
              <div>
                <div style={{fontWeight:700,color:"var(--red)",fontSize:13,marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>{isPartial ? 'Partial Refund' : 'Warning — Refund & Cancellation'}</div>
                <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.6}}>
                  {isPartial
                    ? <>A partial refund will be issued to the buyer's original payment method. <strong style={{color:"var(--text)"}}>The order stays valid</strong> — tickets are not cancelled.</>
                    : hasStripe
                      ? <>Cancelling this order will <strong style={{color:"var(--text)"}}>immediately issue a full refund</strong> to the buyer's original payment method via Stripe. Tickets will be returned to available inventory. This action cannot be undone.</>
                      : <>Cancelling this order will return tickets to available inventory. <strong style={{color:"var(--text)"}}>No Stripe refund will be issued</strong> — handle any cash or manual refund separately. This action cannot be undone.</>
                  }
                </div>
              </div>
            </div>
            <h2 id="dlg-cancel-heading" className="dsp" style={{fontSize:20,marginBottom:16}}>{isPartial ? 'Issue Partial Refund' : 'Cancel Order'}</h2>
            <div style={{marginBottom:16,padding:"10px 14px",background:"var(--bg3)",borderRadius:"var(--rs)",fontSize:12,lineHeight:1.8}}>
              <span style={{color:"var(--text3)"}}>Order: </span><span style={{fontFamily:"monospace",color:"var(--text)"}}>{cancelTarget.id.slice(0,12).toUpperCase()}</span><br/>
              <span style={{color:"var(--text3)"}}>Buyer: </span><span style={{color:"var(--text)"}}>{cancelTarget.buyer.name}</span><br/>
              <span style={{color:"var(--text3)"}}>Email: </span><span style={{color:"var(--text)"}}>{cancelTarget.buyer.email||"—"}</span><br/>
              <span style={{color:"var(--text3)"}}>Order total: </span><span style={{color:"var(--gold)",fontWeight:700}}>{fmtCurrency(cancelTarget.total)}</span>
              {!hasStripe && <><br/><span style={{color:"var(--red)"}}>No Stripe payment on file — order will be cancelled without a refund.</span></>}
            </div>
            {hasStripe && <div style={{marginBottom:16}}>
              <div style={{fontSize:11,color:"var(--text3)",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Refund Type</div>
              <div style={{display:"flex",gap:8}}>
                {[['full','Full Refund + Cancel'],['partial','Partial Refund Only']].map(([val,label])=>(
                  <button key={val} onClick={()=>{setRefundMode(val);setPartialRefundAmt('');}} style={{flex:1,padding:"8px 12px",border:`2px solid ${refundMode===val?"var(--gold)":"var(--border)"}`,borderRadius:6,background:refundMode===val?"rgba(200,146,42,0.1)":"var(--card)",cursor:"pointer",color:"var(--text)",fontSize:12,fontWeight:refundMode===val?700:400}}>{label}</button>
                ))}
              </div>
              {isPartial && <div style={{marginTop:10}}>
                <label className="fl">Amount to refund ($)</label>
                <input className="fi" type="number" min="0.01" max={cancelTarget.total} step="0.01" placeholder={`Max ${fmtCurrency(cancelTarget.total)}`} value={partialRefundAmt} onChange={e=>setPartialRefundAmt(e.target.value)} style={{marginTop:4}}/>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>Order remains valid. Use for comping part of an order or correcting an overcharge.</div>
              </div>}
            </div>}
            <div style={{display:"flex",gap:10,marginTop:4}}>
              <button className="buy" style={{flex:1,background:"var(--red)",borderColor:"var(--red)"}} disabled={cancelling||(isPartial&&!partialRefundAmt)} onClick={confirmCancelOrder}>
                {cancelling ? "Processing..." : isPartial ? `Refund ${partialRefundAmt?fmtCurrency(parseFloat(partialRefundAmt)):'amount'}` : "Confirm — Cancel & Refund"}
              </button>
              <button className="btn" style={{padding:"10px 20px"}} disabled={cancelling} onClick={()=>{setCancelTarget(null);setRefundMode('full');setPartialRefundAmt('');}}>Go Back</button>
            </div>
          </div>
        </div>;})()}

        {compModal && <div className="modal-bg" onClick={()=>setCompModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-comp-heading" onClick={e=>e.stopPropagation()} style={{maxWidth:480}}>
            <h2 id="dlg-comp-heading" className="dsp" style={{fontSize:20,marginBottom:4}}>Issue Comp Tickets</h2>
            <p style={{color:"var(--text2)",fontSize:13,marginBottom:20}}>Generate free tickets for a guest. An email confirmation with QR code will be sent if an email address is provided.</p>
            <div className="fg">
              <label className="fl">Event *</label>
              <select className="fi" value={compForm.eventId} onChange={e=>setCompForm(f=>({...f,eventId:e.target.value,ticketTypeId:''}))}>
                <option value="">Select event…</option>
                {events.filter(e=>e.published!==false).map(e=><option key={e.id} value={e.id}>{e.title} — {fmtDate(e.date)}</option>)}
              </select>
            </div>
            {compForm.eventId && <div className="fg">
              <label className="fl">Ticket Type *</label>
              <select className="fi" value={compForm.ticketTypeId} onChange={e=>setCompForm(f=>({...f,ticketTypeId:e.target.value}))}>
                <option value="">Select type…</option>
                {(events.find(e=>e.id===compForm.eventId)?.tickets||[]).map(t=><option key={t.id} value={t.id}>{t.type} ({t.available} available)</option>)}
              </select>
            </div>}
            <div className="fg">
              <label className="fl">Quantity *</label>
              <input className="fi" type="number" min="1" max="20" value={compForm.qty} onChange={e=>setCompForm(f=>({...f,qty:Math.max(1,parseInt(e.target.value)||1)}))}/>
            </div>
            <div className="fg">
              <label className="fl">Guest Name *</label>
              <input className="fi" placeholder="Full name" value={compForm.name} onChange={e=>setCompForm(f=>({...f,name:e.target.value}))}/>
            </div>
            <div className="fg">
              <label className="fl">Guest Email (optional)</label>
              <input className="fi" type="email" placeholder="email@example.com" value={compForm.email} onChange={e=>setCompForm(f=>({...f,email:e.target.value}))}/>
            </div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button className="buy" style={{flex:1}} disabled={compSaving||!compForm.eventId||!compForm.ticketTypeId||!compForm.name.trim()} onClick={saveComp}>{compSaving?"Issuing…":"Issue Comp Tickets"}</button>
              <button className="btn" style={{padding:"10px 20px"}} disabled={compSaving} onClick={()=>setCompModal(false)}>Cancel</button>
            </div>
          </div>
        </div>}

        {ticketSizeModal && <div className="modal-bg" onClick={()=>setTicketSizeModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-ticketsize-heading" onClick={e=>e.stopPropagation()} style={{maxWidth:540}}>
            <h2 id="dlg-ticketsize-heading" className="dsp" style={{fontSize:22,marginBottom:6}}>Choose Ticket Size</h2>
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