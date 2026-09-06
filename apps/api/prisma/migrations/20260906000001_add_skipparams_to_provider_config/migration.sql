-- Migration: Add skipParams column to AIProviderConfig
-- Allows per-provider omission of OpenAI params (e.g. temperature, top_p)
-- that certain backends reject. For example, the Internal LLM (webai-to-api
-- Gemini proxy) rejects "temperature" and "top_p" with HTTP 400.

BEGIN;

ALTER TABLE "ai_provider_configs"
  ADD COLUMN "skipParams" JSONB;

-- Set skipParams for Internal LLM: this backend rejects temperature and top_p
UPDATE "ai_provider_configs"
  SET "skipParams" = '["temperature","top_p"]'
WHERE "name" = 'Internal LLM' AND "role" = 'chat_fallback_2';

COMMIT;
