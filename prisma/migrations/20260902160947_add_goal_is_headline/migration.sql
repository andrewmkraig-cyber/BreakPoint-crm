-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "isHeadline" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Goal_organizationId_status_isHeadline_idx" ON "Goal"("organizationId", "status", "isHeadline");

