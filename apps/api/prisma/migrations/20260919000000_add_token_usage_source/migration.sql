-- Migration: Add source column to TokenUsageLog
-- Adds nullable attribution column so every token usage record can be
-- tagged with its calling process (customer_message, test_connection,
-- magic_paste, e2e_test, admin_manual, other). Backward-compatible:
-- existing rows keep source=NULL; new rows should populate it from the
-- updated logTokenUsage() call sites.

BEGIN;

ALTER TABLE "token_usage_logs"
  ADD COLUMN "source" TEXT;

COMMIT;
