-- CreateTable: admin_users
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'support_admin',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable: admin_auth_tokens
CREATE TABLE "admin_auth_tokens" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes for admin_users
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");
CREATE INDEX "admin_users_email_idx" ON "admin_users"("email");
CREATE INDEX "admin_users_createdAt_idx" ON "admin_users"("createdAt");

-- CreateIndexes for admin_auth_tokens
CREATE UNIQUE INDEX "admin_auth_tokens_token_key" ON "admin_auth_tokens"("token");
CREATE INDEX "admin_auth_tokens_adminUserId_idx" ON "admin_auth_tokens"("adminUserId");
CREATE INDEX "admin_auth_tokens_expiresAt_idx" ON "admin_auth_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "admin_auth_tokens" ADD CONSTRAINT "admin_auth_tokens_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
