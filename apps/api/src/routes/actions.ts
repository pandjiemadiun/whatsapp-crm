/**
 * Structured Actions Route — P0 ADD_TO_CART endpoint
 * 
 * POST /api/pwa/:storeSlug/action
 * Body: { uid: string, action: AddToCartRequest }
 * 
 * Server-resolves store/customer/conversation identity —
 * NEVER trusts client-supplied identity as business authority.
 */

import { randomUUID } from 'node:crypto';
import { pwaProductsLimiter } from '../middleware/rate-limiters.js';

import { Router, Request, Response } from 'express';
import { prisma } from '../infrastructure/prisma.js';
import { getOrCreateWebSession } from './pwa.js';
import { adapters } from '../adapters/container.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { executeAction, actionRegistry } from '../business/action-registry.js';

const router = Router();

// POST /api/pwa/:storeSlug/action — execute structured action
router.post('/:storeSlug/action', pwaProductsLimiter, async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    const { uid, action } = req.body as { uid?: string; action?: unknown };

    if (!storeSlug) {
      return res.status(404).json({ error: 'Store not found' });
    }
    if (!uid) {
      return res.status(400).json({ error: 'uid is required' });
    }
    if (!action || typeof action !== 'object') {
      return res.status(400).json({ error: 'action is required' });
    }

    // Resolve server-side identity via the SHARED Web session resolver (§7).
    // getOrCreateWebSession is the SAME resolver used by /handoff, mirroring
    // /message (pwa.ts:647-679). Do NOT duplicate customer/conversation logic.
    const store = await prisma.store.findUnique({
      where: { slug: storeSlug, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      return res.status(401).json({ error: 'Unauthorized customer or store' });
    }

    const session = await getOrCreateWebSession(store.id, uid);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized customer or store' });
    }

    const { storeId, customerId, conversationId } = session;

    // Execute action via registry
    const actionType = (action as any).type;
    if (!actionType) {
      return res.status(400).json({ error: 'action.type is required' });
    }

    const result = await executeAction(actionType, action, {
      storeId,
      customerId,
      conversationId,
      channel: 'web',
      requestId: randomUUID(),
    });

    // Map result to HTTP response
    if (!result.success && result.error?.code === 'ACTION_IN_PROGRESS') {
      return res.status(409).json({
        success: false,
        error: result.error.message,
        code: result.error.code,
      });
    }

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error?.message || 'Action failed',
        code: result.error?.code || 'ACTION_FAILED',
      });
    }

    return res.json({
      success: true,
      data: result.data,
    });

  } catch (err: any) {
    adapters.logger.error('Structured action error', err);
    
    if (err instanceof ApiError) {
      const status = err.code === ErrorCodes.ERR_NOT_FOUND ? 404 :
                     err.code === ErrorCodes.ERR_AUTH_FORBIDDEN ? 403 :
                     err.code === ErrorCodes.ERR_VALIDATION ? 400 : 500;
      return res.status(status).json({ error: err.message, code: err.code });
    }

    return res.status(500).json({ error: 'Failed to execute action' });
  }
});

export default router;