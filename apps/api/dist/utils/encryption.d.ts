/** Parse key string (hex / base64 / raw) ke Buffer 32 bytes. */
export declare function parseKey(raw: string): Buffer;
/**
 * Fetch encryption key — lookup order: Platform Config DB → Cloudflare Worker → env var.
 * Hasil di-cache selama KEY_TTL_MS. Thread-safe: hanya satu fetch sekaligus.
 *
 * Note: configService di-import secara dinamis untuk menghindari circular dependency:
 *   encryption.ts ← prisma.ts ← config.service.ts ← encryption.ts (cycle)
 */
export declare function getEncryptionKey(): Promise<Buffer | null>;
/** Force-refresh key dari worker/env. Dipanggil oleh periodic refresh. */
export declare function refreshEncryptionKey(): Promise<boolean>;
/**
 * Enkripsi teks menggunakan AES-256-GCM.
 * @param plaintext - teks yang akan dienkripsi
 * @param key - Buffer key (32 bytes). Jika null, kembalikan plaintext asli.
 * @returns string format "iv:tag:ciphertext", atau plaintext asli jika key null
 */
export declare function encryptField(plaintext: string | null | undefined, key: Buffer | null): string | null;
/**
 * Dekripsi string yang dienkripsi oleh encryptField.
 * @param encrypted - string format "iv:tag:ciphertext"
 * @param key - Buffer key (32 bytes). Jika null, kembalikan apa adanya.
 * @returns plaintext asli, atau null jika input null
 */
export declare function decryptField(encrypted: string | null | undefined, key: Buffer | null): string | null;
/**
 * Hash deterministic untuk kolom unique (mis. untuk future use).
 * @param value - nilai yang akan di-hash
 * @param key - Buffer key. Jika null, gunakan SHA-256 tanpa key.
 */
export declare function hashField(value: string | null | undefined, key: Buffer | null): string | null;
/** Regenerasi key untuk testing. JANGAN panggil di production. */
export declare function setTestKey(key: Buffer): void;
//# sourceMappingURL=encryption.d.ts.map