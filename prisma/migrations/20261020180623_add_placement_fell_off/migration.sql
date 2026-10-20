-- AlterTable
ALTER TABLE "Placement" ADD COLUMN     "fellOffAt" TIMESTAMP(3),
ADD COLUMN     "fellOffNotes" TEXT,
ADD COLUMN     "fellOffReason" TEXT,
ADD COLUMN     "refundAmount" INTEGER,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "replacementOwed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replacesPlacementId" TEXT;

-- CreateIndex
CREATE INDEX "Placement_replacesPlacementId_idx" ON "Placement"("replacesPlacementId");

