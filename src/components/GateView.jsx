import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from '../lib/supabase';
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

    // Try individual ticket lookup first
    const { data: ticket } = await supabase.from('tickets').select('*').eq('id', id).single();

    if (ticket) {
      const { data: order } = await supabase.from('orders').select('*, order_items(*)').eq('id', ticket.order_id).single();
      const ev = events.find(e => e.id === ticket.event_id);

      if (selGateEventId && ticket.event_id !== selGateEventId) {
        showResult({ type: 'wrong_event', name: order?.buyer_name, event: ev?.title }); return;
      }
      if (ticket.status === 'cancelled' || order?.status === 'cancelled') {
        showResult({ type: 'cancelled', name: order?.buyer_name }); return;
      }
      if (ticket.status === 'checked_in') {
        showResult({ type: 'already_in', name: order?.buyer_name, ticketType: ticket.ticket_type_name, checkedInAt: ticket.checked_in_at }); return;
      }
      const checkedAt = new Date().toISOString();
      const { data: updated } = await supabase.from('tickets')
        .update({ status: 'checked_in', checked_in_at: checkedAt })
        .eq('id', ticket.id).eq('status', 'valid').select('id');
      if (!updated || updated.length === 0) {
        showResult({ type: 'already_in', name: order?.buyer_name, ticketType: ticket.ticket_type_name }); return;
      }
      showResult({ type: 'success', name: order?.buyer_name, ticketType: ticket.ticket_type_name, checkedInAt: checkedAt }); return;
    }

    // Fall back to order-level lookup (group / legacy QR)
    const { data: order, error } = await supabase.from('orders').select('*, order_items(*)').eq('id', id).single();
    if (error || !order) { showResult({ type: 'not_found' }); return; }

    const ev = events.find(e => e.id === order.event_id);
    if (selGateEventId && order.event_id !== selGateEventId) {
      showResult({ type: 'wrong_event', name: order.buyer_name, event: ev?.title }); return;
    }
    if (order.status === 'cancelled') { showResult({ type: 'cancelled', name: order.buyer_name }); return; }

    const { data: orderTickets } = await supabase.from('tickets').select('*').eq('order_id', id).order('ticket_number');
    const unchecked = (orderTickets || []).filter(t => t.status !== 'checked_in' && t.status !== 'cancelled');

    if (unchecked.length === 0) {
      const firstIn = (orderTickets || []).find(t => t.checked_in_at);
      showResult({ type: 'already_in', name: order.buyer_name, ticketType: orderTickets?.[0]?.ticket_type_name, checkedInAt: firstIn?.checked_in_at }); return;
    }

    const checkedAt = new Date().toISOString();
    let checkedInCount = 0;
    for (const t of unchecked) {
      const { data: updated } = await supabase.from('tickets')
        .update({ status: 'checked_in', checked_in_at: checkedAt })
        .eq('id', t.id).eq('status', 'valid').select('id');
      if (updated && updated.length > 0) checkedInCount++;
    }
    if (checkedInCount > 0 && unchecked.length <= checkedInCount) {
      await supabase.from('orders').update({ status: 'checked_in' }).eq('id', order.id);
    }
    showResult({ type: 'success', name: order.buyer_name, ticketType: unchecked[0]?.ticket_type_name, count: checkedInCount, checkedInAt: checkedAt });
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
            <select className="fi" value={selGateEventId} onChange={e => setSelGateEventId(e.target.value)} style={{margin:0,fontSize:13}}>
              <option value="">All Events</option>
              {upcomingEvents.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </div>
        )}
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
        </div>
      </div>
    </div>
  );
};

export default GateView;
