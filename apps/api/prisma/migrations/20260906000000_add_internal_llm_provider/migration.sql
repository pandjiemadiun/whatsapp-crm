-- Migration: Add Basic Auth support to AIProviderConfig
-- Adds authType, username, password columns for Basic Authenticated providers
-- (e.g. Internal LLM / puter.js at https://llm.qlobot.web.id/v1)

BEGIN;

ALTER TABLE "ai_provider_configs"
  ADD COLUMN "authType" TEXT NOT NULL DEFAULT 'bearer',
  ADD COLUMN "username" TEXT,
  ADD COLUMN "password" TEXT;

-- Update existing rows: they all use bearer auth
UPDATE "ai_provider_configs" SET "authType" = 'bearer' WHERE "authType" IS NULL;

COMMIT;
