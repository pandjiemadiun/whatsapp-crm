/**
 * Unit test — Fast Path Deterministic Resolver (FASE B3)
 * Runner: node:test via tsx (proyek tidak memakai jest).
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/fast-path-v2.test.ts
 *
 * I8: semua test di bawah adalah 0-LLM — tidak ada panggilan model/DB.
 *      fallbackService disengaja di-stub agar test bersifat hermetik.
 * I13: nilai ambang (AFFIRMATIVE_MAX_OPTIONS) dibaca dari constant, tidak dikode-kan keras.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tryFastPath } from '../fast-path.js';
import { ResponseSource } from '../../../domain/types.js';
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
/** Stub fallbackService yang selalu mengembalikan source tertentu. */
function makeStubFallback(source) {
    return {
        getResponse: async (_msg, _ctx) => ({
            source,
            content: 'stub',
            confidence: 0.9,
            cost: 0,
        }),
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// A. Pending active — deterministik resolver
// ─────────────────────────────────────────────────────────────────────────────
describe('tryFastPath — pending active resolver (FASE B3)', () => {
    it('Afirmatif (iya) + N=2 opsi → hit, resolved (EXECUTE)', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula'], status: 'active' })],
        });
        const result = await tryFastPath('iya', ws, CATALOG, makeStubFallback(ResponseSource.HUMAN));
        assert.equal(result.hit, true);
        if (result.hit) {
            assert.equal(result.outcome, 'resolved');
            const p = result.payload;
            assert.equal(p.action, 'EXECUTE');
            assert.deepEqual(p.resolvedIndices, [0, 1]);
        }
    });
    it('Afirmatif (ya) + N=3 opsi → miss (bukan fast path), pendingParked', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula', 'Kentang'], status: 'active' })],
        });
        const result = await tryFastPath('ya', ws, CATALOG, makeStubFallback(ResponseSource.HUMAN));
        assert.equal(result.hit, false);
        if (!result.hit) {
            assert.equal(result.pendingParked, true);
            assert.equal(result.topicSwitch, true);
        }
        // Verifikasi pending benar-benar di-park (status=deferred, deferred_turns naik)
        assert.equal(ws.pendings[0].status, 'deferred');
        assert.equal(ws.pendings[0].deferred_turns, 1);
    });
    it('Negasi (gak) → hit, resolved (ROLLBACK)', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula'], status: 'active' })],
        });
        const result = await tryFastPath('gak', ws, CATALOG, makeStubFallback(ResponseSource.HUMAN));
        assert.equal(result.hit, true);
        if (result.hit) {
            assert.equal(result.outcome, 'resolved');
            const p = result.payload;
            assert.equal(p.action, 'ROLLBACK');
        }
    });
    it('Negasi (batal) → hit, resolved (ROLLBACK)', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula'], status: 'active' })],
        });
        const result = await tryFastPath('batal', ws, CATALOG, makeStubFallback(ResponseSource.HUMAN));
        assert.equal(result.hit, true);
        if (result.hit) {
            assert.equal(result.outcome, 'resolved');
            const p = result.payload;
            assert.equal(p.action, 'ROLLBACK');
        }
    });
    it('"dua duanya" + N=2 → hit, resolved (EXECUTE semua)', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula'], status: 'active' })],
        });
        const result = await tryFastPath('dua duanya', ws, CATALOG, makeStubFallback(ResponseSource.HUMAN));
        assert.equal(result.hit, true);
        if (result.hit) {
            assert.equal(result.outcome, 'resolved');
            const p = result.payload;
            assert.equal(p.action, 'EXECUTE');
            assert.deepEqual(p.resolvedIndices, [0, 1]);
        }
    });
    it('"dua duanya" + N=3 → miss, pendingParked', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula', 'Kentang'], status: 'active' })],
        });
        const result = await tryFastPath('dua duanya', ws, CATALOG, makeStubFallback(ResponseSource.HUMAN));
        assert.equal(result.hit, false);
        if (!result.hit) {
            assert.equal(result.pendingParked, true);
        }
    });
    it('"nomor 1" → hit, resolved (index 0)', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula'], status: 'active' })],
        });
        const result = await tryFastPath('nomor 1', ws, CATALOG, makeStubFallback(ResponseSource.HUMAN));
        assert.equal(result.hit, true);
        if (result.hit) {
            assert.equal(result.outcome, 'resolved');
            const p = result.payload;
            assert.equal(p.action, 'EXECUTE');
            assert.deepEqual(p.resolvedIndices, [0]);
        }
    });
    it('"nomor 2" → hit, resolved (index 1)', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula'], status: 'active' })],
        });
        const result = await tryFastPath('nomor 2', ws, CATALOG, makeStubFallback(ResponseSource.HUMAN));
        assert.equal(result.hit, true);
        if (result.hit) {
            assert.equal(result.outcome, 'resolved');
            const p = result.payload;
            assert.deepEqual(p.resolvedIndices, [1]);
        }
    });
    it('Nama produk dari opsi (Beras) → hit, resolved', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula'], status: 'active' })],
        });
        const result = await tryFastPath('mau beli Beras', ws, CATALOG, makeStubFallback(ResponseSource.HUMAN));
        assert.equal(result.hit, true);
        if (result.hit) {
            assert.equal(result.outcome, 'resolved');
            const p = result.payload;
            assert.equal(p.action, 'EXECUTE');
            assert.deepEqual(p.resolvedIndices, [0]);
            assert.deepEqual(p.matchedNames, ['Beras']);
        }
    });
    it('Pesan tidak match + pending active → park pending, topicSwitch=true', async () => {
        const ws = makeWorkspace({
            pendings: [makePending({ options: ['Beras', 'Gula'], status: 'active' })],
        });
        const result = await tryFastPath('pesan baru 123xyz', ws, CATALOG, makeStubFallback(ResponseSource.HUMAN));
        assert.equal(result.hit, false);
        if (!result.hit) {
            assert.equal(result.pendingParked, true);
            assert.equal(result.topicSwitch, true);
        }
        assert.equal(ws.pendings[0].status, 'deferred');
        assert.equal(ws.pendings[0].deferred_turns, 1);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// B. Tier deterministik (tidak ada pending active)
// ─────────────────────────────────────────────────────────────────────────────
describe('tryFastPath — tier deterministik (FASE B3)', () => {
    it('Tier hit (source=CATALOG, non-HUMAN) → hit, tier', async () => {
        const ws = makeWorkspace({ pendings: [] });
        const result = await tryFastPath('katalog', ws, CATALOG, makeStubFallback(ResponseSource.CATALOG));
        assert.equal(result.hit, true);
        if (result.hit) {
            assert.equal(result.outcome, 'tier');
            assert.ok('source' in result.payload);
        }
    });
    it('Tier miss (source=HUMAN) → hit=false, semua field false', async () => {
        const ws = makeWorkspace({ pendings: [] });
        const result = await tryFastPath('pesan tak dikenal', ws, CATALOG, makeStubFallback(ResponseSource.HUMAN));
        assert.equal(result.hit, false);
        if (!result.hit) {
            assert.equal(result.pendingParked, false);
            assert.equal(result.topicSwitch, false);
        }
    });
});
//# sourceMappingURL=fast-path-v2.test.js.map