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

/* ===== FASE 4 — Web Push signal (NOT message transport) ===== */

// FASE 4: VAPID public key (base64url, from /init) + customer identity, cached
// on the SW for use by pushsubscriptionchange to refresh/re-subscribe. Set by
// the client via postMessage({ type:'FASE4_IDENTITY', slug, uid, vapidPublicKey }).
self.__fase4Identity = self.__fase4Identity || null;
self.addEventListener('message', (event) => {
  const data = event?.data || {};
  if (data && data.type === 'FASE4_IDENTITY') {
    self.__fase4Identity = {
      slug: data.slug,
      uid: data.uid,
      vapidPublicKey: data.vapidPublicKey,
    };
  }
});

// base64url -> Uint8Array (VAPID applicationServerKey).
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

// FASE 4: push = NOTIFICATION SIGNAL ONLY. Parse minimal payload, show
// notification, do NOT persist any message (no conversation_history INSERT).
// Body never carries token/private key (server omits them).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try {
      data = { title: event.data ? event.data.text() : 'QloBot' };
    } catch {
      data = {};
    }
  }
  const title = (data && data.title) || 'QloBot';
  const options = {
    body: (data && data.body) || '',
    icon: '/c/icons/icon-192.png',
    badge: '/c/icons/icon-192.png',
    tag: (data && data.conversationId) || 'qlobot-notification',
    data: { url: (data && data.url) || '/c/' }, // deep-link; NO token in URL
    requireInteraction: false,
    vibrate: [100, 50, 100],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// FASE 4: click -> focus existing PWA window OR open the conversation deep-link.
// URL is a store-scoped path (/c/<slug>) — never carries Bearer/access token.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/c/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const same = clientList.find((c) => c.url === target);
      if (same) return same.focus();
      return clients.openWindow(target);
    }).catch(() => clients.openWindow(target)),
  );
});

// FASE 4: subscription refresh. Browser may rotate the subscription; renew it
// via the cached identity + VAPID key, then POST to /pwa/:slug/subscribe
// (which UPDATE existing Customer.pushSubscription). No token in URL.
self.addEventListener('pushsubscriptionchange', (event) => {
  const id = self.__fase4Identity;
  if (!id || !id.slug || !id.uid || !id.vapidPublicKey) return; // unknown identity -> nothing to refresh
  const reg = self.registration;
  event.waitUntil(
    (async () => {
      try {
        const oldSub = await reg.pushManager.getSubscription();
        if (oldSub) await oldSub.unsubscribe();
      } catch { /* ignore */ }
      let newSub;
      try {
        newSub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(id.vapidPublicKey),
        });
      } catch {
        return; // refresh failed — client will re-subscribe on next open
      }
      try {
        await fetch(`/api/pwa/${id.slug}/subscribe`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ uid: id.uid, subscription: newSub }),
        });
      } catch { /* network failure — skip */ }
    })(),
  );
});
