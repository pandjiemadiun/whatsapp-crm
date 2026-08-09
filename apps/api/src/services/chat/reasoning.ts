/**
 * Reasoning Engine — FASE B4 (INTEGRASI)
 * src/services/chat/reasoning.ts
 *
 * Menggabungkan 4 lapis deterministik + LLM single-pass:
 *   A. Fast path (0-LLM): pending resolver + tier deterministik
 *   B. Reasoning (LLM): single-pass interpret + validate + plan
 *   C. Fallback: jika semua gagal
 *
 * I8: maksimal 1 LLM call per attempt (fast path = 0).
 *     Transport retry (429/timeout) max 1x; validation retry max 1x.
 * I10: fast path + tier tidak menghasilkan harga/stok dari LLM.
 * I15: hasil tier/reasoned belum diverifikasi ke DB — verifikasi di stage terpisah.
 */
import type {
  WorkspaceV2,
  InterpreterResultV2,
  ActV2,
} from './types-v2.js';
import type { CatalogItem } from './setops.js';
import type { Trace } from './decisionTrace.js';
import { newTrace, add } from './decisionTrace.js';
import type { ResponseResult } from '../../domain/types.js';
import { tryFastPath } from './fast-path.js';
import type { FastPathResult } from './fast-path.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts-v2.js';
import type { HistoryTurn } from './prompts-v2.js';
import { validate, type ValidatorContextV2 } from './validator-v2.js';
import type { ValidatorResultV2 } from './types-v2.js';
import { planActs } from './planner.js';
import { groqAdapter } from '../../adapters/ai/groq.adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants (no magic numbers)
// ─────────────────────────────────────────────────────────────────────────────

/** Suhu LLM untuk interpreter (deterministik, rendah varians). */
const LLM_TEMPERATURE = 0.2;

/** Batas token output LLM (stage 4 single-pass). */
const LLM_MAX_TOKENS = 250;

/** Intent label untuk tracking biaya/token di groqAdapter. */
const LLM_INTENT = 'conversation-interpreter';

/** Maksimal retry untuk transport error (429/timeout/parse) dalam satu attempt. */
const TRANSPORT_MAX_RETRIES = 1;

/** Default conversation_id untuk trace (orchestrator akan supply yang sebenarnya). */
const DEFAULT_CONVERSATION_ID = 'reasoning-unknown';

// ─────────────────────────────────────────────────────────────────────────────
// Result type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hasil akhir reasoning engine — discriminated union.
 * - 'resolved'/'tier': jawaban ditemukan di fast path (0 LLM).
 * - 'reasoned': LLM interpreter berhasil, hasil divalidasi + di-plan.
 * - 'fallback_reasoning_failed': semua jalur gagal.
 */
