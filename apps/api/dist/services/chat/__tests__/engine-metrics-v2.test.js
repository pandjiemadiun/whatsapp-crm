import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logEngineV2Metrics, getCanaryMetrics } from '../engine-metrics.js';
import { adapters } from '../../../adapters/container.js';
// Mock Redis for testing
const mockRedis = {
    data: new Map(),
    lpush: async (key, value) => {
        if (!mockRedis.data.has(key))
            mockRedis.data.set(key, []);
        mockRedis.data.get(key).push(value);
        return 1;
    },
    lrange: async (key, start, stop) => {
        return mockRedis.data.get(key) || [];
    },
    ltrim: async (key, start, stop) => { },
};
adapters.cache = mockRedis;
describe('Engine Metrics v2', () => {
    it('logEngineV2Metrics → entry tersimpan di storage', async () => {
        mockRedis.data.clear();
        const storeId = 'store-1';
        logEngineV2Metrics(storeId, 'conv-1', 'success', 2, ['reason1'], 100);
        const logs = await mockRedis.lrange(`engine:v2:metrics:${storeId}`, 0, -1);
        assert.strictEqual(logs.length, 1);
        const metric = JSON.parse(logs[0]);
        assert.strictEqual(metric.storeId, storeId);
    });
    it('getCanaryMetrics dengan 0 entry → return zeros', async () => {
        mockRedis.data.clear();
        const metrics = await getCanaryMetrics('store-2', 7);
        assert.strictEqual(metrics.totalMessages, 0);
        assert.strictEqual(metrics.errorRate, 0);
    });
    it('getCanaryMetrics dengan 10 entry → hitung agregasi benar', async () => {
        mockRedis.data.clear();
        const storeId = 'store-3';
        for (let i = 0; i < 10; i++) {
            logEngineV2Metrics(storeId, `conv-${i}`, i < 2 ? 'fallback_reasoning_failed' : 'success', 2, i < 5 ? ['reason1'] : ['reason2'], 100);
        }
        const metrics = await getCanaryMetrics(storeId, 7);
        assert.strictEqual(metrics.totalMessages, 10);
        assert.strictEqual(metrics.errorRate, 20); // 2/10
        assert.strictEqual(metrics.avgLlmCalls, 2);
        assert.strictEqual(metrics.avgReplyLength, 100);
        assert.strictEqual(metrics.topValidatorReasons[0].count, 5); // 5 of 'reason1'
    });
});
//# sourceMappingURL=engine-metrics-v2.test.js.map