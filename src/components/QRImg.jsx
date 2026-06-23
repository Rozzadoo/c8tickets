import { useState, useEffect } from "react";
import QRCodeLib from 'qrcode';

const QRImg = ({ value, size = 160, style }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCodeLib.toDataURL(value, { width: size, margin: 1, color: { dark: '#1a1007', light: '#ffffff' } })
      .then(setSrc).catch(console.error);
  }, [value, size]);
  return src
    ? <img src={src} width={size} height={size} alt="QR Code" style={{ display: 'block', ...(style || {}) }} />
    : <div style={{ width: size, height: size, background: '#f0f0f0', borderRadius: 4, ...(style || {}) }} />;
};

export default QRImg;
