import { z } from 'zod';
// ─── MISSION CONTROL SCHEMAS ───
export const missionControlRangeSchema = z.enum(['7d', '30d', '90d']).default('7d');
export const aiOpsQuerySchema = z.object({
    range: missionControlRangeSchema,
});
export const heatmapQuerySchema = z.object({
    days: z.coerce
        .number()
        .int()
        .min(1, 'days must be at least 1')
        .max(30, 'days must be at most 30')
        .default(7),
});
export const leaderboardQuerySchema = z.object({
    range: z.enum(['7d', '30d', '90d']).default('30d'),
});
//# sourceMappingURL=missionControl.js.map