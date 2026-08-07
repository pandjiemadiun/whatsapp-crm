-- CreateTable: backup_manifest
CREATE TABLE "backup_manifest" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'sha256',
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "errorMessage" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "restoredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "backup_manifest_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX "backup_manifest_filename_key" ON "backup_manifest"("filename");
CREATE INDEX "backup_manifest_createdAt_idx" ON "backup_manifest"("createdAt");
CREATE INDEX "backup_manifest_type_idx" ON "backup_manifest"("type");
