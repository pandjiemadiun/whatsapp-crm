/**
 * AIProviderResolverService unit tests (Unit 3a).
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/ai-provider-resolver.service.test.ts
 *
 * The resolver's data dependency (findMany) is injected, so these tests use a
 * fake in-memory store — no database, no real API.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AIProviderResolverService, type ProviderRow } from '../services/ai-provider-resolver.service.js';
import { OpenAICompatibleAdapter } from '../adapters/ai/openai-compatible.adapter.js';
import { GeminiShimAdapter } from '../adapters/ai/gemini-shim.adapter.js';

interface FindManyArgs {
  where?: { role?: string; isActive?: boolean };
  orderBy?: { priority?: 'asc' | 'desc' };
}

interface FakeDb {
  findMany: (args: FindManyArgs) => Promise<ProviderRow[]>;
  calls: FindManyArgs[];
}

function makeDb(rowsByRole: Record<string, ProviderRow[]> = {}): FakeDb {
  const calls: FindManyArgs[] = [];
  const findMany = async (args: FindManyArgs): Promise<ProviderRow[]> => {
    calls.push(args);
    const role = args.where?.role;
    let rows = rowsByRole[role ?? ''] ?? [];
    // simulate the Prisma middleware + DB: isActive filter + orderBy priority desc
    if (args.where?.isActive === true) {
      rows = rows.filter((r) => r.isActive);
    }
    if (args.orderBy?.priority === 'desc') {
      rows = [...rows].sort((a, b) => b.priority - a.priority);
    }
    return rows;
  };
  return { findMany, calls };
}

const GEMINI_PRIMARY: ProviderRow[] = [
  {
    name: 'Gemini Primary', format: 'gemini_native',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'key-primary',
    model: 'gemini-2.0-flash', role: 'chat_primary', priority: 1, isActive: true,
  },
];

const GROQ_FALLBACK: ProviderRow[] = [
  { name: 'Groq Key 2', format: 'openai_compatible', baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKey: 'key-2', model: 'llama-3', role: 'chat_fallback', priority: 1, isActive: true },
  { name: 'Groq Key 1', format: 'openai_compatible', baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKey: 'key-1', model: 'llama-3', role: 'chat_fallback', priority: 5, isActive: true },
  { name: 'Groq Disabled', format: 'openai_compatible', baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKey: 'key-x', model: 'llama-3', role: 'chat_fallback', priority: 9, isActive: false },
];

describe('AIProviderResolverService', () => {
  test('R1: returns providers in priority-desc order, excluding inactive rows', async () => {
    const db = makeDb({ chat_fallback: GROQ_FALLBACK });
    const resolver = new AIProviderResolverService(db.findMany);

    const providers = await resolver.getProvidersForRole('chat_fallback');

    assert.equal(db.calls.length, 1);
    assert.deepEqual(db.calls[0].where, { role: 'chat_fallback', isActive: true }); // inactive excluded at query level
    assert.equal(db.calls[0].orderBy?.priority, 'desc');

    assert.equal(providers.length, 2); // the disabled row (priority 9, isActive:false) is filtered
    // priority desc -> "Groq Key 1" (priority 5) before "Groq Key 2" (priority 1)
    assert.equal(providers[0].getName(), 'Groq Key 1');
    assert.equal(providers[1].getName(), 'Groq Key 2');
    assert.equal(providers[0].getModel(), 'llama-3');
  });

  test('R2: maps format -> adapter type (openai_compatible vs gemini_native)', async () => {
    const db = makeDb({ chat_primary: GEMINI_PRIMARY, chat_fallback: GROQ_FALLBACK });
    const resolver = new AIProviderResolverService(db.findMany);

    const [gemini] = await resolver.getProvidersForRole('chat_primary');
    const [groq] = await resolver.getProvidersForRole('chat_fallback');

    assert.ok(gemini instanceof GeminiShimAdapter);
    assert.equal(gemini.getName(), 'Gemini Primary');
    assert.ok(groq instanceof OpenAICompatibleAdapter);
  });

  test('R3: inactive providers excluded', async () => {
    const db = makeDb({ chat_fallback: GROQ_FALLBACK });
    const resolver = new AIProviderResolverService(db.findMany);

    const providers = await resolver.getProvidersForRole('chat_fallback');
    assert.equal(providers.length, 2); // "Groq Disabled" filtered out
  });

  test('R4: unknown format throws a clear error (fails loud, no silent skip)', async () => {
    const badRow: ProviderRow = {
      name: 'Broken', format: 'llama_cpp', baseUrl: 'http://x', apiKey: 'y',
      model: 'm', role: 'wizard', priority: 1, isActive: true,
    };
    const db = makeDb({ wizard: [badRow] });
    const resolver = new AIProviderResolverService(db.findMany);

    await assert.rejects(
      () => resolver.getProvidersForRole('wizard'),
      (err: Error) =>
        err.message.includes('unknown format') && err.message.includes('llama_cpp'),
    );
  });

  test('R5: empty role returns [] (caller decides fallback)', async () => {
    const db = makeDb({});
    const resolver = new AIProviderResolverService(db.findMany);

    const providers = await resolver.getProvidersForRole('chat_gatekeeper');
    assert.deepEqual(providers, []);
  });

  test('R6: cache — second call for the same role does not re-invoke findMany', async () => {
    const db = makeDb({ chat_primary: GEMINI_PRIMARY });
    const resolver = new AIProviderResolverService(db.findMany);

    await resolver.getProvidersForRole('chat_primary');
    await resolver.getProvidersForRole('chat_primary');

    assert.equal(db.calls.length, 1); // served from cache
  });
});
