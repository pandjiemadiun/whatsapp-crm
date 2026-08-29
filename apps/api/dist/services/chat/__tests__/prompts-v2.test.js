/**
 * Unit test — Prompt Template v2 (FASE B1)
 * Runner: node:test via tsx (proyek tidak memakai jest).
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/prompts-v2.test.ts
 *
 * I8: semua test di bawah adalah 0-LLM — tidak ada panggilan model/DB;
 *     hanya memverifikasi string template + struktur konstan few-shot.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, buildUserPrompt, FEW_SHOTS, } from '../prompts-v2.js';
// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────
const SAMPLE_CATALOG = [
    { id: '1', name: 'Ayam Goreng', price: 15000, category: 'makanan' },
    { id: '2', name: 'Es Teh', price: 5000, category: 'minuman' },
    { id: '3', name: 'Kentang', price: 20000, category: 'makanan' },
];
/**
 * Substring kunci untuk 11 aturan (rule a..k).
 * Tiap substring harus ada di output buildSystemPrompt.
 */
const RULE_SUBSTRINGS = [
    'HANYA JSON valid', // a
    'JANGAN sertakan harga/stok', // b
    'unmatched_mentions', // c
    "qty_source: 'explicit'", // d
    'anti-hallucination', // e
    'SetOp', // f
    'supersedes', // g
    'mismatch_reason', // h
    'confidence', // i
    'topic_switch', // j
    'summary_update', // k
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
// ─────────────────────────────────────────────────────────────────────────────
// buildSystemPrompt
// ─────────────────────────────────────────────────────────────────────────────
describe('buildSystemPrompt (FASE B1)', () => {
    it('mengandung 11 aturan esensial (cek substring per rule a..k)', () => {
        const p = buildSystemPrompt(SAMPLE_CATALOG);
        for (const sub of RULE_SUBSTRINGS) {
            assert.ok(p.includes(sub), `system prompt harus mengandung: ${sub}`);
        }
    });
    it('mengandung nama produk dari catalog (dibaca dari param, bukan hardcoded)', () => {
        const p = buildSystemPrompt(SAMPLE_CATALOG);
        assert.equal(p.includes('Ayam Goreng'), true);
        assert.equal(p.includes('Es Teh'), true);
        assert.equal(p.includes('Kentang'), true);
    });
    it('mengikuti katalog yang diberikan (bukan hardcode 3 produk)', () => {
        const p = buildSystemPrompt([
            { id: '9', name: 'Jus Jeruk', price: 7000, category: 'minuman' },
        ]);
        assert.equal(p.includes('Jus Jeruk'), true);
        assert.equal(p.includes('Kentang'), false); // produk lain harus tak tercantum
    });
    it('menangani katalog kosong', () => {
        const p = buildSystemPrompt([]);
        assert.equal(p.includes('belum ada katalog'), true);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// buildUserPrompt
// ─────────────────────────────────────────────────────────────────────────────
describe('buildUserPrompt (FASE B1)', () => {
    it('mengandung message, summary workspace, dan history', () => {
        const ws = makeWorkspace({
            conversation_summary: 'customer tanya ongkir',
            pendings: [{ id: 'q1', question: 'Mau pesan apa?', options: ['iya', 'tidak'], status: 'active', attempts: 0, deferred_turns: 0, asked_at: '2026-08-07T00:00:00Z' }],
        });
        const msg = 'Berapa ongkir ke jakarta?';
        const history = [
            { role: 'user', content: 'Mau pesan' },
            { role: 'assistant', content: 'Mau pesan apa?' },
        ];
        const prompt = buildUserPrompt(msg, ws, history);
        assert.equal(prompt.includes(msg), true);
        assert.equal(prompt.includes('customer tanya ongkir'), true);
        assert.equal(prompt.includes('Mau pesan apa?'), true); // dari pending aktif
        assert.equal(prompt.includes('Mau pesan'), true); // dari history
    });
    it('menampilkan opsi terakhir dari options_presented', () => {
        const ws = makeWorkspace({
            options_presented: [['Ayam Goreng', 'Es Teh']],
        });
        const prompt = buildUserPrompt('pesan Ayam Goreng', ws, []);
        assert.equal(prompt.includes('Ayam Goreng'), true);
        assert.equal(prompt.includes('Es Teh'), true);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// FEW_SHOTS
// ─────────────────────────────────────────────────────────────────────────────
describe('FEW_SHOTS (FASE B1)', () => {
    it('FEW_SHOTS.length === 11', () => {
        assert.equal(FEW_SHOTS.length, 11);
    });
    it('setiap few-shot punya struktur {user_message, context_description, expected_json}', () => {
        for (const fs of FEW_SHOTS) {
            assert.equal(typeof fs.user_message, 'string');
            assert.equal(typeof fs.context_description, 'string');
            assert.equal(typeof fs.expected_json, 'string');
        }
    });
    it('setiap expected_json adalah JSON valid & punya field inti InterpreterResultV2', () => {
        const requiredKeys = ['acts', 'unmatched_mentions', 'confidence', 'topic_switch'];
        for (const fs of FEW_SHOTS) {
            const parsed = JSON.parse(fs.expected_json);
            const obj = parsed;
            for (const k of requiredKeys) {
                assert.ok(k in obj, `expected_json harus punya key: ${k}`);
            }
            assert.equal(Array.isArray(obj.acts), true, 'acts harus array');
            assert.equal(Array.isArray(obj.unmatched_mentions), true, 'unmatched_mentions harus array');
            assert.equal(typeof obj.confidence, 'object', 'confidence harus object');
        }
    });
    it('case-2 (revisi) punya act kedua dengan supersedes merujuk act pertama', () => {
        const fs = FEW_SHOTS[1];
        const parsed = JSON.parse(fs.expected_json);
        const obj = parsed;
        assert.equal(obj.acts.length, 2);
        assert.equal(obj.acts[1].supersedes, obj.acts[0].act_id);
    });
    it('case-4 (mismatch) memiliki mismatch_reason, case-5 (ambiguous) ada clarification', () => {
        const c4 = JSON.parse(FEW_SHOTS[3].expected_json);
        assert.equal(c4.quantifier?.resolution_type, 'mismatch');
        assert.equal(typeof c4.quantifier?.mismatch_reason, 'string');
        const c5 = JSON.parse(FEW_SHOTS[4].expected_json);
        assert.equal(c5.quantifier?.resolution_type, 'ambiguous');
        assert.equal(typeof c5.clarification, 'object');
    });
    it('case-7 (greeting) → acts kosong + reply_draft ramah (TASK 8 regression A)', () => {
        const fs = FEW_SHOTS[6];
        const parsed = JSON.parse(fs.expected_json);
        assert.equal(parsed.acts.length, 0);
        assert.ok(parsed.reply_draft && parsed.reply_draft.trim().length > 0, 'greeting harus punya reply_draft ramah');
    });
    it('case-8 (cancel) → intent cancel + entity produk (TASK 8 regression C)', () => {
        const fs = FEW_SHOTS[7];
        const parsed = JSON.parse(fs.expected_json);
        assert.equal(parsed.acts.length, 1);
        assert.equal(parsed.acts[0].intent, 'cancel');
        assert.equal(parsed.acts[0].entities[0].type, 'product');
    });
    it('PV-P2c-LLM-B 7a: entities[].metadata.variant === draft_cart_ops[].variant (konsisten) untuk 3 few-shot varian', () => {
        // FS#9 (idx 8), FS#10 (idx 9), FS#11 (idx 10) — 3 contoh yang ada varian.
        for (const idx of [8, 9, 10]) {
            const fs = FEW_SHOTS[idx];
            const parsed = JSON.parse(fs.expected_json);
            // lookup: product value (lowercased) → entity
            const entityByProduct = new Map();
            for (const act of parsed.acts) {
                for (const e of act.entities) {
                    if (e.type === 'product')
                        entityByProduct.set(e.value.toLowerCase(), e);
                }
            }
            for (const op of parsed.draft_cart_ops) {
                const ent = entityByProduct.get(op.product.toLowerCase());
                assert.ok(ent, `harus ada entity produk untuk draft_cart_op product="${op.product}" (FS idx ${idx})`);
                assert.equal(ent.metadata?.variant ?? null, op.variant ?? null, `entity.metadata.variant harus SAMA PERSIS dengan draft_cart_ops.variant untuk "${op.product}" (FS idx ${idx}) — jika golden few-shot sendiri tidak konsisten, instruksi prompt untuk LLM nanti kurang jelas`);
            }
        }
    });
});
//# sourceMappingURL=prompts-v2.test.js.map