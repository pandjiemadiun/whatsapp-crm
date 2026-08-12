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
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
