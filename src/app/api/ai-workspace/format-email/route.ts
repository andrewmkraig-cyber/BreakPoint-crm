import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaude, CLAUDE_MODEL } from "@/lib/claude";

// Pure rewrite endpoint — no web_search, no candidate context lookup,
// no chat history. Hand it a Game Plan bubble and it returns a clean
// candidate-ready email: short subject + body that opens "Hi <First>,"
// and is stripped of recruiter-internal commentary, meta questions
// ("Want me to draft outreach?"), and Andrew's signoff/signature
// (Gmail appends a real one on send). Triggered when the recruiter
// clicks the "Email this" button in AiWorkspace, so the popup is
// always populated with a sendable subject + body — never the raw
// chat bubble.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let entityType: string | undefined;
  let entityId: string | undefined;
  let content: string | undefined;
  try {
    const body = await req.json();
    entityType = body.entityType;
    entityId = body.entityId;
    content = body.content;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (!content || !entityType || !entityId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  let firstName = "there";
  if (entityType === "candidate") {
    const candidate = /^\d+$/.test(entityId)
      ? await prisma.candidate.findFirst({ where: { rfId: Number(entityId) } })
      : await prisma.candidate.findUnique({ where: { id: entityId } });
    if (candidate?.firstName) firstName = candidate.firstName;
  }

  const anthropic = getClaude();
  const system =
    "You convert a recruiter-internal AI Workspace message into a polished, " +
    "candidate-ready email for BreakPoint Talent. Output STRICT JSON only — " +
    "no prose, no markdown fences, no preamble. Shape: " +
    `{ "subject": string, "body": string }. ` +
    "Rules:\n" +
    "- subject: short (≤ 70 chars), specific to the message content, written for the candidate (not Andrew).\n" +
    "- body: plain text email starting with `Hi <FirstName>,` then a blank line, then the message.\n" +
    "- Strip everything that was internal-to-Andrew: meta questions like 'Want me to draft outreach?', 'Let me know which interests you', recruiter-side commentary about why the candidate is a fit (the candidate already knows themselves), references to internal call notes, anything addressed at Andrew rather than the candidate.\n" +
    "- Strip any signoff (Talk soon / Best / Thanks / etc.) and any signature lines (Andrew Kraig / BreakPoint Talent). Gmail attaches the real signature on send.\n" +
    "- Strip leading/trailing `---` separators and any 'Here\\'s a clean email...' / 'Ready to copy and send...' framing lines.\n" +
    "- Preserve job listings, links, comp ranges, location notes — those are the substance the candidate needs.\n" +
    "- Keep markdown formatting in the body (bold, bullets, [text](url) links). The downstream renderer converts it to HTML for Gmail.\n" +
    "- If the source already has a `Subject:` line, use it (cleaned up) instead of inventing one.\n" +
    "- Never invent facts. Use only what's in the source message.";

  const userPrompt =
    `Recipient first name: ${firstName}\n\n` +
    "Source message (recruiter-side AI Workspace bubble):\n" +
    "<<<\n" +
    content +
    "\n>>>\n\n" +
    'Return JSON: { "subject": "...", "body": "Hi <name>,\\n\\n..." }';

  let raw = "";
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });
    raw = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Claude call failed: ${msg}` }, { status: 502 });
  }

  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed.subject !== "string" || typeof parsed.body !== "string") {
    return NextResponse.json(
      { error: "Claude returned non-JSON response", raw: raw.slice(0, 500) },
      { status: 502 },
    );
  }

  return NextResponse.json({ subject: parsed.subject.trim(), body: parsed.body });
}

function safeParseJson(s: string): { subject?: unknown; body?: unknown } | null {
  const tryParse = (x: string) => {
    try {
      return JSON.parse(x);
    } catch {
      return null;
    }
  };
  const direct = tryParse(s);
  if (direct) return direct;
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  return tryParse(m[0]);
}
