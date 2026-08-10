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
// ── tryOrderStatus: kata kunci sinyal status / track pesanan ──────────────
// Dipertanyakan sebagai order inquiry HANYA ketika tidak ada nama produk
// toko dalam query — kecuali ada sinyal order eksplisit (lihat di bawah),
// yang tetap memicu meski ada nama produk karena jelas soal order bukan stok.
export const ORDER_STATUS_KEYWORDS = [
    'sudah dikirim',
    'kapan dikirim',
    'sampai mana',
    'udah sampai',
    'udah sampe',
    'mana pesanan',
    // sinyal order eksplisit — boleh trigger meski ada nama produk
    'status pesanan',
    'status order',
    'pesanan saya',
    'order saya',
];
// Subset ORDER_STATUS_KEYWORDS yang merupakan sinyal order eksplisit:
// mengandung "pesanan"/"order" + kepemilikan ("saya"), sehingga jelas
// soal order tracking — tidak akan tumpang tindih dengan pertanyaan stok
// (mis. "sampai mana kangkung tersedia?" tidak mengandung sinyal ini).
const ORDER_EXPLICIT_SIGNALS = [
    'pesanan saya',
    'order saya',
    'status pesanan',
    'status order',
];
/**
 * tryOrderStatus boleh menjawab HANYA bila query benar-benar soal
 * status / track order, BUKAN pertanyaan ketersediaan/stok produk
 * yang sekadar mengandung keyword seperti "sampai mana".
 *
 * Aturan:
 * - true HANYA bila ada status keyword DAN TIDAK ada nama produk katalog,
 *   kecuali ada sinyal order eksplisit ('pesanan saya'/'order saya'/
 *   'status pesanan'/'status order') yang boleh trigger meski ada nama
 *   produk karena jelas soal order bukan stok.
 *
 * Contoh: "sampai mana kangkung tersedia?" → false (stok, bukan order).
 *         "sudah dikirim pesanan saya?"  → true  (track order, regresi).
 *         "pesanan saya sampai mana?"     → true  (track order eksplisit).
 *
 * @param lower         query yang sudah trim().toLowerCase()
 * @param catalogNames  nama produk toko (lowercase)
 */
export function isOrderStatusIntent(lower, catalogNames) {
    // Gate cepat: tidak ada keyword status sama sekali → miss (tanpa DB).
    if (!ORDER_STATUS_KEYWORDS.some((k) => lower.includes(k)))
        return false;
    // Sinyal order eksplisit → jelas soal order, meski ada nama produk.
    if (ORDER_EXPLICIT_SIGNALS.some((k) => lower.includes(k)))
        return true;
    // Tidak eksplisit — jika ada nama produk toko, anggap pertanyaan stok/
    // ketersediaan, bukan status order → MISS ke tryProduct.
    if (hasProductName(lower, catalogNames))
        return false;
    return true;
}
// ── trySop: aksenat klasifikasi kategori 'retur' ───────────────────────────
// TASK B4.2: 'ganti' termasuk keyword retur (sinyal lemah). 'ganti' SENDIRIAN
// bukan sinyal retur kuat — butuh kata eksplisit atau pola "ganti X ke Y"
// dengan dua nama produk katalog (itu order-modification, bukan retur).
//
// Bug (laporan-taskB2.md): "ganti kangkung ke wortel" (maksud: tukar item di
// order) salah jawab SOP retur ("Barang bisa diretur dalam 24 jam...").
/** Kata kunci kategori 'retur' — termasuk 'ganti' (sinyal lemah). */
export const SOP_RETUR_KEYWORDS = [
    'retur',
    'kembalikan barang',
    'tukar barang',
    'barang rusak',
    'rusak',
    'pengembalian',
    'refund',
    'ganti',
];
// Kata eksplisit (selain 'ganti') yang memperkuat sinyal retur → trigger normal.
// 'kecewa' dan 'komplain' juga termasuk karena mengindikasikan keluhan nyata
// yang berpotensi menggabungkan retur.
const SOP_RETUR_EXPLICIT_SIGNALS = [
    'rusak',
    'barang rusak',
    'kembalikan barang',
    'tukar barang',
    'pengembalian',
    'refund',
    'retur',
    'kecewa',
    'komplain',
];
/**
 * TASK B4.2 — Gate cerdas untuk kategori SOP 'retur' di trySop.
 *
 * Aturan:
 * - Kata retur non-'ganti' (rusak, refund, retur, dll.) → true (trigger normal).
 * - 'ganti' + kata eksplisit ('rusak', 'refund', 'kecewa', 'komplain', dsb.) → true.
 * - Pola "ganti X ke Y" di mana X & Y keduanya nama produk katalog → false
 *   (itu order-modification, bukan retur).
 * - 'ganti' sendirian / 'ganti' dengan <1 produk → false (bukan sinyal kuat).
 *
 * @param lower         query yang sudah trim().toLowerCase()
 * @param catalogNames  nama produk toko (lowercase)
 */
export function isSopRetourIntent(lower, catalogNames) {
    // Strong retur word (bukan 'ganti') → trigger normal
    if (SOP_RETUR_EXPLICIT_SIGNALS.some((kw) => lower.includes(kw)))
        return true;
    // 'ganti' tidak ada → tidak ada intent retur dari kata 'ganti'
    if (!lower.includes('ganti'))
        return false;
    // 'ganti' ada tapi tidak ada kata eksplisit:
    // Pola "ganti X ke Y" di mana X & Y keduanya nama produk katalog →
    // ini order-modification (tukar item), BUKAN retur → false.
    const mentionedProducts = catalogNames.filter((p) => p.trim().length > 1 && lower.includes(p.trim()));
    if (mentionedProducts.length >= 2)
        return false;
    // 'ganti' sendirian / 'ganti' dengan <1 produk → bukan sinyal retur kuat
    return false;
}
//# sourceMappingURL=tier-match.js.map