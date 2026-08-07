import { Router, Response } from 'express';
import { adapters, reloadAdaptersConfig } from '../../adapters/container.js';
import { aiProviderManager } from '../../adapters/ai/manager.js';
import { invalidateAiDefaultsCache } from '../../adapters/ai/ai-config.js';
import { configService } from '../../business/config.service.js';
import { logAction } from '../../business/auditLog.service.js';
import { requireAdminRole } from '../../middleware/adminAuthGuard.js';
import { AuthenticatedAdminRequest } from '../../middleware/adminAuth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateRequest, getValidated } from '../../middleware/validate-request.js';
import { updateConfigSchema } from '../../schemas/index.js';
import { getUsageLastHour } from '../../services/token-usage-tracker.js';

const router = Router();

// ─── GET /api/admin/config — List all system settings ───
router.get('/', asyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
  const category = req.query.category as string | undefined;
  const configs = await configService.getAllConfigs(category);
  res.json({ success: true, data: configs });
}));

// ─── GET /api/admin/config/token-usage/last-hour ───
// (Must be before /:key wildcard route)
router.get('/token-usage/last-hour', asyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
  const summary = getUsageLastHour();
  const providerStats = aiProviderManager.getStats();
  res.json({
    success: true,
    data: {
      lastHour: summary,
      providerStats,
      rateLimits: {
        gemini: { rpm: 12, limitPerMinute: 12 },
        groq: { rpm: 25, limitPerMinute: 25 },
      },
    },
  });
}));

// ─── GET /api/admin/config/:key — Get single setting ───
router.get('/:key', asyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
  const config = await configService.getSingleConfig(req.params.key);
  if (!config) {
    return res.status(404).json({ error: 'Config not found' });
  }
  res.json({ success: true, data: config });
}));

// ─── PUT /api/admin/config/:key — Update or create setting ───
router.put('/:key', requireAdminRole(['super_admin']), validateRequest(updateConfigSchema, 'body'), asyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
  const { key } = req.params;
  const { value, category, isSecret, description } = getValidated<{ value: string; category?: string; isSecret?: boolean; description?: string }>(req);

const oldConfig = await configService.getSingleConfig(key);
  // Preserve existing category when not explicitly provided (avoids configs
  // drifting into 'general' when the UI only sends `value`)
  const preservedCategory = category || oldConfig?.category || 'general';
  const desc = description ?? oldConfig?.description ?? null;
  await configService.setConfig(key, value, {
    category: preservedCategory,
    isSecret: isSecret ?? oldConfig?.isSecret ?? false,
    description: desc ?? undefined,
  });

  await logAction({
    storeId: 'system',
    action: 'config_updated',
    entity: 'SystemConfig',
    entityId: key,
    adminId: req.admin!.adminId,
    changes: { key, oldValue: oldConfig?.value || '***', newValue: '***' },
    ipAddress: req.ip,
  });

const isAiApiKey = key === 'GROQ_API_KEYS' || key === 'GEMINI_API_KEY';
  const isAiBehavior = key.startsWith('ai.');

  if (isAiApiKey) {
    await reloadAdaptersConfig();
  }
  if (isAiBehavior) {
    invalidateAiDefaultsCache();
    const providers = aiProviderManager.getProviders();
    adapters.logger.info('AI behavior config reloaded (hot)', {
      key,
      primary: providers.primary,
      fallback: providers.fallback,
    });
  }

  // Hot-reload integration adapters (GOWA / Storage / Backup / Cloudinary)
  const isGowa = key.startsWith('GOWA_');
  const isBackup = key.startsWith('BACKUP_');
  const isR2 = key.startsWith('R2_') || key === 'STORAGE_PROVIDER';
  const isCloudinary = key.startsWith('CLOUDINARY_');

  if (isGowa || isBackup || isR2 || isCloudinary) {
    await reloadAdaptersConfig();
    adapters.logger.info('Integration config reloaded (hot)', { key });
  }

  const updated = await configService.getSingleConfig(key);
  res.json({ success: true, data: updated });
}));

// ─── DELETE /api/admin/config/:key — Remove config (falls back to .env) ───
router.delete('/:key', requireAdminRole(['super_admin']), asyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
  const deleted = await configService.deleteConfig(req.params.key);
  if (!deleted) {
    return res.status(404).json({ error: 'Config not found' });
  }
  await logAction({
    storeId: 'system',
    action: 'config_deleted',
    entity: 'SystemConfig',
    entityId: req.params.key,
    adminId: req.admin!.adminId,
    changes: { key: req.params.key },
    ipAddress: req.ip,
  });
  res.json({ success: true, message: `Config ${req.params.key} deleted, will fall back to .env` });
}));

// ─── POST /api/admin/config/reload-cache — Force cache invalidation (super_admin only) ───
router.post('/reload-cache', requireAdminRole(['super_admin']), asyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
  configService.invalidateCache();
  adapters.logger.info('Config cache cleared by admin', { adminId: req.admin!.adminId });
  res.json({ success: true, message: 'Cache cleared' });
}));

// ─── POST /api/admin/config/test-connection — Test API key validity ───
router.post('/test-connection', asyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
  const { service, apiKey } = req.body;

  if (!service || !apiKey) {
    return res.status(400).json({ error: 'service and apiKey are required' });
  }

  let status: string;
  let message: string;

  switch (service) {
    case 'groq': {
      const groqRes = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (groqRes.ok) { status = 'valid'; message = 'Groq API key is valid'; }
      else if (groqRes.status === 401) { status = 'invalid'; message = 'Invalid API key'; }
      else { status = 'unavailable'; message = `Groq returned HTTP ${groqRes.status}`; }
      break;
    }
    case 'gemini': {
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (geminiRes.ok) { status = 'valid'; message = 'Gemini API key is valid'; }
      else if (geminiRes.status === 403 || geminiRes.status === 401) { status = 'invalid'; message = 'Invalid API key'; }
      else { status = 'unavailable'; message = `Gemini returned HTTP ${geminiRes.status}`; }
      break;
    }
    default:
      return res.status(400).json({ error: `Unknown service: ${service}. Supported: groq, gemini` });
  }

  res.json({ success: true, data: { service, status, message } });
}));

export default router;
