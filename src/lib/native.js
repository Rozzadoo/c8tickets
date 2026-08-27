// Native platform helpers. All Capacitor plugins gracefully degrade on web —
// isNative() gates any calls, so plain browser use is unaffected.
//
// Staff-only mode is a build-time flag (VITE_STAFF_ONLY=true) that hides
// customer-facing flows so the app opens straight to login.

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App } from '@capacitor/app';

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform(); // 'web' | 'ios' | 'android'

// Build-time flag — controlled via VITE_STAFF_ONLY env var when building the staff app.
// When true, the app hides customer purchase flows and defaults to the login screen.
export const isStaffOnly = () => import.meta.env.VITE_STAFF_ONLY === 'true';

// ── Haptics — safe on any platform, no-op on web ──────────────────────────
export const hapticSuccess = async () => {
  if (!isNative()) return;
  try { await Haptics.notification({ type: NotificationType.Success }); } catch {}
};
export const hapticError = async () => {
  if (!isNative()) return;
  try { await Haptics.notification({ type: NotificationType.Error }); } catch {}
};
export const hapticWarning = async () => {
  if (!isNative()) return;
  try { await Haptics.notification({ type: NotificationType.Warning }); } catch {}
};
export const hapticTap = async () => {
  if (!isNative()) return;
  try { await Haptics.impact({ style: ImpactStyle.Light }); } catch {}
};

// ── Network status — safe on any platform ─────────────────────────────────
export const getNetworkStatus = async () => {
  if (!isNative()) return { connected: navigator.onLine, connectionType: 'unknown' };
  try {
    const s = await Network.getStatus();
    return { connected: s.connected, connectionType: s.connectionType };
  } catch {
    return { connected: navigator.onLine, connectionType: 'unknown' };
  }
};

// Register a listener for online/offline transitions. Returns an unsubscribe fn.
export const onNetworkChange = (cb) => {
  if (!isNative()) {
    const online = () => cb({ connected: true });
    const offline = () => cb({ connected: false });
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }
  let handle;
  Network.addListener('networkStatusChange', (s) => cb(s)).then(h => { handle = h; }).catch(() => {});
  return () => { if (handle) handle.remove(); };
};

// ── Persistent key-value storage — native uses secure Preferences, web falls back to localStorage ─
export const storageGet = async (key) => {
  if (!isNative()) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  try {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  } catch { return null; }
};
export const storageSet = async (key, value) => {
  if (!isNative()) {
    try { localStorage.setItem(key, value); } catch {}
    return;
  }
  try { await Preferences.set({ key, value }); } catch {}
};
export const storageRemove = async (key) => {
  if (!isNative()) {
    try { localStorage.removeItem(key); } catch {}
    return;
  }
  try { await Preferences.remove({ key }); } catch {}
};

// ── Status bar setup for staff app — dark background, light text ─────────
export const configureStatusBar = async () => {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    if (platform() === 'android') await StatusBar.setBackgroundColor({ color: '#0f0f0f' });
  } catch {}
};

// ── App back-button handling ──────────────────────────────────────────────
// Prevents Android from closing the app on unwanted back-tap; caller decides.
export const onBackButton = (cb) => {
  if (!isNative()) return () => {};
  let handle;
  App.addListener('backButton', cb).then(h => { handle = h; }).catch(() => {});
  return () => { if (handle) handle.remove(); };
};
