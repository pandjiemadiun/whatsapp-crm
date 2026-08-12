import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Scaffold apps/pwa (P-PWA.11). Mengikuti pola apps/dashboard:
// - plugin react + tailwindcss (v4)
// - Vite dev proxy '/api' -> http://localhost:3000 (backend api pm2)
// - server.port 5174 (beda 5173 dashboard) supaya bisa jalan bersamaan
// - preview host:true (allowedHosts ditentukan saat deploy, bukan scope task ini)
export default defineConfig({
  // PWA live di production sub-path /c/ (qlobot.web.id/c/<slug>).
  // `base` ini mem-prefix chunk JS/CSS build menjadi /c/assets/* sehingga
  // proxy_pass nginx `location /c/ { ... 8081/; }` (yang strip prefix /c/)
  // menyajikan file yang benar di vite preview.
  base: '/c/',
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
    // P-PWA.19 deploy: PM2 vite preview di belakang nginx :8081; nginx set
    // Host: qlobot.web.id. allowedHosts HARUS mencantumkan domain publik
    // (dicontek dari apps/dashboard vite.config.ts) — tanpa ini Vite preview
    // balik 403 "Blocked request. This host is not allowed."
    allowedHosts: ['qlobot.web.id', 'api.qlobot.web.id'],
  },
})
