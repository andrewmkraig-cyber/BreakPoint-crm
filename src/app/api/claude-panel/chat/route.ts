import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { CLAUDE_MODEL } from "@/lib/claude";
import { buildPersonalTrainerBlock } from "@/lib/personal-trainer";
import {
  buildCandidateContext,
  buildClientContext,
  buildJobContext,
} from "@/lib/ai-workspace-context";

// Live Claude call for the global Claude Panel (Sparkles topbar
// toggle). Streams text deltas as NDJSON events back to the client so
// the assistant bubble fills in word-by-word, matching the Game Plan
// /api/game-plan/find-matches streaming pattern. The panel persists
// transcript rows separately via /api/claude-panel/messages — this
// route is computation only, no DB writes.

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
  "For any external facts, job market data, salaries, companies, people, or URLs - verify with web_search during this turn. Never hedge with 'data may be outdated.' If you cannot verify something, omit it.";

type IncomingMessage = { role: unknown; content: unknown };

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
  const cleaned: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const raw of body.messages as IncomingMessage[]) {
    const role = raw?.role === "user" || raw?.role === "assistant" ? raw.role : null;
    const content =
      typeof raw?.content === "string" ? raw.content.trim() : "";
    if (!role || !content) continue;
    const last = cleaned[cleaned.length - 1];
    if (last && last.role === role) {
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
  let entityBlock = "";
  if (entityType && entityId) {
    try {
      const built =
        entityType === "candidate"
          ? await buildCandidateContext(entityId)
          : entityType === "client"
            ? await buildClientContext(entityId)
            : await buildJobContext(entityId);
      entityBlock =
        built +
        "\n\nThe recruiter is currently viewing this record. Answer questions about it directly without asking for clarification.\n\n";
    } catch {
      // Don't fail the chat just because the page context lookup hit
      // a snag — fall back to the unscoped prompt and let Claude
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          // Server-side web search. Same tool registration as
          // /api/ai-workspace/route.ts — the response is a multi-block
          // sequence (text preface, server_tool_use, web_search_tool_result,
          // text answer). Streaming naturally emits text_deltas for every
          // text block in order; we insert "\n\n" between consecutive
          // text blocks so the assembled transcript matches the
          // .join('\n\n') shape ai-workspace produces from the non-
          // streaming path. Reading just content[0] would drop the cited
          // answer and keep only the preface.
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
            },
          ],
          system: fullSystemPrompt,
          messages: cleaned,
        });

        let textBlockSeen = false;
        for await (const event of claudeStream) {
          if (
            event.type === "content_block_start" &&
            event.content_block.type === "text"
          ) {
            // Boundary between two text blocks (preface vs. cited
            // answer when web_search fires). Emit a blank-line
            // separator so the streaming bubble doesn't smash them
            // together, matching ai-workspace's join('\n\n').
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
