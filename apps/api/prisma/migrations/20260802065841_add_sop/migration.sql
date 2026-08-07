-- CreateTable
CREATE TABLE "sops" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sops_storeId_idx" ON "sops"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "sops_storeId_category_key" ON "sops"("storeId", "category");

-- AddForeignKey
ALTER TABLE "sops" ADD CONSTRAINT "sops_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
