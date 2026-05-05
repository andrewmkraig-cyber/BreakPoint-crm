import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// GET /api/game-plan/matched-count?jobId=<cuid>
//
// Lightweight count endpoint for the /jobs/[id] Matched tab badge.
// The Find Matches panel dispatches a "matches saved" notification
// when a stream finishes; the pipeline summary calls this to refresh
// its count without a full server-component reload.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const org = await getCurrentOrg();
  const count = await prisma.candidateMatch.count({
    where: { jobId, organizationId: org.id },
  });
  return NextResponse.json({ count });
}
