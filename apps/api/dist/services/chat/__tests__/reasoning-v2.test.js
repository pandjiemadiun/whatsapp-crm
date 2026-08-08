/**
 * Unit test — Reasoning Engine (FASE B4 / integrasi)
 * Runner: node:test via tsx (proyek tidak memakai jest).
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/reasoning-v2.test.ts
 *
 * I8: semua test di bawah adalah 0-LLM — groqAdapter.generate DI-MOCK singleton.
 *      fallbackService juga di-stub. Tidak ada panggilan API asli atau DB.
 * I13: nilai ambang (SELECTION_CONFIDENCE_THRESHOLD, CLARIFICATION_MAX_ATTEMPTS)
 *      dibaca dari constant, tidak dikode-kan keras.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { groqAdapter } from '../../../adapters/ai/groq.adapter.js';
import { understand } from '../reasoning.js';
import { ResponseSource } from '../../../domain/types.js';
import { SELECTION_CONFIDENCE_THRESHOLD, } from '../constants-v2.js';
// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────
const CATALOG = [
    { id: '1', name: 'Beras', price: 15000, category: 'makanan' },
    { id: '2', name: 'Gula', price: 8000, category: 'minuman' },
    { id: '3', name: 'Kentang', price: 12000, category: 'makanan' },
];
function makeWorkspace(overrides = {}) {
    return {
        schema_version: '3.2',
        conversation_summary: '',
        pendings: [],
        draft_cart: [],
        resolved_facts: {},
        options_presented: [],
        ...overrides,
    };
}
function makePending(overrides = {}) {
    return {
        id: 'p1',
        question: 'Mau semua?',
        options: ['Beras', 'Gula'],
        status: 'active',
        attempts: 0,
        deferred_turns: 0,
        asked_at: '2026-08-07T00:00:00Z',
        ...overrides,
    };
}
/** Stub fallbackService: selalu kembalikan source tertentu (default HUMAN = miss). */
function makeStubFallback(source = ResponseSource.HUMAN) {
    return {
        getResponse: async (_msg, _ctx) => ({
            source,
            content: 'stub',
            confidence: 0.9,
            cost: 0,
        }),
    };
}
/** Builder untuk InterpreterResultV2 yang valid (lolos semua validator invariants). */
function makeValidResult(overrides = {}) {
    return {
        acts: [
            {
                act_id: 'a1',
                intent: 'cart_update',
                entities: [{ type: 'product', value: 'Beras', confidence: 0.9 }],
                qty: 1,
                qty_source: 'explicit',
                confidence: 0.9,
                supersedes: null,
            },
        ],
        unmatched_mentions: [],
        topic_switch: false,
        draft_cart_ops: [],
        confidence: {
            entities: 0.9,
            intent: 0.9,
            selection: 0.95,
            topic: 0.9,
        },
        summary_update: 'Added Beras to cart',
        ...overrides,
    };
}
/** Builder untuk InterpreterResultV2 yang invalid (retryable): produk tak ada di catalog. */
function makeRetryableResult() {
    return makeValidResult({
        acts: [
            {
                act_id: 'a1',
                intent: 'cart_update',
                entities: [{ type: 'product', value: 'Apel', confidence: 0.9 }],
                qty: 1,
                qty_source: 'explicit',
                confidence: 0.9,
                supersedes: null,
            },
        ],
    });
}
/** Builder untuk InterpreterResultV2 yang terminal (low confidence < threshold). */
function makeTerminalResult() {
    return makeValidResult({
        confidence: {
            entities: 0.9,
            intent: 0.9,
            selection: SELECTION_CONFIDENCE_THRESHOLD - 0.1,
            topic: 0.9,
        },
    });
}
/** Builder untuk hasil dengan supersede positional (number, bukan act_id). */
function makePositionalSupersedesResult() {
    return {
        acts: [
            {
                act_id: 'a1',
                intent: 'cart_update',
                entities: [{ type: 'product', value: 'Beras', confidence: 0.9 }],
                qty: 1,
                qty_source: 'explicit',
                confidence: 0.9,
                supersedes: null,
            },
            {
                act_id: 'a2',
                intent: 'cart_update',
                entities: [{ type: 'product', value: 'Gula', confidence: 0.9 }],
                qty: 1,
                qty_source: 'explicit',
                confidence: 0.9,
                supersedes: 0, // positional index → akan dikonversi ke 'a1'
            },
        ],
        unmatched_mentions: [],
        topic_switch: false,
        draft_cart_ops: [],
        confidence: { entities: 0.9, intent: 0.9, selection: 0.95, topic: 0.9 },
        summary_update: 'Revised to Gula',
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Mock: groqAdapter.generate (singleton stub)
// ─────────────────────────────────────────────────────────────────────────────
let llmCalls = 0;
let lastPrompt = '';
let mockResponses;
let mockThrow;
const originalGenerate = groqAdapter.generate;
const mockGenerate = async (prompt, _options) => {
    llmCalls++;
    lastPrompt = prompt;
    if (mockThrow !== null)
        throw new Error(mockThrow);
    const content = mockResponses.length > 0 ? mockResponses.shift() : '';
    return {
        content,
        provider: 'groq',
        model: 'test-model',
        tokens: { input: 12, output: 8 },
        cost: 0.0001,
    };
};
before(() => {
    groqAdapter.generate = mockGenerate;
});
after(() => {
    groqAdapter.generate = originalGenerate;
});
beforeEach(() => {
    llmCalls = 0;
    lastPrompt = '';
    mockResponses = [];
    mockThrow = null;
});
// ─────────────────────────────────────────────────────────────────────────────
// A. Fast path integrasi (0 LLM)
// ─────────────────────────────────────────────────────────────────────────────
describe('understand — fast path hit (0 LLM) (FASE B4)', () => {
    it('Fast path hit (pending resolved) → outcome=resolved, llmCalls=0', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula'], status: 'active' })],
        });
        mockResponses = [JSON.stringify(makeValidResult())];
        const result = await understand('iya', ws, CATALOG, [], makeStubFallback());
        assert.equal(llmCalls, 0);
        assert.equal(result.outcome, 'resolved');
        if (result.outcome === 'resolved') {
            assert.equal(result.payload.action, 'EXECUTE');
        }
    });
    it('Fast path tier hit (fallback non-HUMAN) → outcome=tier, llmCalls=0', async () => {
        const ws = makeWorkspace({ pendings: [] });
        mockResponses = [JSON.stringify(makeValidResult())];
        const result = await understand('katalog', ws, CATALOG, [], makeStubFallback(ResponseSource.CATALOG));
        assert.equal(llmCalls, 0);
        assert.equal(result.outcome, 'tier');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// B. LLM reasoning + validator
// ─────────────────────────────────────────────────────────────────────────────
describe('understand — LLM reasoning + validator (FASE B4)', () => {
    it('LLM valid + validator ok → reasoned, llmCalls=1', async () => {
        const ws = makeWorkspace({ pendings: [] });
        mockResponses = [JSON.stringify(makeValidResult())];
        const result = await understand('mau beli beras', ws, CATALOG, [], makeStubFallback());
        assert.equal(llmCalls, 1);
        assert.equal(result.outcome, 'reasoned');
        if (result.outcome === 'reasoned') {
            assert.equal(result.result.acts.length, 1);
            assert.deepEqual(result.plannedActs.length, 1);
            assert.ok(result.trace !== undefined);
            assert.ok(result.trace.steps.some((s) => s.step === 'llm_attempt_1'));
            assert.ok(result.trace.steps.some((s) => s.step === 'validator_ok'));
            assert.ok(result.trace.steps.some((s) => s.step === 'plan'));
        }
    });
    it('Validator reject retryable=true + retry ok → reasoned, llmCalls=2', async () => {
        const ws = makeWorkspace({ pendings: [] });
        // Attempt 1: invalid (Apel not in catalog) → retryable
        // Attempt 2: valid → ok
        mockResponses = [
            JSON.stringify(makeRetryableResult()),
            JSON.stringify(makeValidResult()),
        ];
        const result = await understand('mau beli apel', ws, CATALOG, [], makeStubFallback());
        assert.equal(llmCalls, 2);
        assert.equal(result.outcome, 'reasoned');
        if (result.outcome === 'reasoned') {
            assert.ok(result.trace.steps.some((s) => s.step === 'validator_retry'));
            assert.ok(result.trace.steps.some((s) => s.step === 'llm_attempt_2'));
        }
    });
    it('Validator reject retryable=true + retry gagal → fallback, llmCalls=2', async () => {
        const ws = makeWorkspace({ pendings: [] });
        mockResponses = [
            JSON.stringify(makeRetryableResult()),
            JSON.stringify(makeRetryableResult()), // retry juga gagal
        ];
        const result = await understand('mau beli apel', ws, CATALOG, [], makeStubFallback());
        assert.equal(llmCalls, 2);
        assert.equal(result.outcome, 'fallback_reasoning_failed');
        if (result.outcome === 'fallback_reasoning_failed' && result.trace) {
            assert.ok(result.trace !== undefined);
            assert.ok(result.trace.steps.some((s) => s.step === 'fallback'));
        }
    });
    it('Validator reject terminal (low confidence) → fallback, llmCalls=1, JANGAN retry', async () => {
        const ws = makeWorkspace({ pendings: [] });
        mockResponses = [JSON.stringify(makeTerminalResult())];
        const result = await understand('mau beli', ws, CATALOG, [], makeStubFallback());
        assert.equal(llmCalls, 1);
        assert.equal(result.outcome, 'fallback_reasoning_failed');
        // Verifikasi trace menandai terminal, tidak ada llm_attempt_2
        if (result.outcome === 'fallback_reasoning_failed' && result.trace) {
            assert.equal(result.trace.steps.some((s) => s.step === 'llm_attempt_2'), false);
            assert.ok(result.trace.steps.some((s) => s.step === 'fallback'));
        }
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// C. Transport error
// ─────────────────────────────────────────────────────────────────────────────
describe('understand — transport error + retry (FASE B4)', () => {
    it('Transport error (429) → retry sekali → fallback jika 2x gagal, llmCalls=2', async () => {
        const ws = makeWorkspace({ pendings: [] });
        mockThrow = 'Groq 429 Too Many Requests';
        const result = await understand('mau beli beras', ws, CATALOG, [], makeStubFallback());
        assert.equal(llmCalls, 2);
        assert.equal(result.outcome, 'fallback_reasoning_failed');
        if (result.outcome === 'fallback_reasoning_failed') {
            assert.ok(result.error.includes('429'));
        }
    });
    it('Transport error (timeout) → retry sekali → fallback, llmCalls=2', async () => {
        const ws = makeWorkspace({ pendings: [] });
        mockThrow = 'Request timeout: 10000ms exceeded';
        const result = await understand('mau beli beras', ws, CATALOG, [], makeStubFallback());
        assert.equal(llmCalls, 2);
        assert.equal(result.outcome, 'fallback_reasoning_failed');
        if (result.outcome === 'fallback_reasoning_failed') {
            assert.ok(result.error.includes('timeout'));
        }
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// D. Side effects + supersede conversion
// ─────────────────────────────────────────────────────────────────────────────
describe('understand — side effects & konversi (FASE B4)', () => {
    it('Topic switch dari fast path → pending parked di workspace', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula'], status: 'active' })],
        });
        mockResponses = [JSON.stringify(makeValidResult())];
        const result = await understand('ongkir ke jakarta berapa?', ws, CATALOG, [], makeStubFallback());
        // Pending yang tidak match → di-park (status=deferred, deferred_turns naik)
        assert.equal(ws.pendings[0].status, 'deferred');
        assert.equal(ws.pendings[0].deferred_turns, 1);
        // Lanjut ke LLM karena fast path miss
        assert.equal(llmCalls, 1);
        assert.equal(result.outcome, 'reasoned');
    });
    it('supersedes positional→act_id conversion', async () => {
        const ws = makeWorkspace({ pendings: [] });
        const positionalResult = makePositionalSupersedesResult();
        // LLM kirim supersedes sebagai number (0 = positional index → act_id 'a1')
        mockResponses = [JSON.stringify(positionalResult)];
        const result = await understand('eh gajadi gula aja', ws, CATALOG, [], makeStubFallback());
        assert.equal(result.outcome, 'reasoned');
        if (result.outcome === 'reasoned') {
            // Verifikasi konversi: a2.supersedes harus 'a1' (string, bukan 0)
            const a2 = result.result.acts.find((a) => a.act_id === 'a2');
            assert.ok(a2);
            assert.equal(a2?.supersedes, 'a1');
            assert.equal(typeof a2?.supersedes, 'string');
            // planActs: a1 superseded oleh a2 → a1 di-drop, hanya a2 tersisa
            assert.equal(result.plannedActs.length, 1);
            assert.equal(result.plannedActs[0].act_id, 'a2');
        }
    });
});
//# sourceMappingURL=reasoning-v2.test.js.map