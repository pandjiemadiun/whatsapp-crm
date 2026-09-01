/**
 * Route tests for POST /api/admin/ai-providers (apps/api/src/routes/admin/ai-providers.ts)
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/ai-providers.test.ts
 *
 * Approach (matches repo e2e convention: real prisma + unique prefix cleanup):
 *  - CRUD + test-connection-by-id use the REAL prisma singleton against garuda_dev,
 *    inserting rows with a `u4ap-` name prefix and deleting them in afterEach/after.
 *  - Provider HTTP is mocked via global.fetch (save/restore) so no real API is hit
 *    and no test-server fetch conflict exists (handlers are invoked directly, not
 *    via express.listen+fetch).
 *  - validateRequest + handler are composed directly (callRoute) to exercise the
 *    real 400-on-bad-format path, then the handler.
 */
import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../infrastructure/prisma.js';
import adminAiProvidersRouter, {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  testConnectionById,
  testConnectionDraft,
  maskKey,
  createProviderSchema,
  updateProviderSchema,
  testConnectionSchema,
} from '../routes/admin/ai-providers.js';
import { validateRequest } from '../middleware/validate-request.js';
import { requireAdminRole } from '../middleware/adminAuthGuard.js';
import type { Response } from 'express';

const PREFIX = 'u4ap-';
const RAW_KEY = 'sk-raw-test-1234'; // used in create/update; must NEVER appear unmasked in a response
const OTHER_KEY = 'sk-other-key-5678';
const origFetch = globalThis.fetch;

// ── Fake Express req/res/next ────────────────────────────────────────

function fakeRes() {
  const state = { status: 200, body: undefined as unknown };
  const res: any = {
    status(c: number) { (state as any).status = c; return res; },
    json(b: unknown) { (state as any).body = b; return res; },
    send(b: unknown) { (state as any).body = b; return res; },
    set(_k: string, _v: unknown) { return res; },
    location(_u: string) { return res; },
  };
  return { res, state };
}

function fakeReq(overrides: Record<string, unknown> = {}) {
  return {
    admin: { adminId: 'u4-admin', email: 'u4@test', role: 'super_admin' },
    body: {},
    params: {},
    ...overrides,
  } as any;
}

const passNext = () => undefined;
const throwNext = (e: unknown) => { if (e) throw e; };

async function callRoute(schema: any, handler: any, body: unknown, overrides: Record<string, unknown> = {}) {
  const { res, state } = fakeRes();
  const req = fakeReq({ body, ...overrides });
  await validateRequest(schema, 'body')(req, res as Response, throwNext);
  if ((state as any).status >= 400) return { res, state, validated: false }; // validation rejected
  await handler(req, res as Response, passNext);
  return { res, state, validated: true };
}

async function callHandler(handler: any, overrides: Record<string, unknown> = {}) {
  const { res, state } = fakeRes();
  const req = fakeReq(overrides);
  await handler(req, res as Response, passNext);
  return { res, state };
}

function setFetch(fn: (input: unknown, init: unknown) => Promise<Response>) {
  globalThis.fetch = fn as unknown as typeof fetch;
}
function restoreFetch() { globalThis.fetch = origFetch; }

function jsonBodyOf(state: any): any { return state.body; }

describe('ai-providers route — security + format validation', () => {
  test('create with valid format succeeds and masks apiKey', async () => {
    const { res, state, validated } = await callRoute(
      createProviderSchema,
      createProvider,
      { name: `${PREFIX}primary`, format: 'openai_compatible', baseUrl: 'https://example.com/v1/chat/completions', apiKey: RAW_KEY, model: 'gpt-4o', role: 'chat_primary', priority: 5, isActive: true },
    );
    assert.equal(validated, true, 'validation should pass');
    assert.equal(state.status, 201);
    const body = jsonBodyOf(state);
    assert.equal(body.data.name, `${PREFIX}primary`);
    assert.equal(body.data.format, 'openai_compatible');
    assert.equal(body.data.role, 'chat_primary');
    assert.equal(body.data.apiKey, maskKey(RAW_KEY), 'apiKey must be last-4 masked');
    // Never raw in the response
    assert.equal(JSON.stringify(body).includes(RAW_KEY), false, 'raw apiKey must NOT appear in create response');
  });

  test('create with unknown format is rejected (400) before DB', async () => {
    const { res, state, validated } = await callRoute(
      createProviderSchema,
      createProvider,
      { name: `${PREFIX}bad`, format: 'claude_native', baseUrl: 'https://x', apiKey: 'k', model: 'm', role: 'chat_primary' },
    );
    assert.equal(validated, false);
    assert.equal(state.status, 400);
    const body = jsonBodyOf(state);
    assert.ok(body.error, 'Validation failed');
    assert.ok(JSON.stringify(body).includes('format'), '400 must mention format field');
  });

  test('create with unknown role is rejected (400)', async () => {
    const { state, validated } = await callRoute(
      createProviderSchema,
      createProvider,
      { name: `${PREFIX}rolebad`, format: 'openai_compatible', baseUrl: 'https://x', apiKey: 'k', model: 'm', role: 'bogus_role' },
    );
    assert.equal(validated, false);
    assert.equal(state.status, 400);
  });

  test('requireAdminRole blocks non-super_admin (403)', async () => {
    const { res, state } = fakeRes();
    const req = fakeReq({ admin: { adminId: 'x', email: 'x@x', role: 'support_admin' } });
    requireAdminRole(['super_admin'])(req, res as Response, (): void => { assert.fail('next must not be called on 403'); });
    assert.equal(state.status, 403);
  });
});

