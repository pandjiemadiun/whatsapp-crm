/**
 * FASE 4 — VAPID configuration loader.
 *
 * Public key may be exposed to the PWA (it is public). The PRIVATE key is
 * server-only and is NEVER sent to the client (FASE 4 rule H).
 *
 * Returns `null` when keys are absent so the NotificationService can degrade
 * gracefully (boot still works; push is simply disabled) instead of crashing.
 */
export function getVapidConfig() {
    const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
    const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
    const subject = (process.env.VAPID_SUBJECT || 'mailto:admin@qlobot.local').trim();
    if (!publicKey || !privateKey) {
        return null;
    }
    return { publicKey, privateKey, subject };
}
//# sourceMappingURL=vapid.config.js.map