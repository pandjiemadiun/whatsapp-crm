import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Scaffold apps/pwa (P-PWA.11). Mengikuti pola apps/dashboard:
// - plugin react + tailwindcss (v4)
// - Vite dev proxy '/api' -> http://localhost:3000 (backend api pm2)
// - server.port 5174 (beda 5173 dashboard) supaya bisa jalan bersamaan
// - preview host:true (allowedHosts ditentukan saat deploy, bukan scope task ini)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
  },
})
