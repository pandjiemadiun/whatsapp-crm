-- Make store contact/location fields NOT NULL (pre-launch: no real merchant stores exist).
-- Leftover dev/test rows that have NULLs are filled with explicit empty-string
-- placeholders. These are test data, NOT real merchant data — there is no silent
-- default masquerading as real data (empty string is clearly not a real value).
-- In a fresh production DB (0 rows) the UPDATEs affect 0 rows, so this is safe.

UPDATE "stores" SET "phoneNumber" = '' WHERE "phoneNumber" IS NULL;
UPDATE "stores" SET "address" = '' WHERE "address" IS NULL;
UPDATE "stores" SET "originProvinceId" = '' WHERE "originProvinceId" IS NULL;
UPDATE "stores" SET "originProvinceName" = '' WHERE "originProvinceName" IS NULL;
UPDATE "stores" SET "originCityId" = '' WHERE "originCityId" IS NULL;
UPDATE "stores" SET "originCityName" = '' WHERE "originCityName" IS NULL;
UPDATE "stores" SET "originSubdistrictId" = '' WHERE "originSubdistrictId" IS NULL;
UPDATE "stores" SET "originSubdistrictName" = '' WHERE "originSubdistrictName" IS NULL;

ALTER TABLE "stores" ALTER COLUMN "phoneNumber" SET NOT NULL;
ALTER TABLE "stores" ALTER COLUMN "address" SET NOT NULL;
ALTER TABLE "stores" ALTER COLUMN "originProvinceId" SET NOT NULL;
ALTER TABLE "stores" ALTER COLUMN "originProvinceName" SET NOT NULL;
ALTER TABLE "stores" ALTER COLUMN "originCityId" SET NOT NULL;
ALTER TABLE "stores" ALTER COLUMN "originCityName" SET NOT NULL;
ALTER TABLE "stores" ALTER COLUMN "originSubdistrictId" SET NOT NULL;
ALTER TABLE "stores" ALTER COLUMN "originSubdistrictName" SET NOT NULL;
