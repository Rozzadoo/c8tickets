import { useState, useEffect } from "react";
import { supabase } from '../lib/supabase';

const LiveDash = ({ events, orders }) => {
  const [selEventId, setSelEventId] = useState('');
  const [checkedInIds, setCheckedInIds] = useState(new Set());

  useEffect(() => {
    if (selEventId || events.length === 0) return;
    const todayStr = new Date().toLocaleDateString('en-CA');
    const upcoming = [...events].sort((a, b) => new Date(a.date) - new Date(b.date))
      .find(e => e.date >= todayStr);
    setSelEventId(upcoming?.id || events[0]?.id || '');
  }, [events, selEventId]);

  useEffect(() => {
    if (!selEventId) return;
    const refresh = async () => {
      const { data: ordData } = await supabase.from('orders').select('id, status').eq('event_id', selEventId);
      const checkedIn = new Set((ordData || []).filter(r => r.status === 'checked_in').map(r => r.id));
      // Also detect orders where all tickets are individually checked in (covers pre-fix manual check-ins)
      const confirmedIds = (ordData || []).filter(r => r.status !== 'checked_in').map(r => r.id);
      if (confirmedIds.length > 0) {
        const { data: tixData } = await supabase.from('tickets').select('order_id, status').in('order_id', confirmedIds);
        if (tixData && tixData.length > 0) {
          const byOrder = {};
          tixData.forEach(t => { (byOrder[t.order_id] = byOrder[t.order_id] || []).push(t); });
          for (const [ordId, tix] of Object.entries(byOrder)) {
            const active = tix.filter(t => t.status !== 'cancelled');
            if (active.length > 0 && active.every(t => t.status === 'checked_in')) checkedIn.add(ordId);
          }
        }
      }
      setCheckedInIds(checkedIn);
    };
    refresh();
    const ch = supabase.channel('live-' + selEventId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `event_id=eq.${selEventId}` }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selEventId]);

  const ev = events.find(e => e.id === selEventId);
  const evOrders = orders.filter(o => o.eventId === selEventId && o.status !== 'cancelled');
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

export default LiveDash;
