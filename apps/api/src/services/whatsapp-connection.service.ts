import { prisma } from '../infrastructure/prisma.js';
import { fonnteService } from './fonnte.service.js';
import { configService } from '../business/config.service.js';
import { adapters } from '../adapters/container.js';

function cacheKey(endpoint: string, paramsHash: string): string {
  if (paramsHash) {
    return `wa:${endpoint}:${paramsHash}`;
  }
  return `wa:${endpoint}`;
}

async function getCached<T>(key: string): Promise<T | null> {
  try { return await adapters.cache.get<T>(key); } catch { return null; }
}

async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try { await adapters.cache.set(key, value, ttlSeconds); } catch { /* ignore */ }
}

const TTL_WA_STATUS = 30; // 30 detik — cukup fresh untuk UI banner

export interface WhatsAppConnectionStatus {
  connected: boolean;
  gateway: 'fonnte' | 'gowa' | null;
  phoneNumber: string | null;
  lastCheckedAt: string;
}

/** Resolve GOWA config (hot-reloadable from Platform Config) */
async function getGowaConfig() {
  const [url, user, pass] = await Promise.all([
    configService.getConfig('GOWA_API_URL'),
    configService.getConfig('GOWA_BASIC_AUTH_USER'),
    configService.getConfig('GOWA_BASIC_AUTH_PASS'),
  ]);
  return {
    baseUrl: url || process.env.GOWA_API_URL || 'http://localhost:3001',
    username: user || process.env.GOWA_BASIC_AUTH_USER || 'admin',
    password: pass || process.env.GOWA_BASIC_AUTH_PASS || '',
  };
}

function deviceId(storeId: string): string {
  return `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`;
}

/** GOWA device status check (reused pattern from whatsapp.ts) */
async function checkGowaConnection(storeId: string): Promise<{ connected: boolean; phoneNumber: string | null }> {
  try {
    const cfg = await getGowaConfig();
    const did = deviceId(storeId);
    const response = await fetch(`${cfg.baseUrl}/devices/${did}/status`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64'),
      },
    });
    if (!response.ok) return { connected: false, phoneNumber: null };
    const s = (await response.json() as any).results;
    return {
      connected: s?.is_connected && s?.is_logged_in,
      phoneNumber: s?.jid ? s.jid.replace('@s.whatsapp.net', '') : null,
    };
  } catch (e: any) {
    return { connected: false, phoneNumber: null };
  }
}

/**
 * SATU SUMBER KEBENARAN untuk WhatsApp connection status.
 * Cek Fonnte token dulu → jika valid, connected via fonnte.
 * Jika tidak, cek GOWA device → jika terhubung, connected via gowa.
 */
export async function getWhatsAppConnectionStatus(storeId: string): Promise<WhatsAppConnectionStatus> {
  const cacheId = cacheKey('wa-connection', storeId);
  const cached = await getCached<WhatsAppConnectionStatus>(cacheId);
  if (cached) {
    return cached;
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { fonnteToken: true, fonnteNumber: true, whatsappPhoneId: true },
  });

  if (!store) {
    const result: WhatsAppConnectionStatus = {
      connected: false,
      gateway: null,
      phoneNumber: null,
      lastCheckedAt: new Date().toISOString(),
    };
    await setCached(cacheId, result, TTL_WA_STATUS);
    return result;
  }

  // 1. Cek Fonnte
  if (store.fonnteToken) {
    try {
      const status = await fonnteService.getDeviceStatus(store.fonnteToken);
      if (status.connected) {
        const result: WhatsAppConnectionStatus = {
          connected: true,
          gateway: 'fonnte',
          phoneNumber: status.phoneNumber || store.fonnteNumber || null,
          lastCheckedAt: new Date().toISOString(),
        };
        await setCached(cacheId, result, TTL_WA_STATUS);
        return result;
      }
    } catch {
      // Fonnte check failed → fall through to GOWA
    }
  }

  // 2. Cek GOWA
  if (store.whatsappPhoneId) {
    const gowa = await checkGowaConnection(storeId);
    if (gowa.connected) {
      const result: WhatsAppConnectionStatus = {
        connected: true,
        gateway: 'gowa',
        phoneNumber: gowa.phoneNumber,
        lastCheckedAt: new Date().toISOString(),
      };
      await setCached(cacheId, result, TTL_WA_STATUS);
      return result;
    }
  }

  // 3. Tidak terhubung di keduanya
  const result: WhatsAppConnectionStatus = {
    connected: false,
    gateway: null,
    phoneNumber: store.fonnteNumber || null,
    lastCheckedAt: new Date().toISOString(),
  };
  await setCached(cacheId, result, TTL_WA_STATUS);
  return result;
}
