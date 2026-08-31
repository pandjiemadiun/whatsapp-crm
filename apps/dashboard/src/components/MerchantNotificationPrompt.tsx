import { useState, useEffect } from 'react';
import api from '../services/api';
import { urlBase64ToUint8Array } from '../utils/vapid';

/**
 * Merchant-side Web Push opt-in. Triggered by explicit user action (button click).
 * Flow:
 *  1. Notification.requestPermission()
 *  2. serviceWorker.ready -> pushManager.subscribe(VAPID public key)
 *  3. POST /api/push/subscribe { subscription } (authMiddleware -> storeId)
 *  4. postMessage identity to SW for subscription refresh.
 */

interface MerchantNotificationPromptProps {
  vapidPublicKey: string | null | undefined;
}

export default function MerchantNotificationPrompt({ vapidPublicKey }: MerchantNotificationPromptProps) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      setPermission(Notification.permission);
    }
  }, []);

  const showPrompt =
    typeof Notification !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    !!vapidPublicKey &&
    permission === 'default' &&
    !subscribed;

  const enable = async () => {
    setLoading(true);
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!) as unknown as BufferSource,
      });

      await api.post('/push/subscribe', { subscription: sub });

      // Hand identity + token to SW for subscription refresh.
      const user = JSON.parse(localStorage.getItem('garuda_user') || '{}');
      navigator.serviceWorker.controller?.postMessage({
        type: 'MERCHANT_PUSH_IDENTITY',
        vapidPublicKey,
        storeToken: user.token,
      });

      setSubscribed(true);
    } catch {
      // silent — chat continues via Socket.IO
    } finally {
      setLoading(false);
    }
  };

  if (!showPrompt) return null;

  return (
    <button
      type="button"
      onClick={enable}
      disabled={loading}
      className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand/90 disabled:opacity-50 transition"
      aria-label="Aktifkan notifikasi"
    >
      {loading ? 'Mengaktifkan…' : '🔔 Aktifkan Notifikasi'}
    </button>
  );
}
