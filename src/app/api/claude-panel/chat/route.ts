import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { CLAUDE_MODEL } from "@/lib/claude";

// Live Claude call for the global Claude Panel (Sparkles topbar
// toggle). Streams text deltas as NDJSON events back to the client so
// the assistant bubble fills in word-by-word, matching the Game Plan
// /api/game-plan/find-matches streaming pattern. The panel persists
// transcript rows separately via /api/claude-panel/messages — this
// route is computation only, no DB writes.

export const maxDuration = 300;

const anthropic = new Anthropic();

const SYSTEM_PROMPT =
  "You are Ace, an AI recruiting assistant built into BreakPoint Talent's internal CRM. " +
  "You help Andrew Kraig with recruiting tasks: candidate evaluation, writing submittals, BD messages, " +
  "interview prep, market research, and anything else recruiting-related. " +
  "Be concise, direct, and commercially sharp. No filler. No hedging. " +
  "Responses should feel like they came from a strong recruiter, not an AI.";

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

  let body: { messages?: unknown };
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

  // Resolve org for log context only — no DB writes here. Handler
  // would still throw if the signed-in user has no membership AND no
  // DEFAULT_ORG_ID, which is the right failure: don't pretend to be
  // tenant-scoped when we can't resolve a tenant.
  await getCurrentOrg();

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
          system: SYSTEM_PROMPT,
          messages: cleaned,
        });

        for await (const event of claudeStream) {
          if (
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
