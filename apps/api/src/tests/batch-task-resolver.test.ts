/**
 * Unit 5 Parts 3 & 4 — batch_task resolver fallback.
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/batch-task-resolver.test.ts
 *
 * These tests confirm the EXACT safety property Part 3 & 4 rely on:
 *   `aiProviderResolver.getProvidersForRole('batch_task')` returns [] when no
 *   AIProviderConfig rows exist for the 'batch_task' role, so the cutover in
 *   learning.service.ts:142 and scheduleFollowUps.ts:279 selects the groqAdapter
 *   singleton (the documented fallback). The resolver's existing empty-array
 *   behavior handles the "no config" case naturally — no separate boolean flag.
 *
 * Hermetic: we assert provider IDENTITY (getName / typeof generate), we never
 * invoke .generate(), so no real API key / network is touched.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aiProviderResolver } from '../services/ai-provider-resolver.service.js';
import { groqAdapter } from '../adapters/ai/groq.adapter.js';
import type { AIProvider } from '../adapters/ai/types.js';

describe('Unit 5 Parts 3 & 4 — batch_task resolver fallback', () => {
  test('resolver returns [] for batch_task (no AIProviderConfig rows seeded) -> groqAdapter fallback', async () => {
    const batchProviders = await aiProviderResolver.getProvidersForRole('batch_task');
    assert.equal(Array.isArray(batchProviders), true);

    // Replicate the EXACT selection the cutover uses in learning.service.ts
    // (FAQ clustering) and scheduleFollowUps.ts (follow-up message generation).
    const selected: AIProvider = batchProviders.length > 0 ? batchProviders[0] : groqAdapter;
    assert.equal(
      selected.getName(),
      groqAdapter.getName(),
      'with no batch_task rows, the groqAdapter singleton is selected as fallback',
    );
    assert.equal(
      batchProviders.length,
      0,
      'batch_task role currently has no configured providers (table count = 0)',
    );
  });

  test('the selected provider is callable but never invoked here (no network)', async () => {
    const providers = await aiProviderResolver.getProvidersForRole('batch_task');
    const selected = (providers.length > 0 ? providers[0] : groqAdapter) as AIProvider;
    assert.equal(typeof selected.generate, 'function');
    assert.equal(typeof selected.getName, 'function');
    // No .generate() call above — this test does not hit any LLM.
  });
});
