/**
 * Integration tests for /api/admin/ai-providers — proves the route is actually
 * registered and reachable over HTTP (the class of bug that handler-level
 * unit tests can't catch: a route that compiles but is never mounted).
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/ai-providers.e2e.test.ts
 *
 * Mounts the real router with the same middleware chain as index.ts
 * (adminAuthMiddleware + requireAdminRole(['super_admin'])), then makes
 * real HTTP requests via fetch against an ephemeral listen socket.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { prisma } from '../infrastructure/prisma.js';
import adminAiProvidersRoutes from '../routes/admin/ai-providers.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import { requireAdminRole } from '../middleware/adminAuthGuard.js';

const PREFIX = 'u4ap-e2e-';
const RAW_KEY = 'sk-e2e-test-1234';

let server: Server;
let baseUrl = '';
let token = '';
let adminId = '';

function jsonFetch(path: string, options: any = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
}

before(async () => {
  adminId = crypto.randomUUID();
  token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.adminUser.upsert({
    where: { id: adminId },
    update: { role: 'super_admin', isActive: true },
    create: {
      id: adminId,
      email: `${PREFIX}@test`,
      passwordHash: 'x',
      role: 'super_admin',
      isActive: true,
    },
  });
  await prisma.adminAuthToken.create({
    data: { adminUserId: adminId, token, expiresAt },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/admin/ai-providers', adminAuthMiddleware, requireAdminRole(['super_admin']), adminAiProvidersRoutes);
  app.use((_req, res) => res.status(404).json({ error: 'Route not found', code: 'ERR_NOT_FOUND' }));

  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s as unknown as Server));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await prisma.aIProviderConfig.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.adminAuthToken.deleteMany({ where: { token } });
  await prisma.adminUser.deleteMany({ where: { id: adminId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('ai-providers HTTP integration (route registration + reachability)', () => {
  test('POST / without auth is rejected 401 (auth middleware runs)', async () => {
    const res = await jsonFetch('/api/admin/ai-providers', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', format: 'openai_compatible', baseUrl: 'https://x', apiKey: 'k', model: 'm', role: 'other' }),
    });
    assert.equal(res.status, 401, 'no auth => 401');
  });

  test('POST / with auth creates a provider → 201 + masked apiKey', async () => {
    const res = await jsonFetch('/api/admin/ai-providers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: `${PREFIX}create`,
        format: 'openai_compatible',
        baseUrl: 'https://example.com/v1/chat/completions',
        apiKey: RAW_KEY,
        model: 'gpt-4o',
        role: 'other',
        priority: 0,
        isActive: true,
      }),
    });
    assert.equal(res.status, 201, 'create must return 201');
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.name, `${PREFIX}create`);
    assert.equal(body.data.apiKey, '************1234', 'apiKey must be last-4 masked');
    assert.equal(JSON.stringify(body).includes(RAW_KEY), false, 'raw apiKey must NOT appear in response');
  });

  test('POST / with invalid format → 400 validation error (not 404)', async () => {
    const res = await jsonFetch('/api/admin/ai-providers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: `${PREFIX}bad`, format: 'claude_native', baseUrl: 'https://x', apiKey: 'k', model: 'm', role: 'other' }),
    });
    assert.equal(res.status, 400, 'bad format => 400');
    const body = await res.json();
    assert.equal(body.error, 'Validation failed');
  });

  test('POST /test-connection with invalid upstream key → 200 + structured error body (NOT a thrown exception)', async () => {
    const res = await jsonFetch('/api/admin/ai-providers/test-connection', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        format: 'openai_compatible',
        baseUrl: 'https://api.mistral.ai/v1/chat/completions',
        apiKey: 'invalid-key',
        model: 'mistral-small',
      }),
    });
    assert.equal(res.status, 200, 'test-connection must return HTTP 200 even when upstream fails');
    const body = await res.json();
    assert.equal(body.success, true, 'outer success is true (request itself succeeded)');
    assert.equal(body.data.success, false, 'inner success is false (provider rejected)');
    assert.ok(body.data.errorCategory, 'errorCategory must be present (not UNKNOWN)');
    assert.notEqual(body.data.errorCategory, 'UNKNOWN', 'category must be specific, never UNKNOWN');
    assert.ok(body.data.errorMessage, 'errorMessage must be present');
    assert.equal(JSON.stringify(body).includes('invalid-key'), false, 'raw apiKey must NOT appear');
  });

  test('GET / with auth → 200 + list (route is registered)', async () => {
    const res = await jsonFetch('/api/admin/ai-providers', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200, 'GET / must return 200 — proves route is registered');
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
  });
});
