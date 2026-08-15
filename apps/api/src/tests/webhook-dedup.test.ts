/**
 * G2-B.3 — Redis-backed dedup tests
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/webhook-dedup.test.ts
 */

import { test, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { messageQueueService } from '../services/message-queue.service.js';

const TEST_STORE = 'test-dedup-store';

async function getRedisAdapter() {
  const mod = await import('../adapters/cache/redis.adapter.js');
  return mod.redisAdapter;
}

async function cleanupRedis() {
  const redisAdapter = await getRedisAdapter();
  const keys = await redisAdapter.keys('*:msg:*');
  for (const key of keys) {
    await redisAdapter.del(key);
  }
}

beforeEach(async () => {
  await cleanupRedis();
});

after(async () => {
  await cleanupRedis();
  const redisAdapter = await getRedisAdapter();
  await redisAdapter.close();
});

describe('G2-B.3 Redis-backed dedup', () => {
  test('first message is NOT duplicate', async () => {
    const isDup = await messageQueueService.isDuplicate(TEST_STORE, 'msg-1');
    assert.equal(isDup, false);
  });

  test('second message with same ID IS duplicate', async () => {
    await messageQueueService.isDuplicate(TEST_STORE, 'msg-2');
    const isDup = await messageQueueService.isDuplicate(TEST_STORE, 'msg-2');
    assert.equal(isDup, true);
  });

  test('different stores are independent (tenant-scoped)', async () => {
    await messageQueueService.isDuplicate(TEST_STORE, 'msg-3');
    const isDup = await messageQueueService.isDuplicate('different-store', 'msg-3');
    assert.equal(isDup, false);
  });

  test('different message IDs are independent', async () => {
    await messageQueueService.isDuplicate(TEST_STORE, 'msg-4');
    const isDup = await messageQueueService.isDuplicate(TEST_STORE, 'msg-5');
    assert.equal(isDup, false);
  });

  test('key format is <storeId>:msg:<messageId>', async () => {
    await messageQueueService.isDuplicate(TEST_STORE, 'msg-6');
    const redisAdapter = await getRedisAdapter();
    const keys = await redisAdapter.keys(`${TEST_STORE}:msg:msg-6`);
    assert.equal(keys.length, 1);
    assert.equal(keys[0], `${TEST_STORE}:msg:msg-6`);
  });

  test('TTL is ~300 seconds (5 minutes)', async () => {
    await messageQueueService.isDuplicate(TEST_STORE, 'msg-7');
    const redisAdapter = await getRedisAdapter();
    const ttl = await redisAdapter.getTtl(`${TEST_STORE}:msg:msg-7`);
    assert.ok(ttl !== null, 'TTL should exist');
    assert.ok(ttl <= 300 && ttl > 290, `TTL should be ~300s, got ${ttl}`);
  });

  test('atomic SET NX — concurrent duplicate detection', async () => {
    const results = await Promise.all([
      messageQueueService.isDuplicate(TEST_STORE, 'msg-8'),
      messageQueueService.isDuplicate(TEST_STORE, 'msg-8'),
    ]);
    assert.equal(results.filter((r) => r === false).length, 1);
    assert.equal(results.filter((r) => r === true).length, 1);
  });

  test('empty messageId is not duplicate', async () => {
    const isDup = await messageQueueService.isDuplicate(TEST_STORE, '');
    assert.equal(isDup, false);
  });

  test('getStats returns dedupeCacheSize as number', () => {
    const stats = messageQueueService.getStats();
    assert.equal(typeof stats.dedupeCacheSize, 'number');
    assert.ok(stats.dedupeCacheSize >= 0);
  });
});
