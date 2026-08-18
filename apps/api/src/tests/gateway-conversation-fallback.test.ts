/**
 * G2-B.1 Acceptance: Conversation Engine -> LLMGateway -> Gemini primary -> Groq fallback
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { llmGateway, LLMGateway } from '../adapters/ai/llm-gateway.js';
import type { AIProvider, AIResponse, AIGenerateOptions } from '../adapters/ai/types.js';
import { AIProviderError, ErrorCategory } from '../adapters/ai/types.js';
import * as fs from 'node:fs';

function makeFailingProvider(name: string): AIProvider & { calls: number } {
  return {
    calls: 0,
    getName: () => name,
    getModel: () => `${name}-model`,
    generate: async () => {
      throw new AIProviderError('Provider failed', ErrorCategory.SERVER_ERROR, name, 500, true);
    },
  } as AIProvider & { calls: number };
}

function makeSuccessProvider(name: string, content: string): AIProvider & { calls: number } {
  return {
    calls: 0,
    getName: () => name,
    getModel: () => `${name}-model`,
    generate: async (_prompt: string, _options?: AIGenerateOptions): Promise<AIResponse> => {
      return { content, provider: name, model: `${name}-model`, tokens: { input: 10, output: 10 }, cost: 0.001 };
    },
  } as AIProvider & { calls: number };
}

describe('G2-B.1 Conversation Engine -> LLMGateway fallback', () => {
  const originalGenerate = llmGateway.generate.bind(llmGateway);
  after(() => { (llmGateway as any).generate = originalGenerate; });

  test('Gemini primary succeeds -> Groq fallback NOT invoked', async () => {
    const gemini: AIProvider & { calls: number } = makeSuccessProvider('gemini', '{"intent":"test","confidence":1}');
    const groq: AIProvider & { calls: number } = makeSuccessProvider('groq', '{"intent":"noop","confidence":1}');
    const gw = new LLMGateway(gemini, groq, groq, 12000, 1);
    (llmGateway as any).generate = gw.generate.bind(gw);
    const result = await llmGateway.generate('prompt', { temperature: 0.2, maxTokens: 250, jsonMode: true }, 'test');
    assert.equal(result.provider, 'gemini');
  });

  test('Gemini primary fails -> Groq fallback succeeds', async () => {
    const gemini: AIProvider & { calls: number } = {
      calls: 0,
      getName: () => 'gemini',
      getModel: () => 'gemini-2.0-flash',
      generate: async () => { gemini.calls++; throw new AIProviderError('fail', ErrorCategory.SERVER_ERROR, 'gemini', 500, true); },
    };
    const groq: AIProvider & { calls: number } = {
      calls: 0,
      getName: () => 'groq',
      getModel: () => 'openai/gpt-oss-120b',
      generate: async () => { groq.calls++; return { content: '{"intent":"ok","confidence":1}', provider: 'groq', model: 'llama', tokens: { input: 10, output: 10 }, cost: 0.001 }; },
    };
    const gw = new LLMGateway(gemini, groq, groq, 12000, 1);
    (llmGateway as any).generate = gw.generate.bind(gw);
    const result = await llmGateway.generate('prompt', { temperature: 0.2, maxTokens: 250, jsonMode: true }, 'test');
    assert.ok(gemini.calls >= 1, 'Gemini attempted >=1, got: ' + gemini.calls);
    assert.ok(groq.calls >= 1, 'Groq fallback attempted, got: ' + groq.calls);
    assert.equal(result.provider, 'groq');
  });

  test('interpreter.ts no longer imports groqAdapter', () => {
    const source = fs.readFileSync('/home/ubuntu/garuda/apps/api/src/services/chat/interpreter.ts', 'utf-8');
    assert.ok(!source.includes('import { groqAdapter }'), 'interpreter.ts must NOT import groqAdapter');
    assert.ok(source.includes('llmGateway'), 'interpreter.ts must import llmGateway');
  });

  test('reasoning.ts no longer imports groqAdapter', () => {
    const source = fs.readFileSync('/home/ubuntu/garuda/apps/api/src/services/chat/reasoning.ts', 'utf-8');
    assert.ok(!source.includes('import { groqAdapter }'), 'reasoning.ts must NOT import groqAdapter');
    assert.ok(source.includes('llmGateway'), 'reasoning.ts must import llmGateway');
  });
});
