/**
 * TASK B3 — Pure intent-classification for tryTotal / tryPayment.
 *
 * WHY (laporan-taskB2.md, audit "bayar" overlap): tryTotal (:593) dan
 * tryPayment (:372) sama-sama substring keyword, dan kata "bayar" ada di
 * KEDUA list sekaligus. Akibatnya: "berapa bayar kangkung" bisa "dicuri"
 * oleh tryTotal (balas "keranjang kosong") atau tryPayment (balas metode
 * bayar) SEBELUM pernah sampai tryProduct yang sebenarnya bisa jawab harga
 * Kangkung (8000). Pola serupa bug lama tryProduct "ram"⊂"Brambang".
 *
 * Aturan (dari laporan-taskB2 + PRINSIP TASK B3):
 * - tryTotal menjawab HANYA bila sinyal kuat total/keranjang/order.
 *   Kata "bayar berapa" DIHAPUS dari trigger (itu hanya bisa tanya harga).
 *   Jika query mengandung NAMA PRODUK toko + kata amount ("bayar"/"berapa"),
 *   anggap pertanyaan harga → MISS ke tryProduct.
 * - tryPayment menjawab HANYA bila ada kata METODE pembayaran eksplisit
 *   (transfer/qris/cod/dsb). Kata "bayar" sendiri (atau "berapa bayar X")
 *   TANPA kata metode eksplisit → MISS ke tryProduct/LLM.
 *
 * Pure (tidak DB, tidak LLM) agar bisa diuji hermetic di
 * src/services/chat/tests/tier-match.test.ts tanpa butuh store/DB.
 */
// ── tryTotal: kata kunci yang merupakan sinyal KUAT "total/keranjang/order" ──
// 'bayar berapa' INTENTIONALLY ABSENT — itu tanya harga, bukan total keranjang.
export const TOTAL_TRIGGERS = [
    'grand total',
    'gtotal',
    'jumlahnya',
    'berapa semua',
    'semuanya berapa',
    'total',
    'totalnya',
    'tagihan',
    'keranjang',
    'order',
    'pesanan',
    'belanja',
];
// ── tryPayment: kata kunci yang merupakan sinyal EKSPLISIT soal METODE bayar ──
// Hanya kata-kata yang jelas-jelas bertanya CARA/METODE, bukan angka.
export const PAYMENT_EXPLICIT_METHODS = [
    'cara bayar',
    'metode pembayaran',
    'bayar pakai',
    'pakai apa',
    'via apa',
    'pakai bank',
    'transfer ke',
    'transfer',
    'rekening',
    'virtual account',
    'va',
    'ovo',
    'gopay',
    'dana',
    'atm',
    'debit',
    'kredit',
    'qris',
    'qr code',
    'cash on delivery',
    'caya cod',
    'cod',
    // Normalizer (normalizer.ts) ekspanya `cod -> bayar ditempat`, jadi bentuk
    // tersaji di tier3 adalah "bayar ditempat" / "bayar di tempat". Akomodasi
    // agar tanya metode bayar eksplisit (mis. "bisa cod ga?" → "bisa bayar
    // ditempat ga?") tetap terdeteksi sebagai metode, BUKKAN tertindih
    // payment-price overlap.
    'bayar ditempat',
    'bayar di tempat',
];
// ── Kata yang hanya menyatakan ANGKA/JUMLAH bayar, BUKAN metode ──
// (berpotensi tumpang-tindih dengan pertanyaan harga produk)
const PAYMENT_PRICE_OVERLAP = [
    'bayar',
    'pembayaran',
    'mau bayar',
    'pembayarannya',
    'bayar berapa',
];
function tokenize(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}
function hasProductName(lower, catalogNames) {
    return catalogNames.length > 0 &&
        catalogNames.some((p) => {
            const t = p.trim().toLowerCase();
            return t.length > 1 && lower.includes(t);
        });
}
/** Apakah query mengandung kata jumlah/akumulasi ("berapa")? */
function hasAmountWord(lower) {
    return tokenize(lower).includes('berapa') || PAYMENT_PRICE_OVERLAP.some((k) => lower.includes(k));
}
/**
 * Gate masuk tryTotal — substring trigger kuat, NO DB.
 * 'bayar berapa' disengaja tidak termasuk di sini.
 */
export function isTotalTrigger(lower) {
    return TOTAL_TRIGGERS.some((k) => lower.includes(k));
}
/**
 * tryTotal boleh menjawab HANYA bila benar-benar tanya total/keranjang/order,
 * BUKKAN pertanyaan harga satuan produk.
 *
 * @param lower         query yang sudah trim().toLowerCase()
 * @param catalogNames  nama produk toko (lowercase) — dibutuhkan untuk
 *                      membedakan "total kangkung?" (harga) vs "total keranjang?".
 */
export function isTotalIntent(lower, catalogNames) {
    if (!isTotalTrigger(lower))
        return false; // tidak ada sinyal total sama sekali → miss
    const product = hasProductName(lower, catalogNames);
    if (product && hasAmountWord(lower)) {
        // e.g. "berapa bayar kangkung" / "total kangkung berapa?" → penasaran harga,
        // bukan total keranjang → MISS ke tryProduct.
        return false;
    }
    return true;
}
/**
 * tryPayment boleh menjawab HANYA bila benar-benar tanya METODE/CARA bayar,
 * bukan sekadar kata "bayar" yang bisa muncul di pertanyaan harga produk.
 *
 * @param lower         query yang sudah trim().toLowerCase()
 * @param catalogNames  nama produk toko (lowercase) — dipakai untuk mendeteksi
 *                      pertanyaan harga yang "memakai" kata metode secara bebas
 *                      (mis. "kangkung cod berapa?" → tetap dianggap tanya harga).
 */
export function isPaymentIntent(lower, catalogNames) {
    const explicit = PAYMENT_EXPLICIT_METHODS.some((k) => lower.includes(k));
    if (!explicit) {
        // Tak ada kata metode eksplisit → hanya 'bayar'/'berapa' bersama nama
        // produk (atau sekadar 'bayar berapa') → ini pertanyaan harga, bukan
        // metode bayar → MISS ke tryProduct/LLM. Ini inti perbaikan B3.
        return false;
    }
    // Ada kata metode eksplisit — tapi jika sekaligus ada nama produk + kata
    // jumlah ("berapa"), pelanggan masih lebih mungkin tanya harga: contoh
    // "kangkung cod berapa?" → biarkan tryProduct/LLM tangani.
    if (hasProductName(lower, catalogNames) && tokenize(lower).includes('berapa')) {
        return false;
    }
    return true;
}
//# sourceMappingURL=tier-match.js.map