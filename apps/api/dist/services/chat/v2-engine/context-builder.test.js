/**
 * Unit tests — buildLLMContext (P2-UNIT2).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/v2-engine/context-builder.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLLMContext, MAX_TURNS } from './context-builder.js';
function makeTurn(role, content) {
    return { role, content };
}
function emptyWorkspace() {
    return {
        schema_version: 'v1',
        conversation_summary: '',
        pendings: [],
        draft_cart: [],
        resolved_facts: {},
        last_bot_message_type: undefined,
        options_presented: [],
    };
}
describe('buildLLMContext', () => {
    it('short conversation (<10 turn): all history is included', () => {
        const history = [
            makeTurn('user', 'Ada ban motor?'),
            makeTurn('assistant', 'Ban depan dan ban belakang tersedia.'),
            makeTurn('user', 'Saya mau beli ban depan'),
        ];
        const result = buildLLMContext({
            recentHistory: history,
            workspace: emptyWorkspace(),
            customerMessage: 'Totalnya berapa?',
        });
        assert.ok(result.includes('Ada ban motor?'));
        assert.ok(result.includes('Ban depan dan ban belakang tersedia.'));
        assert.ok(result.includes('Saya mau beli ban depan'));
        assert.ok(result.includes('Totalnya berapa?'));
    });
    it('long conversation (>10 turn): only last 10 turns appear, older turns omitted', () => {
        const history = Array.from({ length: 15 }, (_, i) => makeTurn(i % 2 === 0 ? 'user' : 'assistant', `Turn ${i + 1}`));
        const result = buildLLMContext({
            recentHistory: history,
            workspace: emptyWorkspace(),
            customerMessage: 'Pesan terakhir',
        });
        // Oldest turns should be omitted (use exact line match to avoid substring false-positive)
        const lines = result.split('\n');
        const historyLines = lines.filter((l) => l.startsWith('Customer: ') || l.startsWith('Assistant: '));
        assert.ok(!historyLines.some((l) => l === 'Customer: Turn 1'), 'Turn 1 should not appear');
        assert.ok(!historyLines.some((l) => l === 'Assistant: Turn 2'), 'Turn 2 should not appear');
        assert.ok(!historyLines.some((l) => l === 'Customer: Turn 3'), 'Turn 3 should not appear');
        assert.ok(!historyLines.some((l) => l === 'Assistant: Turn 4'), 'Turn 4 should not appear');
        assert.ok(!historyLines.some((l) => l === 'Customer: Turn 5'), 'Turn 5 should not appear');
        // Most recent 10 turns should be present
        assert.ok(historyLines.some((l) => l === 'Assistant: Turn 6'));
        assert.ok(historyLines.some((l) => l === 'Customer: Turn 15'));
        assert.ok(historyLines.some((l) => l === 'Customer: Pesan terakhir'));
        // Exactly 11 history lines: 10 turns + current message
        assert.equal(historyLines.length, 11);
    });
    it('empty workspace: state section does not error or leak weird empty fields', () => {
        const result = buildLLMContext({
            recentHistory: [makeTurn('user', 'Halo')],
            workspace: emptyWorkspace(),
            customerMessage: 'Halo juga',
        });
        assert.ok(result.includes('=== STATE PERCAKAPAN'));
        assert.ok(!result.includes('Ringkasan:'));
        assert.ok(!result.includes('Fakta yang sudah diketahui:'));
        assert.ok(!result.includes('Keranjang saat ini:'));
        assert.ok(!result.includes('Clarification aktif:'));
        assert.ok(!result.includes('Opsi yang sudah ditampilkan:'));
        assert.ok(result.includes('Halo'));
        assert.ok(result.includes('Halo juga'));
    });
    it('draft_cart present: appears in state section', () => {
        const workspace = {
            ...emptyWorkspace(),
            draft_cart: [
                { action: 'add', product: 'Ban dalam', qty: 1, qty_source: 'explicit', status: 'confirmed' },
            ],
        };
        const result = buildLLMContext({
            recentHistory: [],
            workspace,
            customerMessage: 'Totalnya berapa?',
        });
        assert.ok(result.includes('Keranjang saat ini:'));
        assert.ok(result.includes('Ban dalam'));
        assert.ok(result.includes('"qty":1'));
    });
    it('active_pendings present: appear, resolved pendings do not appear', () => {
        const workspace = {
            ...emptyWorkspace(),
            pendings: [
                { id: 'p1', question: 'Mau yang mana?', options: ['depan', 'belakang'], status: 'active', attempts: 0, deferred_turns: 0, asked_at: new Date().toISOString() },
                { id: 'p2', question: 'Sudah dibatalkan?', options: ['ya', 'tidak'], status: 'resolved', attempts: 1, deferred_turns: 0, asked_at: new Date().toISOString() },
            ],
        };
        const result = buildLLMContext({
            recentHistory: [],
            workspace,
            customerMessage: 'depan',
        });
        assert.ok(result.includes('Clarification aktif:'));
        assert.ok(result.includes('Mau yang mana?'));
        assert.ok(!result.includes('Sudah dibatalkan?'));
    });
    it('options_presented > 3: only last 3 appear', () => {
        const workspace = {
            ...emptyWorkspace(),
            options_presented: [
                ['depan', 'belakang'],
                ['merah', 'biru'],
                ['size S', 'size M'],
                ['size L', 'size XL'],
                ['size XXL'],
                ['size XXXL'],
            ],
        };
        const result = buildLLMContext({
            recentHistory: [],
            workspace,
            customerMessage: 'Size L',
        });
        assert.ok(result.includes('Opsi yang sudah ditampilkan:'));
        // Last 3 arrays: size L/size XL, size XXL, size XXXL
        assert.ok(result.includes('size L'));
        assert.ok(result.includes('size XXL'));
        assert.ok(result.includes('size XXXL'));
        // Older options should not appear
        assert.ok(!result.includes('depan'));
        assert.ok(!result.includes('biru'));
        assert.ok(!result.includes('size S'));
        assert.ok(!result.includes('size M'));
    });
    it('customer message is always the last line after PESAN SEKARANG', () => {
        const result = buildLLMContext({
            recentHistory: [makeTurn('assistant', 'Ada yang bisa saya bantu?')],
            workspace: emptyWorkspace(),
            customerMessage: 'Saya mau beli ban',
        });
        const pesanSekarangIndex = result.indexOf('=== PESAN SEKARANG ===');
        assert.ok(pesanSekarangIndex !== -1, 'PESAN SEKARANG section should exist');
        const afterHeader = result.slice(pesanSekarangIndex + '=== PESAN SEKARANG ==='.length).trim();
        assert.equal(afterHeader, 'Customer: Saya mau beli ban');
    });
    it('MAX_TURNS constant is 10', () => {
        assert.equal(MAX_TURNS, 10);
    });
});
//# sourceMappingURL=context-builder.test.js.map