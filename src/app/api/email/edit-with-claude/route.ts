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
    const first = response.content[0];
    const raw = first && first.type === "text" ? first.text : "";
    if (!raw) {
      return NextResponse.json({ error: "Claude returned no content." }, { status: 502 });
    }
    return NextResponse.json({ body: stripFences(raw) });
  } catch (e) {
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
