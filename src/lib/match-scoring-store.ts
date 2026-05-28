// Storage + recompute layer for the deterministic match scorer.
//
// Three exports:
//   - upsertMatchScore(orgId, candidate, job)  - idempotent write that
//     only recomputes when the candidate+job inputs (sourceHash) have
//     changed. Called on Placement create + on Find Matches read for
//     candidates that don't yet have a stored row for the target job.
//   - recomputeMatchesForJob(orgId, jobId)     - eager fan-out used by
//     JD-edit actions. Pulls every existing CandidateMatch row for the
//     job, rebuilds the inputs from current Neon state, and rewrites
//     every row. Bounded — the deterministic scorer is fast enough that
//     we don't bother with a background queue for the recruiter's
//     pipeline depths (50-500 stored rows per job).
//   - recomputeMatchesForCandidate(orgId, candidateId) - symmetric of
//     the above for the resume-swap path. Called from the candidate-
//     resume upload onComplete + the brand/generate resume actions.
//
// Tenant-scoped: every read AND write filters on organizationId. Rule 8.
//
// No Claude calls anywhere in this file or its dependency tree. The
// scorer in match-scoring.ts is pure CPU + a SHA-256 hash.

import { prisma } from "@/lib/prisma";
import {
  computeMatchScore,
  computeSourceHash,
  type ScoringCandidate,
  type ScoringJob,
} from "@/lib/match-scoring";

// Resolved Candidate row plus the most-recent resume's extracted text.
// We pull this shape once and pass it into the scorer so callers
// fanning out across N candidates don't re-query the candidate row
// every iteration.
type CandidateRow = ScoringCandidate & { organizationId: string };
type JobRow = ScoringJob & { organizationId: string };

const CANDIDATE_SELECT = {
  id: true,
  organizationId: true,
  currentDesignation: true,
  currentOrganization: true,
  skills: true,
  experience: true,
  expectedSalary: true,
  location: true,
  lat: true,
  lng: true,
} as const;

const JOB_SELECT = {
  id: true,
  organizationId: true,
  title: true,
  description: true,
  searchKeywords: true,
  salaryRangeStart: true,
  salaryRangeEnd: true,
  locations: true,
  locationCity: true,
  locationState: true,
  locationZip: true,
} as const;

async function loadCandidate(orgId: string, candidateId: string): Promise<CandidateRow | null> {
  const row = await prisma.candidate.findFirst({
    where: { id: candidateId, organizationId: orgId },
    select: CANDIDATE_SELECT,
  });
  if (!row) return null;
  // Most-recent resume's cached plaintext extraction. Falls back to
  // empty string when no resume / extraction yet — the scorer is
  // resilient to a sparse resumeText input.
  const resume = await prisma.candidateResume.findFirst({
    where: { candidateId, organizationId: orgId, extractedText: { not: null } },
    orderBy: { uploadedAt: "desc" },
    select: { extractedText: true },
  });
  return { ...row, resumeText: resume?.extractedText ?? null };
}

async function loadJob(orgId: string, jobId: string): Promise<JobRow | null> {
  return prisma.job.findFirst({
    where: { id: jobId, organizationId: orgId },
    select: JOB_SELECT,
  });
}

// Core upsert. Behavior:
//   1. If a CandidateMatch row exists with sourceHash matching the
//      current inputs, return it unchanged. NO recompute.
//   2. Otherwise compute the deterministic score, upsert, and return
//      the new row's score + breakdown.
//
// `precomputedCandidate` / `precomputedJob` let callers in a fan-out
// loop avoid re-loading the same Job (recomputeMatchesForJob loads the
// job once and reuses it for every candidate).
export async function upsertMatchScore(args: {
  orgId: string;
  candidateId: string;
  jobId: string;
  precomputedCandidate?: CandidateRow | null;
  precomputedJob?: JobRow | null;
}): Promise<{ score: number; recomputed: boolean } | null> {
  const candidate = args.precomputedCandidate ?? (await loadCandidate(args.orgId, args.candidateId));
  if (!candidate) return null;
  const job = args.precomputedJob ?? (await loadJob(args.orgId, args.jobId));
  if (!job) return null;

  const currentHash = computeSourceHash(candidate, job);

  const existing = await prisma.candidateMatch.findUnique({
    where: { jobId_candidateId: { jobId: job.id, candidateId: candidate.id } },
    select: { id: true, sourceHash: true, score: true },
  });
  if (existing && existing.sourceHash === currentHash) {
    return { score: existing.score, recomputed: false };
  }

  const result = computeMatchScore(candidate, job);

  await prisma.candidateMatch.upsert({
    where: { jobId_candidateId: { jobId: job.id, candidateId: candidate.id } },
    create: {
      organizationId: args.orgId,
      jobId: job.id,
      candidateId: candidate.id,
      score: result.score,
      rationale: result.rationale,
      scoreBreakdown: result.subScores,
      sourceHash: result.sourceHash,
      computedAt: new Date(),
    },
    update: {
      score: result.score,
      rationale: result.rationale,
      scoreBreakdown: result.subScores,
      sourceHash: result.sourceHash,
      computedAt: new Date(),
    },
  });
  return { score: result.score, recomputed: true };
}

