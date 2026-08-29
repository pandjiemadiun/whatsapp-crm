/**
 * Run a single auto-cancel pass against the live DB.
 * `now` is injected for deterministic unit tests (defaults to "now").
 *
 * Selection (ALL required, per PV-P1-08):
 *   - orderStatus IN (waiting_address, waiting_payment)
 *   - autoCancelAt <= now          (the checkout reservation window elapsed)
 *   - paymentStatus != 'pending_verification'  (customer already submitted proof
 *     and is awaiting admin → NOT abandoned → must NOT be auto-cancelled)
 *
 * autoCancelAt = NULL (orders never stamped by checkout) is excluded by the
 * `lte` filter, so legacy/manual-window orders are left untouched.
 *
 * For each hit: (restore stock if pre-shipment) + transitionOrder('cancelled'),
 * inside a per-order $transaction. One stuck order must never abort the sweep.
 *
 * Returns the count of orders auto-cancelled.
 */
export declare function runAutoCancelOnce(now?: Date): Promise<number>;
/**
 * Schedule the recurring auto-cancel sweep: every 15 minutes.
 * Reuses the node-cron + adapters.logger pattern from scheduleBackups.ts.
 */
export declare function scheduleAutoCancel(): void;
//# sourceMappingURL=scheduleAutoCancel.d.ts.map