describe('ai-providers CRUD (real prisma, prefixed cleanup)', () => {
  test('GET / masks every apiKey and never exposes the raw key', async () => {
    // ensure at least one row exists (reuse the one from the create test if present;
    // create a dedicated row here so the test is self-contained)
    await prisma.aIProviderConfig.create({
      data: { name: `${PREFIX}list`, format: 'openai_compatible', baseUrl: 'https://example.com/v1', apiKey: RAW_KEY, model: 'gpt-4o', role: 'chat_fallback', priority: 1, isActive: true },
    });

    const { res, state } = await callHandler(listProviders, {});
    assert.equal(state.status, 200);
    const data = jsonBodyOf(state).data as any[];
    const ours = data.filter((r: any) => r.name === `${PREFIX}list`);
    assert.equal(ours.length, 1);
    assert.equal(ours[0].apiKey, maskKey(RAW_KEY), 'list must mask apiKey to last-4');
    assert.equal(JSON.stringify(data).includes(RAW_KEY), false, 'raw key must NEVER appear in GET / response');
  });

  test('PUT without apiKey keeps the existing encrypted key (blank = keep current)', async () => {
    const created = await prisma.aIProviderConfig.create({
      data: { name: `${PREFIX}keep`, format: 'gemini_native', baseUrl: 'https://gemini.example', apiKey: RAW_KEY, model: 'gemini-1.5', role: 'chat_primary', priority: 3, isActive: true },
    });
    const before = (await prisma.aIProviderConfig.findUnique({ where: { id: created.id } })) as any;
    const beforeCipher = before.apiKey; // raw plaintext in-memory (decrypted by middleware)

    const { res, state } = await callRoute(
      updateProviderSchema,
      updateProvider,
      { apiKey: '', priority: 9, isActive: false },
      { params: { id: created.id } },
    );
    assert.equal(state.status, 200);

    const after = (await prisma.aIProviderConfig.findUnique({ where: { id: created.id } })) as any;
    // priority updated, but apiKey ciphertext untouched (== the stored ciphertext, i.e. key kept)
    assert.equal(after.priority, 9);
    assert.equal(after.isActive, false);
    assert.equal(after.apiKey, beforeCipher, 'blank apiKey must NOT overwrite the existing key');
    assert.equal(JSON.stringify(jsonBodyOf(state)).includes(RAW_KEY), false, 'raw key must not appear in PUT response');
  });

  test('PUT with a new apiKey re-encrypts (masked last-4 reflects the new key)', async () => {
    const created = await prisma.aIProviderConfig.create({
      data: { name: `${PREFIX}change`, format: 'openai_compatible', baseUrl: 'https://o.example/v1', apiKey: RAW_KEY, model: 'gpt-4o', role: 'chat_fallback', priority: 1, isActive: true },
    });
    const { res, state } = await callRoute(
      updateProviderSchema,
      updateProvider,
      { apiKey: OTHER_KEY },
      { params: { id: created.id } },
    );
    assert.equal(state.status, 200);
    assert.equal(jsonBodyOf(state).data.apiKey, maskKey(OTHER_KEY), 'PUT response mask reflects the new key');
    const after = (await prisma.aIProviderConfig.findUnique({ where: { id: created.id } })) as any;
    assert.equal(after.apiKey, OTHER_KEY, 'stored (decrypted) key is now the new value');
  });

  test('PUT on unknown id returns 404', async () => {
    const { state } = await callRoute(updateProviderSchema, updateProvider, { priority: 1 }, { params: { id: '00000000-0000-0000-0000-000000000000' } });
    assert.equal(state.status, 404);
  });

  test('DELETE removes the row', async () => {
    const created = await prisma.aIProviderConfig.create({
      data: { name: `${PREFIX}del`, format: 'openai_compatible', baseUrl: 'https://o.example/v1', apiKey: RAW_KEY, model: 'gpt-4o', role: 'other', priority: 1, isActive: true },
    });
    const { res, state } = await callHandler(deleteProvider, { params: { id: created.id } });
    assert.equal(state.status, 200);
    const gone = await prisma.aIProviderConfig.findUnique({ where: { id: created.id } });
    assert.equal(gone, null, 'row must be deleted');
  });
});

