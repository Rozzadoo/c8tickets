import { useState, useRef } from "react";
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { fmtCurrency } from '../lib/utils';

const CheckoutForm = ({ cartTotal, totalTickets, paymentAmounts, onSuccess, onBack }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const submittingRef = useRef(false);
  const serviceFees = totalTickets * 2;
  const salesTax = paymentAmounts?.salesTax ?? 0;
  const processingFee = paymentAmounts?.processingFee ?? 0;
  const grandTotal = paymentAmounts?.grandTotal || (cartTotal + serviceFees);

  const handleSubmit = async () => {
    if (submittingRef.current || !stripe || !elements) return;
    submittingRef.current = true;
    setProcessing(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) { setError(submitError.message); setProcessing(false); return; }

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message);
      setProcessing(false);
      submittingRef.current = false;
    } else if (paymentIntent && paymentIntent.status === 'succeeded') {
      onSuccess(paymentIntent.id);
    }
  };

  return (
    <div>
      <div className="tkt-sec" style={{ marginBottom: 16 }}>
        <h3 className="dsp">Order Summary</h3>
        <div className="cart-ln"><span>Ticket Subtotal</span><span>{fmtCurrency(cartTotal)}</span></div>
        <div className="cart-ln"><span>Sales Tax (6%)</span><span>${Number(salesTax).toFixed(2)}</span></div>
        <div className="cart-ln"><span>Service Fee ({totalTickets} × $2.00)</span><span>{fmtCurrency(serviceFees)}</span></div>
        <div className="cart-ln"><span>Payment Processing Fee</span><span>${Number(processingFee).toFixed(2)}</span></div>
        <div className="cart-tot"><span>Total</span><span>{fmtCurrency(grandTotal)}</span></div>
      </div>
      <div className="tkt-sec" style={{ marginBottom: 16 }}>
        <h3 className="dsp" style={{ marginBottom: 16 }}>Payment</h3>
        <PaymentElement />
        {error && <p style={{ color: "var(--red)", fontSize: 12, marginTop: 10 }}>{error}</p>}
      </div>
      <label style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer",marginBottom:14,padding:"12px 14px",background:"var(--bg3)",borderRadius:"var(--rs)",border:`1px solid ${agreed?"rgba(200,146,42,.25)":"var(--bg4)"}`}}>
        <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{marginTop:2,accentColor:"var(--gold)",flexShrink:0,width:15,height:15,cursor:"pointer"}} />
        <span style={{fontSize:12,color:"var(--text2)",lineHeight:1.6}}>I understand that <strong style={{color:"var(--text)"}}>all sales are final and non-refundable</strong> unless the event is cancelled by the organizer. By completing this purchase I agree to the C8Tickets Terms of Service.</span>
      </label>
      <button className="buy" onClick={handleSubmit} disabled={!stripe || processing || !agreed}>
        {processing ? "Processing..." : `Pay ${fmtCurrency(grandTotal)}`}
      </button>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginTop:12,marginBottom:4}}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7a6c54" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span style={{fontSize:11,color:"var(--text3)"}}>Secured by</span>
        <svg width="34" height="14" viewBox="0 0 60 25" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.4 9.8c0-1.4 1.2-2 3-2 2.7 0 6.2.8 8.9 2.3V4.3C12.6 3 9.9 2.4 7.2 2.4 3.2 2.4.4 4.5.4 10c0 8.5 11.7 7.1 11.7 10.7 0 1.7-1.4 2.2-3.4 2.2-2.9 0-6.6-1.2-9.5-2.8v5.9c3.2 1.4 6.5 2 9.5 2 7.3 0 9.8-3.6 9.8-7.4-.1-9.2-11.1-7.5-11.1-10.8zM28 6.9l-3.8.8V2.9l-5.7 1.2v18.8H24V10c1.3-.4 3.4-.3 4.6.2V5.4c-1.3-.4-3.6-.3-4.6.2l4-.7zM33.5 4l5.7-1.2v18.7h-5.7V4zm0-3.8c0-1.7 1.3-2.7 3-2.1 1.6.4 2.7 2 2.7 3.7s-1.3 2.7-2.8 2.3c-1.7-.4-2.9-2.1-2.9-3.9zM48.3 7.6l-.4-1.7h-5v16h5.7V12c1.3-1.7 3.6-1.4 4.3-1.2V5.8c-.8-.2-3.3-.6-4.6 1.8zm10.4-3.4c-2 0-3.3.9-4 1.6l-.3-1.3H49v21.2l5.7-1.2V23c.7.5 1.8 1.1 3.6 1.1 3.6 0 6.9-2.9 6.9-9.3-.1-5.8-3.4-10.6-6.5-10.6zm-1.1 15c-1.2 0-1.9-.4-2.4-1V11.5c.5-.6 1.2-1 2.4-1 1.8 0 3.1 2 3.1 4.5s-1.3 4.2-3.1 4.2z" fill="#7a6c54"/></svg>
        <span style={{fontSize:11,color:"var(--text3)"}}>· Encrypted & secure</span>
      </div>
      <button className="btn" style={{ width: "100%", marginTop: 8 }} onClick={onBack}>← Back</button>
    </div>
  );
};

export default CheckoutForm;
