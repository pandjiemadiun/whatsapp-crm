-- Add shipping configuration fields to stores (V1: flat-rate only, no provider API integration)
ALTER TABLE "stores" ADD COLUMN "shippingMode" TEXT NOT NULL DEFAULT 'pickup';
ALTER TABLE "stores" ADD COLUMN "shippingFlatInCity" DOUBLE PRECISION;
ALTER TABLE "stores" ADD COLUMN "shippingFlatOutCity" DOUBLE PRECISION;

-- SQLite (used by Prisma dev migrations for some providers) needs column-level DEFAULT
-- PostgreSQL with the migration above already handles the NOT NULL DEFAULT on add.
