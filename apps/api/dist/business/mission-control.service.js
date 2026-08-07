import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { configService } from './config.service.js';
import logger from '../utils/logger.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
// TTL constants (seconds for Redis setex)
const TTL_PULSE = 60; // 60s — healthy pulse cache
const TTL_PULSE_DEGRADED = 5; // 5s — retry fast when any health check is negative
const TTL_AI_OPS = 60; // 60s — live health dashboard
const TTL_WA_STATUS = 60; // 60s — live connection status
const TTL_HEATMAP = 300; // 300s (5 min) — trend data
const TTL_LEADERBOARD = 300; // 300s (5 min) — trend data
// Cache key prefix
const CACHE_PREFIX = 'mission_control';
// GOWA health check timeout
const GOWA_HEALTH_TIMEOUT_MS = 5000;
// Date range → days mapping
const RANGE_DAYS = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
};
// ─── Cache helpers ───
function cacheKey(endpoint, paramsHash) {
    if (paramsHash) {
        return `${CACHE_PREFIX}:${endpoint}:${paramsHash}`;
    }
    return `${CACHE_PREFIX}:${endpoint}`;
}
async function getCached(key) {
    try {
        return await adapters.cache.get(key);
    }
    catch {
        return null;
    }
}
async function setCached(key, value, ttlSeconds) {
    try {
        await adapters.cache.set(key, value, ttlSeconds);
    }
    catch {
        // Redis write failure is non-fatal — data still valid for this request
    }
}
// ─── Date helpers ───
function getTodayStartUTC() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
}
function getRangeStart(range) {
    const days = RANGE_DAYS[range] ?? 7;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d;
}
// ─── System health checks ───
async function checkDatabase() {
    try {
        await prisma.$queryRaw `SELECT 1`;
        return true;
    }
    catch (err) {
        logger.error('[pulse-db-check] Database health check failed', err);
        return false;
    }
}
async function checkRedis() {
    try {
        return await adapters.cache.ping();
    }
    catch {
        return false;
    }
}
async function checkGowa() {
    try {
        const baseUrl = (await configService.getConfig('GOWA_API_URL')) || process.env.GOWA_API_URL;
        if (!baseUrl)
            return false;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GOWA_HEALTH_TIMEOUT_MS);
        try {
            const res = await fetch(baseUrl, {
                method: 'GET',
                signal: controller.signal,
            });
            // Any HTTP response (even 401/404) means GOWA is reachable
            clearTimeout(timeout);
            return res.ok || res.status < 500;
        }
        catch {
            clearTimeout(timeout);
            return false;
        }
    }
    catch {
        return false;
    }
}
// ─── Public API ───
export class MissionControlService {
    /**
     * GET /api/admin/mission-control/pulse
     * Real-time platform pulse: active merchants, message volume, AI cost, system health.
     */
    async getPulse() {
        const key = cacheKey('pulse', '');
        const cached = await getCached(key);
        if (cached) {
            logger.debug('Mission Control pulse cache hit');
            return cached;
        }
        try {
            const todayStart = getTodayStartUTC();
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const [activeMerchantsRow, messagesToday, aiCostToday, dbHealth, redisHealth, gowaHealth] = await Promise.all([
                // Stores with at least one conversation active in last 24h
                prisma.$queryRaw `
            SELECT "storeId", COUNT(*)::int AS "count"
            FROM "conversations"
            WHERE "lastMessageAt" >= ${twentyFourHoursAgo}::timestamptz
              AND "deletedAt" IS NULL
            GROUP BY "storeId"
          `,
                // Total messages today (UTC)
                prisma.conversationHistory.count({
                    where: {
                        createdAt: { gte: todayStart },
                    },
                }),
                // AI cost today (sum costUSD)
                prisma.conversationHistory.aggregate({
                    where: {
                        createdAt: { gte: todayStart },
                        costUSD: { gt: 0 },
                    },
                    _sum: { costUSD: true },
                }),
                checkDatabase(),
                checkRedis(),
                checkGowa(),
            ]);
            const result = {
                totalActiveMerchants: activeMerchantsRow.length,
                totalMessagesToday: Number(messagesToday),
                aiCostToday: Number(aiCostToday._sum.costUSD ?? 0),
                systemHealth: {
                    db: dbHealth,
                    redis: redisHealth,
                    gowa: gowaHealth,
                },
            };
            logger.info('Mission Control pulse computed', {
                totalActiveMerchants: result.totalActiveMerchants,
                totalMessagesToday: result.totalMessagesToday,
            });
            // Cache: 5s when any health check is negative (retry fast), 60s when fully healthy
            const pulseTtl = result.systemHealth.db && result.systemHealth.redis && result.systemHealth.gowa
                ? TTL_PULSE
                : TTL_PULSE_DEGRADED;
            await setCached(key, result, pulseTtl);
            return result;
        }
        catch (error) {
            logger.error('Failed to compute mission control pulse', error);
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to fetch platform pulse');
        }
    }
    /**
     * GET /api/admin/mission-control/ai-ops?range=7d|30d|90d
     * AI provider usage breakdown: model usage counts, total costs, fallback rate.
     */
    async getAiOps(range) {
        const key = cacheKey('ai-ops', range);
        const cached = await getCached(key);
        if (cached) {
            logger.debug('Mission Control ai-ops cache hit', { range });
            return cached;
        }
        try {
            const rangeStart = getRangeStart(range);
            // Group by aiModel, count messages and sum costUSD
            const rows = await prisma.$queryRaw `
        SELECT
          "aiModel" AS "aiModel",
          COUNT(*)::int AS "count",
          COALESCE(SUM("costUSD"), 0)::float AS "totalCostUSD"
        FROM "conversation_history"
        WHERE "createdAt" >= ${rangeStart}::timestamptz
        GROUP BY "aiModel"
        ORDER BY "count" DESC
      `;
            const modelUsage = rows.map((r) => ({
                model: r.aiModel || 'null',
                count: Number(r.count),
                totalCostUSD: Number(r.totalCostUSD),
            }));
            // Total messages in range for fallback rate calculation
            const totalMessages = await prisma.conversationHistory.count({
                where: { createdAt: { gte: rangeStart } },
            });
            // Fallback count: aiModel is null OR 'groq-fallback' (or starts with groq)
            const fallbackCount = modelUsage.reduce((sum, entry) => {
                if (entry.model === 'null' || entry.model === 'groq-fallback' || entry.model.startsWith('groq')) {
                    return sum + entry.count;
                }
                return sum;
            }, 0);
            const fallbackRate = totalMessages > 0 ? (fallbackCount / totalMessages) * 100 : 0;
            const result = {
                modelUsage,
                fallbackRate: Math.round(fallbackRate * 100) / 100,
            };
            logger.info('Mission Control ai-ops computed', { range, modelCount: modelUsage.length });
            await setCached(key, result, TTL_AI_OPS);
            return result;
        }
        catch (error) {
            logger.error('Failed to compute mission control ai-ops', error);
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to fetch AI ops data');
        }
    }
    /**
     * GET /api/admin/mission-control/heatmap?days=7
     * Hourly activity distribution across all stores (UTC hour grouping).
     */
    async getHeatmap(days) {
        const key = cacheKey('heatmap', `days:${days}`);
        const cached = await getCached(key);
        if (cached) {
            logger.debug('Mission Control heatmap cache hit', { days });
            return cached;
        }
        try {
            const rangeStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            const rows = await prisma.$queryRaw `
        SELECT
          EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC')::int AS "hour",
          COUNT(*)::int AS "messageCount"
        FROM "conversation_history"
        WHERE "createdAt" >= ${rangeStart}::timestamptz
        GROUP BY EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC')
        ORDER BY "hour"
      `;
            // Build full 0-23 array with zeros for missing hours
            const hourlyMap = new Map();
            rows.forEach((r) => {
                hourlyMap.set(Number(r.hour), Number(r.messageCount));
            });
            const hourlyActivity = [];
            for (let h = 0; h < 24; h++) {
                hourlyActivity.push({ hour: h, messageCount: hourlyMap.get(h) ?? 0 });
            }
            const result = { hourlyActivity };
            logger.info('Mission Control heatmap computed', { days });
            await setCached(key, result, TTL_HEATMAP);
            return result;
        }
        catch (error) {
            logger.error('Failed to compute mission control heatmap', error);
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to fetch heatmap data');
        }
    }
    /**
     * GET /api/admin/mission-control/leaderboard?range=7d|30d|90d
     * Top 10 merchants by message volume, with store name and last active timestamp.
     */
    async getLeaderboard(range) {
        const key = cacheKey('leaderboard', range);
        const cached = await getCached(key);
        if (cached) {
            logger.debug('Mission Control leaderboard cache hit', { range });
            return cached;
        }
        try {
            const rangeStart = getRangeStart(range);
            const rows = await prisma.$queryRaw `
        SELECT
          "s"."id" AS "storeId",
          "s"."name" AS "storeName",
          COUNT("h"."id")::int AS "messageCount",
          MAX("c"."lastMessageAt") AS "lastActiveAt"
        FROM "stores" "s"
        INNER JOIN "conversations" "c" ON "c"."storeId" = "s"."id"
        INNER JOIN "conversation_history" "h" ON "h"."conversationId" = "c"."id"
        WHERE "s"."isActive" = true
          AND "s"."deletedAt" IS NULL
          AND "c"."deletedAt" IS NULL
          AND "h"."createdAt" >= ${rangeStart}::timestamptz
        GROUP BY "s"."id", "s"."name"
        ORDER BY "messageCount" DESC
        LIMIT 10
      `;
            const topMerchants = rows.map((r) => ({
                storeId: String(r.storeId),
                storeName: String(r.storeName),
                messageCount: Number(r.messageCount),
                lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt).toISOString() : null,
            }));
            const result = { topMerchants };
            logger.info('Mission Control leaderboard computed', { range, merchants: topMerchants.length });
            await setCached(key, result, TTL_LEADERBOARD);
            return result;
        }
        catch (error) {
            logger.error('Failed to compute mission control leaderboard', error);
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to fetch leaderboard data');
        }
    }
    /**
     * GET /api/admin/mission-control/wa-status
     * WhatsApp gateway connection status for all active stores.
     */
    async getWaStatus() {
        const key = cacheKey('wa-status', '');
        const cached = await getCached(key);
        if (cached) {
            logger.debug('Mission Control wa-status cache hit');
            return cached;
        }
        try {
            // Raw SQL with COALESCE + conditional for encrypted fields
            const rows = await prisma.$queryRaw `
        SELECT
          "s"."id" AS "storeId",
          "s"."name" AS "storeName",
          "s"."whatsappPhoneId",
          "s"."fonnteToken",
          MAX("c"."lastMessageAt") AS "lastMessageAt"
        FROM "stores" "s"
        LEFT JOIN "conversations" "c" ON "c"."storeId" = "s"."id" AND "c"."deletedAt" IS NULL
        WHERE "s"."isActive" = true
          AND "s"."deletedAt" IS NULL
        GROUP BY "s"."id", "s"."name", "s"."whatsappPhoneId", "s"."fonnteToken"
        ORDER BY "s"."name"
      `;
            const result = rows.map((r) => ({
                storeId: String(r.storeId),
                storeName: String(r.storeName),
                hasGowa: r.whatsappPhoneId !== null && r.whatsappPhoneId !== '',
                hasFonnte: r.fonnteToken !== null && r.fonnteToken !== '',
                lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt).toISOString() : null,
            }));
            logger.info('Mission Control wa-status computed', { storeCount: result.length });
            await setCached(key, result, TTL_WA_STATUS);
            return result;
        }
        catch (error) {
            logger.error('Failed to compute mission control wa-status', error);
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to fetch WhatsApp status');
        }
    }
}
export const missionControlService = new MissionControlService();
//# sourceMappingURL=mission-control.service.js.map