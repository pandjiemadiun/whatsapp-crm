/**
 * Unit test — Validator v2 (FASE A2 / validator v3.2)
 * Runner: node:test via tsx (proyek tidak memakai jest).
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/validator-v2.test.ts
 *
 * I8: semua test di bawah adalah 0-LLM — tidak ada panggilan model/DB.
 * I13: semua nilai ambang dibaca dari constant (SELECTION_CONFIDENCE_THRESHOLD), tidak dikode-kan keras.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../validator-v2.js';
import { SELECTION_CONFIDENCE_THRESHOLD, CLARIFICATION_MAX_ATTEMPTS, } from '../constants-v2.js';
// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────
const BASE_CATALOG = [
    { id: '1', name: 'Ayam Goreng', price: 15000, category: 'makanan' },
    { id: '2', name: 'Es Teh', price: 5000, category: 'minuman' },
];
function makeValidResult(overrides = {}) {
    return {
        acts: [],
        unmatched_mentions: [],
        topic_switch: false,
        draft_cart_ops: [],
        confidence: {
            entities: 0.9,
            intent: 0.9,
            selection: SELECTION_CONFIDENCE_THRESHOLD + 0.3,
            topic: 0.9,
        },
        ...overrides,
    };
}
function makeValidCtx(overrides = {}) {
    return {
        optionsPresented: [],
        catalog: BASE_CATALOG,
        pendings: [],
        ...overrides,
    };
}
function makeAct(overrides = {}) {
    return {
        act_id: 'a1',
        intent: 'smalltalk',
        entities: [],
        qty_source: 'default',
        confidence: 0.5,
        supersedes: null,
        ...overrides,
    };
}
function makePending(overrides = {}) {
    return {
        id: 'p1',
        question: 'q',
        options: ['iya', 'tidak'],
        status: 'active',
        attempts: 0,
        deferred_turns: 0,
        asked_at: '2026-08-07T00:00:00Z',
        ...overrides,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Retryable mapping
// ─────────────────────────────────────────────────────────────────────────────
describe('validate — retryable mapping (FASE A2)', () => {
    it('I-V2-4: attempts>CLARIFICATION_MAX_ATTEMPTS -> ok=false, retryable=FALSE (eskalasi)', () => {
        const result = makeValidResult();
        const ctx = makeValidCtx({
            pendings: [
                makePending({ attempts: CLARIFICATION_MAX_ATTEMPTS + 1 }),
            ],
        });
        const v = validate(result, ctx);
        assert.equal(v.ok, false);
        assert.equal(v.retryable, false);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-4')));
    });
    it('I-V2-6: selection confidence < SELECTION_CONFIDENCE_THRESHOLD -> ok=false, retryable=FALSE (clarify)', () => {
        const result = makeValidResult({
            confidence: {
                entities: 0.1,
                intent: 0.1,
                selection: SELECTION_CONFIDENCE_THRESHOLD - 0.05,
                topic: 0.1,
            },
        });
        const v = validate(result, makeValidCtx());
        assert.equal(v.ok, false);
        assert.equal(v.retryable, false);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-6')));
    });
    it('I-V2-1: product mention tak ada di catalog & tidak di unmatched -> ok=false, retryable=TRUE', () => {
        const result = makeValidResult({
            acts: [
                makeAct({
                    act_id: 'x',
                    entities: [{ type: 'product', value: 'Air Putih', confidence: 0.9 }],
                }),
            ],
        });
        const v = validate(result, makeValidCtx());
        assert.equal(v.ok, false);
        assert.equal(v.retryable, true);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-1')));
    });
    it('I-V2-8: dua act cart_update produk sama tanpa supersedes -> retryable=TRUE', () => {
        const a = makeAct({
            act_id: 'c1',
            intent: 'cart_update',
            entities: [{ type: 'product', value: 'Ayam Goreng', confidence: 0.9 }],
        });
        const b = makeAct({
            act_id: 'c2',
            intent: 'cart_update',
            entities: [{ type: 'product', value: 'Ayam Goreng', confidence: 0.9 }],
        });
        const result = makeValidResult({ acts: [a, b] });
        const v = validate(result, makeValidCtx());
        assert.equal(v.retryable, true);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-8')));
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// Ambang dibaca dari constant SELECTION_CONFIDENCE_THRESHOLD
// ─────────────────────────────────────────────────────────────────────────────
describe('validate — ambang dari constant (FASE A2)', () => {
    it('selection tepat di threshold -> tidak reject (I-V2-6 tidak trigger)', () => {
        const result = makeValidResult({
            confidence: {
                entities: 0.9,
                intent: 0.9,
                selection: SELECTION_CONFIDENCE_THRESHOLD,
                topic: 0.9,
            },
        });
        const v = validate(result, makeValidCtx());
        assert.equal(v.ok, true);
    });
    it('selection di bawah threshold (pakai constant) -> reject I-V2-6', () => {
        const result = makeValidResult({
            confidence: {
                entities: 0.9,
                intent: 0.9,
                selection: SELECTION_CONFIDENCE_THRESHOLD - 0.001,
                topic: 0.9,
            },
        });
        const v = validate(result, makeValidCtx());
        assert.equal(v.ok, false);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-6')));
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// Kardinalitas mismatch
// ─────────────────────────────────────────────────────────────────────────────
describe('validate — kardinalitas mismatch (FASE A2)', () => {
    it('"ketiganya" (index 2) options=2 -> mismatch surfaced (I-V2-3)', () => {
        const result = makeValidResult({
            quantifier: {
                resolution_type: 'mismatch',
                resolved_indices: [2],
                mismatch_reason: 'index 2 >= options(2)',
            },
        });
        const ctx = makeValidCtx({ optionsPresented: ['a', 'b'] }); // N=2
        const v = validate(result, ctx);
        assert.equal(v.ok, false);
        assert.equal(v.retryable, true);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-3')));
    });
    it('mismatch tanpa mismatch_reason -> I-V2-3 reason', () => {
        const result = makeValidResult({
            quantifier: {
                resolution_type: 'mismatch',
                resolved_indices: [],
            },
        });
        const v = validate(result, makeValidCtx({ optionsPresented: ['a'] }));
        assert.ok(v.reasons.some((r) => r.includes('I-V2-3')));
        assert.equal(v.retryable, true);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// Unmatched non-kosong tanpa clarification -> reject
// ─────────────────────────────────────────────────────────────────────────────
describe('validate — unmatched tanpa clarification (FASE A2)', () => {
    it('unmatched non-kosong tanpa clarification & tidak di reply_draft -> reject (I-V2-7)', () => {
        const result = makeValidResult({ unmatched_mentions: ['Air Putih'] });
        const v = validate(result, makeValidCtx({ optionsPresented: ['Air Putih', 'Es Teh'] }));
        assert.equal(v.ok, false);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-7')));
        assert.equal(v.retryable, true);
    });
    it('unmatched disebut dalam reply_draft -> tidak reject (I-V2-7 lolos)', () => {
        const result = makeValidResult({
            unmatched_mentions: ['Air Putih'],
            reply_draft: 'maaf, Air Putih tidak ada',
        });
        const v = validate(result, makeValidCtx());
        assert.equal(v.ok, true);
    });
    it('unmatched + clarification ada -> tidak reject (I-V2-7 lolos)', () => {
        const result = makeValidResult({
            unmatched_mentions: ['Air Putih'],
            clarification: {
                question: 'Mau apa?',
                options: ['Ayam Goreng', 'Es Teh'],
                expected_type: 'choice',
            },
        });
        const v = validate(result, makeValidCtx());
        assert.equal(v.ok, true);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// Bonus: I-V2-2 (no silent affirmation), I-V2-5 (supersede integrity), I-V2-9
// ─────────────────────────────────────────────────────────────────────────────
describe('validate — I-V2-2 no silent affirmation (FASE A2)', () => {
    it('affirmative + N>2 + tidak ada quantifier subset -> retryable=TRUE', () => {
        const result = makeValidResult({
            acts: [makeAct({ act_id: 'aff', intent: 'affirmative' })],
        });
        const v = validate(result, makeValidCtx({ optionsPresented: ['a', 'b', 'c'] }));
        assert.equal(v.ok, false);
        assert.equal(v.retryable, true);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-2')));
    });
    it('affirmative + N>2 + quantifier subset -> ok (I-V2-2 tidak trigger)', () => {
        const result = makeValidResult({
            acts: [makeAct({ act_id: 'aff', intent: 'affirmative' })],
            quantifier: { resolution_type: 'subset', resolved_indices: [0, 1] },
        });
        const v = validate(result, makeValidCtx({ optionsPresented: ['a', 'b', 'c'] }));
        assert.equal(v.ok, true);
    });
});
describe('validate — I-V2-5 supersede integrity (FASE A2)', () => {
    it('siklus supersede -> retryable=TRUE', () => {
        const a = makeAct({ act_id: 'a1', supersedes: 'a2' });
        const b = makeAct({ act_id: 'a2', supersedes: 'a1' });
        const v = validate(makeValidResult({ acts: [a, b] }), makeValidCtx());
        assert.equal(v.retryable, true);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-5')));
    });
    it('supersede merujuk id tidak ada -> retryable=TRUE', () => {
        const a = makeAct({ act_id: 'a1', supersedes: 'tidak-ada' });
        const v = validate(makeValidResult({ acts: [a] }), makeValidCtx());
        assert.equal(v.retryable, true);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-5')));
    });
});
describe('validate — I-V2-9 qty/qty_source (FASE A2)', () => {
    it('qty ada tapi qty_source absent -> retryable=TRUE', () => {
        // Simulasi runtime LLM omission: qty_source undefined padahal qty ada.
        const act = makeAct({
            act_id: 'q1',
            intent: 'cart_update',
            entities: [{ type: 'product', value: 'Es Teh', confidence: 0.9 }],
            qty: 2,
            qty_source: undefined,
        });
        const result = makeValidResult({ acts: [act] });
        const v = validate(result, makeValidCtx({ optionsPresented: ['Es Teh'] }));
        assert.ok(v.reasons.some((r) => r.includes('I-V2-9')));
        assert.equal(v.retryable, true);
    });
});
describe('validate — defensive entity value (regresi crash [object Object])', () => {
    it('product entity tanpa value -> TIDAK throw, ditandai invalid (I-V2-1-invalid)', () => {
        // LLM output malformed: product entity meng-omit `value`.
        const act = makeAct({
            act_id: 'nv',
            intent: 'cart_update',
            entities: [
                { type: 'product', value: undefined, confidence: 0.9 },
            ],
        });
        const result = makeValidResult({ acts: [act] });
        // Harusnya TIDAK melempar (dulu: TypeError .value.toLowerCase()).
        let v;
        assert.doesNotThrow(() => {
            v = validate(result, makeValidCtx());
        });
        assert.equal(v.ok, false);
        assert.equal(v.retryable, true);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-1-invalid')));
    });
    it('product entity valid tetap dijaga semantics "no product value left behind"', () => {
        // entity valid, bukan di catalog, bukan unmatched -> tetap I-V2-1 biasa
        const act = makeAct({
            act_id: 'ok',
            entities: [{ type: 'product', value: 'Air Putih', confidence: 0.9 }],
        });
        const v = validate(makeValidResult({ acts: [act] }), makeValidCtx());
        assert.equal(v.retryable, true);
        assert.ok(v.reasons.some((r) => r.includes('I-V2-1')));
        assert.ok(!v.reasons.some((r) => r.includes('I-V2-1-invalid')));
    });
});
//# sourceMappingURL=validator-v2.test.js.map