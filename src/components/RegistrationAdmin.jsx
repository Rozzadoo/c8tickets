import { useState, useEffect, useCallback } from "react";
import { supabase } from '../lib/supabase';
import { fmtCurrency } from '../lib/utils';
import { API_BASE } from '../constants';

const CATEGORIES = ['tournament','parade','race','sports','vendor','civic','other'];
const FIELD_TYPES = [
  { value: 'text',     label: 'Short Text' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'email',    label: 'Email' },
  { value: 'phone',    label: 'Phone' },
  { value: 'number',   label: 'Number' },
  { value: 'select',   label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox (Yes / No)' },
];

const blankForm = () => ({
  id: null, title: '', description: '', category: 'other',
  start_date: '', end_date: '', capacity: '', price_per_entry: '0',
  team_size: '', status: 'draft',
});

const blankField = () => ({
  id: null, field_type: 'text', label: '', placeholder: '', options: '', required: false,
});

const STATUS_COLORS = { confirmed: 'var(--green)', waitlisted: 'var(--gold)', cancelled: 'var(--red)' };

const RegistrationAdmin = ({ tenantId, venue }) => {
  // Form list + builder state
  const [forms, setForms]           = useState([]);
  const [loaded, setLoaded]         = useState(false);
  const [counts, setCounts]         = useState({});
  const [view, setView]             = useState('list');
  const [editForm, setEditForm]     = useState(null);
  const [editFields, setEditFields] = useState([]);
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState(null);

  // Registrant management state
  const [selForm, setSelForm]           = useState(null);
  const [registrants, setRegistrants]   = useState([]);
  const [regsLoaded, setRegsLoaded]     = useState(false);
  const [regFields, setRegFields]       = useState([]);
  const [regSearch, setRegSearch]       = useState('');
  const [regStatusFilter, setRegStatusFilter] = useState('all');
  const [selReg, setSelReg]             = useState(null);
  const [selRegResponses, setSelRegResponses] = useState([]);
  const [selRegMembers, setSelRegMembers]   = useState([]);
  const [cancelling, setCancelling]     = useState(false);
  const [promoting, setPromoting]       = useState(false);

  const loadForms = useCallback(async () => {
    const { data } = await supabase
      .from('registration_forms').select('*')
      .eq('tenant_id', tenantId).order('created_at', { ascending: false });
    setForms(data || []);
    if (data?.length) {
      const { data: regData } = await supabase
        .from('registrations').select('form_id')
        .in('form_id', data.map(f => f.id)).neq('status', 'cancelled');
      if (regData) {
        const c = {};
        regData.forEach(r => { c[r.form_id] = (c[r.form_id] || 0) + 1; });
        setCounts(c);
      }
    }
    setLoaded(true);
  }, [tenantId]);

  useEffect(() => { loadForms(); }, [loadForms]);

  // ── Form builder helpers ─────────────────────────────────────────
  const startCreate = () => { setEditForm(blankForm()); setEditFields([]); setView('edit'); };

  const startEdit = async (form) => {
    setEditForm({
      ...form,
      capacity: form.capacity ?? '', team_size: form.team_size ?? '',
      price_per_entry: String(form.price_per_entry ?? 0),
      start_date: form.start_date ?? '', end_date: form.end_date ?? '',
    });
    const { data } = await supabase.from('form_fields').select('*')
      .eq('form_id', form.id).order('sort_order');
    setEditFields((data || []).map(f => ({
      ...f, options: Array.isArray(f.options) ? f.options.join('\n') : (f.options || ''),
    })));
    setView('edit');
  };

  const saveForm = async () => {
    if (!editForm.title.trim()) return alert('Form title is required.');
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        title: editForm.title.trim(), description: editForm.description.trim(),
        category: editForm.category,
        start_date: editForm.start_date || null, end_date: editForm.end_date || null,
        capacity: editForm.capacity ? parseInt(editForm.capacity) : null,
        price_per_entry: parseFloat(editForm.price_per_entry) || 0,
        team_size: editForm.team_size ? parseInt(editForm.team_size) : null,
        status: editForm.status,
      };
      let formId = editForm.id;
      if (formId) {
        await supabase.from('registration_forms').update(payload).eq('id', formId);
      } else {
        const { data } = await supabase.from('registration_forms').insert(payload).select().single();
        formId = data.id;
      }
      if (editForm.id) {
        const keepIds = editFields.filter(f => f.id).map(f => f.id);
        const { data: existing } = await supabase.from('form_fields').select('id').eq('form_id', formId);
        const toDelete = (existing || []).filter(f => !keepIds.includes(f.id)).map(f => f.id);
        if (toDelete.length) await supabase.from('form_fields').delete().in('id', toDelete);
      }
      for (let i = 0; i < editFields.length; i++) {
        const f = editFields[i];
        if (!f.label.trim()) continue;
        const fp = {
          form_id: formId, field_type: f.field_type, label: f.label.trim(),
          placeholder: f.placeholder?.trim() || null,
          options: f.field_type === 'select' ? f.options.split('\n').map(o => o.trim()).filter(Boolean) : null,
          required: f.required, sort_order: i,
        };
        if (f.id) await supabase.from('form_fields').update(fp).eq('id', f.id);
        else await supabase.from('form_fields').insert(fp);
      }
      await loadForms();
      setView('list');
    } finally { setSaving(false); }
  };

  const deleteForm = async (id) => {
    setDeleting(id);
    await supabase.from('registration_forms').delete().eq('id', id);
    setForms(f => f.filter(x => x.id !== id));
    setDeleting(null);
  };

  const togglePublish = async (form) => {
    const next = form.status === 'published' ? 'draft' : 'published';
    await supabase.from('registration_forms').update({ status: next }).eq('id', form.id);
    setForms(fs => fs.map(f => f.id === form.id ? { ...f, status: next } : f));
  };

  const addField    = () => setEditFields(f => [...f, blankField()]);
  const removeField = (i) => setEditFields(f => f.filter((_, x) => x !== i));
  const moveField   = (i, dir) => setEditFields(f => {
    const n = [...f]; const j = i + dir;
    if (j < 0 || j >= n.length) return n;
    [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const updateField = (i, ch) => setEditFields(f => f.map((x, k) => k === i ? { ...x, ...ch } : x));
  const upd = (ch) => setEditForm(f => ({ ...f, ...ch }));

  // ── Registrant management helpers ────────────────────────────────
  const openRegistrants = async (form) => {
    setSelForm(form); setRegistrants([]); setRegsLoaded(false);
    setRegSearch(''); setRegStatusFilter('all'); setSelReg(null);
    const { data: fields } = await supabase.from('form_fields').select('id,label').eq('form_id', form.id).order('sort_order');
    setRegFields(fields || []);
    const { data } = await supabase
      .from('registrations').select('*')
      .eq('form_id', form.id).order('created_at', { ascending: false });
    setRegistrants(data || []);
    setRegsLoaded(true);
    setView('registrants');
  };

  const openDetail = async (reg) => {
    setSelReg(reg);
    const [{ data: responses }, { data: members }] = await Promise.all([
      supabase.from('registration_responses').select('field_label,response_value').eq('registration_id', reg.id),
      supabase.from('registration_members').select('member_name,member_email,member_phone').eq('registration_id', reg.id),
    ]);
    setSelRegResponses(responses || []);
    setSelRegMembers(members || []);
    setView('registrant_detail');
  };

  const cancelReg = async () => {
    if (!selReg) return;
    setCancelling(true);
    try {
      const hasStripe = selReg.stripe_payment_intent_id && !/^(null|free)$/i.test(selReg.stripe_payment_intent_id);
      if (hasStripe && parseFloat(selReg.total_amount) > 0) {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(API_BASE + '/api/stripe-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({ action: 'refund', paymentIntentId: selReg.stripe_payment_intent_id, orderId: selReg.id }),
        });
        const data = await res.json();
        if (!res.ok) { alert(`Refund failed: ${data.error || 'Unknown error'}`); return; }
      }
      await supabase.from('registrations').update({ status: 'cancelled' }).eq('id', selReg.id);
      const updated = { ...selReg, status: 'cancelled' };
      setSelReg(updated);
      setRegistrants(rs => rs.map(r => r.id === selReg.id ? updated : r));
    } finally { setCancelling(false); }
  };

  const promoteReg = async () => {
    if (!selReg) return;
    setPromoting(true);
    try {
      await supabase.from('registrations').update({ status: 'confirmed' }).eq('id', selReg.id);
      const updated = { ...selReg, status: 'confirmed' };
      setSelReg(updated);
      setRegistrants(rs => rs.map(r => r.id === selReg.id ? updated : r));
      fetch(API_BASE + '/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'registration', registrationId: selReg.id, venueName: venue?.name || '' }),
      }).catch(() => {});
    } finally { setPromoting(false); }
  };

  const exportCsv = () => {
    const fieldLabels = regFields.map(f => f.label);
    const headers = ['ID','Name','Email','Phone','Team','Status','Amount','Date',...fieldLabels];
    const rows = filteredRegs.map(r => {
      const responseMap = {};
      // We only have responses in detail view, so just leave blank for list export
      return [
        r.id, r.registrant_name, r.registrant_email, r.registrant_phone || '',
        r.team_name || '', r.status, r.total_amount || '0',
        new Date(r.created_at).toLocaleDateString(),
        ...fieldLabels.map(() => ''),
      ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url;
    a.download = `${selForm?.title?.replace(/[^a-z0-9]/gi,'-') || 'registrations'}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const filteredRegs = registrants.filter(r => {
    const q = regSearch.toLowerCase();
    const matchQ = !q || r.registrant_name?.toLowerCase().includes(q) || r.registrant_email?.toLowerCase().includes(q) || r.team_name?.toLowerCase().includes(q);
    const matchS = regStatusFilter === 'all' || r.status === regStatusFilter;
    return matchQ && matchS;
  });

  if (!loaded) return <div style={{padding:20,color:'var(--text3)'}}>Loading…</div>;

  // ── Registrant detail view ───────────────────────────────────────
  if (view === 'registrant_detail' && selReg) return (
    <div style={{maxWidth:560}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}>
        <button className="btn" onClick={() => setView('registrants')}>← Registrants</button>
        <h2 className="dsp" style={{fontSize:22,margin:0}}>{selReg.registrant_name}</h2>
      </div>

      <div style={{marginBottom:20,padding:'14px 16px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--rs)',fontSize:13,lineHeight:2}}>
        <div><span style={{color:'var(--text3)'}}>Email: </span>{selReg.registrant_email}</div>
        {selReg.registrant_phone && <div><span style={{color:'var(--text3)'}}>Phone: </span>{selReg.registrant_phone}</div>}
        {selReg.team_name && <div><span style={{color:'var(--text3)'}}>Team: </span><strong style={{color:'var(--gold)'}}>{selReg.team_name}</strong></div>}
        <div><span style={{color:'var(--text3)'}}>Status: </span>
          <span style={{color:STATUS_COLORS[selReg.status]||'var(--text)',fontWeight:700,textTransform:'capitalize'}}>{selReg.status}</span>
        </div>
        <div><span style={{color:'var(--text3)'}}>Amount Paid: </span>{parseFloat(selReg.total_amount)>0 ? fmtCurrency(parseFloat(selReg.total_amount)) : 'Free'}</div>
        <div><span style={{color:'var(--text3)'}}>Registered: </span>{new Date(selReg.created_at).toLocaleString()}</div>
        <div style={{fontFamily:'monospace',fontSize:11,color:'var(--text3)',marginTop:4}}>ID: {selReg.id}</div>
      </div>

      {selRegResponses.length > 0 && <div style={{marginBottom:20}}>
        <h3 className="dsp" style={{fontSize:14,marginBottom:10}}>Form Responses</h3>
        <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--rs)',overflow:'hidden'}}>
          {selRegResponses.map((r, i) => (
            <div key={i} style={{display:'flex',justifyContent:'space-between',gap:16,padding:'10px 14px',borderBottom:i<selRegResponses.length-1?'1px solid var(--border)':'none',fontSize:13}}>
              <span style={{color:'var(--text3)'}}>{r.field_label}</span>
              <span style={{color:'var(--text)',textAlign:'right'}}>{r.response_value || '—'}</span>
            </div>
          ))}
        </div>
      </div>}

      {selRegMembers.length > 0 && <div style={{marginBottom:20}}>
        <h3 className="dsp" style={{fontSize:14,marginBottom:10}}>Team Members</h3>
        <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--rs)',overflow:'hidden'}}>
          {selRegMembers.map((m, i) => (
            <div key={i} style={{padding:'10px 14px',borderBottom:i<selRegMembers.length-1?'1px solid var(--border)':'none',fontSize:13}}>
              <span style={{color:'var(--gold)',fontWeight:600}}>#{i+2}</span> {m.member_name}
              {m.member_email && <span style={{color:'var(--text3)'}}> — {m.member_email}</span>}
              {m.member_phone && <span style={{color:'var(--text3)'}}> · {m.member_phone}</span>}
            </div>
          ))}
        </div>
      </div>}

      {selReg.status !== 'cancelled' && <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
        {selReg.status === 'waitlisted' && (
          <button className="btn" style={{color:'var(--green)',borderColor:'var(--green)'}} disabled={promoting} onClick={promoteReg}>
            {promoting ? 'Promoting…' : '↑ Promote to Confirmed'}
          </button>
        )}
        <button className="btn" style={{color:'var(--red)',borderColor:'var(--red)'}} disabled={cancelling}
          onClick={() => { if (window.confirm(`Cancel ${selReg.registrant_name}'s registration${parseFloat(selReg.total_amount)>0?' and issue a refund':''}?`)) cancelReg(); }}>
          {cancelling ? 'Cancelling…' : parseFloat(selReg.total_amount)>0 ? 'Cancel & Refund' : 'Cancel Registration'}
        </button>
      </div>}
    </div>
  );

  // ── Registrants list view ────────────────────────────────────────
  if (view === 'registrants' && selForm) return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:6,flexWrap:'wrap'}}>
        <button className="btn" onClick={() => setView('list')}>← Forms</button>
        <h2 className="dsp" style={{fontSize:22,margin:0,flex:1}}>{selForm.title}</h2>
        <button className="btn" onClick={exportCsv}>Export CSV</button>
      </div>
      <p style={{color:'var(--text3)',fontSize:12,marginBottom:20}}>
        {filteredRegs.filter(r=>r.status==='confirmed').length} confirmed · {filteredRegs.filter(r=>r.status==='waitlisted').length} waitlisted
        {selForm.capacity ? ` · ${counts[selForm.id]||0}/${selForm.capacity} capacity` : ''}
      </p>

      <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
        <input className="fi" style={{flex:1,minWidth:180,margin:0}} placeholder="Search name, email, or team…"
          value={regSearch} onChange={e => setRegSearch(e.target.value)} />
        <select className="fi" style={{width:'auto',margin:0}} value={regStatusFilter} onChange={e => setRegStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="waitlisted">Waitlisted</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {!regsLoaded
        ? <div style={{color:'var(--text3)',padding:20}}>Loading…</div>
        : filteredRegs.length === 0
        ? <div className="empty"><div className="ic">📋</div><p>No registrations found.</p></div>
        : <div style={{overflowX:'auto'}}>
            <table className="dt">
              <thead><tr><th>Name</th><th>Email</th><th>Team</th><th>Status</th><th>Amount</th><th>Date</th><th></th></tr></thead>
              <tbody>
                {filteredRegs.map(r => (
                  <tr key={r.id}>
                    <td style={{fontWeight:600}}>{r.registrant_name}</td>
                    <td style={{fontSize:12}}>{r.registrant_email}</td>
                    <td style={{fontSize:12,color:'var(--gold)'}}>{r.team_name || '—'}</td>
                    <td><span style={{fontSize:11,fontWeight:700,textTransform:'capitalize',color:STATUS_COLORS[r.status]||'var(--text)'}}>{r.status}</span></td>
                    <td>{parseFloat(r.total_amount)>0 ? fmtCurrency(parseFloat(r.total_amount)) : 'Free'}</td>
                    <td style={{fontSize:12,color:'var(--text3)'}}>{new Date(r.created_at).toLocaleDateString()}</td>
                    <td><button className="btn" style={{padding:'3px 10px',fontSize:12}} onClick={() => openDetail(r)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
    </div>
  );

  // ── Edit / Create view ───────────────────────────────────────────
  if (view === 'edit' && editForm) return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}>
        <button className="btn" onClick={() => setView('list')}>← Back</button>
        <h2 className="dsp" style={{fontSize:26,margin:0}}>{editForm.id ? 'Edit Form' : 'New Registration Form'}</h2>
      </div>

      <section style={{marginBottom:28}}>
        <h3 className="dsp" style={{fontSize:15,marginBottom:14}}>Basic Info</h3>
        <div className="fg">
          <label className="fl">Form Title *</label>
          <input className="fi" value={editForm.title} onChange={e => upd({ title: e.target.value })} placeholder="e.g. Annual Golf Tournament Registration" />
        </div>
        <div className="fg">
          <label className="fl">Description</label>
          <textarea className="fi" rows={3} value={editForm.description} onChange={e => upd({ description: e.target.value })} placeholder="Tell registrants what this is for…" style={{resize:'vertical'}} />
        </div>
        <div className="fg" style={{marginBottom:0}}>
          <label className="fl">Category</label>
          <select className="fi" value={editForm.category} onChange={e => upd({ category: e.target.value })}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
          </select>
        </div>
      </section>

      <section style={{marginBottom:28}}>
        <h3 className="dsp" style={{fontSize:15,marginBottom:14}}>Settings</h3>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div className="fg" style={{margin:0}}>
            <label className="fl">Registration Opens</label>
            <input className="fi" type="date" value={editForm.start_date} onChange={e => upd({ start_date: e.target.value })} />
          </div>
          <div className="fg" style={{margin:0}}>
            <label className="fl">Registration Closes</label>
            <input className="fi" type="date" value={editForm.end_date} onChange={e => upd({ end_date: e.target.value })} />
          </div>
          <div className="fg" style={{margin:0}}>
            <label className="fl">Capacity <span style={{fontWeight:400,color:'var(--text3)'}}>(optional)</span></label>
            <input className="fi" type="number" min="1" value={editForm.capacity} onChange={e => upd({ capacity: e.target.value })} placeholder="No limit" />
          </div>
          <div className="fg" style={{margin:0}}>
            <label className="fl">Price Per Entry ($)</label>
            <input className="fi" type="number" min="0" step="0.01" value={editForm.price_per_entry} onChange={e => upd({ price_per_entry: e.target.value })} placeholder="0.00 for free" />
          </div>
        </div>
        <div style={{padding:'10px 14px',background:'var(--surface2)',borderRadius:'var(--rs)',cursor:'pointer',display:'flex',alignItems:'center',gap:10,marginBottom:editForm.team_size?10:0}}
          onClick={() => upd({ team_size: editForm.team_size ? '' : '2' })}>
          <input type="checkbox" checked={!!editForm.team_size} onChange={() => {}} style={{width:17,height:17,accentColor:'var(--gold)',cursor:'pointer',flexShrink:0}} />
          <label style={{cursor:'pointer',fontWeight:600,fontSize:14,userSelect:'none'}}>Team Registration</label>
        </div>
        {!!editForm.team_size && <div className="fg" style={{marginBottom:0}}>
          <label className="fl">Players / Members Per Team</label>
          <input className="fi" type="number" min="2" value={editForm.team_size} onChange={e => upd({ team_size: e.target.value })} placeholder="e.g. 4 for a foursome" />
        </div>}
      </section>

      <section style={{marginBottom:28}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <h3 className="dsp" style={{fontSize:15,margin:0}}>Custom Fields</h3>
          <button className="btn" onClick={addField}>+ Add Field</button>
        </div>
        <div style={{marginBottom:12,padding:'10px 14px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--rs)',opacity:.6}}>
          <div style={{fontSize:11,color:'var(--text3)',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>Always Included — cannot remove</div>
          {['Registrant Name','Email Address','Phone Number'].map(f => (
            <div key={f} style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,fontSize:13,color:'var(--text2)'}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:'var(--text3)',flexShrink:0}} />{f} <span style={{color:'var(--text3)',marginLeft:4}}>— required</span>
            </div>
          ))}
        </div>
        {editFields.length === 0
          ? <div style={{padding:'20px 14px',textAlign:'center',color:'var(--text3)',fontSize:13,border:'1px dashed var(--border)',borderRadius:'var(--rs)'}}>
              No custom fields yet — click "+ Add Field" to add questions
            </div>
          : editFields.map((field, idx) => (
            <div key={idx} style={{marginBottom:10,padding:'14px 16px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--rs)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{display:'flex',gap:6}}>
                  <button className="btn" style={{padding:'2px 8px',fontSize:12}} disabled={idx===0} onClick={() => moveField(idx,-1)}>↑</button>
                  <button className="btn" style={{padding:'2px 8px',fontSize:12}} disabled={idx===editFields.length-1} onClick={() => moveField(idx,1)}>↓</button>
                </div>
                <button className="btn" style={{padding:'2px 8px',fontSize:12,color:'var(--red)',borderColor:'var(--red)'}} onClick={() => removeField(idx)}>Remove</button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:8}}>
                <div className="fg" style={{margin:0}}>
                  <label className="fl">Field Type</label>
                  <select className="fi" value={field.field_type} onChange={e => updateField(idx,{field_type:e.target.value,options:''})}>
                    {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="fg" style={{margin:0}}>
                  <label className="fl">Label *</label>
                  <input className="fi" value={field.label} onChange={e => updateField(idx,{label:e.target.value})} placeholder="e.g. T-Shirt Size" />
                </div>
              </div>
              {field.field_type !== 'checkbox' && field.field_type !== 'select' && (
                <div className="fg" style={{marginBottom:8}}>
                  <label className="fl">Placeholder <span style={{fontWeight:400,color:'var(--text3)'}}>(optional)</span></label>
                  <input className="fi" value={field.placeholder} onChange={e => updateField(idx,{placeholder:e.target.value})} placeholder="Hint text shown inside the field" />
                </div>
              )}
              {field.field_type === 'select' && (
                <div className="fg" style={{marginBottom:8}}>
                  <label className="fl">Options <span style={{fontWeight:400,color:'var(--text3)'}}>(one per line)</span></label>
                  <textarea className="fi" rows={3} value={field.options} onChange={e => updateField(idx,{options:e.target.value})} placeholder={"Small\nMedium\nLarge"} style={{resize:'vertical'}} />
                </div>
              )}
              <div style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}} onClick={() => updateField(idx,{required:!field.required})}>
                <input type="checkbox" checked={field.required} onChange={()=>{}} style={{width:15,height:15,accentColor:'var(--gold)',cursor:'pointer'}} />
                <span style={{fontSize:13,color:'var(--text2)'}}>Required</span>
              </div>
            </div>
          ))
        }
      </section>

      <div style={{display:'flex',gap:10}}>
        <button className="buy" style={{flex:1}} disabled={saving||!editForm.title.trim()} onClick={saveForm}>
          {saving ? 'Saving…' : 'Save Form'}
        </button>
        <button className="btn" style={{padding:'10px 20px'}} onClick={() => setView('list')}>Cancel</button>
      </div>
    </div>
  );

  // ── Form list view ───────────────────────────────────────────────
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24,flexWrap:'wrap',gap:10}}>
        <h2 className="dsp" style={{fontSize:26}}>Registration Forms</h2>
        <button className="btn gold" onClick={startCreate}>+ New Form</button>
      </div>

      {forms.length === 0
        ? <div className="empty">
            <div className="ic">📋</div>
            <p>No registration forms yet. Create one to get started.</p>
            <button className="btn" style={{marginTop:12}} onClick={startCreate}>Create your first form</button>
          </div>
        : <div style={{overflowX:'auto'}}>
            <table className="dt">
              <thead><tr><th>Title</th><th>Category</th><th>Entries</th><th>Capacity</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {forms.map(f => (
                  <tr key={f.id}>
                    <td style={{fontWeight:600}}>{f.title}</td>
                    <td style={{textTransform:'capitalize'}}>{f.category}</td>
                    <td>
                      <button className="btn" style={{padding:'2px 8px',fontSize:11}} onClick={() => openRegistrants(f)}>
                        {counts[f.id] || 0} →
                      </button>
                    </td>
                    <td>{f.capacity ?? '—'}</td>
                    <td>{parseFloat(f.price_per_entry) > 0 ? fmtCurrency(parseFloat(f.price_per_entry)) : 'Free'}</td>
                    <td><span className={`badge ${f.status==='published'?'badge-ok':f.status==='closed'?'badge-done':''}`} style={{fontSize:10,textTransform:'capitalize'}}>{f.status}</span></td>
                    <td>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        <button className="btn" style={{padding:'4px 10px',fontSize:12}} onClick={() => startEdit(f)}>Edit</button>
                        <button className="btn" style={{padding:'4px 10px',fontSize:12,color:f.status==='published'?'var(--red)':'var(--green)',borderColor:f.status==='published'?'var(--red)':'var(--green)'}}
                          onClick={() => togglePublish(f)}>
                          {f.status === 'published' ? 'Unpublish' : 'Publish'}
                        </button>
                        <button className="btn" style={{padding:'4px 10px',fontSize:12,color:'var(--red)',borderColor:'var(--red)'}}
                          disabled={deleting===f.id}
                          onClick={() => { if (window.confirm(`Delete "${f.title}"? This cannot be undone.`)) deleteForm(f.id); }}>
                          {deleting===f.id ? '…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
    </div>
  );
};

export default RegistrationAdmin;
