/**
 * MAGIC-PASTE-VARIANT-P3-UNIT1 — variant-parsing layer unit tests.
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit \
 *           src/tests/magic-paste-variant-parsing.test.ts
 *
 * Pure parsing (U1) only: `adapters.ai.generate` is stubbed so the LLM branch
 * of `extractWithLLM` runs deterministically (no storeId → pattern-library
 * path skipped; no DB). Exercises the shape-validated `variants[]` +
 * `variantConfidence` sanitization. Does NOT touch magicPaste()/Product.create/
 * createVariant (those are Unit 2).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { adapters } from '../adapters/container.js';
import { productService } from '../business/product.service.js';

const origGenerate = (adapters.ai as any).generate;

function stubLLM(payload: unknown) {
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
  (adapters.ai as any).generate = async () => ({
    content,
    provider: 'stub',
    model: 'stub',
    tokens: { input: 0, output: 0 },
    cost: 0,
  });
}

after(() => {
  (adapters.ai as any).generate = origGenerate;
});

// No storeId → extractWithLLM skips pattern-library path → LLM branch (no DB).
const extract = (text: string) => (productService as any).extractWithLLM(text) as any;

describe('MAGIC-PASTE-VARIANT-P3-UNIT1 — variant parsing layer', () => {
  test('a) owner example "Kemeja s 10000 m 20000 l 30000 berat 100gram stok @ 10"', async () => {
    stubLLM({
      name: 'Kemeja', price: 10000, stock: null, categoryName: null, unit: null,
      weight: 100, description: null, confidence: 0.9,
      variants: [
        { attributes: { size: 'S' }, price: 10000, stock: 10, sku: null },
        { attributes: { size: 'M' }, price: 20000, stock: 10 },
        { attributes: { size: 'L' }, price: 30000, stock: 10, sku: null },
      ],
      variantConfidence: 0.95,
    });

    const r = await extract('Kemeja s 10000 m 20000 l 30000 berat 100gram stok @ 10');

    assert.equal(r.variants.length, 3);
    assert.equal(r.variants[0].attributes.size, 's');
    assert.equal(r.variants[1].attributes.size, 'm');
    assert.equal(r.variants[2].attributes.size, 'l');
    assert.equal(r.variants[0].price, 10000);
    assert.equal(r.variants[1].price, 20000);
    assert.equal(r.variants[2].price, 30000);
    assert.equal(r.variants[0].stock, 10);
    assert.equal(r.variants[1].stock, 10);
    assert.equal(r.variants[2].stock, 10);
    // shared weight = product-level (NOT per-variant)
    assert.equal(r.weight, 100);
    assert.equal(r.variants[0].weight, undefined);
    assert.equal(r.variantConfidence, 0.95);
    assert.equal(r.price, 10000); // base price = first option (unchanged field)
  });

  test('b) plain non-variant text -> variants ABSENT, other fields unchanged (regression)', async () => {
    stubLLM({
      name: 'Tahu putih', price: 5000, stock: 50, categoryName: 'produk olahan',
      unit: null, weight: 250, description: 'tahu putih segar', confidence: 0.95,
    });

    const r = await extract('Tahu putih 5000 stok 50 berat 250gr');

    assert.equal(r.name, 'Tahu putih');
    assert.equal(r.price, 5000);
    assert.equal(r.stock, 50);
    assert.equal(r.weight, 250);
    assert.equal(r.confidence, 0.95);
    assert.equal(r.description, 'tahu putih segar');
    assert.equal(r.variants, undefined); // absent — no variant signal
    assert.equal(r.variantConfidence, undefined);
  });

  test('c) ambiguous/low-confidence split -> kept best-effort, low variantConfidence surfaced (NO gate)', async () => {
    stubLLM({
      name: 'Kaos', price: 30000, stock: null, categoryName: null, unit: null,
      weight: 150, description: null, confidence: 0.6,
      variants: [
        { attributes: { size: 'S' }, price: 30000, stock: 5 },
        { attributes: { size: 'M' }, price: 32000, stock: 5 },
      ],
      variantConfidence: 0.35,
    });

    const r = await extract('Kaos size S 30000 / M 32000 stok 5');

    // valid shape kept; low confidence surfaced, never blocks creation
    assert.equal(r.variants.length, 2);
    assert.equal(r.variants[0].attributes.size, 's');
    assert.equal(r.variants[1].price, 32000);
    assert.equal(r.variantConfidence, 0.35);
  });

  test('d) malformed LLM variant entries (missing price / missing attrs / junk) -> dropped, no crash', async () => {
    stubLLM({
      name: 'Kemeja', price: 10000, stock: null, categoryName: null, unit: null,
      weight: 100, description: null, confidence: 0.9,
      variants: [
        { attributes: { size: 'S' } },                  // missing price -> DROP
        { attributes: { size: 'M' }, price: 20000 },   // valid -> KEEP
        'not-an-object',                               // junk -> skip
        { price: 999 },                                // missing attributes -> DROP
        { attributes: {}, price: 5000 },               // empty attributes -> DROP
        { attributes: { size: 'L' }, price: '30rb' },  // price string -> 30000, KEPT
      ],
      variantConfidence: 0.7,
    });

    const r = await extract('teks apa saja');

    assert.equal(r.variants.length, 2); // M (20000) + L (30000)
    assert.equal(r.variants[0].attributes.size, 'm');
    assert.equal(r.variants[0].price, 20000);
    assert.equal(r.variants[0].sku, null); // omitted -> normalized to null
    assert.equal(r.variants[1].attributes.size, 'l');
    assert.equal(r.variants[1].price, 30000); // string "30rb" normalized via normalizePriceText
  });
});
