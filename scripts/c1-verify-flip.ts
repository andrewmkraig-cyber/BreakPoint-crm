// Phase C1 prop-build verification (READ-ONLY). Picks 3 real legacy
// (rfId != null) candidates with different data shapes and rebuilds the
// exact props LocalCandidateProfile derives, then reports whether each
// comes back complete + non-null. No writes.
//   Run: node_modules/.bin/tsx scripts/c1-verify-flip.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  // getPlacementsForOrg / getInterviewsForOrg resolve org via
  // getServerSession (request-scoped) — unavailable in a CLI script. Query
  // Prisma directly with the same candidateId + organizationId filter the
  // helpers apply internally (default org per CLAUDE.md).
  const ORG = "cmobj8dxz00012gliequ53kvc";

  // Pick one legacy candidate WITH a Neon placement (job+client), one WITH
  // a scheduled interview, one WITH a resume. Distinct candidates where
  // possible.
  const placRow = await prisma.placement.findFirst({
    where: { candidate: { rfId: { not: null } }, jobId: { not: null } },
    select: { candidateId: true },
    orderBy: { updatedAt: "desc" },
  });
  const ivRow = await prisma.interview.findFirst({
    where: { candidate: { rfId: { not: null } }, status: "scheduled" },
    select: { candidateId: true },
    orderBy: { scheduledAt: "desc" },
  });
  const resumeRow = await prisma.candidateResume.findFirst({
    where: { candidate: { rfId: { not: null } }, uploadComplete: true },
    select: { candidateId: true },
    orderBy: { uploadedAt: "desc" },
  });

  const picks = [
    { label: "has-placement", id: placRow?.candidateId },
    { label: "has-interview", id: ivRow?.candidateId },
    { label: "has-resume", id: resumeRow?.candidateId },
  ].filter((p): p is { label: string; id: string } => !!p.id);

  for (const pick of picks) {
    const id = pick.id;
    const candidate = await prisma.candidate.findUnique({
      where: { id },
      select: {
        id: true, rfId: true, firstName: true, lastName: true, email: true,
        phone: true, currentDesignation: true, currentOrganization: true,
        location: true, lat: true, lng: true, linkedinProfile: true,
        skills: true, resumeData: true, organizationId: true,
      },
    });
    if (!candidate) { console.log(`\n[${pick.label}] ${id} NOT FOUND`); continue; }

    const placements = await prisma.placement.findMany({
      where: { candidateId: id, organizationId: ORG },
      select: { jobId: true, jobRfId: true, clientId: true, clientRfId: true, stage: true },
    });
    const interviews = await prisma.interview.findMany({
      where: { candidateId: id, organizationId: ORG },
      orderBy: { scheduledAt: "asc" },
      select: { scheduledAt: true, status: true },
    });
    const resumes = await prisma.candidateResume.count({ where: { candidateId: id, uploadComplete: true } });
    const inlineResume = !!(candidate.resumeData);

    // Mirror LocalCandidateProfile's job+client resolution: each placement
    // resolves a job (by jobRfId via allJobs, or jobId cuid) + client.
    const jobCount = placements.length;
    const placementsWithJobRef = placements.filter((p) => p.jobId != null || p.jobRfId != null).length;
    const placementsWithClientRef = placements.filter((p) => p.clientId != null || (p.clientRfId != null && p.clientRfId > 0)).length;

    const name = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "(unnamed)";

    console.log(`\n================ [${pick.label}] ${name} ================`);
    console.log("  cuid:                ", candidate.id);
    console.log("  rfId (legacy):       ", candidate.rfId);
    console.log("  name/contact:        ", JSON.stringify({
      name, email: candidate.email ?? null, phone: candidate.phone ?? null,
      title: candidate.currentDesignation ?? null, org: candidate.currentOrganization ?? null,
      location: candidate.location ?? null,
    }));
    console.log("  distance pill inputs:", JSON.stringify({ lat: candidate.lat, lng: candidate.lng }),
      candidate.lat != null && candidate.lng != null ? "(geocoded)" : "(blank - no distance, not an error)");
    console.log("  Neon placements:     ", jobCount,
      `(with job-ref: ${placementsWithJobRef}, with client-ref: ${placementsWithClientRef})`);
    console.log("  interviews:          ", interviews.length,
      interviews.length ? `(first scheduledAt ${interviews[0].scheduledAt.toISOString()})` : "");
    console.log("  resume versions:     ", resumes, inlineResume ? "(+ inline resumeData → backfills 1 row)" : "");
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
