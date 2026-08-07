import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
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
// GET /api/orders — List orders for the authenticated store
router.get('/', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const orders = await prisma.order.findMany({
            where: { storeId, deletedAt: null },
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
// PUT /api/orders/:id/status — Update order status with ownership check
router.put('/:id/status', async (req, res) => {
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
        const updated = await prisma.order.update({
            where: { id },
            data: {
                orderStatus,
            },
        });
        adapters.logger.info('Order status updated', {
            orderId: id,
            from: order.orderStatus,
            to: orderStatus,
            storeId,
        });
        res.json({ success: true, data: updated });
    }
    catch (error) {
        adapters.logger.error('Failed to update order status', error);
        res.status(500).json({ error: error?.message || 'Failed to update order status' });
    }
});
export default router;
//# sourceMappingURL=orders.js.map