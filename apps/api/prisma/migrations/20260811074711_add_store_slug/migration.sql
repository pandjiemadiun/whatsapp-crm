-- AlterTable
ALTER TABLE "stores" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");
