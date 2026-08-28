import { Router } from 'express';
import { adminAuthMiddleware } from '../../middleware/adminAuth.js';
import { requireAdminRole } from '../../middleware/adminAuthGuard.js';
import { getStoreEngine, setStoreEngine } from '../../services/chat/engine-config.js';
import { redisAdapter } from '../../adapters/cache/redis.adapter.js';
import { getCanaryMetrics } from '../../services/chat/engine-metrics.js';
const router = Router();
// Canary metrics — read-only, any authenticated admin
router.get('/metrics/:storeId', adminAuthMiddleware, async (req, res) => {
    const { storeId } = req.params;
    const days = req.query.days ? parseInt(req.query.days) : 7;
    res.json(await getCanaryMetrics(storeId, days));
});
// Get config for a store — read-only, any authenticated admin
router.get('/:storeId', adminAuthMiddleware, async (req, res) => {
    const { storeId } = req.params;
    const config = await redisAdapter.get(`store:${storeId}:engine`);
    const engine = await getStoreEngine(storeId);
    if (config) {
        res.json(config);
    }
    else {
        res.json({ storeId, engine, enabledAt: null, canaryStartDate: null });
    }
});
// Set config for a store — mutates state, super_admin only
router.post('/:storeId', adminAuthMiddleware, requireAdminRole(['super_admin']), async (req, res) => {
    const { storeId } = req.params;
    const { engine } = req.body;
    if (engine !== 'v1' && engine !== 'v2') {
        return res.status(400).json({ error: 'Invalid engine' });
    }
    await setStoreEngine(storeId, engine);
    res.json({ success: true });
});
// Get all stores with v2 engine — read-only, any authenticated admin
router.get('/', adminAuthMiddleware, async (req, res) => {
    const keys = await redisAdapter.keys('store:*:engine');
    const configs = await Promise.all(keys.map(k => redisAdapter.get(k)));
    const v2Stores = configs.filter(c => c?.engine === 'v2');
    res.json(v2Stores);
});
export default router;
//# sourceMappingURL=engine.js.map