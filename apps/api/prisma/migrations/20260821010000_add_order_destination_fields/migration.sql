-- AlterTable
ALTER TABLE "orders" ADD COLUMN "destinationProvinceId" TEXT;
ALTER TABLE "orders" ADD COLUMN "destinationProvinceName" TEXT;
ALTER TABLE "orders" ADD COLUMN "destinationCityId" TEXT;
ALTER TABLE "orders" ADD COLUMN "destinationCityName" TEXT;
ALTER TABLE "orders" ADD COLUMN "destinationSubdistrictId" TEXT;
ALTER TABLE "orders" ADD COLUMN "destinationSubdistrictName" TEXT;
