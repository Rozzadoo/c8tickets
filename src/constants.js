export const TENANT_ID = import.meta.env.VITE_TENANT_ID || '2c3f53cf-929d-4484-a637-1bc31cccdbe1'
export const CROOKED_8_TENANT_ID = TENANT_ID

// Empty on web (relative paths work via Vercel). Set to https://c8tickets.com for mobile builds.
export const API_BASE = import.meta.env.VITE_API_URL || ''
export const APP_URL = import.meta.env.VITE_APP_URL || 'https://c8tickets.com'
