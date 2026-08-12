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
  // Lompati SW untuk request API (lifeline chat): fetch() di dalam handler SW
  // dapat menghasilkan 304/0-status di Chrome sehingga ChatPage gagal baca
  // init -> berpotensi render "Toko tidak ditemukan" walaupun server mengembali
  // 200. /api/* dibiarkan ke jaringan langsung (tanpa intersepsi). Lihat laporan P-PWA.19.
  let reqUrl;
  try {
    reqUrl = new URL(event.request.url);
  } catch {
    /* abaikan, biarkan jaringan yang menangani */
  }
  if (reqUrl && reqUrl.pathname.startsWith('/api/')) return;
  // pass-through ke jaringan; hanya membuktikan SW mengontrol halaman.
  // Pada failure, kembalikan Response kosong agar fetch tak mengganggu render.
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).catch(() => new Response('', { status: 0 })),
    );
  }
});
