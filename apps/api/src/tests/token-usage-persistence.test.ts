/**
 * Tests for token usage persistence (Unit 1).
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/token-usage-persistence.test.ts
 *
 * Verifies:
 *  1. logTokenUsage() persists a TokenUsageLog row to DB (fire-and-forget)
 *  2. DB write failure does NOT throw or break the response path
 *  3. queryUsage() returns correct aggregation for a given time range
 *  4. The HTTP query endpoint returns correct aggregation
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import express from 'express';
import { prisma } from '../infrastructure/prisma.js';
import { logTokenUsage, queryUsage, validateTimeRange } from '../services/token-usage-tracker.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import { requireAdminRole } from '../middleware/adminAuthGuard.js';

const PREFIX = 'u4tu-';
const RAW_KEY = 'sk-tu-test-1234';

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
  app.use('/api/admin/config', adminAuthMiddleware, requireAdminRole(['super_admin']), (await import('../routes/admin/config.js')).default);
  app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s as unknown as Server));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});

beforeEach(async () => {
  await prisma.tokenUsageLog.deleteMany({});
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await prisma.tokenUsageLog.deleteMany({});
  await prisma.adminAuthToken.deleteMany({ where: { token } });
  await prisma.adminUser.deleteMany({ where: { id: adminId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('token usage persistence', () => {
  test('logTokenUsage() writes a TokenUsageLog row to DB', async () => {
    logTokenUsage({
      timestamp: Date.now(),
      provider: `${PREFIX}mistral`,
      role: 'chat_primary',
      model: 'mistral-small',
      intent: 'general',
      conversationId: 'test-conv',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.001,
    });

    // Fire-and-forgive: poll for the row (max 5s)
    let row = null;
    for (let i = 0; i < 50; i++) {
      row = await prisma.tokenUsageLog.findFirst({ where: { provider: `${PREFIX}mistral` } });
      if (row) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    assert.ok(row, 'TokenUsageLog row should be written to DB');
    assert.equal(row!.provider, `${PREFIX}mistral`);
    assert.equal(row!.role, 'chat_primary');
    assert.equal(row!.model, 'mistral-small');
    assert.equal(row!.inputTokens, 100);
    assert.equal(row!.outputTokens, 50);
    assert.equal(row!.costUsd, 0.001);
  });

  test('DB write failure does NOT throw or break the response path', async () => {
    // Mock prisma.tokenUsageLog.create to throw
    const originalCreate = prisma.tokenUsageLog.create;
    let createCalled = false;
    (prisma.tokenUsageLog as any).create = async () => {
      createCalled = true;
      throw new Error('DB write failed (simulated)');
    };

    try {
      // This must NOT throw
      let threw = false;
      try {
        logTokenUsage({
          timestamp: Date.now(),
          provider: `${PREFIX}fail-test`,
          role: 'chat_fallback',
          model: 'test-model',
          intent: 'general',
          conversationId: 'fail-conv',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          costUsd: 0.0001,
        });
      } catch {
        threw = true;
      }

      assert.equal(threw, false, 'logTokenUsage must not throw on DB failure');
      assert.equal(createCalled, true, 'create should have been attempted');

      // Give the fire-and-forget a moment to settle
      await new Promise((r) => setTimeout(r, 200));

      // No row should be written
      const row = await prisma.tokenUsageLog.findFirst({ where: { provider: `${PREFIX}fail-test` } });
      assert.equal(row, null, 'no row should be written on DB failure');
    } finally {
      // Restore
      (prisma.tokenUsageLog as any).create = originalCreate;
    }
  });

  test('queryUsage() returns correct aggregation for a given range', async () => {
    const now = Date.now();

    // Seed rows: 2 within range, 1 outside range
    await prisma.tokenUsageLog.createMany({
      data: [
        { provider: `${PREFIX}mistral`, role: 'chat_primary', model: 'mistral-small', inputTokens: 100, outputTokens: 50, costUsd: 0.001, createdAt: new Date(now - 60 * 60 * 1000) }, // 1h ago (in range)
        { provider: `${PREFIX}mistral`, role: 'chat_primary', model: 'mistral-small', inputTokens: 200, outputTokens: 100, costUsd: 0.002, createdAt: new Date(now - 2 * 60 * 60 * 1000) }, // 2h ago (in range)
        { provider: `${PREFIX}sambanova`, role: 'chat_fallback', model: 'MiniMax-M2.7', inputTokens: 300, outputTokens: 150, costUsd: 0.003, createdAt: new Date(now - 3 * 60 * 60 * 1000) }, // 3h ago (in range)
        { provider: `${PREFIX}mistral`, role: 'chat_primary', model: 'mistral-small', inputTokens: 999, outputTokens: 999, costUsd: 0.999, createdAt: new Date(now - 25 * 60 * 60 * 1000) }, // 25h ago (OUT of range)
      ],
    });

    const result = await queryUsage({
      from: new Date(now - 24 * 60 * 60 * 1000), // last 24h
      to: new Date(now),
    });

    // Mistral: 2 rows in range (the 25h-old row excluded)
    assert.equal(result[`${PREFIX}mistral`].requests, 2, 'mistral should have 2 requests in range');
    assert.equal(result[`${PREFIX}mistral`].inputTokens, 300, 'mistral input tokens should be 100+200');
    assert.equal(result[`${PREFIX}mistral`].outputTokens, 150, 'mistral output tokens should be 50+100');
    assert.equal(result[`${PREFIX}mistral`].costUsd, 0.003, 'mistral cost should be 0.001+0.002');

    // SambaNova: 1 row in range
    assert.equal(result[`${PREFIX}sambanova`].requests, 1, 'sambanova should have 1 request in range');
    assert.equal(result[`${PREFIX}sambanova`].inputTokens, 300);
    assert.equal(result[`${PREFIX}sambanova`].outputTokens, 150);
    assert.equal(result[`${PREFIX}sambanova`].costUsd, 0.003);
  });

  test('validateTimeRange rejects invalid ranges', () => {
    assert.equal(validateTimeRange({ from: new Date('invalid'), to: new Date() }), 'from and to must be valid dates');
    assert.equal(validateTimeRange({ from: new Date('2026-01-02'), to: new Date('2026-01-01') }), 'from must be before to');
    assert.equal(validateTimeRange({ from: new Date('2020-01-01'), to: new Date('2026-01-01') }), 'range must not exceed 365 days');
    assert.equal(validateTimeRange({ from: new Date('2026-01-01'), to: new Date('2026-01-02') }), null);
  });
});

describe('token usage HTTP query endpoint', () => {
  test('GET /token-usage/query returns correct aggregation', async () => {
    const now = Date.now();

    await prisma.tokenUsageLog.createMany({
      data: [
        { provider: `${PREFIX}mistral`, role: 'chat_primary', model: 'mistral-small', inputTokens: 100, outputTokens: 50, costUsd: 0.001, createdAt: new Date(now - 60 * 60 * 1000) },
        { provider: `${PREFIX}mistral`, role: 'chat_primary', model: 'mistral-small', inputTokens: 200, outputTokens: 100, costUsd: 0.002, createdAt: new Date(now - 2 * 60 * 60 * 1000) },
        { provider: `${PREFIX}sambanova`, role: 'chat_fallback', model: 'MiniMax-M2.7', inputTokens: 300, outputTokens: 150, costUsd: 0.003, createdAt: new Date(now - 3 * 60 * 60 * 1000) },
      ],
    });

    const from = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(now).toISOString();

    const res = await jsonFetch(`/api/admin/config/token-usage/query?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.totalRequests, 3);
    assert.equal(body.data.totalInputTokens, 600);
    assert.equal(body.data.totalOutputTokens, 300);
    assert.equal(body.data.perProvider[`${PREFIX}mistral`].requests, 2);
    assert.equal(body.data.perProvider[`${PREFIX}sambanova`].requests, 1);
  });

  test('GET /token-usage/query requires from and to params', async () => {
    const res = await jsonFetch('/api/admin/config/token-usage/query', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /from and to/);
  });

  test('GET /token-usage/query rejects invalid range', async () => {
    const res = await jsonFetch('/api/admin/config/token-usage/query?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /from must be before to/);
  });

  test('GET /token-usage/query requires auth', async () => {
    const res = await jsonFetch('/api/admin/config/token-usage/query?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z');
    assert.equal(res.status, 401);
  });

  test('existing /token-usage/last-hour endpoint still works', async () => {
    const res = await jsonFetch('/api/admin/config/token-usage/last-hour', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.lastHour);
    assert.ok(body.data.providerStats);
  });
});
