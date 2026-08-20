/**
 * RajaOngkir Komerce location adapter — FOUNDATION tests.
 *
 * Mocks the injectable HTTP + a fake Redis. No real RajaOngkir call, no key.
 * The new Komerce API is search-based: /province for provinces, and
 * /domestic-destination?search= for cities/subdistricts (no separate
 * city/subdistrict endpoints, no city_id — city identified by name).
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
  { id: '10', name: 'DKI JAKARTA' },
  { id: '5', name: 'JAWA BARAT' },
];
const DESTINATIONS_JAKARTA = [
  { id: 17473, province_name: 'DKI JAKARTA', city_name: 'JAKARTA BARAT', district_name: 'GROGOL PETAMBURAN', subdistrict_name: 'GROGOL' },
  { id: 17474, province_name: 'DKI JAKARTA', city_name: 'JAKARTA BARAT', district_name: 'GROGOL PETAMBURAN', subdistrict_name: 'JELAMBAR' },
  { id: 17475, province_name: 'DKI JAKARTA', city_name: 'JAKARTA SELATAN', district_name: 'X', subdistrict_name: 'PONDOK' },
];

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

function makeHttp(calls: string[], opts: { provinces?: any[]; destinations?: any[] }) {
  return (async (url: string, _headers: Record<string, string>) => {
    calls.push(url);
    if (url.includes('/province')) {
      return { data: { meta: { status: 'success' }, data: opts.provinces ?? [] } };
    }
    if (url.includes('/domestic-destination')) {
      return { data: { meta: { status: 'success' }, data: opts.destinations ?? [] } };
    }
    return { data: { meta: { status: 'success' }, data: [] } };
  }) as LocationHttpFn;
}

const TTL_30D = 30 * 24 * 60 * 60;

describe('RajaOngkirLocationAdapter (Komerce)', () => {
  test('getProvinces cache miss → HTTP once, cached with 30-day TTL', async () => {
    const calls: string[] = [];
    const redis = new FakeRedis();
    const adapter = new RajaOngkirLocationAdapter('KEY', makeHttp(calls, { provinces: PROVINCES }), redis);

    const res = await adapter.getProvinces();
    assert.deepEqual(res, PROVINCES);
    assert.equal(calls.length, 1, 'HTTP should be called exactly once on miss');
    assert.deepEqual(await redis.get('ongkir:ref:province'), PROVINCES);
    assert.equal(redis.store.get('ongkir:ref:province')!.ttl, TTL_30D);
  });

  test('getProvinces cache hit → HTTP NOT called again', async () => {
    const calls: string[] = [];
    const redis = new FakeRedis();
    const adapter = new RajaOngkirLocationAdapter('KEY', makeHttp(calls, { provinces: PROVINCES }), redis);

    await adapter.getProvinces();
    const res2 = await adapter.getProvinces();
    assert.deepEqual(res2, PROVINCES);
    assert.equal(calls.length, 1, 'second call must hit cache, not HTTP');
  });

  test('getCities(provinceId) searches province NAME, de-dupes city_name', async () => {
    const calls: string[] = [];
    const redis = new FakeRedis();
    const adapter = new RajaOngkirLocationAdapter('KEY', makeHttp(calls, { provinces: PROVINCES, destinations: DESTINATIONS_JAKARTA }), redis);

    const res = await adapter.getCities('10');
    // city has no id in Komerce API → id === name
    assert.deepEqual(res, [
      { id: 'JAKARTA BARAT', name: 'JAKARTA BARAT' },
      { id: 'JAKARTA SELATAN', name: 'JAKARTA SELATAN' },
    ]);
    // getProvinces (resolve name) + domestic-destination search
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes('/province'));
    assert.ok(calls[1].includes('rajaongkir.komerce.id/api/v1/destination/domestic-destination'));
    assert.ok(calls[1].includes('search=DKI%20JAKARTA'));
    assert.deepEqual(await redis.get('ongkir:ref:city:10'), res);
  });

  test('getSubdistricts(cityName) returns subdistrict-level ids (CONFIRMS Starter/Komerce exposes subdistrict data)', async () => {
    const calls: string[] = [];
    const redis = new FakeRedis();
    const adapter = new RajaOngkirLocationAdapter('KEY', makeHttp(calls, { destinations: DESTINATIONS_JAKARTA }), redis);

    const res = await adapter.getSubdistricts('JAKARTA BARAT');
    assert.deepEqual(res, [
      { id: '17473', name: 'GROGOL' },
      { id: '17474', name: 'JELAMBAR' },
    ]);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('rajaongkir.komerce.id/api/v1/destination/domestic-destination'));
    assert.ok(calls[0].includes('search=JAKARTA%20BARAT'));
    assert.deepEqual(await redis.get('ongkir:ref:subdistrict:JAKARTA BARAT'), res);
  });

  test('getCities cache hit → no extra HTTP (provinces still served from cache)', async () => {
    const calls: string[] = [];
    const redis = new FakeRedis();
    const adapter = new RajaOngkirLocationAdapter('KEY', makeHttp(calls, { provinces: PROVINCES, destinations: DESTINATIONS_JAKARTA }), redis);

    await adapter.getCities('10');
    const res2 = await adapter.getCities('10');
    assert.deepEqual(res2, [
      { id: 'JAKARTA BARAT', name: 'JAKARTA BARAT' },
      { id: 'JAKARTA SELATAN', name: 'JAKARTA SELATAN' },
    ]);
    // first call = /province + /domestic-destination; second = both cached → 0 new
    assert.equal(calls.length, 2);
  });
});
