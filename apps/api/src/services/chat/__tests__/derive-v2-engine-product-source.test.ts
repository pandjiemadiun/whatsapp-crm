/**
 * WIRE-V2ENGINE-PRODUCT-LOOKUP — Isolation Unit Test
 *
 * Memanggil deriveV2EngineProductSource() langsung via prototype — TIDAK
 * lewat conversation.service.ts penuh (hindari side-effect DI Prisma/adapters).
 *
 * Runner (Jest):
 *   npx node --experimental-vm-modules ./node_modules/.bin/jest \
 *     --config jest.config.cjs --forceExit --testPathPattern="derive-v2-engine-product-source"
 *
 * Runner (tsx):
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/derive-v2-engine-product-source.test.ts
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ConversationService } from '../../../business/conversation.service.js';
import { productService } from '../../../business/product.service.js';
import { FEW_SHOTS } from '../prompts-v2.js';
import { ResponseSource } from '../../../domain/types.js';
import type { Product } from '../../../domain/types.js';

/**
 * Helper: panggil private method deriveV2EngineProductSource via prototype.
 * Method ini pure — tidak memakai `this` kecuali productService (module-level singleton).
 */
async function callDerive(llmResult: unknown, storeId: string = 'store-test') {
  return (ConversationService.prototype as any).deriveV2EngineProductSource(llmResult, storeId);
}

/**
 * Mock product DB — REUSE productService.searchProducts / listActiveProducts
 * (singleton yang sama dipakai fallback.service.ts tryProduct/tryCatalog).
 */
const MOCK_PRODUCTS: Product[] = [
  { id: 'prod-ban', name: 'Ban Dalam Motor', price: 50000, stock: 100, primaryImageUrl: 'http://img/ban', hasVariants: false } as Product,
  { id: 'prod-oli', name: 'Oli Mesin', price: 75000, stock: 30, primaryImageUrl: 'http://img/oli', hasVariants: false } as Product,
  { id: 'prod-busi', name: 'Busi Motor', price: 15000, stock: 50, primaryImageUrl: 'http://img/busi', hasVariants: true } as Product,
];

/**
 * Stub productService.searchProducts — REUSE singleton (bukan create mock baru).
 */
function stubSearchProducts(fn: (storeId: string, query: string) => Promise<Product[]> | null) {
  const original = productService.searchProducts.bind(productService);
  productService.searchProducts = async (storeId: string, query: string) => {
    const result = await fn(storeId, query);
    return result ?? [];
  };
  return () => {
    productService.searchProducts = original;
  };
}

/**
 * Stub productService.listActiveProducts — REUSE singleton.
 */
