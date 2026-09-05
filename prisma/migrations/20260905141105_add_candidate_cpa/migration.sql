-- CreateEnum
CREATE TYPE "CpaStatus" AS ENUM ('UNKNOWN', 'YES', 'NO');

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "cpa" "CpaStatus" NOT NULL DEFAULT 'UNKNOWN';

