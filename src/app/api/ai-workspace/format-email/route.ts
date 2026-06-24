import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaude } from "@/lib/claude";
import { MARKDOWN_OUTPUT_FORMAT_RULES } from "@/lib/ai-output-formatting";

// Haiku 4.5 instead of the project-wide Sonnet model. Format-email is a
// pure rewrite — strip recruiter-internal copy, preserve the two
// sections, generate a subject line. Haiku ships in ~3–5s vs Sonnet's
// 30–60s+ on long bubbles, and the recruiter was watching "Preparing…"
// spin for two minutes on the Email this button. Rewrites of this
// shape are well within Haiku's capability; if quality regresses we
// can switch back via this single constant.
const FORMAT_EMAIL_MODEL = "claude-haiku-4-5-20251001";

// Pure rewrite endpoint — no web_search, no candidate context lookup,
// no chat history. Hand it a Game Plan bubble and it returns a clean
// candidate-ready email: short subject + body that opens "Hi <First>,"
// and is stripped of recruiter-internal commentary, meta questions
// ("Want me to draft outreach?"), and Andrew's signoff/signature
// (Gmail appends a real one on send). Triggered when the recruiter
// clicks the "Email this" button in AiWorkspace, so the popup is
// always populated with a sendable subject + body — never the raw
// chat bubble.
//
// 30s budget was too tight on long Game Plan bubbles (5+ specific
// roles + Section 2 with multiple aggregator pointers) — Sonnet
// rewrite was hitting the Vercel function ceiling and the popup
// surfaced "format-email failed (504)". 120s gives Sonnet headroom
// without burning the whole AI Workspace 300s budget.
export const maxDuration = 120;

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
    "candidate-ready email for BreakPoint Talent. Output STRICT JSON only - " +
    "no prose, no markdown fences, no preamble. Shape: " +
    `{ "subject": string, "body": string }. ` +
    "Rules:\n" +
    "- subject: short (<= 70 chars), specific to the message content, written for the candidate (not Andrew).\n" +
    "- body: plain text email starting with `Hi <FirstName>,` then a blank line, then the message.\n" +
    "- Strip everything that was internal-to-Andrew: meta questions like 'Want me to draft outreach?', 'Let me know which interests you', recruiter-side commentary about why the candidate is a fit (the candidate already knows themselves), references to internal call notes, anything addressed at Andrew rather than the candidate.\n" +
    "- End the body with a SHORT signoff line on its own (e.g. `Thanks,` or `Best,` or `Talk soon,`) so the message transitions cleanly into Andrew's auto-appended signature. Choose the closing that fits the tone of the message. Do NOT include Andrew's name, BreakPoint Talent, or any other signature lines after the closing - Ace appends his real signature on send and any extra name lines double-sign the email.\n" +
    "- Strip leading/trailing `---` separators and any 'Here\\'s a clean email...' / 'Ready to copy and send...' framing lines.\n" +
    "- Preserve job listings, links, comp ranges, location notes. Those are the substance the candidate needs.\n" +
    "- NEVER use em dashes anywhere in the subject or body. This is a hard rule. Use a colon, comma, parentheses, or a period plus new sentence instead. Hyphens (`-`) are fine for compound words.\n" +
    "- Never use emojis anywhere in your response. Never.\n" +
    "- Never use em dashes. Use a hyphen (-) instead. Always.\n" +
    "- Preserve the two-section structure if the source has one. Specific role postings (Section 1) and broader job-board search pointers (Section 2: LinkedIn / Indeed / ZipRecruiter etc.) MUST stay visually separated in the email. Use clear bold section headers like `**Open Roles:**` and `**Broader job-board searches to watch:**`. Section 1 stays numbered; Section 2 stays bulleted. Never merge them into one numbered list. The candidate needs to see at a glance which links are pre-vetted specific roles vs. which are 'pages to browse on your own'.\n" +
    MARKDOWN_OUTPUT_FORMAT_RULES +
    "\n" +
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
      model: FORMAT_EMAIL_MODEL,
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

  return NextResponse.json({
    subject: stripEmDashes(parsed.subject.trim()),
    body: stripEmDashes(stripSignatureKeepSignoff(parsed.body)),
  });
}

// Drop em dashes anywhere they appear. Andrew never wants the long
// `—` character in outbound copy — he reads it as ChatGPT-flavored
// writing — so we replace it with a comma + space (which is what the
// model usually meant). En dashes (`–`) get the same treatment for
// consistency. Hyphens (`-`) are left alone since they're valid in
// compound words.
function stripEmDashes(s: string): string {
  return s.replace(/\s*[–—]\s*/g, ", ");
}

// Belt-and-suspenders cleanup for the body the model returns. We KEEP
// any standalone short signoff line (e.g. `Thanks,`) so the message
// transitions cleanly into Andrew's auto-appended Ace signature, but
// we strip the name + company lines below it ("Andrew Kraig" /
// "BreakPoint Talent" / `---` separators) because those would
// double-sign the email. We also rewrite an inline "Best, Andrew Kraig
// BreakPoint Talent" line into just "Best," so the closing survives
// even when the model concatenated the signoff and signature into one
// paragraph.
function stripSignatureKeepSignoff(body: string): string {
  const lines = body.split(/\r?\n/);
  const signatureRe =
    /^(andrew(\s+kraig)?|kraig|breakpoint(\s+talent)?|--+|—+|–+|managing partner.*|founder.*)\s*$/i;
  const inlineSignoffRe =
    /^\s*(thanks|thank you|thank you so much|best|best regards|all the best|regards|cheers|talk soon|warmly|sincerely|kind regards)[,.!]?\s+(andrew|kraig|the bp team|breakpoint)\b.*$/i;

  // Walk back from the end and drop signature/separator lines. Stop
  // once we hit a non-signature line (which is either a real body
  // line or, ideally, the standalone signoff we want to keep).
  let end = lines.length;
  while (end > 0) {
    const t = lines[end - 1].trim();
    if (!t) {
      end--;
      continue;
    }
    if (signatureRe.test(t)) {
      end--;
      continue;
    }
    // Inline "Best, Andrew Kraig BreakPoint Talent" — keep just the
    // signoff portion ("Best,"). Mutate in place and stop walking.
    const inlineMatch = lines[end - 1].match(inlineSignoffRe);
    if (inlineMatch) {
      const closing = inlineMatch[1];
      const punct = lines[end - 1].match(/^\s*[A-Za-z ]+([,.!])/)?.[1] ?? ",";
      lines[end - 1] = `${closing}${punct}`;
      break;
    }
    break;
  }

  return lines.slice(0, end).join("\n").replace(/\s+$/g, "");
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
