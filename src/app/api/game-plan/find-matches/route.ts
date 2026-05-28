import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { ensureMatchScoresForPool } from "@/lib/match-scoring-store";

// Game Plan Phase 2 — Find Matches (deterministic).
//
// POST /api/game-plan/find-matches
// Body: { jobId?: string, clientId?: string, page?: number }
// Returns: NDJSON stream { t: "meta" | "awaiting_pick" | "match" | "end" | "error" }
//
// History: prior to this version each candidate was scored by a live
// Claude streaming call (Anthropic messages.stream + NDJSON parse).
// Every panel open paid credits per candidate AND the exact-title bias
// in the prompt mis-scored promotion-ready candidates (a tenured
// Senior Tax Accountant against a Tax Manager role). This route now
// runs the deterministic scorer in `src/lib/match-scoring.ts`: rule-
// based code that computes once per (candidate, job), stores on
// CandidateMatch (score + subScores + rationale + sourceHash +
// computedAt), and returns stored values on every subsequent open. JD
// edits and resume swaps invalidate via the recompute helpers in
// `src/lib/match-scoring-store.ts`. Nothing in this route calls Claude.
//
// Tenant-scoped: every Neon query carries WHERE organizationId = org.id
// (CLAUDE.md non-negotiable #8). The resolved org id is logged at the
// top of the handler so the regression check can confirm it threads
// into every query without rummaging through call sites.
//
// Pre-filter pool: title keyword match + rough location match against
// the target (city OR state token). Cheap substring + token compares
// — the pre-filter exists so the deterministic scorer never has to
// touch every candidate in the org for every job; it scores the
// reasonable 60-candidate slice and stores the result.

export const maxDuration = 60;

const PAGE_SIZE = 5;
const PRE_FILTER_CAP = 60;

type MatchTarget = {
  jobs: Array<{
    id: string;
    title: string;
    description: string;
    locations: string[];
    salaryRangeStart: number | null;
    salaryRangeEnd: number | null;
    legacyRfId: number | null;
    // Recruiter-tuned priority keywords from the JD tab. Drive an
    // outsized pre-filter weight (5x a title token) and get called
    // out explicitly in the Claude prompt as the recruiter's stated
    // priorities for the role.
    searchKeywords: string[];
  }>;
  // Combined display label for prompt + UI ("Tax Manager at Acme" or
  // "Acme Industries — 4 open roles").
  label: string;
  source: "job" | "client";
};

// Split a comma-separated keywords blob into trimmed lowercase tokens.
// Used both for pre-filter scoring and the prompt's priority list.
function splitKeywords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

type CandidateRow = {
  id: string;
  rfId: number | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  currentDesignation: string | null;
  currentOrganization: string | null;
  location: string | null;
  skills: string[];
  notes: string | null;
  expectedSalary: unknown;
  experience: unknown;
};

// Streaming response (NDJSON). Each line is a JSON object:
//   {"t":"meta","openJobs":[...]}                   — first line, sent
//                                                     before Claude
//                                                     starts ranking
//   {"t":"match","match":{...}}                     — one per scored
//                                                     candidate, flushed
//                                                     as Claude scores it
//   {"t":"end","hasMore":boolean,"page":number}     — final line
//   {"t":"error","error":"..."}                     — on failure
//
// The route asks Claude to emit one JSON object per line (not a JSON
// array) so we can stream-parse line-by-line as the model writes its
// response. Each parsed match is hydrated server-side with display
// fields and forwarded immediately, so the panel paints the first
// card in ~3-5 seconds instead of waiting for the full batch to land.

