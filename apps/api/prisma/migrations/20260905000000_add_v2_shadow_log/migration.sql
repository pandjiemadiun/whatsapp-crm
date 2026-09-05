BEGIN;

-- V2 Engine Shadow Log — P2-UNIT5
-- Read-only log of V2 engine output (parallel to V1) in shadow mode.
CREATE TABLE "v2_shadow_logs" (
    "id"            UUID           NOT NULL DEFAULT gen_random_uuid(),
    "storeId"       TEXT           NOT NULL,
    "conversationId" TEXT          NOT NULL,
    "customerMessage" TEXT         NOT NULL,
    "v1ActualReply" TEXT           NOT NULL,
    "v2Output"      JSONB          NOT NULL,
    "v2EnrichedReply" TEXT,
    "createdAt"     TIMESTAMP(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "v2_shadow_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "v2_shadow_logs_storeId_idx" ON "v2_shadow_logs" ("storeId");
CREATE INDEX "v2_shadow_logs_conversationId_idx" ON "v2_shadow_logs" ("conversationId");
CREATE INDEX "v2_shadow_logs_createdAt_idx" ON "v2_shadow_logs" ("createdAt");

COMMIT;
