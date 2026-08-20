/**
 * Shipping cost module — FOUNDATION tests.
 *
 * Verifies the cached wrapper's behavior with a MOCK provider and MOCK Redis.
 * No real RajaOngkir call, no real Redis, no env key required.
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/shipping-cost.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CachedShippingCostService,
  CacheStore,
} from '../services/shipping/cached-shipping-cost.service.js';
import {
  ShippingCostProvider,
  ShippingCostResult,
  ShippingCostError,
} from '../services/shipping/shipping-cost-provider.interface.js';
import { RajaOngkirAdapter } from '../services/shipping/rajaongkir.adapter.js';
import { RAJAONGKIR_STARTER_COURIERS } from '../services/shipping/rajaongkir.adapter.js';

const SAMPLE: ShippingCostResult[] = [
  { courier: 'jne', service: 'REG', cost: 20000, etd: '2-3' },
  { courier: 'jne', service: 'YES', cost: 30000, etd: '1-1' },
];

function makeProvider(result: ShippingCostResult[] | ShippingCostError, calls: number[]) {
  return {
    getCost: async (): Promise<ShippingCostResult[] | ShippingCostError> => {
      calls.push(1);
      return result;
    },
  } as ShippingCostProvider;
}

class FakeRedis implements CacheStore {
  store = new Map<string, { value: unknown; ttl: number }>();
  sets: { key: string; value: unknown; ttl: number }[] = [];

  async get<T>(key: string): Promise<T | null> {
    const e = this.store.get(key);
    return e ? (e.value as T) : null;
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    this.store.set(key, { value, ttl });
    this.sets.push({ key, value, ttl });
  }
}

const PARAMS = { origin: '1', destination: '2', weight: 500, courier: 'jne' } as const;

describe('CachedShippingCostService', () => {
  test('cache miss → provider called once, result cached with 7-day TTL', async () => {
    const calls: number[] = [];
    const redis = new FakeRedis();
    const svc = new CachedShippingCostService(makeProvider(SAMPLE, calls), redis, 100);

    const res = await svc.getCost(PARAMS.origin, PARAMS.destination, PARAMS.weight, PARAMS.courier);

    assert.deepEqual(res, SAMPLE);
    assert.equal(calls.length, 1, 'provider should be called exactly once');

    const cached = await redis.get<ShippingCostResult[]>('ongkir:cost:1:2:jne:500');
    assert.deepEqual(cached, SAMPLE, 'result should be stored in cache');

    const cacheSet = redis.sets.find((s) => s.key === 'ongkir:cost:1:2:jne:500');
    assert.ok(cacheSet, 'cache SET should have happened');
    assert.equal(cacheSet!.ttl, 7 * 24 * 60 * 60, 'TTL must be 7 days (604800s)');
  });

  test('cache hit → provider NOT called again', async () => {
    const calls: number[] = [];
    const redis = new FakeRedis();
    const svc = new CachedShippingCostService(makeProvider(SAMPLE, calls), redis, 100);

    await svc.getCost('1', '2', 500, 'jne');
    const res2 = await svc.getCost('1', '2', 500, 'jne');

    assert.deepEqual(res2, SAMPLE);
    assert.equal(calls.length, 1, 'second call should hit cache, not provider');
  });

  test('weight 450g and 480g both bucket to 500g → single provider call', async () => {
    const calls: number[] = [];
    const redis = new FakeRedis();
    const svc = new CachedShippingCostService(makeProvider(SAMPLE, calls), redis, 100);

    await svc.getCost('1', '2', 450, 'jne');
    const res2 = await svc.getCost('1', '2', 480, 'jne');

    assert.deepEqual(res2, SAMPLE);
    assert.equal(calls.length, 1, 'both weights share the 500g bucket → one provider call');

    // Only ONE cache key (the 500g bucket) should exist for this pair.
    const keys = [...redis.store.keys()].filter((k) => k.startsWith('ongkir:cost:1:2:jne:'));
    assert.equal(keys.length, 1);
    assert.ok(keys[0].endsWith(':500'));
  });

  test('quota exceeded → QUOTA_EXCEEDED, provider never called', async () => {
    const calls: number[] = [];
    const redis = new FakeRedis();
    // Seed the daily quota counter at the limit.
    await redis.set('ongkir:quota:rajaongkir:2026-08-20', 100, 3600);
    const svc = new CachedShippingCostService(makeProvider(SAMPLE, calls), redis, 100);

    const res = await svc.getCost('1', '2', 500, 'jne');

    assert.equal(res, 'QUOTA_EXCEEDED');
    assert.equal(calls.length, 0, 'provider must NOT be called when quota exhausted');
  });
});

describe('RajaOngkirAdapter (HTTP injectable — no real API)', () => {
  test('parses Starter cost response into ShippingCostResult[]', async () => {
    const fakeHttp = async () => ({
      data: {
        rajaongkir: {
          results: [
            {
              code: 'jne',
              costs: [
                { service: 'REG', cost: [{ value: 20000, etd: '2-3' }] },
                { service: 'YES', cost: [{ value: 30000, etd: '1-1' }] },
              ],
            },
          ],
        },
      },
    });
    const adapter = new RajaOngkirAdapter('FAKE_KEY', fakeHttp as any);
    const res = await adapter.getCost('1', '2', 500, 'jne');

    assert.ok(Array.isArray(res));
    assert.equal((res as ShippingCostResult[]).length, 2);
    assert.equal((res as ShippingCostResult[])[0].courier, 'jne');
  });

  test('rejects unsupported courier (non-Starter tier)', async () => {
    const adapter = new RajaOngkirAdapter('FAKE_KEY', async () => ({ data: {} }) as any);
    const res = await adapter.getCost('1', '2', 500, 'sicepat');
    assert.equal(res, 'PROVIDER_ERROR');
  });

  test('supported couriers are exactly jne/pos/tiki', () => {
    assert.deepEqual([...RAJAONGKIR_STARTER_COURIERS], ['jne', 'pos', 'tiki']);
  });
});
