import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { buildPersonalTrainerBlock } from "@/lib/personal-trainer";

export const dynamic = "force-dynamic";
// Sonnet on a moderate-size body usually completes in 2–8s; 60s is the
// same ceiling we use for /api/mail/ai-compose so the two stay aligned.
export const maxDuration = 60;

// Revises an already-typed email body. Separate from the Generate flow
// (which writes from scratch) — Edit takes the user's draft and tightens
// or re-tones it without changing its meaning. Two formats are accepted
// so the same endpoint serves both the plain-text submittal composer
// (markers like **bold**) and the Tiptap rich-text /mail composer (HTML).

const anthropic = new Anthropic();

const EDIT_TYPES = ["professional", "friendly", "casual", "shorter", "better"] as const;
export type EditType = (typeof EDIT_TYPES)[number];

const EDIT_INSTRUCTIONS: Record<EditType, string> = {
  professional:
    "Revise the email to sound more professional while keeping the core message intact.",
  friendly:
    "Revise the email to sound friendlier and warmer while keeping the core message intact.",
  casual:
    "Revise the email to sound more casual and conversational while keeping the core message intact.",
  shorter:
    "Revise the email to be shorter and more concise without losing important information.",
  better:
    "Revise the email to be clearer, tighter, and more effective without changing its core meaning.",
};

type ApiRequest = {
  body: string;
  editType: EditType;
  format: "text" | "html";
};

type ApiResponse = { body: string } | { error: string };

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: ApiRequest;
  try {
    payload = (await req.json()) as ApiRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = (payload.body ?? "").toString();
  if (!body.trim()) {
    return NextResponse.json({ error: "Body is empty — nothing to edit." }, { status: 400 });
  }
  if (!EDIT_TYPES.includes(payload.editType)) {
    return NextResponse.json({ error: "Invalid editType." }, { status: 400 });
  }
  const format: "text" | "html" = payload.format === "html" ? "html" : "text";

  const formatRule =
    format === "html"
      ? "The input is HTML. Return valid HTML using the same structural tags found in the input (<p>, <br>, <strong>, <em>, <u>, <ul>, <ol>, <li>, <a>, <blockquote>). Do not wrap in <html> or <body>. Do not add inline styles."
      : "The input is plain text. Return plain text with paragraph breaks. Preserve any **bold** or __underline__ markers exactly.";

  const org = await getCurrentOrg();
  const trainerBlock = await buildPersonalTrainerBlock(org.id);

  const system =
    [
      "You are an email-revision assistant for a recruiter at BreakPoint Talent.",
      `Edit instruction: ${EDIT_INSTRUCTIONS[payload.editType]}`,
      "",
      "Hard rules:",
      "- Return ONLY the revised email body. No preamble, no commentary, no markdown code fences.",
      "- If a signature block already exists at the bottom of the input (multi-line block with a name + title + contact info), leave those signature lines exactly as-is. Do not edit them.",
      "- Do NOT add a 'Subject:' line.",
      formatRule,
    ].join("\n") + trainerBlock;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        },
      ],
      system,
      messages: [{ role: "user", content: body }],
    });
    // Concatenate all text blocks. With web_search enabled, the
    // response is a multi-block array (server_tool_use →
    // web_search_tool_result → text); grabbing content[0] only
    // would mis-classify the tool-use block as "no content" and
    // 502 even though Claude wrote a perfectly good revision two
    // slots later. Mirror of the fix in /api/mail/ai-compose.
    const raw = response.content
      .filter(
        (b): b is Extract<(typeof response.content)[number], { type: "text" }> =>
          b.type === "text",
      )
      .map((b) => b.text)
      .join("\n\n")
      .trim();
    if (!raw) {
      console.error("[edit-with-claude] no text content from Claude", {
        stop_reason: response.stop_reason,
        block_types: response.content.map((b) => b.type),
      });
      const hint =
        response.stop_reason === "max_tokens"
          ? "Claude hit the response length limit before finishing the revision."
          : response.stop_reason === "tool_use"
            ? "Claude got stuck mid-tool-use without writing a revision."
            : "Claude returned no revised body.";
      return NextResponse.json(
        { error: `${hint} Try again or pick a different edit type.` },
        { status: 502 },
      );
    }
    return NextResponse.json({ body: stripFences(raw) });
  } catch (e) {
    console.error("[edit-with-claude] Anthropic call failed", e);
    const msg = e instanceof Error ? e.message : "Claude call failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// Claude occasionally wraps replies in ```html ... ``` or ```text ... ```
// fences despite the system prompt; strip those before returning.
function stripFences(s: string): string {
  let out = s.trim();
  out = out.replace(/^```(?:html|text|plaintext)?\s*/i, "").replace(/\s*```$/i, "");
  return out;
}
