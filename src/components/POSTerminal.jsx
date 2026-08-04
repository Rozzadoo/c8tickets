import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../constants';
import { fmtCurrency, fetchWithTimeout } from '../lib/utils';

const CAT_LABELS = { food: 'Food', beverage: 'Beverage', merchandise: 'Merch', ticket: 'Ticket', other: 'Other' };
const CAT_COLORS = { food: 'var(--green)', beverage: '#4a9eff', merchandise: 'var(--gold)', ticket: 'var(--red)', other: 'var(--text3)' };

export default function POSTerminal({ tenantId, venue, events = [], onClose, shift, onCloseShift }) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [catFilter, setCatFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState(null);

  const [cart, setCart] = useState([]);
  const [modModal, setModModal] = useState(null);
  const [selectedMods, setSelectedMods] = useState({});

  const [step, setStep] = useState('sell');
  const [tendered, setTendered] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

  // 3.4 Offline mode
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`pos_queue_${tenantId}`) || '[]'); } catch { return []; }
  });
  const [syncing, setSyncing] = useState(false);
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [lastSyncError, setLastSyncError] = useState(null);

  // 3.5 Cash tracking (accumulates within this terminal session)
  const [cashSalesThisSession, setCashSalesThisSession] = useState(0);

  // Stripe Terminal
  const [terminal, setTerminal] = useState(null);
  const [readers, setReaders] = useState([]);
  const [connectedReader, setConnectedReader] = useState(null);
  const [readerDiscovering, setReaderDiscovering] = useState(false);
  const [readerConnecting, setReaderConnecting] = useState(false);
  const [readerError, setReaderError] = useState('');
  const [terminalStatus, setTerminalStatus] = useState('idle');
  const [loadingIntent, setLoadingIntent] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => { loadItems(); }, []);

  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  useEffect(() => {
    if (isOnline && offlineQueue.length > 0) syncQueue();
  }, [isOnline]);

  async function loadItems() {
    setLoaded(false);
    const { data } = await supabase
      .from('pos_items')
      .select('*, pos_modifiers(*)')
      .eq('tenant_id', tenantId)
      .eq('available', true)
      .order('sort_order').order('name');
    setItems(data || []);
    setLoaded(true);
  }

  // ── Offline queue sync ───────────────────────────────────────────────
  // syncEntry pushes one queued order to Supabase; returns { ok, error }.
  // Failure keeps the entry in the queue with an updated `attempts` count + `lastError`.
  async function syncEntry(entry) {
    try {
      const { data: order, error: orderErr } = await supabase.from('pos_orders').insert(entry.orderPayload).select().single();
      if (orderErr || !order) return { ok: false, error: orderErr?.message || 'Order insert returned no row' };
      const { error: itemsErr } = await supabase.from('pos_order_items').insert(
        entry.items.map(i => ({ ...i, pos_order_id: order.id }))
      );
      if (itemsErr) return { ok: false, error: 'Items insert failed after order created: ' + itemsErr.message };
      for (const u of (entry.inventoryUpdates || [])) {
        const { error: invErr } = await supabase.from('pos_items').update({ inventory_qty: u.inventory_qty }).eq('id', u.id);
        if (invErr) return { ok: false, error: 'Inventory update failed after order created: ' + invErr.message };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || 'Network error' };
    }
  }

  async function syncQueue() {
    setSyncing(true);
    setLastSyncError(null);
    const remaining = [];
    let firstError = null;
    for (const entry of offlineQueue) {
      const { ok, error } = await syncEntry(entry);
      if (!ok) {
        remaining.push({ ...entry, attempts: (entry.attempts || 0) + 1, lastError: error, lastAttemptAt: new Date().toISOString() });
        if (!firstError) firstError = error;
      }
    }
    setOfflineQueue(remaining);
    localStorage.setItem(`pos_queue_${tenantId}`, JSON.stringify(remaining));
    setSyncing(false);
    if (firstError) setLastSyncError(firstError);
  }

  async function retryEntry(entryId) {
    const entry = offlineQueue.find(e => e.id === entryId);
    if (!entry) return;
    setSyncing(true);
    const { ok, error } = await syncEntry(entry);
    const updated = ok
      ? offlineQueue.filter(e => e.id !== entryId)
      : offlineQueue.map(e => e.id !== entryId ? e : { ...e, attempts: (e.attempts || 0) + 1, lastError: error, lastAttemptAt: new Date().toISOString() });
    setOfflineQueue(updated);
    localStorage.setItem(`pos_queue_${tenantId}`, JSON.stringify(updated));
    setSyncing(false);
    if (!ok) setLastSyncError(error);
  }

  function deleteEntry(entryId) {
    const entry = offlineQueue.find(e => e.id === entryId);
    if (!entry) return;
    if (!confirm(`Permanently delete queued order (${fmtCurrency(entry.orderPayload?.total || 0)})?\n\nThis does NOT refund anything. Only delete if you've manually reconciled this sale.`)) return;
    const updated = offlineQueue.filter(e => e.id !== entryId);
    setOfflineQueue(updated);
    localStorage.setItem(`pos_queue_${tenantId}`, JSON.stringify(updated));
  }

  // ── Cart helpers ─────────────────────────────────────────────────────
  function openModModal(item) {
    const mods = item.pos_modifiers || [];
    if (mods.length === 0) { addToCart(item, [], 0); return; }
    const initial = {};
    mods.forEach((m, i) => { if (Array.isArray(m.options) && m.options.length > 0) initial[i] = 0; });
    setSelectedMods(initial);
    setModModal(item);
  }

  function confirmMods() {
    if (!modModal) return;
    const mods = modModal.pos_modifiers || [];
    const selected = [];
    let extraDelta = 0;
    mods.forEach((m, i) => {
      const oi = selectedMods[i];
      if (oi !== undefined && m.options?.[oi]) {
        const opt = m.options[oi];
        selected.push({ name: m.name, label: opt.label, priceDelta: parseFloat(opt.price_delta) || 0 });
        extraDelta += parseFloat(opt.price_delta) || 0;
      }
    });
    addToCart(modModal, selected, extraDelta);
    setModModal(null);
  }

  function addToCart(item, mods, extraDelta) {
    const modKey = mods.map(m => `${m.name}:${m.label}`).sort().join('|');
    const key = item.id + '|' + modKey;
    const unitPrice = parseFloat(item.price) + extraDelta;
    setCart(prev => {
      const existing = prev.find(c => c.key === key);
      if (existing) return prev.map(c => c.key === key ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { key, item, selectedMods: mods, qty: 1, unitPrice }];
    });
  }

  function updateQty(key, delta) {
    setCart(prev => prev.map(c => c.key === key ? { ...c, qty: c.qty + delta } : c).filter(c => c.qty > 0));
  }

  const cartSubtotal = cart.reduce((s, c) => s + c.unitPrice * c.qty, 0);
  const cartTax = cart.reduce((s, c) => s + Math.round(c.unitPrice * c.qty * parseFloat(c.item.tax_rate || 0.06) * 100) / 100, 0);
  const cartTotal = Math.round((cartSubtotal + cartTax) * 100) / 100;

  // ── Save POS order (online + offline paths) ──────────────────────────
  async function savePosOrder(paymentType, paymentIntentId = null, cashData = null) {
    const orderPayload = {
      tenant_id: tenantId,
      event_id: eventFilter || null,
      payment_type: paymentType,
      stripe_payment_intent_id: paymentIntentId,
      stripe_reader_id: connectedReader?.id || null,
      subtotal: Math.round(cartSubtotal * 100) / 100,
      tax: Math.round(cartTax * 100) / 100,
      total: cartTotal,
      cash_tendered: cashData?.tendered ?? null,
      change_due: cashData?.change ?? null,
      status: 'paid',
    };
    const itemsPayload = cart.map(c => ({
      item_id: c.item.id,
      item_name: c.item.name,
      category: c.item.category,
      modifier_summary: c.selectedMods.length > 0
        ? c.selectedMods.map(m => `${m.name}: ${m.label}`).join(', ')
        : null,
      quantity: c.qty,
      unit_price: c.unitPrice,
      tax_rate: parseFloat(c.item.tax_rate) || 0.06,
    }));
    const inventoryUpdates = cart
      .filter(c => c.item.track_inventory && c.item.inventory_qty != null)
      .map(c => ({ id: c.item.id, inventory_qty: Math.max(0, c.item.inventory_qty - c.qty) }));

    if (!isOnline) {
      const entry = {
        id: `offline_${Date.now()}`,
        orderPayload,
        items: itemsPayload,
        inventoryUpdates,
        queuedAt: new Date().toISOString(),
      };
      const newQueue = [...offlineQueue, entry];
      setOfflineQueue(newQueue);
      localStorage.setItem(`pos_queue_${tenantId}`, JSON.stringify(newQueue));
      if (paymentType === 'cash') setCashSalesThisSession(p => p + cartTotal);
      setLastOrder({ id: entry.id, paymentType, total: cartTotal, items: [...cart], cashData, offline: true });
      setStep('confirm');
      return;
    }

    setSaving(true);
    const { data: order, error } = await supabase.from('pos_orders').insert(orderPayload).select().single();
    if (error || !order) {
      setSaving(false);
      alert('Order save failed. Please try again.');
      return;
    }

    await supabase.from('pos_order_items').insert(itemsPayload.map(i => ({ ...i, pos_order_id: order.id })));
    for (const u of inventoryUpdates) {
      await supabase.from('pos_items').update({ inventory_qty: u.inventory_qty }).eq('id', u.id);
    }
    if (paymentType === 'cash') setCashSalesThisSession(p => p + cartTotal);

    setSaving(false);
    setLastOrder({ id: order.id, paymentType, total: cartTotal, items: [...cart], cashData });
    setStep('confirm');
  }

  // ── Cash ─────────────────────────────────────────────────────────────
  async function handleCash() {
    const t = parseFloat(tendered);
    if (isNaN(t) || t < cartTotal) return;
    const change = Math.round((t - cartTotal) * 100) / 100;
    await savePosOrder('cash', `POS-CASH-${Date.now()}`, { tendered: t, change });
  }

  // ── Stripe Terminal ───────────────────────────────────────────────────
  const initAndDiscover = async () => {
    setReaderError(''); setReaders([]); setReaderDiscovering(true);
    try {
      const { loadStripeTerminal } = await import('@stripe/terminal-js');
      const StripeTerminal = await loadStripeTerminal();
      const term = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const { data: { session: s } } = await supabase.auth.getSession();
          const r = await fetch(API_BASE + '/api/terminal?action=connection-token', {
            method: 'POST', headers: { Authorization: `Bearer ${s?.access_token || ''}` },
          });
          const d = await r.json();
          if (d.error) throw new Error(d.error);
          return d.secret;
        },
        onUnexpectedReaderDisconnect: () => {
          setConnectedReader(null); setTerminalStatus('idle');
          setReaderError('Reader disconnected unexpectedly.');
        },
      });
      setTerminal(term);
      const result = await term.discoverReaders({ simulated: false, discoveryMethod: 'internet' });
      setReaderDiscovering(false);
      if (result.error) setReaderError(result.error.message);
      else if (result.discoveredReaders.length === 0) setReaderError('No readers found. Make sure the reader is powered on and connected.');
      else setReaders(result.discoveredReaders);
    } catch (err) {
      setReaderDiscovering(false);
      setReaderError(err.message || 'Failed to initialize terminal.');
    }
  };

  const connectReader = async (reader) => {
    setReaderConnecting(true); setReaderError('');
    const result = await terminal.connectReader(reader, { fail_if_in_use: false });
    setReaderConnecting(false);
    if (result.error) setReaderError(result.error.message);
    else { setConnectedReader(result.reader); setReaders([]); }
  };

  const disconnectReader = async () => {
    if (terminal) await terminal.disconnectReader().catch(() => {});
    setConnectedReader(null); setTerminal(null); setReaders([]); setReaderError('');
  };

  const startTerminalPayment = async () => {
    if (!terminal || !connectedReader || cart.length === 0) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    const { data: { session: s } } = await supabase.auth.getSession();
    setLoadingIntent(true);
    let data;
    try {
      const res = await fetchWithTimeout(API_BASE + '/api/terminal?action=pos-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token || ''}` },
        body: JSON.stringify({
          tenantId,
          cartItems: cart.map(c => ({
            itemId: c.item.id,
            qty: c.qty,
            modifierDelta: c.selectedMods.reduce((s, m) => s + (m.priceDelta || 0), 0),
          })),
        }),
      }, 15000);
      data = await res.json();
    } catch (e) {
      setLoadingIntent(false);
      submittingRef.current = false;
      alert(e.message === 'timeout'
        ? 'Reader payment setup timed out. No charge was made — try again.'
        : 'Reader payment setup failed. Please try again.');
      return;
    }
    setLoadingIntent(false);
    submittingRef.current = false;
    if (!data.clientSecret) { alert(data.error || 'Payment setup failed. Please try again.'); return; }
    setTerminalStatus('waiting_for_card');
    const collectResult = await terminal.collectPaymentMethod(data.clientSecret);
    if (collectResult.error) {
      if (collectResult.error.code !== 'canceled') alert(collectResult.error.message);
      setTerminalStatus('idle'); return;
    }
    setTerminalStatus('processing');
    const processResult = await terminal.processPayment(collectResult.paymentIntent);
    if (processResult.error) { alert(processResult.error.message); setTerminalStatus('idle'); return; }
    setTerminalStatus('idle');
    await savePosOrder('card', processResult.paymentIntent.id);
  };

  const cancelTerminalPayment = async () => {
    if (terminal) await terminal.cancelCollectPaymentMethod().catch(() => {});
    setTerminalStatus('idle');
  };

  const newSale = () => {
    setCart([]); setStep('sell'); setTendered(''); setLastOrder(null);
    setTerminalStatus('idle'); loadItems();
  };

  // ── Filtered items ───────────────────────────────────────────────────
  const filteredItems = items.filter(item => {
    if (catFilter !== 'all' && item.category !== catFilter) return false;
    if (eventFilter && item.event_id && item.event_id !== eventFilter) return false;
    return true;
  });
  const categories = [...new Set(items.map(i => i.category))];

  // Cash drawer total (shift opening + all cash sales this session)
  const drawerTotal = shift ? (parseFloat(shift.opening_cash || 0) + cashSalesThisSession) : null;

  // ── Confirmation ─────────────────────────────────────────────────────
  if (step === 'confirm' && lastOrder) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', maxWidth: 420, margin: '0 auto' }}>
        <div style={{ fontSize: 56, marginBottom: 12, color: 'var(--green)' }}>✓</div>
        <h2 className="dsp" style={{ fontSize: 28, marginBottom: 6, color: 'var(--green)' }}>Sale Complete</h2>
        <p style={{ color: 'var(--text2)', marginBottom: lastOrder.cashData ? 12 : 24, fontSize: 16 }}>
          {lastOrder.paymentType === 'cash' ? '💵 Cash' : '💳 Card'} · {fmtCurrency(lastOrder.total)}
          {lastOrder.offline && <span style={{ fontSize: 12, color: 'var(--gold)', marginLeft: 8 }}>saved offline</span>}
        </p>
        {lastOrder.cashData && lastOrder.cashData.change > 0 && (
          <div style={{ background: 'rgba(93,138,60,.15)', borderRadius: 'var(--rs)', padding: '12px 20px', marginBottom: 20, fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>
            Change: {fmtCurrency(lastOrder.cashData.change)}
          </div>
        )}
        <div style={{ background: 'var(--bg3)', borderRadius: 'var(--rs)', padding: 16, marginBottom: 28, textAlign: 'left' }}>
          {lastOrder.items.map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 14 }}>
              <span>
                {c.qty}× {c.item.name}
                {c.selectedMods.length > 0 && <span style={{ color: 'var(--text3)', fontSize: 12 }}> ({c.selectedMods.map(m => m.label).join(', ')})</span>}
              </span>
              <span style={{ fontWeight: 600 }}>{fmtCurrency(c.unitPrice * c.qty)}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
            <span>Total</span><span style={{ color: 'var(--gold)' }}>{fmtCurrency(lastOrder.total)}</span>
          </div>
        </div>
        <button className="buy" style={{ width: '100%', maxWidth: 280, margin: '0 auto', display: 'block', fontSize: 18, padding: '14px 20px' }} onClick={newSale}>
          + New Sale
        </button>
      </div>
    );
  }

  // ── Payment screen ────────────────────────────────────────────────────
  if (step === 'payment') {
    const t = parseFloat(tendered);
    const change = !isNaN(t) ? Math.round((t - cartTotal) * 100) / 100 : null;

    const ReaderPanel = () => {
      if (!isOnline) return (
        <div style={{ padding: '12px 14px', background: 'rgba(179,58,42,.1)', borderRadius: 'var(--rs)', fontSize: 13, color: 'var(--red)' }}>
          Card payments unavailable while offline.
        </div>
      );
      if (terminalStatus === 'waiting_for_card') return (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>💳</div>
          <p style={{ color: 'var(--text2)', marginBottom: 16 }}>Present card to reader…</p>
          <button className="btn" onClick={cancelTerminalPayment}>Cancel</button>
        </div>
      );
      if (terminalStatus === 'processing') return (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <p style={{ color: 'var(--text2)' }}>Processing…</p>
        </div>
      );
      if (connectedReader) return (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg3)', borderRadius: 'var(--rs)', marginBottom: 10 }}>
            <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', flexShrink: 0, display: 'inline-block' }}/>
              {connectedReader.label || connectedReader.serial_number}
            </span>
            <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={disconnectReader}>Disconnect</button>
          </div>
          <button className="buy" style={{ width: '100%' }} disabled={loadingIntent || saving} onClick={startTerminalPayment}>
            {loadingIntent ? 'Preparing…' : '💳 Charge to Reader'}
          </button>
        </div>
      );
      return (
        <div style={{ padding: '12px 14px', background: 'var(--bg3)', borderRadius: 'var(--rs)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: readers.length > 0 || readerError ? 10 : 0 }}>
            <span style={{ color: 'var(--text3)', fontSize: 13 }}>No reader connected</span>
            <button className="btn" style={{ fontSize: 12, padding: '4px 10px' }} disabled={readerDiscovering} onClick={initAndDiscover}>
              {readerDiscovering ? 'Searching…' : 'Find Reader'}
            </button>
          </div>
          {readerError && <p style={{ color: 'var(--red)', fontSize: 12, margin: '6px 0 0' }}>{readerError}</p>}
          {readers.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg2)', borderRadius: 6, padding: '6px 10px', marginTop: 6 }}>
              <span style={{ fontSize: 13 }}>{r.label || r.serial_number}</span>
              <button className="btn" style={{ fontSize: 12, padding: '3px 8px' }} disabled={readerConnecting} onClick={() => connectReader(r)}>
                {readerConnecting ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          ))}
        </div>
      );
    };

    return (
      <div style={{ maxWidth: 480, paddingBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button className="btn" onClick={() => setStep('sell')}>← Back</button>
          <h2 className="dsp" style={{ fontSize: 22, margin: 0 }}>Collect Payment</h2>
        </div>
        <div style={{ background: 'var(--bg3)', borderRadius: 'var(--rs)', padding: 16, marginBottom: 24 }}>
          {cart.map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
              <span>
                {c.qty}× {c.item.name}
                {c.selectedMods.length > 0 && <span style={{ color: 'var(--text3)', fontSize: 12 }}> — {c.selectedMods.map(m => m.label).join(', ')}</span>}
              </span>
              <span>{fmtCurrency(c.unitPrice * c.qty)}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text3)', marginBottom: 3 }}>
              <span>Subtotal</span><span>{fmtCurrency(cartSubtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text3)', marginBottom: 8 }}>
              <span>Tax</span><span>{fmtCurrency(cartTax)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 22 }}>
              <span>Total</span><span style={{ color: 'var(--gold)' }}>{fmtCurrency(cartTotal)}</span>
            </div>
          </div>
        </div>

        <h3 className="dsp" style={{ fontSize: 16, marginBottom: 10 }}>💵 Cash</h3>
        <div className="fg" style={{ marginBottom: 8 }}>
          <label className="fl">Amount Tendered</label>
          <input className="fi" type="number" min="0" step="0.01" value={tendered} onChange={e => setTendered(e.target.value)} placeholder={cartTotal.toFixed(2)} autoFocus />
        </div>
        {change !== null && change >= 0 && (
          <div style={{ padding: '10px 14px', borderRadius: 'var(--rs)', background: 'rgba(93,138,60,.15)', color: 'var(--green)', fontWeight: 700, fontSize: 22, textAlign: 'center', marginBottom: 10 }}>
            Change: {fmtCurrency(change)}
          </div>
        )}
        {change !== null && change < 0 && (
          <div style={{ padding: '8px 14px', borderRadius: 'var(--rs)', background: 'rgba(179,58,42,.12)', color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>
            Short by {fmtCurrency(Math.abs(change))}
          </div>
        )}
        <button
          className="buy"
          style={{ width: '100%', background: 'var(--green)', borderColor: 'var(--green)', marginBottom: 28 }}
          disabled={saving || change === null || change < 0}
          onClick={handleCash}
        >
          {saving ? 'Processing…' : '✓ Cash Collected — Complete Sale'}
        </button>

        <h3 className="dsp" style={{ fontSize: 16, marginBottom: 10 }}>💳 Card (Stripe Reader)</h3>
        <ReaderPanel />
      </div>
    );
  }

  // ── Main sell screen ─────────────────────────────────────────────────
  return (
    <div>
      {/* Offline banner */}
      {!isOnline && (
        <div style={{ background: 'rgba(179,58,42,.15)', border: '1px solid rgba(179,58,42,.4)', borderRadius: 'var(--rs)', padding: '8px 14px', marginBottom: 12, fontSize: 13, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⚠</span>
          <span><strong>Offline</strong> — cash sales are queued locally and will sync when you reconnect. Card payments unavailable.</span>
        </div>
      )}
      {isOnline && syncing && (
        <div style={{ background: 'rgba(200,146,42,.12)', border: '1px solid rgba(200,146,42,.3)', borderRadius: 'var(--rs)', padding: '8px 14px', marginBottom: 12, fontSize: 13, color: 'var(--gold)' }}>
          🔄 Syncing offline orders…
        </div>
      )}
      {isOnline && !syncing && offlineQueue.length > 0 && (
        <div style={{ background: 'rgba(200,146,42,.12)', border: '1px solid rgba(200,146,42,.3)', borderRadius: 'var(--rs)', padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--gold)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>
            <strong>{offlineQueue.length}</strong> offline order{offlineQueue.length !== 1 ? 's' : ''} pending sync
            {offlineQueue.some(e => e.lastError) && <> — some are failing</>}
          </span>
          <div style={{display:'flex',gap:6}}>
            <button className="btn" style={{ fontSize: 12, padding: '6px 12px', minHeight: 36 }} onClick={() => setShowQueueModal(true)}>View</button>
            <button className="btn" style={{ fontSize: 12, padding: '6px 12px', minHeight: 36 }} onClick={syncQueue}>Sync All</button>
          </div>
        </div>
      )}
      {lastSyncError && !syncing && (
        <div style={{ background: 'rgba(179,58,42,.15)', border: '1px solid rgba(179,58,42,.4)', borderRadius: 'var(--rs)', padding: '10px 14px', marginBottom: 12, fontSize: 12, color: 'var(--red)', display:'flex', justifyContent:'space-between', alignItems:'center', gap: 8 }}>
          <span>Sync error: {lastSyncError}</span>
          <button className="btn" style={{fontSize:11,padding:'4px 10px'}} onClick={() => setLastSyncError(null)}>Dismiss</button>
        </div>
      )}

      {showQueueModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowQueueModal(false)}>
          <div style={{ background: 'var(--bg2)', borderRadius: 'var(--rs)', padding: 20, maxWidth: 560, width: '100%', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <h3 className="dsp" style={{fontSize:20,margin:0}}>Pending Sync ({offlineQueue.length})</h3>
              <button className="btn" onClick={() => setShowQueueModal(false)} style={{minHeight:36}}>Close</button>
            </div>
            {offlineQueue.length === 0 ? (
              <div style={{textAlign:'center',padding:'30px 20px',color:'var(--text3)'}}>Queue is empty. All orders synced.</div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {offlineQueue.map(entry => {
                  const failing = (entry.attempts || 0) > 0;
                  return (
                    <div key={entry.id} style={{background:'var(--bg3)',borderRadius:'var(--rs)',padding:12,border:failing?'1px solid rgba(179,58,42,.4)':'1px solid var(--border)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,marginBottom:8}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:700,fontSize:14}}>{fmtCurrency(entry.orderPayload?.total || 0)} · {entry.orderPayload?.payment_type || '—'}</div>
                          <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>
                            Queued {new Date(entry.queuedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
                            {' · '}{entry.items?.length || 0} item{entry.items?.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <div style={{display:'flex',gap:6,flexShrink:0}}>
                          <button className="buy" style={{fontSize:11,padding:'6px 12px',minHeight:36}} onClick={() => retryEntry(entry.id)} disabled={syncing}>Retry</button>
                          <button className="btn" style={{fontSize:11,padding:'6px 12px',minHeight:36,color:'var(--red)'}} onClick={() => deleteEntry(entry.id)} disabled={syncing}>Delete</button>
                        </div>
                      </div>
                      {entry.items && entry.items.length > 0 && (
                        <div style={{fontSize:11,color:'var(--text3)',marginBottom:failing ? 8 : 0,paddingLeft:2}}>
                          {entry.items.map(i => `${i.quantity}× ${i.item_name}`).join(' · ')}
                        </div>
                      )}
                      {failing && entry.lastError && (
                        <div style={{fontSize:11,color:'var(--red)',padding:'6px 8px',background:'rgba(179,58,42,.1)',borderRadius:4,marginTop:6}}>
                          <strong>Failed {entry.attempts}× —</strong> {entry.lastError}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{marginTop:16,fontSize:11,color:'var(--text3)',lineHeight:1.5}}>
              Retry re-attempts a single order. Delete removes it from the queue permanently (does NOT refund). Only delete if you've manually reconciled the sale.
            </div>
          </div>
        </div>
      )}

      {/* Modifier modal */}
      {modModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg2)', borderRadius: 'var(--rs)', padding: 24, maxWidth: 380, width: '100%' }}>
            <h3 className="dsp" style={{ fontSize: 20, marginBottom: 2 }}>{modModal.name}</h3>
            <p style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{fmtCurrency(parseFloat(modModal.price))}</p>
            {(modModal.pos_modifiers || []).map((mod, mi) => (
              <div key={mi} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text3)', marginBottom: 8 }}>
                  {mod.name}{mod.required ? ' *' : ''}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(mod.options || []).map((opt, oi) => (
                    <button
                      key={oi}
                      className={`btn${selectedMods[mi] === oi ? ' gold' : ''}`}
                      style={{ fontSize: 14, padding: '7px 14px' }}
                      onClick={() => setSelectedMods(prev => ({ ...prev, [mi]: oi }))}
                    >
                      {opt.label}
                      {parseFloat(opt.price_delta) > 0 && <span style={{ opacity: 0.75, marginLeft: 4 }}>+{fmtCurrency(opt.price_delta)}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button
                className="btn gold"
                style={{ flex: 1, fontSize: 15, padding: '10px' }}
                disabled={(modModal.pos_modifiers || []).some((m, i) => m.required && selectedMods[i] === undefined)}
                onClick={confirmMods}
              >
                Add to Cart
              </button>
              <button className="btn" style={{ padding: '10px 16px' }} onClick={() => setModModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', height: 'calc(100vh - 160px)', minHeight: 500, gap: 0, overflow: 'hidden' }}>
        {/* Left: item grid */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 16 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {['all', ...categories].map(cat => (
              <button
                key={cat}
                className={`btn${catFilter === cat ? ' gold' : ''}`}
                style={{ fontSize: 12, padding: '5px 10px' }}
                onClick={() => setCatFilter(cat)}
              >
                {cat === 'all' ? 'All' : (CAT_LABELS[cat] || cat)}
              </button>
            ))}
            {events.length > 0 && (
              <select
                className="fi"
                style={{ margin: 0, fontSize: 12, height: 'auto', width: 'auto', marginLeft: 'auto' }}
                value={eventFilter || ''}
                onChange={e => setEventFilter(e.target.value || null)}
              >
                <option value="">All events</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
              </select>
            )}
          </div>

          {!loaded
            ? <div className="empty"><p>Loading items…</p></div>
            : items.length === 0
            ? <div className="empty" style={{padding:'40px 20px',textAlign:'center'}}>
                <div style={{fontSize:44,marginBottom:12,opacity:0.6}}>🛒</div>
                <div style={{fontWeight:700,fontSize:16,marginBottom:6}}>No POS items yet</div>
                <p style={{color:'var(--text3)',fontSize:13,lineHeight:1.5,maxWidth:340,margin:'0 auto'}}>Ask an admin to add items in the POS Admin tab (drinks, food, merch). Once added they'll appear here for sale.</p>
              </div>
            : filteredItems.length === 0
            ? <div className="empty"><p>No items available{catFilter !== 'all' ? ' in this category' : ''}.</p></div>
            : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                {filteredItems.map(item => {
                  const outOfStock = item.track_inventory && item.inventory_qty === 0;
                  return (
                    <button
                      key={item.id}
                      onClick={() => !outOfStock && openModModal(item)}
                      disabled={outOfStock}
                      style={{
                        background: 'var(--bg3)',
                        border: '2px solid var(--border)',
                        borderRadius: 10,
                        padding: '14px 12px',
                        cursor: outOfStock ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                        minHeight: 96,
                        opacity: outOfStock ? 0.45 : 1,
                        transition: 'border-color .12s, background .12s',
                      }}
                      onMouseEnter={e => { if (!outOfStock) { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.background = 'var(--bg4)'; } }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg3)'; }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: CAT_COLORS[item.category] || 'var(--text3)' }}>
                        {CAT_LABELS[item.category] || item.category}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2, color: 'var(--text)', flex: 1 }}>{item.name}</div>
                      <div style={{ fontWeight: 700, color: 'var(--gold)', fontSize: 15 }}>{fmtCurrency(parseFloat(item.price))}</div>
                      {item.track_inventory && item.inventory_qty !== null && (
                        <div style={{ fontSize: 10, color: outOfStock ? 'var(--red)' : 'var(--text3)' }}>
                          {outOfStock ? 'Out of stock' : `${item.inventory_qty} left`}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
          }
        </div>

        {/* Right: cart */}
        <div style={{ width: 272, flexShrink: 0, borderLeft: '1px solid var(--border)', paddingLeft: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Shift status */}
          {shift && (
            <div style={{ background: 'var(--bg3)', borderRadius: 'var(--rs)', padding: '8px 12px', marginBottom: 12, fontSize: 12, flexShrink: 0 }}>
              <div style={{ color: 'var(--text3)', marginBottom: 2 }}>Cash in drawer</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--green)' }}>{fmtCurrency(drawerTotal)}</div>
            </div>
          )}

          <h3 className="dsp" style={{ fontSize: 16, marginBottom: 12, flexShrink: 0 }}>Cart</h3>

          {cart.length === 0
            ? <div style={{ color: 'var(--text3)', fontSize: 13, flex: 1, paddingTop: 4 }}>Tap an item to add it.</div>
            : <>
                <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
                  {cart.map(c => (
                    <div key={c.key} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.item.name}</div>
                      {c.selectedMods.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{c.selectedMods.map(m => m.label).join(', ')}</div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button className="qb" style={{ width: 28, height: 28, fontSize: 14 }} onClick={() => updateQty(c.key, -1)}>−</button>
                          <span className="qv" style={{ width: 24 }}>{c.qty}</span>
                          <button className="qb" style={{ width: 28, height: 28, fontSize: 14 }} onClick={() => updateQty(c.key, 1)}>+</button>
                        </div>
                        <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 13 }}>{fmtCurrency(c.unitPrice * c.qty)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text3)', marginBottom: 3 }}>
                    <span>Subtotal</span><span>{fmtCurrency(cartSubtotal)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
                    <span>Tax</span><span>{fmtCurrency(cartTax)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 20, marginBottom: 12 }}>
                    <span>Total</span><span style={{ color: 'var(--gold)' }}>{fmtCurrency(cartTotal)}</span>
                  </div>
                  <button className="buy" style={{ width: '100%', fontSize: 16, padding: '12px' }} onClick={() => { setTendered(''); setStep('payment'); }}>
                    Charge {fmtCurrency(cartTotal)}
                  </button>
                  <button className="btn" style={{ width: '100%', marginTop: 6, fontSize: 12 }} onClick={() => setCart([])}>
                    Clear Cart
                  </button>
                </div>
              </>
          }

          {/* Close shift button */}
          {shift && onCloseShift && (
            <button
              className="btn"
              style={{ marginTop: 'auto', paddingTop: 12, fontSize: 11, color: 'var(--text3)', borderTop: '1px solid var(--border)', marginLeft: -16, paddingLeft: 16, borderRadius: 0, textAlign: 'left', flexShrink: 0 }}
              onClick={() => onCloseShift(cashSalesThisSession)}
            >
              Close Shift
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
