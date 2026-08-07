/**
 * Konstanta E2E bersama (bukan test file — bisa di-import dari test mana pun).
 */

/** Store UUID test — backend zod mensyaratkan UUID untuk magic-paste. */
export const E2E_STORE_ID = '11111111-2222-4333-8444-555566667777';
export const E2E_STORE_NAME = 'E2E Magic Paste Store';

/** Admin credentials. */
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@test.com';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password123';

/** Teks produk contoh untuk extract. */
export const SAMPLE_TEXT = 'Kangkung segar 5000 stok 100, kategori sayuran hijau';
