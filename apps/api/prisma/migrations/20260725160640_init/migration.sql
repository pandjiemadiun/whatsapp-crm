/*
  Warnings:

  - The primary key for the `Conversation` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `customerId` on the `Conversation` table. All the data in the column will be lost.
  - You are about to drop the column `lastMessageAt` on the `Conversation` table. All the data in the column will be lost.
  - You are about to drop the column `messageCount` on the `Conversation` table. All the data in the column will be lost.
  - You are about to drop the column `totalCost` on the `Conversation` table. All the data in the column will be lost.
  - The `id` column on the `Conversation` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `Knowledge` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `answer` on the `Knowledge` table. All the data in the column will be lost.
  - You are about to drop the column `question` on the `Knowledge` table. All the data in the column will be lost.
  - The `id` column on the `Knowledge` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `Store` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `apiKey` on the `Store` table. All the data in the column will be lost.
  - The `id` column on the `Store` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `ConversationMessage` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[userId,storeId,status]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `Conversation` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `storeId` on the `Conversation` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `content` to the `Knowledge` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `Knowledge` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `storeId` on the `Knowledge` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "ConversationMessage" DROP CONSTRAINT "ConversationMessage_conversationId_fkey";

-- DropIndex
DROP INDEX "Conversation_customerId_idx";

-- DropIndex
DROP INDEX "Conversation_status_idx";

-- DropIndex
DROP INDEX "Knowledge_active_idx";

-- DropIndex
DROP INDEX "Store_apiKey_key";

-- AlterTable
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_pkey",
DROP COLUMN "customerId",
DROP COLUMN "lastMessageAt",
DROP COLUMN "messageCount",
DROP COLUMN "totalCost",
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "topic" TEXT,
ADD COLUMN     "userId" TEXT NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "storeId",
ADD COLUMN     "storeId" UUID NOT NULL,
ADD CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Knowledge" DROP CONSTRAINT "Knowledge_pkey",
DROP COLUMN "answer",
DROP COLUMN "question",
ADD COLUMN     "content" TEXT NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "storeId",
ADD COLUMN     "storeId" UUID NOT NULL,
ALTER COLUMN "category" DROP NOT NULL,
ADD CONSTRAINT "Knowledge_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Store" DROP CONSTRAINT "Store_pkey",
DROP COLUMN "apiKey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "Store_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "ConversationMessage";

-- CreateTable
CREATE TABLE "ConversationHistory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationContext" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "contextWindow" INTEGER NOT NULL DEFAULT 8000,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastTokenCheck" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FAQ" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storeId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FAQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storeId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "items" JSONB NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationHistory_conversationId_idx" ON "ConversationHistory"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationHistory_source_idx" ON "ConversationHistory"("source");

-- CreateIndex
CREATE INDEX "ConversationHistory_createdAt_idx" ON "ConversationHistory"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationContext_conversationId_key" ON "ConversationContext"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationContext_conversationId_idx" ON "ConversationContext"("conversationId");

-- CreateIndex
CREATE INDEX "FAQ_storeId_idx" ON "FAQ"("storeId");

-- CreateIndex
CREATE INDEX "FAQ_active_idx" ON "FAQ"("active");

-- CreateIndex
CREATE INDEX "Order_storeId_idx" ON "Order"("storeId");

-- CreateIndex
CREATE INDEX "Order_conversationId_idx" ON "Order"("conversationId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Conversation_storeId_idx" ON "Conversation"("storeId");

-- CreateIndex
CREATE INDEX "Conversation_lastActivityAt_idx" ON "Conversation"("lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_userId_storeId_status_key" ON "Conversation"("userId", "storeId", "status");

-- CreateIndex
CREATE INDEX "Knowledge_storeId_idx" ON "Knowledge"("storeId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationHistory" ADD CONSTRAINT "ConversationHistory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationContext" ADD CONSTRAINT "ConversationContext_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FAQ" ADD CONSTRAINT "FAQ_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Knowledge" ADD CONSTRAINT "Knowledge_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
