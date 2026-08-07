import { prisma } from '../infrastructure/prisma.js';
import logger from '../utils/logger.js';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — trend data is less time-sensitive than live health checks
const cache = { data: null, expiresAt: 0 };
function rangeToDays(range) {
    return range === '7d' ? 7 : range === '30d' ? 30 : 90;
}
export class AnalyticsService {
    /**
     * Get aggregated analytics for the admin dashboard.
     * Uses 5-minute TTL caching (trend data is less time-sensitive than live health checks).
     */
    async getAnalytics(range = '30d', forceRefresh = false) {
        if (!forceRefresh && cache.data && Date.now() < cache.expiresAt) {
            return cache.data;
        }
        const days = rangeToDays(range);
        const now = new Date();
        const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        const periodEnd = now;
        const startISO = periodStart.toISOString();
        const endISO = periodEnd.toISOString();
        const startMs = Date.now();
        const [messageVolumeResults, costTrendResults, responseTimeResults, sourceBreakdownResults, orderFunnelResults, revenueTrendResults, activeStoresCount, activeCustomersCount, totalMessages, totalOrders, totalConversations, humanTakeoverCount, totalCostAgg,] = await Promise.all([
            // ── Message volume trend (daily, role breakdown) ──
            // conversation_history joined to conversations for soft-delete filter
            prisma.$queryRaw `
        SELECT 
          date_trunc('day', "h"."createdAt") AS "date",
          COUNT(*) FILTER (WHERE "h"."role" = 'customer') AS customer,
          COUNT(*) FILTER (WHERE "h"."role" = 'assistant') AS assistant,
          COUNT(*) FILTER (WHERE "h"."role" = 'system') AS system
        FROM "conversation_history" "h"
        INNER JOIN "conversations" "c" ON "h"."conversationId" = "c"."id"
        WHERE "h"."createdAt" >= ${periodStart}::timestamptz
          AND "h"."createdAt" <= ${periodEnd}::timestamptz
          AND "c"."deletedAt" IS NULL
        GROUP BY date_trunc('day', "h"."createdAt")
        ORDER BY "date"
      `,
            // ── AI cost trend (daily SUM of costUSD, where cost > 0) ──
            prisma.$queryRaw `
        SELECT 
          date_trunc('day', "h"."createdAt") AS "date",
          SUM("h"."costUSD")::float AS cost
        FROM "conversation_history" "h"
        INNER JOIN "conversations" "c" ON "h"."conversationId" = "c"."id"
        WHERE "h"."createdAt" >= ${periodStart}::timestamptz
          AND "h"."createdAt" <= ${periodEnd}::timestamptz
          AND "h"."costUSD" > 0
          AND "c"."deletedAt" IS NULL
        GROUP BY date_trunc('day', "h"."createdAt")
        ORDER BY "date"
      `,
            // ── Response time trend (daily AVG of responseTime, non-null only) ──
            prisma.$queryRaw `
        SELECT 
          date_trunc('day', "h"."createdAt") AS "date",
          AVG("h"."responseTime")::float AS "avgMs",
          COUNT("h"."responseTime") AS count
        FROM "conversation_history" "h"
        INNER JOIN "conversations" "c" ON "h"."conversationId" = "c"."id"
        WHERE "h"."createdAt" >= ${periodStart}::timestamptz
          AND "h"."createdAt" <= ${periodEnd}::timestamptz
          AND "h"."responseTime" IS NOT NULL
          AND "c"."deletedAt" IS NULL
        GROUP BY date_trunc('day', "h"."createdAt")
        ORDER BY "date"
      `,
            // ── Source breakdown (total per source) ──
            prisma.$queryRaw `
        SELECT 
          COALESCE("h"."source", 'unknown') AS source,
          COUNT(*)::int AS count
        FROM "conversation_history" "h"
        INNER JOIN "conversations" "c" ON "h"."conversationId" = "c"."id"
        WHERE "h"."createdAt" >= ${periodStart}::timestamptz
          AND "h"."createdAt" <= ${periodEnd}::timestamptz
          AND "c"."deletedAt" IS NULL
        GROUP BY COALESCE("h"."source", 'unknown')
        ORDER BY count DESC
      `,
            // ── Order funnel (count by orderStatus) ──
            prisma.$queryRaw `
        SELECT 
          "orderStatus",
          COUNT(*)::int AS count
        FROM "orders"
        WHERE "createdAt" >= ${periodStart}::timestamptz
          AND "createdAt" <= ${periodEnd}::timestamptz
          AND "deletedAt" IS NULL
        GROUP BY "orderStatus"
        ORDER BY count DESC
      `,
            // ── Revenue trend (daily SUM totalPrice for paid+ orders) ──
            prisma.$queryRaw `
        SELECT 
          date_trunc('day', "createdAt") AS "date",
          SUM("totalPrice")::float AS revenue,
          COUNT(*)::int AS "orderCount"
        FROM "orders"
        WHERE "createdAt" >= ${periodStart}::timestamptz
          AND "createdAt" <= ${periodEnd}::timestamptz
          AND "orderStatus" IN ('paid', 'shipped', 'packing')
          AND "deletedAt" IS NULL
        GROUP BY date_trunc('day', "createdAt")
        ORDER BY "date"
      `,
            // ── Active stores (created within period, not deleted) ──
            prisma.store.count({
                where: { createdAt: { gte: periodStart }, deletedAt: null },
            }),
            // ── Active customers (count distinct customerId in conversations within period) ──
            prisma.$queryRaw `
        SELECT COUNT(DISTINCT "customerId")::int AS count 
        FROM "conversations"
        WHERE "customerId" IS NOT NULL
          AND "customerId" != ''
          AND "createdAt" >= ${periodStart}::timestamptz
          AND "createdAt" <= ${periodEnd}::timestamptz
          AND "deletedAt" IS NULL
      `,
            // ── Totals ──
            prisma.conversationHistory.count({
                where: { createdAt: { gte: periodStart }, conversation: { deletedAt: null } },
            }),
            prisma.order.count({
                where: { createdAt: { gte: periodStart }, deletedAt: null },
            }),
            prisma.conversation.count({
                where: { createdAt: { gte: periodStart }, deletedAt: null },
            }),
            prisma.conversation.count({
                where: { humanTakeoverAt: { not: null }, createdAt: { gte: periodStart }, deletedAt: null },
            }),
            prisma.conversationHistory.aggregate({
                where: { source: 'ai', createdAt: { gte: periodStart }, conversation: { deletedAt: null } },
                _sum: { costUSD: true },
            }),
        ]);
        // ── Transform message volume results ──
        const messageVolumeTrend = messageVolumeResults.map((r) => ({
            date: new Date(r.date).toISOString(),
            customer: Number(r.customer || 0),
            assistant: Number(r.assistant || 0),
            system: Number(r.system || 0),
        }));
        // ── Transform cost trend ──
        const costTrendUSD = costTrendResults.map((r) => ({
            date: new Date(r.date).toISOString(),
            cost: Number(r.cost || 0),
        }));
        // ── Transform response time trend ──
        const responseTimeTrend = responseTimeResults.map((r) => ({
            date: new Date(r.date).toISOString(),
            avgMs: Math.round(Number(r.avgMs || 0)),
            count: Number(r.count || 0),
        }));
        // ── Source breakdown with percentages ──
        const totalMessagesInPeriod = sourceBreakdownResults.reduce((sum, r) => sum + Number(r.count || 0), 0);
        const sourceBreakdown = sourceBreakdownResults.map((r) => ({
            source: String(r.source || 'unknown'),
            count: Number(r.count || 0),
            percentage: totalMessagesInPeriod > 0 ? Math.round((Number(r.count || 0) / totalMessagesInPeriod) * 1000) / 10 : 0,
        }));
        // ── Order funnel with percentages ──
        const totalOrdersInPeriod = orderFunnelResults.reduce((sum, r) => sum + Number(r.count || 0), 0);
        const orderFunnel = orderFunnelResults.map((r) => ({
            status: String(r.orderStatus || 'unknown'),
            count: Number(r.count || 0),
            percentage: totalOrdersInPeriod > 0 ? Math.round((Number(r.count || 0) / totalOrdersInPeriod) * 1000) / 10 : 0,
        }));
        // ── Revenue trend ──
        const revenueTrend = revenueTrendResults.map((r) => ({
            date: new Date(r.date).toISOString(),
            revenue: Number(r.revenue || 0),
            orderCount: Number(r.orderCount || 0),
        }));
        // ── Derived rates ──
        const assistantCount = sourceBreakdownResults.find((r) => r.source === 'ai')?.count || 0;
        const faqCount = sourceBreakdownResults.find((r) => r.source === 'faq')?.count || 0;
        const aiResponseRate = totalMessagesInPeriod > 0
            ? (Number(assistantCount) / totalMessagesInPeriod) * 100
            : 0;
        const faqMatchRate = totalMessagesInPeriod > 0
            ? (Number(faqCount) / totalMessagesInPeriod) * 100
            : 0;
        // Human takeover rate = conversations with humanTakeoverAt / total conversations
        const humanTakeoverRate = totalConversations > 0
            ? (Number(humanTakeoverCount) / totalConversations) * 100
            : 0;
        const result = {
            range,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            messageVolumeTrend,
            costTrendUSD,
            responseTimeTrend,
            sourceBreakdown,
            aiResponseRate: Math.round(aiResponseRate * 10) / 10,
            faqMatchRate: Math.round(faqMatchRate * 10) / 10,
            humanTakeoverRate: Math.round(humanTakeoverRate * 10) / 10,
            orderFunnel,
            revenueTrend,
            activeStores: Number(activeStoresCount),
            activeCustomers: Number(activeCustomersCount?.[0]?.count || 0),
            totalMessages: Number(totalMessages),
            totalOrders: Number(totalOrders),
            totalCostUSD: Number(totalCostAgg._sum.costUSD || 0),
        };
        cache.data = result;
        cache.expiresAt = Date.now() + CACHE_TTL_MS;
        const duration = Date.now() - startMs;
        logger.info('Analytics computed', { range, duration, totalMessages, totalOrders });
        return result;
    }
    /** Force-clear analytics cache. */
    invalidateCache() {
        cache.data = null;
        cache.expiresAt = 0;
    }
}
export const analyticsService = new AnalyticsService();
//# sourceMappingURL=analytics.service.js.map