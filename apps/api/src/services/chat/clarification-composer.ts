/**
 * Clarification Composer — BAGIAN 2 (v3.2)
 * src/services/chat/clarification-composer.ts
 *
 * Menyusun kalimat clarification (natural language) dengan bentuk yang
 * BERUBAH per attempt:
 *   - attempt 1: klarifikasi normal (tanya langsung + list opsi).
 *   - attempt 2: berubah bentuk — tidak mengulang question; menawarkan
 *                jalan keluar (default / sebut nomor / batal).
 *   - attempt >= 3: fallback (defensive; seharusnya tidak tercapai karena
 *                validator menolak sebelum ke sini).
 *
 * I8: composer ini 0-LLM — hanya memformat string, tidak memanggil model.
 * I10: attempt 2 menawarkan jalan keluar sehingga user tidak terasa ditahan;
 *      klarifikasi final ditutup oleh user (bukan LLM), sehingga tidak menghasilkan
 *      harga/stok yang belum diverifikasi. (I15)
 */
import type { ClarificationV2 } from './types-v2.js';

// ─────────────────────────────────────────────────────────────────────────────
// Context (extensible)
// ─────────────────────────────────────────────────────────────────────────────

/** Konteks opsional untuk personalisasi clarification. */
export interface ComposeContextV2 {
  /** Nama produk paling laris — ditawarkan sebagai default di attempt 2 (jika ada). */
  topProduct?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Nomor urut opsi: ['A','B','C'] -> "1, 2, 3". */
function optionNumbers(options: string[]): string {
  return options.map((_, i) => String(i + 1)).join(', ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-attempt composers
// ─────────────────────────────────────────────────────────────────────────────

/** Attempt 1: klarifikasi normal — langsung tanya + list opsi. */
function composeAttemptOne(clar: ClarificationV2): string {
  if (clar.options.length === 0) return clar.question;
  const bullets = clar.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
  return `${clar.question}\n\n${bullets}\n\nKetik nomor pilihan Anda ya.`;
}

/** Attempt 2: BERUBAH BENTUK — jangan ulang question; tawarkan jalan keluar. */
function composeAttemptTwo(
  clar: ClarificationV2,
  ctx?: ComposeContextV2
): string {
  const opts = clar.options;
  const hasOpts = opts.length > 0;
  const nums = optionNumbers(opts);

  // affirmative: konfirmasi ya/tidak
  if (clar.expected_type === 'affirmative') {
    if (hasOpts) {
      return `Masih bingung nih Kak. Boleh tolong pilih 'iya' atau 'tidak' (atau sebut nomor ${nums}). Atau ketik 'batal'.`;
    }
    return `Masih binggung nih Kak. Silakan ketik 'iya' untuk lanjut, 'tidak' untuk tidak, atau 'batal'.`;
  }

  // choice (atau yes_no / default)
  const defaultOffer = ctx?.topProduct
    ? `Mau saya pilihkan ${ctx.topProduct} saja`
    : 'Mau saya pilihkan yang paling laris aja';
  const exitOffer = hasOpts
    ? `Kakak bisa bilang 'yang paling laris' atau sebut nomor (${nums}). Atau mau batal dulu?`
    : 'Atau mau batalkan dulu?';
  return `Masih binggung nich Kak. ${defaultOffer}, atau ${exitOffer}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// composeClarification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Susun kalimat clarification untuk attempt tertentu.
 *
 * @param clar    clarification yang akan disusun.
 * @param attempt nomor attempt clarification (1 = normal, 2 = berubah bentuk,
 *                >= 3 = fallback).
 * @param context opsional (mis. topProduct untuk default attempt 2).
 */
export function composeClarification(
  clar: ClarificationV2,
  attempt: number,
  context?: ComposeContextV2
): string {
  if (attempt >= 3) {
    return 'Sepertinya saya kurang paham, mau saya bantu manual?';
  }
  if (attempt === 2) return composeAttemptTwo(clar, context);
  // attempt 1 (0 / negatif diperlakukan sebagai attempt 1)
  return composeAttemptOne(clar);
}
