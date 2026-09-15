/**
 * Catalog Context — Adaptive Retrieval Helper
 *
 * Generic, reusable helper that builds a filtered product catalog
 * for injection into LLM prompts. Used by BOTH:
 *   - V2-lama path (conversation.service.ts → buildSystemPrompt)
 *   - V2 rewrite path (context-builder.ts → buildLLMContext)
 *
 * Design principles:
 *   - Generic signature: storeId + query text + threshold. JANGAN spesifik
 *     proses/domain di nama/parameternya — bisa dipakai untuk FAQ/Knowledge
 *     Base kapan pun dibutuhkan.
 *   - Retrieval adaptif:
 *     1. Full → <= threshold: dump semua produk aktif (nama + harga + category).
 *     2. Search → > threshold: keyword search via productService.searchProducts,
 *        hasil terbatas oleh SEARCH_LIMIT (20) built-in.
 *     3. Categories fallback → search kosong: kembalikan daftar nama kategori
 *        (bukan dump semua produk).
 *   - Category info: productService.listActiveProducts / searchProducts
 *        mengembalikan Product dengan categoryId (bukan categoryName). Helper
 *        ini melakukan join dengan productService.getCategoriesByStore untuk
 *        mengisi CatalogItem.category dengan nama kategori asli.
 */

import { productService } from '../business/product.service.js';
import type { CatalogItem } from './chat/setops.js';
import type { Product, ProductCategory } from '../domain/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Mode retrieval yang dipilih oleh helper. */
export type CatalogContextMode = 'full' | 'search' | 'categories';

/** Hasil retrieval — dipakai kedua jalur V2. */
export interface CatalogContextResult {
  mode: CatalogContextMode;
  items: CatalogItem[];
}

/** State minimal workspace yang dibutuhkan helper. */
export interface WorkspaceStateSnapshot {
  draft_cart?: Array<{ product: string }>;
  resolved_facts?: Record<string, unknown>;
  options_presented?: string[][];
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bangun filtered catalog untuk prompt LLM.
 *
 * @param storeId           Store yang sedang direspon.
 * @param customerMessage   Pesan customer (untuk keyword extraction).
 * @param workspaceState    State workspace (draft_cart, resolved_facts, opsi).
 * @param threshold         Jumlah produk di atas mana beralih ke search mode (default 30).
 * @param searchLimit       Limit pencarian (default 20 — match SEARCH_LIMIT di productService).
 *
 * Flow:
 *   1. listActiveProducts(storeId) — dapatkan jumlah total.
 *   2. Jika <= threshold → mode 'full': return semua, join dengan category name.
 *   3. Jika > threshold → mode 'search': ekstrak keyword dari
 *      (customerMessage + draft_cart.product + resolved_facts values),
 *      panggil productService.searchProducts (bawaan limit 20).
 *      Jika hasil kosong → mode 'categories'.
 *
 * @returns { mode, items } — items adalah CatalogItem[] dengan category name
 *   diisi (bukan null) bila tersedia.
 */
export async function buildCatalogContextForPrompt(
  storeId: string,
  customerMessage: string,
  workspaceState: WorkspaceStateSnapshot,
  threshold: number = 30,
  searchLimit: number = 20,
): Promise<CatalogContextResult> {
  // ── 0. Pre-fetch category name lookup (join helper) ──────────────
  // productService.listActiveProducts/searchProducts mengembalikan Product
  // dengan categoryId (bukan categoryName). Kita butuh nama kategori untuk
  // CatalogItem.category field.
  const categoryMap = await buildCategoryMap(storeId);

  // ── 1. Get total count of active products ────────────────────────
  const allProducts = await productService.listActiveProducts(storeId);

  // ── 2a. Full mode (under threshold): dump all, join category name ──
  if (allProducts.length <= threshold) {
    return {
      mode: 'full',
      items: allProducts.map((p) => toCatalogItem(p, categoryMap)),
    };
  }

  // ── 2b. Search mode (> threshold): keyword search ───────────────
  const combinedText = buildCombinedQuery(customerMessage, workspaceState);
  const searchResults = combinedText
    ? await productService.searchProducts(storeId, combinedText)
    : [];

  // searchProducts already enforces SEARCH_LIMIT=20 internally; searchLimit
  // param di sini untuk dokumentasi/compatibilitas future.
  void searchLimit; // acknowledged: productService.searchProducts hardcodes take=20

  if (searchResults.length > 0) {
    return {
      mode: 'search',
      items: searchResults.map((p) => toCatalogItem(p, categoryMap)),
    };
  }

  // ── 2c. Categories fallback: search kosong → list kategori ──────
  const categories = await productService.getCategoriesByStore(storeId);
  if (categories.length > 0) {
    return {
      mode: 'categories',
      items: categories.map((c) => ({
        id: c.id,
        name: c.name,
        price: 0,
        category: c.name,
      })),
    };
  }

  // ── 2d. Absolute fallback: semua produk (harusnya jarang terjadi) ──
  return {
    mode: 'full',
    items: allProducts.map((p) => toCatalogItem(p, categoryMap)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a Map<categoryId, categoryName> from productService.getCategoriesByStore.
 */
async function buildCategoryMap(storeId: string): Promise<Map<string, string>> {
  try {
    const categories: ProductCategory[] = await productService.getCategoriesByStore(storeId);
    const map = new Map<string, string>();
    for (const c of categories) {
      map.set(c.id, c.name);
    }
    return map;
  } catch {
    // If category fetch fails, return empty map — category field stays null
    return new Map();
  }
}

/**
 * Convert a Product to CatalogItem, filling category name from the map
 * (replacing the old hardcoded `category: null`).
 */
function toCatalogItem(product: Product, categoryMap: Map<string, string>): CatalogItem {
  return {
    id: product.id,
    name: product.name,
    price: product.price ?? 0,
    category: product.categoryId && categoryMap.has(product.categoryId)
      ? categoryMap.get(product.categoryId)!
      : (product.categoryId ?? null),
  };
}

/**
 * Build combined keyword text from customer message + workspace state.
 * The text is passed to productService.searchProducts, which internally
 * calls extractKeywords() to pull meaningful keywords.
 */
function buildCombinedQuery(message: string, ws: WorkspaceStateSnapshot): string {
  const parts: string[] = [message];

  // draft_cart product names (these are likely relevant to the current intent)
  if (ws.draft_cart && ws.draft_cart.length > 0) {
    parts.push(ws.draft_cart.map((op) => op.product).join(' '));
  }

  // resolved_facts: extract string values
  if (ws.resolved_facts) {
    for (const value of Object.values(ws.resolved_facts)) {
      if (typeof value === 'string' && value.length > 0) {
        parts.push(value);
      }
    }
  }

  // options_presented: flatten and include
  if (ws.options_presented && ws.options_presented.length > 0) {
    parts.push(...ws.options_presented.flat());
  }

  return parts.join(' ').trim();
}
