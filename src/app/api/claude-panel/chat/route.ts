import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { CLAUDE_MODEL } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { buildPersonalTrainerBlock } from "@/lib/personal-trainer";
import {
  buildCandidateContext,
  buildClientContext,
  buildJobContext,
} from "@/lib/ai-workspace-context";
import { getClientByIdentifier } from "@/lib/clients";
import { getCandidateByIdentifier } from "@/lib/candidates";
import { getJobByIdentifier } from "@/lib/jobs";
import { formatLocation } from "@/lib/utils";

// Live Claude call for the global Claude Panel (Sparkles topbar
// toggle). Streams text deltas as NDJSON events back to the client so
// the assistant bubble fills in word-by-word, matching the Game Plan
// /api/game-plan/find-matches streaming pattern. The panel persists
// transcript rows separately via /api/claude-panel/messages — this
// route is computation only, no DB writes.
//
// Phase 4: data-access tools. Claude can now call search_candidates,
// search_jobs, search_clients, and get_pipeline to query Neon directly,
// in addition to the page-aware build*Context blocks already injected
// into the system prompt. Tool calls are executed server-side, results
// fed back as tool_result, and the stream resumed until Claude stops
// asking for tools (capped at 4 rounds to avoid runaway loops).

export const maxDuration = 300;

const anthropic = new Anthropic();

const SYSTEM_PROMPT =
  "You are Ace, an AI recruiting assistant inside BreakPoint Talent's CRM. " +
  "You help Andrew Kraig with recruiting tasks: candidate evaluation, submittals, BD messages, " +
  "interview prep, market research, and anything else recruiting-related. " +
  "Rules: be concise and direct, no filler, no hedging, no fake enthusiasm. " +
  "Never use asterisks or markdown bold in your responses. " +
  "Use plain hyphens for bullet points. " +
  "Write like a sharp recruiter, not an AI. " +
  "Never end a response with a signoff or signature. " +
  "For any external facts, job market data, salaries, companies, people, or URLs - verify with web_search during this turn. Never hedge with 'data may be outdated.' If you cannot verify something, omit it. " +
  "When the recruiter asks about candidates, jobs, clients, or the pipeline in their CRM, call the matching data tool (search_candidates, search_jobs, search_clients, get_pipeline) before answering — never invent records. If a tool returns no results, say so plainly.";

// Custom data tools — exposed to Claude so it can pull live records
// from Neon. Schemas mirror the parameters Andrew is most likely to ask
// in natural language ("who's interviewing at Sheehan", "find tax
// managers in Ohio"). Every tool is org-scoped at execution time.
const DATA_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_candidates",
    description:
      "Search candidates in the recruiter's CRM by free-text query. Matches against name, current title, current employer, location, skills, and tags. Tokens are AND-combined and case-insensitive. Returns up to 10 matches.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free-text query, e.g. 'tax manager Ohio' or 'Sara Johnson'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_jobs",
    description:
      "Search jobs in the recruiter's CRM by free-text query. Matches against title, client name, location, and status. Tokens are AND-combined and case-insensitive. Returns up to 10 matches.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free-text query, e.g. 'senior accountant Cleveland' or 'open Sheehan roles'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_clients",
    description:
      "Search clients (companies) in the recruiter's CRM by free-text query. Matches against name, industry, and location. Tokens are AND-combined and case-insensitive. Returns up to 10 matches.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text query, e.g. 'Sheehan Brothers' or 'public accounting Ohio'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_pipeline",
    description:
      "Return active pipeline placements (offer / pending_start / hired). Optional filters: clientName (substring, case-insensitive) and stage (exact: offer, pending_start, hired). Returns up to 20 most-recently-updated rows.",
    input_schema: {
      type: "object",
      properties: {
        clientName: {
          type: "string",
          description: "Substring match against client name. Optional.",
        },
        stage: {
          type: "string",
          description: "Exact stage: 'offer', 'pending_start', or 'hired'. Optional.",
        },
      },
    },
  },
];

