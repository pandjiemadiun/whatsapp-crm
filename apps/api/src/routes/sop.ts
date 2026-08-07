import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';

const router = Router();

const VALID_CATEGORIES = ['order', 'komplain', 'retur', 'garansi', 'stok_habis'] as const;

// All SOP routes require authentication
router.use(authMiddleware);

// GET /api/sop — list all 5 SOP entries for the authenticated store
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;

    const sops = await prisma.sop.findMany({
      where: { storeId },
      orderBy: { category: 'asc' },
    });

    res.json({ success: true, data: sops });
  } catch (error: any) {
    adapters.logger.error('Failed to fetch SOPs', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to fetch SOPs' });
  }
});

// PUT /api/sop/:category — upsert content for a category
router.put('/:category', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { category } = req.params;
    const { content } = req.body;

    if (!VALID_CATEGORIES.includes(category as any)) {
      return res.status(400).json({
        error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
      });
    }

    if (content === undefined) {
      return res.status(400).json({ error: 'content is required' });
    }

    const sop = await prisma.sop.upsert({
      where: {
        storeId_category: {
          storeId,
          category,
        },
      },
      update: { content },
      create: {
        storeId,
        category,
        content,
      },
    });

    res.json({
      success: true,
      message: 'SOP updated successfully',
      data: sop,
    });
  } catch (error: any) {
    adapters.logger.error('Failed to update SOP', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to update SOP' });
  }
});

export default router;
