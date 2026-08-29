-- PV-P1-08: auto-expiry stamp for stuck orders (waiting_address / waiting_payment).
-- Set atomically at checkout (paired with the stock decrement) and consumed
-- by the 15-minute AutoCancel cron (scheduleAutoCancel). NULL = order is under
-- the manual 7-day window or already in a terminal state (no auto-cancel).
ALTER TABLE "orders" ADD COLUMN "autoCancelAt" TIMESTAMP;

-- Index backing the auto-cancel lookup: orders whose expiry window has elapsed
-- and that are still awaiting address/payment confirmation.
CREATE INDEX "orders_orderStatus_autoCancelAt_idx" ON "orders" ("orderStatus", "autoCancelAt");
