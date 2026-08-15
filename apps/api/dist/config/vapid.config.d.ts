/**
 * FASE 4 — VAPID configuration loader.
 *
 * Public key may be exposed to the PWA (it is public). The PRIVATE key is
 * server-only and is NEVER sent to the client (FASE 4 rule H).
 *
 * Returns `null` when keys are absent so the NotificationService can degrade
 * gracefully (boot still works; push is simply disabled) instead of crashing.
 */
export interface VapidConfig {
    publicKey: string;
    privateKey: string;
    subject: string;
}
export declare function getVapidConfig(): VapidConfig | null;
//# sourceMappingURL=vapid.config.d.ts.map