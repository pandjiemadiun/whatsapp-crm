/**
 * RajaOngkir location reference adapter — FOUNDATION tests.
 *
 * Mocks the injectable HTTP + a fake Redis. No real RajaOngkir call, no key.
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/location.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  RajaOngkirLocationAdapter,
  LocationHttpFn,
  LocationItem,
} from '../services/shipping/rajaongkir-location.adapter.js';
import { CacheStore } from '../services/shipping/cached-shipping-cost.service.js';

const PROVINCES: LocationItem[] = [
  { id: '1', name: 'Bali' },
  { id: '2', name: 'DKI Jakarta' },
];
const CITIES: LocationItem[] = [{ id: '10', name: 'Denpasar', parentId: '1' }];
const SUBDISTRICTS: LocationItem[] = [{ id: '100', name: 'Denpasar Selatan', parentId: '10' }];

class FakeRedis implements CacheStore {
  store = new Map<string, { value: unknown; ttl: number }>();
  async get<T>(key: string): Promise<T | null> {
    const e = this.store.get(key);
    return e ? (e.value as T) : null;
  }
  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    this.store.set(key, { value, ttl });
  }
}

function makeHttp(calls: string[]): LocationHttpFn {
  return async (url: string, _headers: Record<string, string>) => {
    calls.push(url);
    if (url.includes('/province')) {
      return { data: { rajaongkir: { results: PROVINCES.map((p) => ({ province_id: p.id, province: p.name })) } } };
    }
    if (url.includes('/city')) {
      return { data: { rajaongkir: { results: CITIES.map((c) => ({ city_id: c.id, city_name: c.name, province_id: c.parentId })) } } };
    }
    if (url.includes('/subdistrict')) {
      return { data: { rajaongkir: { results: SUBDISTRICTS.map((s) => ({ subdistrict_id: s.id, subdistrict_name: s.name, city_id: s.parentId })) } } };
    }
    return { data: { rajaongkir: { results: [] } } };
  };
}

const TTL_30D = 30 * 24 * 60 * 60;

describe('RajaOngkirLocationAdapter', () => {
  test('getProvinces cache miss → HTTP once, cached with 30-day TTL', async () => {
    const calls: string[] = [];
    const redis = new FakeRedis();
    const adapter = new RajaOngkirLocationAdapter('KEY', makeHttp(calls), redis);

    const res = await adapter.getProvinces();
    assert.deepEqual(res, PROVINCES);
    assert.equal(calls.length, 1, 'HTTP should be called exactly once on miss');
    assert.deepEqual(await redis.get('ongkir:ref:province'), PROVINCES);
    assert.equal(redis.store.get('ongkir:ref:province')!.ttl, TTL_30D);
  });

  test('getProvinces cache hit → HTTP NOT called again', async () => {
    const calls: string[] = [];
    const redis = new FakeRedis();
    const adapter = new RajaOngkirLocationAdapter('KEY', makeHttp(calls), redis);

    await adapter.getProvinces();
    const res2 = await adapter.getProvinces();
    assert.deepEqual(res2, PROVINCES);
    assert.equal(calls.length, 1, 'second call must hit cache, not HTTP');
  });

  test('getCities caches per-province; same province → hit', async () => {
    const calls: string[] = [];
    const redis = new FakeRedis();
    const adapter = new RajaOngkirLocationAdapter('KEY', makeHttp(calls), redis);

    await adapter.getCities('1');
    const res2 = await adapter.getCities('1');
    assert.deepEqual(res2, CITIES);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('province=1'), 'city request must carry provinceId');
  });

  test('getSubdistricts hits Starter /subdistrict endpoint (cache miss → HTTP once)', async () => {
    const calls: string[] = [];
    const redis = new FakeRedis();
    const adapter = new RajaOngkirLocationAdapter('KEY', makeHttp(calls), redis);

    const res = await adapter.getSubdistricts('10');
    assert.deepEqual(res, SUBDISTRICTS);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('/starter/subdistrict'), 'must target the Starter subdistrict reference endpoint');
    assert.ok(calls[0].includes('city=10'), 'subdistrict request must carry cityId');
    assert.deepEqual(await redis.get('ongkir:ref:subdistrict:10'), SUBDISTRICTS);
  });
});