const MAX_TOOL_ROUNDS = 4;
const PIPELINE_STAGES = new Set(["offer", "pending_start", "hired"]);

type IncomingMessage = { role: unknown; content: unknown };

function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

function joinName(first: string | null | undefined, last: string | null | undefined): string {
  const parts = [first, last].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : "(unnamed)";
}

// Tool: search_candidates — tokenized AND-of-OR across the headline
// candidate columns, mirrors /api/search/profiles semantics so Andrew's
// CRM searches and Claude's tool calls return the same shape of hits.
async function runSearchCandidates(query: string, orgId: string): Promise<string> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return "No query provided.";

  const and: Prisma.CandidateWhereInput[] = tokens.map((t) => ({
    OR: [
      { firstName: { contains: t, mode: "insensitive" } },
      { lastName: { contains: t, mode: "insensitive" } },
      { currentDesignation: { contains: t, mode: "insensitive" } },
      { currentOrganization: { contains: t, mode: "insensitive" } },
      { location: { contains: t, mode: "insensitive" } },
      { email: { contains: t, mode: "insensitive" } },
      { skills: { has: t } },
      { tags: { has: t } },
    ],
  }));

  const rows = await prisma.candidate.findMany({
    where: { organizationId: orgId, AND: and },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      currentDesignation: true,
      currentOrganization: true,
      location: true,
      tags: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  if (rows.length === 0) return `No candidates found for "${query}".`;
  const lines = rows.map((c, i) => {
    const name = joinName(c.firstName, c.lastName);
    const title = c.currentDesignation || "—";
    const employer = c.currentOrganization || "—";
    const loc = c.location || "—";
    const tags = c.tags && c.tags.length > 0 ? ` — tags: ${c.tags.join(", ")}` : "";
    return `${i + 1}. ${name} — ${title} at ${employer} — ${loc} — id: ${c.id}${tags}`;
  });
  return `Found ${rows.length} candidate(s) for "${query}":\n${lines.join("\n")}`;
}

// Tool: search_jobs — tokens AND across title / location array / client
// name / employmentType / department. locations is a String[] so we use
// `has` for an exact element match per token (Prisma has no substring
// operator inside arrays); the title/department fields cover the
// substring case for most token shapes.
async function runSearchJobs(query: string, orgId: string): Promise<string> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return "No query provided.";

  const and: Prisma.JobWhereInput[] = tokens.map((t) => ({
    OR: [
      { title: { contains: t, mode: "insensitive" } },
      { employmentType: { contains: t, mode: "insensitive" } },
      { department: { contains: t, mode: "insensitive" } },
      { locations: { has: t } },
      { client: { is: { name: { contains: t, mode: "insensitive" } } } },
    ],
  }));

  const rows = await prisma.job.findMany({
    where: { organizationId: orgId, AND: and },
    select: {
      id: true,
      title: true,
      isOpen: true,
      locations: true,
      client: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  if (rows.length === 0) return `No jobs found for "${query}".`;
  const lines = rows.map((j, i) => {
    const status = j.isOpen ? "open" : "closed";
    const loc = j.locations && j.locations.length > 0 ? j.locations.join("; ") : "—";
    const clientName = j.client?.name ?? "—";
    return `${i + 1}. ${j.title} — ${clientName} — ${loc} — ${status} — id: ${j.id}`;
  });
  return `Found ${rows.length} job(s) for "${query}":\n${lines.join("\n")}`;
}

// Tool: search_clients — tokens AND across name / industry / domain /
// tags. Client.location is a Json blob ({ city, state, country }) and
// Prisma can't substring-match inside it without raw SQL, so we
// post-filter: any token that didn't already match a row's name /
// industry / domain / tags has to substring-match the formatted
// location string. We over-fetch a bit so the post-filter still has
// 10 hits to work with.
async function runSearchClients(query: string, orgId: string): Promise<string> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return "No query provided.";

  const and: Prisma.ClientWhereInput[] = tokens.map((t) => ({
    OR: [
      { name: { contains: t, mode: "insensitive" } },
      { industry: { contains: t, mode: "insensitive" } },
      { domain: { contains: t, mode: "insensitive" } },
      { tags: { has: t } },
    ],
  }));

  // Broad pass: rows where every token matches at least one of the
  // text columns above.
  const broad = await prisma.client.findMany({
    where: { organizationId: orgId, AND: and },
    select: {
      id: true,
      name: true,
      industry: true,
      location: true,
      domain: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  // Location-included pass: same tokenization but each token can also
  // match the formatted location string. Run when the broad pass came
  // up short so a query like "Sheehan Ohio" still works even if Ohio
  // only appears in the location JSON.
  let combined = broad;
  if (broad.length < 10) {
    const recent = await prisma.client.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        industry: true,
        location: true,
        domain: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    const seen = new Set(broad.map((r) => r.id));
    const lowerTokens = tokens.map((t) => t.toLowerCase());
    const extras = recent.filter((r) => {
      if (seen.has(r.id)) return false;
      const haystack = [
        r.name,
        r.industry ?? "",
        r.domain ?? "",
        formatLocation(r.location as Parameters<typeof formatLocation>[0]),
      ]
        .join(" ")
        .toLowerCase();
      return lowerTokens.every((t) => haystack.includes(t));
    });
    combined = [...broad, ...extras].slice(0, 10);
  }

  if (combined.length === 0) return `No clients found for "${query}".`;
  const lines = combined.map((c, i) => {
    const industry = c.industry || "—";
    const loc =
      formatLocation(c.location as Parameters<typeof formatLocation>[0]) || "—";
    return `${i + 1}. ${c.name} — ${industry} — ${loc} — id: ${c.id}`;
  });
  return `Found ${combined.length} client(s) for "${query}":\n${lines.join("\n")}`;
}

// Tool: get_pipeline — pipeline.stage is canonical (rule 13). Filters
// by client substring + exact stage when provided. Includes candidate /
// job / client relations and falls back to "(unknown)" for legacy RF
// rows whose Ace cuid columns are still null.
async function runGetPipeline(
  args: { clientName?: string; stage?: string },
  orgId: string,
): Promise<string> {
  const where: Prisma.PlacementWhereInput = { organizationId: orgId };
  if (args.stage && PIPELINE_STAGES.has(args.stage)) {
    where.stage = args.stage;
  }
  if (args.clientName && args.clientName.trim()) {
    where.client = {
      is: { name: { contains: args.clientName.trim(), mode: "insensitive" } },
    };
  }

  const rows = await prisma.placement.findMany({
    where,
    select: {
      id: true,
      stage: true,
      updatedAt: true,
      candidate: { select: { firstName: true, lastName: true } },
      job: { select: { title: true } },
      client: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  if (rows.length === 0) {
    const filterDesc = [
      args.clientName ? `client="${args.clientName}"` : null,
      args.stage ? `stage="${args.stage}"` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `No pipeline rows found${filterDesc ? ` (${filterDesc})` : ""}.`;
  }

  const lines = rows.map((p, i) => {
    const cand = p.candidate
      ? joinName(p.candidate.firstName, p.candidate.lastName)
      : "(unknown candidate)";
    const job = p.job?.title ?? "(unknown job)";
    const clientName = p.client?.name ?? "(unknown client)";
    const updated = p.updatedAt.toISOString().slice(0, 10);
    return `${i + 1}. ${cand} — ${job} — ${clientName} — stage: ${p.stage} — updated: ${updated}`;
  });
  return `Pipeline (${rows.length} row${rows.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
}

async function executeTool(
  name: string,
  rawInput: unknown,
  orgId: string,
): Promise<string> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<
    string,
    unknown
  >;
  try {
    if (name === "search_candidates") {
      const query = typeof input.query === "string" ? input.query : "";
      return await runSearchCandidates(query, orgId);
    }
    if (name === "search_jobs") {
      const query = typeof input.query === "string" ? input.query : "";
      return await runSearchJobs(query, orgId);
    }
    if (name === "search_clients") {
      const query = typeof input.query === "string" ? input.query : "";
      return await runSearchClients(query, orgId);
    }
    if (name === "get_pipeline") {
      const clientName =
        typeof input.clientName === "string" ? input.clientName : undefined;
      const stage = typeof input.stage === "string" ? input.stage : undefined;
      return await runGetPipeline({ clientName, stage }, orgId);
    }
    return "No results found";
  } catch (err) {
    // Silent error per Phase 4 spec — Claude gets a graceful empty so
    // the conversation keeps moving instead of bubbling a 500 to the
    // panel UI. The recruiter would rather see "no matches" than a
    // red error card mid-stream.
    // eslint-disable-next-line no-console
    console.error("[claude-panel] tool error", name, err);
    return "No results found";
  }
}

export async function POST(req: NextRequest) {
  // Auth gate — Claude Panel is org-scoped and there's no anonymous
  // path. getCurrentOrg() can fall back to DEFAULT_ORG_ID env, but
  // for this surface we want a hard 401 when there's no signed-in
  // recruiter so a leaked URL can't burn tokens.
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }

  let body: {
    messages?: unknown;
    entityType?: unknown;
    entityId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.messages)) {
    return NextResponse.json(
      { ok: false, error: "messages must be an array" },
      { status: 400 },
    );
  }

  // Phase 3 page-aware context. The panel reports the active record
  // (candidate / client / job) it's looking at and we prepend the
  // relevant build*Context block to the system prompt so Claude can
  // answer "summarize this candidate" without the recruiter pasting
  // anything. Unknown types fall through to the unscoped prompt.
  const entityType =
    body.entityType === "candidate" ||
    body.entityType === "client" ||
    body.entityType === "job"
      ? body.entityType
      : null;
  const entityId =
    typeof body.entityId === "string" && body.entityId.trim().length > 0
      ? body.entityId.trim()
      : null;

  // Sanitize + collapse same-role runs. Anthropic rejects consecutive
  // user/user or assistant/assistant turns; same defense ai-workspace
  // applies before posting history. Drops any row missing a valid role
  // or content rather than failing the whole request.
  const cleaned: Anthropic.MessageParam[] = [];
  for (const raw of body.messages as IncomingMessage[]) {
    const role = raw?.role === "user" || raw?.role === "assistant" ? raw.role : null;
    const content =
      typeof raw?.content === "string" ? raw.content.trim() : "";
    if (!role || !content) continue;
    const last = cleaned[cleaned.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content = content;
    } else {
      cleaned.push({ role, content });
    }
  }

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return NextResponse.json(
      { ok: false, error: "history must end with a user message" },
      { status: 400 },
    );
  }

  // Resolve org so we can append the org-scoped Personal Trainer
  // rules block to the system prompt. getCurrentOrg() throws if the
  // signed-in user has no membership AND no DEFAULT_ORG_ID — the right
  // failure: don't pretend to be tenant-scoped when we can't resolve
  // a tenant.
  const org = await getCurrentOrg();

  // Page-aware entity block. Built first so it sits at the top of
  // the system prompt and Claude reads the record before the global
  // rules. build*Context already includes its own header sentence
  // identifying the record, so we just bracket it with a "currently
  // viewing" framing line that tells Claude to answer about this
  // record without asking the recruiter to clarify.
  //
  // Pre-resolution note: live URLs may use the legacy numeric slug
  // (slugFor still emits legacyRfId when set) but the build*Context
  // builders are cuid-only. The per-entity getXByIdentifier helpers
  // accept either form, so we resolve here and hand the builders a
  // canonical cuid.
  let entityBlock = "";
  if (entityType && entityId) {
    try {
      let resolvedCuid: string | null = null;
      if (entityType === "candidate") {
        resolvedCuid = (await getCandidateByIdentifier(entityId))?.id ?? null;
      } else if (entityType === "client") {
        resolvedCuid = (await getClientByIdentifier(entityId))?.id ?? null;
      } else {
        resolvedCuid = (await getJobByIdentifier(entityId))?.id ?? null;
      }
      if (resolvedCuid) {
        const built =
          entityType === "candidate"
            ? await buildCandidateContext(resolvedCuid)
            : entityType === "client"
              ? await buildClientContext(resolvedCuid)
              : await buildJobContext(resolvedCuid);
        entityBlock =
          built +
          "\n\nThe recruiter is currently viewing this record. Answer questions about it directly without asking for clarification.\n\n";
      }
    } catch {
      // Don't fail the chat just because the page context lookup hit
      // a snag - fall back to the unscoped prompt and let Claude
      // answer generically.
      entityBlock = "";
    }
  }

  // Personal Trainer rules — Andrew-curated standing instructions
  // (no em dashes, no emojis, no signoff, voice rules, etc.) sourced
  // from Settings > Personal Trainer. Appended last so they sit
  // closest to the model's response and override any earlier prompt
  // that drifts. Same pattern as /api/ai-workspace/route.ts.
  const fullSystemPrompt =
    entityBlock + SYSTEM_PROMPT + (await buildPersonalTrainerBlock(org.id));

  // Mixed tool list: the existing server-managed web_search plus the
  // four Phase 4 client-managed data tools. Claude picks per turn.
  const tools: Anthropic.ToolUnion[] = [
    { type: "web_search_20250305", name: "web_search" },
    ...DATA_TOOLS,
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      // textBlockSeen is hoisted across rounds so the "\n\n" boundary
      // applies between a round-1 preface ("Looking that up...") and
      // the round-2 cited answer, not just within a single response.
      let textBlockSeen = false;
      const conversation: Anthropic.MessageParam[] = [...cleaned];

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const claudeStream = anthropic.messages.stream({
            model: CLAUDE_MODEL,
            max_tokens: 4096,
            // Server-side web_search returns a multi-block sequence
            // (text preface, server_tool_use, web_search_tool_result,
            // text answer). Streaming naturally emits text_deltas for
            // every text block in order; we insert "\n\n" between
            // consecutive text blocks so the assembled transcript
            // matches the .join('\n\n') shape ai-workspace produces
            // from the non-streaming path. Reading just content[0]
            // would drop the cited answer and keep only the preface.
            tools,
            system: fullSystemPrompt,
            messages: conversation,
          });

          for await (const event of claudeStream) {
            if (
              event.type === "content_block_start" &&
              event.content_block.type === "text"
            ) {
              if (textBlockSeen) {
                send({ t: "delta", text: "\n\n" });
              }
              textBlockSeen = true;
            } else if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              send({ t: "delta", text: event.delta.text });
            }
          }

          const finalMsg = await claudeStream.finalMessage();

          // Server tools (web_search) finish in-stream and stop_reason
          // settles to "end_turn" — only client tool calls leave us
          // with stop_reason === "tool_use" and force another round.
          if (finalMsg.stop_reason !== "tool_use") break;

          const toolUses = finalMsg.content.filter(
            (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
          );
          if (toolUses.length === 0) break;

          // Record the assistant's tool-call turn verbatim, then run
          // every tool in parallel and feed the results back as a
          // single user turn of tool_result blocks. Anthropic requires
          // the next user turn to carry one tool_result per tool_use
          // emitted in the prior assistant turn.
          conversation.push({ role: "assistant", content: finalMsg.content });
          const results = await Promise.all(
            toolUses.map(async (tu) => {
              const text = await executeTool(tu.name, tu.input, org.id);
              return {
                type: "tool_result" as const,
                tool_use_id: tu.id,
                content: text,
              };
            }),
          );
          conversation.push({ role: "user", content: results });
        }
        send({ t: "end" });
      } catch (e) {
        send({
          t: "error",
          error: e instanceof Error ? e.message : "Stream failed",
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
      "X-Accel-Buffering": "no",
    },
  });
}
