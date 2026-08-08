import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeReply } from '../composer-v2.js';
describe('composer-v2', () => {
    const mockWorkspace = {
        schema_version: '1',
        conversation_summary: '',
        pendings: [],
        draft_cart: [],
        resolved_facts: {},
        options_presented: []
    };
    it('clarification attempt 1 → output dari composeClarification', () => {
        const result = {
            acts: [],
            unmatched_mentions: [],
            topic_switch: false,
            draft_cart_ops: [],
            confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
            clarification: { question: 'Apa?', options: ['A', 'B'], expected_type: 'choice' }
        };
        const reply = composeReply({
            plannedActs: [],
            reasoningResult: result,
            workspace: mockWorkspace,
            catalog: [],
            clarificationAttempt: 1
        });
        assert.match(reply, /Apa\?/);
    });
    it('clarification attempt 3 → fallback message', () => {
        const result = {
            acts: [],
            unmatched_mentions: [],
            topic_switch: false,
            draft_cart_ops: [],
            confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
            clarification: { question: 'Apa?', options: [], expected_type: 'choice' }
        };
        const reply = composeReply({
            plannedActs: [],
            reasoningResult: result,
            workspace: mockWorkspace,
            catalog: [],
            clarificationAttempt: 3
        });
        assert.strictEqual(reply, 'Sepertinya saya kurang paham, mau saya bantu manual?');
    });
    it('plannedActs kosong + reply_draft → return reply_draft', () => {
        const result = {
            acts: [],
            unmatched_mentions: [],
            topic_switch: false,
            draft_cart_ops: [],
            confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
            reply_draft: 'Halo!'
        };
        const reply = composeReply({
            plannedActs: [],
            reasoningResult: result,
            workspace: mockWorkspace,
            catalog: [],
            clarificationAttempt: 0
        });
        assert.strictEqual(reply, 'Halo!');
    });
    it('plannedActs kosong + no reply → return Maaf kak...', () => {
        const result = {
            acts: [],
            unmatched_mentions: [],
            topic_switch: false,
            draft_cart_ops: [],
            confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
        };
        const reply = composeReply({
            plannedActs: [],
            reasoningResult: result,
            workspace: mockWorkspace,
            catalog: [],
            clarificationAttempt: 0
        });
        assert.strictEqual(reply, 'Maaf kak, saya kurang paham.');
    });
    it('cart_update confirmed → Ditambahkan ke keranjang', () => {
        const result = {
            acts: [{ act_id: '1', intent: 'add_cart', entities: [], qty_source: 'explicit', confidence: 1, supersedes: null }],
            unmatched_mentions: [],
            topic_switch: false,
            draft_cart_ops: [{ action: 'add', product: 'Ayam', qty: 1, qty_source: 'explicit', status: 'confirmed' }],
            confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
        };
        const reply = composeReply({
            plannedActs: [{ act_id: '1', intent: 'add_cart', entities: [], qty_source: 'explicit', confidence: 1, supersedes: null }],
            reasoningResult: result,
            workspace: mockWorkspace,
            catalog: [],
            clarificationAttempt: 0
        });
        assert.strictEqual(reply, '🛒 Ditambahkan ke keranjang: Ayam x1');
    });
    it('topic_switch=true → ada reminder pending', () => {
        const result = {
            acts: [{ act_id: '1', intent: 'switch_topic', entities: [], qty_source: 'default', confidence: 1, supersedes: null }],
            unmatched_mentions: [],
            topic_switch: true,
            draft_cart_ops: [],
            confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
        };
        const reply = composeReply({
            plannedActs: [{ act_id: '1', intent: 'switch_topic', entities: [], qty_source: 'default', confidence: 1, supersedes: null }],
            reasoningResult: result,
            workspace: { ...mockWorkspace, pendings: [{ id: '1', question: '?', options: [], status: 'active', attempts: 0, deferred_turns: 0, asked_at: '2026-08-08T00:00:00Z' }] },
            catalog: [],
            clarificationAttempt: 0
        });
        assert.match(reply, /Oh ya Kak, tadi masih lanjut pesan/);
    });
});
//# sourceMappingURL=composer-v2.test.js.map