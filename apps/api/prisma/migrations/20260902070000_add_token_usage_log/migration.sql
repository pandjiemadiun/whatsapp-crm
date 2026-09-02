-- Token Usage Persistence — Unit 1: TokenUsageLog table.
-- Persists per-request token usage that was previously in-memory only
-- (lost on restart, 1-hour window). Now queryable by flexible time range.
--
-- PURELY ADDITIVE — new table only. No changes to existing tables.
-- id has no DB DEFAULT: Prisma generates uuid() client-side (same pattern as ai_provider_configs).

-- CreateTable
CREATE TABLE "token_usage_logs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "role" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "token_usage_logs_provider_createdAt_idx" ON "token_usage_logs"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "token_usage_logs_createdAt_idx" ON "token_usage_logs"("createdAt");
