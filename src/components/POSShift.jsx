import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fmtCurrency } from '../lib/utils';
import POSTerminal from './POSTerminal';

export default function POSShift({ tenantId, venue, events, onClose }) {
  const [shiftStep, setShiftStep] = useState('loading'); // loading | start | active | closing
  const [shift, setShift] = useState(null);
  const [openingCash, setOpeningCash] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [cashSalesTotal, setCashSalesTotal] = useState(0);
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => { checkActiveShift(); }, []);

  async function checkActiveShift() {
    const { data } = await supabase
      .from('pos_shifts')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) { setShift(data); setShiftStep('active'); }
    else setShiftStep('start');
  }

  async function startShift() {
    const cash = parseFloat(openingCash) || 0;
    setStarting(true);
    const { data: { session: s } } = await supabase.auth.getSession();
    const { data } = await supabase.from('pos_shifts').insert({
      tenant_id: tenantId,
      staff_user_id: s?.user?.id || null,
      opening_cash: cash,
    }).select().single();
    setStarting(false);
    if (data) { setShift(data); setShiftStep('active'); }
    else alert('Failed to start shift. Please try again.');
  }

  async function closeShift() {
    if (!shift) return;
    const counted = parseFloat(countedCash);
    setClosing(true);
    await supabase.from('pos_shifts').update({
      closed_at: new Date().toISOString(),
      closing_cash_counted: isNaN(counted) ? null : counted,
      notes: isNaN(counted) ? null : null,
    }).eq('id', shift.id);
    setClosing(false);
    onClose();
  }

  if (shiftStep === 'loading') {
    return <div className="empty"><p>Loading…</p></div>;
  }

  if (shiftStep === 'start') {
    return (
      <div style={{ maxWidth: 420, paddingTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <button className="btn" onClick={onClose}>← Back</button>
          <h2 className="dsp" style={{ fontSize: 24, margin: 0 }}>Open Register</h2>
        </div>
        <div style={{ background: 'var(--bg3)', borderRadius: 'var(--rs)', padding: 20, marginBottom: 20 }}>
          <p style={{ color: 'var(--text2)', marginBottom: 20, lineHeight: 1.5 }}>
            Count your opening cash and enter the amount to start your shift.
          </p>
          <label className="fl">Opening Cash in Drawer</label>
          <input
            className="fi"
            type="number"
            min="0"
            step="0.01"
            value={openingCash}
            onChange={e => setOpeningCash(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </div>
        <button className="buy" style={{ width: '100%', marginBottom: 8 }} disabled={starting} onClick={startShift}>
          {starting ? 'Opening…' : 'Open Register'}
        </button>
        <button className="btn" style={{ width: '100%', fontSize: 12 }} onClick={onClose}>Cancel</button>
      </div>
    );
  }

  if (shiftStep === 'closing') {
    const openCash = parseFloat(shift?.opening_cash || 0);
    const expectedCash = Math.round((openCash + cashSalesTotal) * 100) / 100;
    const counted = parseFloat(countedCash);
    const discrepancy = !isNaN(counted) ? Math.round((counted - expectedCash) * 100) / 100 : null;
    const opened = shift?.opened_at ? new Date(shift.opened_at) : null;

    return (
      <div style={{ maxWidth: 440, paddingTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <button className="btn" onClick={() => setShiftStep('active')}>← Back</button>
          <h2 className="dsp" style={{ fontSize: 24, margin: 0 }}>Close Register</h2>
        </div>

        {opened && (
          <p style={{ color: 'var(--text3)', fontSize: 12, marginBottom: 20 }}>
            Shift opened {opened.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {opened.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        )}

        <div style={{ background: 'var(--bg3)', borderRadius: 'var(--rs)', padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
            <span style={{ color: 'var(--text3)' }}>Opening cash</span>
            <span>{fmtCurrency(openCash)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 12 }}>
            <span style={{ color: 'var(--text3)' }}>Cash sales this shift</span>
            <span style={{ color: 'var(--green)' }}>+ {fmtCurrency(cashSalesTotal)}</span>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
            <span>Expected in drawer</span>
            <span style={{ color: 'var(--gold)' }}>{fmtCurrency(expectedCash)}</span>
          </div>
        </div>

        <label className="fl">Actual Cash Counted</label>
        <input
          className="fi"
          type="number"
          min="0"
          step="0.01"
          value={countedCash}
          onChange={e => setCountedCash(e.target.value)}
          placeholder={expectedCash.toFixed(2)}
          autoFocus
          style={{ marginBottom: 12 }}
        />

        {discrepancy !== null && (
          <div style={{
            padding: '12px 16px',
            borderRadius: 'var(--rs)',
            marginBottom: 16,
            fontWeight: 700,
            fontSize: 16,
            textAlign: 'center',
            background: discrepancy === 0
              ? 'rgba(93,138,60,.15)'
              : Math.abs(discrepancy) < 1
              ? 'rgba(200,146,42,.12)'
              : 'rgba(179,58,42,.12)',
            color: discrepancy === 0
              ? 'var(--green)'
              : discrepancy > 0
              ? 'var(--gold)'
              : 'var(--red)',
          }}>
            {discrepancy === 0
              ? '✓ Drawer balanced'
              : discrepancy > 0
              ? `Over by ${fmtCurrency(Math.abs(discrepancy))}`
              : `Short by ${fmtCurrency(Math.abs(discrepancy))}`}
          </div>
        )}

        <button className="buy" style={{ width: '100%', marginBottom: 8 }} disabled={closing} onClick={closeShift}>
          {closing ? 'Closing…' : 'Close Register'}
        </button>
        <p style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
          Closing the register ends this shift. You can start a new one at any time.
        </p>
      </div>
    );
  }

  // Active shift — render terminal
  return (
    <POSTerminal
      tenantId={tenantId}
      venue={venue}
      events={events}
      onClose={onClose}
      shift={shift}
      onCloseShift={sessionCashSales => {
        setCashSalesTotal(sessionCashSales);
        setCountedCash('');
        setShiftStep('closing');
      }}
    />
  );
}
