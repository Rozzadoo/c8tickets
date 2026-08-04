import { useState, useEffect } from "react";
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { supabase } from '../lib/supabase';
import { stripePromise } from '../lib/stripe';
import { API_BASE, APP_URL } from '../constants';
import { fmtCurrency, fetchWithTimeout } from '../lib/utils';
import QRImg from './QRImg';

// ── Inner Stripe payment form ────────────────────────────────────────
const RegPayForm = ({ amounts, onSuccess, onBack }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setPaying(true);
    setPayError('');
    const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (error) { setPayError(error.message); setPaying(false); }
    else onSuccess();
  };

  return (
    <div>
      <div style={{marginBottom:16}}><PaymentElement /></div>
      {payError && <p style={{color:'var(--red)',fontSize:13,marginBottom:12}}>{payError}</p>}
      <button className="buy" style={{width:'100%',marginBottom:8}} disabled={paying||!stripe} onClick={handlePay}>
        {paying ? 'Processing…' : `Pay ${fmtCurrency(amounts.grandTotal)}`}
      </button>
      <button className="btn" style={{width:'100%'}} disabled={paying} onClick={onBack}>← Back</button>
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────
const RegistrationPublic = ({ formId, tenantId, venue, onHome }) => {
  const [form, setForm]         = useState(null);
  const [fields, setFields]     = useState([]);
  const [step, setStep]         = useState('loading');
  const [count, setCount]       = useState(0);
  const [isWaitlist, setIsWaitlist] = useState(false);
  const [registrant, setRegistrant] = useState({ name: '', email: '', phone: '' });
  const [teamName, setTeamName] = useState('');
  const [members, setMembers]   = useState([]);
  const [answers, setAnswers]   = useState({});
  const [errors, setErrors]     = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [amounts, setAmounts]   = useState(null);
  const [regId, setRegId]       = useState(null);
  const [dupWarning, setDupWarning] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: formData } = await supabase
        .from('registration_forms').select('*').eq('id', formId).single();
      if (!formData) { setStep('not_found'); return; }

      const { data: fieldData } = await supabase
        .from('form_fields').select('*').eq('form_id', formId).order('sort_order');
      setFields(fieldData || []);

      const { count: regCount } = await supabase
        .from('registrations').select('id', { count: 'exact', head: true })
        .eq('form_id', formId).neq('status', 'cancelled');
      setCount(regCount || 0);

      const now = new Date().toISOString().slice(0, 10);
      const isClosed = formData.status !== 'published'
        || (formData.end_date && formData.end_date < now)
        || (formData.start_date && formData.start_date > now);

      if (isClosed) { setForm(formData); setStep('closed'); return; }

      const full = formData.capacity && (regCount || 0) >= formData.capacity;
      if (full) setIsWaitlist(true);

      if (formData.team_size) {
        setMembers(Array.from({ length: formData.team_size - 1 }, () => ({ name: '', email: '', phone: '' })));
      }

      setForm(formData);
      setStep('form');
    })();
  }, [formId]);

  const checkDup = async (email) => {
    if (!email || !email.includes('@')) return;
    const { data } = await supabase.from('registrations')
      .select('id').eq('form_id', formId).eq('registrant_email', email.toLowerCase().trim())
      .neq('status', 'cancelled').limit(1);
    setDupWarning(!!(data?.length));
  };

  const validate = (targetStep) => {
    const errs = {};
    if (targetStep === 'team' || targetStep === 'review') {
      if (!registrant.name.trim()) errs.name = 'Name is required';
      if (!registrant.email.trim() || !registrant.email.includes('@')) errs.email = 'Valid email is required';
      if (form.team_size && !teamName.trim()) errs.teamName = 'Team name is required';
      fields.forEach(f => {
        if (f.required && !answers[f.id]?.trim()) errs[f.id] = `${f.label} is required`;
      });
    }
    if (targetStep === 'review' && form.team_size) {
      members.forEach((m, i) => {
        if (!m.name.trim()) errs[`member_${i}_name`] = `Member ${i + 2} name is required`;
      });
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const advanceTo = (next) => {
    if (!validate(next)) return;
    setStep(next);
    window.scrollTo(0, 0);
  };

  const submitFree = async () => {
    if (!validate('review')) return;
    setSubmitting(true);
    try {
      await doInsert(null, 0);
    } finally { setSubmitting(false); }
  };

  const startPayment = async () => {
    if (!validate('review')) return;
    setSubmitting(true);
    try {
      const res = await fetchWithTimeout(API_BASE + '/api/create-registration-intent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId, tenantId, registrantName: registrant.name, registrantEmail: registrant.email }),
      }, 15000);
      const data = await res.json();
      if (!data.clientSecret) { alert(data.error || 'Payment setup failed. Please try again.'); return; }
      setClientSecret(data.clientSecret);
      setAmounts(data);
      setStep('payment');
      window.scrollTo(0, 0);
    } catch (e) {
      alert(e?.message === 'timeout'
        ? 'Connection is slow. Payment setup timed out — no charge was made. Please try again.'
        : 'Payment setup failed. Please try again.');
    } finally { setSubmitting(false); }
  };

  const doInsert = async (paymentIntentId, totalAmount) => {
    const status = isWaitlist ? 'waitlisted' : 'confirmed';
    const { data: reg, error } = await supabase.from('registrations').insert({
      form_id: formId, tenant_id: tenantId,
      registrant_name: registrant.name.trim(),
      registrant_email: registrant.email.trim().toLowerCase(),
      registrant_phone: registrant.phone.trim(),
      team_name: teamName.trim() || null,
      status, total_amount: totalAmount || 0,
      stripe_payment_intent_id: paymentIntentId || null,
    }).select().single();

    if (error) { alert('Could not save your registration. Please try again.'); return; }

    if (fields.length > 0) {
      const responses = fields
        .filter(f => answers[f.id] !== undefined && answers[f.id] !== '')
        .map(f => ({ registration_id: reg.id, field_id: f.id, field_label: f.label, response_value: answers[f.id] }));
      if (responses.length) await supabase.from('registration_responses').insert(responses);
    }

    if (form.team_size && members.length > 0) {
      const mRows = members.filter(m => m.name.trim()).map(m => ({
        registration_id: reg.id,
        member_name: m.name.trim(), member_email: m.email.trim(), member_phone: m.phone.trim(),
      }));
      if (mRows.length) await supabase.from('registration_members').insert(mRows);
    }

    fetch(API_BASE + '/api/send-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'registration', registrationId: reg.id, venueName: venue?.name || '' }),
    }).catch(() => {});

    setRegId(reg.id);
    setStep('confirm');
    window.scrollTo(0, 0);
  };

  const onPaymentSuccess = async () => {
    setSubmitting(true);
    try { await doInsert(null, amounts?.grandTotal || 0); }
    finally { setSubmitting(false); }
  };

  const fi = (id) => fields.find(f => f.id === id);
  const err = (key) => errors[key] ? <div style={{color:'var(--red)',fontSize:12,marginTop:4}}>{errors[key]}</div> : null;

  // ── Loading ──
  if (step === 'loading') return (
    <div style={{textAlign:'center',padding:'60px 20px',color:'var(--text3)'}}>Loading…</div>
  );

  // ── Not found ──
  if (step === 'not_found') return (
    <div className="empty"><div className="ic">🔍</div><p>Registration form not found.</p>
      <button className="btn" style={{marginTop:12}} onClick={onHome}>← Back to home</button></div>
  );

  // ── Closed ──
  if (step === 'closed') return (
    <div className="empty"><div className="ic">🔒</div>
      <p style={{fontWeight:700,fontSize:18,marginBottom:8}}>{form?.title}</p>
      <p>Registration is currently closed.</p>
      <button className="btn" style={{marginTop:12}} onClick={onHome}>← Back to home</button></div>
  );

  // ── Confirm ──
  if (step === 'confirm') return (
    <div style={{textAlign:'center',maxWidth:440,margin:'0 auto',paddingTop:20}}>
      <p style={{fontFamily:'monospace',fontSize:11,fontWeight:700,letterSpacing:1,marginBottom:16,color:isWaitlist?'var(--gold)':'var(--green)'}}>
        {isWaitlist ? '⏳ ADDED TO WAITLIST' : '✓ REGISTRATION CONFIRMED'}
      </p>
      <h2 className="dsp" style={{fontSize:24,marginBottom:8}}>{form.title}</h2>
      {form.team_size && teamName && <p style={{color:'var(--gold)',fontWeight:700,marginBottom:8}}>Team: {teamName}</p>}
      <p style={{color:'var(--text2)',fontSize:13,marginBottom:24}}>
        {isWaitlist
          ? "You're on the waitlist. We'll email you if a spot opens up."
          : `A confirmation email has been sent to ${registrant.email}.`}
      </p>
      {!isWaitlist && regId && <div style={{background:'white',borderRadius:12,padding:16,display:'inline-block',marginBottom:16}}>
        <QRImg value={`${APP_URL}/r/${formId}?reg=${regId}`} size={180} />
      </div>}
      {!isWaitlist && <p style={{fontSize:12,color:'var(--text3)',marginBottom:24}}>Show this QR code at the event for check-in</p>}
      <button className="btn" style={{width:'100%'}} onClick={onHome}>← Back to home</button>
    </div>
  );

  // ── Payment ──
  if (step === 'payment' && clientSecret && amounts) return (
    <div style={{maxWidth:480}}>
      <h2 className="dsp" style={{fontSize:26,marginBottom:4}}>{form.title}</h2>
      <p style={{color:'var(--text2)',fontSize:13,marginBottom:20}}>Complete your registration</p>
      <div className="tkt-sec" style={{marginBottom:20}}>
        <div className="cart-ln"><span>Registration Fee</span><span>{fmtCurrency(amounts.entryPrice)}</span></div>
        <div className="cart-ln"><span>Sales Tax (6%)</span><span>{fmtCurrency(amounts.salesTax)}</span></div>
        <div className="cart-ln"><span>Processing Fee</span><span>{fmtCurrency(amounts.processingFee)}</span></div>
        <div className="cart-tot"><span>Total</span><span>{fmtCurrency(amounts.grandTotal)}</span></div>
      </div>
      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#c8922a', fontFamily: 'Barlow, sans-serif' } } }}>
        <RegPayForm amounts={amounts} onSuccess={onPaymentSuccess} onBack={() => setStep('review')} />
      </Elements>
    </div>
  );

  // ── Review ──
  if (step === 'review') return (
    <div style={{maxWidth:560}}>
      <h2 className="dsp" style={{fontSize:26,marginBottom:4}}>{form.title}</h2>
      <p style={{color:'var(--text2)',fontSize:13,marginBottom:20}}>Review your registration</p>
      <div style={{marginBottom:20,padding:'14px 16px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--rs)',fontSize:13,lineHeight:1.8}}>
        <div><span style={{color:'var(--text3)'}}>Name: </span><strong>{registrant.name}</strong></div>
        <div><span style={{color:'var(--text3)'}}>Email: </span>{registrant.email}</div>
        {registrant.phone && <div><span style={{color:'var(--text3)'}}>Phone: </span>{registrant.phone}</div>}
        {form.team_size && teamName && <div><span style={{color:'var(--text3)'}}>Team: </span><strong style={{color:'var(--gold)'}}>{teamName}</strong></div>}
        {fields.map(f => answers[f.id] ? <div key={f.id}><span style={{color:'var(--text3)'}}>{f.label}: </span>{answers[f.id]}</div> : null)}
      </div>
      {form.team_size && members.length > 0 && <div style={{marginBottom:20,padding:'14px 16px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--rs)'}}>
        <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>Team Members</div>
        {members.filter(m => m.name.trim()).map((m, i) => (
          <div key={i} style={{fontSize:13,marginBottom:4}}><span style={{color:'var(--gold)',fontWeight:600}}>#{i+2}</span> {m.name}{m.email ? ` — ${m.email}` : ''}</div>
        ))}
      </div>}
      {parseFloat(form.price_per_entry) > 0 && !isWaitlist && <div className="tkt-sec" style={{marginBottom:16}}>
        <div className="cart-tot"><span>Total Due</span><span style={{color:'var(--gold)'}}>{fmtCurrency(parseFloat(form.price_per_entry))}<span style={{fontSize:11,color:'var(--text3)',fontWeight:400}}> + tax & fees</span></span></div>
      </div>}
      {isWaitlist && <div style={{padding:'10px 14px',background:'rgba(200,146,42,.08)',border:'1px solid rgba(200,146,42,.25)',borderRadius:'var(--rs)',fontSize:13,color:'var(--gold)',marginBottom:16}}>
        Registration is full — you will be added to the waitlist.
      </div>}
      <div style={{display:'flex',gap:10}}>
        <button className="buy" style={{flex:1}} disabled={submitting} onClick={
          isWaitlist ? submitFree
          : parseFloat(form.price_per_entry) > 0 ? startPayment
          : submitFree
        }>
          {submitting ? 'Saving…' : isWaitlist ? 'Join Waitlist' : parseFloat(form.price_per_entry) > 0 ? `Pay & Register` : 'Complete Registration'}
        </button>
        <button className="btn" style={{padding:'10px 20px'}} onClick={() => setStep(form.team_size ? 'team' : 'form')}>← Back</button>
      </div>
    </div>
  );

  // ── Team step ──
  if (step === 'team') return (
    <div style={{maxWidth:560}}>
      <h2 className="dsp" style={{fontSize:26,marginBottom:4}}>{form.title}</h2>
      <p style={{color:'var(--text2)',fontSize:13,marginBottom:20}}>Add your team members ({form.team_size} per team)</p>
      <div style={{marginBottom:12,padding:'10px 14px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--rs)',fontSize:13}}>
        <span style={{color:'var(--gold)',fontWeight:700}}>Captain (you):</span> {registrant.name}
      </div>
      {members.map((m, i) => (
        <div key={i} style={{marginBottom:14,padding:'14px 16px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--rs)'}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:'var(--gold)'}}>Member #{i + 2}</div>
          <div className="fg">
            <label className="fl">Name *</label>
            <input className="fi" value={m.name} onChange={e => { const n=[...members]; n[i]={...n[i],name:e.target.value}; setMembers(n); }} placeholder="Full name" />
            {err(`member_${i}_name`)}
          </div>
          <div className="fg">
            <label className="fl">Email <span style={{fontWeight:400,color:'var(--text3)'}}>(optional)</span></label>
            <input className="fi" type="email" value={m.email} onChange={e => { const n=[...members]; n[i]={...n[i],email:e.target.value}; setMembers(n); }} placeholder="member@email.com" />
          </div>
          <div className="fg" style={{marginBottom:0}}>
            <label className="fl">Phone <span style={{fontWeight:400,color:'var(--text3)'}}>(optional)</span></label>
            <input className="fi" type="tel" value={m.phone} onChange={e => { const n=[...members]; n[i]={...n[i],phone:e.target.value}; setMembers(n); }} placeholder="(208) 555-0000" />
          </div>
        </div>
      ))}
      <div style={{display:'flex',gap:10}}>
        <button className="buy" style={{flex:1}} onClick={() => advanceTo('review')}>Review →</button>
        <button className="btn" style={{padding:'10px 20px'}} onClick={() => setStep('form')}>← Back</button>
      </div>
    </div>
  );

  // ── Main form step ──
  return (
    <div style={{maxWidth:560}}>
      <h2 className="dsp" style={{fontSize:26,marginBottom:4}}>{form.title}</h2>
      {form.description && <p style={{color:'var(--text2)',fontSize:14,marginBottom:20,lineHeight:1.6}}>{form.description}</p>}
      {isWaitlist && <div style={{padding:'10px 14px',background:'rgba(200,146,42,.08)',border:'1px solid rgba(200,146,42,.25)',borderRadius:'var(--rs)',fontSize:13,color:'var(--gold)',marginBottom:16}}>
        Registration is full ({count}/{form.capacity}). Enter your info to join the waitlist.
      </div>}
      {dupWarning && <div style={{padding:'10px 14px',background:'rgba(179,58,42,.1)',border:'1px solid rgba(179,58,42,.3)',borderRadius:'var(--rs)',fontSize:13,color:'var(--red)',marginBottom:16}}>
        This email address is already registered for this form.
      </div>}
      {form.team_size && <div className="fg">
        <label className="fl">Team Name *</label>
        <input className="fi" value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="e.g. The Eagles" />
        {err('teamName')}
      </div>}
      <div className="fg">
        <label className="fl">Your Name *</label>
        <input className="fi" value={registrant.name} onChange={e => setRegistrant(r => ({...r, name: e.target.value}))} placeholder="Full name" />
        {err('name')}
      </div>
      <div className="fg">
        <label className="fl">Email *</label>
        <input className="fi" type="email" value={registrant.email}
          onChange={e => { setRegistrant(r => ({...r, email: e.target.value})); setDupWarning(false); }}
          onBlur={e => checkDup(e.target.value)}
          placeholder="you@email.com" />
        {err('email')}
      </div>
      <div className="fg">
        <label className="fl">Phone</label>
        <input className="fi" type="tel" value={registrant.phone} onChange={e => setRegistrant(r => ({...r, phone: e.target.value}))} placeholder="(208) 555-0000" />
      </div>
      {fields.map(field => (
        <div className="fg" key={field.id}>
          <label className="fl">{field.label}{field.required && ' *'}</label>
          {field.field_type === 'textarea'
            ? <textarea className="fi" rows={3} value={answers[field.id]||''} onChange={e => setAnswers(a => ({...a,[field.id]:e.target.value}))} placeholder={field.placeholder||''} style={{resize:'vertical'}} />
            : field.field_type === 'select'
            ? <select className="fi" value={answers[field.id]||''} onChange={e => setAnswers(a => ({...a,[field.id]:e.target.value}))}>
                <option value="">— Select —</option>
                {(Array.isArray(field.options) ? field.options : []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            : field.field_type === 'checkbox'
            ? <div style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'8px 0'}} onClick={() => setAnswers(a => ({...a,[field.id]:a[field.id]==='Yes'?'No':'Yes'}))}>
                <input type="checkbox" checked={answers[field.id]==='Yes'} onChange={()=>{}} style={{width:17,height:17,accentColor:'var(--gold)',cursor:'pointer'}} />
                <span style={{fontSize:14}}>Yes</span>
              </div>
            : <input className="fi" type={field.field_type==='number'?'number':field.field_type==='email'?'email':field.field_type==='phone'?'tel':'text'}
                value={answers[field.id]||''} onChange={e => setAnswers(a => ({...a,[field.id]:e.target.value}))}
                placeholder={field.placeholder||''} />
          }
          {err(field.id)}
        </div>
      ))}
      <button className="buy" style={{width:'100%',marginTop:8}} onClick={() => advanceTo(form.team_size ? 'team' : 'review')}>
        {form.team_size ? 'Next — Add Team Members →' : 'Review Registration →'}
      </button>
    </div>
  );
};

export default RegistrationPublic;
