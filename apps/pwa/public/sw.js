/* P-PWA.15: Service Worker minimal — hanya dipasang demi syarat installable PWA.
 * Fetch handler = pass-through jaringan (TIDAK ada offline-cache logic rumit).
 * Cache/offline-capable strategy = task terpisah di lain waktu.
 *
 * Sumber daya statis (manifest.json, sw.js, icons) berada di public/ sehingga
 * Vite menyalinnya ke dist/ akar saat build -> tersedia di origin yang sama. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // pass-through ke jaringan; hanya membuktikan SW mengontrol halaman.
  // Pada failure, kembalikan Response kosong agar fetch tak mengganggu render.
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).catch(() => new Response('', { status: 0 })),
    );
  }
});
