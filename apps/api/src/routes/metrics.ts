import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';

const router = Router();

router.use(authMiddleware);

// GET /api/dashboard/metrics — Aggregated stats for the authenticated store
router.get('/metrics', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;

    const [totalMessages, faqAnswered, costAgg] = await Promise.all([
      prisma.conversationHistory.count({
        where: { conversation: { storeId } },
      }),
      prisma.conversationHistory.count({
        where: { conversation: { storeId }, source: 'faq' },
      }),
      prisma.conversationHistory.aggregate({
        where: { conversation: { storeId }, source: 'ai' },
        _sum: { costUSD: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalMessages,
        faqAnswered,
        aiCostUSD: costAgg._sum.costUSD ?? 0,
      },
    });
  } catch (error: any) {
    adapters.logger.error('Failed to fetch dashboard metrics', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to fetch dashboard metrics' });
  }
});

export default router;
