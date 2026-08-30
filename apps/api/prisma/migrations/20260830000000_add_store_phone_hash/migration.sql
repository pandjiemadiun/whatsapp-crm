-- Add phoneNumberHash for deterministic lookup of Store by phoneNumber.
-- phoneNumber is encrypted at rest (AES-256-GCM, random IV), so direct WHERE
-- comparison is impossible. The hash column enables indexed lookup for the
-- GOWA webhook receiver resolution.

ALTER TABLE "stores" ADD COLUMN "phoneNumberHash" TEXT;

CREATE UNIQUE INDEX "stores_phoneNumberHash_key" ON "stores"("phoneNumberHash");