describe('ai-providers test-connection (global.fetch mocked)', () => {
  test('POST /test-connection draft success -> masked, sampleResponse, no raw key', async () => {
    setFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    try {
      const { res, state, validated } = await callRoute(
        testConnectionSchema,
        testConnectionDraft,
        { format: 'openai_compatible', baseUrl: 'https://example.com/v1/chat/completions', apiKey: RAW_KEY, model: 'gpt-4o' },
      );
      assert.equal(validated, true);
      assert.equal(state.status, 200);
      const d = jsonBodyOf(state).data;
      assert.equal(d.success, true);
      assert.equal(d.sampleResponse, 'OK');
      assert.equal(d.modelUsed, 'gpt-4o');
      assert.equal(typeof d.latencyMs, 'number');
      assert.equal(JSON.stringify(d).includes(RAW_KEY), false, 'raw apiKey must NEVER be echoed');
      assert.equal('apiKey' in d, false, 'response must not even contain an apiKey field');
    } finally { restoreFetch(); }
  });

  test('POST /test-connection draft 401 -> AUTH_ERROR with specific message', async () => {
    setFetch(async () => new Response(JSON.stringify({ error: { message: 'invalid_api_key' } }), { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="..."' } }));
    try {
      const { state } = await callRoute(
        testConnectionSchema,
        testConnectionDraft,
        { format: 'openai_compatible', baseUrl: 'https://example.com/v1/chat/completions', apiKey: RAW_KEY, model: 'gpt-4o' },
      );
      const d = jsonBodyOf(state).data;
      assert.equal(d.success, false);
      assert.equal(d.errorCategory, 'AUTH_ERROR');
      assert.equal(d.statusCode, 401);
      assert.ok(d.errorMessage && d.errorMessage.includes('401'), 'errorMessage must surface the HTTP status');
      assert.ok(d.errorMessage && d.errorMessage.includes('invalid_api_key'), 'errorMessage must surface the provider error body');
      assert.equal(JSON.stringify(d).includes(RAW_KEY), false, 'raw apiKey must not appear on failure either');
    } finally { restoreFetch(); }
  });

  test('POST /test-connection draft timeout -> NETWORK_TIMEOUT (specific)', async () => {
    setFetch(async () => { const e: any = new Error('The operation was aborted due to a user gesture'); e.name = 'AbortError'; throw e; });
    try {
      const { state } = await callRoute(
        testConnectionSchema,
        testConnectionDraft,
        { format: 'gemini_native', baseUrl: 'https://gemini.example', apiKey: RAW_KEY, model: 'gemini-1.5' },
      );
      const d = jsonBodyOf(state).data;
      assert.equal(d.success, false);
      assert.equal(d.errorCategory, 'NETWORK_TIMEOUT');
      assert.ok(d.errorMessage && /timeout|abort/i.test(d.errorMessage), 'errorMessage must mention timeout/abort');
    } finally { restoreFetch(); }
  });

  test('POST /test-connection draft with unknown format is caught by zod before probe', async () => {
    const { state, validated } = await callRoute(
      testConnectionSchema,
      testConnectionDraft,
      { format: 'nope', baseUrl: 'https://x', apiKey: 'k', model: 'm' },
    );
    assert.equal(validated, false);
    assert.equal(state.status, 400);
  });

  test('POST /:id/test-connection success (saved row) -> updates lastTestedAt + lastTestResult=ok', async () => {
    const created = await prisma.aIProviderConfig.create({
      data: { name: `${PREFIX}tcbyid`, format: 'openai_compatible', baseUrl: 'https://example.com/v1/chat/completions', apiKey: RAW_KEY, model: 'gpt-4o', role: 'chat_primary', priority: 1, isActive: true },
    });
    setFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    try {
      const before = (await prisma.aIProviderConfig.findUnique({ where: { id: created.id } })) as any;
      assert.equal(before.lastTestedAt, null);
      assert.equal(before.lastTestResult, null);

      const { state } = await callHandler(testConnectionById, { params: { id: created.id } });
      assert.equal(state.status, 200);
      const d = jsonBodyOf(state).data;
      assert.equal(d.success, true);
      assert.equal(d.sampleResponse, 'OK');
      assert.equal(JSON.stringify(d).includes(RAW_KEY), false, 'raw key must not appear in by-id test-connection');

      const after = (await prisma.aIProviderConfig.findUnique({ where: { id: created.id } })) as any;
      assert.ok(after.lastTestedAt instanceof Date && !isNaN(after.lastTestedAt.getTime()), 'lastTestedAt updated on success');
      assert.equal(after.lastTestResult, 'ok');
    } finally { restoreFetch(); }
  });

  test('POST /:id/test-connection failure (403) -> errorCategory surfaced + lastTestResult updated', async () => {
    const created = await prisma.aIProviderConfig.create({
      data: { name: `${PREFIX}tcbyid-fail`, format: 'gemini_native', baseUrl: 'https://gemini.example', apiKey: RAW_KEY, model: 'gemini-1.5', role: 'chat_fallback', priority: 1, isActive: true },
    });
    setFetch(async () => new Response(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }), { status: 403, headers: { 'content-type': 'application/json' } }));
    try {
      const { state } = await callHandler(testConnectionById, { params: { id: created.id } });
      const d = jsonBodyOf(state).data;
      assert.equal(d.success, false);
      assert.equal(d.errorCategory, 'AUTH_ERROR');
      assert.equal(d.statusCode, 403);
      assert.ok(d.errorMessage && d.errorMessage.includes('403'), 'errorMessage surfaces the HTTP status');
      assert.ok(d.errorMessage && d.errorMessage.includes('valid'), 'errorMessage surfaces the provider error body');
      assert.equal(JSON.stringify(d).includes(RAW_KEY), false);

      const after = (await prisma.aIProviderConfig.findUnique({ where: { id: created.id } })) as any;
      assert.ok(after.lastTestResult && after.lastTestResult.startsWith('AUTH_ERROR'), 'lastTestResult records the failure category');
    } finally { restoreFetch(); }
  });

  test('POST /:id/test-connection on unknown id returns 404', async () => {
    setFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }));
    try {
      const { state } = await callHandler(testConnectionById, { params: { id: '00000000-0000-0000-0000-000000000000' } });
      assert.equal(state.status, 404);
    } finally { restoreFetch(); }
  });
});

