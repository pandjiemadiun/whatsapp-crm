-- FASE 4: persistent Web Push subscription per Customer (MVP: 1 browser/device).
-- Nullable JSON — server-authoritative; scoped by storeId + webUid (tenant isolated).
-- Backward compatible: nullable, no default, no table rewrite on Postgres (added column
-- stays NULL for existing rows; existing queries unaffected).
ALTER TABLE "customers" ADD COLUMN "pushSubscription" JSONB;
