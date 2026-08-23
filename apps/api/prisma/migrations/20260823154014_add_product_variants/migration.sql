-- PV-P0: product variants foundation (schema-only, additive, no business logic)
-- Adds: Product.hasVariants, ProductVariant model, OrderItem.variantId.
-- All additive: existing rows keep hasVariants=false, variantId=null.

-- 1. Product: flag hasVariants (default false for all existing rows)
ALTER TABLE "products" ADD COLUMN "hasVariants" BOOLEAN NOT NULL DEFAULT false;

-- 2. OrderItem: nullable variantId (existing rows = null = no variant)
ALTER TABLE "order_items" ADD COLUMN "variantId" TEXT;

-- 3. ProductVariant table
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sku" TEXT,
    "attributes" JSONB NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "stock" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- 4. Indexes
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");
CREATE UNIQUE INDEX "product_variants_storeId_sku_key" ON "product_variants"("storeId", "sku");
CREATE INDEX "order_items_variantId_idx" ON "order_items"("variantId");

-- 5. Foreign keys
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
