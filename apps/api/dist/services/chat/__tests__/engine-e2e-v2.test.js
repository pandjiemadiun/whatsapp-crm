/**
 * End-to-End Test — Engine v2 Pipeline (3-message scenario)
 * Runner: node:test via tsx (proyek tidak memakai jest).
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/engine-e2e-v2.test.ts
 *
 * Simulasi alur 3 pesan bekerja end-to-end di engine v2:
 *   Msg 1: "Mau beli beras 2"           → LLM cart_update Beras qty 2
 *   Msg 2: "Tambah kentang 1"          → LLM cart_update Kentang qty 1
 *   Msg 3: "Eh, gajadi cukup gula 1"   → LLM supersede (a1=Beras ditimpa a2=Gula)
 *
 * Setiap pesan melewati:
 *   A. tryFastPath (0-LLM) — pending resolver + tier deterministik
 *   B. groqAdapter.generate (LLM interpreter) → validate → planActs
 *   C. composeReply — menghasilkan teks balasan
 *   D. Workspace state persistence (addToDraft, setSummary, setLastBotMessage)
 *
 * I8: semua test di bawah adalah 0-LLM sebenarnya — groqAdapter.generate DI-MOCK.
 *      fallbackService juga di-stub agar test bersifat hermetik (fast path miss).
 * I13: produk katalog dibaca dari konstanta, ambang confidence dari constant.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { groqAdapter } from '../../../adapters/ai/groq.adapter.js';
import { understand } from '../reasoning.js';
import { composeReply } from '../composer-v2.js';
import { ResponseSource } from '../../../domain/types.js';
import { addToDraft, setSummary, setLastBotMessage, loadWorkspace, saveWorkspace, } from '../workspace.js';
import { planActs } from '../planner.js';
import { SELECTION_CONFIDENCE_THRESHOLD } from '../constants-v2.js';
// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────
const STORE_ID = 'store-test-e2e';
const CUSTOMER_ID = '6281234567890';
const CONVERSATION_ID = 'conv-e2e-001';
const CATALOG = [
    { id: '1', name: 'Beras', price: 15000, category: 'makanan' },
    { id: '2', name: 'Gula', price: 8000, category: 'minuman' },
    { id: '3', name: 'Kentang', price: 12000, category: 'makanan' },
];
/** Stub fallbackService: selalu HUMAN (fast path miss → lanjut ke LLM). */
function makeStubFallback() {
    return {
        getResponse: async (_msg, _ctx) => ({
            source: ResponseSource.HUMAN,
            content: 'fallback-stub',
            confidence: 0.5,
            cost: 0,
        }),
    };
}
/** Builder workspace kosong (fresh conversation). */
function makeFreshWorkspace() {
    return {
        schema_version: '3.2',
        conversation_summary: '',
        pendings: [],
        draft_cart: [],
        resolved_facts: {},
        options_presented: [],
    };
}
/**
 * Builder InterpreterResultV2 untuk cart_update act yang valid.
 * Produk otomatis disesuaikan agar lolos validator (ada di katalog).
 */
