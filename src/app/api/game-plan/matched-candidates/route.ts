import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// GET /api/game-plan/matched-candidates?jobId=<cuid>
//
// Returns the full CandidateMatch row set for a job in the same shape
// the /jobs/[id] page renders server-side, so the Matched tab can
// re-hydrate without a server-component reload after Find Matches
// streams a new batch in. Ordered by score desc to match the
// server-rendered ordering on initial load.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const org = await getCurrentOrg();
  // Exclude candidates already pipelined for this job — once the
  // recruiter has applied / submitted / rejected, they live in a
  // pipeline bucket and shouldn't double-render in Matched. Mirrors
  // the same filter the /jobs/[id] server fetch uses on initial
  // render so refetches stay consistent.
  const placedRows = await prisma.placement.findMany({
    where: { jobId, organizationId: org.id },
    select: { candidateId: true },
  });
  const placedCandidateIds = Array.from(
    new Set(
      placedRows
        .map((p) => p.candidateId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  // Explicit select omits scoreBreakdown — see /jobs/[id]/page.tsx for
  // the full reasoning. Until db:push lands the new column on the
  // live DB, reading it crashes the response. Popover falls through
  // to rationale via normalizeBreakdown when scoreBreakdown is null.
  const matches = await prisma.candidateMatch.findMany({
    where: {
      jobId,
      organizationId: org.id,
      ...(placedCandidateIds.length > 0
        ? { candidateId: { notIn: placedCandidateIds } }
        : {}),
    },
    orderBy: { score: "desc" },
    select: {
      score: true,
      rationale: true,
      candidate: {
        select: {
          id: true,
          rfId: true,
          firstName: true,
          lastName: true,
          currentDesignation: true,
          currentOrganization: true,
          location: true,
        },
      },
    },
  });

  const rows = matches.map((m) => {
    const c = m.candidate;
    return {
      candidateId: c.id,
      candidateRfId: c.rfId,
      name:
        [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
        "(no name)",
      title: c.currentDesignation ?? "",
      employer: c.currentOrganization ?? "",
      location: c.location ?? "",
      score: m.score,
      rationale: m.rationale,
      scoreBreakdown: null,
    };
  });

  return NextResponse.json({ rows });
}
