/**
 * Validator v2 — BAGIAN 3 (v3.2)
 * src/services/chat/validator-v2.ts
 *
 * Memvalidasi InterpreterResultV2 terhadap katalog / opsi / pending.
 * 0-LLM (rule-based) — mengembalikan ValidatorResultV2{ok, reasons, retryable}.
 *
 * Invariants (I-V2-*):
 *  - I-V2-1 no entity left behind: tiap product-mention di acts.entities harus
 *        ada di catalog ATAU di unmatched_mentions.             -> retryable
 *  - I-V2-2 no silent affirmation: act affirmative/confirm + N>2 opsi
 *        tanpa quantifier subset.                               -> retryable
 *  - I-V2-3 kardinalitas: quantifier recomputed N dari optionsPresented;
 *        resolution_type=mismatch wajib ada mismatch_reason.   -> retryable
 *  - I-V2-4 attempts > CLARIFICATION_MAX_ATTEMPTS -> ok=false, retryable=FALSE (eskalasi)
 *  - I-V2-5 supersede valid: id yang direferensi ada di acts[], tak bersiklus -> retryable
 *  - I-V2-6 selection confidence < SELECTION_CONFIDENCE_THRESHOLD -> clarify, retryable=FALSE
 *  - I-V2-7 unmatched non-kosong wajib ada clarification ATAU disebut di reply_draft -> retryable
 *  - I-V2-8 conflicting_acts: 2 act cart_update produk sama tanpa supersedes -> retryable
 *  - I-V2-9 qty ada tapi qty_source absent -> retryable
 *
 * terminal (I-V2-4/I-V2-6) menang atas retryable bila konflik: eskalasi/clarify
 * tidak boleh di-retry.
 *
 * I8: validator 0-LLM.
 * I5: semua resolusi pakai act_id / nama, bukan index.
 */
import type {
  InterpreterResultV2,
  ActV2,
  PendingV2,
  ValidatorResultV2,
} from './types-v2.js';
import {
  SELECTION_CONFIDENCE_THRESHOLD,
  CLARIFICATION_MAX_ATTEMPTS,
} from './constants-v2.js';
import type { CatalogItem } from './setops.js';

