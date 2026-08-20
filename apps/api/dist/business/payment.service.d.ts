import type { OrderWithItems } from '../domain/types.js';
export declare class PaymentService {
    /**
     * Customer melaporkan bukti bayar (transfer/qris).
     * HANYA mutasi `paymentStatus`: `unpaid`/`rejected` -> `pending_verification`.
     * `orderStatus` TIDAK disentuh. Tenant isolation via storeId+customerId.
     */
    reportPayment(orderId: string, storeId: string, customerId: string, paymentMethod: string, proofUrl: string): Promise<OrderWithItems>;
    /**
     * Admin memverifikasi bukti bayar (transfer/qris only).
     *  - approve: SATU transaksi atomik -> set paymentStatus='paid' + transitionOrder(targetOrderStatus).
     *    Bila targetOrderStatus tidak valid (ALLOWED_TRANSITIONS), SELURUH transaksi rollback,
     *    paymentStatus tetap pending_verification.
     *  - reject: set paymentStatus='rejected'. orderStatus TIDAK berubah.
     */
    verifyPayment(orderId: string, storeId: string, decision: 'approve' | 'reject', targetOrderStatus: string | undefined, verifiedByAdminId: string): Promise<OrderWithItems>;
}
export declare const paymentService: PaymentService;
//# sourceMappingURL=payment.service.d.ts.map