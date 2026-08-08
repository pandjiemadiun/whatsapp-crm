import { Router } from 'express';
import { getStoreEngine, setStoreEngine, EngineVersion, StoreEngineConfig } from '../../services/chat/engine-config.js';
import { redisAdapter } from '../../adapters/cache/redis.adapter.js';
import { getCanaryMetrics } from '../../services/chat/engine-metrics.js';

const router = Router();

// Canary metrics
router.get('/metrics/:storeId', async (req, res) => {
  const { storeId } = req.params;
  const days = req.query.days ? parseInt(req.query.days as string) : 7;
  res.json(await getCanaryMetrics(storeId, days));
});

// Get config for a store
router.get('/:storeId', async (req, res) => {
  const { storeId } = req.params;
  const config = await redisAdapter.get<StoreEngineConfig>(`store:${storeId}:engine`);
  const engine = await getStoreEngine(storeId);
  
  if (config) {
    res.json(config);
  } else {
    res.json({ storeId, engine, enabledAt: null, canaryStartDate: null });
  }
});

// Set config for a store
router.post('/:storeId', async (req, res) => {
  const { storeId } = req.params;
  const { engine } = req.body as { engine: EngineVersion };
  if (engine !== 'v1' && engine !== 'v2') {
    return res.status(400).json({ error: 'Invalid engine' });
  }
  await setStoreEngine(storeId, engine);
  res.json({ success: true });
});

// Get all stores with v2 engine
router.get('/', async (req, res) => {
  const keys = await redisAdapter.keys('store:*:engine');
  const configs = await Promise.all(keys.map(k => redisAdapter.get<StoreEngineConfig>(k)));
  const v2Stores = configs.filter(c => c?.engine === 'v2');
  res.json(v2Stores);
});

export default router;
