import { useState, useEffect } from "react";
import { supabase } from '../lib/supabase';
import ScannerWidget from './ScannerWidget';

const LOGO_SRC = "/logo-simple.webp";

const GateView = ({ events, onLogout }) => {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [selGateEventId, setSelGateEventId] = useState('');
  const [groupConfirm, setGroupConfirm] = useState(false);
  const [groupCount, setGroupCount] = useState(1);

  useEffect(() => {
    if (selGateEventId || events.length === 0) return;
    const todayStr = new Date().toLocaleDateString('en-CA');
    const upcoming = [...events].filter(e => e.published !== false)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .find(e => e.date >= todayStr);
    if (upcoming) setSelGateEventId(upcoming.id);
  }, [events, selGateEventId]);

  const next = () => { setResult(null); setGroupConfirm(false); setGroupCount(1); setScanning(true); };

  // Auto-advance after successful check-in (2s) or non-actionable errors like not-found / wrong event (3s)
  useEffect(() => {
    if (!result || result === 'loading') return;
    const autoNext = result.done || (!result.found) || result.wrongEvent;
    if (!autoNext) return;
    const t = setTimeout(next, result.done ? 4000 : 3000);
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
                <div style={{position:'fixed',inset:0,zIndex:9999,background:'#2d5a1b',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',padding:32}}>
                  <div style={{fontSize:96,marginBottom:16,lineHeight:1}}>✅</div>
                  <h2 className="dsp" style={{color:'#fff',fontSize:42,marginBottom:12,lineHeight:1.1}}>
                    {result.checkedInCount ? `${result.checkedInCount} Checked In!` : 'Checked In!'}
                  </h2>
                  <p style={{color:'#fff',fontWeight:700,fontSize:24,marginBottom:6}}>{result.order?.buyer_name}</p>
                  <p style={{color:'rgba(255,255,255,0.7)',fontSize:16}}>{result.event?.title}</p>
                  <p style={{color:'rgba(255,255,255,0.5)',fontSize:13,marginTop:24}}>Scanning next in 4 seconds…</p>
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

export default GateView;
