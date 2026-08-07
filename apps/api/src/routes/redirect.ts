import { Router, Request, Response } from 'express';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';

const router = Router();

/**
 * GET /r/:storeId
 * Short-link redirect to a store's QRIS image. Public route (no auth).
 * If the QRIS image URL is a presigned URL that's about to expire,
 * refresh it via storage adapter before redirecting.
 */
router.get('/:storeId', async (req: Request, res: Response) => {
  const { storeId } = req.params;

  try {
    const store = await prisma.store.findUnique({
      where: { id: storeId, deletedAt: null },
      select: { qrisImageUrl: true },
    });

    if (!store || !store.qrisImageUrl) {
      return res.status(404).send('QRIS image not found');
    }

    let redirectUrl = store.qrisImageUrl;

    // Refresh presigned URL if storage adapter supports it
    if (adapters.catalogStorage && typeof adapters.catalogStorage.refreshImageUrl === 'function') {
      try {
        redirectUrl = await adapters.catalogStorage.refreshImageUrl(store.qrisImageUrl);
      } catch (err) {
        adapters.logger.warn('Failed to refresh QRIS image URL, using stored URL', {
          storeId,
          error: (err as Error).message,
        });
        redirectUrl = store.qrisImageUrl;
      }
    }

    adapters.logger.info('qris_shortlink_clicked', { storeId });

    res.redirect(302, redirectUrl);
  } catch (err) {
    adapters.logger.error('qris_shortlink_error', err as Error, { storeId });
    res.status(500).send('Internal server error');
  }
});

export default router;
