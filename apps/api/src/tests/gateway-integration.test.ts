/**
 * G2-B.1 INTEGRATION TEST: Conversation Engine → LLMGateway → Gemini → Groq fallback
 *
 * This test does NOT mock llmGateway.generate directly.
 * It instantiates a REAL LLMGateway with mock Gemini (fails) + mock Groq (succeeds),
 * swaps it into the llmGateway singleton, then calls the REAL interpreter.runOneCall.
 *
 * Proves the integration seam: interpreter.reasoning → llmGateway → provider chain.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { llmGateway, LLMGateway } from '../adapters/ai/llm-gateway.js';
import type { AIProvider, AIResponse, AIGenerateOptions } from '../adapters/ai/types.js';
import { AIProviderError, ErrorCategory } from '../adapters/ai/types.js';
import { runOneCall } from '../services/chat/interpreter.js';
import type { PipelineContext } from '../domain/types.js';

interface ProviderTracker {
  calls: number;
}

function makeMockGemini(fail: boolean, tracker: ProviderTracker): AIProvider {
  return {
    getName: () => 'gemini',
    getModel: () => 'gemini-2.0-flash',
    generate: async (_prompt: string, _options?: AIGenerateOptions): Promise<AIResponse> => {
      tracker.calls++;
      if (fail) {
        throw new AIProviderError('Gemini 500', ErrorCategory.SERVER_ERROR, 'gemini', 500, true);
      }
      return {
        content: JSON.stringify({
          intent: 'buy',
          cart_ops: [{ action: 'add', product: 'ayam goreng', qty: 1, destination: 1 }],
          buy_signal: 'yes',
          order_extract: null,
          missing_info: null,
          identity: { name: null },
          reply_draft: 'Oke ditambahkan ayam goreng',
          confidence: 0.95,
          clarification: null,
        }),
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        tokens: { input: 50, output: 50 },
        cost: 0.001,
      };
    },
  };
}

function makeMockGroq(tracker: ProviderTracker): AIProvider {
  return {
    getName: () => 'groq',
    getModel: () => 'openai/gpt-oss-120b',
    generate: async (_prompt: string, _options?: AIGenerateOptions): Promise<AIResponse> => {
      tracker.calls++;
      return {
        content: JSON.stringify({
          intent: 'buy',
          cart_ops: [{ action: 'add', product: 'fallback ayam goreng', qty: 1, destination: 1 }],
          buy_signal: 'yes',
          order_extract: null,
          missing_info: null,
          identity: { name: null },
          reply_draft: 'Oke ditambahkan ayam goreng (fallback)',
          confidence: 0.90,
          clarification: null,
        }),
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        tokens: { input: 50, output: 50 },
        cost: 0.001,
      };
    },
  };
}

function makeCtx(): PipelineContext {
  return {
    storeId: 'store-integration-test',
    customerId: 'cust-integration-test',
    conversationId: 'conv-integration-test',
    messages: [{ sender: 'customer', content: 'mau beli ayam goreng' }],
    customerCity: null,
    customerName: null,
    cart: [],
    activeOrder: null,
    pendingClarification: null,
    llmCalledThisTurn: false,
    storeProducts: [{ name: 'ayam goreng', price: 15000, stock: 10 }],
  };
}

describe('G2-B.1 Integration: Interpreter → LLMGateway → Gemini→Groq', () => {
  const originalGenerate = llmGateway.generate.bind(llmGateway);
  after(() => { (llmGateway as any).generate = originalGenerate; });

  test('Gemini primary success → Groq NOT called (via interpreter.runOneCall)', async () => {
    const geminiTracker: ProviderTracker = { calls: 0 };
    const groqTracker: ProviderTracker = { calls: 0 };

    const gemini = makeMockGemini(false, geminiTracker);
    const groq = makeMockGroq(groqTracker);
    const gw = new LLMGateway(gemini, groq, groq, 5000, 3);
    (llmGateway as any).generate = gw.generate.bind(gw);

    const ctx = makeCtx();
    const result = await runOneCall('mau beli ayam goreng', ctx);

    assert.ok(result, 'Interpreter returned a non-null result');
    assert.equal(result!.intent, 'buy');
    assert.equal(geminiTracker.calls, 1, 'Gemini primary was attempted exactly once');
    assert.equal(groqTracker.calls, 0, 'Groq fallback was NOT invoked on primary success');
  });

  test('Gemini failure → Groq fallback succeeds (via interpreter.runOneCall)', async () => {
    const geminiTracker: ProviderTracker = { calls: 0 };
    const groqTracker: ProviderTracker = { calls: 0 };

    const gemini = makeMockGemini(true, geminiTracker);  // FAILS
    const groq = makeMockGroq(groqTracker);              // SUCCEEDS
    const gw = new LLMGateway(gemini, groq, groq, 5000, 1);
    (llmGateway as any).generate = gw.generate.bind(gw);

    const ctx = makeCtx();
    const result = await runOneCall('mau beli ayam goreng', ctx);

    assert.ok(result, 'Interpreter returned a non-null result after fallback');
    assert.ok(geminiTracker.calls >= 1, 'Gemini primary was attempted >=1 time (got: ' + geminiTracker.calls + ')');
    assert.ok(groqTracker.calls >= 1, 'Groq fallback was attempted after Gemini failure (got: ' + groqTracker.calls + ')');
    assert.equal(result!.intent, 'buy', 'Result from Groq fallback');
  });
});
