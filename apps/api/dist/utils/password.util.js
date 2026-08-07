import bcrypt from 'bcrypt';
import crypto from 'crypto';
const BCRYPT_ROUNDS = 10;
function legacySha256(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}
export async function hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
}
function isBcryptHash(hash) {
    return hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$');
}
/**
 * Verifikasi password terhadap hash tersimpan. Mendukung hash lama format
 * SHA-256 (sebelum migrasi ke bcrypt) secara transparan — jika hash lama
 * cocok, return needsRehash: true supaya caller bisa upgrade ke bcrypt
 * secara otomatis saat login/ganti password berikutnya.
 */
export async function verifyPassword(password, storedHash) {
    if (isBcryptHash(storedHash)) {
        const valid = await bcrypt.compare(password, storedHash);
        return { valid, needsRehash: false };
    }
    const valid = legacySha256(password) === storedHash;
    return { valid, needsRehash: valid };
}
//# sourceMappingURL=password.util.js.map