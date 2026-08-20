import { Router, Request, Response } from 'express';
import { rajaOngkirLocation } from '../../services/shipping/rajaongkir-location.adapter.js';

/**
 * Location reference endpoints (RajaOngkir Starter reference data).
 *
 * This router has NO internal auth on purpose: it is mounted TWICE in
 * index.ts — once under /api/admin/locations (adminAuthMiddleware) and once
 * under /api/store/locations (authMiddleware, for the merchant dashboard's
 * cascading address dropdown). Auth is enforced at the mount point.
 */
const router = Router();

router.get('/provinces', async (_req: Request, res: Response) => {
  try {
    const data = await rajaOngkirLocation.getProvinces();
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Failed to fetch provinces' });
  }
});

router.get('/cities', async (req: Request, res: Response) => {
  const provinceId = req.query.provinceId as string | undefined;
  if (!provinceId) {
    return res.status(400).json({ error: 'provinceId query parameter is required' });
  }
  try {
    const data = await rajaOngkirLocation.getCities(provinceId);
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Failed to fetch cities' });
  }
});

router.get('/subdistricts', async (req: Request, res: Response) => {
  const cityId = req.query.cityId as string | undefined;
  if (!cityId) {
    return res.status(400).json({ error: 'cityId query parameter is required' });
  }
  try {
    const data = await rajaOngkirLocation.getSubdistricts(cityId);
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Failed to fetch subdistricts' });
  }
});

export default router;
