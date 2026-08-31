import webPush from 'web-push';
import { getVapidConfig } from '../config/vapid.config.js';
import { adapters } from '../adapters/container.js';

export interface PushSubscriptionDTO {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag?: string;
  timestamp?: string;
}

let configured = false;

export function ensureVapidConfigured(): boolean {
  if (configured) return true;
  const cfg = getVapidConfig();
  if (!cfg) {
    adapters.logger.warn('VAPID keys not configured — web push DISABLED');
    return false;
  }
  webPush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  configured = true;
  return true;
}

function isSubscriptionError(e: any): boolean {
  if (!e) return false;
  const code = e.statusCode || e.code;
  if (code === 404 || code === 410) return true;
  const msg = (e?.message || String(e)).toLowerCase();
  return /410|gone|expired|invalid subscription|unsubscribe|removed/i.test(msg);
}

export async function sendPush(
  subscription: PushSubscriptionDTO,
  message: PushMessage,
): Promise<{ ok: boolean; expired: boolean }> {
  if (!ensureVapidConfigured()) return { ok: false, expired: false };
  try {
    await webPush.sendNotification(
      subscription as unknown as webPush.PushSubscription,
      JSON.stringify(message),
      { TTL: 60 * 60 },
    );
    return { ok: true, expired: false };
  } catch (e: any) {
    if (isSubscriptionError(e)) {
      return { ok: false, expired: true };
    }
    adapters.logger.error('push send failed', { error: e?.message, statusCode: e?.statusCode });
    return { ok: false, expired: false };
  }
}
