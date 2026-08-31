import { prisma } from '../infrastructure/prisma.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { transitionOrder, InvalidOrderTransitionError } from './order-transition.js';
import { eventBus } from '../services/event-bus.service.js';
/**
 * PaymentService (G2-F2) — verifikasi pembayaran manual transfer/QRIS.
 *
 * INVARIAN (kontrak):
 *  - payment-verify (approve) TIDAK mengubah `orderStatus` secara langsung.
 *    Ia memanggil `transitionOrder(orderId, targetOrderStatus, { tx })` — otoritas
 *    transisi status order tetap EKSKLUSIF di order-transition.ts.
 *  - paymentStatus dimiliki sepenuhnya oleh endpoint ini.
 *  - COD TIDAK BOLEH masuk ke sini sama sekali (lifecycle terpisah).
 */
const PAYMENT_METHODS = ['transfer', 'qris'];
export class PaymentService {
    /**
     * Customer melaporkan bukti bayar (transfer/qris).
     * HANYA mutasi `paymentStatus`: `unpaid`/`rejected` -> `pending_verification`.
     * `orderStatus` TIDAK disentuh. Tenant isolation via storeId+customerId.
     */
    async reportPayment(orderId, storeId, customerId, paymentMethod, proofUrl) {
        if (!PAYMENT_METHODS.includes(paymentMethod)) {
            throw new ApiError(ErrorCodes.ERR_VALIDATION, "paymentMethod harus 'transfer' atau 'qris'");
        }
        if (paymentMethod === 'cod') {
            // Kontrak: request COD -> 400 sebelum tulis DB.
            throw new ApiError(ErrorCodes.ERR_VALIDATION, 'COD tidak mendukung lapor bukti transfer/qris');
        }
        const order = await prisma.order.findFirst({
            where: { id: orderId, storeId, customerId, deletedAt: null },
        });
        if (!order)
            throw new ApiError(ErrorCodes.ERR_NOT_FOUND, 'Pesanan tidak ditemukan');
        // Kontrak: Order.paymentMethod === 'cod' -> 400 (COD tidak boleh masuk flow ini).
        if (order.paymentMethod === 'cod') {
            throw new ApiError(ErrorCodes.ERR_VALIDATION, 'Pesanan COD tidak dapat dilaporkan di sini');
        }
        // Guarded update: tolak bila sudah pending_verification/paid (cegah overwrite diam-diam).
        try {
            const updated = await prisma.order.update({
                where: { id: orderId, paymentStatus: { in: ['unpaid', 'rejected'] } },
                data: {
                    paymentMethod,
                    paymentStatus: 'pending_verification',
                    paymentProofUrl: proofUrl,
                    paymentReportedAt: new Date(),
                },
                include: { orderItems: { orderBy: { createdAt: 'asc' } } },
            });
            // Emit payment pending event AFTER successful update.
            eventBus.publish({
                event: 'order.payment_verification_pending',
                storeId,
                data: {
                    orderId,
                    storeId,
                    total: updated.totalPrice ?? undefined,
                },
                ts: Date.now(),
            });
            return updated;
        }
        catch (e) {
            if (e?.code === 'P2025') {
                throw new ApiError(ErrorCodes.ERR_VALIDATION, 'Pesanan tidak dalam status yang dapat dilaporkan (sudah diverifikasi atau dalam proses)');
            }
            throw e;
        }
    }
    /**
     * Admin memverifikasi bukti bayar (transfer/qris only).
     *  - approve: SATU transaksi atomik -> set paymentStatus='paid' + transitionOrder(targetOrderStatus).
     *    Bila targetOrderStatus tidak valid (ALLOWED_TRANSITIONS), SELURUH transaksi rollback,
     *    paymentStatus tetap pending_verification.
     *  - reject: set paymentStatus='rejected'. orderStatus TIDAK berubah.
     */
    async verifyPayment(orderId, storeId, decision, targetOrderStatus, verifiedByAdminId, rejectReason) {
        const order = await prisma.order.findFirst({
            where: { id: orderId, storeId, deletedAt: null },
        });
        if (!order)
            throw new ApiError(ErrorCodes.ERR_NOT_FOUND, 'Pesanan tidak ditemukan');
        // Kontrak: Order.paymentMethod === 'cod' -> 400.
        if (order.paymentMethod === 'cod') {
            throw new ApiError(ErrorCodes.ERR_VALIDATION, 'Verifikasi pembayaran tidak berlaku untuk pesanan COD');
        }
        // Hanya yang benar-benar menunggu verifikasi yang bisa diverifikasi.
        if (order.paymentStatus !== 'pending_verification') {
            throw new ApiError(ErrorCodes.ERR_VALIDATION, 'Pesanan belum dalam status pending_verification');
        }
        if (decision === 'approve') {
            if (!targetOrderStatus) {
                // Kontrak: approve tanpa targetOrderStatus -> 400 (jangan tebak state).
                throw new ApiError(ErrorCodes.ERR_VALIDATION, 'targetOrderStatus wajib untuk decision=approve');
            }
            const now = new Date();
            try {
                await prisma.$transaction(async (tx) => {
                    await tx.order.update({
                        where: { id: orderId },
                        data: {
                            paymentStatus: 'paid',
                            paymentVerifiedAt: now,
                            verifiedByAdminId,
                        },
                    });
                    // Otoritas transisi orderStatus tetap di transitionOrder.
                    await transitionOrder(orderId, targetOrderStatus, { tx });
                });
            }
            catch (e) {
                if (e instanceof InvalidOrderTransitionError) {
                    throw new ApiError(ErrorCodes.ERR_VALIDATION, e.message);
                }
                throw e;
            }
        }
        else {
            await prisma.order.update({
                where: { id: orderId },
                data: {
                    paymentStatus: 'rejected',
                    paymentVerifiedAt: new Date(),
                    verifiedByAdminId,
                    // Alasan TOLAK opsional: kalau tidak diberi, biarkan null (JANGAN placeholder default).
                    paymentRejectReason: rejectReason ?? null,
                },
            });
        }
        const row = await prisma.order.findUnique({
            where: { id: orderId },
            include: { orderItems: { orderBy: { createdAt: 'asc' } } },
        });
        return row;
    }
}
export const paymentService = new PaymentService();
//# sourceMappingURL=payment.service.js.map