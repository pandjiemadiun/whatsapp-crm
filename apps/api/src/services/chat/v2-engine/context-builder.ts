/**
 * V2 Engine — Context Assembly Layer
 *
 * Standalone utility: buildLLMContext().
 * No wiring to interpreter.ts / reasoning.ts / fallback.service.ts.
 *
 * Implements Part 3 of CHAT-ENGINE-V2-DESIGN-P1.md:
 *  - Sliding window (MAX_TURNS = 10)
 *  - Workspace_v2 state injection
 *  - 3-layer format: state → history → current message
 *  - OPTIONAL: adaptive catalog context (REUSE shared
 *    buildCatalogContextForPrompt) + businessCategory injection
 */

import type { WorkspaceV2 } from '../types-v2.js';
import type { HistoryTurn } from '../prompts-v2.js';
import type { CatalogItem } from '../setops.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_TURNS = 10; // 5 pairs user+assistant

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildLLMContextOptions {
  recentHistory: HistoryTurn[];
  workspace: WorkspaceV2;
  customerMessage: string;
  /**
   * Store ID — diperlukan untuk adaptive catalog retrieval.
   * Jika diberikan, buildLLMContext akan memanggil shared helper
   * buildCatalogContextForPrompt untuk fetch katalog produk yang relevan.
   */
  storeId?: string;
  /**
   * Business category toko (mis. "Spare Parts") — disuntik ke system prompt
   * sebagai kalimat pembuka kontekstual. Jika tidak ada, pakai fallback generik.
   * Berasal dari Store.businessCategory (Onboarding Wizard).
   */
  businessCategory?: string | null;
  /**
   * Katalog yang sudah di-resolve oleh caller (bisa didraftkan di shadow-wiring.ts).
   * Jika disediakan, buildLLMContext TIDAK memanggil helper lagi —
   * cukup gunakan array ini langsung.
   */
  catalogItems?: CatalogItem[];
  /**
   * Mode katalog yang dipilih oleh shared helper (untuk logging/debug).
   * Jika caller menyupply catalogItems langsung, nilai ini informatif.
   */
  catalogMode?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bangun full context string yang dikirim ke V2 LLM engine.
 *
 * 3-layer format: STATE → HISTORY → CURRENT MESSAGE
 * Plus optional LAYER: KATALOG PRODUK (jika storeId/catalogItems tersedia)
 * Plus optional LAYER: BUSINESS CONTEXT (jika businessCategory tersedia)
 */
export function buildLLMContext({
  recentHistory,
  workspace,
  customerMessage,
  storeId,
  businessCategory,
  catalogItems,
  catalogMode,
}: BuildLLMContextOptions): string {
  const parts: string[] = [];

  // ── Layer 0: Business context (store identity) ──────────────────────
  // Reuse pola dari prompt-builder.service.ts (V1): inject businessCategory
  // sebagai kalimat pembuka kontekstual.
  if (businessCategory) {
    parts.push(`=== KONTeks TOKO ===`);
    parts.push(`Toko ini berkategori: ${businessCategory}.`);
  }

  // Layer 2: Workspace state (ground truth)
  parts.push('=== STATE PERCAKAPAN (lupakan pesan lama, ini yang penting) ===');

  if (workspace.conversation_summary) {
    parts.push(`Ringkasan: ${workspace.conversation_summary}`);
  }

  if (Object.keys(workspace.resolved_facts).length > 0) {
    parts.push(`Fakta yang sudah diketahui: ${JSON.stringify(workspace.resolved_facts)}`);
  }

  if (workspace.draft_cart.length > 0) {
    parts.push(`Keranjang saat ini: ${JSON.stringify(workspace.draft_cart)}`);
  }

  const activePendings = workspace.pendings.filter((p) => p.status === 'active');
  if (activePendings.length > 0) {
    parts.push(`Clarification aktif: ${activePendings.map((p) => p.question).join('; ')}`);
  }

  if (workspace.options_presented.length > 0) {
    parts.push(`Opsi yang sudah ditampilkan: ${JSON.stringify(workspace.options_presented.slice(-3))}`);
  }

  // ── Layer: Product catalog (adaptive) ───────────────────────────────
  // Jika caller menyediakan catalogItems (dari shared helper), inject ke context.
  // Jika hanya storeId yang ada, inject marker — retrieval async dilakukan di caller
  // (shadow-wiring.ts), karena buildLLMContext ini adalah sync function dan
  // shared helper memanggil productService (async).
  if (catalogItems && catalogItems.length > 0) {
    const modeLabel = catalogMode ?? 'full';
    parts.push(`=== KATALOG PRODUK (${modeLabel}, ${catalogItems.length} item) ===`);
    parts.push(catalogItems.map((c) => c.name).join(', '));
  } else if (storeId && !catalogItems) {
    // Caller belum fetch katalog — beri tahu LLM bahwa katalog tersedia
    // (retrieval dilakukan secara terpisah oleh caller sebelum memanggil
    // buildLLMContext, jadi ini hanya marker informatif)
    parts.push(`=== KATALOG PRODUK ===`);
    parts.push('[Katalog produk toko tersedia — lihat system prompt untuk ketersediaan]');
  }

  // Layer 1: Recent history (sliding window)
  const trimmedHistory = recentHistory.slice(-MAX_TURNS);
  parts.push(`=== PERCAKAPAN TERBARU (max ${MAX_TURNS} turn) ===`);
  for (const turn of trimmedHistory) {
    parts.push(`${turn.role === 'user' ? 'Customer' : 'Assistant'}: ${turn.content}`);
  }

  // Layer 3: Current message
  parts.push('=== PESAN SEKARANG ===');
  parts.push(`Customer: ${customerMessage}`);

  return parts.join('\n');
}
