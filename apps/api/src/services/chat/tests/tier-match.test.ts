/**
 * TASK B3 — hermetic unit tests for tier-match.ts intent classification.
 * Runner: `npm run test:chat -- src/services/chat/tests/tier-match.test.ts`
 * (pure, no DB / no LLM).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTotalTrigger,
  isTotalIntent,
  isPaymentIntent,
  isOrderStatusIntent,
  isSopRetourIntent,
  isShippingIntent,
  isProductNotFoundInquiry,
  PRODUCT_INQUIRY_WORDS,
  TOTAL_TRIGGERS,
  PAYMENT_EXPLICIT_METHODS,
  ORDER_STATUS_KEYWORDS,
  SOP_RETUR_KEYWORDS,
  SHIPPING_KEYWORDS,
} from '../tier-match.js';

// Canary store-f7140b5c product names (lowercase) — used as catalogNames.
const CATALOG = ['ayam', 'es teh manis', 'es jeruk manis', 'brambang', 'kentang', 'wortel', 'kangkung'];

const noDB = [] as string[]; // empty catalog (some cases have no product match)

describe('TASK B3 — tryTotal intent gate (no "bayar" overlap)', () => {
  it('(a) "total berapa" (tanpa produk) → tryTotal masih jawab (regresi)', () => {
    const q = 'total berapa';
    assert.equal(isTotalTrigger(q), true, '"total" must still trigger');
    assert.equal(isTotalIntent(q, noDB), true, 'no product → total intent still valid');
  });

  it('(a) "toralin brp" normalizer output "total berapa" → triggers', () => {
    const q = 'total berapa';
    assert.equal(isTotalTrigger(q), true);
    assert.equal(isTotalIntent(q, noDB), true);
  });

  it('(b) "berapa bayar kangkung" (produk + bayar, tanpa metode) → MISS tryTotal', () => {
    const q = 'berapa bayar kangkung';
    // 'bayar berapa' DIHAPUS dari TOTAL_TRIGGERS, sehingga tidak pernah trigger
    assert.equal(isTotalTrigger(q), false);
    assert.equal(isTotalIntent(q, CATALOG), false);
  });

  it('(b) "bayar kangkung berapa" → MISS tryTotal', () => {
    const q = 'bayar kangkung berapa';
    assert.equal(isTotalTrigger(q), false);
    assert.equal(isTotalIntent(q, CATALOG), false);
  });

  it('(d) "tagihan saya berapa" → tryTotal masih jawab', () => {
    const q = 'tagihan saya berapa';
    assert.equal(isTotalTrigger(q), true, '"tagihan" is a strong total signal');
    assert.equal(isTotalIntent(q, noDB), true);
  });

  it('(d) "tagihannya berapa" → tryTotal masih jawab (substring "tagihan")', () => {
    const q = 'tagihannya berapa';
    assert.equal(isTotalTrigger(q), true);
    assert.equal(isTotalIntent(q, noDB), true);
  });

  it('(d) "total belanjaan" → tryTotal masih jawab', () => {
    const q = 'total belanjaan';
    assert.equal(isTotalTrigger(q), true);
    assert.equal(isTotalIntent(q, noDB), true);
  });

  it('"berapa bayar kangkung" tidak boleh trigger via "bayar" (buk bukan angka produk)', () => {
    // sanity: 'bayar' must NOT be a total trigger anymore
    assert.equal(TOTAL_TRIGGERS.includes('bayar berapa'), false);
    assert.equal(TOTAL_TRIGGERS.includes('bayar'), false);
  });

  it('total kangkung + berapa (price-like) → MISS (defer to tryProduct)', () => {
    const q = 'total kangkung berapa';
    assert.equal(isTotalTrigger(q), true); // punya 'total'
    assert.equal(isTotalIntent(q, CATALOG), false, 'product + amount word → price question');
  });
});

describe('TASK B3 — tryPayment intent gate (explicit method only)', () => {
  it('(c) "bisa cod ga?" → tryPayment jawab (explicit "cod")', () => {
    const q = 'bisa cod ga?';
    assert.equal(isPaymentIntent(q, noDB), true);
  });

  it('(c) "terima transfer?" → tryPayment jawab', () => {
    const q = 'terima transfer?';
    assert.equal(isPaymentIntent(q, noDB), true);
  });

  it('(c) "cara bayar pakai apa?" → tryPayment jawab', () => {
    const q = 'cara bayar pakai apa?';
    assert.equal(isPaymentIntent(q, noDB), true);
  });

  it('(b) "berapa bayar kangkung" (produk + bayar, tidak ada metode) → MISS tryPayment', () => {
    const q = 'berapa bayar kangkung';
    assert.equal(isPaymentIntent(q, CATALOG), false, 'no explicit method word → price question');
  });

  it('(b) "bayar kangkung berapa" → MISS tryPayment', () => {
    const q = 'bayar kangkung berapa';
    assert.equal(isPaymentIntent(q, CATALOG), false);
  });

  it('"bayar kangkung" (tanpa berapa) → MISS tryPayment (belum tentu mau bayar)', () => {
    const q = 'bayar kangkung';
    assert.equal(isPaymentIntent(q, CATALOG), false);
  });

  it('kangkung + metode eksplisit tapi ada "berapa" → tetap MISS (price-like)', () => {
    // "kangkung cod berapa?" — mengandung cod (eksplis) tapi juga produk + berapa
    const q = 'kangkung cod berapa';
    assert.equal(isPaymentIntent(q, CATALOG), false, 'product + berapa → price question, defer');
  });

  it('"bayar" bukan kata metode eksplisit', () => {
    assert.equal(PAYMENT_EXPLICIT_METHODS.includes('bayar'), false);
    assert.equal(isPaymentIntent('bayar', noDB), false);
  });
});

describe('TASK B4.1 — tryOrderStatus intent gate (stok vs status order overlap)', () => {
  it('(1) "sudah dikirim pesanan saya?" → true (regresi, harus tetap benar)', () => {
    const q = 'sudah dikirim pesanan saya?';
    assert.equal(isOrderStatusIntent(q, CATALOG), true, 'track order — regresi must hold');
  });

  it('(2) "sampai mana kangkung tersedia?" (catalog ada Kangkung) → false (bug lama, sekarang miss)', () => {
    const q = 'sampai mana kangkung tersedia?';
    // 'sampai mana' ada (keyword status) tapi ada nama produk + tidak ada
    // sinyal order eksplisit → ini pertanyaan stok/ketersediaan, bukan order.
    assert.equal(isOrderStatusIntent(q, CATALOG), false, 'product name present + no explicit order signal → stock question, not order');
  });

  it('(3) "pesanan saya sampai mana?" (ada kata pesanan saya + tidak ada nama produk) → true', () => {
    const q = 'pesanan saya sampai mana?';
    assert.equal(isOrderStatusIntent(q, CATALOG), true, 'explicit order signal → true even without product name');
  });

  // FIX-2 regresi: keyword yang DIHAPUS dari trySop kategori 'order_status'
  // (commit sebelumnya) tetap terjawab lewat tryOrderStatus (gate di bawah),
  // bukan lewat SOP. Buktikan gateway tersebut masih benar untuk tiap keyword.
  it('(4) FIX-2 regresi: keyword order_status eks- trySop tetap true via isOrderStatusIntent', () => {
    const keywords = ['sudah dikirim', 'kapan dikirim', 'status pesanan', 'status order', 'sampai mana', 'udah sampai', 'pesanan saya'];
    for (const kw of keywords) {
      const q = `${kw} saya?`;
      assert.equal(isOrderStatusIntent(q, noDB), true, `keyword "${kw}" must resolve as order_status via tryOrderStatus gate`);
    }
  });
});

describe('TASK B4.2 — isSopRetourIntent gate (ganti X ke Y vs retur)', () => {
  it('(1) "barang saya rusak, mau retur" → true (regresi)', () => {
    const q = 'barang saya rusak, mau retu';
    assert.equal(isSopRetourIntent(q, CATALOG), true, '"rusak" is an explicit retur signal');
  });

  it('(2) "ganti kangkung ke wortel" (dua nama produk katalog) → false (bug lama)', () => {
    const q = 'ganti kangkung ke wortel';
    assert.equal(isSopRetourIntent(q, CATALOG), false, 'ganti X ke Y with two catalog products is order-modification, not retur');
  });

  it('(2-b) "ganti wortel ke kangkung" (urutan terbalik, tetap dua produk) → false', () => {
    const q = 'ganti wortel ke kangkung';
    assert.equal(isSopRetourIntent(q, CATALOG), false, 'order-independent: two catalog products → false');
  });

  it('(3) "ganti" saja tanpa konteks lain → false', () => {
    const q = 'ganti';
    assert.equal(isSopRetourIntent(q, CATALOG), false, '"ganti" alone is not a strong retur signal');
  });

  it('(3-b) "ganti kangkung" (ganti + satu produk, tidak ada kata eksplisit) → false', () => {
    const q = 'ganti kangkung';
    assert.equal(isSopRetourIntent(q, CATALOG), false, 'one product + ganti, no explicit word → not retur');
  });

  it('(4) "mau komplain, kecewa sama pelayanan" → true (kategori komplain, pastikan tidak ikut berubah)', () => {
    const q = 'mau komplain, kecewa sama pelayanan';
    assert.equal(isSopRetourIntent(q, CATALOG), true, 'kecewa/komplain are explicit complaint signals');
  });

  it('(regresi) "rusak" saja → true', () => {
    assert.equal(isSopRetourIntent('barang rusak banget', CATALOG), true);
  });

  it('(regresi) "refund" saja → true', () => {
    assert.equal(isSopRetourIntent('mau refund', CATALOG), true);
  });

  it('(regresi) "barang rusak mau retur" → true (dua kata retur kuat)', () => {
    assert.equal(isSopRetourIntent('barang rusak mau retur', CATALOG), true);
  });

  it('(regresi) "pengembalian barang rusak" → true', () => {
    assert.equal(isSopRetourIntent('pengembalian barang rusak', CATALOG), true);
  });

  it('sanity: SOP_RETUR_KEYWORDS termasuk ganti dan semua kata eksplisit', () => {
    assert.equal(SOP_RETUR_KEYWORDS.includes('ganti'), true);
    assert.equal(SOP_RETUR_KEYWORDS.includes('rusak'), true);
    assert.equal(SOP_RETUR_KEYWORDS.includes('refund'), true);
  });
});

describe('TASK B4.3 — isShippingIntent gate (produk + order vs ongkir)', () => {
  it('(1) "berapa ongkir ke Jaksel?" → true (regresi)', () => {
    const q = 'berapa ongkir ke Jaksel?'.toLowerCase();
    assert.equal(isShippingIntent(q, noDB), true, '"ongkir" is a strong shipping signal');
  });

  it('(2) "kurier pakai JNE ya?" → true (regresi)', () => {
    const q = 'kurier pakai JNE ya?'.toLowerCase();
    assert.equal(isShippingIntent(q, noDB), true, '"kurir" + "jne" are explicit shipping signals');
  });

  it('(3) "mau pesan kangkung" (produk + kata order, TANPA kata kirim) → false (pencegahan)', () => {
    const q = 'mau pesan kangkung';
    assert.equal(isShippingIntent(q, CATALOG), false, 'product + order word, no shipping signal → order, not shipping');
  });

  it('(4) "berapa ongkir kangkung?" (produk + ongkir, tidak ada order word) → true', () => {
    const q = 'berapa ongkir kangkung';
    assert.equal(isShippingIntent(q, CATALOG), true, '"ongkir" present → shipping question despite product name');
  });

  it('(5) "mau pesan kangkung, berapa ongkir?" (order + ongkir) → true', () => {
    const q = 'mau pesan kangkung, berapa ongkir?';
    assert.equal(isShippingIntent(q, CATALOG), true, '"ongkir" present → shipping question despite order word + product');
  });

  it('(6) "mau ambil sendiri kangkung" (produk + order, hanya "ambil sendiri" yg bukan eksplisit) → false', () => {
    const q = 'mau ambil sendiri kangkung';
    assert.equal(isShippingIntent(q, CATALOG), false, '"ambil sendiri" is not an explicit shipping signal; product + "mau" → order');
  });

  it('(7) "ambil sendiri" saja (tanpa produk/order) → true (regresi keyword)', () => {
    const q = 'ambil sendiri';
    assert.equal(isShippingIntent(q, noDB), true, '"ambil sendiri" is still a shipping keyword when no order intent');
  });

  it('(8) "mau order kangkung via jne" (order + ekspedisi eksplisit) → true', () => {
    const q = 'mau order kangkung via jne';
    assert.equal(isShippingIntent(q, CATALOG), true, '"jne" is an explicit shipping signal → not blocked by order gate');
  });

  it('sanity: SHIPPING_KEYWORDS mengandung ongkir, kirim, jne, ambil sendiri', () => {
    assert.equal(SHIPPING_KEYWORDS.includes('ongkir'), true);
    assert.equal(SHIPPING_KEYWORDS.includes('kirim'), true);
    assert.equal(SHIPPING_KEYWORDS.includes('jne'), true);
    assert.equal(SHIPPING_KEYWORDS.includes('ambil sendiri'), true);
  });
});

describe('TASK B4.5 — isProductNotFoundInquiry (match inquiry word di mana saja)', () => {
  it('(1) "ada brambang?" → isInquiry true, askedTerms=["brambang"] (regresi, existing di awal)', () => {
    const q = 'ada brambang?'.toLowerCase();
    const r = isProductNotFoundInquiry(q);
    assert.equal(r.isInquiry, true);
    assert.equal(r.askedTerms.length, 1);
    assert.equal(r.askedTerms[0], 'brambang');
  });

  it('(2) "kak nanya stok kangkung?" → isInquiry true, askedTerms=["kangkung"] (BUG lama: kata pertama "kak" bukan inquiry word)', () => {
    const q = 'kak nanya stok kangkung?'.toLowerCase();
    const r = isProductNotFoundInquiry(q);
    assert.equal(r.isInquiry, true);
    assert.equal(r.askedTerms.length, 1);
    assert.equal(r.askedTerms[0], 'kangkung');
  });

  it('(3) "kentang enak buat sup ya kak" → isInquiry FALSE (bukan pertanyaan ketersediaan, tidak ada inquiry word)', () => {
    const q = 'kentang enak buat sup ya kak'.toLowerCase();
    const r = isProductNotFoundInquiry(q);
    assert.equal(r.isInquiry, false);
    assert.equal(r.askedTerms.length, 0);
  });

  it('(4) "ada gak durian?" (durian TIDAK ada di katalog) → isInquiry true, askedTerms=["durian"]', () => {
    const q = 'ada gak durian?'.toLowerCase();
    const r = isProductNotFoundInquiry(q);
    assert.equal(r.isInquiry, true);
    // askedTerms harus mengandung "durian" (kata kunci setelah inquiry word)
    assert.ok(r.askedTerms.includes('durian'), 'askedTerms must include "durian"');
    // Verifikasi hasDbMatch logic (simulasi tryProductNotFound):
    const askedWords = r.askedTerms.filter(w => w.length > 1 && !['kg', 'gr', 'ml', 'biji', 'bungkus'].includes(w));
    const hasDbMatch = askedWords.some(w => CATALOG.some(dn => dn.includes(w)));
    assert.equal(hasDbMatch, false, '"durian" not in canary catalog → hasDbMatch false → tryProductNotFound returns "belum tersedia"');
  });

  it('(4b) "ada kangkung?" (kangkung ADA di katalog) → isInquiry true, hasDbMatch true → tryProductNotFound return null', () => {
    const q = 'ada kangkung?'.toLowerCase();
    const r = isProductNotFoundInquiry(q);
    assert.equal(r.isInquiry, true);
    assert.ok(r.askedTerms.includes('kangkung'));
    // hasDbMatch: "kangkung" ada di CATALOG → true → tryProductNotFound return null
    const askedWords = r.askedTerms.filter(w => w.length > 1 && !['kg', 'gr', 'ml', 'biji', 'bungkus'].includes(w));
    const hasDbMatch = askedWords.some(w => CATALOG.some(dn => dn.includes(w)));
    assert.equal(hasDbMatch, true, '"kangkung" in canary catalog → hasDbMatch true → tryProductNotFound returns null (defer to tryProduct)');
  });

  it('(5) "beli lalu jual sama ya" → isInquiry FALSE (inquiry word di tengah, hanya filler setelahnya, tidak end with ?)', () => {
    const q = 'beli lalu jual sama ya'.toLowerCase();
    const r = isProductNotFoundInquiry(q);
    assert.equal(r.isInquiry, false, '"beli...jual sama ya" — inquiry word in passing, only filler words after → no false positive');
  });

  it('(6) "stok kangkung berapa" → isInquiry true (inquiry word di awal, tidak end with ?) — regresi ke-awal', () => {
    const q = 'stok kangkung berapa'.toLowerCase();
    const r = isProductNotFoundInquiry(q);
    assert.equal(r.isInquiry, true);
    assert.ok(r.askedTerms.includes('kangkung'));
  });

  it('sanity: PRODUCT_INQUIRY_WORDS mengandung semua kata inquiry B4.2', () => {
    const expected = ['ada', 'boleh', 'jual', 'beli', 'stok', 'ready', 'kosong', 'tersedia', 'punya'];
    for (const w of expected) {
      assert.equal(PRODUCT_INQUIRY_WORDS.includes(w), true, `PRODUCT_INQUIRY_WORDS missing: ${w}`);
    }
  });
});
