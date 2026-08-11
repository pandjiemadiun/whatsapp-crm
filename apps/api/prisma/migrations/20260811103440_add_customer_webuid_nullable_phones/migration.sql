-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "customerPhone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "webUid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "customers_webUid_key" ON "customers"("webUid");
