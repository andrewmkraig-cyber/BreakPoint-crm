-- CreateEnum
CREATE TYPE "GoalScope" AS ENUM ('COMPANY', 'USER');

-- CreateEnum
CREATE TYPE "GoalMetric" AS ENUM ('REVENUE', 'SIGNED_CLIENTS', 'PLACEMENTS', 'SUBMITTALS', 'INTERVIEWS', 'BD_CONTACTS_ENROLLED', 'BD_REPLIES', 'MANUAL');

-- CreateEnum
CREATE TYPE "GoalPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'MILESTONE');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'ACHIEVED', 'MISSED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "goalLevel" INTEGER,
ADD COLUMN     "managerId" TEXT;

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" "GoalScope" NOT NULL,
    "ownerUserId" TEXT,
    "metric" "GoalMetric" NOT NULL,
    "manualLabel" TEXT,
    "period" "GoalPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "targetValue" DECIMAL(14,2) NOT NULL,
    "parentGoalId" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "declinedReason" TEXT,
    "escalationPct" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalActualEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "enteredByUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalActualEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_organizationId_idx" ON "Goal"("organizationId");

-- CreateIndex
CREATE INDEX "Goal_organizationId_scope_status_idx" ON "Goal"("organizationId", "scope", "status");

-- CreateIndex
CREATE INDEX "Goal_organizationId_ownerUserId_status_idx" ON "Goal"("organizationId", "ownerUserId", "status");

-- CreateIndex
CREATE INDEX "Goal_organizationId_metric_periodStart_periodEnd_idx" ON "Goal"("organizationId", "metric", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "Goal_parentGoalId_idx" ON "Goal"("parentGoalId");

-- CreateIndex
CREATE INDEX "GoalActualEntry_organizationId_idx" ON "GoalActualEntry"("organizationId");

-- CreateIndex
CREATE INDEX "GoalActualEntry_goalId_idx" ON "GoalActualEntry"("goalId");

-- CreateIndex
CREATE INDEX "GoalActualEntry_goalId_entryDate_idx" ON "GoalActualEntry"("goalId", "entryDate");

-- CreateIndex
CREATE INDEX "GoalActualEntry_organizationId_entryDate_idx" ON "GoalActualEntry"("organizationId", "entryDate");

-- CreateIndex
CREATE INDEX "User_managerId_idx" ON "User"("managerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_parentGoalId_fkey" FOREIGN KEY ("parentGoalId") REFERENCES "Goal"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GoalActualEntry" ADD CONSTRAINT "GoalActualEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalActualEntry" ADD CONSTRAINT "GoalActualEntry_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

