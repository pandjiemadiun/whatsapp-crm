/**
 * Unit tests — V2EngineOutputSchema (P2-UNIT1 foundation).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/v2-engine/schema.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { V2EngineOutputSchema, V2_INTENTS, } from './schema.js';
function validBase() {
    return {
        schema_version: 'v1',
        intent: V2_INTENTS.ADD_TO_CART,
        confidence: 0.9,
        entities: [
            { type: 'product', value: 'sepatu', confidence: 0.9 },
            { type: 'variant', value: 'merah size L', confidence: 0.8, metadata: { variant: 'merah size L' } },
        ],
        proposed_actions: [
            {
                action_type: 'ADD_TO_CART',
                payload: { product: 'sepatu', variant: 'merah size L', qty: 1 },
                confidence: 0.9,
                requires_validation: true,
            },
        ],
        reply_text: 'Oke, sepatu sudah ditambahkan ke keranjang!',
        needs_clarification: false,
        summary_update: 'Customer menambahkan sepatu warna merah size L.',
        uncertainty_signals: [],
    };
}
describe('V2EngineOutputSchema', () => {
    it('valid payload passes validation', () => {
        const result = V2EngineOutputSchema.safeParse(validBase());
        assert.ok(result.success, `expected success, got errors: ${result.error?.message}`);
        if (result.success) {
            assert.equal(result.data.intent, V2_INTENTS.ADD_TO_CART);
            assert.equal(result.data.reply_text, 'Oke, sepatu sudah ditambahkan ke keranjang!');
            assert.equal(result.data.proposed_actions[0].action_type, 'ADD_TO_CART');
            assert.equal(result.data.entities[0].type, 'product');
        }
    });
    it('intent outside enum is rejected', () => {
        const payload = validBase();
        payload.intent = 'beli_sekarang';
        const result = V2EngineOutputSchema.safeParse(payload);
        assert.ok(!result.success, 'expected failure for unknown intent');
    });
    it('missing reply_text is rejected', () => {
        const payload = validBase();
        payload.reply_text = '';
        const result = V2EngineOutputSchema.safeParse(payload);
        assert.ok(!result.success, 'expected failure for empty reply_text');
    });
    it('proposed_action with action_type outside list is rejected', () => {
        const payload = validBase();
        payload.proposed_actions[0].action_type = 'BELI_NOW';
        const result = V2EngineOutputSchema.safeParse(payload);
        assert.ok(!result.success, 'expected failure for unknown action_type');
    });
    it('confidence out of range [0,1] is rejected', () => {
        const payload = validBase();
        payload.confidence = -0.1;
        let result = V2EngineOutputSchema.safeParse(payload);
        assert.ok(!result.success, 'expected failure for negative confidence');
        payload.confidence = 1.5;
        result = V2EngineOutputSchema.safeParse(payload);
        assert.ok(!result.success, 'expected failure for confidence > 1');
    });
    it('entity type outside enum is rejected', () => {
        const payload = validBase();
        payload.entities[0].type = 'barcode';
        const result = V2EngineOutputSchema.safeParse(payload);
        assert.ok(!result.success, 'expected failure for unknown entity type');
    });
    it('uncertainty_signal type outside enum is rejected', () => {
        const payload = validBase();
        payload.uncertainty_signals = [{ type: 'network_error', description: 'timeout' }];
        const result = V2EngineOutputSchema.safeParse(payload);
        assert.ok(!result.success, 'expected failure for unknown uncertainty signal type');
    });
    it('schema_version mismatch is rejected', () => {
        const payload = validBase();
        payload.schema_version = 'v2';
        const result = V2EngineOutputSchema.safeParse(payload);
        assert.ok(!result.success, 'expected failure for wrong schema_version');
    });
    it('all valid intents are accepted', () => {
        const intents = Object.values(V2_INTENTS);
        for (const intent of intents) {
            const payload = validBase();
            payload.intent = intent;
            const result = V2EngineOutputSchema.safeParse(payload);
            assert.ok(result.success, `expected success for intent ${intent}, got error: ${result.error?.message}`);
        }
    });
    it('optional fields can be omitted', () => {
        const payload = validBase();
        payload.clarification_question = undefined;
        payload.summary_update = undefined;
        payload.uncertainty_signals = [];
        const result = V2EngineOutputSchema.safeParse(payload);
        assert.ok(result.success, `expected success with optional fields omitted, got: ${result.error?.message}`);
    });
    it('proposed_actions with NONE action_type and requires_validation=false is accepted', () => {
        const payload = validBase();
        payload.proposed_actions = [
            {
                action_type: 'NONE',
                payload: {},
                confidence: 0.95,
                requires_validation: false,
            },
        ];
        const result = V2EngineOutputSchema.safeParse(payload);
        assert.ok(result.success, `expected success for NONE action, got: ${result.error?.message}`);
    });
});
//# sourceMappingURL=schema.test.js.map