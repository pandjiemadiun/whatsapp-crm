import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { transitionOrder, ALLOWED_TRANSITIONS, getAllowedTransitions } from '../business/order-transition.js';
import { ApiError } from '../errors/ApiError.js';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
import { orderMutationLimiter } from '../middleware/rate-limiters.js';
import { paymentService } from '../business/payment.service.js';
import { shouldRestoreStock, restoreStockForOrderItems } from '../business/order.service.js';

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

// GET /api/orders — List orders for the authenticated store.
// Optional ?paymentStatus= and ?paymentMethod= filters (tenant-scoped via
// storeId) for callers like the Payment Verification / COD dashboard pages.
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const paymentStatus = req.query.paymentStatus as string | undefined;
    const paymentMethod = req.query.paymentMethod as string | undefined;

    const orders = await prisma.order.findMany({
      where: {
        storeId,
        deletedAt: null,
        ...(paymentStatus ? { paymentStatus } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
      },
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

// GET /api/orders/:id/valid-next-states — READ-ONLY: next legal orderStatus
// values from the order's CURRENT state. Reuses the authoritative state
// machine (getAllowedTransitions) — NO new transition logic here. Frontend
// uses this purely as a UI aid; payment-verify remains the final validator.
router.get('/:id/valid-next-states', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id, storeId, deletedAt: null },
      select: { orderStatus: true },
    });

    if (!order) {
      return res.status(404).json({ error: 'Pesanan tidak ditemukan' });
    }

    const nextStates = getAllowedTransitions(order.orderStatus);
    res.json({ success: true, data: nextStates });
  } catch (error: any) {
    adapters.logger.error('Failed to fetch valid next states', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to fetch valid next states' });
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
      include: { orderItems: { where: { productId: { not: null } } } },
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
    // which also manages confirmedAt invariant.
    // PV-P1-08: a manual admin cancel (→ 'cancelled') reverses the stock that
    // checkout atomically decremented, but ONLY for pre-shipment orders
    // (shouldRestoreStock + the state machine block shipped/paid-refund and
    // double-cancel). Restore runs in the SAME tx as the transition.
    if (orderStatus === 'cancelled' && shouldRestoreStock(order.orderStatus)) {
      const updated = await prisma.$transaction(async (tx) => {
        await restoreStockForOrderItems((order.orderItems ?? []) as any[], tx);
        return await transitionOrder(id, orderStatus, { actor: 'system', tx: tx as any });
      });
      adapters.logger.info('Order cancelled (admin); stock restored', {
        orderId: id,
        from: order.orderStatus,
        to: orderStatus,
        storeId,
      });
      res.json({ success: true, data: updated });
      return;
    }

    // Non-cancel status: plain transition (no stock movement).
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

// POST /api/orders/:id/payment-verify — admin verifikasi bukti bayar (transfer/qris only).
// Body: { decision: 'approve'|'reject', targetOrderStatus?: string, reason?: string }.
// Auth: reuse persis authMiddleware (store token) seperti PUT /:id/status.
// approve -> paymentStatus='paid' + transitionOrder(targetOrderStatus) dalam 1 transaksi.
//   targetOrderStatus WAJIB untuk approve; bila tidak valid (ALLOWED_TRANSITIONS) seluruh
//   transaksi rollback. reject -> paymentStatus='rejected' (orderStatus tidak berubah).
//   reject DAPAT menyertakan `reason?` opsional -> disimpan ke paymentRejectReason.
//   JANGAN wajibkan reason (backend maupun UI). COD ditolak (400).
router.post('/:id/payment-verify', orderMutationLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { id } = req.params;
    const { decision, targetOrderStatus, reason } = req.body as {
      decision?: string;
      targetOrderStatus?: string;
      reason?: string;
    };

    if (!decision || (decision !== 'approve' && decision !== 'reject')) {
      return res.status(400).json({ error: "decision harus 'approve' atau 'reject'" });
    }

    const result = await paymentService.verifyPayment(
      id,
      storeId,
      decision as 'approve' | 'reject',
      targetOrderStatus,
      req.user!.email, // identity approver = email dari auth context (bukan storeId yg redundant)
      reason, // alasan TOLAK opsional; undefined kalau tidak diisi (tetap null di DB)
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
    adapters.logger.error('Failed to verify payment', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to verify payment' });
  }
});

// POST /api/orders/:id/cod-settle — admin TANDAI COD LUNAS (manual).
// Auth: reuse persis authMiddleware (store token) seperti payment-verify.
// GUARD: HANYA jalan kalau Order.paymentMethod==='cod' DAN paymentStatus==='unpaid'.
//   Selain itu -> 400. (Non-COD / COD yang sudah bukan unpaid ditolak.)
// EFEK: set paymentStatus='paid', paymentVerifiedAt=now, verifiedByAdminId=<auth email>.
// DILARANG memanggil transitionOrder() — orderStatus TIDAK berubah sama sekali.
// Settlement otomatis DILARANG (sesuai DECISION-COD-SETTLEMENT-DEFERRED.md): admin
// tetap lanjutkan order via PUT /:id/status secara terpisah kalau perlu.
router.post('/:id/cod-settle', orderMutationLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id, storeId, deletedAt: null },
    });

    if (!order) {
      return res.status(404).json({ error: 'Pesanan tidak ditemukan' });
    }

    // Guard: endpoint ini EKSKLUSIF untuk COD.
    if (order.paymentMethod !== 'cod') {
      return res.status(400).json({ error: 'cod-settle hanya berlaku untuk pesanan COD' });
    }
    // Guard: hanya yang masih unpaid yang boleh diselesaikan.
    if (order.paymentStatus !== 'unpaid') {
      return res.status(400).json({ error: 'Pesanan COD sudah diselesaikan (bukan status unpaid)' });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: {
        paymentStatus: 'paid',
        paymentVerifiedAt: new Date(),
        verifiedByAdminId: req.user!.email, // identity settler = email dari auth context
      },
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    adapters.logger.error('Failed to settle COD payment', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to settle COD payment' });
  }
});

export default router;
