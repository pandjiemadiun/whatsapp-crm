import { Router, Response } from 'express';
import { missionControlService } from '../../business/mission-control.service.js';
import { validateRequest, getValidated } from '../../middleware/validate-request.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  aiOpsQuerySchema,
  heatmapQuerySchema,
  leaderboardQuerySchema,
} from '../../schemas/missionControl.js';
import type { AiOpsQueryInput, HeatmapQueryInput, LeaderboardQueryInput } from '../../schemas/missionControl.js';

const router = Router();

/**
 * GET /api/admin/mission-control/pulse
 * Real-time platform health: active merchants, message volume, AI cost, system status.
 * Cache: Redis 60s TTL.
 */
router.get(
  '/pulse',
  asyncHandler(async (_req, res: Response) => {
    const result = await missionControlService.getPulse();
    res.json(result);
  })
);

/**
 * GET /api/admin/mission-control/ai-ops?range=7d|30d|90d
 * AI provider usage breakdown: per-model counts, costs, fallback rate.
 * Cache: Redis 60s TTL.
 */
router.get(
  '/ai-ops',
  validateRequest(aiOpsQuerySchema, 'query'),
  asyncHandler(async (req, res: Response) => {
    const { range } = getValidated<AiOpsQueryInput>(req);
    const result = await missionControlService.getAiOps(range);
    res.json(result);
  })
);

/**
 * GET /api/admin/mission-control/heatmap?days=7
 * Hourly activity distribution (UTC hour grouping), 24-slot array.
 * Cache: Redis 300s TTL.
 */
router.get(
  '/heatmap',
  validateRequest(heatmapQuerySchema, 'query'),
  asyncHandler(async (req, res: Response) => {
    const { days } = getValidated<HeatmapQueryInput>(req);
    const result = await missionControlService.getHeatmap(days);
    res.json(result);
  })
);

/**
 * GET /api/admin/mission-control/leaderboard?range=7d|30d|90d
 * Top 10 merchants by message volume with last active timestamp.
 * Cache: Redis 300s TTL.
 */
router.get(
  '/leaderboard',
  validateRequest(leaderboardQuerySchema, 'query'),
  asyncHandler(async (req, res: Response) => {
    const { range } = getValidated<LeaderboardQueryInput>(req);
    const result = await missionControlService.getLeaderboard(range);
    res.json(result);
  })
);

/**
 * GET /api/admin/mission-control/wa-status
 * WhatsApp gateway connection status for all active stores.
 * Cache: Redis 60s TTL.
 */
router.get(
  '/wa-status',
  asyncHandler(async (_req, res: Response) => {
    const result = await missionControlService.getWaStatus();
    res.json(result);
  })
);

export default router;
