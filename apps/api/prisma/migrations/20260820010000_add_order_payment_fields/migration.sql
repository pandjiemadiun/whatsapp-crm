-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "paymentProofUrl" TEXT,
ADD COLUMN     "paymentReportedAt" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
ADD COLUMN     "paymentVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByAdminId" TEXT;
