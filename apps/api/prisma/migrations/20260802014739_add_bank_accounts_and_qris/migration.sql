-- Create bank_accounts table
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storeId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- Create index on storeId
CREATE INDEX "bank_accounts_storeId_idx" ON "bank_accounts" ("storeId");

-- Add foreign key constraint to stores
ALTER TABLE "bank_accounts"
ADD CONSTRAINT "bank_accounts_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "stores" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add qrisImageUrl column to stores
ALTER TABLE "stores" ADD COLUMN "qrisImageUrl" TEXT;

-- ─── Data Migration: copy existing bank data from stores to bank_accounts ───
INSERT INTO "bank_accounts" ("storeId", "bankName", "accountNumber", "accountName", "isActive", "createdAt", "updatedAt")
SELECT
    id,
    "bankName",
    "bankAccountNumber",
    "bankAccountName",
    true,
    NOW(),
    NOW()
FROM "stores"
WHERE "bankName" IS NOT NULL
   OR "bankAccountNumber" IS NOT NULL
   OR "bankAccountName" IS NOT NULL;

-- ─── Drop old bank columns from stores (data now in bank_accounts) ───
ALTER TABLE "stores" DROP COLUMN "bankName";
ALTER TABLE "stores" DROP COLUMN "bankAccountNumber";
ALTER TABLE "stores" DROP COLUMN "bankAccountName";
