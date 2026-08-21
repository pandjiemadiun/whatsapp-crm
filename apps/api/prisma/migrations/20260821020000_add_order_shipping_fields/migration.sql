-- AlterTable
ALTER TABLE "orders" ADD COLUMN "shippingCost" DOUBLE PRECISION;
ALTER TABLE "orders" ADD COLUMN "selectedCourier" TEXT;
ALTER TABLE "orders" ADD COLUMN "selectedService" TEXT;
ALTER TABLE "orders" ADD COLUMN "shippingEtd" TEXT;
