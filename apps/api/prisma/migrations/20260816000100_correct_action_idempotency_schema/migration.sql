-- Correct ActionIdempotency schema per §6A.2 amended:
-- 1. Rename `id` column to `idempotencyKey` (String PK, not auto-generated UUID)
-- 2. Add `claimedAt` DateTime column (populated from createdAt for existing records)
-- 3. Keep `leaseUntil` for lease/recovery mechanism (§6A.7)
-- 4. Composite unique constraint unchanged: [storeId, customerId, actionType, actionId]

-- Step 1: Add claimedAt column (nullable initially for migration)
ALTER TABLE "action_idempotency" ADD COLUMN "claimedAt" TIMESTAMPTZ;

-- Step 2: Populate claimedAt from createdAt for existing records
UPDATE "action_idempotency" SET "claimedAt" = "createdAt" WHERE "claimedAt" IS NULL;

-- Step 2b: Set claimedAt NOT NULL (all existing rows now have values)
ALTER TABLE "action_idempotency" ALTER COLUMN "claimedAt" SET NOT NULL;

-- Step 2b: Set claimedAt NOT NULL (all existing rows now have values)
ALTER TABLE "action_idempotency" ALTER COLUMN "claimedAt" SET NOT NULL;

-- Step 3: Rename id → idempotencyKey and change default
ALTER TABLE "action_idempotency" DROP CONSTRAINT "action_idempotency_pkey";
ALTER TABLE "action_idempotency" RENAME COLUMN "id" TO "idempotencyKey";
ALTER TABLE "action_idempotency" ALTER COLUMN "idempotencyKey" DROP DEFAULT;
ALTER TABLE "action_idempotency" ALTER COLUMN "idempotencyKey" TYPE TEXT;

-- Re-add primary key on idempotencyKey
ALTER TABLE "action_idempotency" ADD PRIMARY KEY ("idempotencyKey");

-- Recreate the trigger (was on old PK, now references idempotencyKey)
DROP TRIGGER IF EXISTS "action_idempotency_updated_at" ON "action_idempotency";
CREATE TRIGGER "action_idempotency_updated_at"
BEFORE UPDATE ON "action_idempotency"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
