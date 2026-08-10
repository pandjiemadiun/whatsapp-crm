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
export declare const TOTAL_TRIGGERS: readonly string[];
export declare const PAYMENT_EXPLICIT_METHODS: readonly string[];
/**
 * Gate masuk tryTotal — substring trigger kuat, NO DB.
 * 'bayar berapa' disengaja tidak termasuk di sini.
 */
export declare function isTotalTrigger(lower: string): boolean;
/**
 * tryTotal boleh menjawab HANYA bila benar-benar tanya total/keranjang/order,
 * BUKKAN pertanyaan harga satuan produk.
 *
 * @param lower         query yang sudah trim().toLowerCase()
 * @param catalogNames  nama produk toko (lowercase) — dibutuhkan untuk
 *                      membedakan "total kangkung?" (harga) vs "total keranjang?".
 */
export declare function isTotalIntent(lower: string, catalogNames: readonly string[]): boolean;
/**
 * tryPayment boleh menjawab HANYA bila benar-benar tanya METODE/CARA bayar,
 * bukan sekadar kata "bayar" yang bisa muncul di pertanyaan harga produk.
 *
 * @param lower         query yang sudah trim().toLowerCase()
 * @param catalogNames  nama produk toko (lowercase) — dipakai untuk mendeteksi
 *                      pertanyaan harga yang "memakai" kata metode secara bebas
 *                      (mis. "kangkung cod berapa?" → tetap dianggap tanya harga).
 */
export declare function isPaymentIntent(lower: string, catalogNames: readonly string[]): boolean;
export declare const ORDER_STATUS_KEYWORDS: readonly string[];
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
export declare function isOrderStatusIntent(lower: string, catalogNames: readonly string[]): boolean;
/** Kata kunci kategori 'retur' — termasuk 'ganti' (sinyal lemah). */
export declare const SOP_RETUR_KEYWORDS: readonly string[];
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
export declare function isSopRetourIntent(lower: string, catalogNames: readonly string[]): boolean;
/** Keyword shipping asli — tetap berlaku sebagai fallback di isShippingIntent. */
export declare const SHIPPING_KEYWORDS: readonly string[];
/**
 * TASK B4.3 — Gate cerdas untuk tryShipping.
 *
 * Aturan:
 * - Jika query mengandung nama produk katalog + kata order eksplisit
 *   ('mau'/'pesan'/'order') TANPA kata kirim/ongkir eksplisit
 *   ('ongkir'/'kirim'/'ekspedisi'/'kurir'/nama jasa kirim) → return false
 *   (ini order, bukan tanya ongkir).
 * - Selain itu, keyword shipping asli tetap berlaku seperti sebelumnya.
 *
 * @param lower         query yang sudah trim().toLowerCase()
 * @param catalogNames  nama produk toko (lowercase)
 */
export declare function isShippingIntent(lower: string, catalogNames: readonly string[]): boolean;
/** Kata inquiry ketersediaan produk — match di mana saja, bukan hanya awal. */
export declare const PRODUCT_INQUIRY_WORDS: readonly string[];
/**
 * TASK B4.5 — Deteksi inquiry "ada/stok/etc" di mana saja, bukan hanya
 * di awal kalimat. Bug (laporan-taskB2.md `:338`): regex `^(ada|...)`
 * hanya match kalau kata inquiry di AWAL — "kak nanya stok kangkung?"
 * miss (kata pertama 'kak').
 *
 * Heuristik: inquiry word + kata benda setelahnya (bukan filler saja),
 * ATAU kalimat diakhiri '?'.
 *
 * @param lower query yang sudah trim().toLowerCase()
 * @returns { isInquiry, askedTerms } — askedTerms = kata benda setelah inquiry
 */
export declare function isProductNotFoundInquiry(lower: string): {
    isInquiry: boolean;
    askedTerms: string[];
};
//# sourceMappingURL=tier-match.d.ts.map