-- Add indexes for analytics trend queries (Stage H1: performance optimization, no schema change)
-- These support date-range GROUP BY queries on conversation_history and orders.

CREATE INDEX IF NOT EXISTS "conversation_history_createdAt_idx" ON "conversation_history"("createdAt");
CREATE INDEX IF NOT EXISTS "conversation_history_createdAt_source_idx" ON "conversation_history"("createdAt", "source");
CREATE INDEX IF NOT EXISTS "orders_createdAt_idx" ON "orders"("createdAt");
CREATE INDEX IF NOT EXISTS "orders_orderStatus_createdAt_idx" ON "orders"("orderStatus", "createdAt");