export async function POST(req: NextRequest) {
  const org = await getCurrentOrg();
  // Regression-check log: confirms organizationId reaches the route
  // (and by extension every WHERE clause below). Visible in `vercel
  // logs` for one POST per page-load.
  // eslint-disable-next-line no-console
  console.log("[find-matches] org.id =", org.id);

  let body: {
    jobId?: string;
    clientId?: string;
    page?: number;
    excludeIds?: string[];
    // Prompt 2 ITEM 1: when the panel was opened from /clients/[id]
    // and the client has 2+ open jobs, the panel asks the recruiter
    // to pick a job before any Claude call fires. The picked jobId
    // is threaded back here so the actual stream runs against that
    // single job (jobId path), not the union-of-roles client path.
    pickedJobId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const page = Math.max(0, Math.floor(body.page ?? 0));
  const excludeIds = Array.isArray(body.excludeIds) ? body.excludeIds : [];
  if (!body.jobId && !body.clientId) {
    return NextResponse.json({ error: "jobId or clientId required" }, { status: 400 });
  }

  // Resolve the effective target. Three paths:
  //   - body.jobId set → straight job target (existing behavior)
  //   - body.clientId + body.pickedJobId → narrow the client request
  //     to the picked single job
  //   - body.clientId only → load client target. If 1 open job,
  //     auto-pick it (skips the picker UX); if 2+ open jobs and
  //     no pickedJobId, return awaiting_pick + the open-jobs list
  //     and stop (no Claude call).
  const initialTarget = await loadTarget(org.id, {
    jobId: body.jobId ?? body.pickedJobId,
    clientId: body.pickedJobId ? undefined : body.clientId,
  });
  if (!initialTarget) {
    return NextResponse.json({ error: "Target not found" }, { status: 404 });
  }

  // For client targets without a pick, decide whether to ask the
  // panel to pick. We capture the open-jobs list from the client
  // target before potentially auto-picking.
  let target = initialTarget;
  let awaitingPick = false;
  let pickedJobLabel: string | null = null;

  if (body.clientId && !body.pickedJobId && initialTarget.source === "client") {
    if (initialTarget.jobs.length === 1) {
      // Single open job — silently treat as a job target so the
      // stream runs against that job. No pick needed.
      const onlyJob = await loadTarget(org.id, { jobId: initialTarget.jobs[0].id });
      if (onlyJob) {
        target = onlyJob;
        pickedJobLabel = onlyJob.label;
      }
    } else {
      // 0 or 2+ jobs — return awaiting_pick + meta and stop.
      awaitingPick = true;
    }
  } else if (body.clientId && body.pickedJobId) {
    // Picked job target: include the picked job's label so the panel
    // can display it as the subtitle.
    pickedJobLabel = initialTarget.label;
  }

  // Open-jobs list always reflects the ORIGINAL client (so the panel
  // can render the picker even when we narrowed target to a picked
  // job). Jobs path uses the empty array.
  const openJobs =
    initialTarget.source === "client"
      ? initialTarget.jobs.map((j) => ({
          jobId: j.id,
          jobRfId: j.legacyRfId,
          title: j.title,
        }))
      : [];

  // Awaiting-pick short-circuit: emit meta + awaiting_pick + end and
  // bail before the candidate pool query so we don't pay Claude or
  // database cost when the recruiter still needs to pick a job.
  if (awaitingPick) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (obj: object) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        send({ t: "meta", openJobs });
        send({ t: "awaiting_pick" });
        send({ t: "end", hasMore: false, page });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // Pull the candidate pool, scoped to the org.
  const pool = await prisma.candidate.findMany({
    where: { organizationId: org.id },
    select: {
      id: true,
      rfId: true,
      firstName: true,
      lastName: true,
      email: true,
      currentDesignation: true,
      currentOrganization: true,
      location: true,
      skills: true,
      notes: true,
      expectedSalary: true,
      experience: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 2000,
  });

  // Pre-filter, drop any candidates the client has already received
  // on prior pages, and cap to the prompt budget. excludeIds is the
  // pagination mechanism — page 0 sends no excludes, page 1 sends
  // page 0's ids, etc. Server-side ranking sees only fresh
  // candidates each call so subsequent pages don't re-rank already-
  // shown rows.
  const exclude = new Set(excludeIds);

  // Server-side guard: any candidate the recruiter has already acted
  // on for THIS job (Placement at any stage — applied / submitted /
  // interviewing / offer / hired / rejected / kept) must never be
  // re-surfaced as a "new" match. The panel already seeds excludeIds
  // from existing CandidateMatch rows on its own, but those get
  // pruned once the candidate moves to a pipeline bucket — without
  // this server-side union, applying or rejecting a candidate would
  // cause them to reappear on the next Find Matches run as if they
  // were brand new. Enforced here so the rule survives any client-
  // side bug or stale cache.
  //
  // Scope: target.jobs[0] is the resolved single job for both job-
  // target and picked-client-target paths. Client-target without a
  // pick was already short-circuited above (awaitingPick), so this
  // path always has a concrete jobId.
  const targetJobId = target.jobs[0]?.id;
  if (targetJobId) {
    const placedRows = await prisma.placement.findMany({
      // Game Plan placed-row exclusion — cancelled placements are
      // intentionally excluded so a cancelled candidate becomes
      // eligible to be re-sourced for the same job. Per the cancel-
      // placement product call (decided alongside the /pipeline
      // toggle): cancellation should not permanently lock a candidate
      // out of future matches.
      where: {
        jobId: targetJobId,
        organizationId: org.id,
        stage: { not: "cancelled" },
      },
      select: { candidateId: true },
    });
    for (const p of placedRows) {
      if (typeof p.candidateId === "string" && p.candidateId.length > 0) {
        exclude.add(p.candidateId);
      }
    }
  }

  const filtered = preFilterPool(pool, target)
    .filter((c) => !exclude.has(c.id))
    .slice(0, PRE_FILTER_CAP);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        send({ t: "meta", openJobs, pickedJobLabel });

        if (filtered.length === 0) {
          send({ t: "end", hasMore: false, page });
          controller.close();
          return;
        }

        // Deterministic compute + store pass. For the pre-filtered
        // candidate slice this:
        //   1. Bulk-selects every existing CandidateMatch row for
        //      this job (so we don't pay one SELECT per candidate).
        //   2. Hash-compares each candidate's current inputs against
        //      the stored sourceHash. Match -> return stored. Miss ->
        //      compute deterministically + upsert.
        //   3. Sorts the slice by stored score descending, applies
        //      the same threshold (>= 40) and PAGE_SIZE the prior
        //      Claude path used.
        // Every step is bounded by PRE_FILTER_CAP and the deterministic
        // scorer is pure CPU — no API calls, no token budget, no per-
        // open credit cost.
        const targetJob = target.jobs[0];
        if (!targetJob) {
          send({ t: "end", hasMore: false, page });
          controller.close();
          return;
        }

        // Pull the most-recent resume's extractedText for every
        // pre-filter candidate in one query. The scorer reads
        // resume.extractedText as part of skill / experience signal.
        const resumeRows = await prisma.candidateResume.findMany({
          where: {
            organizationId: org.id,
            candidateId: { in: filtered.map((c) => c.id) },
            extractedText: { not: null },
          },
          orderBy: { uploadedAt: "desc" },
          select: { candidateId: true, extractedText: true },
        });
        const resumeByCandidate = new Map<string, string>();
        for (const r of resumeRows) {
          if (!r.candidateId) continue;
          if (!resumeByCandidate.has(r.candidateId)) {
            resumeByCandidate.set(r.candidateId, r.extractedText ?? "");
          }
        }
        // Pull lat/lng directly so the scorer can use them when present.
        const geoRows = await prisma.candidate.findMany({
          where: { organizationId: org.id, id: { in: filtered.map((c) => c.id) } },
          select: { id: true, lat: true, lng: true },
        });
        const geoByCandidate = new Map(geoRows.map((g) => [g.id, g] as const));

        const scoringCandidates = filtered.map((c) => ({
          id: c.id,
          currentDesignation: c.currentDesignation,
          currentOrganization: c.currentOrganization,
          skills: c.skills,
          experience: c.experience,
          expectedSalary: c.expectedSalary,
          location: c.location,
          lat: geoByCandidate.get(c.id)?.lat ?? null,
          lng: geoByCandidate.get(c.id)?.lng ?? null,
          resumeText: resumeByCandidate.get(c.id) ?? null,
        }));

        // Compute + store, returning the score map.
        await ensureMatchScoresForPool({
          orgId: org.id,
          jobId: targetJob.id,
          candidates: scoringCandidates,
        });

        // Read back the full stored row for the slice so the panel
        // gets the rationale + scoreBreakdown alongside the score.
        const storedRows = await prisma.candidateMatch.findMany({
          where: {
            jobId: targetJob.id,
            organizationId: org.id,
            candidateId: { in: filtered.map((c) => c.id) },
          },
          select: { candidateId: true, score: true, rationale: true, scoreBreakdown: true },
        });
        const storedByCandidate = new Map(storedRows.map((r) => [r.candidateId, r] as const));

        // Build the ranked, threshold-filtered list. score >= 40 is
        // the same drop threshold the Claude path used.
        const candidatesById = new Map(filtered.map((c) => [c.id, c]));
        const ranked = Array.from(storedByCandidate.values())
          .filter((r) => r.score >= 40)
          .sort((a, b) => b.score - a.score);

        const slice = ranked.slice(0, PAGE_SIZE);
        for (const row of slice) {
          const c = candidatesById.get(row.candidateId);
          if (!c) continue;
          const name =
            [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "(no name)";
          send({
            t: "match",
            match: {
              candidateId: c.id,
              candidateRfId: c.rfId,
              name,
              firstName: c.firstName,
              lastName: c.lastName ?? "",
              email: c.email ?? "",
              title: c.currentDesignation ?? "",
              currentEmployer: c.currentOrganization ?? "",
              location: c.location ?? "",
              comp: formatComp(c.expectedSalary),
              rationale: row.rationale,
              score: row.score,
              scoreBreakdown: row.scoreBreakdown,
            },
          });
        }

        const hasMore = ranked.length > PAGE_SIZE;
        send({ t: "end", hasMore, page });
      } catch (e) {
        send({
          t: "error",
          error: e instanceof Error ? e.message : "Find matches failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Defeats nginx-style proxy buffering so the client actually
      // receives bytes as we flush them, not in a big terminal blob.
      "X-Accel-Buffering": "no",
    },
  });
}

async function loadTarget(
  orgId: string,
  args: { jobId?: string; clientId?: string },
): Promise<MatchTarget | null> {
  if (args.jobId) {
    const job = await prisma.job.findFirst({
      where: { id: args.jobId, organizationId: orgId },
      select: {
        id: true,
        title: true,
        description: true,
        locations: true,
        salaryRangeStart: true,
        salaryRangeEnd: true,
        legacyRfId: true,
        searchKeywords: true,
        client: { select: { name: true } },
        raw: true,
      },
    });
    if (!job) return null;
    const description = readJobDescription(job);
    return {
      jobs: [
        {
          id: job.id,
          title: job.title,
          description,
          locations: job.locations,
          salaryRangeStart: job.salaryRangeStart,
          salaryRangeEnd: job.salaryRangeEnd,
          legacyRfId: job.legacyRfId,
          searchKeywords: splitKeywords(job.searchKeywords),
        },
      ],
      label: `${job.title}${job.client?.name ? ` at ${job.client.name}` : ""}`,
      source: "job",
    };
  }
  if (args.clientId) {
    const client = await prisma.client.findFirst({
      where: { id: args.clientId, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!client) return null;
    const jobs = await prisma.job.findMany({
      where: { clientId: client.id, organizationId: orgId, isOpen: true },
      select: {
        id: true,
        title: true,
        description: true,
        locations: true,
        salaryRangeStart: true,
        salaryRangeEnd: true,
        legacyRfId: true,
        searchKeywords: true,
        raw: true,
      },
    });
    return {
      jobs: jobs.map((j) => ({
        id: j.id,
        title: j.title,
        description: readJobDescription(j),
        locations: j.locations,
        salaryRangeStart: j.salaryRangeStart,
        salaryRangeEnd: j.salaryRangeEnd,
        legacyRfId: j.legacyRfId,
        searchKeywords: splitKeywords(j.searchKeywords),
      })),
      label: `${client.name}: ${jobs.length} open role${jobs.length === 1 ? "" : "s"}`,
      source: "client",
    };
  }
  return null;
}

function readJobDescription(j: { description: string | null; raw: unknown }): string {
  if (j.description && j.description.trim()) return j.description;
  if (j.raw && typeof j.raw === "object" && j.raw !== null) {
    const r = j.raw as Record<string, unknown>;
    if (typeof r.description === "string") return r.description;
  }
  return "";
}

// Pre-filter the candidate pool down to a manageable set BEFORE the
// Claude call. Two cheap signals:
//
//   1. Title-keyword overlap between the candidate's currentDesignation
//      / skills and tokens drawn from each target job's title +
//      description.
//   2. Rough location match: any of the target locations shares a
//      city or state token with the candidate.location string.
//
// Score = title_hits * 3 + location_hits * 1. We sort high-to-low and
// hand the top N to Claude. Anything with a non-zero score still gets
// considered; zero-score candidates only flow through if the filtered
// pool is too small (we top up to PRE_FILTER_CAP with the most-recent
// candidates so the recruiter still sees suggestions even when the JD
// is sparse).
function preFilterPool(pool: CandidateRow[], target: MatchTarget): CandidateRow[] {
  const titleTokens = new Set<string>();
  const locTokens = new Set<string>();
  // Recruiter priority keywords get a separate, higher-weighted bucket
  // so a candidate matching them outranks one that only brushes the
  // JD's auto-extracted tokens.
  const keywordTokens = new Set<string>();
  for (const j of target.jobs) {
    for (const t of tokenize(j.title)) titleTokens.add(t);
    for (const t of tokenize(j.description).slice(0, 200)) titleTokens.add(t);
    for (const loc of j.locations) for (const t of tokenize(loc)) locTokens.add(t);
    for (const kw of j.searchKeywords) {
      for (const t of tokenize(kw)) keywordTokens.add(t);
    }
  }
  const STOP = new Set([
    "the", "and", "for", "with", "you", "are", "our", "your", "this", "that",
    "will", "have", "from", "they", "their", "but", "any", "all", "can", "not",
    "team", "role", "work", "must", "able", "into", "about", "over", "more",
    "what", "when", "where", "while", "based", "across", "within", "should",
  ]);
  for (const t of Array.from(titleTokens)) {
    if (t.length < 3 || STOP.has(t)) titleTokens.delete(t);
  }
  // Same length / stopword guards on keyword tokens so a recruiter
  // typing "the, a, in" can't blow up the scoring.
  for (const t of Array.from(keywordTokens)) {
    if (t.length < 3 || STOP.has(t)) keywordTokens.delete(t);
  }
  // Title bucket also gets every keyword token so the two buckets
  // don't double-credit the same hit (keyword bucket already counts
  // it at x5).
  keywordTokens.forEach((t) => titleTokens.delete(t));

  const scored = pool.map((c) => {
    const candText = [
      c.currentDesignation ?? "",
      c.currentOrganization ?? "",
      (c.skills || []).join(" "),
      c.notes ?? "",
    ].join(" ");
    const candTokens = new Set(tokenize(candText));
    let titleHits = 0;
    titleTokens.forEach((t) => {
      if (candTokens.has(t)) titleHits++;
    });
    let keywordHits = 0;
    keywordTokens.forEach((t) => {
      if (candTokens.has(t)) keywordHits++;
    });
    const candLocTokens = new Set(tokenize(c.location ?? ""));
    let locHits = 0;
    locTokens.forEach((t) => {
      if (candLocTokens.has(t)) locHits++;
    });
    const score = keywordHits * 5 + titleHits * 3 + locHits;
    return { c, score };
  });

  const ranked = scored.sort((a, b) => b.score - a.score);
  const filtered = ranked.filter((r) => r.score > 0).map((r) => r.c);
  if (filtered.length >= PRE_FILTER_CAP) return filtered;
  // Top up with most-recent candidates so a sparse JD still yields a
  // visible match panel.
  const seen = new Set(filtered.map((c) => c.id));
  for (const r of ranked) {
    if (seen.has(r.c.id)) continue;
    filtered.push(r.c);
    seen.add(r.c.id);
    if (filtered.length >= PRE_FILTER_CAP) break;
  }
  return filtered;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function formatComp(expectedSalary: unknown): string {
  if (expectedSalary && typeof expectedSalary === "object") {
    const e = expectedSalary as Record<string, unknown>;
    const n = typeof e.number === "number" ? e.number : null;
    const cur = typeof e.currency === "string" ? e.currency : "USD";
    if (n !== null) {
      const formatted = n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;
      return `${formatted} ${cur === "USD" ? "" : cur}`.trim();
    }
  }
  return "";
}

// The prior buildStreamingPrompt + formatExperience helpers fed the
// removed Claude streaming path. The deterministic scorer in
// src/lib/match-scoring.ts owns all of that logic now (title taxonomy,
// experience parsing, skill normalization, etc.). Kept this comment as
// a tombstone for the git archaeology — search "buildStreamingPrompt"
// here and see commit history if you need the old prompt text.
