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

  // Pre-filter, drop any candidates the client has already received
  // on prior pages, and cap to the prompt budget. excludeIds is the
  // pagination mechanism — page 0 sends no excludes, page 1 sends
  // page 0's ids, etc. Server-side ranking sees only fresh
  // candidates each call so subsequent pages don't re-rank already-
  // shown rows.
  const exclude = new Set(excludeIds);
  const filtered = preFilterPool(pool, target)
    .filter((c) => !exclude.has(c.id))
    .slice(0, PRE_FILTER_CAP);

  const openJobs =
    target.source === "client"
      ? target.jobs.map((j) => ({
          jobId: j.id,
          jobRfId: j.legacyRfId,
          title: j.title,
        }))
      : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        send({ t: "meta", openJobs });

        if (filtered.length === 0) {
          send({ t: "end", hasMore: false, page });
          controller.close();
          return;
        }

        const promptCandidates = filtered.slice(0, PROMPT_CANDIDATE_CAP);
        const byId = new Map(promptCandidates.map((c) => [c.id, c]));
        const seen = new Set<string>();
        let emitted = 0;

        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          messages: [
            { role: "user", content: buildStreamingPrompt(promptCandidates, target) },
          ],
        });

        let buffer = "";
        const tryEmit = (line: string): boolean => {
          // Returns true when we've hit PAGE_SIZE and the caller
          // should stop reading.
          const trimmed = line.trim();
          if (!trimmed) return false;
          // Strip surrounding markdown / array brackets / commas if
          // Claude slipped any in despite the prompt instruction.
          const cleaned = trimmed
            .replace(/^[\s\[,]+/, "")
            .replace(/[\s\],]+$/, "");
          if (!cleaned.startsWith("{")) return false;
          let parsed: { candidateId?: unknown; score?: unknown; rationale?: unknown };
          try {
            parsed = JSON.parse(cleaned);
          } catch {
            return false;
          }
          if (typeof parsed.candidateId !== "string") return false;
          if (seen.has(parsed.candidateId)) return false;
          const c = byId.get(parsed.candidateId);
          if (!c) return false;
          const score =
            typeof parsed.score === "number" ? Math.round(parsed.score) : 0;
          const rationale =
            typeof parsed.rationale === "string" ? parsed.rationale : "";
          if (score < 40) return false;
          const name =
            [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
            "(no name)";
          send({
            t: "match",
            match: {
              candidateId: c.id,
              candidateRfId: c.rfId,
              name,
              title: c.currentDesignation ?? "",
              currentEmployer: c.currentOrganization ?? "",
              location: c.location ?? "",
              comp: formatComp(c.expectedSalary),
              rationale,
              score,
            },
          });
          seen.add(parsed.candidateId);
          emitted++;
          return emitted >= PAGE_SIZE;
        };

        outer: for await (const event of claudeStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            buffer += event.delta.text;
            let idx;
            while ((idx = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 1);
              if (tryEmit(line)) break outer;
            }
          }
        }
        // Flush any final line that didn't end with a newline.
        if (emitted < PAGE_SIZE) tryEmit(buffer);

        // hasMore = there are still candidates left in the pre-
        // filtered pool that this page didn't surface (either
        // because Claude ranked them low + we cut at PAGE_SIZE, or
        // because PROMPT_CANDIDATE_CAP < filtered.length).
        const hasMore =
          emitted >= PAGE_SIZE ||
          filtered.length > PROMPT_CANDIDATE_CAP ||
          (emitted === 0 && filtered.length > 0);
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

// Build the streaming prompt. Critical instruction: emit one JSON
// object per line (NDJSON), NOT a JSON array. That lets the route
// stream-parse Claude's response line-by-line and forward each
// scored candidate to the client as it lands, instead of waiting
// for the whole batch to finish.
function buildStreamingPrompt(
  candidates: CandidateRow[],
  target: MatchTarget,
): string {
  const targetBlock = target.jobs
    .map((j, i) => {
      const sal =
        j.salaryRangeStart && j.salaryRangeEnd
          ? `\n  Comp range: $${j.salaryRangeStart}-$${j.salaryRangeEnd}`
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

  return [
    `You are ranking candidates from BreakPoint Talent's internal database for the following ${target.source === "client" ? "client's open roles" : "job"}.`,
    "",
    "TARGET:",
    targetBlock,
    "",
    "CANDIDATES:",
    candidateBlock,
    "",
    "TASK:",
    `Score each candidate 1-100 on fit. ${target.source === "client" ? "If the client has multiple roles, score against the candidate's best-fit role across the union." : ""} Drop weak fits (score < 40).`,
    "Emit your STRONGEST fit FIRST, then the next strongest, etc. Output them as you score them — start writing the first match as soon as you've decided on it. Do NOT pre-rank silently.",
    "Each rationale: 1-2 sentences calling out the specific reason they fit (title overlap, comp alignment, location, domain experience).",
    "Use plain prose. Do NOT use em dashes - use hyphens or commas.",
    "",
    "OUTPUT FORMAT — emit one JSON object per line (newline-delimited JSON). NOT a JSON array. NO markdown fence. NO preamble. NO commentary between objects.",
    `Each line: {"candidateId":"<id>","score":<int>,"rationale":"<1-2 sentences>"}`,
    `Example of two lines:`,
    `{"candidateId":"abc123","score":92,"rationale":"Strong match — current title aligns directly and location is on-site eligible."}`,
    `{"candidateId":"def456","score":81,"rationale":"Adjacent title with overlapping skills; comp target sits inside the band."}`,
    `Stop after you have emitted every candidate that scores 40 or higher.`,
  ].join("\n");
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
