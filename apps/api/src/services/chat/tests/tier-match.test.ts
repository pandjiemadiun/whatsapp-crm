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
  TOTAL_TRIGGERS,
  PAYMENT_EXPLICIT_METHODS,
  ORDER_STATUS_KEYWORDS,
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
});
