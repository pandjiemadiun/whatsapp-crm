/**
 * Unified Interpreter — unit tests (BAGIAN 3 / 5 refactor chat-flow QloBot).
 *
 * Runner:
 *   npx tsx --test --test-force-exit src/services/chat/__tests__/interpreter.test.ts
 *
 * LLM dipanggil lewat `llmGateway.generate` yang DI-MOCK (gateway adalah sole provider
 * decision point; runOneCall memanggil gateway, bukan adapter secara langsung) —
 * tidak ada API call asli, tidak menyentuh DB.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { llmGateway } from '../../../adapters/ai/llm-gateway.js';
import type { AIResponse, AIGenerateOptions } from '../../../adapters/ai/types.js';
import type {
  InterpreterResult,
  CartOp,
  PipelineContext,
} from '../../../domain/types.js';

import { runOneCall, validateCartOps, truncateTo2Sentences } from '../interpreter.js';

// ---------------------------------------------------------------------------
// Mock LLM — timpa llmGateway.generate
// ---------------------------------------------------------------------------
let llmCalls = 0;
let lastPrompt = '';
let cannedContent = '';
let cannedThrow: string | null = null;

const originalGenerate = llmGateway.generate;

const mockGenerate = async (
  prompt: string,
  _options?: AIGenerateOptions
): Promise<AIResponse> => {
  llmCalls++;
  lastPrompt = prompt;
  if (cannedThrow !== null) {
    throw new Error(cannedThrow);
  }
  return {
    content: cannedContent,
    provider: 'groq',
    model: 'test-model',
    tokens: { input: 12, output: 8 },
    cost: 0.0001,
  };
};

before(() => {
  llmGateway.generate = mockGenerate;
});

after(() => {
  llmGateway.generate = originalGenerate;
});

beforeEach(() => {
  llmCalls = 0;
  lastPrompt = '';
  cannedContent = '';
  cannedThrow = null;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DEFAULT_PRODUCTS: PipelineContext['storeProducts'] = [
  { name: 'Beras', price: 12000, stock: 10 },
  { name: 'Gula', price: 8000, stock: 5 },
];

function makeCtx(): PipelineContext {
  return {
    storeId: 'store-1',
    customerId: 'cust-1',
    conversationId: 'conv-1',
    messages: [],
    customerCity: 'Jakarta',
    customerName: null,
    cart: [],
    activeOrder: null,
    pendingClarification: null,
    llmCalledThisTurn: false,
    storeProducts: DEFAULT_PRODUCTS,
  };
}

function cannedResult(overrides: Partial<InterpreterResult> = {}): InterpreterResult {
  return {
    intent: 'buy',
    cart_ops: [{ type: 'add', product: 'Beras', qty: 1, price: 12000 }],
    buy_signal: 'yes',
    order_extract: null,
    missing_info: null,
    identity: { name: 'Budi' },
    reply_draft: 'Baik Kak, Beras sudah dimasukkan ke keranjang.',
    confidence: 0.95,
    clarification: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// runOneCall
// ---------------------------------------------------------------------------
describe('runOneCall (BAGIAN 3)', () => {
  it('system prompt mengandung 3 aturan kaku (no harga/stok, max 2 kal, set clarification)', async () => {
    cannedContent = JSON.stringify(cannedResult({ intent: 'product_info' }));
    await runOneCall('berapa harga beras?', makeCtx());

    assert.match(lastPrompt, /JANGAN sertakan harga\/stok di reply_draft/i);
    assert.match(lastPrompt, /maks 2 kalimat/i);
    assert.match(lastPrompt, /Jika produk yang.*tidak ada/i);
  });

  it('LLM kirim JSON valid -> InterpreterResult ter-mapping + tepat 1 LLM call', async () => {
    cannedContent = JSON.stringify(cannedResult());
    const result = await runOneCall('mau beli beras', makeCtx());

    assert.ok(result !== null);
    assert.equal(result?.intent, 'buy');
    assert.equal(result?.buy_signal, 'yes');
    assert.equal(result?.cart_ops?.[0]?.product, 'Beras');
    assert.equal(result?.cart_ops?.[0]?.qty, 1);
    assert.equal(result?.confidence, 0.95);
    assert.equal(
      result?.reply_draft,
      'Baik Kak, Beras sudah dimasukkan ke keranjang.'
    );
    assert.equal(result?.identity?.name, 'Budi');
    assert.equal(llmCalls, 1);
  });

  it('JSON valid tapi missing intent -> retry sekali -> null (2 LLM call)', async () => {
    cannedContent = JSON.stringify({ confidence: 0.5 }); // tanpa intent
    const result = await runOneCall('pesan aneh', makeCtx());
    assert.equal(result, null);
    assert.equal(llmCalls, 2);
  });

  it('error server non-retryable -> null, 1 LLM call (tidak retry)', async () => {
    cannedThrow = 'Internal Server Error: server crash'; // tak ada 429/timeout/JSON
    const result = await runOneCall('mau beli', makeCtx());
    assert.equal(result, null);
    assert.equal(llmCalls, 1);
  });

  it('error 429 retryable -> retry sekali -> null (2 LLM call)', async () => {
    cannedThrow = 'Groq 429 Too Many Requests';
    const result = await runOneCall('mau beli', makeCtx());
    assert.equal(result, null);
    assert.equal(llmCalls, 2);
  });
});

// ---------------------------------------------------------------------------
// validateCartOps
// ---------------------------------------------------------------------------
describe('validateCartOps (BAGIAN 3)', () => {
  it('product ada di katalog -> masuk ke valid', () => {
    const ops: CartOp[] = [{ type: 'add', product: 'Beras', qty: 1 }];
    const r = validateCartOps(ops, DEFAULT_PRODUCTS);
    assert.equal(r.valid.length, 1);
    assert.equal(r.valid[0].product, 'Beras');
    assert.equal(r.missing.length, 0);
  });

  it('product tidak ada -> valid kosong, ref masuk missing (untuk missing_info)', () => {
    const ops: CartOp[] = [
      { type: 'add', product: 'Beras', qty: 1 },
      { type: 'add', product: 'Apel', qty: 1 }, // tidak ada di katalog
    ];
    const r = validateCartOps(ops, DEFAULT_PRODUCTS);
    assert.equal(r.valid.length, 1);
    assert.equal(r.valid[0].product, 'Beras');
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0], 'Apel');
  });

  it('case-insensitive + trim whitespace', () => {
    const ops: CartOp[] = [{ type: 'remove', product: '  GULA ', qty: 2 }];
    const r = validateCartOps(ops, DEFAULT_PRODUCTS);
    assert.equal(r.valid.length, 1);
    assert.equal(r.missing.length, 0);
  });

  it('ops kosong -> tidak valid maupun missing', () => {
    const r = validateCartOps([], DEFAULT_PRODUCTS);
    assert.equal(r.valid.length, 0);
    assert.equal(r.missing.length, 0);
  });
});

// ---------------------------------------------------------------------------
// truncateTo2Sentences
// ---------------------------------------------------------------------------
describe('truncateTo2Sentences (BAGIAN 3)', () => {
  it('1 kalimat -> tidak berubah', () => {
    assert.equal(
      truncateTo2Sentences('Halo Kak, ada yang bisa dibantu?'),
      'Halo Kak, ada yang bisa dibantu?'
    );
  });

  it('2 kalimat -> tidak berubah', () => {
    assert.equal(
      truncateTo2Sentences('Siap. Beras sudah dimasukkan.'),
      'Siap. Beras sudah dimasukkan.'
    );
  });

  it('3+ kalimat -> dipotong ke 2 kalimat pertama', () => {
    assert.equal(truncateTo2Sentences('Satu. Dua. Tiga. Empat!'), 'Satu. Dua.');
  });

  it('string kosong -> empty string', () => {
    assert.equal(truncateTo2Sentences(''), '');
  });

  // ── P5.2 FIX: regex '?' tidak split jika diikuti huruf kecil/koma ──────────
  it('P5.2: "?" diikuti huruf besar -> split (kalimat terpisah)', () => {
    assert.equal(
      truncateTo2Sentences('Apakah sudah siap? Bisa lanjut.'),
      'Apakah sudah siap? Bisa lanjut.'
    );
  });

  it('P5.2: "?" diikuti huruf kecil -> TIDAK split (interjeksi BI)', () => {
    assert.equal(
      truncateTo2Sentences('Boleh kak? mau tanya dong.'),
      'Boleh kak? mau tanya dong.'
    );
  });

  it('P5.2: "?" diikuti koma -> TIDAK split (interjeksi BI)', () => {
    assert.equal(
      truncateTo2Sentences('Boleh kak?, mau tanya dong.'),
      'Boleh kak?, mau tanya dong.'
    );
  });

  it('P5.2: "?" di akhir string -> TIDAK split (1 kalimat)', () => {
    assert.equal(
      truncateTo2Sentences('Mau tanya apa?'),
      'Mau tanya apa?'
    );
  });

  it('P5.2: interjeksi "?" + kalimat lanjutan → tidak terpotong', () => {
    // Kalimat BI asli: "?" jadi interjeksi, tidak pemisah kalimat
    const input =
      'Keranjang sudah diupdate ya? silakan lanjut. Totalnya Rp 36.000. Terima kasih.';
    const result = truncateTo2Sentences(input);
    // "ya? silakan" → tidak split (? diikuti huruf kecil)
    // "lanjut. Totalnya" → split di ". " → 2 kalimat
    // "36.000." → titik desimal, tidak diikuti spasi → tidak split
    // "Terima kasih." → kalimat 3, akan dipotong
    assert.equal(result, 'Keranjang sudah diupdate ya? silakan lanjut. Totalnya Rp 36.000.');
    // Pastikan "Terima kasih" (kalimat ketiga) sudah dipotong
    assert.ok(!result.includes('Terima kasih'), 'kalimat ketiga tidak boleh ada');
  });

  it('P5.2: "?" diikuti spasi + angka -> split', () => {
    // "?" diikuti huruf besar → split
    assert.equal(
      truncateTo2Sentences('Pesan sekali ya? Nanti saja.'),
      'Pesan sekali ya? Nanti saja.'
    );
  });
});
