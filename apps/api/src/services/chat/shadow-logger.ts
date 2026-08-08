/**
 * Shadow Logger — FASE C1 (sub-fase 1/4)
 * src/services/chat/shadow-logger.ts
 *
 * Log-only shadow compare: membandingkan output engine lama (live) vs
 * engine v3.2 (shadow) per message. Pure functions — storage/persist
 * di-handle caller di FASE C3.
 *
 * I8: modul ini tidak memutate state workspace/pending/cart (READ-ONLY).
 * I15: hasil shadow belum diverifikasi ke DB — verifikasi di stage terpisah.
 */
import { adapters } from '../../adapters/container.js';
import { ENGINE_VERSION } from './constants-v2.js';
import { SCHEMA_VERSION } from './decisionTrace.js';
import type {
  ShadowEntry,
  ShadowMismatch,
} from './shadow-types.js';
import type { ResponseSource } from '../../domain/types.js';
import type {
  ActV2,
  InterpreterResultV2,
  ShadowOutcome,
} from './types-v2.js';

// ─────────────────────────────────────────────────────────────────────────────
// Build params
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildShadowEntryParams {
  conversationId: string;
  messageId: string;
  storeId: string;
  oldSource: ResponseSource;
  oldReply: string;
  oldEntities: any[];
  newOutcome: ShadowOutcome;
  reasoningResult: InterpreterResultV2;
  plannedActs: ActV2[];
  validatorReasons: string[];
  validatorRetryable: boolean;
  llmCalls: 0 | 1 | 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ekstrak nilai produk dari entitas.
 * Hanya entitas dengan type === 'product' yang dipertimbangkan.
 * Lowercase agar perbandingan case-insensitive.
 *
 * Semua referensi pakai value string, BUKAN index.
 */
function extractProductValues(entities: any[]): string[] {
  return (entities ?? [])
    .filter((e) => e && typeof e === 'object' && e.type === 'product')
    .map((e) => String(e.value).toLowerCase());
}

/**
 * Bandingkan dua set produk (case-insensitive).
 * Mengembalikan true bila set tidak sama.
 */
function setsDiffer(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return true;
  return ![...setA].every((p) => setB.has(p));
}

// ─────────────────────────────────────────────────────────────────────────────
// computeMismatch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hitung mismatch antara output engine lama dan baru.
 * READ-ONLY — tidak memutate input.
 *
 * @param old    hasil engine lama: { reply, entities }
 * @param newv   hasil engine baru:  { reply_draft, entities }
 * @returns      ShadowMismatch
 */
export function computeMismatch(
  old: { reply: string; entities: any[] },
  newv: { reply_draft: string | null; entities: any[] }
): ShadowMismatch {
  // replyDiffers: case-insensitive comparison
  const oldReply = old.reply ?? '';
  const newReply = newv.reply_draft ?? '';
  const replyDiffers = oldReply.toLowerCase() !== newReply.toLowerCase();

  // entitySetDiffers: set produk lama ≠ set produk baru
  // oldEntityCount / newEntityCount: jumlah entitas produk
  const oldProducts = extractProductValues(old.entities);
  const newProducts = extractProductValues(newv.entities);
  const entitySetDiffers = setsDiffer(oldProducts, newProducts);

  return {
    replyDiffers,
    entitySetDiffers,
    oldEntityCount: oldProducts.length,
    newEntityCount: newProducts.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildShadowEntry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bangun ShadowEntry lengkap dari hasil engine lama dan baru.
 * Pure function — tidak melakukan I/O.
 *
 * WAJIB stamp engine_version + schema_version dari konstanta v3.2.
 */
export function buildShadowEntry(
  params: BuildShadowEntryParams
): ShadowEntry {
  const {
    conversationId,
    messageId,
    storeId,
    oldSource,
    oldReply,
    oldEntities,
    newOutcome,
    reasoningResult,
    plannedActs,
    validatorReasons,
    validatorRetryable,
    llmCalls,
  } = params;

  const acts = reasoningResult.acts ?? [];

  // intents: intent + entities per act
  const intents = acts.map((a) => ({
    intent: a.intent,
    entities: a.entities ?? [],
  }));

  // entities: gabungan semua entities dari semua act
  const newEntities = acts.flatMap((a) => a.entities ?? []);

  const newField = {
    outcome: newOutcome,
    reply_draft: reasoningResult.reply_draft ?? null,
    intents,
    entities: newEntities,
    unmatched: reasoningResult.unmatched_mentions ?? [],
    plannedActs,
    validatorReasons,
    validatorRetryable,
    llmCalls,
  };

  const mismatch = computeMismatch(
    { reply: oldReply, entities: oldEntities },
    newField
  );

  return {
    conversation_id: conversationId,
    message_id: messageId,
    engine_version: ENGINE_VERSION,
    schema_version: SCHEMA_VERSION,
    timestamp: Date.now(),
    store_id: storeId,
    old: {
      source: oldSource,
      reply: oldReply,
      entities: oldEntities,
    },
    new: newField,
    mismatch,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// logShadowEntry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log shadow entry ke logger.
 * WAJIB stamp engine_version + schema_version pada setiap entry.
 */
export function logShadowEntry(entry: ShadowEntry): void {
  adapters.logger.info('Shadow compare', {
    ...entry,
    engine_version: ENGINE_VERSION,
    schema_version: SCHEMA_VERSION,
  });
}
