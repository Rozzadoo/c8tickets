import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from '../lib/supabase';
import { API_BASE } from '../constants';
import ScannerWidget from './ScannerWidget';

const LOGO_SRC = "/logo-simple.webp";

const OVERLAY = {
  success:     { bg: 'rgba(45,90,27,0.95)',   icon: '✅', title: 'Checked In'        },
  already_in:  { bg: 'rgba(107,48,0,0.95)',   icon: '⚠️', title: 'Already Checked In' },
  not_found:   { bg: 'rgba(122,26,26,0.95)',  icon: '❌', title: 'Ticket Not Found'   },
  wrong_event: { bg: 'rgba(122,26,26,0.95)',  icon: '⚠️', title: 'Wrong Event'        },
  cancelled:   { bg: 'rgba(122,26,26,0.95)',  icon: '🚫', title: 'Entry Denied'       },
};

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const GateView = ({ events, onLogout }) => {
  const [selGateEventId, setSelGateEventId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const cooldown = useRef(false);
  const lastId = useRef(null);
  const lastIdTime = useRef(0);
  const dismissTimer = useRef(null);

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

  const handleScan = useCallback(async (rawId) => {
    if (cooldown.current) return;
    const id = rawId.replace(/^https?:\/\/[^/]+\/t\//, '').split('?')[0].trim();
    // Ignore the same QR code for 10 seconds to prevent re-triggering while camera lingers
    const now = Date.now();
    if (id === lastId.current && now - lastIdTime.current < 10000) return;
    lastId.current = id;
    lastIdTime.current = now;
    cooldown.current = true;

    // Route through server-side API so the gate account's RLS restrictions don't block the lookup.
    // get-order resolves both order IDs and individual ticket IDs, and uses the service role key.
    const { data: { session: gateSess } } = await supabase.auth.getSession();
    const fetchHeaders = { 'Content-Type': 'application/json' };
    if (gateSess?.access_token) fetchHeaders['Authorization'] = `Bearer ${gateSess.access_token}`;

    const lookupRes = await fetch(`${API_BASE}/api/get-order?id=${encodeURIComponent(id)}`, { headers: fetchHeaders });
    if (!lookupRes.ok) { showResult({ type: 'not_found' }); return; }

    const { order, tickets, scannedTicketId } = await lookupRes.json();
    const ev = events.find(e => e.id === order.event_id);

    if (selGateEventId && order.event_id !== selGateEventId) {
      showResult({ type: 'wrong_event', name: order.buyer_name, event: ev?.title }); return;
    }
    if (order.status === 'cancelled') { showResult({ type: 'cancelled', name: order.buyer_name }); return; }

    if (scannedTicketId) {
      // Individual ticket QR was scanned — check in just that one ticket
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

    // Order-level QR — check in all unchecked tickets for this order
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
  }, [events, selGateEventId, showResult]);

  const upcomingEvents = events.filter(e => e.published !== false);
  const ov = result ? OVERLAY[result.type] : null;

  return (
    <div className="app">
      <nav className="nav">
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <img src={LOGO_SRC} alt="" style={{height:40,filter:'invert(1)',opacity:.9}} />
          <span className="dsp" style={{fontSize:12,color:'var(--gold)',letterSpacing:2}}>Gate Check-In</span>
        </div>
        <button className="btn" onClick={onLogout}>Logout</button>
      </nav>
      <div style={{maxWidth:440,margin:'0 auto',padding:'16px',width:'100%'}}>
        {upcomingEvents.length > 0 && (
          <div style={{marginBottom:10}}>
            <select className="fi" value={selGateEventId} onChange={e => { setSelGateEventId(e.target.value); }} style={{margin:0,fontSize:13}}>
              <option value="">All Events</option>
              {upcomingEvents.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </div>
        )}

        {!scanning ? (
          <div style={{textAlign:'center',paddingTop:40}}>
            <div style={{fontSize:64,marginBottom:16}}>🎟️</div>
            <h2 className="dsp" style={{fontSize:28,marginBottom:8}}>Ready to Scan</h2>
            <p style={{color:'var(--text2)',fontSize:14,marginBottom:28}}>Tap below to open the camera and start checking in tickets.</p>
            <button className="buy" style={{width:'100%',fontSize:18,padding:'16px'}} onClick={() => setScanning(true)}>
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
                {result.type === 'cancelled' && (
                  <div style={{color:'rgba(255,255,255,0.6)',fontSize:13,marginBottom:4}}>This order has been cancelled. Entry denied.</div>
                )}
                <div style={{color:'rgba(255,255,255,0.35)',fontSize:12,marginTop:16}}>Tap to dismiss early</div>
              </div>
            )}
            <button className="btn" style={{width:'100%',marginTop:8}} onClick={() => { dismiss(); setScanning(false); }}>
              Stop Scanner
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GateView;