export type ReasoningOutcome =
  | { outcome: 'resolved' | 'tier'; payload: any; llmCalls: 0 }
  | {
      outcome: 'reasoned';
      result: InterpreterResultV2;
      plannedActs: ActV2[];
      llmCalls: 1 | 2;
      trace: Trace;
    }
  | {
      outcome: 'fallback_reasoning_failed';
      error: string;
      llmCalls: 0 | 1 | 2;
      trace?: Trace;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Helper: LLM call dengan transport retry
// ─────────────────────────────────────────────────────────────────────────────

interface LlmAttemptResult {
  /** Parsed interpreter result, atau null bila gagal (transport/parse error) */
  result: InterpreterResultV2 | null;
  /** Error message bila gagal, null bila sukses */
  error: string | null;
}

interface LlmCallStats {
  calls: number;
}

/**
 * Panggil groqAdapter.generate sekali termasuk retry transport (429/timeout/parse).
 * Retryable error types:
 *   - '429' (rate limit)
 *   - 'timeout' (network timeout)
 *   - 'JSON' (parse error, termasuk dalam pesan SyntaxError Node.js)
 *
 * I8: maksimal TRANSPORT_MAX_RETRIES retry per attempt (bukan validation retry).
 *
 * @param prompt   combined system+user prompt string
 * @param stats    mutable counter — incremented setiap kali generate() dipanggil
 * @returns LlmAttemptResult
 */
async function callLlm(
  prompt: string,
  stats: LlmCallStats
): Promise<LlmAttemptResult> {
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= TRANSPORT_MAX_RETRIES; attempt++) {
    stats.calls++;
    try {
      const resp = await groqAdapter.generate(prompt, {
        temperature: LLM_TEMPERATURE,
        maxTokens: LLM_MAX_TOKENS,
        jsonMode: true,
        intent: LLM_INTENT,
      });
      const parsed = JSON.parse(resp.content) as InterpreterResultV2;
      return { result: parsed, error: null };
    } catch (err) {
      lastError = (err as Error).message;
      const isRetryable =
        lastError.includes('429') ||
        lastError.includes('timeout') ||
        lastError.includes('JSON');
      if (!isRetryable || attempt >= TRANSPORT_MAX_RETRIES) {
        return { result: null, error: lastError };
      }
      // retryable transport/parse error → loop lanjut ke attempt berikutnya
    }
  }

  return { result: null, error: lastError ?? 'exhausted transport retries' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: konversi supersedes positional → act_id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Jika LLM output pakai supersedes sebagai number (positional index),
 * konversi ke act_id string setelah parse, sehingga semua komponen
 * selanjutnya (validator, planner) pakai act_id string.
 *
 * I5: semua referensi pakai act_id, BUKAN index — diterapkan di sini.
 */
export function convertPositionalSupersedes(
  result: InterpreterResultV2
): void {
  if (!result.acts) return;

  const actIds = result.acts.map((a) => a.act_id);

  for (const act of result.acts) {
    // LLM bisa kirim supersedes sebagai number (positional); cast untuk runtime check
    const raw = (act as { supersedes: unknown }).supersedes;
    if (typeof raw === 'number') {
      act.supersedes =
        raw >= 0 && raw < actIds.length ? actIds[raw] : null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: bangun ValidatorContextV2 dari workspace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bangun ValidatorContextV2 dari workspace + catalog.
 * optionsPresented diambil dari entry terakhir di workspace.options_presented.
 */
function buildValidatorContext(
  workspace: WorkspaceV2,
  catalog: CatalogItem[]
): ValidatorContextV2 {
  const optionsPresented =
    workspace.options_presented.length > 0
      ? workspace.options_presented[workspace.options_presented.length - 1]
      : [];

  return {
    optionsPresented,
    catalog,
    pendings: workspace.pendings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point: understand
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orchestrator utama reasoning engine — menggabungkan fast path + LLM + validator + planner.
 *
 * Alur:
 *   A. Fast path (0 LLM): cek pending active + tier deterministik
 *      - hit → return resolved/tier (llmCalls=0)
 *      - miss → lanjut ke B
 *   B. LLM single-pass:
 *      - attempt 1: groqAdapter.generate → parse → validate
 *      - ok → return reasoned (llmCalls=1)
 *      - ok=false, retryable → attempt 2 (with validator feedback)
 *        - ok → return reasoned (llmCalls=2)
 *        - ok=false → fallback (llmCalls=2)
 *      - ok=false, terminal (I-V2-4/I-V2-6) → fallback (llmCalls=1, JANGAN retry)
 *      - transport error → retry sekali, fallback jika gagal (llmCalls=1|2)
 *
 * I8: maksimal 1 LLM call per attempt; fast path = 0 LLM.
 * I10: fast path dan tier result tidak dari LLM.
 *
 * @param message        pesan mentah customer
 * @param workspace      state workspace perpercakapan (v2)
 * @param catalog        katalog produk toko
 * @param history        riwayat conversasi (untuk prompt LLM)
 * @param fallbackService  service tier deterministik (READ-ONLY; typed as any)
 * @param storeId        id toko (diteruskan ke fast path untuk tier call)
 * @param conversationId id percakapan (diteruskan agar tier 'total' membaca
 *                         cart DB yang benar)
 * @returns ReasoningOutcome
 */
export async function understand(
  message: string,
  workspace: WorkspaceV2,
  catalog: CatalogItem[],
  history: HistoryTurn[],
  fallbackService: any,
  storeId: string = '',
  conversationId: string = ''
): Promise<ReasoningOutcome> {
  // ── A. FAST PATH (0 LLM) ─────────────────────────────────────────────────
  // cek fast path DULU sebelum LLM (guard-first)
  const fastResult: FastPathResult = await tryFastPath(
    message,
    workspace,
    catalog,
    fallbackService,
    storeId,
    conversationId
  );

  if (fastResult.hit) {
    // Resolved (pending) atau tier — 0 LLM call
    // I8: tidak ada panggilan LLM di sini
    return {
      outcome: fastResult.outcome,
      payload: fastResult.payload,
      llmCalls: 0,
    };
  }

  // ── B. REASONING (LLM) ───────────────────────────────────────────────────
  // Fast path miss → masuk ke LLM interpreter (Stage 4)
  const trace = newTrace(DEFAULT_CONVERSATION_ID);
  add(trace, 'fast_path_miss', {
    pendingParked: fastResult.pendingParked,
    topicSwitch: fastResult.topicSwitch,
  });

  const systemPrompt = buildSystemPrompt(catalog);
  const userPrompt = buildUserPrompt(message, workspace, history);
  const prompt = `${systemPrompt}\n\n${userPrompt}`;

  const stats: LlmCallStats = { calls: 0 };

  // ── Attempt 1 ────────────────────────────────────────────────────────────
  const attempt1 = await callLlm(prompt, stats);
  add(trace, 'llm_attempt_1', {
    success: attempt1.result !== null,
    error: attempt1.error,
  });

  if (attempt1.result === null) {
    // Transport/parse error setelah retry — langsung fallback
    add(trace, 'fallback', { reason: 'transport/parse_error' });
    return {
      outcome: 'fallback_reasoning_failed',
      error: `LLM call failed: ${attempt1.error}`,
      llmCalls: stats.calls as 0 | 1 | 2,
      trace,
    };
  }

  // Konversi supersedes positional → act_id
  convertPositionalSupersedes(attempt1.result);

  // Validate
  const validatorCtx = buildValidatorContext(workspace, catalog);
  let validation1: ValidatorResultV2;
  try {
    validation1 = validate(attempt1.result, validatorCtx);
  } catch (err) {
    // Validator crash (misal LLM output malformed) — JANGAN biarkan engine crash.
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    // eslint-disable-next-line no-console
    console.error('[validator-v2] validate() attempt 1 threw:', { message: msg, stack });
    add(trace, 'validator_crash', { attempt: 1, error: msg });
    return {
      outcome: 'fallback_reasoning_failed',
      error: `validator error: ${msg}`,
      llmCalls: stats.calls as 0 | 1 | 2,
      trace,
    };
  }
  add(trace, 'validator_ok', {
    ok: validation1.ok,
    retryable: validation1.retryable,
    reasons: validation1.reasons,
  });

  if (validation1.ok) {
    const plannedActs = planActs(attempt1.result.acts ?? []);
    add(trace, 'plan', { actCount: plannedActs.length });
    return {
      outcome: 'reasoned',
      result: attempt1.result,
      plannedActs,
      llmCalls: stats.calls as 1 | 2,
      trace,
    };
  }

  // ok = false
  if (!validation1.retryable) {
    if (validation1.reasons.some((r) => r.includes('I-V2-6'))) {
      add(trace, 'clarification_trigger', { reasons: validation1.reasons });
      return {
        outcome: 'reasoned',
        result: attempt1.result,
        plannedActs: [],
        llmCalls: stats.calls as 1 | 2,
        trace,
      };
    }

    // Terminal (I-V2-4/I-V2-6) → JANGAN retry LLM
    add(trace, 'fallback', {
      reason: 'terminal_validation',
      reasons: validation1.reasons,
    });
    return {
      outcome: 'fallback_reasoning_failed',
      error: validation1.reasons.join('; '),
      llmCalls: stats.calls as 0 | 1 | 2,
      trace,
    };
  }

  // retryable = true → attempt 2 (dengan feedback validator)
  add(trace, 'validator_retry', { reasons: validation1.reasons });
  const retryPrompt =
    `${prompt}\n\n=== FEEDBACK VALIDATOR ===\n${validation1.reasons.join('\n')}\n` +
    `Perbaiki response agar lolos semua aturan (lihat system prompt).`;

  const attempt2 = await callLlm(retryPrompt, stats);
  add(trace, 'llm_attempt_2', {
    success: attempt2.result !== null,
    error: attempt2.error,
  });

  if (attempt2.result === null) {
    add(trace, 'fallback', { reason: 'transport/parse_error_retry' });
    return {
      outcome: 'fallback_reasoning_failed',
      error: `LLM retry call failed: ${attempt2.error}`,
      llmCalls: stats.calls as 0 | 1 | 2,
      trace,
    };
  }

  convertPositionalSupersedes(attempt2.result);
  let validation2: ValidatorResultV2;
  try {
    validation2 = validate(attempt2.result, validatorCtx);
  } catch (err) {
    // Validator crash (misal LLM output malformed) — JANGAN biarkan engine crash.
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    // eslint-disable-next-line no-console
    console.error('[validator-v2] validate() attempt 2 threw:', { message: msg, stack });
    add(trace, 'validator_crash', { attempt: 2, error: msg });
    return {
      outcome: 'fallback_reasoning_failed',
      error: `validator error: ${msg}`,
      llmCalls: stats.calls as 0 | 1 | 2,
      trace,
    };
  }
  add(trace, 'validator_ok', {
    ok: validation2.ok,
    attempt: 2,
    reasons: validation2.reasons,
  });

  if (validation2.ok) {
    const plannedActs = planActs(attempt2.result.acts ?? []);
    add(trace, 'plan', { actCount: plannedActs.length });
    return {
      outcome: 'reasoned',
      result: attempt2.result,
      plannedActs,
      llmCalls: stats.calls as 1 | 2,
      trace,
    };
  }

  // Retry gagal — fallback
  add(trace, 'fallback', {
    reason: 'validation_failed_retry',
    reasons: validation2.reasons,
  });
  return {
    outcome: 'fallback_reasoning_failed',
    error: validation2.reasons.join('; '),
    llmCalls: stats.calls as 0 | 1 | 2,
    trace,
  };
}
