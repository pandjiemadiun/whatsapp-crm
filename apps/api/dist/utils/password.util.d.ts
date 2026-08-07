export declare function hashPassword(password: string): Promise<string>;
/**
 * Verifikasi password terhadap hash tersimpan. Mendukung hash lama format
 * SHA-256 (sebelum migrasi ke bcrypt) secara transparan — jika hash lama
 * cocok, return needsRehash: true supaya caller bisa upgrade ke bcrypt
 * secara otomatis saat login/ganti password berikutnya.
 */
export declare function verifyPassword(password: string, storedHash: string): Promise<{
    valid: boolean;
    needsRehash: boolean;
}>;
//# sourceMappingURL=password.util.d.ts.map