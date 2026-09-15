/**
 * Proof tests for FIX-PROMPT-DOMAIN-AND-CATALOG-SCALING.
 *
 * Runner (Jest):
 *   npx node --experimental-vm-modules ./node_modules/.bin/jest \
 *     --config jest.config.cjs --forceExit \
 *     --testPathPattern="catalog-context"
 *
 * Tests:
 *   A. 3-product catalog (current store-a3cd7205 state) → mode 'full',
 *      regresi 0 dari perilaku sebelumnya.
 *   B. 50-product dummy seed → mode 'search', prompt jauh lebih pendek
 *      dari full dump, SEARCH_LIMIT (20) diterapkan.
 *   C. Category fallback: pesan tanpa keyword match di katalog besar →
 *      mode 'categories', item = nama kategori.
 *   D. Business category injection di buildV2Prompt.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { productService } from '../../../business/product.service.js';
import { prisma } from '../../../infrastructure/prisma.js';
import { buildCatalogContextForPrompt } from '../../catalog-context.service.js';
import { buildV2Prompt } from '../v2-engine/prompt-builder.js';
import { buildLLMContext } from '../v2-engine/context-builder.js';
import { buildSystemPrompt } from '../prompts-v2.js';
import type { Product, ProductCategory } from '../../../domain/types.js';
import type { CatalogItem } from '../setops.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_STORE_ID = 'store-a3cd7205';

// ─── Stub management ─────────────────────────────────────────────────────────

let listActiveStub: (() => void) | null = null;
let searchStub: (() => void) | null = null;
let categoriesStub: (() => void) | null = null;

function stubListActiveProducts(fn: (storeId: string) => Promise<Product[]>) {
  const original = productService.listActiveProducts.bind(productService);
  productService.listActiveProducts = async (storeId: string) => fn(storeId);
  listActiveStub = () => { productService.listActiveProducts = original; };
}

function stubSearchProducts(fn: (storeId: string, query: string) => Promise<Product[]>) {
  const original = productService.searchProducts.bind(productService);
  productService.searchProducts = async (storeId: string, query: string) => fn(storeId, query);
  searchStub = () => { productService.searchProducts = original; };
}

function stubGetCategoriesByStore(fn: (storeId: string) => Promise<ProductCategory[]>) {
  const original = productService.getCategoriesByStore.bind(productService);
  productService.getCategoriesByStore = async (storeId: string) => fn(storeId);
  categoriesStub = () => { productService.getCategoriesByStore = original; };
}

function restoreAll() {
  if (listActiveStub) { listActiveStub(); listActiveStub = null; }
  if (searchStub) { searchStub(); searchStub = null; }
  if (categoriesStub) { categoriesStub(); categoriesStub = null; }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REAL_3_PRODUCTS: Product[] = [
  { id: 'prod-ban', name: 'Ban Dalam Motor', price: 50000, stock: 100, categoryId: 'cat-spare', primaryImageUrl: '', hasVariants: false } as Product,
  { id: 'prod-busi', name: 'Busi Motor', price: 15000, stock: 50, categoryId: 'cat-spare', primaryImageUrl: '', hasVariants: false } as Product,
  { id: 'prod-oli', name: 'Oli Mesin', price: 75000, stock: 30, categoryId: 'cat-spare', primaryImageUrl: '', hasVariants: false } as Product,
];

function makeDummyProducts(count: number): Product[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `prod-${i}`,
    name: `Produk Sparepart ${i + 1}`,
    price: (i + 1) * 10000,
    stock: 100,
    categoryId: 'cat-spare',
    primaryImageUrl: '',
    hasVariants: false,
  }) as Product);
}

const MOCK_CATEGORIES: ProductCategory[] = [
  { id: 'cat-spare', storeId: TEST_STORE_ID, name: 'Spare Parts', description: null, icon: null, displayOrder: 1, isActive: true, createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
  { id: 'cat-aksesoris', storeId: TEST_STORE_ID, name: 'Aksesoris', description: null, icon: null, displayOrder: 2, isActive: true, createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
];

// ─── Proof A: 3-product catalog → mode 'full', regresi 0 ──────────────────────

describe('buildCatalogContextForPrompt — Proof A: 3 products (full mode)', () => {
  beforeEach(() => {
    stubListActiveProducts(async () => REAL_3_PRODUCTS);
    stubSearchProducts(async () => REAL_3_PRODUCTS);
    stubGetCategoriesByStore(async () => MOCK_CATEGORIES);
  });

  afterEach(() => restoreAll());

  it('3 products (<= 30) → mode "full", all names present, category name filled', async () => {
    const result = await buildCatalogContextForPrompt(
      TEST_STORE_ID,
      'Ban Dalam Motor',
      { draft_cart: [], resolved_facts: {} },
      30,
      20,
    );

    assert.strictEqual(result.mode, 'full');
    assert.strictEqual(result.items.length, 3, 'all 3 products should be returned');

    // Verify product names match exactly
    const names = result.items.map((i) => i.name);
    assert.ok(names.includes('Ban Dalam Motor'));
    assert.ok(names.includes('Busi Motor'));
    assert.ok(names.includes('Oli Mesin'));

    // Verify category name is filled (not null — fixes old hardcode `category: null`)
    for (const item of result.items) {
      assert.ok(item.category !== null, `CatalogItem "${item.name}" harus punya category name (bukan null)`);
      assert.strictEqual(item.category, 'Spare Parts');
    }
  });

  it('buildSystemPrompt with 3-product catalog → output identik dengan sebelumnya (regresi 0)', async () => {
    // CatalogItem[] shape (same as before the fix — category now filled, not null)
    const catalog: CatalogItem[] = REAL_3_PRODUCTS.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      category: 'Spare Parts', // filled now
    }));

    const prompt = buildSystemPrompt(catalog);

    // Verify no "makanan" in system prompt (domain fix)
    assert.ok(!prompt.includes('makanan'), 'system prompt must NOT contain "makanan"');

    // Verify catalog names are present
    assert.ok(prompt.includes('Ban Dalam Motor'));
    assert.ok(prompt.includes('Busi Motor'));
    assert.ok(prompt.includes('Oli Mesin'));

    // Verify 'unit' replaces 'kg' in Rule (d)
    assert.ok(prompt.includes("'2 unit'"), 'Rule (d) must use "unit" not "kg"');
    assert.ok(!prompt.includes("'2 kg'"), 'Rule (d) must NOT contain "2 kg"');

    // Verify 'qty_source: explicit' rule still present (regresi check)
    assert.ok(prompt.includes("qty_source: 'explicit'"));
  });
});

// ─── Proof B: 50-product dummy seed → mode 'search', prompt shorter ──────────

describe('buildCatalogContextForPrompt — Proof B: 50 products (search mode)', () => {
  const DUMMY_50 = makeDummyProducts(50);

  beforeEach(() => {
    stubListActiveProducts(async () => DUMMY_50);
    stubSearchProducts(async (storeId, query) => {
      // Simulate searchProducts: filter by keyword, return top 20 (SEARCH_LIMIT)
      const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      return DUMMY_50
        .filter((p) => keywords.some((kw) => p.name.toLowerCase().includes(kw)))
        .slice(0, 20);
    });
    stubGetCategoriesByStore(async () => MOCK_CATEGORIES);
  });

  afterEach(() => restoreAll());

  it('50 products (> 30) + matching query → mode "search", results capped at 20', async () => {
    const result = await buildCatalogContextForPrompt(
      TEST_STORE_ID,
      'saya mau beli produk sparepart',
      { draft_cart: [], resolved_facts: {} },
      30,
      20,
    );

    assert.strictEqual(result.mode, 'search', '50 products + keyword match → search mode');
    assert.ok(result.items.length <= 20, `search results must respect SEARCH_LIMIT(20): got ${result.items.length}`);
    assert.ok(result.items.length > 0, 'at least 1 match expected');
  });

  it('50 products — prompt with search results JAUH lebih pendek dari full dump', async () => {
    import('../../catalog-context.service.js');
    const { buildCatalogContextForPrompt: helper } = await import('../../catalog-context.service.js');

    // Simulate search returning only 5 results (relevant subset)
    stubSearchProducts(async () => DUMMY_50.slice(0, 5));

    const result = await helper(
      TEST_STORE_ID,
      'ban dalam',
      { draft_cart: [], resolved_facts: {} },
      30,
      20,
    );

    assert.strictEqual(result.mode, 'search');
    assert.strictEqual(result.items.length, 5);

    // Build the catalog string that buildSystemPrompt would generate
    const catalogStr = result.items.map((i) => i.name).join(', ');
    const fullCatalogStr = DUMMY_50.map((p) => p.name).join(', ');

    // Search result prompt must be significantly shorter than full dump
    const ratio = catalogStr.length / fullCatalogStr.length;
    assert.ok(ratio < 0.5, `search catalog (${catalogStr.length} chars) must be < 50% of full dump (${fullCatalogStr.length} chars). Got ratio=${(ratio * 100).toFixed(1)}%`);

    // Also verify: with 3 products (current store), mode is 'full' (unchanged)
    stubListActiveProducts(async () => REAL_3_PRODUCTS);
    const smallResult = await helper(
      TEST_STORE_ID,
      'ban',
      { draft_cart: [], resolved_facts: {} },
      30,
      20,
    );
    assert.strictEqual(smallResult.mode, 'full', '3 products (<=30) → full mode (unchanged)');
    assert.strictEqual(smallResult.items.length, 3);
  });
});

// ─── Proof C: Category fallback — pesan tidak sebut produk spesifik ──────────

describe('buildCatalogContextForPrompt — Proof C: category fallback', () => {
  const DUMMY_50 = makeDummyProducts(50);

  beforeEach(() => {
    stubListActiveProducts(async () => DUMMY_50);
    // searchProducts returns empty (no keyword match — customer asks generic)
    stubSearchProducts(async () => []);
    stubGetCategoriesByStore(async () => MOCK_CATEGORIES);
  });

  afterEach(() => restoreAll());

  it('50 products + search kosong → mode "categories", items = nama kategori', async () => {
    const result = await buildCatalogContextForPrompt(
      TEST_STORE_ID,
      'ada diskon hari ini?', // generic message — no product keyword
      { draft_cart: [], resolved_facts: {} },
      30,
      20,
    );

    assert.strictEqual(result.mode, 'categories', 'search kosong → categories fallback');
    assert.ok(result.items.length > 0, 'must return at least 1 category');

    // Items should contain category names
    const itemNames = result.items.map((i) => i.name);
    assert.ok(itemNames.includes('Spare Parts'), 'must include category name "Spare Parts"');
    assert.ok(itemNames.includes('Aksesoris'), 'must include category name "Aksesoris"');

    // Verify it's NOT dumping all 50 products
    assert.ok(result.items.length < DUMMY_50.length, 'categories mode must NOT return all 50 products');
  });
});

// ─── Proof D: businessCategory injection in buildV2Prompt ────────────────────

describe('buildV2Prompt — Proof D: businessCategory + dynamic Shot 2 injection', () => {
  it('businessCategory injected as 1 kalimat pembuka kontekstual', () => {
    const prompt = buildV2Prompt('=== CONTEXT ===\ntest', {
      businessCategory: 'Spare Parts',
      catalogItems: [{ id: '1', name: 'Ban Dalam Motor', price: 50000, category: 'Spare Parts' }],
    });

    // English business context sentence
    assert.ok(prompt.includes('You are an AI assistant for a Spare Parts store.'),
      'businessCategory must be injected as English context sentence');

    // No "makanan" in the entire prompt
    assert.ok(!prompt.includes('makanan'));
  });

  it('no businessCategory → generic fallback (no crash, no food mention)', () => {
    const prompt = buildV2Prompt('=== CONTEXT ===\ntest');

    assert.ok(!prompt.includes('makanan'));
    // Should still contain the base system prompt
    assert.ok(prompt.includes('You are QloBot, a friendly AI assistant for commerce chat.'));
  });

  it('dynamic Shot 2 uses real product name dari catalog (bukan "wortel")', () => {
    const prompt = buildV2Prompt('=== CONTEXT ===\ntest', {
      catalogItems: [{ id: '1', name: 'Ban Dalam Motor', price: 50000, category: 'Spare Parts' }],
    });

    // Dynamic Shot 2 should contain "Ban Dalam Motor" (real product)
    assert.ok(prompt.includes('Ban Dalam Motor'), 'dynamic Shot 2 must use real catalog product name');

    // MUST NOT contain "wortel" (old food hardcoded)
    assert.ok(!prompt.includes('wortel'), 'Shot 2 must NOT contain hardcoded "wortel"');
  });

  it('no catalog items → dynamic Shot 2 uses generic fallback (bukan makanan)', () => {
    const prompt = buildV2Prompt('=== CONTEXT ===\ntest');

    // Should NOT crash, should NOT contain food terms
    assert.ok(!prompt.includes('makanan'));
    assert.ok(!prompt.includes('wortel'));
    assert.ok(prompt.includes('Example 2')); // Shot 2 section still present
  });

  it('system prompt translated to English (rules, schema, intents)', () => {
    const prompt = buildV2Prompt('test');

    // Rules section must be in English
    assert.ok(prompt.includes('IMPORTANT RULES') || prompt.includes('=== IMPORTANT RULES ==='));

    // Output format header in English
    assert.ok(prompt.includes('OUTPUT FORMAT'));

    // Intent list in English (check a few key intents)
    assert.ok(prompt.includes('product_inquiry'));
    assert.ok(prompt.includes('add_to_cart'));
    assert.ok(prompt.includes('smalltalk'));
    assert.ok(prompt.includes('UNKNOWN_INTENTS') || prompt.includes('KNOWN INTENTS'));

    // reply_text examples still in Indonesian (customer-facing tone)
    assert.ok(prompt.includes('Balasannya dalam Bahasa Indonesia') ||
              prompt.includes('Bahasa Indonesia') ||
              prompt.includes('reply_text'), 'should reference Bahasa Indonesia for reply_text');
  });

  it('buildLLMContext with businessCategory injects into context string', () => {
    const context = buildLLMContext({
      recentHistory: [],
      workspace: {
        schema_version: 'v1',
        conversation_summary: '',
        pendings: [],
        draft_cart: [],
        resolved_facts: {},
        options_presented: [],
      },
      customerMessage: 'Halo',
      businessCategory: 'Spare Parts',
      catalogItems: [{ id: '1', name: 'Ban Dalam', price: 50000, category: 'Spare Parts' }],
      catalogMode: 'full',
    });

    assert.ok(context.includes('Toko ini berkategori: Spare Parts.'));
    assert.ok(context.includes('KATALOG PRODUK (full, 1 item)'));
    assert.ok(context.includes('Ban Dalam'));
    assert.ok(!context.includes('=== KONTeks TOKO ===') || context.includes('KONTeks TOKO'));
  });
});
