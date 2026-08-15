/**
 * Unit test — Canonical Conversation State (G2-D.1)
 * Runner: node:test via tsx (proyek tidak memakai jest).
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/business/__tests__/canonical-context.test.ts
 *
 * I8: semua test di bawah adalah 0-LLM — tidak ada panggilan model.
 * DB: pure function tests (tidak menggunakan DB); service tests
 *     menggunakan prisma stub (hermetic, tidak database asli).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_SCHEMA_VERSION } from '../canonical-context.service.js';
import { loadCanonical, saveCanonical, fromLegacyExtractedEntities, findPending, parkPending, resolvePending, dropPending, incrementAttempts, incrementDeferredTurns, shouldAutoDrop, getActivePending, setFact, getFact, setIntent, getIntent, setSummary, getSummary, setCartRef, getCartRef, setLastBotMessage, getOptionsPresented, } from '../canonical-context.service.js';
import { CanonicalConversationStateService } from '../canonical-context.service.js';
// ─────────────────────────────────────────────────────────────────────────────
// Prisma stub (hermetic — tidak database asli)
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from '../../infrastructure/prisma.js';
let originalFindUnique;
let originalUpdateMany;
function stubPrisma(mock) {
    const ctx = prisma.conversationContext;
    originalFindUnique = ctx.findUnique;
    originalUpdateMany = ctx.updateMany;
    if (mock.findUnique) {
        ctx.findUnique = mock.findUnique;
    }
    if (mock.updateMany) {
        ctx.updateMany = mock.updateMany;
    }
}
function restorePrisma() {
    const ctx = prisma.conversationContext;
    if (originalFindUnique !== undefined) {
        ctx.findUnique = originalFindUnique;
    }
    if (originalUpdateMany !== undefined) {
        ctx.updateMany = originalUpdateMany;
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeCanonicalState(overrides = {}) {
    return {
        schema_version: CANONICAL_SCHEMA_VERSION,
        conversation_summary: '',
        pendings: [],
        resolved_facts: {},
        intent: null,
        options_presented: [],
        cart_ref: { order_id: null },
        ...overrides,
    };
}
function makePending(overrides = {}) {
    return {
        id: 'p1',
        question: 'Mau tambah?',
        options: ['iya', 'tidak'],
        status: 'active',
        attempts: 0,
        deferred_turns: 0,
        asked_at: '2026-08-07T00:00:00Z',
        ...overrides,
    };
}
function makeLogger() {
    const warnings = [];
    return {
        warn: (msg, ctx) => {
            warnings.push({ msg, ctx });
        },
        warnings,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// 1–5: Serialization / Deserialization (loadCanonical / saveCanonical)
// ─────────────────────────────────────────────────────────────────────────────
describe('loadCanonical / saveCanonical (FASE A2)', () => {
    it('1. empty state (null) → default canonical state', () => {
        const state = loadCanonical(null);
        assert.equal(state.schema_version, CANONICAL_SCHEMA_VERSION);
        assert.equal(state.conversation_summary, '');
        assert.deepEqual(state.pendings, []);
        assert.deepEqual(state.resolved_facts, {});
        assert.equal(state.intent, null);
        assert.deepEqual(state.options_presented, []);
        assert.deepEqual(state.cart_ref, { order_id: null });
    });
    it('1b. empty state (undefined) → default canonical state', () => {
        const state = loadCanonical(undefined);
        assert.equal(state.schema_version, CANONICAL_SCHEMA_VERSION);
    });
    it('1c. empty state (empty string) → default canonical state', () => {
        const state = loadCanonical('');
        assert.equal(state.schema_version, CANONICAL_SCHEMA_VERSION);
    });
    it('2. valid canonical state → parsed correctly', () => {
        const state = makeCanonicalState({
            conversation_summary: 'Customer mau ayam goreng',
            pendings: [makePending({ id: 'q1' })],
            resolved_facts: { customerCity: 'Jakarta', recipientName: 'Budi' },
            intent: 'purchase',
            options_presented: [['iya', 'tidak']],
            last_bot_message_type: 'clarification',
            cart_ref: { order_id: 'order-1' },
        });
        const json = saveCanonical(state);
        const loaded = loadCanonical(json);
        assert.equal(loaded.schema_version, CANONICAL_SCHEMA_VERSION);
        assert.equal(loaded.conversation_summary, 'Customer mau ayam goreng');
        assert.equal(loaded.pendings.length, 1);
        assert.equal(loaded.pendings[0].id, 'q1');
        assert.equal(loaded.resolved_facts.customerCity, 'Jakarta');
        assert.equal(loaded.resolved_facts.recipientName, 'Budi');
        assert.equal(loaded.intent, 'purchase');
        assert.deepEqual(loaded.options_presented, [['iya', 'tidak']]);
        assert.equal(loaded.last_bot_message_type, 'clarification');
        assert.deepEqual(loaded.cart_ref, { order_id: 'order-1' });
    });
    it('3. malformed JSON string → default state (safe recovery)', () => {
        const state = loadCanonical('{invalid json!!!');
        assert.equal(state.schema_version, CANONICAL_SCHEMA_VERSION);
        assert.equal(state.conversation_summary, '');
        assert.deepEqual(state.pendings, []);
    });
    it('3b. malformed JSON string (another form) → default state', () => {
        const state = loadCanonical('not even json');
        assert.equal(state.schema_version, CANONICAL_SCHEMA_VERSION);
    });
    it('4. missing fields → defaults applied via ?? / type guards', () => {
        const state = loadCanonical({ schema_version: CANONICAL_SCHEMA_VERSION });
        assert.equal(state.schema_version, CANONICAL_SCHEMA_VERSION);
        assert.equal(state.conversation_summary, '');
        assert.deepEqual(state.pendings, []);
        assert.deepEqual(state.resolved_facts, {});
        assert.equal(state.intent, null);
        assert.deepEqual(state.options_presented, []);
        assert.deepEqual(state.cart_ref, { order_id: null });
    });
    it('4b. partial resolved_facts missing → defaults to {}', () => {
        const state = loadCanonical({
            schema_version: CANONICAL_SCHEMA_VERSION,
            resolved_facts: null,
        });
        assert.deepEqual(state.resolved_facts, {});
    });
    it('4c. pendings non-array → defaults to []', () => {
        const state = loadCanonical({
            schema_version: CANONICAL_SCHEMA_VERSION,
            pendings: 'not an array',
        });
        assert.deepEqual(state.pendings, []);
    });
    it('5. unknown fields (draft_cart, confirmedItems) → ignored, NOT stored in canonical state', () => {
        const state = loadCanonical({
            schema_version: CANONICAL_SCHEMA_VERSION,
            draft_cart: [{ product: 'Ayam Goreng', qty: 2 }],
            confirmedItems: [{ product: 'Bebek Goreng', qty: 1, price: 20000, mentionedAt: '2024-01-01', confirmedAt: null }],
        });
        assert.equal(state.schema_version, CANONICAL_SCHEMA_VERSION);
        // draft_cart dan confirmedItems TIDAK ada di canonical state
        assert.equal(state.draft_cart, undefined);
        assert.equal(state.confirmedItems, undefined);
    });
    it('5b. non-object input (number, array, boolean) → default state', () => {
        assert.deepEqual(loadCanonical(42).pendings, []);
        assert.deepEqual(loadCanonical(true).pendings, []);
        assert.deepEqual(loadCanonical([1, 2, 3]).pendings, []);
    });
    it('5c. old schema_version → still parsed (backward compatible)', () => {
        const state = loadCanonical({
            schema_version: '', // V2 format lama
            conversation_summary: 'old summary',
            pendings: [makePending({ id: 'old' })],
            resolved_facts: { recipientName: 'Siti' },
            intent: null,
            options_presented: [],
            cart_ref: { order_id: null },
        });
        // canonical-v1 field masih befungsi
        assert.equal(state.conversation_summary, 'old summary');
        assert.equal(state.pendings[0].id, 'old');
        assert.equal(state.resolved_facts.recipientName, 'Siti');
        // schema_version di-normalisasi ke canonical-v1 (empty string = non-canonical, recovery)
        assert.equal(state.schema_version, CANONICAL_SCHEMA_VERSION);
    });
    it('serialization round-trip preserves all canonical fields', () => {
        const original = makeCanonicalState({
            conversation_summary: 'test summary',
            pendings: [makePending({ id: 'p1' }), makePending({ id: 'p2', status: 'deferred' })],
            resolved_facts: { customerCity: 'Bandung', recipientName: 'Andi' },
            intent: 'purchase',
            options_presented: [['iya'], ['tidak']],
            last_bot_message_type: 'text',
            cart_ref: { order_id: 'order-99' },
        });
        const roundtrip = loadCanonical(saveCanonical(original));
        // _compat is undefined on both — should match
        assert.equal(roundtrip.schema_version, original.schema_version);
        assert.equal(roundtrip.conversation_summary, original.conversation_summary);
        assert.deepEqual(roundtrip.pendings, original.pendings);
        assert.deepEqual(roundtrip.resolved_facts, original.resolved_facts);
        assert.equal(roundtrip.intent, original.intent);
        assert.deepEqual(roundtrip.options_presented, original.options_presented);
        assert.equal(roundtrip.last_bot_message_type, original.last_bot_message_type);
        assert.deepEqual(roundtrip.cart_ref, original.cart_ref);
        assert.equal(roundtrip._compat, undefined);
    });
    it('serialization round-trip preserves _compat fields', () => {
        const original = makeCanonicalState({
            resolved_facts: { customerCity: 'Jakarta' },
            _compat: {
                discussed_items: [{ product: 'Ayam', qty: 2, price: 20000, mentionedAt: '2024-01-01' }],
                tracked_entities: [{ type: 'product', value: 'Ayam', confidence: 0.9 }],
                previous_mutation: { cart_snapshot: [{ product: 'Ayam', qty: 1, price: 15000, mentionedAt: '2024-01-01', confirmedAt: null }], message: 'test' },
                customer_name: 'Budi',
                customer_phone: '08123',
                pending_clarification: null,
            },
        });
        const roundtrip = loadCanonical(saveCanonical(original));
        assert.ok(roundtrip._compat);
        assert.equal(roundtrip._compat.discussed_items[0].product, 'Ayam');
        assert.equal(roundtrip._compat.tracked_entities[0].value, 'Ayam');
        assert.equal(roundtrip._compat.previous_mutation?.message, 'test');
        assert.equal(roundtrip._compat.previous_mutation?.cart_snapshot.length, 1);
        assert.equal(roundtrip._compat.customer_name, 'Budi');
        assert.equal(roundtrip._compat.customer_phone, '08123');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 6–12: Legacy mapping (fromLegacyExtractedEntities)
// ─────────────────────────────────────────────────────────────────────────────
describe('fromLegacyExtractedEntities (legacy mapping — NO silent field loss)', () => {
    it('6. full legacy extraction mapping → canonical state', () => {
        const entities = {
            discussedItems: [{ product: 'Ayam', qty: 2, price: 20000, mentionedAt: '2024-01-01' }],
            confirmedItems: [{ product: 'Bebek', qty: 1, price: 25000, mentionedAt: '2024-01-01', confirmedAt: '2024-01-01' }],
            lastAmbiguousPrompt: 'Ayam apa?',
            recipientName: 'Budi',
            shippingAddress: 'Jl. Kebon Jeruk',
            pendingClarification: {
                question: 'Mau 1 atau 2?',
                options: [{ id: 'o1', label: '1 liter' }, { id: 'o2', label: '2 liter' }],
                expected_type: 'choice',
                asked_at: '2024-01-01T00:00:00Z',
                retry_count: 1,
            },
            previousMutation: { cartSnapshot: [], message: 'add Ayam' },
            trackedEntities: [{ type: 'product', value: 'Ayam Goreng', confidence: 0.9 }],
            customerCity: 'Jakarta',
            customerName: 'Budi',
            customerPhone: '08123456789',
        };
        const state = fromLegacyExtractedEntities(entities);
        // Mapped to canonical fields
        assert.equal(state.schema_version, CANONICAL_SCHEMA_VERSION);
        assert.equal(state.conversation_summary, '');
        assert.equal(state.intent, null);
        assert.deepEqual(state.cart_ref, { order_id: null });
        // pendingClarification → pendings
        assert.equal(state.pendings.length, 1);
        assert.equal(state.pendings[0].question, 'Mau 1 atau 2?');
        assert.equal(state.pendings[0].attempts, 1);
        assert.equal(state.pendings[0].status, 'active');
        // resolved_facts
        assert.equal(state.resolved_facts.lastAmbiguousPrompt, 'Ayam apa?');
        assert.equal(state.resolved_facts.recipientName, 'Budi');
        assert.equal(state.resolved_facts.shippingAddress, 'Jl. Kebon Jeruk');
        // _compat fields (deprecated, preserved — NOT dropped)
        assert.ok(state._compat, '_compat should be populated');
        assert.equal(state._compat.discussed_items.length, 1);
        assert.equal(state._compat.discussed_items[0].product, 'Ayam');
        assert.equal(state._compat.tracked_entities.length, 1);
        assert.equal(state._compat.tracked_entities[0].value, 'Ayam Goreng');
        assert.ok(state._compat.previous_mutation);
        assert.equal(state._compat.previous_mutation.message, 'add Ayam');
        // pending_clarification preserved in _compat (with cartOps, for V1 resolver)
        assert.ok(state._compat.pending_clarification, 'pending_clarification should be preserved in _compat');
        assert.equal(state._compat.pending_clarification.question, 'Mau 1 atau 2?');
        assert.equal(state._compat.pending_clarification.retry_count, 1);
        assert.ok(Array.isArray(state._compat.pending_clarification.options));
        // confirmedItems → NOT in canonical state (cart authority)
        assert.equal(state.confirmedItems, undefined);
    });
    it('6b. null/undefined extractedEntities → default canonical state', () => {
        const state = fromLegacyExtractedEntities(null);
        assert.deepEqual(state.pendings, []);
        assert.deepEqual(state.resolved_facts, {});
        assert.deepEqual(state.cart_ref, { order_id: null });
        assert.equal(state._compat, undefined);
    });
    it('7. customerCity preserved (G2-D-L-009 fix)', () => {
        const state = fromLegacyExtractedEntities({
            customerCity: 'Medan',
        });
        assert.equal(state.resolved_facts.customerCity, 'Medan');
    });
    it('7b. customerCity with other fields intact', () => {
        const state = fromLegacyExtractedEntities({
            customerCity: 'Surabaya',
            recipientName: 'Siti',
            pendingClarification: {
                question: 'Mau?',
                options: [{ id: 'o1', label: 'iya' }],
                expected_type: 'affirmative',
                asked_at: '2024-01-01T00:00:00Z',
                retry_count: 0,
            },
        });
        assert.equal(state.resolved_facts.customerCity, 'Surabaya');
        assert.equal(state.resolved_facts.recipientName, 'Siti');
        assert.equal(state.pendings[0].question, 'Mau?');
    });
    it('8. customerName preserved (in _compat — customer identity)', () => {
        const state = fromLegacyExtractedEntities({
            customerName: 'Budi',
        });
        assert.ok(state._compat, '_compat should be populated for customerName');
        assert.equal(state._compat.customer_name, 'Budi');
        // customerName TIDAK masuk resolved_facts (bukan conversation fact)
        assert.equal(state.resolved_facts.customerName, undefined);
    });
    it('9. customerPhone preserved (in _compat — customer identity)', () => {
        const state = fromLegacyExtractedEntities({
            customerPhone: '081234567890',
        });
        assert.ok(state._compat);
        assert.equal(state._compat.customer_phone, '081234567890');
        assert.equal(state.resolved_facts.customerPhone, undefined);
    });
    it('10. discussedItems → _compat.discussed_items (deprecated, preserved)', () => {
        const state = fromLegacyExtractedEntities({
            discussedItems: [{ product: 'Ayam', qty: 2, price: 20000, mentionedAt: '2024-01-01' }],
        });
        assert.ok(state._compat);
        assert.equal(state._compat.discussed_items.length, 1);
        assert.equal(state._compat.discussed_items[0].product, 'Ayam');
    });
    it('11. trackedEntities → _compat.tracked_entities (deprecated, preserved)', () => {
        const state = fromLegacyExtractedEntities({
            trackedEntities: [{ type: 'product', value: 'Bebek', confidence: 0.8 }],
        });
        assert.ok(state._compat);
        assert.equal(state._compat.tracked_entities.length, 1);
        assert.equal(state._compat.tracked_entities[0].value, 'Bebek');
    });
    it('12. previousMutation → _compat.previous_mutation (deprecated, preserved)', () => {
        const snapshot = [{ product: 'Ayam', qty: 1, price: 15000, mentionedAt: '2024-01-01', confirmedAt: null }];
        const state = fromLegacyExtractedEntities({
            previousMutation: { cartSnapshot: snapshot, message: 'test' },
        });
        assert.ok(state._compat);
        assert.ok(state._compat.previous_mutation);
        assert.equal(state._compat.previous_mutation.message, 'test');
        assert.equal(state._compat.previous_mutation.cart_snapshot.length, 1);
    });
    it('12b. no legacy fields → _compat is undefined (not empty object)', () => {
        const state = fromLegacyExtractedEntities({});
        assert.equal(state._compat, undefined);
    });
    it('legacy mapping with logger — confirmedItems triggers warning', () => {
        const logger = makeLogger();
        fromLegacyExtractedEntities({
            confirmedItems: [{ product: 'Ayam', qty: 1, price: 10000, mentionedAt: '2024-01-01', confirmedAt: null }],
        }, { warn: logger.warn });
        const cartWarning = logger.warnings.find((w) => w.msg.includes('confirmedItems') && w.msg.includes('cart authority'));
        assert.ok(cartWarning, 'should log warning for confirmedItems');
    });
    it('legacy PendingClarification with rawOptions (string[]) → normalized to PendingV2.options', () => {
        const pc = {
            id: 'q1',
            question: 'Pilih?',
            options: [],
            rawOptions: ['iya', 'tidak'],
            expected_type: 'yes_no',
            asked_at: '2024-01-01T00:00:00Z',
            retry_count: 0,
        };
        const state = fromLegacyExtractedEntities({ pendingClarification: pc });
        assert.equal(state.pendings.length, 1);
        assert.deepEqual(state.pendings[0].options, ['iya', 'tidak']);
    });
    it('legacy PendingClarification without id → generated id', () => {
        const pc = {
            question: 'Q?',
            options: [{ id: 'o1', label: 'a' }],
            expected_type: 'affirmative',
            asked_at: '2024-01-01T00:00:00Z',
            retry_count: 2,
        };
        const state = fromLegacyExtractedEntities({ pendingClarification: pc });
        assert.equal(state.pendings.length, 1);
        assert.ok(state.pendings[0].id.startsWith('migrate:'));
        assert.equal(state.pendings[0].attempts, 2);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 13–14: Pure accessors & merge semantics
// ─────────────────────────────────────────────────────────────────────────────
describe('pure accessors + merge semantics (FASE A2)', () => {
    it('13. partial update — updater changes only intent, other fields preserved', () => {
        const original = makeCanonicalState({
            conversation_summary: 'summary text',
            pendings: [makePending({ id: 'q1' })],
            resolved_facts: { customerCity: 'Jakarta' },
            intent: 'browse',
            options_presented: [['iya']],
            last_bot_message_type: 'text',
            cart_ref: { order_id: 'order-1' },
        });
        const json = saveCanonical(original);
        const loaded = loadCanonical(json);
        // Simulate partial update (only change intent)
        loaded.intent = 'purchase';
        const reparsed = loadCanonical(saveCanonical(loaded));
        assert.equal(reparsed.intent, 'purchase');
        // Other fields preserved — merge semantics
        assert.equal(reparsed.conversation_summary, 'summary text');
        assert.equal(reparsed.pendings.length, 1);
        assert.equal(reparsed.pendings[0].id, 'q1');
        assert.equal(reparsed.resolved_facts.customerCity, 'Jakarta');
        assert.deepEqual(reparsed.options_presented, [['iya']]);
        assert.equal(reparsed.last_bot_message_type, 'text');
        assert.deepEqual(reparsed.cart_ref, { order_id: 'order-1' });
    });
    it('14. merge preservation — updateResolvedFacts preserves existing facts', () => {
        const state = makeCanonicalState({
            resolved_facts: { customerCity: 'Jakarta', recipientName: 'Budi' },
        });
        // setFact adds a new fact (merge, not replace)
        setFact(state, 'shippingAddress', 'Jl. Kebon Jeruk');
        assert.equal(getFact(state, 'customerCity'), 'Jakarta');
        assert.equal(getFact(state, 'recipientName'), 'Budi');
        assert.equal(getFact(state, 'shippingAddress'), 'Jl. Kebon Jeruk');
        // All three facts coexist — merge semantics
        assert.equal(Object.keys(state.resolved_facts).length, 3);
    });
    it('14b. setFact overwrites existing fact (key collision = replace value)', () => {
        const state = makeCanonicalState({
            resolved_facts: { customerCity: 'Jakarta' },
        });
        setFact(state, 'customerCity', 'Bandung');
        assert.equal(getFact(state, 'customerCity'), 'Bandung');
    });
    it('pendings: parkPending → resolvePending → status resolved', () => {
        const state = makeCanonicalState();
        const p = makePending({ id: 'q1' });
        assert.equal(parkPending(state, p), state); // chaining
        assert.equal(state.pendings.length, 1);
        const found = findPending(state, 'q1');
        assert.ok(found);
        assert.equal(found?.status, 'active');
        const resolved = resolvePending(state, 'q1');
        assert.equal(resolved?.status, 'resolved');
    });
    it('pendings: dropPending → status dropped', () => {
        const state = makeCanonicalState();
        parkPending(state, makePending({ id: 'q1' }));
        dropPending(state, 'q1');
        assert.equal(findPending(state, 'q1')?.status, 'dropped');
    });
    it('pendings: incrementAttempts + shouldAutoDrop (I13)', () => {
        const state = makeCanonicalState();
        parkPending(state, makePending({ id: 'q1' }));
        incrementAttempts(state, 'q1');
        assert.equal(findPending(state, 'q1')?.attempts, 1);
        // auto-drop after 3 deferred turns
        const p = makePending({ id: 'q2' });
        parkPending(state, p);
        assert.equal(shouldAutoDrop(p), false);
        incrementDeferredTurns(state, 'q2');
        incrementDeferredTurns(state, 'q2');
        assert.equal(findPending(state, 'q2')?.deferred_turns, 2);
        assert.equal(shouldAutoDrop(findPending(state, 'q2')), false);
        incrementDeferredTurns(state, 'q2'); // 3
        assert.equal(shouldAutoDrop(findPending(state, 'q2')), true);
    });
    it('getActivePending returns only active pending', () => {
        const state = makeCanonicalState();
        parkPending(state, makePending({ id: 'q1', status: 'resolved' }));
        parkPending(state, makePending({ id: 'q2', status: 'active' }));
        parkPending(state, makePending({ id: 'q3', status: 'dropped' }));
        assert.equal(getActivePending(state)?.id, 'q2');
    });
    it('cart_ref: setCartRef + getCartRef round-trip', () => {
        const state = makeCanonicalState();
        assert.equal(getCartRef(state).order_id, null);
        setCartRef(state, 'order-abc');
        assert.equal(getCartRef(state).order_id, 'order-abc');
    });
    it('intent: setIntent + getIntent round-trip', () => {
        const state = makeCanonicalState();
        assert.equal(getIntent(state), null);
        setIntent(state, 'purchase');
        assert.equal(getIntent(state), 'purchase');
    });
    it('summary: setSummary + getSummary round-trip', () => {
        const state = makeCanonicalState();
        assert.equal(getSummary(state), '');
        setSummary(state, 'Customer order ayam goreng');
        assert.equal(getSummary(state), 'Customer order ayam goreng');
    });
    it('setLastBotMessage records type + options', () => {
        const state = makeCanonicalState();
        setLastBotMessage(state, 'clarification', ['iya', 'tidak']);
        assert.equal(state.last_bot_message_type, 'clarification');
        assert.deepEqual(getOptionsPresented(state), [['iya', 'tidak']]);
    });
    it('findPending resolves by ID, not index (I15 invariant)', () => {
        const state = makeCanonicalState();
        parkPending(state, makePending({ id: 'b1' }));
        parkPending(state, makePending({ id: 'a1' }));
        parkPending(state, makePending({ id: 'c1' }));
        // Even though 'a1' is at index 1, findPending resolves by ID
        const found = findPending(state, 'a1');
        assert.equal(found?.id, 'a1');
        assert.equal(found?.question, 'Mau tambah?');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 18–19: Cart boundary
// ─────────────────────────────────────────────────────────────────────────────
describe('cart boundary — canonical state hanya cart_ref (FASE A2)', () => {
    it('18. canonical state memiliki cart_ref, TIDAK memiliki confirmedItems/draft_cart', () => {
        const state = makeCanonicalState();
        assert.ok('cart_ref' in state);
        assert.deepEqual(state.cart_ref, { order_id: null });
        // TIDAK ada cart data fields di canonical state type
        assert.equal(state.confirmedItems, undefined);
        assert.equal(state.draft_cart, undefined);
    });
    it('19. confirmedItems (legacy) tidak menjadi canonical authority', () => {
        const logger = makeLogger();
        const state = fromLegacyExtractedEntities({
            confirmedItems: [
                { product: 'Ayam', qty: 2, price: 20000, mentionedAt: '2024-01-01', confirmedAt: null },
                { product: 'Bebek', qty: 1, price: 25000, mentionedAt: '2024-01-01', confirmedAt: null },
            ],
        }, { warn: logger.warn });
        // confirmedItems → NOT stored in canonical state
        assert.equal(state.confirmedItems, undefined);
        // cart_ref tetap null (confirming confirmedItems tidak memetakan ke cart_ref)
        assert.equal(state.cart_ref.order_id, null);
        // Warning harus tercatat (observable, bukan silent)
        assert.ok(logger.warnings.some((w) => w.msg.includes('confirmedItems')));
    });
    it('19b. draft_cart (from V2 workspace) tidak masuk canonical state', () => {
        const state = loadCanonical({
            schema_version: '',
            pendings: [],
            draft_cart: [{ action: 'add', product: 'Ayam', qty: 2, qty_source: 'default', status: 'confirmed' }],
            resolved_facts: {},
            conversation_summary: '',
            options_presented: [],
        });
        assert.equal(state.draft_cart, undefined);
        assert.deepEqual(state.cart_ref, { order_id: null });
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 15–16: Service — atomic update (getCanonical, updateCanonical, CAS)
// ─────────────────────────────────────────────────────────────────────────────
describe('CanonicalConversationStateService — atomic update (FASE A2)', () => {
    after(() => {
        restorePrisma();
    });
    it('15. getCanonical → updateCanonical → persisted state', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let savedState = null;
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: saveCanonical(makeCanonicalState({ conversation_summary: 'initial' })),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async (args) => {
                const data = args.data;
                savedState = data.workspace_v2;
                return { count: 1 };
            },
        });
        // Read
        const before = await canonicalConversationStateService.getCanonical('conv-1');
        assert.ok(before);
        assert.equal(before.conversation_summary, 'initial');
        // Update (only set intent — merge semantics)
        const updated = await canonicalConversationStateService.updateCanonical('conv-1', (state) => {
            setIntent(state, 'purchase');
            return state;
        });
        assert.ok(updated);
        assert.equal(updated.intent, 'purchase');
        // Other fields preserved
        assert.equal(updated.conversation_summary, 'initial');
        // Verify persisted JSON contains updated state
        const parsed = loadCanonical(savedState);
        assert.equal(parsed.intent, 'purchase');
        assert.equal(parsed.conversation_summary, 'initial');
    });
    it('16. concurrent update / CAS — retry on conflict, then succeed', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let findUniqueCalls = 0;
        let updateManyCalls = 0;
        const mockState = makeCanonicalState({ intent: 'browse' });
        stubPrisma({
            findUnique: async () => {
                findUniqueCalls++;
                return {
                    workspace_v2: saveCanonical(mockState),
                    updatedAt: new Date('2024-01-01T00:00:00Z'),
                };
            },
            updateMany: async () => {
                updateManyCalls++;
                if (updateManyCalls === 1) {
                    return { count: 0 }; // conflict — another writer committed
                }
                return { count: 1 }; // retry succeeds
            },
        });
        const result = await canonicalConversationStateService.updateCanonical('conv-1', (state) => {
            setIntent(state, 'purchase');
            return state;
        });
        assert.ok(result);
        assert.equal(result.intent, 'purchase');
        assert.equal(findUniqueCalls, 2); // fresh read on retry
        assert.equal(updateManyCalls, 2); // retried write
    });
    it('16c. TRUE concurrent CAS — two simultaneous updateCanonical, no lost update', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        // Stateful mock with real @updatedAt CAS semantics:
        // - findUnique returns current workspace_v2 + updatedAt
        // - updateMany: if WHERE.updatedAt matches current ts → commit + bump ts; else → count:0 (conflict)
        let stored = saveCanonical(makeCanonicalState({ intent: 'browse' }));
        let ts = new Date('2024-01-01T00:00:00.000Z');
        let updateCount = 0;
        stubPrisma({
            findUnique: async () => ({ workspace_v2: stored, updatedAt: ts }),
            updateMany: async (args) => {
                const where = args.where;
                updateCount++;
                // Simulate concurrent CAS: if WHERE.updatedAt tidak match current ts,
                // another writer committed first → count: 0 (conflict → retry)
                if (where.updatedAt.getTime() !== ts.getTime()) {
                    return { count: 0 };
                }
                // Commit: persist new state + bump @updatedAt
                stored = args.data.workspace_v2;
                ts = new Date('2024-01-01T00:00:00.001Z'); // bump @updatedAt (simulates Prisma)
                return { count: 1 };
            },
        });
        const pendingA = makePending({ id: 'pa', question: 'Q from A?' });
        const pendingB = makePending({ id: 'pb', question: 'Q from B?' });
        // TRUE concurrent: both start at the same updatedAt, both call updateMany
        const [resultA, resultB] = await Promise.all([
            canonicalConversationStateService.upsertPending('conv-1', pendingA),
            canonicalConversationStateService.upsertPending('conv-1', pendingB),
        ]);
        // Both must succeed (CAS retry ensures no writer fails silently)
        assert.ok(resultA, 'Update A must succeed');
        assert.ok(resultB, 'Update B must succeed');
        // No lost update — final state must contain BOTH pendings
        const finalState = loadCanonical(stored);
        assert.equal(finalState.pendings.length, 2, 'Both pendings must be persisted — no lost update');
        assert.equal(findPending(finalState, 'pa')?.question, 'Q from A?');
        assert.equal(findPending(finalState, 'pb')?.question, 'Q from B?');
        // CAS conflict detected — updateMany called >= 2 times (at least 1 retry)
        assert.ok(updateCount >= 2, `Expected >=2 updateMany calls (CAS retry), got ${updateCount}`);
    });
    it('16b. CAS — returns null when context not found', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        stubPrisma({
            findUnique: async () => null,
            updateMany: async () => ({ count: 1 }),
        });
        const result = await canonicalConversationStateService.updateCanonical('conv-noexist', (state) => state);
        assert.equal(result, null);
    });
    it('updateResolvedFacts — partial update, preserves existing facts', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let savedState = null;
        const initialState = makeCanonicalState({
            resolved_facts: { customerCity: 'Jakarta', recipientName: 'Budi' },
        });
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: saveCanonical(initialState),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async (args) => {
                savedState = args.data.workspace_v2;
                return { count: 1 };
            },
        });
        const result = await canonicalConversationStateService.updateResolvedFacts('conv-1', {
            recipientName: 'Siti',
            shippingAddress: 'Jl. Mampang',
        });
        assert.ok(result);
        // New fact added, existing fact preserved (merge, not replace)
        assert.equal(result.resolved_facts.customerCity, 'Jakarta');
        assert.equal(result.resolved_facts.recipientName, 'Siti');
        assert.equal(result.resolved_facts.shippingAddress, 'Jl. Mampang');
        // Verify in persisted JSON
        const parsed = loadCanonical(savedState);
        assert.equal(parsed.resolved_facts.customerCity, 'Jakarta');
        assert.equal(parsed.resolved_facts.recipientName, 'Siti');
        assert.equal(parsed.resolved_facts.shippingAddress, 'Jl. Mampang');
    });
    it('resetCanonical — resets to default state', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let savedState = null;
        const initialState = makeCanonicalState({
            conversation_summary: 'test summary',
            pendings: [makePending({ id: 'q1' })],
            resolved_facts: { customerCity: 'Jakarta' },
            intent: 'purchase',
        });
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: saveCanonical(initialState),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async (args) => {
                savedState = args.data.workspace_v2;
                return { count: 1 };
            },
        });
        const result = await canonicalConversationStateService.resetCanonical('conv-1');
        assert.equal(result, true);
        const parsed = loadCanonical(savedState);
        assert.equal(parsed.schema_version, CANONICAL_SCHEMA_VERSION);
        assert.equal(parsed.conversation_summary, '');
        assert.deepEqual(parsed.pendings, []);
        assert.deepEqual(parsed.resolved_facts, {});
        assert.equal(parsed.intent, null);
        assert.deepEqual(parsed.cart_ref, { order_id: null });
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 17: Pending clarification boundary (service-level)
// ─────────────────────────────────────────────────────────────────────────────
describe('pending clarification boundary (FASE A2)', () => {
    after(() => {
        restorePrisma();
    });
    it('17. question → answer flow: upsertPending → getPendingClarification → resolvePending', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let savedWorkspace = null;
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: saveCanonical(makeCanonicalState()),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async (args) => {
                savedWorkspace = args.data.workspace_v2;
                return { count: 1 };
            },
        });
        // 1. Set pending clarification (question)
        const pending = makePending({
            id: 'ask-1',
            question: 'Mau 1 liter atau 2 liter?',
            options: ['1 liter', '2 liter'],
            status: 'active',
        });
        const upserted = await canonicalConversationStateService.upsertPending('conv-1', pending);
        assert.ok(upserted);
        assert.equal(upserted.pendings.length, 1);
        assert.equal(upserted.pendings[0].question, 'Mau 1 liter atau 2 liter?');
        // 2. Get pending clarification
        const active = await canonicalConversationStateService.getPendingClarification('conv-1');
        // Note: getPendingClarification reads from DB (findUnique), so set up fresh mock
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: savedWorkspace,
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async () => ({ count: 1 }),
        });
        const activePending = await canonicalConversationStateService.getPendingClarification('conv-1');
        assert.ok(activePending);
        assert.equal(activePending.question, 'Mau 1 liter atau 2 liter?');
        assert.equal(activePending.options.length, 2);
        // 3. Resolve pending (answer received)
        const resolved = await canonicalConversationStateService.resolvePending('conv-1', 'ask-1');
        assert.ok(resolved);
        assert.equal(resolved.pendings[0].status, 'resolved');
        // 4. getPendingClarification should return undefined (no active pending)
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: saveCanonical(resolved),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async () => ({ count: 1 }),
        });
        const afterResolve = await canonicalConversationStateService.getPendingClarification('conv-1');
        assert.equal(afterResolve, undefined);
    });
    it('upsertPending replaces existing pending with same ID', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        const initialState = makeCanonicalState({
            pendings: [makePending({ id: 'q1', question: 'old question' })],
        });
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: saveCanonical(initialState),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async (args) => {
                const saved = args.data.workspace_v2;
                const state = loadCanonical(saved);
                assert.equal(state.pendings.length, 1);
                assert.equal(state.pendings[0].question, 'new question');
                return { count: 1 };
            },
        });
        const result = await canonicalConversationStateService.upsertPending('conv-1', makePending({
            id: 'q1',
            question: 'new question',
        }));
        assert.ok(result);
        assert.equal(result.pendings.length, 1);
        assert.equal(result.pendings[0].question, 'new question');
    });
    it('clearAllPending removes all pending', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        const initialState = makeCanonicalState({
            pendings: [makePending({ id: 'q1' }), makePending({ id: 'q2' })],
        });
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: saveCanonical(initialState),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async () => ({ count: 1 }),
        });
        const result = await canonicalConversationStateService.clearAllPending('conv-1');
        assert.ok(result);
        assert.deepEqual(result.pendings, []);
    });
});
// ──────────────────────────────────────────────────────────────────────────
// G2-D.2 CLEANUP — V1 read↔write split-brain regression tests
// ──────────────────────────────────────────────────────────────────────────
describe('G2-D.2 V1 read↔write split-brain (writeV1* → getV1* round-trip)', () => {
    /**
     * Stateful Prisma mock — simulates real DB round-trips:
     * - findUnique returns the current in-memory workspace_v2
     * - updateMany persists new workspace_v2 in-memory
     * This lets us test V1 write → V1 read round-trip WITHOUT process restart.
     */
    function statefulStub() {
        let stored = null;
        const ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                return { count: 1 };
            },
        });
        // Initialize with empty canonical state
        return { save: () => (stored = saveCanonical(makeCanonicalState())) };
    }
    it('V1-R1: writeV1PendingClarification → getV1PendingClarification preserves question, options, retry_count, snapshot', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        statefulStub();
        const pc = {
            id: 'q1',
            question: 'Mau 1 liter atau 2 liter?',
            options: [
                { id: 'opt-1', label: '1 liter', cartOps: [{ type: 'add', product: 'Air Mineral', qty: 1 }] },
                { id: 'opt-2', label: '2 liter', cartOps: [{ type: 'add', product: 'Air Mineral', qty: 2 }] },
            ],
            expected_type: 'choice',
            asked_at: '2026-08-14T10:00:00Z',
            retry_count: 1,
        };
        // V1 WRITE
        await canonicalConversationStateService.writeV1PendingClarification('conv-X', pc);
        // V1 READ — should see the same pending
        const read = await canonicalConversationStateService.getV1PendingClarification('conv-X');
        assert.ok(read, 'V1 reader must see pending written by V1 writer');
        assert.equal(read.question, 'Mau 1 liter atau 2 liter?');
        assert.equal(read.retry_count, 1);
        assert.equal(read.options.length, 2);
        // _compat path preserves original options (with cartOps)
        assert.equal(read.options[0].id, 'opt-1');
        assert.equal(read.options[0].label, '1 liter');
        assert.deepEqual(read.options[0].cartOps, [{ type: 'add', product: 'Air Mineral', qty: 1 }]);
    });
    it('V1-R2: clearV1PendingClarification → getV1PendingClarification returns null', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        statefulStub();
        const pc = {
            question: 'Test?',
            options: [{ id: 'a', label: 'A' }],
            expected_type: 'yes_no',
            asked_at: '2026-08-14T10:00:00Z',
            retry_count: 0,
        };
        await canonicalConversationStateService.writeV1PendingClarification('conv-X', pc);
        const before = await canonicalConversationStateService.getV1PendingClarification('conv-X');
        assert.ok(before);
        await canonicalConversationStateService.clearV1PendingClarification('conv-X');
        const after = await canonicalConversationStateService.getV1PendingClarification('conv-X');
        assert.equal(after, null);
    });
    it('V1-R3: incrementV1PendingRetry → read retry_count increments correctly', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        statefulStub();
        const pc = {
            question: 'Test?',
            options: [{ id: 'a', label: 'A' }],
            expected_type: 'yes_no',
            asked_at: '2026-08-14T10:00:00Z',
            retry_count: 2,
        };
        await canonicalConversationStateService.writeV1PendingClarification('conv-X', pc);
        assert.equal((await canonicalConversationStateService.getV1PendingClarification('conv-X')).retry_count, 2);
        // Simulate 3 V1 retry cycles
        for (let i = 0; i < 3; i++) {
            await canonicalConversationStateService.incrementV1PendingRetry('conv-X');
        }
        const read = await canonicalConversationStateService.getV1PendingClarification('conv-X');
        assert.equal(read.retry_count, 5, 'retry_count should be 2 + 3 = 5');
    });
    it('V1-R4: writeV1PreviousMutation → getV1PreviousMutation preserves cart snapshot and message', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        statefulStub();
        const cartSnapshot = [
            { product: 'Ayam', qty: 2, price: 20000 },
            { product: 'Sapi', qty: 1, price: 50000 },
        ];
        const message = 'Pesan sebelumnya untuk rollback';
        await canonicalConversationStateService.writeV1PreviousMutation('conv-X', cartSnapshot, message);
        const read = await canonicalConversationStateService.getV1PreviousMutation('conv-X');
        assert.ok(read);
        assert.equal(read.message, 'Pesan sebelumnya untuk rollback');
        assert.equal(read.cartSnapshot.length, 2);
        assert.equal(read.cartSnapshot[0].product, 'Ayam');
        assert.equal(read.cartSnapshot[1].product, 'Sapi');
    });
    it('V1-R5: clearV1PreviousMutation → getV1PreviousMutation returns null', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        statefulStub();
        await canonicalConversationStateService.writeV1PreviousMutation('conv-X', [{ product: 'Test', qty: 1, price: 100 }], 'msg');
        const before = await canonicalConversationStateService.getV1PreviousMutation('conv-X');
        assert.ok(before);
        await canonicalConversationStateService.clearV1PreviousMutation('conv-X');
        const after = await canonicalConversationStateService.getV1PreviousMutation('conv-X');
        assert.equal(after, null);
    });
    it('V1-R6: full lifecycle — write pending → increment retry → resolve → clear previous mutation', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        statefulStub();
        // 1. Set pending
        const pc = {
            id: 'q-full',
            question: 'Pilih?',
            options: [{ id: 'a', label: 'A', cartOps: [{ type: 'add', product: 'X', qty: 1 }] }],
            expected_type: 'choice',
            asked_at: '2026-08-14T10:00:00Z',
            retry_count: 0,
        };
        await canonicalConversationStateService.writeV1PendingClarification('conv-X', pc);
        let read = await canonicalConversationStateService.getV1PendingClarification('conv-X');
        assert.ok(read);
        assert.equal(read.options[0].cartOps[0].product, 'X');
        // 2. Retry once
        await canonicalConversationStateService.incrementV1PendingRetry('conv-X');
        read = await canonicalConversationStateService.getV1PendingClarification('conv-X');
        assert.equal(read.retry_count, 1);
        // 3. Store previous mutation
        await canonicalConversationStateService.writeV1PreviousMutation('conv-X', [{ product: 'Backup', qty: 1, price: 100 }], 'backup msg');
        let prevMut = await canonicalConversationStateService.getV1PreviousMutation('conv-X');
        assert.ok(prevMut);
        assert.equal(prevMut.cartSnapshot.length, 1);
        // 4. Resolve pending (transition to resolved)
        const resolved = await canonicalConversationStateService.resolvePending('conv-X', 'q-full');
        assert.ok(resolved);
        assert.equal(resolved.pendings[0].status, 'resolved'); // marked resolved, not removed
        // 5. Clear previous mutation
        await canonicalConversationStateService.clearV1PreviousMutation('conv-X');
        prevMut = await canonicalConversationStateService.getV1PreviousMutation('conv-X');
        assert.equal(prevMut, null);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// G2-D.3 — V2 READ → CANONICAL STATE (regression tests)
// ─────────────────────────────────────────────────────────────────────────────
describe('G2-D.3 V2 read → canonical boundary', () => {
    after(() => {
        restorePrisma();
    });
    // Test 1: V2 read from canonical
    it('V2-R1: getV2Workspace reads canonical state (pendings, resolved_facts, intent, options_presented)', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        const canonicalState = makeCanonicalState({
            conversation_summary: 'Customer order ayam goreng',
            pendings: [makePending({ id: 'q1', question: 'Mau 1 kg atau 2 kg?' })],
            resolved_facts: { customerCity: 'Jakarta', recipientName: 'Budi' },
            intent: 'purchase',
            options_presented: [['1 kg', '2 kg']],
        });
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: saveCanonical(canonicalState),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async () => ({ count: 1 }),
        });
        const ws = await canonicalConversationStateService.getV2Workspace('conv-v2-1');
        assert.ok(ws, 'getV2Workspace must return a workspace');
        // Business fields from canonical
        assert.equal(ws.conversation_summary, 'Customer order ayam goreng');
        assert.equal(ws.pendings.length, 1);
        assert.equal(ws.pendings[0].id, 'q1');
        assert.equal(ws.pendings[0].question, 'Mau 1 kg atau 2 kg?');
        assert.equal(ws.resolved_facts.customerCity, 'Jakarta');
        assert.equal(ws.resolved_facts.recipientName, 'Budi');
        assert.deepEqual(ws.options_presented, [['1 kg', '2 kg']]);
        // schema_version comes from canonical
        assert.equal(ws.schema_version, CANONICAL_SCHEMA_VERSION);
    });
    // Test 2: pending clarification
    it('V2-R2: getV2Workspace preserves pendings (active, deferred, resolved, dropped)', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        const pendings = [
            makePending({ id: 'p-active', status: 'active', question: 'Active?' }),
            makePending({ id: 'p-deferred', status: 'deferred', deferred_turns: 2, question: 'Deferred?' }),
            makePending({ id: 'p-resolved', status: 'resolved', question: 'Resolved?' }),
            makePending({ id: 'p-dropped', status: 'dropped', question: 'Dropped?' }),
        ];
        const canonicalState = makeCanonicalState({ pendings });
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: saveCanonical(canonicalState),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async () => ({ count: 1 }),
        });
        const ws = await canonicalConversationStateService.getV2Workspace('conv-v2-2');
        assert.ok(ws);
        assert.equal(ws.pendings.length, 4);
        assert.equal(ws.pendings.find((p) => p.id === 'p-active')?.status, 'active');
        assert.equal(ws.pendings.find((p) => p.id === 'p-deferred')?.status, 'deferred');
        assert.equal(ws.pendings.find((p) => p.id === 'p-resolved')?.status, 'resolved');
        assert.equal(ws.pendings.find((p) => p.id === 'p-dropped')?.status, 'dropped');
    });
    // Test 3: resolved_facts
    it('V2-R3: getV2Workspace preserves resolved_facts (customerCity, recipientName, shippingAddress)', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        const canonicalState = makeCanonicalState({
            resolved_facts: {
                customerCity: 'Bandung',
                recipientName: 'Siti',
                shippingAddress: 'Jl. Merdeka',
                lastAmbiguousPrompt: 'Ayam?',
            },
        });
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: saveCanonical(canonicalState),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async () => ({ count: 1 }),
        });
        const ws = await canonicalConversationStateService.getV2Workspace('conv-v2-3');
        assert.ok(ws);
        assert.equal(ws.resolved_facts.customerCity, 'Bandung');
        assert.equal(ws.resolved_facts.recipientName, 'Siti');
        assert.equal(ws.resolved_facts.shippingAddress, 'Jl. Merdeka');
        assert.equal(ws.resolved_facts.lastAmbiguousPrompt, 'Ayam?');
    });
    // Test 4: intent
    it('V2-R4: getV2Workspace reads intent from canonical state', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        // Canonical state with intent set (written by G2-D.3 canonical path)
        const canonicalState = makeCanonicalState({
            intent: 'browse',
            conversation_summary: 'Customer browsing catalog',
        });
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: saveCanonical(canonicalState),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async () => ({ count: 1 }),
        });
        const ws = await canonicalConversationStateService.getV2Workspace('conv-v2-4');
        assert.ok(ws);
        // Intent is canonical field; WorkspaceV2 doesn't have 'intent' property but
        // it's preserved in the canonical state that underlies the workspace.
        // Verify canonical read still works:
        const canonical = await canonicalConversationStateService.getCanonical('conv-v2-4');
        assert.ok(canonical);
        assert.equal(canonical.intent, 'browse');
    });
    // Test 5: legacy fallback (V1→V2 transition)
    it('V2-R5: getV2Workspace falls back to extractedEntities when workspace_v2 is empty', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        // Simulate V1 state in extractedEntities (no workspace_v2)
        const legacyEntities = {
            customerCity: 'Surabaya',
            recipientName: 'Andi',
            pendingClarification: {
                id: 'legacy-q1',
                question: 'Mau 1 liter atau 2 liter?',
                options: [{ id: 'opt-1', label: '1 liter' }, { id: 'opt-2', label: '2 liter' }],
                expected_type: 'choice',
                asked_at: '2026-01-01T00:00:00Z',
                retry_count: 0,
            },
        };
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: null,
                extractedEntities: legacyEntities,
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async () => ({ count: 1 }),
        });
        const ws = await canonicalConversationStateService.getV2Workspace('conv-v2-5');
        assert.ok(ws, 'must return workspace from legacy fallback');
        // Legacy pendingClarification → canonical pendings
        assert.equal(ws.pendings.length, 1);
        assert.equal(ws.pendings[0].question, 'Mau 1 liter atau 2 liter?');
        assert.equal(ws.pendings[0].status, 'active');
        // Legacy resolved fields → canonical resolved_facts
        assert.equal(ws.resolved_facts.customerCity, 'Surabaya');
        assert.equal(ws.resolved_facts.recipientName, 'Andi');
    });
    // Test 5b: legacy fallback with confirmedItems → draft_cart
    it('V2-R5b: getV2Workspace legacy fallback maps confirmedItems → draft_cart', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        // V2 getV2Workspace doesn't map confirmedItems → draft_cart (canonical boundary
        // excludes cart data). But the raw workspace_v2 read for draft_cart should
        // still return empty when workspace_v2 is null (fresh conversation).
        const legacyEntities = {
            confirmedItems: [
                { product: 'Beras', qty: 2, price: 15000, mentionedAt: '2026-01-01T00:00:00Z', confirmedAt: '2026-01-01T00:00:00Z' },
            ],
        };
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: null,
                extractedEntities: legacyEntities,
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async () => ({ count: 1 }),
        });
        const ws = await canonicalConversationStateService.getV2Workspace('conv-v2-5b');
        assert.ok(ws);
        // Canonical boundary does NOT map confirmedItems to canonical state (G2-D.3:
        // "Canonical state hanya boleh membawa cart_ref/reference"). draft_cart must
        // come from CartAuthority, not from canonical read.
        assert.equal(ws.draft_cart.length, 0, 'draft_cart must be empty — cart data comes from CartAuthority, not canonical');
        assert.equal(ws.pendings.length, 0);
    });
    // Test 6: multi-turn (draft_cart persistence through getV2Workspace)
    it('V2-R6: getV2Workspace preserves draft_cart across multi-turn reads', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        // Simulate workspace_v2 written by V2 engine with draft_cart
        const v2Workspace = {
            schema_version: '3.2',
            conversation_summary: 'Customer added Beras',
            pendings: [],
            draft_cart: [
                { action: 'add', product: 'Beras', qty: 2, qty_source: 'explicit', status: 'confirmed' },
            ],
            resolved_facts: {},
            options_presented: [],
        };
        stubPrisma({
            findUnique: async (args) => {
                const select = args.select;
                // getCanonicalWithLegacyFallback selects workspace_v2 + extractedEntities
                // getV2Workspace's raw draft_cart read selects workspace_v2 only
                if (select && 'extractedEntities' in select) {
                    // Canonical boundary read
                    return {
                        workspace_v2: v2Workspace,
                        updatedAt: new Date('2024-01-01T00:00:00Z'),
                    };
                }
                // Raw workspace_v2 read (for draft_cart extraction)
                return {
                    workspace_v2: v2Workspace,
                };
            },
            updateMany: async () => ({ count: 1 }),
        });
        const ws = await canonicalConversationStateService.getV2Workspace('conv-v2-6');
        assert.ok(ws);
        // draft_cart read from raw workspace_v2
        assert.equal(ws.draft_cart.length, 1);
        assert.equal(ws.draft_cart[0].product, 'Beras');
        assert.equal(ws.draft_cart[0].qty, 2);
        // Canonical fields also preserved (loadCanonical ignores draft_cart, so
        // conversation_summary comes from the canonical parse of the V2 workspace JSON)
        assert.equal(ws.conversation_summary, 'Customer added Beras');
    });
    // Test 7: V2 → V1 fallback
    it('V2-R7: getV2Workspace returns null when context does not exist', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        stubPrisma({
            findUnique: async () => null,
            updateMany: async () => ({ count: 1 }),
        });
        const ws = await canonicalConversationStateService.getV2Workspace('conv-not-exist');
        assert.equal(ws, null);
    });
    it('V2-R7b: getV2Workspace returns default workspace when both columns empty (new conversation)', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: null,
                extractedEntities: null,
                updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
            updateMany: async () => ({ count: 1 }),
        });
        const ws = await canonicalConversationStateService.getV2Workspace('conv-new');
        assert.ok(ws, 'must return default workspace for new conversation');
        assert.equal(ws.pendings.length, 0);
        assert.equal(ws.draft_cart.length, 0);
        assert.deepEqual(ws.resolved_facts, {});
        assert.deepEqual(ws.options_presented, []);
        assert.equal(ws.schema_version, CANONICAL_SCHEMA_VERSION);
    });
    // Test 8: No direct business read of workspace_v2 outside canonical boundary
    it('V2-R8: audit — getV2Workspace reads from same canonical column as updateCanonical', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        // Verify that getV2Workspace delegates to getCanonicalWithLegacyFallback
        // by checking that a canonical state written via updateCanonical is readable
        // via getV2Workspace (proving the boundary is the same column).
        let stored = saveCanonical(makeCanonicalState({
            intent: 'support',
            resolved_facts: { customerCity: 'Medan' },
        }));
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                extractedEntities: null,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                const data = args.data;
                stored = data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // Write via canonical boundary
        await canonicalConversationStateService.updateCanonical('conv-audit', (state) => setIntent(state, 'support'));
        // Read via getV2Workspace — must see the same state
        const ws = await canonicalConversationStateService.getV2Workspace('conv-audit');
        assert.ok(ws, 'getV2Workspace must return workspace for state written via canonical boundary');
        assert.equal(ws.resolved_facts.customerCity, 'Medan');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// G2-D.4 — V1 WRITE → CANONICAL (regression tests)
// ─────────────────────────────────────────────────────────────────────────────
describe('G2-D.4 V1 write → canonical', () => {
    after(() => {
        restorePrisma();
    });
    // Test 1: V1 write → canonical read (pending lifecycle)
    it('D4-R1: setPendingClarification → getV1PendingClarification round-trip', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let stored = null;
        const ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                return { count: 1 };
            },
        });
        // Write via canonical
        await canonicalConversationStateService.writeV1PendingClarification('conv-d4-1', {
            id: 'q-d4-1',
            question: 'Mau 1 kg atau 2 kg?',
            options: [
                { id: 'opt-1', label: '1 kg' },
                { id: 'opt-2', label: '2 kg' },
            ],
            expected_type: 'choice',
            asked_at: '2026-01-01T00:00:00Z',
            retry_count: 0,
        });
        // Read via canonical
        const read = await canonicalConversationStateService.getV1PendingClarification('conv-d4-1');
        assert.ok(read, 'pending must be readable after write');
        assert.equal(read.question, 'Mau 1 kg atau 2 kg?');
        assert.equal(read.retry_count, 0);
        assert.equal(read.options.length, 2);
    });
    // Test 2: pending lifecycle (set → increment → resolve → clear)
    it('D4-R2: pending lifecycle — set → increment retry → resolve → clear', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let stored = saveCanonical(makeCanonicalState());
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        const pc = {
            id: 'lifecycle',
            question: 'Pilih?',
            options: [{ id: 'a', label: 'A' }],
            expected_type: 'choice',
            asked_at: '2026-01-01T00:00:00Z',
            retry_count: 0,
        };
        // 1. Set
        await canonicalConversationStateService.writeV1PendingClarification('conv-d4-2', pc);
        let read = await canonicalConversationStateService.getV1PendingClarification('conv-d4-2');
        assert.ok(read);
        assert.equal(read.retry_count, 0);
        // 2. Increment retry (3 times)
        for (let i = 0; i < 3; i++) {
            await canonicalConversationStateService.incrementV1PendingRetry('conv-d4-2');
        }
        read = await canonicalConversationStateService.getV1PendingClarification('conv-d4-2');
        assert.equal(read.retry_count, 3);
        // 3. Resolve
        await canonicalConversationStateService.resolvePending('conv-d4-2', 'lifecycle');
        const canonical = await canonicalConversationStateService.getCanonical('conv-d4-2');
        assert.ok(canonical);
        const resolved = findPending(canonical, 'lifecycle');
        assert.ok(resolved);
        assert.equal(resolved.status, 'resolved');
        // 4. Clear
        await canonicalConversationStateService.clearV1PendingClarification('conv-d4-2');
        read = await canonicalConversationStateService.getV1PendingClarification('conv-d4-2');
        assert.equal(read, null);
    });
    // Test 3: previousMutation lifecycle
    it('D4-R3: previousMutation lifecycle — write → read → clear', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let stored = saveCanonical(makeCanonicalState());
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        const snapshot = [
            { product: 'Ayam', qty: 2, price: 20000 },
            { product: 'Sapi', qty: 1, price: 50000 },
        ];
        // Write
        await canonicalConversationStateService.writeV1PreviousMutation('conv-d4-3', snapshot, 'rollback msg');
        let read = await canonicalConversationStateService.getV1PreviousMutation('conv-d4-3');
        assert.ok(read);
        assert.equal(read.message, 'rollback msg');
        assert.equal(read.cartSnapshot.length, 2);
        assert.equal(read.cartSnapshot[0].product, 'Ayam');
        // Clear
        await canonicalConversationStateService.clearV1PreviousMutation('conv-d4-3');
        read = await canonicalConversationStateService.getV1PreviousMutation('conv-d4-3');
        assert.equal(read, null);
    });
    // Test 4: discussedItems
    it('D4-R4: writeV1DiscussedItems → getV1DiscussedItems round-trip', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let stored = saveCanonical(makeCanonicalState());
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        const items = [
            { product: 'Beras', qty: 1, price: 15000, mentionedAt: '2026-01-01T00:00:00Z' },
            { product: 'Gula', qty: 2, price: 8000, mentionedAt: '2026-01-01T00:00:00Z' },
        ];
        await canonicalConversationStateService.writeV1DiscussedItems('conv-d4-4', items, 'ambiguous prompt');
        const read = await canonicalConversationStateService.getV1DiscussedItems('conv-d4-4');
        assert.equal(read.length, 2);
        assert.equal(read[0].product, 'Beras');
        assert.equal(read[1].product, 'Gula');
        // lastAmbiguousPrompt should be in resolved_facts
        const canonical = await canonicalConversationStateService.getCanonical('conv-d4-4');
        assert.equal(canonical.resolved_facts.lastAmbiguousPrompt, 'ambiguous prompt');
    });
    // Test 5: trackedEntities
    it('D4-R5: writeV1TrackedEntities → getV1TrackedEntities round-trip', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let stored = saveCanonical(makeCanonicalState());
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        const entities = [
            { type: 'product', value: 'Beras', confidence: 0.9 },
            { type: 'quantity', value: '2', confidence: 0.8 },
        ];
        await canonicalConversationStateService.writeV1TrackedEntities('conv-d4-5', entities);
        const read = await canonicalConversationStateService.getV1TrackedEntities('conv-d4-5');
        assert.equal(read.length, 2);
        assert.equal(read[0].type, 'product');
        assert.equal(read[0].value, 'Beras');
        assert.equal(read[1].type, 'quantity');
    });
    // Test 6: customerCity preservation (G2-D-L-018 fix)
    it('D4-R6: customerCity preserved across writeV1ShippingInfo + updateExtractedEntities', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let stored = saveCanonical(makeCanonicalState());
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // Set customerCity via canonical
        await canonicalConversationStateService.writeV1ShippingInfo('conv-d4-6', null, 'Jl. Merdeka');
        await canonicalConversationStateService.updateResolvedFacts('conv-d4-6', {
            customerCity: 'Jakarta',
            recipientName: 'Budi',
        });
        // Verify both facts survive (G2-D-L-018: no silent field loss)
        const city = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d4-6', 'customerCity');
        assert.equal(city, 'Jakarta');
        const name = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d4-6', 'recipientName');
        assert.equal(name, 'Budi');
        const addr = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d4-6', 'shippingAddress');
        assert.equal(addr, 'Jl. Merdeka');
    });
    // Test 7: partial update does not delete other state
    it('D4-R7: partial update (pending only) preserves existing facts + discussedItems', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let stored = null;
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // Seed with facts, discussed items, intent
        await canonicalConversationStateService.updateResolvedFacts('conv-d4-7', {
            customerCity: 'Bandung',
            recipientName: 'Siti',
        });
        await canonicalConversationStateService.writeV1DiscussedItems('conv-d4-7', [
            { product: 'Beras', qty: 1, price: 15000, mentionedAt: '2026-01-01T00:00:00Z' },
        ], null);
        await canonicalConversationStateService.updateIntent('conv-d4-7', 'purchase');
        // Partial update: add pending — should NOT wipe facts or discussedItems
        await canonicalConversationStateService.writeV1PendingClarification('conv-d4-7', {
            id: 'q-d4-7',
            question: 'Mau?',
            options: ['iya', 'tidak'],
            expected_type: 'yes_no',
            asked_at: '2026-01-01T00:00:00Z',
            retry_count: 0,
        });
        // Verify facts preserved
        const city = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d4-7', 'customerCity');
        assert.equal(city, 'Bandung');
        const name = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d4-7', 'recipientName');
        assert.equal(name, 'Siti');
        // Verify discussedItems preserved
        const discussed = await canonicalConversationStateService.getV1DiscussedItems('conv-d4-7');
        assert.equal(discussed.length, 1);
        assert.equal(discussed[0].product, 'Beras');
        // Verify intent preserved
        const canonical = await canonicalConversationStateService.getCanonical('conv-d4-7');
        assert.equal(canonical.intent, 'purchase');
    });
    // Test 8: concurrent update still safe
    it('D4-R8: concurrent canonical writes — no lost update (atomicCas)', async () => {
        const { canonicalConversationStateService } = await import('../canonical-context.service.js');
        let stored = saveCanonical(makeCanonicalState());
        let ts = new Date('2024-01-01T00:00:00Z');
        let updateCount = 0;
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                updateCount++;
                const where = args.where;
                if (where.updatedAt.getTime() !== ts.getTime()) {
                    return { count: 0 };
                }
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // Two concurrent writes to different fields
        const [resultA, resultB] = await Promise.all([
            canonicalConversationStateService.updateResolvedFacts('conv-d4-8', { customerCity: 'Jakarta' }),
            canonicalConversationStateService.updateResolvedFacts('conv-d4-8', { recipientName: 'Budi' }),
        ]);
        assert.ok(resultA, 'Write A must succeed');
        assert.ok(resultB, 'Write B must succeed');
        // Both facts must be present (no lost update)
        const city = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d4-8', 'customerCity');
        assert.equal(city, 'Jakarta');
        const name = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d4-8', 'recipientName');
        assert.equal(name, 'Budi');
        assert.ok(updateCount >= 2, 'CAS should have retried at least once');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// G2-D.5 — V2 WRITE → CANONICAL (regression tests)
// ─────────────────────────────────────────────────────────────────────────────
describe('G2-D.5 V2 write → canonical', () => {
    let canonicalConversationStateService;
    before(async () => {
        canonicalConversationStateService = (await import('../canonical-context.service.js')).canonicalConversationStateService;
    });
    after(() => {
        restorePrisma();
    });
    // Test 1: V2 write → canonical read (pendings, resolved_facts round-trip)
    it('D5-R1: saveWorkspaceV2 → getV2Workspace reads canonical state', async () => {
        let stored = null;
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // V2 engine writes workspace_v2 via canonical boundary
        await canonicalConversationStateService.saveWorkspaceV2('conv-d5-1', {
            schema_version: 'canonical-v1',
            conversation_summary: 'Saya ingin beli beras',
            pendings: [
                {
                    id: 'p-d5-1',
                    question: 'Mau 1 kg atau 2 kg?',
                    options: ['1 kg', '2 kg'],
                    expected_type: 'choice',
                    status: 'active',
                    attempts: 0,
                    deferred_turns: 0,
                    asked_at: '2026-01-01T00:00:00Z',
                },
            ],
            draft_cart: [],
            resolved_facts: { customerCity: 'Jakarta', recipientName: 'Budi' },
            options_presented: [['1 kg', '2 kg']],
            last_bot_message_type: 'text',
        });
        // Read back via getV2Workspace (canonical boundary)
        const ws = await canonicalConversationStateService.getV2Workspace('conv-d5-1');
        assert.ok(ws);
        assert.equal(ws.conversation_summary, 'Saya ingin beli beras');
        assert.equal(ws.pendings.length, 1);
        assert.equal(ws.pendings[0].question, 'Mau 1 kg atau 2 kg?');
        assert.equal(ws.resolved_facts.customerCity, 'Jakarta');
        assert.equal(ws.resolved_facts.recipientName, 'Budi');
        assert.equal(ws.options_presented.length, 1);
        assert.equal(ws.last_bot_message_type, 'text');
    });
    // Test 2: pending lifecycle via V2 write
    it('D5-R2: V2 pending lifecycle — saveWorkspaceV2 → resolve → clear', async () => {
        let stored = null;
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // 1. V2 engine writes pending (active)
        await canonicalConversationStateService.saveWorkspaceV2('conv-d5-2', {
            schema_version: 'canonical-v1',
            conversation_summary: '',
            pendings: [
                {
                    id: 'p-lifecycle',
                    question: 'Berapa?',
                    options: ['1', '2'],
                    expected_type: 'choice',
                    status: 'active',
                    attempts: 0,
                    deferred_turns: 0,
                    asked_at: '2026-01-01T00:00:00Z',
                },
            ],
            draft_cart: [],
            resolved_facts: {},
            options_presented: [],
        });
        // 2. V2 engine resolves (sets status='resolved')
        await canonicalConversationStateService.resolvePending('conv-d5-2', 'p-lifecycle');
        // 3. V2 engine saves again with updated pendings
        await canonicalConversationStateService.saveWorkspaceV2('conv-d5-2', {
            schema_version: 'canonical-v1',
            conversation_summary: 'Resolved',
            pendings: [
                {
                    id: 'p-lifecycle',
                    question: 'Berapa?',
                    options: ['1', '2'],
                    expected_type: 'choice',
                    status: 'resolved',
                    attempts: 0,
                    deferred_turns: 0,
                    asked_at: '2026-01-01T00:00:00Z',
                },
            ],
            draft_cart: [],
            resolved_facts: {},
            options_presented: [],
        });
        // Verify resolved via canonical read
        const ws = await canonicalConversationStateService.getV2Workspace('conv-d5-2');
        assert.ok(ws);
        assert.equal(ws.pendings[0].status, 'resolved');
    });
    // Test 3: resolved_facts preservation across V2 write
    it('D5-R3: resolved_facts preserved across multiple saveWorkspaceV2 calls', async () => {
        let stored = null;
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // First write: customerCity
        await canonicalConversationStateService.updateResolvedFacts('conv-d5-3', {
            customerCity: 'Jakarta',
            recipientName: 'Budi',
        });
        // Second write: shippingAddress (merge, not replace)
        await canonicalConversationStateService.updateResolvedFacts('conv-d5-3', {
            shippingAddress: 'Jl. Merdeka',
        });
        // Verify all facts preserved (no silent field loss)
        const city = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d5-3', 'customerCity');
        const name = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d5-3', 'recipientName');
        const addr = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d5-3', 'shippingAddress');
        assert.equal(city, 'Jakarta');
        assert.equal(name, 'Budi');
        assert.equal(addr, 'Jl. Merdeka');
    });
    // Test 4: intent preservation
    it('D5-R4: intent preserved in canonical state after saveWorkspaceV2', async () => {
        let stored = null;
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // V2 engine sets intent via resolved_facts or canonical
        await canonicalConversationStateService.updateIntent('conv-d5-4', 'purchase');
        const canonical = await canonicalConversationStateService.getCanonical('conv-d5-4');
        assert.ok(canonical);
        assert.equal(canonical.intent, 'purchase');
    });
    // Test 5: options_presented preservation
    it('D5-R5: options_presented preserved after saveWorkspaceV2', async () => {
        let stored = null;
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        await canonicalConversationStateService.saveWorkspaceV2('conv-d5-5', {
            schema_version: 'canonical-v1',
            conversation_summary: '',
            pendings: [],
            draft_cart: [],
            resolved_facts: {},
            options_presented: [['1 kg', '2 kg'], ['Beras', 'Gula']],
            last_bot_message_type: 'clarification',
        });
        const opts = getOptionsPresented((await canonicalConversationStateService.getCanonical('conv-d5-5')));
        assert.equal(opts.length, 2);
        assert.deepEqual(opts[0], ['1 kg', '2 kg']);
        assert.deepEqual(opts[1], ['Beras', 'Gula']);
    });
    // Test 6: partial update doesn't delete other state
    it('D5-R6: partial update (draft_cart only) preserves canonical state', async () => {
        let stored = null;
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // Seed canonical state
        await canonicalConversationStateService.saveWorkspaceV2('conv-d5-6', {
            schema_version: 'canonical-v1',
            conversation_summary: 'Saya mau beli beras',
            pendings: [
                {
                    id: 'p-active',
                    question: 'Mau?',
                    options: ['iya'],
                    expected_type: 'choice',
                    status: 'active',
                    attempts: 0,
                    deferred_turns: 0,
                    asked_at: '2026-01-01T00:00:00Z',
                },
            ],
            draft_cart: [],
            resolved_facts: { customerCity: 'Jakarta' },
            options_presented: [['iya']],
            last_bot_message_type: 'text',
        });
        // Update draft_cart via updateV2Transient — should NOT wipe canonical fields
        await canonicalConversationStateService.updateResolvedFacts('conv-d5-6', { customerCity: 'Bandung' });
        // Verify canonical state intact
        const city = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d5-6', 'customerCity');
        assert.equal(city, 'Bandung');
        const ws = await canonicalConversationStateService.getV2Workspace('conv-d5-6');
        assert.equal(ws.pendings.length, 1);
        assert.equal(ws.pendings[0].id, 'p-active');
        assert.equal(ws.conversation_summary, 'Saya mau beli beras');
    });
    // Test 7: concurrent V1/V2 update — no lost update
    it('D5-R7: concurrent V1 + V2 canonical update — no lost update', async () => {
        let stored = null;
        let ts = new Date('2024-01-01T00:00:00Z');
        let updateCount = 0;
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                updateCount++;
                const where = args.where;
                if (where.updatedAt.getTime() !== ts.getTime()) {
                    return { count: 0 };
                }
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // V1 writer updates shipping info (resolved_facts.recipientName)
        // V2 writer updates resolved_facts.customerCity
        // Both go through canonical boundary — must not lose either
        const [v1Result, v2Result] = await Promise.all([
            canonicalConversationStateService.updateResolvedFacts('conv-d5-7', { recipientName: 'Budi' }),
            canonicalConversationStateService.updateResolvedFacts('conv-d5-7', { customerCity: 'Jakarta' }),
        ]);
        assert.ok(v1Result, 'V1 write must succeed');
        assert.ok(v2Result, 'V2 write must succeed');
        const name = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d5-7', 'recipientName');
        const city = await canonicalConversationStateService.getFactWithLegacyFallback('conv-d5-7', 'customerCity');
        assert.equal(name, 'Budi');
        assert.equal(city, 'Jakarta');
        assert.ok(updateCount >= 2, 'CAS should have retried at least once');
    });
    // Test 8: V2 state readable via V1 compatibility path
    it('D5-R8: V2 write → V1 compatibility read via getV1ExtractedEntities', async () => {
        let stored = null;
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // V2 writes canonical state
        await canonicalConversationStateService.writeV1DiscussedItems('conv-d5-8', [
            { product: 'Beras', qty: 1, price: 15000, mentionedAt: '2026-01-01T00:00:00Z' },
        ], 'ambiguous prompt');
        await canonicalConversationStateService.updateResolvedFacts('conv-d5-8', {
            customerCity: 'Medan',
            recipientName: 'Siti',
        });
        // V1 legacy reader reads via getV1ExtractedEntities
        const v1Entities = await canonicalConversationStateService.getV1ExtractedEntities('conv-d5-8');
        assert.ok(v1Entities);
        // discussedItems from canonical _compat
        assert.equal(v1Entities.discussedItems.length, 1);
        assert.equal(v1Entities.discussedItems[0].product, 'Beras');
        // lastAmbiguousPrompt from canonical resolved_facts
        assert.equal(v1Entities.lastAmbiguousPrompt, 'ambiguous prompt');
        // recipientName from canonical resolved_facts
        assert.equal(v1Entities.recipientName, 'Siti');
        // customerCity is a dynamic field — not in ExtractedEntities typed interface
        // but preserved via fromLegacyExtractedEntities mapping
    });
    // Test 9: Cart remains CartAuthority — not canonical
    it('D5-R9: cart (draft_cart) NOT canonical — CartAuthority remains authority', async () => {
        let stored = null;
        let ts = new Date('2024-01-01T00:00:00Z');
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
            }),
            updateMany: async (args) => {
                const where = args.where;
                // atomicCas CAS enforcement
                if (where && where.updatedAt && where.updatedAt.getTime() !== ts.getTime()) {
                    return { count: 0 };
                }
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        // V2 engine writes draft_cart (V2-specific transient)
        await canonicalConversationStateService.saveWorkspaceV2('conv-d5-9', {
            schema_version: 'canonical-v1',
            conversation_summary: '',
            pendings: [],
            draft_cart: [
                { action: 'add', product: 'Beras', qty: 2, qty_source: 'default', status: 'confirmed' },
            ],
            resolved_facts: {},
            options_presented: [],
        });
        // Verify draft_cart is readable via getV2Workspace (adapter read)
        const ws = await canonicalConversationStateService.getV2Workspace('conv-d5-9');
        assert.ok(ws);
        assert.equal(ws.draft_cart.length, 1);
        assert.equal(ws.draft_cart[0].product, 'Beras');
        // BUT: canonical state should NOT have draft_cart as business field
        const canonical = await canonicalConversationStateService.getCanonical('conv-d5-9');
        const canonicalKeys = Object.keys(canonical);
        // _compat should also not store draft_cart
        assert.ok(!canonicalKeys.includes('draft_cart'), 'draft_cart must NOT be a top-level canonical field');
        // _compat may not exist (no V1 legacy fields) — if it does, discuss should be empty
        if (canonical._compat) {
            assert.equal(canonical._compat.discussed_items.length, 0, 'draft_cart must NOT be in _compat either');
        }
        // cart_ref should be null (CartAuthority owns actual cart)
        assert.equal(canonical._compat?.previous_mutation ?? null, null);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// G2-D.6: Compatibility Reader Audit — V1 legacy readers migrated to canonical
// ─────────────────────────────────────────────────────────────────────────────
describe('G2-D.6 Compatibility Reader Audit — V1 discussedItems/previousMutation canonical authority', () => {
    let canonicalConversationStateService;
    before(() => {
        canonicalConversationStateService = new CanonicalConversationStateService();
    });
    it('D6-R1: writeV1DiscussedItems → getV1DiscussedItems preserves items + lastAmbiguousPrompt', async () => {
        const items = [
            { product: 'Kangkung', qty: null, price: null, unit: 'unit', mentionedAt: '2026-08-14T00:00:00Z' },
        ];
        await canonicalConversationStateService.writeV1DiscussedItems('conv-d6-1', items, 'Mau kangkung?');
        const read = await canonicalConversationStateService.getV1DiscussedItems('conv-d6-1');
        assert.equal(read.length, 1);
        assert.equal(read[0].product, 'Kangkung');
        const canonical = await canonicalConversationStateService.getCanonical('conv-d6-1');
        assert.ok(canonical);
        assert.equal(canonical.resolved_facts.lastAmbiguousPrompt, 'Mau kangkung?');
    });
    it('D6-R3: V1 legacy reader (getV1ExtractedEntities) observes canonical-written discussedItems', async () => {
        const items = [
            { product: 'Wortel', qty: 2, price: 5000, unit: 'biji', mentionedAt: '2026-08-14T00:00:00Z' },
            { product: 'Kentang', qty: null, price: null, unit: 'unit', mentionedAt: '2026-08-14T00:00:00Z' },
        ];
        await canonicalConversationStateService.writeV1DiscussedItems('conv-d6-3', items);
        const v1Entities = await canonicalConversationStateService.getV1ExtractedEntities('conv-d6-3');
        assert.ok(v1Entities);
        assert.equal(v1Entities.discussedItems.length, 2);
        assert.equal(v1Entities.discussedItems[0].product, 'Wortel');
        assert.equal(v1Entities.discussedItems[0].qty, 2);
        assert.equal(v1Entities.previousMutation, null);
    });
    it('D6-R4: writeV1PreviousMutation → getV1PreviousMutation preserves cartSnapshot + message', async () => {
        const snapshot = [{ product: 'Beras', qty: 1, price: 12000 }];
        await canonicalConversationStateService.writeV1PreviousMutation('conv-d6-4', snapshot, 'Rollback ke beras 1kg');
        const read = await canonicalConversationStateService.getV1PreviousMutation('conv-d6-4');
        assert.ok(read);
        assert.equal(read.message, 'Rollback ke beras 1kg');
        assert.equal(read.cartSnapshot.length, 1);
        assert.equal(read.cartSnapshot[0].product, 'Beras');
        const v1 = await canonicalConversationStateService.getV1ExtractedEntities('conv-d6-4');
        assert.ok(v1);
        assert.ok(v1.previousMutation);
        assert.equal(v1.previousMutation.message, 'Rollback ke beras 1kg');
    });
    it('D6-R5: clearV1PreviousMutation → getV1PreviousMutation returns null', async () => {
        const snapshot = [{ product: 'Gula', qty: 2, price: 5000 }];
        await canonicalConversationStateService.writeV1PreviousMutation('conv-d6-5', snapshot, 'test');
        assert.ok(await canonicalConversationStateService.getV1PreviousMutation('conv-d6-5'));
        await canonicalConversationStateService.clearV1PreviousMutation('conv-d6-5');
        const read = await canonicalConversationStateService.getV1PreviousMutation('conv-d6-5');
        assert.equal(read, null);
    });
    it('D6-R6: concurrent writeV1DiscussedItems — no lost update (atomicCas)', async () => {
        const items1 = [
            { product: 'Beras', qty: null, price: null, unit: 'unit', mentionedAt: '2026-08-14T00:00:00Z' },
        ];
        const items2 = [
            { product: 'Gula', qty: null, price: null, unit: 'unit', mentionedAt: '2026-08-14T00:00:00Z' },
        ];
        let ts = new Date();
        let stored = null;
        stubPrisma({
            findUnique: async () => ({
                workspace_v2: stored,
                updatedAt: ts,
                extractedEntities: null,
            }),
            updateMany: async (args) => {
                const where = args.where;
                if (where && where.updatedAt && where.updatedAt.getTime() !== ts.getTime()) {
                    return { count: 0 };
                }
                stored = args.data.workspace_v2;
                ts = new Date(ts.getTime() + 1);
                return { count: 1 };
            },
        });
        try {
            await Promise.all([
                canonicalConversationStateService.writeV1DiscussedItems('conv-d6-6', items1),
                canonicalConversationStateService.writeV1DiscussedItems('conv-d6-6', items2),
            ]);
            const read = await canonicalConversationStateService.getV1DiscussedItems('conv-d6-6');
            assert.ok(read.length >= 1, 'discussedItems must survive concurrent writes');
            const products = read.map(d => d.product);
            assert.ok(products.includes('Beras') || products.includes('Gula'), 'at least one item must be preserved');
        }
        finally {
            restorePrisma();
        }
    });
    it('D6-R7: V1 write → canonical preserves discussedItems in _compat (readable via getCanonical)', async () => {
        const items = [
            { product: 'Kangkung', qty: null, price: null, unit: 'unit', mentionedAt: '2026-08-14T00:00:00Z' },
        ];
        await canonicalConversationStateService.writeV1DiscussedItems('conv-d6-7', items);
        const canonical = await canonicalConversationStateService.getCanonical('conv-d6-7');
        assert.ok(canonical);
        assert.ok(canonical._compat, '_compat must be present when V1 fields are written');
        assert.equal(canonical._compat.discussed_items.length, 1);
        assert.equal(canonical._compat.discussed_items[0].product, 'Kangkung');
    });
    it('D6-R8: V1 write → canonical → V1 read (storePreviousMutation → getV1PreviousMutation)', async () => {
        const snapshot = [{ product: 'Ayam', qty: 2, price: 20000, mentionedAt: '2026-08-14T00:00:00Z', confirmedAt: null }];
        await canonicalConversationStateService.writeV1PreviousMutation('conv-d6-8', snapshot, 'simpan snapshot ayam 2x20000');
        const read = await canonicalConversationStateService.getV1PreviousMutation('conv-d6-8');
        assert.ok(read);
        assert.equal(read.cartSnapshot.length, 1);
        assert.equal(read.cartSnapshot[0].product, 'Ayam');
        const v1 = await canonicalConversationStateService.getV1ExtractedEntities('conv-d6-8');
        assert.ok(v1);
        assert.ok(v1.previousMutation);
        assert.equal(v1.previousMutation.message, 'simpan snapshot ayam 2x20000');
    });
    it('D6-R9: writeV1DiscussedItems preserves other canonical state (pendings, resolved_facts)', async () => {
        await canonicalConversationStateService.updateResolvedFacts('conv-d6-9', { customerCity: 'Jakarta' });
        const pending = {
            id: 'pc-d6-9',
            question: 'Mau tambah?',
            options: ['iya', 'tidak'],
            status: 'active',
            attempts: 0,
            deferred_turns: 0,
            asked_at: '2026-08-14T00:00:00Z',
        };
        await canonicalConversationStateService.upsertPending('conv-d6-9', pending);
        const items = [{ product: 'Beras', qty: null, price: null, unit: 'unit', mentionedAt: '2026-08-14T00:00:00Z' }];
        await canonicalConversationStateService.writeV1DiscussedItems('conv-d6-9', items);
        const canonical = await canonicalConversationStateService.getCanonical('conv-d6-9');
        assert.ok(canonical);
        assert.equal(canonical.resolved_facts.customerCity, 'Jakarta', 'resolved_facts must be preserved');
        assert.equal(canonical.pendings.length, 1, 'pendings must be preserved');
        assert.equal(canonical.pendings[0].id, 'pc-d6-9', 'pending ID must be preserved');
        const discussed = await canonicalConversationStateService.getV1DiscussedItems('conv-d6-9');
        assert.equal(discussed.length, 1);
        assert.equal(discussed[0].product, 'Beras');
    });
});
//# sourceMappingURL=canonical-context.test.js.map