// import { redisAdapter } from '../../adapters/cache/redis.adapter.js';

export type EngineVersion = 'v1' | 'v2';

export interface StoreEngineConfig {
  storeId: string;
  engine: EngineVersion;
  enabledAt?: string;      // ISO timestamp saat diaktifkan
  canaryStartDate?: string; // ISO timestamp saat mulai canary
}

const getStoreKey = (storeId: string) => `store:${storeId}:engine`;

async function getRedis() {
  const { redisAdapter } = await import('../../adapters/cache/redis.adapter.js');
  return redisAdapter;
}

export async function getStoreEngine(storeId: string): Promise<EngineVersion> {
  const redisAdapter = await getRedis();
  const config = await redisAdapter.get<StoreEngineConfig>(getStoreKey(storeId));
  return config?.engine || 'v1';
}

export async function setStoreEngine(storeId: string, engine: EngineVersion): Promise<void> {
  const redisAdapter = await getRedis();
  const existingConfig = await redisAdapter.get<StoreEngineConfig>(getStoreKey(storeId));
  
  const now = new Date().toISOString();
  const newConfig: StoreEngineConfig = {
    ...existingConfig,
    storeId,
    engine,
    enabledAt: existingConfig?.enabledAt || now,
    canaryStartDate: engine === 'v2' ? now : existingConfig?.canaryStartDate,
  };

  await redisAdapter.set(getStoreKey(storeId), newConfig);
}

export async function isCanaryActive(storeId: string): Promise<boolean> {
  const redisAdapter = await getRedis();
  const config = await redisAdapter.get<StoreEngineConfig>(getStoreKey(storeId));
  
  if (!config || !config.canaryStartDate) {
    return false;
  }

  const startDate = new Date(config.canaryStartDate);
  const now = new Date();
  const diffTime = now.getTime() - startDate.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);

  return diffDays < 7;
}