function stubListActiveProducts(fn: (storeId: string) => Promise<Product[]>) {
  const original = productService.listActiveProducts.bind(productService);
  productService.listActiveProducts = async (storeId: string) => fn(storeId);
  return () => {
    productService.listActiveProducts = original;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 1a: Real InterpreterResultV2 fixtures (dari FEW_SHOTS, bukan bikin sendiri)
// SEMUA harus return undefined — bukti deriveV2EngineProductSource INERT di jalur lama.
// ─────────────────────────────────────────────────────────────────────────────
// FEW_SHOTS adalah array expected_json string yang pernah keluar dari reasoning.ts
// (reasoning.ts:139: `JSON.parse(resp.content) as InterpreterResultV2`). Kita parse
// semua 11 dan feed langsung. InterpreterResultV2 tidak punya `proposed_actions`,
// jadi duck-typing check `'proposed_actions' in r` → false → return undefined.
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineProductSource — 1a: real InterpreterResultV2 fixtures (FEW_SHOTS, 11 items)', () => {
  for (let i = 0; i < FEW_SHOTS.length; i++) {
    const fs = FEW_SHOTS[i];
    it(`FEW_SHOTS[${i}] "${fs.user_message}" → INTERPRETERRESULTV2, return undefined (inert)`, async () => {
      const parsed = JSON.parse(fs.expected_json);
      const reason = await callDerive(parsed, 'store-test');
      assert.strictEqual(
        reason,
        undefined,
        `FEW_SHOTS[${i}] "${fs.user_message}": InterpreterResultV2 tidak boleh trigger product lookup, dapat: ${JSON.stringify(reason)}`
      );
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 1b: V2EngineOutput with 1 product entity (valid) → PRODUCT source
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineProductSource — 1b: V2EngineOutput + 1 valid product entity', () => {
  let restoreSearch: (() => void) | null = null;

  beforeEach(() => {
    restoreSearch = stubSearchProducts(async (_storeId: string, query: string) => {
      // REUSE: searchProducts — exact match dulu, lalu partial
      const exact = MOCK_PRODUCTS.find((p) => p.name.toLowerCase() === query.toLowerCase());
      if (exact) return [exact];
      const partial = MOCK_PRODUCTS.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
      return partial;
    });
  });

  afterEach(() => {
    if (restoreSearch) restoreSearch();
    restoreSearch = null;
  });

  it('entity product "ban dalam motor" → resolve ke product ID (PRODUCT source, 1 item)', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.9,
      entities: [{ type: 'product', value: 'ban dalam motor', confidence: 0.95 }],
      proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.85, requires_validation: false }],
      reply_text: 'Untuk ban dalam motor ada nih Kak.',
      needs_clarification: false,
      uncertainty_signals: [],
    };

    const result = await callDerive(v2Output, 'store-test');

    assert.ok(result, 'harus resolve (bukan undefined)');
    assert.strictEqual(result!.source, ResponseSource.PRODUCT);
    assert.deepStrictEqual(result!.metadata.matchedNames, ['Ban Dalam Motor']);
    assert.deepStrictEqual(result!.metadata.productIds, ['prod-ban']);
    assert.deepStrictEqual(result!.metadata.matchedPrices, [50000]);
  });

  it('entity product "oli mesin" → resolve ke product ID (PRODUCT source, 1 item)', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.9,
      entities: [{ type: 'product', value: 'oli mesin', confidence: 0.9 }],
      proposed_actions: [],
      reply_text: 'Oli mesin ada ya Kak.',
      needs_clarification: false,
      uncertainty_signals: [],
    };

    const result = await callDerive(v2Output, 'store-test');

    assert.ok(result);
    assert.strictEqual(result!.source, ResponseSource.PRODUCT);
    assert.deepStrictEqual(result!.metadata.matchedNames, ['Oli Mesin']);
    assert.deepStrictEqual(result!.metadata.productIds, ['prod-oli']);
    assert.deepStrictEqual(result!.metadata.matchedPrices, [75000]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 1c: V2EngineOutput with product name NOT in DB → undefined
// JANGAN hallucinate — biarkan jatuh ke text biasa.
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineProductSource — 1c: V2EngineOutput + nama produk tidak ada di DB → undefined', () => {
  beforeEach(() => {
    // searchProducts selalu return [] — simulasi nama tidak ketemu
    stubSearchProducts(async () => []);
  });
  afterEach(() => {
    // restore — stubSearchProducts handles internally
  });

  it('entity product "produk_xyz_tidak_ada" → undefined (JANGAN hallucinate)', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.9,
      entities: [{ type: 'product', value: 'produk_xyz_tidak_ada', confidence: 0.8 }],
      proposed_actions: [],
      reply_text: 'Maaf kak, tidak tahu.',
      needs_clarification: false,
      uncertainty_signals: [],
    };

    const result = await callDerive(v2Output, 'store-test');

    // HARUS undefined — 0 produk resolved, jangan fabricate data
    assert.strictEqual(result, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 1d: V2EngineOutput with 2+ product entities → items array (product_list)
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineProductSource — 1d: V2EngineOutput + 2+ product entities → PRODUCT source, items array', () => {
  let restoreSearch: (() => void) | null = null;

  beforeEach(() => {
    restoreSearch = stubSearchProducts(async (_storeId: string, query: string) => {
      const exact = MOCK_PRODUCTS.find((p) => p.name.toLowerCase() === query.toLowerCase());
      return exact ? [exact] : [];
    });
  });

  afterEach(() => {
    if (restoreSearch) restoreSearch();
    restoreSearch = null;
  });

  it('2 entity product → matchedNames/matchedPrices/productIds berisi 2 item (product_list path)', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.9,
      entities: [
        { type: 'product', value: 'ban dalam motor', confidence: 0.95 },
        { type: 'product', value: 'oli mesin', confidence: 0.9 },
      ],
      proposed_actions: [],
      reply_text: 'Ban dalam motor dan oli mesin ada nih.',
      needs_clarification: false,
      uncertainty_signals: [],
    };

    const result = await callDerive(v2Output, 'store-test');

    assert.ok(result);
    assert.strictEqual(result!.source, ResponseSource.PRODUCT);
    // Harus ada 2 items — untuk product_list di classifyStructured
    assert.strictEqual(result!.metadata.matchedNames.length, 2);
    assert.deepStrictEqual(result!.metadata.matchedNames, ['Ban Dalam Motor', 'Oli Mesin']);
    assert.deepStrictEqual(result!.metadata.productIds, ['prod-ban', 'prod-oli']);
    assert.deepStrictEqual(result!.metadata.matchedPrices, [50000, 75000]);
  });

  it('3 entity product → matchedNames berisi 3 item', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.9,
      entities: [
        { type: 'product', value: 'ban dalam motor', confidence: 0.95 },
        { type: 'product', value: 'oli mesin', confidence: 0.9 },
        { type: 'product', value: 'busi motor', confidence: 0.85 },
      ],
      proposed_actions: [],
      reply_text: 'Ban, oli, busi ada semua.',
      needs_clarification: false,
      uncertainty_signals: [],
    };

    const result = await callDerive(v2Output, 'store-test');

    assert.ok(result);
    assert.strictEqual(result!.source, ResponseSource.PRODUCT);
    assert.strictEqual(result!.metadata.matchedNames.length, 3);
    assert.deepStrictEqual(result!.metadata.matchedNames, ['Ban Dalam Motor', 'Oli Mesin', 'Busi Motor']);
    assert.deepStrictEqual(result!.metadata.productIds, ['prod-ban', 'prod-oli', 'prod-busi']);
    assert.deepStrictEqual(result!.metadata.matchedPrices, [50000, 75000, 15000]);
  });

  it('2 entity product tapi hanya 1 resolve di DB → return 1 item (PRODUCT, bukan product_list)', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.9,
      entities: [
        { type: 'product', value: 'ban dalam motor', confidence: 0.95 },
        { type: 'product', value: 'produk_tidak_ada', confidence: 0.8 },
      ],
      proposed_actions: [],
      reply_text: 'Ban ada, yang lain tidak tahu.',
      needs_clarification: false,
      uncertainty_signals: [],
    };

    const result = await callDerive(v2Output, 'store-test');

    // 1 entity resolve, 1 entity tidak ketemu di DB → tetap PRODUCT (1 item)
    // classifyStructured akan baca matchedNames.length === 1 → product (bukan product_list)
    assert.ok(result);
    assert.strictEqual(result!.source, ResponseSource.PRODUCT);
    assert.strictEqual(result!.metadata.matchedNames.length, 1);
    assert.deepStrictEqual(result!.metadata.matchedNames, ['Ban Dalam Motor']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 1e: V2EngineOutput with SHOW_RELATED_PRODUCTS (no product entity) → CATALOG source
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineProductSource — 1e: V2EngineOutput + SHOW_RELATED_PRODUCTS → CATALOG source', () => {
  let restoreList: (() => void) | null = null;

  beforeEach(() => {
    // listActiveProducts return semua mock products
    restoreList = stubListActiveProducts(async () => MOCK_PRODUCTS);
  });

  afterEach(() => {
    if (restoreList) restoreList();
    restoreList = null;
  });

  it('SHOW_RELATED_PRODUCTS + entities kosong → CATALOG source, items dari listActiveProducts', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.85,
      entities: [],
      proposed_actions: [
        { action_type: 'SHOW_RELATED_PRODUCTS', payload: { product: 'ban' }, confidence: 0.85, requires_validation: false },
      ],
      reply_text: 'Untuk ban dalam motor ada nih Kak.',
      needs_clarification: false,
      uncertainty_signals: [],
    };

    const result = await callDerive(v2Output, 'store-test');

    assert.ok(result);
    assert.strictEqual(result!.source, ResponseSource.CATALOG);
    assert.strictEqual(result!.metadata.productCount, 3);
    assert.strictEqual(result!.metadata.items.length, 3);
    // items format: {id, name, price} — konsisten tryCatalog (fallback.service.ts:254)
    assert.deepStrictEqual((result!.metadata.items as any[])[0], { id: 'prod-ban', name: 'Ban Dalam Motor', price: 50000 });
    assert.deepStrictEqual((result!.metadata.items as any[])[1], { id: 'prod-oli', name: 'Oli Mesin', price: 75000 });
    assert.deepStrictEqual((result!.metadata.items as any[])[2], { id: 'prod-busi', name: 'Busi Motor', price: 15000 });
  });

  it('OPEN_CATALOG + entities kosong → CATALOG source', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.85,
      entities: [],
      proposed_actions: [
        { action_type: 'OPEN_CATALOG', payload: {}, confidence: 0.85, requires_validation: false },
      ],
      reply_text: 'Ini katalog toko kami.',
      needs_clarification: false,
      uncertainty_signals: [],
    };

    const result = await callDerive(v2Output, 'store-test');

    assert.ok(result);
    assert.strictEqual(result!.source, ResponseSource.CATALOG);
    assert.strictEqual(result!.metadata.items.length, 3);
  });

  it('SHOW_RELATED_PRODUCTS tapi entities ada product → PRODUCT, bukan CATALOG (entity spesifik lebih kuat)', async () => {
    const restoreSearch = stubSearchProducts(async (_storeId: string, query: string) => {
      const exact = MOCK_PRODUCTS.find((p) => p.name.toLowerCase() === query.toLowerCase());
      return exact ? [exact] : [];
    });

    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.9,
      entities: [{ type: 'product', value: 'ban dalam motor', confidence: 0.95 }],
      proposed_actions: [
        { action_type: 'SHOW_RELATED_PRODUCTS', payload: { product: 'ban' }, confidence: 0.85, requires_validation: false },
      ],
      reply_text: 'Untuk ban dalam motor ada nih.',
      needs_clarification: false,
      uncertainty_signals: [],
    };

    const result = await callDerive(v2Output, 'store-test');

    // Entity product resolve → PRODUCT, tidak masuk CATALOG branch
    assert.ok(result);
    assert.strictEqual(result!.source, ResponseSource.PRODUCT);
    assert.deepStrictEqual(result!.metadata.matchedNames, ['Ban Dalam Motor']);
    assert.ok(!result!.metadata.items, 'tidak boleh ada items (bukan CATALOG)');

    restoreSearch();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 1f: Edge cases / defensive
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineProductSource — 1f: edge cases', () => {
  let restoreSearch: (() => void) | null = null;
  let restoreList: (() => void) | null = null;

  beforeEach(() => {
    restoreSearch = stubSearchProducts(async () => []);
    restoreList = stubListActiveProducts(async () => []);
  });

  afterEach(() => {
    if (restoreSearch) restoreSearch();
    if (restoreList) restoreList();
    restoreSearch = null;
    restoreList = null;
  });

  it('null input → undefined', async () => {
    assert.strictEqual(await callDerive(null, 'store-test'), undefined);
  });

  it('undefined input → undefined', async () => {
    assert.strictEqual(await callDerive(undefined, 'store-test'), undefined);
  });

  it('string input → undefined', async () => {
    assert.strictEqual(await callDerive('not an object', 'store-test'), undefined);
  });

  it('number input → undefined', async () => {
    assert.strictEqual(await callDerive(42, 'store-test'), undefined);
  });

  it('V2EngineOutput tapi proposed_actions bukan array → undefined', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.9,
      entities: [{ type: 'product', value: 'ban', confidence: 0.9 }],
      proposed_actions: 'bukan-array', // invalid
      reply_text: 'test',
      needs_clarification: false,
      uncertainty_signals: [],
    };
    assert.strictEqual(await callDerive(v2Output, 'store-test'), undefined);
  });

  it('V2EngineOutput tapi entities kosong + proposed_actions kosong → undefined', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.9,
      entities: [],
      proposed_actions: [],
      reply_text: 'test',
      needs_clarification: false,
      uncertainty_signals: [],
    };
    assert.strictEqual(await callDerive(v2Output, 'store-test'), undefined);
  });

  it('V2EngineOutput + entity product tapi semua return [] dari DB → undefined', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'product_inquiry',
      confidence: 0.9,
      entities: [{ type: 'product', value: 'tidak_ada_di_db', confidence: 0.9 }],
      proposed_actions: [],
      reply_text: 'Maaf.',
      needs_clarification: false,
      uncertainty_signals: [],
    };
    // stubSearchProducts di atas return []
    assert.strictEqual(await callDerive(v2Output, 'store-test'), undefined);
  });

  it('V2EngineOutput + entity type non-product (qty, variant) → undefined (tidak ada product entity)', async () => {
    const v2Output = {
      schema_version: 'v1',
      intent: 'add_to_cart',
      confidence: 0.9,
      entities: [
        { type: 'quantity', value: '2', confidence: 0.9 },
        { type: 'variant', value: 'merah', confidence: 0.85 },
      ],
      proposed_actions: [{ action_type: 'ADD_TO_CART', payload: {}, confidence: 0.9, requires_validation: true }],
      reply_text: 'test',
      needs_clarification: false,
      uncertainty_signals: [],
    };
    // Tidak ada entity type='product' → tidak masuk product lookup
    // Tapi ada ADD_TO_CART → tidak masuk CATALOG juga (bukan SHOW_RELATED/OPEN_CATALOG)
    assert.strictEqual(await callDerive(v2Output, 'store-test'), undefined);
  });
});
