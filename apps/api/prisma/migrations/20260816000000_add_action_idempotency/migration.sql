-- P0 ADD_TO_CART: ActionIdempotency table for structured action idempotency
-- §6A.2: Unique constraint on [storeId, customerId, actionType, actionId]
-- Status: CLAIMED | COMPLETED | FAILED
-- Lease: leaseUntil timestamp for CLAIMED recovery
CREATE TABLE "action_idempotency" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLAIMED',
    "result" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "completedAt" TIMESTAMPTZ,
    "leaseUntil" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "action_idempotency_pkey" PRIMARY KEY ("id")
);

-- Unique constraint for idempotency: one claim per actionId per customer per store per actionType
CREATE UNIQUE INDEX "action_idempotency_storeId_customerId_actionType_actionId_key"
ON "action_idempotency" ("storeId", "customerId", "actionType", "actionId");

-- Index for querying by store/customer
CREATE INDEX "action_idempotency_storeId_customerId_idx"
ON "action_idempotency" ("storeId", "customerId");

-- Index for lease recovery queries (CLAIMED + expired lease)
CREATE INDEX "action_idempotency_status_leaseUntil_idx"
ON "action_idempotency" ("status", "leaseUntil");

-- Trigger to auto-update updatedAt on row modification
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER "action_idempotency_updated_at"
BEFORE UPDATE ON "action_idempotency"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();