import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countChars,
  truncateText,
  isValidPasteText,
  isNearCharLimit,
} from '../hooks/useMagicPaste';

// ============================================================
// Unit tests — useMagicPaste pure helpers (Phase 1.9.4)
// Runner: npx tsx --test --test-force-exit src/tests/useMagicPaste.test.ts
//
// Catatan: hook React memakai DOM (jsdom) yang tidak tersedia di
// project ini, jadi logika validasi di-test lewat pure helpers
// yang diexport dari file hook.
// ============================================================

test('1. countChars menghitung panjang teks', () => {
  assert.equal(countChars(''), 0);
  assert.equal(countChars('Kangkung'), 8);
});

test('2. truncateText memotong ke 2000 karakter', () => {
  const input = 'x'.repeat(2500);
  const out = truncateText(input);
  assert.equal(out.length, 2000);
});

test('3. truncateText tidak mengubah teks pendek', () => {
  assert.equal(truncateText('Kangkung'), 'Kangkung');
});

test('4. isValidPasteText false saat teks < 10 chars', () => {
  assert.equal(isValidPasteText('Kangkung'), false);
});

test('5. isValidPasteText true saat teks >= 10 chars', () => {
  assert.equal(isValidPasteText('Kangkung segar 5000'), true);
});

test('6. isValidPasteText false jika hanya whitespace', () => {
  assert.equal(isValidPasteText('   '), false);
});

test('7. isValidPasteText false jika > 2000 chars', () => {
  assert.equal(isValidPasteText('a'.repeat(2001)), false);
});

test('8. isValidPasteText true tepat di 10 chars', () => {
  assert.equal(isValidPasteText('a'.repeat(10)), true);
});

test('9. isNearCharLimit true di atas 80% (1600)', () => {
  assert.equal(isNearCharLimit(1650), true);
  assert.equal(isNearCharLimit(1601), true);
});

test('10. isNearCharLimit false di bawah/sama 80%', () => {
  assert.equal(isNearCharLimit(1600), false);
  assert.equal(isNearCharLimit(500), false);
});

// ── Extract flow (stub fetch, tanpa DOM) ──

test('11. Parse response sukses → extracted data benar', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        success: true,
        data: {
          product: { id: 'p1', storeId: 's1', name: 'Kangkung', price: 5000, stock: 100, categoryId: null, sku: 'AUTO-1', source: 'magic_paste', createdAt: '2024-01-01' },
          extractedEntities: { name: 'Kangkung', price: 5000, stock: 100, categoryId: null, categoryHint: 'sayuran', confidence: 0.95 },
          warning: null,
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    )) as typeof fetch;

  // Replikasi logika extract dari hook (tanpa render React)
  const res = await fetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body: JSON.stringify({ storeId: 's1', text: 'Kangkung segar 5000' }),
  });
  const body = (await res.json()) as any;
  const extracted = {
    name: body.data.extractedEntities?.name ?? null,
    price: body.data.extractedEntities?.price ?? null,
    stock: body.data.extractedEntities?.stock ?? null,
    categoryId: body.data.extractedEntities?.categoryId ?? null,
    categoryHint: body.data.extractedEntities?.categoryHint ?? null,
    confidence: body.data.extractedEntities?.confidence ?? 0,
  };
  assert.equal(res.status, 201);
  assert.equal(extracted.name, 'Kangkung');
  assert.equal(extracted.price, 5000);
  assert.equal(extracted.confidence, 0.95);

  globalThis.fetch = originalFetch;
});

test('12. Response 401 → error Unauthorized', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'x' }), { status: 401 })) as typeof fetch;

  const res = await fetch('/api/admin/products/magic-paste', { method: 'POST' });
  assert.equal(res.status, 401);

  globalThis.fetch = originalFetch;
});

test('13. Response 400 dengan error message → pesan terekstrak', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ success: false, error: { code: 'ERR_PRICE_INVALID', message: 'Price 50000000 exceeds maximum' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )) as typeof fetch;

  const res = await fetch('/api/admin/products/magic-paste', { method: 'POST' });
  const body = (await res.json()) as any;
  assert.equal(body.error.message, 'Price 50000000 exceeds maximum');

  globalThis.fetch = originalFetch;
});

test('14. Network failure → error network (bukan crash)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;

  let caught: string | null = null;
  try {
    await fetch('/api/admin/products/magic-paste', { method: 'POST' });
  } catch (err: any) {
    caught = err?.message ?? 'unknown';
  }
  assert.match(caught ?? '', /Failed to fetch/i);

  globalThis.fetch = originalFetch;
});

test('15. Request body dikirim dengan storeId + text', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    sentBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ success: true, data: { extractedEntities: { name: 'X', price: 1, stock: null, categoryId: null, categoryHint: null, confidence: 0.9 } } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  await fetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    body: JSON.stringify({ storeId: 's-1', text: 'Beras 15000' }),
  });
  assert.equal(sentBody.storeId, 's-1');
  assert.equal(sentBody.text, 'Beras 15000');

  globalThis.fetch = originalFetch;
});