// ─────────────────────────────────────────────────────────────────────────────
// Context type
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidatorContextV2 {
  optionsPresented: string[];
  catalog: CatalogItem[];
  pendings: PendingV2[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** Lookup satu item di katalog by nama (case-insensitive). */
function findInCatalog(
  catalog: CatalogItem[],
  name: string
): CatalogItem | undefined {
  return catalog.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
}

/** Apakah sebuah act termasuk intent cart_update? (cek X DULU untuk conflict) */
function isCartAct(act: ActV2): boolean {
  return act.intent.toLowerCase().includes('cart');
}

/** Nama produk target dari act (entitas pertama bertipe 'product'). */
function targetProduct(act: ActV2): string | undefined {
  return act.entities.find((e) => e.type === 'product')?.value;
}

/**
 * Walk rantai supersede dari startId; true bila mengunjungi node berulang
 * (siklus). Logika ekuivalen planner.resolveWinner, tapi di sini hanya
 * membutuhkan deteksi siklus (I-V2-5).
 */
function inCycle(
  startId: string,
  supersededBy: Map<string, ActV2>
): boolean {
  const visited = new Set<string>();
  let current = startId;
  while (true) {
    if (visited.has(current)) return true;
    visited.add(current);
    const next = supersededBy.get(current);
    if (!next) return false;
    current = next.act_id;
  }
}

/** quantifier subset yang memungkinkan affirmative aman (I-V2-2 guard). */
function hasSubsetQuantifier(
  q: InterpreterResultV2['quantifier']
): boolean {
  return !!q && q.resolution_type === 'subset';
}

// ─────────────────────────────────────────────────────────────────────────────
// validate
// ─────────────────────────────────────────────────────────────────────────────

export function validate(
  result: InterpreterResultV2,
  ctx: ValidatorContextV2
): ValidatorResultV2 {
  const reasons: string[] = [];
  let retryable = false; // ada violation yang boleh di-retry
  let terminal = false; // I-V2-4 / I-V2-6 -> retryable FALSE (eskalasi / clarify)

  // Defensif pada batas boundary JSON (LLM output bisa omit field).
  const acts = result.acts ?? [];
  const unmatched = result.unmatched_mentions ?? [];
  const N = ctx.optionsPresented.length;
  const catalog = ctx.catalog;

  const catalogNames = new Set(catalog.map((c) => c.name.toLowerCase()));
  const unmatchedSet = new Set(unmatched.map((u) => u.toLowerCase()));
  const resultIds = new Set(acts.map((a) => a.act_id));

  // ── I-V2-9: qty ada tapi qty_source absent (runtime LLM omission guard) ──
  for (const a of acts) {
    const qs = a.qty_source as 'explicit' | 'default' | undefined;
    if (a.qty !== undefined && qs === undefined) {
      reasons.push(`I-V2-9: act ${a.act_id} punya qty tapi qty_source absent`);
      retryable = true;
    }
  }

  // ── I-V2-1: no entity left behind (product mentions) ──
  for (const a of acts) {
    for (const e of a.entities) {
      if (e.type !== 'product') continue; // hanya mention produk dicek katalog
      const v = e.value.toLowerCase();
      if (!catalogNames.has(v) && !unmatchedSet.has(v)) {
        reasons.push(
          `I-V2-1: mention "${e.value}" (act ${a.act_id}) tidak di catalog dan tidak di unmatched_mentions`
        );
        retryable = true;
      }
    }
  }

  // ── I-V2-2: no silent affirmation ──
  const affirmed = acts.some(
    (a) =>
      a.intent.toLowerCase().includes('affirmative') ||
      a.intent.toLowerCase().includes('confirm')
  );
  if (affirmed && N > 2 && !hasSubsetQuantifier(result.quantifier)) {
    reasons.push(
      `I-V2-2: affirmative/confirm pada ${N} opsi (>2) tanpa quantifier subset -> retry`
    );
    retryable = true;
  }

  // ── I-V2-3: kardinalitas + mismatch reason ──
  if (result.quantifier) {
    const q = result.quantifier;
    // hitung ulang N dari optionsPresented; cek setiap resolved index dalam range
    for (const idx of q.resolved_indices) {
      if (idx < 0 || idx >= N) {
        reasons.push(
          `I-V2-3: kardinalitas mismatch — resolved index ${idx} di luar range [0,${N})`
        );
        retryable = true;
      }
    }
    if (q.resolution_type === 'mismatch' && !q.mismatch_reason) {
      reasons.push('I-V2-3: resolution_type=mismatch harus ada mismatch_reason');
      retryable = true;
    }
  }

  // ── I-V2-5: supersede valid (dangling + cycle), by act_id ──
  const supersededBy = new Map<string, ActV2>();
  for (const a of acts) {
    if (a.supersedes != null) {
      if (!resultIds.has(a.supersedes)) {
        reasons.push(
          `I-V2-5: act ${a.act_id} supersede id tidak ada: ${a.supersedes}`
        );
        retryable = true;
      } else {
        supersededBy.set(a.supersedes, a);
      }
    }
  }
  const cyclicIds = new Set<string>();
  for (const a of acts) {
    if (inCycle(a.act_id, supersededBy)) cyclicIds.add(a.act_id);
  }
  if (cyclicIds.size > 0) {
    reasons.push(
      `I-V2-5: siklus supersede terdeteksi pada ${[...cyclicIds].join(', ')}`
    );
    retryable = true;
  }

  // ── I-V2-6: selection confidence < threshold -> paksa clarify ──
  const sel = result.confidence ? result.confidence.selection : undefined;
  if (typeof sel === 'number' && sel < SELECTION_CONFIDENCE_THRESHOLD) {
    reasons.push(
      `I-V2-6: selection confidence (${sel}) < threshold ${SELECTION_CONFIDENCE_THRESHOLD} -> paksa clarify`
    );
    terminal = true;
  }

  // ── I-V2-8: conflicting_acts (dua cart_update produk sama, tidak saling supersede) ──
  const cartActs = acts.filter(isCartAct);
  const groups = new Map<string, ActV2[]>();
  for (const a of cartActs) {
    const t = targetProduct(a);
    if (!t) continue;
    const g = groups.get(t) ?? [];
    g.push(a);
    groups.set(t, g);
  }
  for (const [product, group] of groups) {
    if (group.length < 2) continue;
    const linked = group.some(
      (a) =>
        a.supersedes != null && group.some((b) => b.act_id === a.supersedes)
    );
    if (!linked) {
      reasons.push(
        `I-V2-8: act cart_update konflik pada produk "${product}" tanpa supersedes`
      );
      retryable = true;
    }
  }

  // ── I-V2-4: attempts > CLARIFICATION_MAX_ATTEMPTS -> eskalasi ──
  for (const p of ctx.pendings) {
    if (p.status === 'active' && p.attempts > CLARIFICATION_MAX_ATTEMPTS) {
      reasons.push(
        `I-V2-4: clarification attempts (${p.attempts}) > batas ${CLARIFICATION_MAX_ATTEMPTS} -> eskalasi`
      );
      terminal = true;
    }
  }

  // ── I-V2-7: unmatched non-kosong wajib clarification ATAU disebut di reply_draft ──
  if (unmatched.length > 0) {
    const hasClar = !!result.clarification;
    const mentionedInReply =
      !!result.reply_draft &&
      unmatched.some((u) =>
        result.reply_draft!.toLowerCase().includes(u.toLowerCase())
      );
    if (!hasClar && !mentionedInReply) {
      reasons.push(
        'I-V2-7: unmatched_mentions tidak kosong tanpa clarification dan tidak disebut di reply_draft'
      );
      retryable = true;
    }
  }

  const ok = reasons.length === 0;
  // terminal (eskalasi/clarify) menang atas retryable: tidak boleh di-retry LLM.
  const finalRetryable = ok ? false : terminal ? false : retryable;
  return { ok, reasons, retryable: finalRetryable };
}
