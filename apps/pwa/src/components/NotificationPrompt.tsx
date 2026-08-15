import { useState, useEffect } from 'react';
import api from '../services/api';
import { urlBase64ToUint8Array } from '../utils/vapid';

/**
 * FASE 4 — Web Push opt-in (notification signal, NOT a message transport).
 *
 * Triggered ONLY by an explicit user action (button click) — never on page load
 * (owner rule: "Do not request permission blindly on page load"). If permission
 * is denied, the chat continues normally over Socket.IO.
 *
 * Flow:
 *  1. Notification.requestPermission()
 *  2. navigator.serviceWorker.ready -> registration.pushManager.subscribe(VAPID public key)
 *  3. POST /api/pwa/:slug/subscribe { uid, subscription }  (server-authoritative)
 *  4. postMessage identity to the SW so its pushsubscriptionchange can refresh.
 *
 * Props intentionally minimal — ChatPage only mounts this; no redesign of ChatPage.
 */
interface NotificationPromptProps {
  slug: string | null | undefined;
  uid: string | null | undefined;
  conversationId: string | null | undefined;
  vapidPublicKey: string | null | undefined;
}

export default function NotificationPrompt({
  slug,
  uid,
  conversationId,
  vapidPublicKey,
}: NotificationPromptProps) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      setPermission(Notification.permission);
    }
  }, []);

  // Only show the prompt when we have a complete customer context + VAPID key +
  // a known conversation, and the user has not already granted/denied+subscribed.
  const showPrompt =
    typeof Notification !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    !!slug &&
    !!uid &&
    !!conversationId &&
    !!vapidPublicKey &&
    permission === 'default' &&
    !subscribed;

  const enable = async () => {
    setErr(null);
    setLoading(true);
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== 'granted') {
        // Permission denied: chat continues normally via Socket.IO. Do nothing else.
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!) as unknown as BufferSource,
      });
      await api.post(`/pwa/${slug}/subscribe`, { uid, subscription: sub });
      // Hand identity to the SW so pushsubscriptionchange can refresh server-side.
      navigator.serviceWorker.controller?.postMessage({
        type: 'FASE4_IDENTITY',
        slug,
        uid,
        vapidPublicKey,
      });
      setSubscribed(true);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal mengaktifkan notifikasi');
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
           className="ml-2 text-xs px-2 py-1 rounded border border-primary text-primary hover:bg-primary/5 disabled:opacity-50"
      aria-label="Aktifkan notifikasi push"
      title="Dapatkan notifikasi saat belum online"
    >
      {loading ? 'Mengaktifkan…' : '🔔 Notifikasi'}
    </button>
  );
}
