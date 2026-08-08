import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { redisAdapter } from '../../../adapters/cache/redis.adapter.js';
// Setup Mock BEFORE importing modules that depend on it
let mockStorage = new Map();
const originalGet = redisAdapter.get;
const originalSet = redisAdapter.set;
redisAdapter.get = async (key) => {
    return mockStorage.get(key) || null;
};
redisAdapter.set = async (key, value) => {
    mockStorage.set(key, value);
};
// Import AFTER mocking
import { getStoreEngine, setStoreEngine, isCanaryActive } from '../engine-config.js';
describe('engine-config', () => {
    after(() => {
        redisAdapter.get = originalGet;
        redisAdapter.set = originalSet;
    });
    beforeEach(() => {
        mockStorage.clear();
    });
    it('getStoreEngine default → v1', async () => {
        const engine = await getStoreEngine('test-store-default');
        assert.strictEqual(engine, 'v1');
    });
    it('setStoreEngine(store-1, v2) → getStoreEngine(store-1) === v2', async () => {
        await setStoreEngine('store-1', 'v2');
        const engine = await getStoreEngine('store-1');
        assert.strictEqual(engine, 'v2');
    });
    it('setStoreEngine(store-1, v2) → canaryStartDate tersimpan', async () => {
        await setStoreEngine('store-1', 'v2');
        const config = mockStorage.get('store:store-1:engine');
        assert.ok(config.canaryStartDate);
    });
    it('isCanaryActive + canaryStartDate 1 hari lalu → true', async () => {
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        mockStorage.set('store:store-2:engine', {
            storeId: 'store-2',
            engine: 'v2',
            canaryStartDate: oneDayAgo.toISOString()
        });
        assert.strictEqual(await isCanaryActive('store-2'), true);
    });
    it('isCanaryActive + canaryStartDate 10 hari lalu → false', async () => {
        const tenDaysAgo = new Date();
        tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
        mockStorage.set('store:store-3:engine', {
            storeId: 'store-3',
            engine: 'v2',
            canaryStartDate: tenDaysAgo.toISOString()
        });
        assert.strictEqual(await isCanaryActive('store-3'), false);
    });
    it('isCanaryActive + no canaryStartDate → false', async () => {
        mockStorage.set('store:store-4:engine', {
            storeId: 'store-4',
            engine: 'v2'
        });
        assert.strictEqual(await isCanaryActive('store-4'), false);
    });
});
//# sourceMappingURL=engine-config-v2.test.js.map