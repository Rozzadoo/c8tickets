import { useState, useEffect, useRef } from "react";
import { Html5Qrcode } from 'html5-qrcode';

const ScannerWidget = ({ scannerId, onResult }) => {
  const onResultRef = useRef(onResult);
  const [camErr, setCamErr] = useState('');
  useEffect(() => { onResultRef.current = onResult; });
  useEffect(() => {
    setCamErr('');
    let qr = new Html5Qrcode(scannerId);
    let stopped = false;
    const stop = () => { if (!stopped) { stopped = true; qr.stop().catch(() => {}); } };
    qr.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (text) => { onResultRef.current(text.trim()); },
      () => {}
    ).catch(e => {
      console.error(e);
      setCamErr('Camera blocked or unavailable. On iPhone: Settings → Safari → Camera → Allow for c8tickets.com, then tap "Scan Ticket" again.');
    });
    return () => { stop(); };
  }, [scannerId]);
  return <div style={{width:'100%'}}>
    {camErr && <div style={{padding:'12px 14px',marginBottom:8,background:'rgba(179,58,42,.12)',border:'1px solid rgba(179,58,42,.3)',borderRadius:'var(--rs)',fontSize:12,color:'var(--red)',lineHeight:1.6}}>{camErr}</div>}
    <div id={scannerId} style={{width:'100%',minHeight:camErr?0:300,background:'var(--bg3)',borderRadius:'var(--r)'}} />
  </div>;
};

export default ScannerWidget;
