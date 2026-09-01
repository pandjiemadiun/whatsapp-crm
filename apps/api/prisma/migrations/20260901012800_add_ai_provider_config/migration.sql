-- LLM Provider Abstraction — Unit 1: AIProviderConfig table (schema-only).
-- Replaces the need to hardcode provider model/endpoint/key per-adapter with a
-- DB-driven, CRUD-friendly provider record set. See schema.prisma model block.
--
-- PURELY ADDITIVE — new table only. No changes to existing tables or columns.
-- system_settings GROQ_API_KEYS / GEMINI_API_KEY rows are intentionally NOT
-- touched here (cutover to AIProviderConfig happens in Unit 3/5, not here).
--
-- format/role are validated strings (app-layer), not DB enums — no CREATE TYPE.
-- apiKey stores AES-256-GCM ciphertext ("iv:tag:ciphertext"); the read-side
-- decrypt middleware registration is deferred to Unit 3 (see prisma.ts note).

-- CreateTable
CREATE TABLE "ai_provider_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_provider_configs_role_isActive_priority_idx" ON "ai_provider_configs"("role", "isActive", "priority");
