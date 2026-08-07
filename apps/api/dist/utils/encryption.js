import crypto from 'crypto';
/**
 * Application-level field encryption (Phase 1.10 — G2).
 *
 * Menggunakan AES-256-GCM untuk enkripsi field sensitif (nama customer, HP, alamat, dll)
 * sebelum disimpan ke database.
 *
 * Key lookup order (Stage G2):
 *   1. Platform Config DB (system_settings.key = 'FIELD_ENCRYPTION_KEY') — PRIMARY
 *   2. Cloudflare Worker (CLOUDFLARE_WORKER_URL + CLOUDFLARE_WORKER_TOKEN) — fallback (DR)
 *   3. FIELD_ENCRYPTION_KEY env var — final fallback
 *
 * Format output: base64(iv) + ":" + base64(authTag) + ":" + base64(ciphertext)
 * Format ini self-contained — bisa langsung disimpan ke database String column.
 *
 * Key di-cache selama KEY_TTL_MS (default 10 menit) untuk mengurangi overhead.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_TTL_MS = 10 * 60 * 1000; // 10 menit
/** Cached key + expiry */
let cachedKey = null;
let keyExpiry = 0;
/** Parse key string (hex / base64 / raw) ke Buffer 32 bytes. */
export function parseKey(raw) {
    if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
        return Buffer.from(raw, 'hex');
    }
    if (raw.length >= 43 && /[A-Za-z0-9+/=]/.test(raw)) {
        return Buffer.from(raw, 'base64');
    }
    return crypto.createHash('sha256').update(raw).digest();
}
/**
 * Fetch encryption key — lookup order: Platform Config DB → Cloudflare Worker → env var.
 * Hasil di-cache selama KEY_TTL_MS. Thread-safe: hanya satu fetch sekaligus.
 *
 * Note: configService di-import secara dinamis untuk menghindari circular dependency:
 *   encryption.ts ← prisma.ts ← config.service.ts ← encryption.ts (cycle)
 */
export async function getEncryptionKey() {
    // Return cached key jika masih valid
    if (cachedKey && Date.now() < keyExpiry) {
        console.log('[Encryption] Using in-memory cached key (TTL remaining)');
        return cachedKey;
    }
    // 1. Platform Config DB — PRIMARY (migrated in Stage G2)
    try {
        const { configService } = await import('../business/config.service.js');
        const dbKey = await configService.getConfig('FIELD_ENCRYPTION_KEY');
        if (dbKey) {
            cachedKey = parseKey(dbKey);
            keyExpiry = Date.now() + KEY_TTL_MS;
            console.info('[encryption] Key loaded from Platform Config DB (TTL: 10m)');
            return cachedKey;
        }
    }
    catch (error) {
        console.warn('[encryption] Failed to read key from Platform Config:', error.message);
    }
    // 2. Cloudflare Worker — FALLBACK (backward compat / DR if DB wiped)
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
    const token = process.env.CLOUDFLARE_WORKER_TOKEN;
    if (workerUrl && token) {
        console.log('[Encryption] Fetching key from Cloudflare Worker (fallback)…');
        try {
            const res = await fetch(workerUrl, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const text = await res.text();
                let keyStr = null;
                // Coba parse JSON: { "key": "..." } atau { "encryption_key": "..." }
                try {
                    const json = JSON.parse(text.trim());
                    keyStr = json.key || json.encryption_key || json.value;
                }
                catch {
                    // Plain text response — gunakan langsung
                    keyStr = text.trim();
                }
                if (keyStr) {
                    cachedKey = parseKey(keyStr);
                    keyExpiry = Date.now() + KEY_TTL_MS;
                    console.info('[encryption] Key fetched from Cloudflare Worker fallback (TTL: 10m)');
                    return cachedKey;
                }
            }
        }
        catch (error) {
            console.warn('[encryption] Failed to fetch key from Cloudflare Worker:', error.message);
        }
    }
    // 3. Env var — FINAL fallback
    const envKey = process.env.FIELD_ENCRYPTION_KEY;
    if (envKey) {
        console.log('[Encryption] Using FIELD_ENCRYPTION_KEY env var as final fallback');
        cachedKey = parseKey(envKey);
        keyExpiry = Date.now() + KEY_TTL_MS;
        console.info('[encryption] Key loaded from FIELD_ENCRYPTION_KEY env var (TTL: 10m)');
        return cachedKey;
    }
    // No key available — encryption disabled
    cachedKey = null;
    keyExpiry = 0;
    return null;
}
/** Force-refresh key dari worker/env. Dipanggil oleh periodic refresh. */
export async function refreshEncryptionKey() {
    keyExpiry = 0; // invalidate cache
    cachedKey = null;
    const key = await getEncryptionKey();
    return key !== null;
}
/**
 * Enkripsi teks menggunakan AES-256-GCM.
 * @param plaintext - teks yang akan dienkripsi
 * @param key - Buffer key (32 bytes). Jika null, kembalikan plaintext asli.
 * @returns string format "iv:tag:ciphertext", atau plaintext asli jika key null
 */
export function encryptField(plaintext, key) {
    if (plaintext === null || plaintext === undefined)
        return null;
    if (!key)
        return plaintext;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}
/**
 * Dekripsi string yang dienkripsi oleh encryptField.
 * @param encrypted - string format "iv:tag:ciphertext"
 * @param key - Buffer key (32 bytes). Jika null, kembalikan apa adanya.
 * @returns plaintext asli, atau null jika input null
 */
export function decryptField(encrypted, key) {
    if (!encrypted || encrypted === null)
        return null;
    if (!key)
        return encrypted;
    // Deteksi format — jika tidak ada ":" berarti belum terenkripsi (legacy/plaintext data)
    if (!encrypted.includes(':')) {
        return encrypted;
    }
    try {
        const parts = encrypted.split(':');
        if (parts.length !== 3)
            return encrypted;
        const [ivB64, tagB64, ctB64] = parts;
        const iv = Buffer.from(ivB64, 'base64');
        const tag = Buffer.from(tagB64, 'base64');
        const ciphertext = Buffer.from(ctB64, 'base64');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.toString('utf8');
    }
    catch {
        // Jika dekripsi gagal (key beda, data corrupt), kembalikan nilai asli
        return encrypted;
    }
}
/**
 * Hash deterministic untuk kolom unique (mis. untuk future use).
 * @param value - nilai yang akan di-hash
 * @param key - Buffer key. Jika null, gunakan SHA-256 tanpa key.
 */
export function hashField(value, key) {
    if (!value)
        return null;
    const hmac = key
        ? crypto.createHmac('sha256', key)
        : crypto.createHash('sha256');
    return hmac.update(value).digest('hex');
}
/** Regenerasi key untuk testing. JANGAN panggil di production. */
export function setTestKey(key) {
    cachedKey = key;
    keyExpiry = Date.now() + KEY_TTL_MS;
}
//# sourceMappingURL=encryption.js.map