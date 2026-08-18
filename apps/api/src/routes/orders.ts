import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { transitionOrder, ALLOWED_TRANSITIONS } from '../business/order-transition.js';
import { ApiError } from '../errors/ApiError.js';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
import { orderMutationLimiter } from '../middleware/rate-limiters.js';

const router = Router();

router.use(authMiddleware);

const VALID_ORDER_STATUSES = [
  'draft',
  'waiting_address',
  'waiting_payment',
  'paid',
  'packing',
  'shipped',
  'pending',
  'cancelled',
  'completed',
  'refunded',
] as const;

// GET /api/orders — List orders for the authenticated store
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;

    const orders = await prisma.order.findMany({
      where: { storeId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: orders });
  } catch (error: any) {
    adapters.logger.error('Failed to fetch orders', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to fetch orders' });
  }
});

// GET /api/orders/:id — Order detail with ownership check
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id, storeId, deletedAt: null },
    });

    if (!order) {
      return res.status(404).json({ error: 'Pesanan tidak ditemukan' });
    }

    // Fetch customer phone from conversation
    const conversation = await prisma.conversation.findFirst({
      where: { id: order.conversationId },
      select: { customerPhone: true },
    });

    res.json({
      success: true,
      data: {
        ...order,
        customerPhone: conversation?.customerPhone || order.customerId,
      },
    });
  } catch (error: any) {
    adapters.logger.error('Failed to fetch order detail', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to fetch order detail' });
  }
});

// PUT /api/orders/:id/status — Update order status with ownership check
router.put('/:id/status', orderMutationLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { id } = req.params;
    const { orderStatus } = req.body;

    if (!orderStatus || !VALID_ORDER_STATUSES.includes(orderStatus)) {
      return res.status(400).json({
        error: `Status tidak valid. Gunakan: ${VALID_ORDER_STATUSES.join(', ')}`,
      });
    }

    const order = await prisma.order.findFirst({
      where: { id, storeId, deletedAt: null },
    });

    if (!order) {
      return res.status(404).json({ error: 'Pesanan tidak ditemukan' });
    }

    // Validate transition from current status using state machine
    const allowed = ALLOWED_TRANSITIONS[order.orderStatus];
    if (!allowed || !allowed.has(orderStatus)) {
      return res.status(400).json({
        error: `Transisi status ${order.orderStatus} → ${orderStatus} tidak diizinkan`,
      });
    }

    // Delegate to transitionOrder for authoritative state machine transition
    // which also manages confirmedAt invariant
    const updated = await transitionOrder(id, orderStatus, { actor: 'system' });
    adapters.logger.info('Order status updated via transitionOrder', {
      orderId: id,
      from: order.orderStatus,
      to: orderStatus,
      storeId,
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
    adapters.logger.error('Failed to update order status', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to update order status' });
  }
});

export default router;
