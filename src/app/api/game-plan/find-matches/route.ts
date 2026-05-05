import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { CLAUDE_MODEL } from "@/lib/claude";

// Game Plan Phase 2 — Find Matches.
//
// POST /api/game-plan/find-matches
// Body: { jobId?: string, clientId?: string, page?: number }
// Returns: { matches, hasMore, page }
//
// Tenant-scoped: every Neon query carries WHERE organizationId = org.id
// (CLAUDE.md non-negotiable #8). The resolved org id is logged at the
// top of the handler so the regression check can confirm it threads
// into every query without rummaging through call sites.
//
// Pre-filter pool BEFORE Claude: title keyword match + rough location
// match against the target (city OR state token). Cheap substring +
// token comparisons; we are explicitly NOT geocoding for v1. This
// keeps the Sonnet token cost sane on big candidate pools without
// adding infra.

export const maxDuration = 300;

const PAGE_SIZE = 5;
const PRE_FILTER_CAP = 60;
const PROMPT_CANDIDATE_CAP = 30;

const anthropic = new Anthropic();

type MatchTarget = {
  jobs: Array<{
    id: string;
    title: string;
    description: string;
    locations: string[];
    salaryRangeStart: number | null;
    salaryRangeEnd: number | null;
    legacyRfId: number | null;
  }>;
  // Combined display label for prompt + UI ("Tax Manager at Acme" or
  // "Acme Industries — 4 open roles").
  label: string;
  source: "job" | "client";
};

type CandidateRow = {
  id: string;
  rfId: number | null;
  firstName: string;
  lastName: string | null;
  currentDesignation: string | null;
  currentOrganization: string | null;
  location: string | null;
  skills: string[];
  notes: string | null;
  expectedSalary: unknown;
  experience: unknown;
};

type ClaudeMatch = {
  candidateId: string;
  rationale: string;
  score: number;
};

