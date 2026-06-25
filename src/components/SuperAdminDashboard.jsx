import { useState, useEffect } from 'react';
import { API_BASE } from '../constants';

const PERIODS = [
  { key: 'mtd', label: 'This Month' },
  { key: '30d', label: 'Last 30 Days' },
  { key: '90d', label: 'Last 90 Days' },
  { key: 'ytd', label: 'This Year' },
  { key: 'all', label: 'All Time' },
];

function getPeriodDates(period) {
  const now = new Date();
  const until = now.toISOString();
  if (period === 'mtd') return { since: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), until };
  if (period === '30d') return { since: new Date(now - 30 * 86400000).toISOString(), until };
  if (period === '90d') return { since: new Date(now - 90 * 86400000).toISOString(), until };
  if (period === 'ytd') return { since: new Date(now.getFullYear(), 0, 1).toISOString(), until };
  return { since: null, until };
}

function fmt$(n) { return '$' + Number(n || 0).toFixed(2); }

function fmtTs(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function TypeBadge({ type }) {
  if (type === 'ticket') return <span className="badge badge-ok" style={{ fontSize: 9, padding: '2px 6px' }}>TICKET</span>;
  if (type === 'reg') return <span className="badge badge-info" style={{ fontSize: 9, padding: '2px 6px' }}>REG</span>;
  return <span className="badge" style={{ fontSize: 9, padding: '2px 6px', background: 'var(--bg4)', color: 'var(--text2)' }}>POS</span>;
}

export default function SuperAdminDashboard({ session }) {
  const [period, setPeriod] = useState('mtd');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    const { since, until } = getPeriodDates(period);
    const params = new URLSearchParams({ until, ...(since ? { since } : {}) });
    fetch(`${API_BASE}/api/super-admin?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(d.error || 'Request failed')))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [period, session]);

  const s = data?.summary || {};
  const venues = data?.venues || [];
  const activity = data?.activity || [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <h2 className="dsp" style={{ fontSize: 26 }}>Platform Overview</h2>
        <div className="filters" role="group" aria-label="Date range">
          {PERIODS.map(p => (
            <button key={p.key} className={`chip ${period === p.key ? 'on' : ''}`} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
      </div>

      {loading && <div className="empty"><p>Loading platform data…</p></div>}
      {error && <div className="empty"><p style={{ color: 'var(--error, #e05252)' }}>Error: {error}</p></div>}

      {!loading && data && <>
        {/* Summary cards */}
        <div className="sg" style={{ marginBottom: 28 }}>
          <div className="sc" style={{ gridColumn: 'span 2' }}>
            <div className="l">Total Platform Revenue</div>
            <div className="v gd" style={{ fontSize: 28 }}>{fmt$(s.totalRev)}</div>
            <div className="s">All venues · tickets + reg + POS</div>
          </div>
          <div className="sc">
            <div className="l">Service Fees Collected</div>
            <div className="v gd">{fmt$(s.totalServiceFees)}</div>
            <div className="s">C8 Tickets income</div>
          </div>
          <div className="sc">
            <div className="l">Ticket Revenue</div>
            <div className="v">{fmt$(s.totalTicketRev)}</div>
            <div className="s">Venue ticket sales</div>
          </div>
          {s.totalRegRev > 0 && (
            <div className="sc">
              <div className="l">Registration Revenue</div>
              <div className="v">{fmt$(s.totalRegRev)}</div>
              <div className="s">All registration forms</div>
            </div>
          )}
          {s.totalPosRev > 0 && (
            <div className="sc">
              <div className="l">POS Revenue</div>
              <div className="v">{fmt$(s.totalPosRev)}</div>
              <div className="s">All terminals</div>
            </div>
          )}
          <div className="sc">
            <div className="l">Ticket Orders</div>
            <div className="v">{s.totalOrders}</div>
          </div>
          <div className="sc">
            <div className="l">Active Venues</div>
            <div className="v">{s.activeVenues}</div>
            <div className="s">of {s.totalVenues} on platform</div>
          </div>
        </div>

        {/* Per-venue revenue table */}
        <h3 className="dsp" style={{ fontSize: 18, marginBottom: 12 }}>Revenue by Venue</h3>
        {venues.length === 0
          ? <div className="empty" style={{ marginBottom: 28 }}><p>No revenue data for this period.</p></div>
          : <div style={{ overflowX: 'auto', marginBottom: 28 }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Venue</th>
                    <th>Tickets</th>
                    <th>Registration</th>
                    <th>POS</th>
                    <th>Total</th>
                    <th>Svc Fees</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {venues.map(v => (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 600 }}>
                        {v.name}
                        {!v.active && <span className="badge" style={{ marginLeft: 6, fontSize: 9, background: 'var(--bg4)', color: 'var(--text3)' }}>INACTIVE</span>}
                      </td>
                      <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt$(v.ticketRev)}</td>
                      <td style={{ color: v.regRev > 0 ? 'var(--text)' : 'var(--text3)' }}>{v.regRev > 0 ? fmt$(v.regRev) : '—'}</td>
                      <td style={{ color: v.posRev > 0 ? 'var(--text)' : 'var(--text3)' }}>{v.posRev > 0 ? fmt$(v.posRev) : '—'}</td>
                      <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt$(v.total)}</td>
                      <td style={{ color: 'var(--text2)' }}>{fmt$(v.serviceFees)}</td>
                      <td>{v.orders}</td>
                    </tr>
                  ))}
                </tbody>
                {venues.length > 1 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                      <td>Total</td>
                      <td style={{ color: 'var(--gold)' }}>{fmt$(s.totalTicketRev)}</td>
                      <td>{s.totalRegRev > 0 ? fmt$(s.totalRegRev) : '—'}</td>
                      <td>{s.totalPosRev > 0 ? fmt$(s.totalPosRev) : '—'}</td>
                      <td style={{ color: 'var(--gold)' }}>{fmt$(s.totalRev)}</td>
                      <td>{fmt$(s.totalServiceFees)}</td>
                      <td>{s.totalOrders}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
        }

        {/* Cross-venue activity feed */}
        <h3 className="dsp" style={{ fontSize: 18, marginBottom: 12 }}>Recent Activity</h3>
        {activity.length === 0
          ? <div className="empty"><p>No activity in this period.</p></div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {activity.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <TypeBadge type={a.type} />
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{a.venueName}</div>
                  <div style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 700, minWidth: 60, textAlign: 'right' }}>{fmt$(a.amount)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtTs(a.created_at)}</div>
                </div>
              ))}
            </div>
        }
      </>}
    </div>
  );
}
