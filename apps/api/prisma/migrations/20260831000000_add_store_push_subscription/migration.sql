-- Merchant (Store) push subscriptions. One row per subscribed browser/device.
-- Scoped by storeId for tenant isolation.

CREATE TABLE "store_push_subscriptions" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_push_subscriptions_storeId_endpoint_key" ON "store_push_subscriptions"("storeId", "endpoint");
CREATE INDEX "store_push_subscriptions_storeId_idx" ON "store_push_subscriptions"("storeId");
ALTER TABLE "store_push_subscriptions" ADD CONSTRAINT "store_push_subscriptions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