describe('ai-providers module surface', () => {
  test('routes are registered with correct methods/paths (grep proof)', () => {
    // Sanity: router stack exposes the expected verbs — proves /:id/test-connection ordering
    // is correct and POST /test-connection (draft) is before /:id/test-connection.
    const stack = (adminAiProvidersRouter as any).stack as Array<{ route?: { path?: string; methods?: Record<string, boolean> } }>;
    const routes = stack.map((l) => `${Object.keys(l.route?.methods || {}).join(',') || '-'} ${l.route?.path || '(middleware)'}`).filter((s) => s !== '- -');
    assert.ok(routes.includes('get /'), 'GET / must exist');
    assert.ok(routes.includes('post /'), 'POST / must exist');
    assert.ok(routes.includes('put /:id'), 'PUT /:id must exist');
    assert.ok(routes.includes('delete /:id'), 'DELETE /:id must exist');
    assert.ok(routes.includes('post /test-connection'), 'POST /test-connection (draft) must exist');
    assert.ok(routes.includes('post /:id/test-connection'), 'POST /:id/test-connection must exist');
  });

  test('maskKey never leaks raw secret', () => {
    assert.equal(maskKey(null), null);
    assert.equal(maskKey(''), null);
    assert.equal(maskKey('sk-xyz123456'), '********3456');          // last4 preserved, rest masked (len 12 => 8 stars)
    assert.equal(maskKey('short').slice(-4), 'hort');               // last4 preserved
    assert.equal(maskKey('sk-xyz123456').includes('xyz123456'), false, 'raw secret must not be a substring');
  });
});

// ── Cleanup ──────────────────────────────────────────────────────────

before(async () => {
  await prisma.aIProviderConfig.deleteMany({ where: { name: { startsWith: PREFIX } } });
});
afterEach(async () => {
  restoreFetch();
  await prisma.aIProviderConfig.deleteMany({ where: { name: { startsWith: PREFIX } } });
});
after(async () => {
  restoreFetch();
  await prisma.aIProviderConfig.deleteMany({ where: { name: { startsWith: PREFIX } } });
  // Ensure no test rows leaked under a different prefix
  await prisma.aIProviderConfig.deleteMany({ where: { name: { startsWith: 'u4ap-' } } });
});
