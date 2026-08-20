import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { transitionOrder, ALLOWED_TRANSITIONS, getAllowedTransitions } from '../business/order-transition.js';
import { ApiError } from '../errors/ApiError.js';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
import { orderMutationLimiter } from '../middleware/rate-limiters.js';
import { paymentService } from '../business/payment.service.js';
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
];
// GET /api/orders — List orders for the authenticated store.
// Optional ?paymentStatus= filter (tenant-scoped via storeId) for callers
// like the Payment Verification dashboard page.
router.get('/', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const paymentStatus = req.query.paymentStatus;
        const orders = await prisma.order.findMany({
            where: {
                storeId,
                deletedAt: null,
                ...(paymentStatus ? { paymentStatus } : {}),
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: orders });
    }
    catch (error) {
        adapters.logger.error('Failed to fetch orders', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch orders' });
    }
});
// GET /api/orders/:id — Order detail with ownership check
router.get('/:id', async (req, res) => {
    try {
        const storeId = req.user.storeId;
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
    }
    catch (error) {
        adapters.logger.error('Failed to fetch order detail', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch order detail' });
    }
});
// GET /api/orders/:id/valid-next-states — READ-ONLY: next legal orderStatus
// values from the order's CURRENT state. Reuses the authoritative state
// machine (getAllowedTransitions) — NO new transition logic here. Frontend
// uses this purely as a UI aid; payment-verify remains the final validator.
router.get('/:id/valid-next-states', async (req, res) => {
    try {
        const storeId = req.user.storeId;
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
    }
    catch (error) {
        adapters.logger.error('Failed to fetch valid next states', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch valid next states' });
    }
});
// PUT /api/orders/:id/status — Update order status with ownership check
router.put('/:id/status', orderMutationLimiter, async (req, res) => {
    try {
        const storeId = req.user.storeId;
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
    }
    catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode || 500).json({ error: error.message });
        }
        adapters.logger.error('Failed to update order status', error);
        res.status(500).json({ error: error?.message || 'Failed to update order status' });
    }
});
// POST /api/orders/:id/payment-verify — admin verifikasi bukti bayar (transfer/qris only).
// Body: { decision: 'approve'|'reject', targetOrderStatus?: string }.
// Auth: reuse persis authMiddleware (store token) seperti PUT /:id/status.
// approve -> paymentStatus='paid' + transitionOrder(targetOrderStatus) dalam 1 transaksi.
//   targetOrderStatus WAJIB untuk approve; bila tidak valid (ALLOWED_TRANSITIONS) seluruh
//   transaksi rollback. reject -> paymentStatus='rejected' (orderStatus tidak berubah).
// COD ditolak (400) — endpoint ini eksklusif untuk verifikasi bukti transfer/qris.
router.post('/:id/payment-verify', orderMutationLimiter, async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const { id } = req.params;
        const { decision, targetOrderStatus } = req.body;
        if (!decision || (decision !== 'approve' && decision !== 'reject')) {
            return res.status(400).json({ error: "decision harus 'approve' atau 'reject'" });
        }
        const result = await paymentService.verifyPayment(id, storeId, decision, targetOrderStatus, req.user.email);
        res.json({ success: true, data: result });
    }
    catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode || 500).json({ error: error.message });
        }
        adapters.logger.error('Failed to verify payment', error);
        res.status(500).json({ error: error?.message || 'Failed to verify payment' });
    }
});
export default router;
//# sourceMappingURL=orders.js.map