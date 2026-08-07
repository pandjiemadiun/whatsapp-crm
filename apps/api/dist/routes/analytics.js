import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { parseLocalDay, localDayKey } from '../utils/date-range.js';
const router = Router();
router.use(authMiddleware);
// ─── GET /api/analytics/magic-paste — Confidence metrics & extraction history ───
// Query params:
//   from?  (ISO date) batas awal — interpretasi LOCAL start-of-day (inclusive)
//   to?    (ISO date) batas akhir — interpretasi LOCAL end-of-day (inclusive)
//   status?  success|failed|preview
//   source?  store|admin
//   limit?   (default 50, max 200)
//   offset?  (default 0)
router.get('/magic-paste', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const where = { storeId };
        if (req.query.from) {
            where.createdAt = { ...where.createdAt, gte: parseLocalDay(String(req.query.from), false) };
        }
        if (req.query.to) {
            where.createdAt = { ...where.createdAt, lte: parseLocalDay(String(req.query.to), true) };
        }
        if (req.query.status)
            where.status = String(req.query.status);
        if (req.query.source)
            where.source = String(req.query.source);
        const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
        const offset = Math.max(0, Number(req.query.offset) || 0);
        // ── Summary KPIs ──
        const [total, failedCount, previewCount, agg, lowConfidenceCount, recentRuns] = await Promise.all([
            prisma.magicPasteRun.count({ where }),
            prisma.magicPasteRun.count({ where: { ...where, status: 'failed' } }),
            prisma.magicPasteRun.count({ where: { ...where, status: 'preview' } }),
            prisma.magicPasteRun.aggregate({
                where,
                _avg: { confidence: true },
                _min: { confidence: true },
                _max: { confidence: true },
            }),
            prisma.magicPasteRun.count({
                where: { ...where, status: 'success', confidence: { lt: 0.8 } },
            }),
            prisma.magicPasteRun.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: offset,
                select: {
                    id: true,
                    productId: true,
                    textLength: true,
                    confidence: true,
                    status: true,
                    warnings: true,
                    extractedEntities: true,
                    source: true,
                    errorMessage: true,
                    createdAt: true,
                },
            }),
        ]);
        // ── Trend per hari (7 hari terakhir) ──
        const trendDays = 14;
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        since.setDate(since.getDate() - (trendDays - 1));
        const dayRuns = await prisma.magicPasteRun.findMany({
            where: {
                ...where,
                status: { in: ['success', 'failed'] },
                createdAt: { gte: since },
            },
            select: { confidence: true, status: true, createdAt: true },
        });
        const trendMap = new Map();
        for (let i = 0; i < trendDays; i++) {
            const d = new Date(since);
            d.setDate(since.getDate() + i);
            const key = localDayKey(d);
            trendMap.set(key, { date: key, count: 0, avgConfidence: 0, sumConfidence: 0, failed: 0 });
        }
        for (const r of dayRuns) {
            const key = localDayKey(new Date(r.createdAt));
            const entry = trendMap.get(key);
            if (!entry)
                continue;
            entry.count += 1;
            entry.sumConfidence += r.confidence;
            if (r.status === 'failed')
                entry.failed += 1;
        }
        const trend = Array.from(trendMap.values()).map((e) => ({
            date: e.date,
            count: e.count,
            failed: e.failed,
            avgConfidence: e.count > 0 ? Math.round((e.sumConfidence / e.count) * 100) / 100 : 0,
        }));
        // ── Distribusi confidence buckets ──
        const successRuns = await prisma.magicPasteRun.findMany({
            where: { ...where, status: 'success' },
            select: { confidence: true },
        });
        const distribution = {
            low: successRuns.filter((r) => r.confidence < 0.6).length,
            medium: successRuns.filter((r) => r.confidence >= 0.6 && r.confidence < 0.8).length,
            high: successRuns.filter((r) => r.confidence >= 0.8).length,
        };
        // ── Breakdown per source ──
        const sourceGroup = await prisma.magicPasteRun.groupBy({
            by: ['source'],
            where,
            _count: { _all: true },
            _avg: { confidence: true },
        });
        const sourceBreakdown = sourceGroup.map((s) => ({
            source: s.source,
            count: s._count._all,
            avgConfidence: s._avg.confidence ? Math.round(s._avg.confidence * 100) / 100 : 0,
        }));
        const totalSuccess = total - failedCount - previewCount;
        const avgConfidence = agg._avg.confidence ? Math.round(agg._avg.confidence * 100) / 100 : 0;
        // Median confidence
        const confidences = successRuns.map((r) => r.confidence).sort((a, b) => a - b);
        let median = 0;
        if (confidences.length > 0) {
            const mid = Math.floor(confidences.length / 2);
            median = confidences.length % 2
                ? confidences[mid]
                : (confidences[mid - 1] + confidences[mid]) / 2;
            median = Math.round(median * 100) / 100;
        }
        res.json({
            success: true,
            data: {
                summary: {
                    totalExtractions: total,
                    totalSuccess,
                    failedCount,
                    previewCount,
                    averageConfidence: avgConfidence,
                    medianConfidence: median,
                    minConfidence: agg._min.confidence ? Math.round(agg._min.confidence * 100) / 100 : 0,
                    maxConfidence: agg._max.confidence ? Math.round(agg._max.confidence * 100) / 100 : 0,
                    lowConfidenceCount,
                    lowConfidenceRate: totalSuccess > 0 ? Math.round((lowConfidenceCount / totalSuccess) * 100) / 100 : 0,
                    successRate: total > 0 ? Math.round((totalSuccess / total) * 100) / 100 : 0,
                },
                trend,
                distribution,
                sourceBreakdown,
                history: recentRuns.map((r) => ({
                    id: r.id,
                    productId: r.productId,
                    textLength: r.textLength,
                    confidence: r.confidence,
                    status: r.status,
                    warnings: r.warnings,
                    extractedName: r.extractedEntities?.name ?? null,
                    categoryHint: r.extractedEntities?.categoryHint ?? null,
                    source: r.source,
                    errorMessage: r.errorMessage,
                    createdAt: r.createdAt,
                })),
                pagination: { limit, offset, total },
            },
        });
    }
    catch (error) {
        adapters.logger.error('Magic paste analytics failed', error);
        res.status(500).json({ error: 'Gagal memuat analytics' });
    }
});
export default router;
//# sourceMappingURL=analytics.js.map