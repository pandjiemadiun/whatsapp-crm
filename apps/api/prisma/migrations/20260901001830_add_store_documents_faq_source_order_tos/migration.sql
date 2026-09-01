-- PV-P1: Onboarding Wizard schema (contract §3.1).
-- P0 audit confirmed FAQ/Knowledge are store-scoped keyword-match (no embedding
-- wired) and effectively empty in production.
--
-- PURELY ADDITIVE — no column drops, no NOT NULL on existing columns, no data
-- transformation. Existing rows are untouched: FAQ.source defaults to NULL
-- ("manual/unknown"); Order.tosDocumentId is nullable (legacy orders unaffected).

-- type
CREATE TYPE "StoreDocumentType" AS ENUM ('tos', 'sop');

-- status
CREATE TYPE "StoreDocumentStatus" AS ENUM ('draft', 'published', 'superseded');

-- StoreDocument table
CREATE TABLE "store_documents" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" "StoreDocumentType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" TEXT NOT NULL,
    "status" "StoreDocumentStatus" NOT NULL DEFAULT 'draft',
    "generatedFromAnswers" JSONB,
    "generatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_documents_pkey" PRIMARY KEY ("id")
);

-- @@index([storeId, type, status])
CREATE INDEX "store_documents_storeId_type_status_idx" ON "store_documents"("storeId", "type", "status");

-- @@unique([storeId, type, version])
CREATE UNIQUE INDEX "store_documents_storeId_type_version_key" ON "store_documents"("storeId", "type", "version");

-- FK: store_documents -> stores
ALTER TABLE "store_documents" ADD CONSTRAINT "store_documents_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FAQ.source (nullable, no default) — mirrors Knowledge.source
ALTER TABLE "faqs" ADD COLUMN "source" TEXT;

-- Order.tosDocumentId (nullable) + relation FK to StoreDocument
ALTER TABLE "orders" ADD COLUMN "tosDocumentId" TEXT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tosDocumentId_fkey" FOREIGN KEY ("tosDocumentId") REFERENCES "store_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