export async function POST(req: NextRequest) {
  const org = await getCurrentOrg();
  // Regression-check log: confirms organizationId reaches the route
  // (and by extension every WHERE clause below). Visible in `vercel
  // logs` for one POST per page-load.
  // eslint-disable-next-line no-console
  console.log("[find-matches] org.id =", org.id);

  let body: { jobId?: string; clientId?: string; page?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const page = Math.max(0, Math.floor(body.page ?? 0));
  if (!body.jobId && !body.clientId) {
    return NextResponse.json({ error: "jobId or clientId required" }, { status: 400 });
  }

  const target = await loadTarget(org.id, { jobId: body.jobId, clientId: body.clientId });
  if (!target) {
    return NextResponse.json({ error: "Target not found" }, { status: 404 });
  }

  // Pull the candidate pool, scoped to the org.
  const pool = await prisma.candidate.findMany({
    where: { organizationId: org.id },
    select: {
      id: true,
      rfId: true,
      firstName: true,
      lastName: true,
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

  const filtered = preFilterPool(pool, target).slice(0, PRE_FILTER_CAP);

  if (filtered.length === 0) {
    return NextResponse.json({ matches: [], hasMore: false, page });
  }

  // Cache the full Claude-ranked list keyed by (target, candidate-set
  // signature) inside the response — the panel pages through 5 at a
  // time on the client, but the server still ranks the full filtered
  // pool every call. Simpler than a Redis layer for v1; the panel's
  // page param drops the right slice.
  const ranked = await rankWithClaude(filtered.slice(0, PROMPT_CANDIDATE_CAP), target);

  const start = page * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const slice = ranked.slice(start, end);

  // Hydrate each match with display fields the card needs (we fetched
  // these already in the pool, no extra round trip).
  const byId = new Map(filtered.map((c) => [c.id, c]));
  const matches = slice
    .map((m) => {
      const c = byId.get(m.candidateId);
      if (!c) return null;
      const compLabel = formatComp(c.expectedSalary);
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "(no name)";
      return {
        candidateId: c.id,
        candidateRfId: c.rfId,
        name,
        title: c.currentDesignation ?? "",
        currentEmployer: c.currentOrganization ?? "",
        location: c.location ?? "",
        comp: compLabel,
        rationale: m.rationale,
        score: m.score,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  // For client-target panels, also return the client's open jobs so
  // the per-card "Apply/Submit → pick a job" dropdown can render
  // without a second round trip.
  const openJobs =
    target.source === "client"
      ? target.jobs.map((j) => ({
          jobId: j.id,
          jobRfId: j.legacyRfId,
          title: j.title,
        }))
      : [];

  return NextResponse.json({
    matches,
    hasMore: end < ranked.length,
    page,
    openJobs,
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
      })),
      label: `${client.name} — ${jobs.length} open role${jobs.length === 1 ? "" : "s"}`,
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
  for (const j of target.jobs) {
    for (const t of tokenize(j.title)) titleTokens.add(t);
    for (const t of tokenize(j.description).slice(0, 200)) titleTokens.add(t);
    for (const loc of j.locations) for (const t of tokenize(loc)) locTokens.add(t);
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
    const candLocTokens = new Set(tokenize(c.location ?? ""));
    let locHits = 0;
    locTokens.forEach((t) => {
      if (candLocTokens.has(t)) locHits++;
    });
    const score = titleHits * 3 + locHits;
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

// Build the Claude prompt and return ranked matches. We ask for JSON
// directly; the model is reliable enough for this with a strict schema
// hint. Falls back to an empty list if the response can't be parsed —
// the panel renders the empty state in that case.
async function rankWithClaude(
  candidates: CandidateRow[],
  target: MatchTarget,
): Promise<ClaudeMatch[]> {
  const targetBlock = target.jobs
    .map((j, i) => {
      const sal =
        j.salaryRangeStart && j.salaryRangeEnd
          ? `\n  Comp range: $${j.salaryRangeStart}–$${j.salaryRangeEnd}`
          : "";
      const loc = j.locations.length ? `\n  Locations: ${j.locations.join(", ")}` : "";
      const desc = j.description.slice(0, 4000);
      return `Job ${i + 1}: ${j.title}${loc}${sal}\n  Description:\n${desc}`;
    })
    .join("\n\n---\n\n");

  const candidateBlock = candidates
    .map((c) => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      const skills = (c.skills || []).slice(0, 30).join(", ");
      const exp = formatExperience(c.experience);
      const notes = (c.notes ?? "").slice(0, 800);
      return [
        `id: ${c.id}`,
        `name: ${name}`,
        `current_title: ${c.currentDesignation ?? ""}`,
        `current_employer: ${c.currentOrganization ?? ""}`,
        `location: ${c.location ?? ""}`,
        `comp: ${formatComp(c.expectedSalary) || "(unspecified)"}`,
        skills ? `skills: ${skills}` : "",
        exp ? `experience: ${exp}` : "",
        notes ? `notes: ${notes}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  const prompt = [
    `You are ranking candidates from BreakPoint Talent's internal database for the following ${target.source === "client" ? "client's open roles" : "job"}.`,
    "",
    "TARGET:",
    targetBlock,
    "",
    "CANDIDATES:",
    candidateBlock,
    "",
    "TASK:",
    `Score each candidate 1–100 on fit. Order strongest fit first. ${target.source === "client" ? "If the client has multiple roles, score against the candidate's best-fit role across the union." : ""} Drop weak fits (< 40) entirely.`,
    "Write a 1–2 sentence rationale per candidate that calls out the specific reason they fit (title overlap, comp alignment, location, domain experience).",
    "Use plain prose. Do NOT use em dashes — use hyphens or commas.",
    "",
    "OUTPUT FORMAT — return ONLY a JSON array, no preamble, no markdown fence:",
    `[{ "candidateId": "<id>", "score": <int>, "rationale": "<1-2 sentences>" }, ...]`,
  ].join("\n");

  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = resp.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  return parseClaudeJson(text);
}

function parseClaudeJson(text: string): ClaudeMatch[] {
  // Strip optional markdown fence if Claude slips one in despite the
  // instruction. Then locate the first '[' and last ']' for resilience
  // against trailing commentary.
  let body = text;
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) body = fence[1];
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(body.slice(start, end + 1)) as Array<{
      candidateId?: unknown;
      score?: unknown;
      rationale?: unknown;
    }>;
    return arr
      .map((row) => {
        if (typeof row.candidateId !== "string") return null;
        const score = typeof row.score === "number" ? Math.round(row.score) : 0;
        const rationale = typeof row.rationale === "string" ? row.rationale : "";
        return { candidateId: row.candidateId, score, rationale } as ClaudeMatch;
      })
      .filter((r): r is ClaudeMatch => r !== null);
  } catch {
    return [];
  }
}

function formatExperience(experience: unknown): string {
  if (!Array.isArray(experience)) return "";
  return experience
    .slice(0, 4)
    .map((e) => {
      if (!e || typeof e !== "object") return "";
      const r = e as Record<string, unknown>;
      const title = typeof r.title === "string" ? r.title : typeof r.designation === "string" ? r.designation : "";
      const org = typeof r.organization === "string" ? r.organization : typeof r.employer === "string" ? r.employer : "";
      if (!title && !org) return "";
      return `${title}${title && org ? " at " : ""}${org}`;
    })
    .filter(Boolean)
    .join(" | ");
}