function makeCartResult(product, qty, qtySource, opts = {}) {
    const conf = opts.confidence ?? 0.95;
    return {
        acts: [
            {
                act_id: 'act_' + product.toLowerCase(),
                intent: 'cart_update',
                entities: [{ type: 'product', value: product, confidence: conf }],
                qty,
                qty_source: qtySource,
                confidence: conf,
                supersedes: opts.supersedes ?? null,
            },
        ],
        unmatched_mentions: [],
        topic_switch: false,
        draft_cart_ops: [
            {
                action: 'add',
                product,
                qty,
                qty_source: qtySource,
                status: conf >= SELECTION_CONFIDENCE_THRESHOLD ? 'confirmed' : 'needs_clarification',
            },
        ],
        confidence: {
            entities: conf,
            intent: conf,
            selection: conf,
            topic: conf,
        },
        summary_update: `Customer menambahkan ${product} ke keranjang.`,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Mock: groqAdapter.generate (singleton stub — no real API calls)
// ─────────────────────────────────────────────────────────────────────────────
let llmCallLog;
let mockResponses;
const originalGenerate = groqAdapter.generate;
const mockGenerate = async (_prompt, _options) => {
    llmCallLog.push('llm-call');
    const content = mockResponses.length > 0 ? mockResponses.shift() : '';
    return {
        content,
        provider: 'groq',
        model: 'test-model',
        tokens: { input: 50, output: 30 },
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
    llmCallLog = [];
    mockResponses = [];
});
/**
 * Simulasi end-to-end satu pesan melalui engine v2 pipeline.
 *
 * Alur (mismatch dengan conversation.service.ts hanya pada persistence layer;
 *  di sini workspace disimpan di memori, bukan DB):
 *   1. Auto-drop deferred pending (I13)
 *   2. understand() — fast path (0 LLM) + LLM interpreter + validate + planActs
 *   3. Jika 'tier' → balas langsung
 *   4. Jika 'reasoned' → apply act ke workspace (addToDraft), update summary,
 *      compose reply via composeReply
 *   5. Persist workspace via saveWorkspace/loadWorkspace round-trip (simulasi DB)
 *
 * I8: LLM hanya dipanggil bila fast path miss. Workspace mutasi pakai accessor pure.
 */
async function processMessageV2(message, workspace) {
    // 1. Auto-drop deferred pending (I13 — DEFERRED_AUTO_DROP_TURNS)
    for (const pending of workspace.pendings) {
        if (pending.status === 'deferred') {
            pending.deferred_turns += 1;
            // shouldAutoDrop adalah pure check — tidak di-import agar test tidak bergantung
            // const DEFERRED_AUTO_DROP_TURNS = 3
        }
    }
    // 2. Reasoning engine v2
    const fallbackStub = makeStubFallback();
    const reasoningOutcome = await understand(message, workspace, CATALOG, [], // history kosong untuk keperluan unit-level
    fallbackStub, STORE_ID);
    const llmCalls = llmCallLog.length;
    // 3. Handle outcome
    if (reasoningOutcome.outcome === 'tier') {
        const payload = reasoningOutcome.payload;
        return {
            outcome: 'tier',
            llmCalls,
            reply: payload.content ?? 'stub',
            workspace,
        };
    }
    // 4. outcome === 'reasoned' → execute acts, update workspace, compose reply
    const reasoned = reasoningOutcome.outcome === 'reasoned' ? reasoningOutcome : null;
    if (reasoned) {
        // Apply planned acts ke workspace: cart acts → addToDraft
        for (const act of reasoned.plannedActs) {
            if (act.intent.toLowerCase().includes('cart')) {
                addToDraft(workspace, act);
            }
        }
        // Update summary dari reasoningResult
        const summaryUpdate = reasoned.result.summary_update;
        if (summaryUpdate) {
            setSummary(workspace, summaryUpdate);
        }
        // Record bot message type (untuk opsi yang disajikan bila ada clarification)
        if (reasoned.result.clarification) {
            setLastBotMessage(workspace, 'clarification', reasoned.result.clarification.options);
        }
        else {
            setLastBotMessage(workspace, 'cart_reply', []);
        }
        // 5. Compose reply
        const reply = composeReply({
            plannedActs: reasoned.plannedActs,
            reasoningResult: reasoned.result,
            workspace,
            catalog: CATALOG,
            clarificationAttempt: 0,
        });
        return {
            outcome: 'reasoned',
            llmCalls,
            reply,
            workspace,
        };
    }
    // outcome === 'fallback_reasoning_failed' atau 'resolved' (fast-path)
    if (reasoningOutcome.outcome === 'resolved') {
        const payload = reasoningOutcome.payload;
        return {
            outcome: 'resolved',
            llmCalls,
            reply: payload.action === 'EXECUTE'
                ? 'Konfirmasi diterima, melanjutkan...'
                : 'Oke, dibatalkan.',
            workspace,
        };
    }
    // fallback
    return {
        outcome: 'fallback',
        llmCalls,
        reply: 'Maaf kak, saya kurang paham.',
        workspace,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// E2E SCENARIO: 3-message cart building flow
// ─────────────────────────────────────────────────────────────────────────────
describe('Engine v2 — 3-message end-to-end cart building flow', () => {
    it('Msg 1: "Mau beli beras 2" → LLM cart_update Beras qty 2', async () => {
        // LLM akan mengembalikan cart_update untuk Beras
        mockResponses = [
            JSON.stringify(makeCartResult('Beras', 2, 'explicit', { confidence: 0.95 })),
        ];
        const ws = makeFreshWorkspace();
        const result = await processMessageV2('Mau beli beras 2', ws);
        // Assert: outcome, LLM call count
        assert.equal(result.outcome, 'reasoned');
        assert.equal(result.llmCalls, 1); // fast path miss → 1 LLM call
        // Assert: reply composed from draft_cart_ops
        assert.match(result.reply, /Beras/);
        assert.match(result.reply, /x2/);
        // Assert: workspace draft_cart ter-update
        assert.equal(result.workspace.draft_cart.length, 1);
        const item1 = result.workspace.draft_cart[0];
        assert.equal(item1.product, 'Beras');
        assert.equal(item1.qty, 2);
        assert.equal(item1.action, 'add');
        assert.equal(item1.status, 'confirmed'); // confidence 0.95 >= 0.6
        // Assert: summary ter-update di workspace
        assert.match(result.workspace.conversation_summary, /Beras/);
        // Assert: workspace dapat di-round-trip via saveWorkspace/loadWorkspace
        const json = saveWorkspace(result.workspace);
        const reloaded = loadWorkspace(json);
        assert.equal(reloaded.draft_cart.length, 1);
        assert.equal(reloaded.draft_cart[0].product, 'Beras');
    });
    it('Msg 2: "Tambah kentang 1" → LLM cart_update Kentang qty 1, draft_cart tumbuh ke 2', async () => {
        // Mulai dari workspace yang sudah memiliki Beras (state from Msg 1)
        const ws = makeFreshWorkspace();
        addToDraft(ws, {
            act_id: 'act_beras',
            intent: 'cart_update',
            entities: [{ type: 'product', value: 'Beras', confidence: 0.95 }],
            qty: 2,
            qty_source: 'explicit',
            confidence: 0.95,
            supersedes: null,
        });
        setSummary(ws, 'Customer menambahkan Beras ke keranjang.');
        setLastBotMessage(ws, 'cart_reply', []);
        // Assert: state awal (1 item)
        assert.equal(ws.draft_cart.length, 1);
        assert.equal(ws.draft_cart[0].product, 'Beras');
        // LLM akan mengembalikan cart_update untuk Kentang
        mockResponses = [
            JSON.stringify(makeCartResult('Kentang', 1, 'explicit', { confidence: 0.92 })),
        ];
        const result = await processMessageV2('Tambah kentang 1', ws);
        // Assert: outcome + LLM call
        assert.equal(result.outcome, 'reasoned');
        assert.equal(result.llmCalls, 1);
        // Assert: reply
        assert.match(result.reply, /Kentang/);
        assert.match(result.reply, /x1/);
        // Assert: workspace draft_cart bertambah (state persistence)
        assert.equal(result.workspace.draft_cart.length, 2);
        assert.equal(result.workspace.draft_cart[0].product, 'Beras');
        assert.equal(result.workspace.draft_cart[1].product, 'Kentang');
        assert.equal(result.workspace.draft_cart[1].qty, 1);
        // Assert: summary terbaru mencerminkan Kentang
        assert.match(result.workspace.conversation_summary, /Kentang/);
    });
    it('Msg 3: "Eh, gajadi cukup gula 1" → LLM supersede (a1=Beras, a2=Gula), planner drop a1', async () => {
        // Mulai dari workspace dengan 2 item (state from Msg 1+2)
        const ws = makeFreshWorkspace();
        addToDraft(ws, {
            act_id: 'act_beras',
            intent: 'cart_update',
            entities: [{ type: 'product', value: 'Beras', confidence: 0.95 }],
            qty: 2,
            qty_source: 'explicit',
            confidence: 0.95,
            supersedes: null,
        });
        addToDraft(ws, {
            act_id: 'act_kentang',
            intent: 'cart_update',
            entities: [{ type: 'product', value: 'Kentang', confidence: 0.92 }],
            qty: 1,
            qty_source: 'explicit',
            confidence: 0.92,
            supersedes: null,
        });
        setSummary(ws, 'Customer menambahkan Kentang ke keranjang.');
        setLastBotMessage(ws, 'cart_reply', []);
        // Assert: state awal (2 item)
        assert.equal(ws.draft_cart.length, 2);
        // LLM mengembalikan 2 acts: a1 (add Beras), a2 (add Gula, supersedes=a1)
        // Ini mensimulasikan "gajadi gula aja" — gula supersede/mengganti beras dalam satu pesan
        const supersedeResult = {
            acts: [
                {
                    act_id: 'act_beras_v2',
                    intent: 'cart_update',
                    entities: [{ type: 'product', value: 'Beras', confidence: 0.9 }],
                    qty: 2,
                    qty_source: 'explicit',
                    confidence: 0.9,
                    supersedes: null,
                },
                {
                    act_id: 'act_gula',
                    intent: 'cart_update',
                    entities: [{ type: 'product', value: 'Gula', confidence: 0.95 }],
                    qty: 1,
                    qty_source: 'explicit',
                    confidence: 0.95,
                    supersedes: 'act_beras_v2', // Gula mengganti Beras
                },
            ],
            unmatched_mentions: [],
            topic_switch: false,
            draft_cart_ops: [
                { action: 'add', product: 'Gula', qty: 1, qty_source: 'explicit', status: 'confirmed' },
            ],
            confidence: { entities: 0.9, intent: 0.9, selection: 0.95, topic: 0.9 },
            summary_update: 'Customer mengganti Beras dengan Gula.',
        };
        mockResponses = [JSON.stringify(supersedeResult)];
        const result = await processMessageV2('Eh, gajadi cukup gula 1', ws);
        // Assert: outcome + LLM call
        assert.equal(result.outcome, 'reasoned');
        assert.equal(result.llmCalls, 1);
        // Assert: planner menghasilkan 1 act (a1 superseded oleh a2 → dropped)
        // addToDraft hanya dipanggil untuk survivor (act_gula), jadi draft_cart
        // bertambah tepat 1 item (Gula) — Beras & Kentang dari turn sebelumnya tetap
        assert.equal(result.workspace.draft_cart.length, 3);
        // Assert: workspace draft_cart bertambah (Gula ditamahkan)
        assert.equal(result.workspace.draft_cart.length, 3);
        assert.equal(result.workspace.draft_cart[0].product, 'Beras');
        assert.equal(result.workspace.draft_cart[1].product, 'Kentang');
        assert.equal(result.workspace.draft_cart[2].product, 'Gula');
        assert.equal(result.workspace.draft_cart[2].qty, 1);
        // Assert: summary mencerminkan perubahan
        assert.match(result.workspace.conversation_summary, /Gula/);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// E2E SCENARIO: 3-message flow dengan clarification (pending resolver)
// ─────────────────────────────────────────────────────────────────────────────
describe('Engine v2 — 3-message end-to-end with clarification cycle', () => {
    it('Msg 1: "mau beli es teh" → low selection confidence → clarification dipicu', async () => {
        // LLM mengembalikan clarification (low confidence → I-V2-6, retryable=false → reasoned no acts)
        mockResponses = [
            JSON.stringify({
                acts: [],
                unmatched_mentions: ['es teh'],
                topic_switch: false,
                draft_cart_ops: [],
                clarification: {
                    question: 'Mau es teh yang mana Kak?',
                    options: ['Es Teh Manis', 'Es Teh Tawar'],
                    expected_type: 'choice',
                },
                confidence: { entities: 0.5, intent: 0.5, selection: 0.3, topic: 0.5 },
                summary_update: 'Customer tanya es teh.',
            }),
        ];
        const ws = makeFreshWorkspace();
        const result = await processMessageV2('mau beli es teh', ws);
        // Assert: outcome = reasoned (I-V2-6 trigger, not fallback)
        assert.equal(result.outcome, 'reasoned');
        assert.equal(result.llmCalls, 1);
        // Assert: reply adalah clarification (bukan cart update)
        assert.match(result.reply, /es teh/i);
        assert.match(result.reply, /1\.|2\./); // ada opsi numerasi
        // Assert: workspace mencatat options_presented
        assert.equal(result.workspace.options_presented.length, 1);
        assert.deepEqual(result.workspace.options_presented[0], ['Es Teh Manis', 'Es Teh Tawar']);
    });
    it('Msg 2: "nomor 1" → fast path resolved (EXECUTE), 0 LLM', async () => {
        // Workspace dengan pending aktif (dari Msg 1)
        const ws = makeFreshWorkspace();
        ws.pendings = [
            {
                id: 'pend_clar_1',
                question: 'Mau es teh yang mana Kak?',
                options: ['Es Teh Manis', 'Es Teh Tawar'],
                status: 'active',
                attempts: 0,
                deferred_turns: 0,
                asked_at: '2026-08-08T00:00:00Z',
            },
        ];
        ws.options_presented = [['Es Teh Manis', 'Es Teh Tawar']];
        // Mock tidak dipakai (fast path hit → 0 LLM)
        const result = await processMessageV2('nomor 1', ws);
        // Assert: 0 LLM calls (fast path resolved via index pattern "nomor 1")
        assert.equal(result.llmCalls, 0);
        assert.equal(result.outcome, 'resolved');
    });
    it('Msg 3: "gula 1" → LLM cart_update Gula (no pending, fast path miss)', async () => {
        // Workspace: pending sudah resolved/dropped, draft kosong
        const ws = makeFreshWorkspace();
        ws.pendings = [];
        mockResponses = [
            JSON.stringify(makeCartResult('Gula', 1, 'explicit', { confidence: 0.93 })),
        ];
        const result = await processMessageV2('gula 1', ws);
        assert.equal(result.outcome, 'reasoned');
        assert.equal(result.llmCalls, 1);
        assert.match(result.reply, /Gula/);
        assert.equal(result.workspace.draft_cart.length, 1);
        assert.equal(result.workspace.draft_cart[0].product, 'Gula');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// E2E: workspace JSON round-trip persistence
// ─────────────────────────────────────────────────────────────────────────────
describe('Engine v2 — workspace persistence (saveWorkspace→loadWorkspace)', () => {
    it('3-message state bertahan melewati saveWorkspace → loadWorkspace round-trip', async () => {
        let ws = makeFreshWorkspace();
        // Msg 1
        mockResponses = [JSON.stringify(makeCartResult('Beras', 2, 'explicit'))];
        let r = await processMessageV2('Mau beli beras 2', ws);
        ws = r.workspace;
        assert.equal(ws.draft_cart.length, 1);
        // Round-trip persist (simulasi DB)
        ws = loadWorkspace(saveWorkspace(ws));
        assert.equal(ws.draft_cart.length, 1);
        assert.equal(ws.draft_cart[0].product, 'Beras');
        // Msg 2
        mockResponses = [JSON.stringify(makeCartResult('Kentang', 1, 'explicit'))];
        r = await processMessageV2('Tambah kentang 1', ws);
        ws = r.workspace;
        assert.equal(ws.draft_cart.length, 2);
        // Round-trip lagi
        ws = loadWorkspace(saveWorkspace(ws));
        assert.equal(ws.draft_cart.length, 2);
        assert.equal(ws.draft_cart[1].product, 'Kentang');
        // Msg 3 — supersede dalam satu message
        const supersedeResult = {
            acts: [
                {
                    act_id: 'act_gula_v1',
                    intent: 'cart_update',
                    entities: [{ type: 'product', value: 'Gula', confidence: 0.9 }],
                    qty: 1,
                    qty_source: 'explicit',
                    confidence: 0.9,
                    supersedes: null,
                },
                {
                    act_id: 'act_gula_v2',
                    intent: 'cart_update',
                    entities: [{ type: 'product', value: 'Gula', confidence: 0.95 }],
                    qty: 3,
                    qty_source: 'explicit',
                    confidence: 0.95,
                    supersedes: 'act_gula_v1', // ganti qty 1 → 3
                },
            ],
            unmatched_mentions: [],
            topic_switch: false,
            draft_cart_ops: [
                { action: 'add', product: 'Gula', qty: 3, qty_source: 'explicit', status: 'confirmed' },
            ],
            confidence: { entities: 0.95, intent: 0.95, selection: 0.95, topic: 0.95 },
            summary_update: 'Customer merevisi jumlah Gula ke 3.',
        };
        mockResponses = [JSON.stringify(supersedeResult)];
        r = await processMessageV2('Eh, gula 3 aja', ws);
        ws = r.workspace;
        // Planner: act_gula_v1 superseded oleh act_gula_v2 → hanya act_gula_v2 survive
        // addToDraft hanya dipanggil untuk plannedActs yang survived (act_gula_v2)
        assert.equal(ws.draft_cart.length, 3); // Beras, Kentang, Gula (revisi ke 3)
        assert.equal(ws.draft_cart[2].product, 'Gula');
        assert.equal(ws.draft_cart[2].qty, 3); // qty yang direvisi
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// E2E: planner supersede chain verification
// ─────────────────────────────────────────────────────────────────────────────
describe('Engine v2 — planner supersede chain (I5: pakai act_id, bukan index)', () => {
    it('Rantai supersede a1→a2→a3 → hanya a3 yang survivorship (3-message context)', () => {
        // Acts merepresentasikan revisi bertahap dalam satu pesan:
        // a1: add Beras → a2: supersedes a1, ganti jadi Kentang → a3: supersedes a2, ganti jadi Gula
        const acts = [
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
                entities: [{ type: 'product', value: 'Kentang', confidence: 0.9 }],
                qty: 1,
                qty_source: 'explicit',
                confidence: 0.9,
                supersedes: 'a1',
            },
            {
                act_id: 'a3',
                intent: 'cart_update',
                entities: [{ type: 'product', value: 'Gula', confidence: 0.95 }],
                qty: 1,
                qty_source: 'explicit',
                confidence: 0.95,
                supersedes: 'a2',
            },
        ];
        const planned = planActs(acts);
        // Hanya a3 yang survivorship (head of chain)
        assert.equal(planned.length, 1);
        assert.equal(planned[0].act_id, 'a3');
        assert.equal(planned[0].entities[0].value, 'Gula');
    });
    it('Positional supersedes (number) — convertPositionalSupersedes via understand()', async () => {
        // LLM kirim supersedes = 0 (positional index) → reasoning.convertPositionalSupersedes
        // akan konversi ke act_id string 'a1' sebelum validate + planActs.
        mockResponses = [
            JSON.stringify({
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
                        supersedes: 0, // positional → akan jadi 'a1'
                    },
                ],
                unmatched_mentions: [],
                topic_switch: false,
                draft_cart_ops: [],
                confidence: { entities: 0.9, intent: 0.9, selection: 0.95, topic: 0.9 },
                summary_update: '',
            }),
        ];
        const ws = makeFreshWorkspace();
        const reasoningOutcome = await understand('gajadi gula aja', ws, CATALOG, [], makeStubFallback(), STORE_ID);
        assert.equal(llmCallLog.length, 1);
        assert.equal(reasoningOutcome.outcome, 'reasoned');
        if (reasoningOutcome.outcome === 'reasoned') {
            // a2.supersedes harus sudah dikonversi ke 'a1' (string)
            const a2 = reasoningOutcome.result.acts.find((a) => a.act_id === 'a2');
            assert.ok(a2);
            assert.equal(a2.supersedes, 'a1');
            assert.equal(typeof a2.supersedes, 'string');
            // planActs: a1 superseded oleh a2 → hanya a2 yang survivorship
            assert.equal(reasoningOutcome.plannedActs.length, 1);
            assert.equal(reasoningOutcome.plannedActs[0].act_id, 'a2');
            assert.equal(reasoningOutcome.plannedActs[0].entities[0].value, 'Gula');
        }
    });
});
//# sourceMappingURL=engine-e2e-v2.test.js.map