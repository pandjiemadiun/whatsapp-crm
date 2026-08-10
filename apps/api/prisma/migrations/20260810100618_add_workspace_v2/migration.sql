-- Add workspace_v2 column to conversation_context
-- Task P3.1: Persist WorkspaceV2 ke kolom baru (bukan reuse extractedEntities)
-- T1 fix: workspace_v2 JSON nullable, default NULL untuk existing rows

-- AlterTable
ALTER TABLE "conversation_context" ADD COLUMN "workspace_v2" JSONB;
