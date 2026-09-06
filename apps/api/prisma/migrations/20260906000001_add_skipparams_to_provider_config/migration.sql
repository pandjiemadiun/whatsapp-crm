-- Migration: Add skipParams column to AIProviderConfig
-- Allows per-provider omission of OpenAI params (e.g. temperature, top_p,
-- response_format) that certain backends reject. The Internal LLM
-- (webai-to-api Gemini proxy) rejects "temperature", "top_p", AND
-- "response_format" with HTTP 400 (smoke-test verified 6 Sep 2026).
-- Without response_format, the backend still returns JSON-wrapped text
-- (markdown code fence) which extractJson() parses successfully.

BEGIN;

ALTER TABLE "ai_provider_configs"
  ADD COLUMN "skipParams" JSONB;

-- Set skipParams for Internal LLM: this backend rejects temperature, top_p,
-- and response_format. With jsonMode:true in callV2Engine(), the adapter
-- omits response_format (so no 400) — backend returns text that extractJson()
-- parses into V2EngineOutput. Smoke test verified: add_to_cart + smalltalk.
UPDATE "ai_provider_configs"
  SET "skipParams" = '["temperature","top_p","response_format"]'
WHERE "name" = 'Internal LLM' AND "role" = 'chat_fallback_2';

COMMIT;
