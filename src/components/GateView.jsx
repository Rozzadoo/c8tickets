import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from '../lib/supabase';
import { API_BASE } from '../constants';
import ScannerWidget from './ScannerWidget';
import DoorSales from './DoorSales';

const LOGO_SRC = "/logo-simple.webp";

const OVERLAY = {
  success:     { bg: 'rgba(45,90,27,0.95)',   icon: '✅', title: 'Checked In'        },
  already_in:  { bg: 'rgba(107,48,0,0.95)',   icon: '⚠️', title: 'Already Checked In' },
  not_found:   { bg: 'rgba(122,26,26,0.95)',  icon: '❌', title: 'Ticket Not Found'   },
  wrong_event: { bg: 'rgba(122,26,26,0.95)',  icon: '⚠️', title: 'Wrong Event'        },
  cancelled:   { bg: 'rgba(122,26,26,0.95)',  icon: '🚫', title: 'Entry Denied'       },
  server_err:  { bg: 'rgba(122,26,26,0.95)',  icon: '⚠️', title: 'Server Error'       },
};

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const GateView = ({ events, onLogout, venue, tenantId, updateOrders, updateEvents, reloadOrders }) => {
  const [mode, setMode] = useState('scan'); // scan | manual | sell
  const [selGateEventId, setSelGateEventId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const cooldown = useRef(false);
  const lastId = useRef(null);
  const lastIdTime = useRef(0);
  const dismissTimer = useRef(null);

  // Manual search state
  const [manualQ, setManualQ] = useState('');
  const [manualResults, setManualResults] = useState(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [checkingInId, setCheckingInId] = useState(null);
  const [manualToast, setManualToast] = useState(null);

  useEffect(() => {
    if (selGateEventId || events.length === 0) return;
    const todayStr = new Date().toLocaleDateString('en-CA');
    const upcoming = [...events].filter(e => e.published !== false)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .find(e => e.date >= todayStr);
    if (upcoming) setSelGateEventId(upcoming.id);
  }, [events, selGateEventId]);

  const dismiss = useCallback(() => {
    if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
    cooldown.current = false;
    setResult(null);
  }, []);

  const showResult = useCallback((res) => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setResult(res);
    cooldown.current = true;
    dismissTimer.current = setTimeout(() => { cooldown.current = false; setResult(null); }, 2500);
  }, []);

  const authHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const h = { 'Content-Type': 'application/json' };
    if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`;
    return h;
  }, []);

  const handleScan = useCallback(async (rawId) => {
    if (cooldown.current) return;
    const id = rawId.replace(/^https?:\/\/[^/]+\/t\//, '').split('?')[0].trim();
    const now = Date.now();
    if (id === lastId.current && now - lastIdTime.current < 10000) return;
    lastId.current = id;
    lastIdTime.current = now;
    cooldown.current = true;

    const fetchHeaders = await authHeaders();
    const lookupRes = await fetch(`${API_BASE}/api/get-order?id=${encodeURIComponent(id)}`, { headers: fetchHeaders });
    if (!lookupRes.ok) {
      if (lookupRes.status >= 500) { showResult({ type: 'server_err', detail: `Lookup failed (${lookupRes.status}). Contact admin.` }); return; }
      showResult({ type: 'not_found' }); return;
    }

    const { order, tickets, scannedTicketId } = await lookupRes.json();
    const ev = events.find(e => e.id === order.event_id);

    if (selGateEventId && order.event_id !== selGateEventId) {
      showResult({ type: 'wrong_event', name: order.buyer_name, event: ev?.title }); return;
    }
    if (order.status === 'cancelled') { showResult({ type: 'cancelled', name: order.buyer_name }); return; }

    if (scannedTicketId) {
      const ticket = tickets.find(t => t.id === scannedTicketId);
      if (!ticket) { showResult({ type: 'not_found' }); return; }
      if (ticket.status === 'cancelled') { showResult({ type: 'cancelled', name: order.buyer_name }); return; }
      if (ticket.status === 'checked_in') {
        showResult({ type: 'already_in', name: order.buyer_name, ticketType: ticket.ticket_type_name, checkedInAt: ticket.checked_in_at }); return;
      }
      const ciRes = await fetch(`${API_BASE}/api/gate-checkin`, {
        method: 'POST', headers: fetchHeaders,
        body: JSON.stringify({ ticketId: ticket.id }),
      });
      const ciData = await ciRes.json();
      if (ciData.alreadyIn) {
        showResult({ type: 'already_in', name: order.buyer_name, ticketType: ticket.ticket_type_name }); return;
      }
      showResult({ type: 'success', name: order.buyer_name, ticketType: ticket.ticket_type_name, checkedInAt: new Date().toISOString() });
      return;
    }

    const unchecked = tickets.filter(t => t.status !== 'checked_in' && t.status !== 'cancelled');
    if (unchecked.length === 0) {
      const firstIn = tickets.find(t => t.checked_in_at);
      showResult({ type: 'already_in', name: order.buyer_name, ticketType: tickets[0]?.ticket_type_name, checkedInAt: firstIn?.checked_in_at }); return;
    }

    const ciRes = await fetch(`${API_BASE}/api/gate-checkin`, {
      method: 'POST', headers: fetchHeaders,
      body: JSON.stringify({ groupTicketIds: unchecked.map(t => t.id), orderId: order.id }),
    });
    const ciData = await ciRes.json();
    showResult({ type: 'success', name: order.buyer_name, ticketType: unchecked[0]?.ticket_type_name, count: ciData.checkedIn ?? unchecked.length, checkedInAt: new Date().toISOString() });
  }, [events, selGateEventId, showResult, authHeaders]);

  const doSearch = useCallback(async () => {
    const q = manualQ.trim();
    if (q.length < 2) { setManualError('Enter at least 2 characters'); return; }
    setManualError('');
    setManualLoading(true);
    setManualResults(null);
    setExpandedOrderId(null);
    try {
      const fetchHeaders = await authHeaders();
      const params = new URLSearchParams({ q });
      if (selGateEventId) params.set('eventId', selGateEventId);
      const res = await fetch(`${API_BASE}/api/gate-search?${params}`, { headers: fetchHeaders });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setManualError(err.error || `Search failed (${res.status})`);
        setManualResults([]);
      } else {
        const data = await res.json();
        setManualResults(data.orders || []);
      }
    } catch (e) {
      setManualError('Network error');
      setManualResults([]);
    }
    setManualLoading(false);
  }, [manualQ, selGateEventId, authHeaders]);

  const showManualToast = (msg, ok = true) => {
    setManualToast({ msg, ok });
    setTimeout(() => setManualToast(null), 2500);
  };

  const manualCheckIn = useCallback(async ({ ticketId, orderId, groupTicketIds }) => {
    const key = ticketId || orderId || 'group';
    setCheckingInId(key);
    try {
      const fetchHeaders = await authHeaders();
      const res = await fetch(`${API_BASE}/api/gate-checkin`, {
        method: 'POST', headers: fetchHeaders,
        body: JSON.stringify({ ticketId, orderId, groupTicketIds }),
      });
      if (!res.ok) {
        showManualToast(`Check-in failed (${res.status})`, false);
      } else {
        const data = await res.json();
        showManualToast(data.checkedIn ? `Checked in ${data.checkedIn}` : (data.alreadyIn ? 'Already checked in' : 'Checked in'));
        // Refresh the current search to reflect updated statuses
        doSearch();
      }
    } catch (e) {
      showManualToast('Network error', false);
    }
    setCheckingInId(null);
  }, [authHeaders, doSearch]);

  const upcomingEvents = events.filter(e => e.published !== false);
  const ov = result ? OVERLAY[result.type] : null;
  const eventById = (id) => events.find(e => e.id === id);

  const TabButton = ({ id, label }) => (
    <button
      onClick={() => setMode(id)}
      style={{
        flex: 1, padding: '12px 8px', minHeight: 48,
        background: mode === id ? 'var(--gold)' : 'var(--bg3)',
        color: mode === id ? '#000' : 'var(--text)',
        border: 'none', borderRadius: 'var(--rs)',
        fontWeight: 700, fontSize: 14, letterSpacing: 0.5,
        cursor: 'pointer', textTransform: 'uppercase',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="app">
      <nav className="nav">
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <img src={LOGO_SRC} alt="" style={{height:40,filter:'invert(1)',opacity:.9}} />
          <span className="dsp" style={{fontSize:12,color:'var(--gold)',letterSpacing:2}}>Gate Staff</span>
        </div>
        <button className="btn" onClick={onLogout}>Logout</button>
      </nav>

      <div style={{maxWidth:520,margin:'0 auto',padding:'12px 16px 16px',width:'100%'}}>
        <div style={{display:'flex',gap:6,marginBottom:12}}>
          <TabButton id="scan" label="Scan" />
          <TabButton id="manual" label="Manual" />
          <TabButton id="sell" label="Sell" />
        </div>

        {mode !== 'sell' && upcomingEvents.length > 0 && (
          <div style={{marginBottom:10}}>
            <select className="fi" value={selGateEventId} onChange={e => setSelGateEventId(e.target.value)} style={{margin:0,fontSize:13}}>
              <option value="">All Events</option>
              {upcomingEvents.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </div>
        )}

        {mode === 'scan' && (
          !scanning ? (
            <div style={{textAlign:'center',paddingTop:40}}>
              <div style={{fontSize:64,marginBottom:16}}>🎟️</div>
              <h2 className="dsp" style={{fontSize:28,marginBottom:8}}>Ready to Scan</h2>
              <p style={{color:'var(--text2)',fontSize:14,marginBottom:28}}>Tap below to open the camera and start checking in tickets.</p>
              <button className="buy" style={{width:'100%',fontSize:18,padding:'16px',minHeight:48}} onClick={() => setScanning(true)}>
                Start Scanning
              </button>
            </div>
          ) : (
            <div style={{position:'relative',borderRadius:'var(--r)',overflow:'hidden'}}>
              <ScannerWidget scannerId="gate-scanner" onResult={handleScan} />
              {result && ov && (
                <div onClick={dismiss} style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',padding:28,background:ov.bg,cursor:'pointer'}}>
                  <div style={{fontSize:64,marginBottom:10,lineHeight:1}}>{ov.icon}</div>
                  <div className="dsp" style={{color:'#fff',fontSize:32,fontWeight:700,marginBottom:8,lineHeight:1.1}}>
                    {result.type === 'success' && result.count ? `${result.count} Checked In` : ov.title}
                  </div>
                  {result.name && <div style={{color:'#fff',fontWeight:700,fontSize:20,marginBottom:4}}>{result.name}</div>}
                  {result.ticketType && <div style={{color:'rgba(255,255,255,0.8)',fontSize:16,marginBottom:4}}>{result.ticketType}</div>}
                  {result.type === 'success' && result.checkedInAt && (
                    <div style={{color:'rgba(255,255,255,0.6)',fontSize:14,marginBottom:4}}>{fmtTime(result.checkedInAt)}</div>
                  )}
                  {result.type === 'already_in' && result.checkedInAt && (
                    <div style={{color:'rgba(255,255,255,0.6)',fontSize:14,marginBottom:4}}>First checked in at {fmtTime(result.checkedInAt)}</div>
                  )}
                  {result.type === 'wrong_event' && result.event && (
                    <div style={{color:'rgba(255,255,255,0.7)',fontSize:14,marginBottom:4}}>Ticket is for: <strong>{result.event}</strong></div>
                  )}
                  {result.type === 'not_found' && (
                    <div style={{color:'rgba(255,255,255,0.6)',fontSize:13,marginBottom:4}}>QR code not recognized.</div>
                  )}
                  {result.type === 'server_err' && result.detail && (
                    <div style={{color:'rgba(255,255,255,0.7)',fontSize:13,marginBottom:4}}>{result.detail}</div>
                  )}
                  {result.type === 'cancelled' && (
                    <div style={{color:'rgba(255,255,255,0.6)',fontSize:13,marginBottom:4}}>This order has been cancelled. Entry denied.</div>
                  )}
                  <div style={{color:'rgba(255,255,255,0.35)',fontSize:12,marginTop:16}}>Tap to dismiss early</div>
                </div>
              )}
              <button className="btn" style={{width:'100%',marginTop:8,minHeight:48}} onClick={() => { dismiss(); setScanning(false); }}>
                Stop Scanner
              </button>
            </div>
          )
        )}

        {mode === 'manual' && (
          <div>
            <div style={{display:'flex',gap:6,marginBottom:10}}>
              <input
                className="fi"
                type="text"
                inputMode="search"
                placeholder="Search name or email"
                value={manualQ}
                onChange={e => setManualQ(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doSearch(); }}
                style={{margin:0,flex:1,minHeight:48,fontSize:16}}
              />
              <button className="buy" onClick={doSearch} disabled={manualLoading} style={{minHeight:48,padding:'0 18px'}}>
                {manualLoading ? '…' : 'Search'}
              </button>
            </div>
            {selGateEventId && (
              <div style={{fontSize:11,color:'var(--text3)',marginBottom:8}}>Filtering by: {eventById(selGateEventId)?.title || '—'}</div>
            )}
            {manualError && <div style={{color:'var(--red)',fontSize:13,marginBottom:10}}>{manualError}</div>}

            {manualResults && manualResults.length === 0 && !manualError && (
              <div style={{textAlign:'center',padding:'40px 20px',color:'var(--text3)',fontSize:14}}>No orders match "{manualQ}".</div>
            )}

            {manualResults && manualResults.length > 0 && (
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {manualResults.map(o => {
                  const ev = eventById(o.event_id);
                  const remaining = o.ticketsTotal - o.ticketsCheckedIn;
                  const expanded = expandedOrderId === o.id;
                  return (
                    <div key={o.id} style={{background:'var(--bg3)',borderRadius:'var(--rs)',padding:12}}>
                      <div
                        onClick={() => setExpandedOrderId(expanded ? null : o.id)}
                        style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',minHeight:44}}
                      >
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:700,fontSize:15,marginBottom:2}}>{o.buyer_name || '(no name)'}</div>
                          <div style={{fontSize:12,color:'var(--text3)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{o.buyer_email}</div>
                          {ev && <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>{ev.title}</div>}
                        </div>
                        <div style={{textAlign:'right',marginLeft:10}}>
                          <div style={{fontSize:13,fontWeight:700,color:remaining>0?'var(--gold)':'var(--green)'}}>
                            {o.ticketsCheckedIn}/{o.ticketsTotal}
                          </div>
                          <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1}}>{remaining>0?'In':'Done'}</div>
                        </div>
                      </div>

                      {expanded && (
                        <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--border)'}}>
                          {o.tickets.length === 0 && <div style={{fontSize:12,color:'var(--text3)'}}>No tickets found on this order.</div>}
                          {o.tickets.map(t => (
                            <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)',minHeight:44}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:13,fontWeight:600}}>{t.ticket_type_name}</div>
                                <div style={{fontSize:11,color:'var(--text3)'}}>#{t.ticket_number}
                                  {t.status === 'checked_in' && t.checked_in_at && <> · in at {fmtTime(t.checked_in_at)}</>}
                                  {t.status === 'cancelled' && <> · cancelled</>}
                                </div>
                              </div>
                              {t.status === 'valid' && (
                                <button
                                  className="buy"
                                  onClick={() => manualCheckIn({ ticketId: t.id })}
                                  disabled={checkingInId === t.id}
                                  style={{fontSize:12,padding:'8px 14px',minHeight:44}}
                                >
                                  {checkingInId === t.id ? '…' : 'Check In'}
                                </button>
                              )}
                              {t.status === 'checked_in' && (
                                <span style={{fontSize:11,color:'var(--green)',fontWeight:700,textTransform:'uppercase'}}>In</span>
                              )}
                              {t.status === 'cancelled' && (
                                <span style={{fontSize:11,color:'var(--red)',fontWeight:700,textTransform:'uppercase'}}>Void</span>
                              )}
                            </div>
                          ))}
                          {remaining > 1 && (
                            <button
                              className="buy"
                              onClick={() => manualCheckIn({
                                groupTicketIds: o.tickets.filter(t => t.status === 'valid').map(t => t.id),
                                orderId: o.id,
                              })}
                              disabled={checkingInId !== null}
                              style={{width:'100%',marginTop:12,minHeight:48,fontSize:14}}
                            >
                              {checkingInId ? '…' : `Check In All Remaining (${remaining})`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {manualToast && (
              <div style={{
                position:'fixed',bottom:24,left:16,right:16,maxWidth:490,margin:'0 auto',
                padding:'14px 18px',borderRadius:'var(--rs)',
                background: manualToast.ok ? 'rgba(45,90,27,0.95)' : 'rgba(122,26,26,0.95)',
                color:'#fff',fontWeight:700,textAlign:'center',
                boxShadow:'0 6px 24px rgba(0,0,0,0.4)',zIndex:1000,
              }}>{manualToast.msg}</div>
            )}
          </div>
        )}

        {mode === 'sell' && (
          <DoorSales
            events={events}
            updateOrders={updateOrders}
            updateEvents={updateEvents}
            reloadOrders={reloadOrders}
            venue={venue}
            tenantId={tenantId}
          />
        )}
      </div>
    </div>
  );
};

export default GateView;
