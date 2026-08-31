import { PrismaClient } from '@prisma/client';
import { encryptField, decryptField, getEncryptionKey } from '../utils/encryption.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// ─── Field-level encryption middleware (Phase 1.10) ───
// Enkripsi field sensitif (phoneNumber, customerPhone, address, dll) otomatis.
// Key diambil dari Cloudflare Worker (CLOUDFLARE_WORKER_URL) atau env var.
//
// PERLU DI-CATAT: middleware ini selalu terdaftar, tapi cek env vars / key
// di-RUNTIME (bukan di module-load time) karena dotenv.config() di index.ts
// dijalankan SETELAH semua imports selesai. Jika tidak ada key, middleware
// ini otomatis pass-through (skip encryption).

const SENSITIVE_FIELDS: Record<string, string[]> = {
  Store: ['phoneNumber', 'address', 'fonnteToken', 'fonnteNumber'],
  Conversation: ['customerPhone', 'customerName', 'notes'],
  Customer: ['phone', 'name'],
  Order: ['shippingAddress', 'notes'],
  BankAccount: ['accountNumber', 'accountName'],
};

/** Periodic key refresh tiap 10 menit */
setInterval(async () => {
  const { refreshEncryptionKey } = await import('../utils/encryption.js');
  await refreshEncryptionKey();
}, 10 * 60 * 1000);

// Always register — cek env vars di runtime di dalam middleware
prisma.$use(async (params, next) => {
    const model = params.model;
    if (!model || !SENSITIVE_FIELDS[model]) {
      return next(params);
    }

    // Cek di runtime karena env vars baru tersedia setelah dotenv.config()
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
    const envKey = process.env.FIELD_ENCRYPTION_KEY;
    if (!workerUrl && !envKey) {
      return next(params);
    }

    const sensitive = SENSITIVE_FIELDS[model];
    const key = await getEncryptionKey();

    if (!key) {
      return next(params); // key fetch gagal, pass-through
    }

    // ── Encrypt on write: create, update ──
    const encryptData = (data: Record<string, unknown> | undefined) => {
      if (!data) return;
      for (const field of sensitive) {
        if (data[field] !== undefined && typeof data[field] === 'string') {
          data[field] = encryptField(data[field] as string, key);
        }
      }
    };

    if (['create', 'update'].includes(params.action)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (params as any).args?.data;
      if (data && typeof data === 'object') {
        encryptData(data);
        if (data.create) encryptData(data.create);
        if (data.update) encryptData(data.update);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await next(params) as any;

    // ── Decrypt on read: findUnique, findFirst, findMany ──
    const decryptResult = (obj: Record<string, unknown> | null): Record<string, unknown> | null => {
      if (!obj || typeof obj !== 'object') return obj;
      const recordId = (obj as Record<string, unknown>).id as string | undefined;
      for (const field of sensitive) {
        if (obj[field] !== undefined && typeof obj[field] === 'string') {
          obj[field] = decryptField(obj[field] as string, key, { model, field, recordId });
        }
      }
      return obj;
    };

    if (['findUnique', 'findFirst', 'create', 'update'].includes(params.action)) {
      return decryptResult(result);
    }

    if (params.action === 'findMany' && Array.isArray(result)) {
      return result.map((item) => decryptResult(item));
    }

    return result;
  });
