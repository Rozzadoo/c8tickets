// Adaptive QR/barcode scanner:
//   - Native (iOS/Android): uses @capacitor-mlkit/barcode-scanning — hardware-accelerated, ~3-5x faster than html5-qrcode
//   - Web (any browser): falls back to the existing ScannerWidget (html5-qrcode)
// Same public interface as ScannerWidget: { scannerId, onResult }.

import { useEffect, useRef, useState } from 'react';
import ScannerWidget from './ScannerWidget';
import { isNative } from '../lib/native';

let mlkit = null;
async function loadMlkit() {
  if (mlkit) return mlkit;
  mlkit = await import('@capacitor-mlkit/barcode-scanning');
  return mlkit;
}

const NativeScanner = ({ scannerId, onResult }) => {
  const native = isNative();
  const onResultRef = useRef(onResult);
  const [err, setErr] = useState('');
  // If the native plugin isn't wired into the iOS build (e.g. pod install didn't include ML Kit),
  // silently fall back to the html5-qrcode ScannerWidget rather than showing a broken camera view.
  const [fallbackToWeb, setFallbackToWeb] = useState(false);
  const runningRef = useRef(false);

  useEffect(() => { onResultRef.current = onResult; });

  useEffect(() => {
    if (!native || fallbackToWeb) return;
    let listenerHandle;
    let cancelled = false;

    const start = async () => {
      try {
        const m = await loadMlkit();
        if (cancelled) return;

        // Permission check + prompt
        const perm = await m.BarcodeScanner.checkPermissions();
        if (perm.camera !== 'granted') {
          const req = await m.BarcodeScanner.requestPermissions();
          if (req.camera !== 'granted') {
            setErr('Camera permission is required. Enable it in Settings → C8 Tickets Staff → Camera.');
            return;
          }
        }
        if (cancelled) return;

        // Make the WebView background transparent so the camera preview shows through
        document.documentElement.classList.add('mlkit-scanner-active');
        document.body.classList.add('mlkit-scanner-active');

        listenerHandle = await m.BarcodeScanner.addListener('barcodeScanned', (result) => {
          const value = result?.barcode?.rawValue;
          if (value && onResultRef.current) onResultRef.current(value.trim());
        });

        await m.BarcodeScanner.startScan({
          formats: [m.BarcodeFormat.QrCode, m.BarcodeFormat.DataMatrix, m.BarcodeFormat.Code128],
          lensFacing: m.LensFacing.Back,
        });
        runningRef.current = true;
      } catch (e) {
        console.error('[NativeScanner] start failed:', e);
        const msg = String(e?.message || e || '');
        // Plugin isn't linked into the native project — fall back to the web scanner
        if (msg.includes('not implemented') || msg.includes('plugin_not_installed')) {
          console.warn('[NativeScanner] ML Kit unavailable, falling back to web scanner');
          setFallbackToWeb(true);
          return;
        }
        setErr(msg || 'Could not start the camera.');
      }
    };

    start();

    return () => {
      cancelled = true;
      (async () => {
        try {
          if (listenerHandle) await listenerHandle.remove();
        } catch {}
        try {
          const m = await loadMlkit();
          if (runningRef.current) {
            await m.BarcodeScanner.stopScan();
            runningRef.current = false;
          }
        } catch {}
        document.documentElement.classList.remove('mlkit-scanner-active');
        document.body.classList.remove('mlkit-scanner-active');
      })();
    };
  }, [native, scannerId]);

  // Web path — reuse existing widget (html5-qrcode). Same path used as a fallback on native
  // if the ML Kit plugin isn't linked (see fallbackToWeb).
  if (!native || fallbackToWeb) return <ScannerWidget scannerId={scannerId} onResult={onResult} />;

  // Native path — the camera renders behind the WebView. Show a scanning overlay UI.
  return (
    <div style={{
      position: 'relative', width: '100%', minHeight: 380,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: err ? 'var(--bg3)' : 'transparent',
      borderRadius: 'var(--r)',
    }}>
      {err ? (
        <div style={{padding:'14px 16px', color:'var(--red)', fontSize:13, textAlign:'center', lineHeight:1.6}}>{err}</div>
      ) : (
        <>
          {/* Corner brackets to indicate the scan region */}
          <div style={{position:'absolute', top:'50%', left:'50%', width:250, height:250, transform:'translate(-50%,-50%)', pointerEvents:'none'}}>
            {['top left', 'top right', 'bottom left', 'bottom right'].map((corner, i) => {
              const [v, h] = corner.split(' ');
              return (
                <div key={i} style={{
                  position:'absolute',
                  [v]: 0, [h]: 0,
                  width: 36, height: 36,
                  borderColor: 'var(--gold)',
                  borderStyle: 'solid',
                  borderWidth: 0,
                  [`border${v[0].toUpperCase()+v.slice(1)}Width`]: 4,
                  [`border${h[0].toUpperCase()+h.slice(1)}Width`]: 4,
                  borderRadius: 4,
                }}/>
              );
            })}
          </div>
          <div style={{position:'absolute', bottom:16, left:0, right:0, textAlign:'center', color:'#fff', textShadow:'0 1px 3px rgba(0,0,0,0.7)', fontSize:13, fontWeight:600}}>
            Point the camera at a QR code
          </div>
        </>
      )}
    </div>
  );
};

export default NativeScanner;
