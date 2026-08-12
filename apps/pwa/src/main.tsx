import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// P-PWA.15: register Service Worker minimal (syarat installable PWA).
// Pass-through fetch handler ada di public/sw.js (offline-cache = task berikutnya).
// Registrasi asinkron; jika gagal, jangan blokir render.
// PWA live di production sub-path /c/ (qlobot.web.id/c/<slug>). Scope SW dikonfig
// turun menjadi /c/ lewat register('/c/sw.js') agar TIDAK menyaeruhi dashboard
// yang dilayani di / (dashboard tidak punya SW, jadi tidak ada konflik scope).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/c/sw.js').catch(() => {})
  })
}
