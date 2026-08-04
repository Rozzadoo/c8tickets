import { useState, useEffect, useRef } from "react";
import { Elements } from '@stripe/react-stripe-js';
import { supabase } from '../lib/supabase';
import { stripePromise } from '../lib/stripe';
import { API_BASE, APP_URL } from '../constants';
import { fmtDate, fmtTime, fmtCurrency, fetchWithTimeout } from '../lib/utils';
import CheckoutForm from './CheckoutForm';
import QRImg from './QRImg';

const DoorSales = ({ events, updateOrders, updateEvents, reloadOrders, venue, tenantId }) => {
  const [selEventId, setSelEventId] = useState('');
  const [doorCart, setDoorCart] = useState({});
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [step, setStep] = useState('select');
  const [lookupQ, setLookupQ] = useState('');
  const [lookupResults, setLookupResults] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [amounts, setAmounts] = useState(null);
  const [cashAmounts, setCashAmounts] = useState(null);
  const [tendered, setTendered] = useState('');
  const [lastSale, setLastSale] = useState(null);
  const [voidConfirm, setVoidConfirm] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [isPreSale, setIsPreSale] = useState(false);
  const [loadingIntent, setLoadingIntent] = useState(false);
  // Terminal reader state
  const [terminal, setTerminal] = useState(null);
  const [readers, setReaders] = useState([]);
  const [connectedReader, setConnectedReader] = useState(null);
  const [readerDiscovering, setReaderDiscovering] = useState(false);
  const [connectingReaderId, setConnectingReaderId] = useState(null);
  const [readerError, setReaderError] = useState('');
  const [terminalPaymentStatus, setTerminalPaymentStatus] = useState('idle');
  const [terminalAmounts, setTerminalAmounts] = useState(null);
  // Ref-based submit guard — prevents double-taps racing state updates
  const submittingRef = useRef(false);

  useEffect(() => {
    if (selEventId || events.length === 0) return;
    const todayStr = new Date().toLocaleDateString('en-CA');
    const upcoming = [...events].sort((a, b) => new Date(a.date) - new Date(b.date))
      .find(e => e.date >= todayStr);
    setSelEventId(upcoming?.id || events[0]?.id || '');
  }, [events, selEventId]);

  const ev = events.find(e => e.id === selEventId);
  const cartItems = ev ? ev.tickets.map((t, i) => ({ ...t, qty: doorCart[i] || 0, effectivePrice: t.doorPrice ?? t.price })) : [];
  const cartN = cartItems.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cartItems.reduce((s, i) => s + i.qty * i.effectivePrice, 0);

  const startPayment = async () => {
    if (!ev || cartN === 0) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoadingIntent(true);
    const items = cartItems.filter(i => i.qty > 0).map(i => ({ qty: i.qty, ticketTypeId: i.id }));
    try {
      const res = await fetchWithTimeout(API_BASE+'/api/create-payment-intent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, eventId: selEventId, tenantId: tenantId, isDoorSale: true }),
      }, 15000);
      const data = await res.json();
      if (!res.ok || !data.clientSecret) {
        alert(data.error || 'Payment setup failed. Please try again.');
        return;
      }
      setClientSecret(data.clientSecret);
      setAmounts(data);
      setStep('payment');
    } catch (e) {
      alert(e.message === 'timeout'
        ? 'Payment setup timed out. Check your connection and try again — no charge was made.'
        : 'Payment setup failed. Please try again.');
    } finally {
      setLoadingIntent(false);
      submittingRef.current = false;
    }
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
    setConnectingReaderId(reader.id);
    setReaderError('');
    const result = await terminal.connectReader(reader, { fail_if_in_use: false });
    setConnectingReaderId(null);
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
    if (submittingRef.current) return;
    submittingRef.current = true;
    const { data: { session: doorSession } } = await supabase.auth.getSession();
    setLoadingIntent(true);
    let data;
    try {
      const res = await fetchWithTimeout(API_BASE + '/api/terminal?action=payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doorSession?.access_token || ''}` },
        body: JSON.stringify({
          items: cartItems.filter(i => i.qty > 0).map(i => ({ qty: i.qty, ticketTypeId: i.id })),
          eventId: selEventId, tenantId: tenantId,
          eventMeta: { title: ev?.title || '' },
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
      tenant_id: tenantId, event_id: selEventId,
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
    fetch(API_BASE+'/api/stripe-orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doorSession?.access_token || ''}` },
      body: JSON.stringify({
        action: 'tag',
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
    reloadOrders?.();
    setLastSale(localOrder);
    setStep('confirm');
  };

  const startCash = () => {
    if (!ev || cartN === 0) return;
    setCashAmounts({ ticketTotal: cartTotal, salesTax: 0, serviceFees: 0, processingFee: 0, grandTotal: cartTotal });
    setStep('cash');
  };

  const handleCashSale = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
    const soldItems = cartItems.filter(i => i.qty > 0).map(i => ({ type: i.type, qty: i.qty, price: i.effectivePrice, ticketTypeId: i.id }));
    const ref = 'CASH-' + Date.now();
    const { data: { session: cashSession } } = await supabase.auth.getSession();
    const { data: order, error: orderError } = await supabase.from('orders').insert({
      tenant_id: tenantId, event_id: selEventId,
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
    reloadOrders?.();
    setLastSale(localOrder);
    setStep('confirm');
    } finally {
      submittingRef.current = false;
    }
  };

  const reset = () => { setStep('select'); setDoorCart({}); setBuyerName(''); setBuyerEmail(''); setClientSecret(null); setAmounts(null); setCashAmounts(null); setTendered(''); setLastSale(null); setTerminalAmounts(null); setTerminalPaymentStatus('idle'); setIsPreSale(false); setVoidConfirm(false); };

  const runLookup = async () => {
    const q = lookupQ.trim();
    if (!q || !selEventId) return;
    setLookupLoading(true);
    setLookupResults(null);
    const { data } = await supabase
      .from('orders')
      .select('id,buyer_name,buyer_email,status,total_amount,created_at,order_items(ticket_type_name,quantity)')
      .eq('event_id', selEventId)
      .or(`buyer_email.ilike.%${q}%,buyer_name.ilike.%${q}%`)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(10);
    setLookupResults(data || []);
    setLookupLoading(false);
  };

  const handleVoidSale = async () => {
    if (!lastSale) return;
    setVoiding(true);
    try {
      await supabase.from('orders').update({ status: 'cancelled' }).eq('id', lastSale.id);
      for (const item of lastSale.items) {
        if (item.ticketTypeId) await supabase.rpc('decrement_sold', { tid: item.ticketTypeId, qty: item.qty });
      }
      updateOrders(prev => prev.map(o => o.id === lastSale.id ? { ...o, status: 'cancelled', checkedIn: false } : o));
      updateEvents(evts => evts.map(e => e.id !== lastSale.eventId ? e : ({
        ...e, tickets: e.tickets.map(t => {
          const item = lastSale.items.find(i => i.ticketTypeId === t.id);
          return item ? { ...t, available: t.available + item.qty } : t;
        })
      })));
      reset();
    } finally {
      setVoiding(false);
    }
  };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24,flexWrap:'wrap',gap:10}}>
        <h2 className="dsp" style={{fontSize:26}}>Door Sales</h2>
        {step !== 'select' && <button className="btn" onClick={reset}>← New Sale</button>}
      </div>

      {step === 'select' && <>
        <div className="fg" style={{marginBottom:16}}>
          <label className="fl">Event</label>
          <select className="fi" value={selEventId} onChange={e => { setSelEventId(e.target.value); setDoorCart({}); setLookupQ(''); setLookupResults(null); }}>
            <option value="">— Select Event —</option>
            {events.filter(e => e.date >= new Date().toLocaleDateString('en-CA')).map(e => <option key={e.id} value={e.id}>{e.title} — {fmtDate(e.date)}</option>)}
          </select>
        </div>
        {selEventId && <div style={{marginBottom:20,padding:'14px 16px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--rs)'}}>
          <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:1.5,color:'var(--text3)',marginBottom:8}}>Look Up Existing Order</div>
          <div style={{display:'flex',gap:8}}>
            <input className="fi" style={{flex:1,margin:0}} placeholder="Name or email…" value={lookupQ} onChange={e=>setLookupQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&runLookup()} />
            <button className="btn" style={{flexShrink:0}} disabled={!lookupQ.trim()||lookupLoading} onClick={runLookup}>{lookupLoading?'…':'Search'}</button>
          </div>
          {lookupResults !== null && (lookupResults.length === 0
            ? <p style={{fontSize:12,color:'var(--text3)',marginTop:10,marginBottom:0}}>No orders found.</p>
            : <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:6}}>
                {lookupResults.map(r => (
                  <div key={r.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'8px 12px',background:'var(--bg3)',borderRadius:'var(--rs)',fontSize:12}}>
                    <div>
                      <div style={{fontWeight:600}}>{r.buyer_name}</div>
                      <div style={{color:'var(--text3)',fontSize:11}}>{r.buyer_email} · {(r.order_items||[]).map(i=>`${i.quantity}× ${i.ticket_type_name}`).join(', ')}</div>
                    </div>
                    <span className={`badge ${r.status==='checked_in'?'badge-done':'badge-ok'}`} style={{fontSize:10,flexShrink:0}}>{r.status==='checked_in'?'Checked In':'Valid'}</span>
                  </div>
                ))}
              </div>
          )}
        </div>}
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
                <span style={{color:'var(--green)',fontWeight:600,display:'flex',alignItems:'center',gap:6}}>
                  <span style={{width:8,height:8,borderRadius:'50%',background:'var(--green)',boxShadow:'0 0 0 3px rgba(93,138,60,.25)',flexShrink:0,display:'inline-block'}}/>
                  {connectedReader.label || connectedReader.serial_number}
                </span>
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
                        <button className="btn" style={{padding:'4px 10px',fontSize:12}} disabled={connectingReaderId !== null} onClick={() => connectToReader(r)}>
                          {connectingReaderId === r.id ? 'Connecting…' : 'Connect'}
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
            <div className="cart-tot"><span>Collect From Customer</span><span>{fmtCurrency(cashAmounts.grandTotal)}</span></div>
          </div>
          <p style={{fontSize:12,color:'var(--text3)',marginBottom:16}}>No card processing fee — cash only.</p>
          <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}>
            {[1,5,10,20,50,100].map(d => (
              <button key={d} className="btn" style={{flex:'1 1 60px',fontSize:15,fontWeight:700,padding:'10px 4px'}}
                onClick={() => setTendered(t => String(Math.round(((parseFloat(t)||0) + d) * 100) / 100))}>
                +${d}
              </button>
            ))}
            <button className="btn gold" style={{flex:'1 1 100%',fontWeight:700,padding:'10px 4px'}}
              onClick={() => setTendered(String(cashAmounts.grandTotal))}>
              Exact Change
            </button>
          </div>
          <div className="fg" style={{marginBottom:12}}>
            <label className="fl">Amount Tendered</label>
            <div style={{display:'flex',gap:6}}>
              <input className="fi" type="number" min="0" step="0.01" placeholder={`${cashAmounts.grandTotal.toFixed(2)}`} value={tendered} onChange={e=>setTendered(e.target.value)} style={{flex:1,margin:0}} />
              {tendered !== '' && <button className="btn" style={{padding:'0 12px',flexShrink:0}} onClick={()=>setTendered('')}>✕</button>}
            </div>
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
          <p style={{fontFamily:'monospace',fontSize:11,fontWeight:700,letterSpacing:1,marginBottom:20,color:lastSale.checkedIn?'var(--green)':'var(--gold)'}}>
            {lastSale.checkedIn ? '✓ CHECKED IN' : '✓ PRE SALE — TICKET EMAILED'}
          </p>
          {ev && <div style={{marginBottom:6}}>
            <div style={{fontSize:11,color:'var(--text3)',textTransform:'uppercase',letterSpacing:2,marginBottom:4}}>{fmtDate(ev.date)}{ev.time ? ` · ${fmtTime(ev.time)}` : ''}</div>
            <div className="dsp" style={{fontSize:22,color:'var(--text)',marginBottom:4}}>{ev.title}</div>
          </div>}
          {lastSale.buyer.name && lastSale.buyer.name !== 'Walk-In' && <p style={{color:'var(--text2)',fontSize:13,marginBottom:4}}>{lastSale.buyer.name}</p>}
          <p style={{color:'var(--gold)',fontWeight:700,fontSize:20,marginBottom:20}}>{fmtCurrency(lastSale.total)}</p>
          <div style={{background:'white',borderRadius:12,padding:16,display:'inline-block',marginBottom:10}}>
            <QRImg value={`${APP_URL}/t/${lastSale.id}?receipt=1`} size={200} />
          </div>
          <p style={{fontSize:15,fontWeight:700,color:'var(--text)',marginBottom:4}}>📱 Scan to save your tickets</p>
          <p style={{fontSize:12,color:'var(--text3)',marginBottom:24}}>Point your phone camera at this code</p>
          <button className="buy" style={{maxWidth:260,margin:'0 auto',display:'block'}} onClick={reset}>+ New Sale</button>
          {!voidConfirm && (
            <button className="btn" style={{maxWidth:260,margin:'8px auto 0',display:'block',color:'var(--text3)',fontSize:12}} onClick={()=>setVoidConfirm(true)}>
              Void this sale
            </button>
          )}
          {voidConfirm && (
            <div style={{marginTop:16,padding:'12px 16px',background:'rgba(179,58,42,.12)',border:'1px solid rgba(179,58,42,.3)',borderRadius:'var(--rs)',textAlign:'left'}}>
              <p style={{fontSize:13,color:'var(--red)',fontWeight:600,marginBottom:8}}>Void this sale?</p>
              <p style={{fontSize:12,color:'var(--text3)',marginBottom:12}}>
                {lastSale.stripePaymentIntentId && !lastSale.stripePaymentIntentId.startsWith('CASH-')
                  ? 'The order will be cancelled and inventory restored. You must process the card refund manually in Stripe.'
                  : 'The order will be cancelled and inventory restored. No refund is needed for cash sales.'}
              </p>
              <div style={{display:'flex',gap:8}}>
                <button className="btn" style={{flex:1,fontSize:12,color:'var(--red)',borderColor:'var(--red)'}} disabled={voiding} onClick={handleVoidSale}>{voiding?'Voiding…':'Yes, Void Sale'}</button>
                <button className="btn" style={{flex:1,fontSize:12}} onClick={()=>setVoidConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DoorSales;
