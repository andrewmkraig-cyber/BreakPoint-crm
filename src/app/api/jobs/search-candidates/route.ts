import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Job-context candidate search backing the Matches tab on /jobs/[id].
// Free-text search across name / title / current employer / location;
// skills are matched on whole-token equality via the String[] `has`
// filter (no substring search on arrays without raw SQL — acceptable
// for the MVP per the spec's "text search only, no complex filters
// yet" guidance). Tenant-scoped on getCurrentOrg().

type CandidateHit = {
  candidateCuid: string;
  candidateRfId: number | null;
  name: string;
  title: string | null;
  employer: string | null;
  location: string | null;
  skills: string[];
  alreadyApplied: boolean;
};

const MAX_RESULTS = 25;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "Missing jobId." }, { status: 400 });
  }
  if (q.length < 2) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const org = await getCurrentOrg();

  // Confirm the target job exists in this tenant before doing any
  // candidate work so a stale jobId from another tenant doesn't leak
  // a list of candidates back.
  const job = await prisma.job.findFirst({
    where: { id: jobId, organizationId: org.id },
    select: { id: true, legacyRfId: true },
  });
  if (!job) {
    return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
  }

  // Tokenize on whitespace; AND across tokens so "react senior" requires
  // BOTH tokens to land somewhere on the row. Each token allowed to
  // match any of firstName / lastName / title / employer / location /
  // skills (whole-token has). Empty tokens filtered out so a stray
  // double space doesn't tank the search.
  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const candidateAnd: Prisma.CandidateWhereInput[] = tokens.map((t) => ({
    OR: [
      { firstName: { contains: t, mode: "insensitive" } },
      { lastName: { contains: t, mode: "insensitive" } },
      { currentDesignation: { contains: t, mode: "insensitive" } },
      { currentOrganization: { contains: t, mode: "insensitive" } },
      { location: { contains: t, mode: "insensitive" } },
      { skills: { has: t } },
    ],
  }));

  const candidates = await prisma.candidate.findMany({
    where: { organizationId: org.id, AND: candidateAnd },
    orderBy: [{ updatedAt: "desc" }],
    take: MAX_RESULTS,
    select: {
      id: true,
      rfId: true,
      firstName: true,
      lastName: true,
      currentDesignation: true,
      currentOrganization: true,
      location: true,
      skills: true,
    },
  });

  // Annotate each result with whether the candidate is already on the
  // job's pipeline so the Apply button can render a disabled / informative
  // state instead of trying to call the action and toasting an error.
  // Two identity shapes (candidateId cuid vs candidateRfId numeric) are
  // checked because legacy RF-imported placements may carry only the
  // numeric column.
  const placementOr: Prisma.PlacementWhereInput["OR"] = [{ jobId: job.id }];
  if (job.legacyRfId != null) placementOr.push({ jobRfId: job.legacyRfId });
  const placements = await prisma.placement.findMany({
    where: {
      organizationId: org.id,
      OR: placementOr,
      candidateId: { in: candidates.map((c) => c.id) },
    },
    select: { candidateId: true, candidateRfId: true },
  });
  const appliedCuids = new Set(
    placements.map((p) => p.candidateId).filter((x): x is string => !!x),
  );
  const appliedRfIds = new Set(
    placements.map((p) => p.candidateRfId).filter((x): x is number => x != null),
  );

  const results: CandidateHit[] = candidates.map((c) => ({
    candidateCuid: c.id,
    candidateRfId: c.rfId,
    name:
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "(no name)",
    title: c.currentDesignation,
    employer: c.currentOrganization,
    location: c.location,
    skills: Array.isArray(c.skills) ? c.skills.slice(0, 8) : [],
    alreadyApplied:
      appliedCuids.has(c.id) ||
      (c.rfId != null && appliedRfIds.has(c.rfId)),
  }));

  return NextResponse.json({ ok: true, results });
}
