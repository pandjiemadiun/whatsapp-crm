// import { redisAdapter } from '../../adapters/cache/redis.adapter.js';
const getStoreKey = (storeId) => `store:${storeId}:engine`;
async function getRedis() {
    const { redisAdapter } = await import('../../adapters/cache/redis.adapter.js');
    return redisAdapter;
}
export async function getStoreEngine(storeId) {
    const redisAdapter = await getRedis();
    const config = await redisAdapter.get(getStoreKey(storeId));
    return config?.engine || 'v1';
}
export async function setStoreEngine(storeId, engine) {
    const redisAdapter = await getRedis();
    const existingConfig = await redisAdapter.get(getStoreKey(storeId));
    const now = new Date().toISOString();
    const newConfig = {
        ...existingConfig,
        storeId,
        engine,
        enabledAt: existingConfig?.enabledAt || now,
        canaryStartDate: engine === 'v2' ? now : existingConfig?.canaryStartDate,
    };
    await redisAdapter.set(getStoreKey(storeId), newConfig);
}
export async function isCanaryActive(storeId) {
    const redisAdapter = await getRedis();
    const config = await redisAdapter.get(getStoreKey(storeId));
    if (!config || !config.canaryStartDate) {
        return false;
    }
    const startDate = new Date(config.canaryStartDate);
    const now = new Date();
    const diffTime = now.getTime() - startDate.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    return diffDays < 7;
}
//# sourceMappingURL=engine-config.js.map