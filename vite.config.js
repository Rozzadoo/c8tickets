import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-stripe': ['@stripe/react-stripe-js', '@stripe/stripe-js', '@stripe/terminal-js'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-qrcode': ['html5-qrcode'],
        },
      },
    },
  },
})
