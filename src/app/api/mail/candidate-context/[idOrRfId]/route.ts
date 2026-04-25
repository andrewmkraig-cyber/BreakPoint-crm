import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getPlacementsForOrg, type PlacementStage } from "@/lib/placements";

export const dynamic = "force-dynamic";

// Smart-context loader for the popup composer (Phase 5A.2).
// Given a candidate id (cuid) or legacy rfId, returns every active
// applied / pipeline job for that candidate plus enough job + client
// data to populate the composer's MailMergeContext.
//
// Active = any Placement.stage NOT in the terminal set
// (hired / rejected / cancelled). The active list comes from the
// existing PlacementStage union; this endpoint owns the active filter
// so callers don't have to keep stage lists in sync.
//
// Tenant isolation: every query is scoped by organizationId via the
// getCurrentOrg() resolver + the existing getPlacementsForOrg helper.

const ACTIVE_STAGES: PlacementStage[] = [
  "sourced",
  "applied",
  "kept",
  "submitted",
  "interviewing",
  "offer",
  "pending_start",
];

// Job.locations is a String[] of "City, State" entries. Split the
// first entry by comma to surface city + state for merge fields.
function splitFirstLocation(locations: string[]): { city: string; state: string } {
  const first = locations.find((l) => typeof l === "string" && l.trim().length > 0);
  if (!first) return { city: "", state: "" };
  const parts = first.split(",").map((p) => p.trim());
  return { city: parts[0] ?? "", state: parts[1] ?? "" };
}

export type CandidateContextActiveJob = {
  jobId: string;
  jobTitle: string;
  jobDescription: string;
  jobCity: string;
  jobState: string;
  clientId: string;
  clientName: string;
  primaryContactFirstName: string;
};

export type CandidateContextResponse = {
  candidate: {
    firstName: string;
    lastName: string;
    email: string;
    currentTitle: string;
    currentCompany: string;
  };
  activeJobs: CandidateContextActiveJob[];
};

export async function GET(
  _req: Request,
  { params }: { params: { idOrRfId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = params.idOrRfId;
  // Resolve to a candidate cuid. The path segment may be either a
  // numeric legacy rfId (RF-imported candidates) or a cuid (Ace-native).
  const candidate = /^\d+$/.test(raw)
    ? await prisma.candidate.findFirst({
        where: { rfId: Number(raw) },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          currentDesignation: true,
          currentOrganization: true,
        },
      })
    : await prisma.candidate.findFirst({
        where: { id: raw },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          currentDesignation: true,
          currentOrganization: true,
        },
      });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const org = await getCurrentOrg();

  // getPlacementsForOrg filters by Placement.candidateId (cuid) +
  // organizationId. RF-imported placements that never got a cuid
  // backfill won't surface here — that's an acceptable gap for the
  // smart-context UX (those candidates fall through to the "0 active
  // jobs" branch and the user picks templates accordingly).
  const placements = await getPlacementsForOrg({
    candidateId: candidate.id,
    stages: ACTIVE_STAGES,
  });

  // Collect unique job cuids across the candidate's active placements.
  const jobIds = Array.from(
    new Set(placements.map((p) => p.jobId).filter((x): x is string => Boolean(x))),
  );

  let activeJobs: CandidateContextActiveJob[] = [];
  if (jobIds.length > 0) {
    const jobs = await prisma.job.findMany({
      where: { id: { in: jobIds }, organizationId: org.id },
      select: {
        id: true,
        title: true,
        description: true,
        locations: true,
        client: {
          select: {
            id: true,
            name: true,
            // Pull one contact from the client to populate the
            // {{client.primary_contact_first_name}} merge field. Most
            // recently-added contact wins (matches how the recruiter
            // typically thinks of "primary contact" in a still-being-
            // populated CRM).
            contacts: {
              orderBy: [{ addedAt: "desc" }, { createdAt: "desc" }],
              take: 1,
              select: { firstName: true, name: true },
            },
          },
        },
      },
    });
    activeJobs = jobs.map((j) => {
      const { city, state } = splitFirstLocation(j.locations);
      const contact = j.client?.contacts?.[0] ?? null;
      const primaryContactFirstName =
        contact?.firstName?.trim() ||
        contact?.name?.trim().split(/\s+/)[0] ||
        "";
      return {
        jobId: j.id,
        jobTitle: j.title ?? "",
        jobDescription: j.description ?? "",
        jobCity: city,
        jobState: state,
        clientId: j.client?.id ?? "",
        clientName: j.client?.name ?? "",
        primaryContactFirstName,
      };
    });
  }

  const response: CandidateContextResponse = {
    candidate: {
      firstName: candidate.firstName ?? "",
      lastName: candidate.lastName ?? "",
      email: candidate.email ?? "",
      currentTitle: candidate.currentDesignation ?? "",
      currentCompany: candidate.currentOrganization ?? "",
    },
    activeJobs,
  };
  return NextResponse.json(response);
}