// Eager fan-out across every stored CandidateMatch row for a job. Called
// from the JD edit actions (saveJobGeneratedDescription, updateJobOverview,
// saveJobSearchKeywords, updateJobOverrideDescription). Best-effort:
// returns the number of rows successfully recomputed and the count of
// rows that errored. Never throws — JD save still succeeds when the
// recompute is partially broken.
export async function recomputeMatchesForJob(orgId: string, jobId: string): Promise<{ recomputed: number; skipped: number; failed: number }> {
  const job = await loadJob(orgId, jobId);
  if (!job) return { recomputed: 0, skipped: 0, failed: 0 };

  const rows = await prisma.candidateMatch.findMany({
    where: { jobId, organizationId: orgId },
    select: { candidateId: true },
  });

  let recomputed = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const out = await upsertMatchScore({
        orgId,
        candidateId: r.candidateId,
        jobId,
        precomputedJob: job,
      });
      if (out == null) { failed++; continue; }
      if (out.recomputed) recomputed++; else skipped++;
    } catch (e) {
      failed++;
      // eslint-disable-next-line no-console
      console.warn("[match-scoring] recomputeMatchesForJob row failed", {
        jobId, candidateId: r.candidateId, err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { recomputed, skipped, failed };
}

// Symmetric fan-out across every stored CandidateMatch row for a
// candidate. Called from the candidate-resume upload onComplete + the
// brand/generate resume actions. Same best-effort contract.
export async function recomputeMatchesForCandidate(orgId: string, candidateId: string): Promise<{ recomputed: number; skipped: number; failed: number }> {
  const candidate = await loadCandidate(orgId, candidateId);
  if (!candidate) return { recomputed: 0, skipped: 0, failed: 0 };

  const rows = await prisma.candidateMatch.findMany({
    where: { candidateId, organizationId: orgId },
    select: { jobId: true },
  });

  let recomputed = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const out = await upsertMatchScore({
        orgId,
        candidateId,
        jobId: r.jobId,
        precomputedCandidate: candidate,
      });
      if (out == null) { failed++; continue; }
      if (out.recomputed) recomputed++; else skipped++;
    } catch (e) {
      failed++;
      // eslint-disable-next-line no-console
      console.warn("[match-scoring] recomputeMatchesForCandidate row failed", {
        candidateId, jobId: r.jobId, err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { recomputed, skipped, failed };
}

// Surface helper for the find-matches route: given the pool of pre-
// filtered candidates already in memory (so we don't re-query each
// one), upsert any missing rows + return the stored score per
// candidate. Idempotent — when every row already exists with a
// current hash this is a single SELECT.
export async function ensureMatchScoresForPool(args: {
  orgId: string;
  jobId: string;
  candidates: Array<ScoringCandidate & { organizationId?: string }>;
}): Promise<Map<string, number>> {
  const job = await loadJob(args.orgId, args.jobId);
  if (!job) return new Map();

  // Fast path: bulk-load existing rows so we don't pay one SELECT
  // per candidate.
  const candidateIds = args.candidates.map((c) => c.id);
  const existingRows = await prisma.candidateMatch.findMany({
    where: { jobId: args.jobId, organizationId: args.orgId, candidateId: { in: candidateIds } },
    select: { candidateId: true, sourceHash: true, score: true },
  });
  const existingByCandidate = new Map(existingRows.map((r) => [r.candidateId, r] as const));

  const scoreById = new Map<string, number>();
  for (const c of args.candidates) {
    const stored = existingByCandidate.get(c.id);
    const currentHash = computeSourceHash(c, job);
    if (stored && stored.sourceHash === currentHash) {
      scoreById.set(c.id, stored.score);
      continue;
    }
    // Compute + upsert. Per the cost rule this is bounded — only fires
    // when the (candidate, job) hash doesn't match the stored hash
    // (or no row exists yet). After the first Find Matches open for a
    // job, this is a no-op on every subsequent page load.
    const result = computeMatchScore(c, job);
    try {
      await prisma.candidateMatch.upsert({
        where: { jobId_candidateId: { jobId: args.jobId, candidateId: c.id } },
        create: {
          organizationId: args.orgId,
          jobId: args.jobId,
          candidateId: c.id,
          score: result.score,
          rationale: result.rationale,
          scoreBreakdown: result.subScores,
          sourceHash: result.sourceHash,
          computedAt: new Date(),
        },
        update: {
          score: result.score,
          rationale: result.rationale,
          scoreBreakdown: result.subScores,
          sourceHash: result.sourceHash,
          computedAt: new Date(),
        },
      });
      scoreById.set(c.id, result.score);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[match-scoring] ensureMatchScoresForPool upsert failed", {
        jobId: args.jobId, candidateId: c.id, err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return scoreById;
}
