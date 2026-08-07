import { z } from 'zod';
export declare const missionControlRangeSchema: z.ZodDefault<z.ZodEnum<{
    "7d": "7d";
    "30d": "30d";
    "90d": "90d";
}>>;
export declare const aiOpsQuerySchema: z.ZodObject<{
    range: z.ZodDefault<z.ZodEnum<{
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
}, z.core.$strip>;
export type AiOpsQueryInput = z.infer<typeof aiOpsQuerySchema>;
export declare const heatmapQuerySchema: z.ZodObject<{
    days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type HeatmapQueryInput = z.infer<typeof heatmapQuerySchema>;
export declare const leaderboardQuerySchema: z.ZodObject<{
    range: z.ZodDefault<z.ZodEnum<{
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
}, z.core.$strip>;
export type LeaderboardQueryInput = z.infer<typeof leaderboardQuerySchema>;
//# sourceMappingURL=missionControl.d.ts.map