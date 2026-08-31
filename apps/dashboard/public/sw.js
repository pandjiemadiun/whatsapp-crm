/* Dashboard Service Worker — minimal, push signal only.
 * Fetch handler = pass-through (API lifeline untouched).
 * Push = NOTIFICATION SIGNAL ONLY (no message insert, no token in URL). */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  let reqUrl;
  try {
    reqUrl = new URL(event.request.url);
  } catch {
    return;
  }
  if (reqUrl.pathname.startsWith('/api/')) return;
  if (event.request.method === 'GET') {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 0 })));
  }
});

/* ===== Web Push signal (merchant dashboard) ===== */

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

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
  const title = data.title || 'QloBot';
  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.tag || 'qlobot-merchant',
    data: { url: data.url || '/dashboard' },
    requireInteraction: false,
    vibrate: [100, 50, 100],
  };

  // Notify all clients about the push event (for E2E verification)
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'PUSH_RECEIVED', payload: data });
      }
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const same = clientList.find((c) => c.url.includes(target));
      if (same) return same.focus();
      return clients.openWindow(target);
    }).catch(() => clients.openWindow(target)),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      let newSub;
      try {
        const oldSub = await self.registration.pushManager.getSubscription();
        if (oldSub) await oldSub.unsubscribe();
      } catch { /* ignore */ }
      try {
        newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(self.__vapidPublicKey),
        });
      } catch {
        return;
      }
      try {
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${self.__storeToken}` },
          body: JSON.stringify({ subscription: newSub }),
        });
      } catch { /* network — skip */ }
    })(),
  );
});

// Client sets identity for subscription refresh.
self.addEventListener('message', (event) => {
  const data = event?.data || {};
  if (data.type === 'MERCHANT_PUSH_IDENTITY') {
    self.__vapidPublicKey = data.vapidPublicKey;
    self.__storeToken = data.storeToken;
  }
});
