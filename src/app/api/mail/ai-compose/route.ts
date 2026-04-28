import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CLAUDE_MODEL } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { getGmailThread } from "@/lib/gmail";

export const dynamic = "force-dynamic";
// Claude Opus on a moderate context can take 5–15s. 60s leaves room
// for long replies without tripping Vercel's serverless timeout.
export const maxDuration = 60;

// Writes a first-draft email body for the Mail Tab composer. Takes a
// natural-language prompt ("tell Linda her interview moved to Monday
// and apologize") + optional thread id so Claude has the recent
// exchange as background. Returns HTML suitable for dropping straight
// into the composer body.
//
// We don't persist the generated draft — the user edits it freely
// before hitting Send. The only persistence is the eventual outbound
// Gmail message, which goes through the normal /reply path.

const anthropic = new Anthropic();

type AiComposeRequest = {
  prompt: string;
  threadId?: string;
  // Opt-in: when true, ask Claude to also produce a subject line and
  // return it on the response. The composer wires this up to a small
  // checkbox under the Generate button; off by default since most
  // generations are replies where the existing subject is correct.
  includeSubject?: boolean;
};

type AiComposeResponse =
  | { bodyHtml: string; subject?: string }
  | { error: string };

export async function POST(req: NextRequest): Promise<NextResponse<AiComposeResponse>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, name: true, profile: { select: { fullName: true, jobTitle: true } } },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  let payload: AiComposeRequest;
  try {
    payload = (await req.json()) as AiComposeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const promptText = (payload.prompt ?? "").trim();
  if (!promptText) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  // Pull the thread so Claude has context when this is a reply. If the
  // thread fetch fails (scope, deleted, etc.) we fall back to a
  // no-context generation rather than bailing.
  let threadSummary = "";
  if (payload.threadId) {
    try {
      const detail = await getGmailThread(user.id, payload.threadId);
      const snippets = detail.messages.slice(-4).map((m) => {
        const date = m.dateIso ? new Date(m.dateIso).toLocaleString() : "";
        const plain = stripHtmlTags(m.bodyHtml).slice(0, 1500);
        return `From: ${m.fromName || m.fromEmail}\nDate: ${date}\nSubject: ${m.subject}\n\n${plain}`;
      });
      threadSummary =
        `Email thread context (most recent 4 messages):\n\n${snippets.join("\n\n---\n\n")}`;
    } catch {
      threadSummary = "";
    }
  }

  const senderName = user.profile?.fullName?.trim() || user.name?.trim() || user.email || "";
  const senderTitle = user.profile?.jobTitle?.trim() || "";
  const includeSubject = Boolean(payload.includeSubject);

  // Two prompt variants:
  //  - body-only (default): same instructions as before; return raw
  //    HTML the composer drops into the editor.
  //  - body + subject (opt-in): ask Claude to emit a fenced JSON
  //    object {"subject": "...", "bodyHtml": "..."} so we can split
  //    the two pieces cleanly without regex-parsing free text.
  const system = includeSubject
    ? [
        "You are an email-drafting assistant for a recruiter at BreakPoint Talent.",
        "Write a professional, concise email subject line AND body based on the user's instruction.",
        "Return STRICT JSON only — no prose, no preamble, no markdown fences. Shape: {\"subject\":\"...\",\"bodyHtml\":\"...\"}.",
        "Subject: under 80 characters, no quotation marks, no trailing period.",
        "Body: plain HTML with <p> paragraphs. No <html>/<body> wrapper, no inline styles.",
        "Do NOT write a signature, closing, or 'Best, Andrew' line in the body. The app auto-appends the signature block.",
        "Do NOT include any greeting line like 'Hi [Name],' UNLESS the user's prompt explicitly addresses a specific person by name; even then, keep it short.",
        senderName ? `The sender is ${senderName}${senderTitle ? `, ${senderTitle}` : ""}.` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : [
        "You are an email-drafting assistant for a recruiter at BreakPoint Talent.",
        "Write a professional, concise email body based on the user's instruction.",
        "The recipient and subject are being supplied separately — write ONLY the body text, nothing else.",
        "Do NOT include any greeting line like 'Hi [Name],' UNLESS the user's prompt explicitly addresses a specific person by name; even then, keep it short.",
        "Do NOT write a signature, closing, or 'Best, Andrew' line. The app auto-appends the signature block.",
        "Do NOT include 'Subject:' — the user sets the subject in a separate field.",
        "Write in plain prose with short paragraphs. Use one blank line between paragraphs.",
        "Return the body formatted as plain HTML with <p> paragraphs. No <html>/<body> wrapper, no inline styles.",
        senderName ? `The sender is ${senderName}${senderTitle ? `, ${senderTitle}` : ""}.` : "",
      ]
        .filter(Boolean)
        .join("\n");

  const userMessage = [
    threadSummary,
    threadSummary ? "\n---\n" : "",
    `Instruction: ${promptText}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    const first = response.content[0];
    const raw = first && first.type === "text" ? first.text : "";
    if (!raw) {
      return NextResponse.json({ error: "Claude returned no content" }, { status: 502 });
    }
    if (includeSubject) {
      // Parse the strict-JSON response. Claude occasionally still
      // wraps in ```json fences despite the system prompt, so strip
      // those before parsing. On any parse failure, fall back to
      // returning the raw text as the body — better degraded UX than
      // a hard error toast.
      const parsed = parseSubjectAndBody(raw);
      if (!parsed) {
        return NextResponse.json({ bodyHtml: toSafeHtml(raw) });
      }
      return NextResponse.json({
        subject: parsed.subject,
        bodyHtml: toSafeHtml(parsed.bodyHtml),
      });
    }
    const bodyHtml = toSafeHtml(raw);
    return NextResponse.json({ bodyHtml });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Claude call failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

function parseSubjectAndBody(
  raw: string,
): { subject: string; bodyHtml: string } | null {
  let s = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` wrappers if Claude added them.
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const obj = JSON.parse(s) as { subject?: unknown; bodyHtml?: unknown };
    const subject = typeof obj.subject === "string" ? obj.subject.trim() : "";
    const bodyHtml = typeof obj.bodyHtml === "string" ? obj.bodyHtml : "";
    if (!subject || !bodyHtml) return null;
    return { subject, bodyHtml };
  } catch {
    return null;
  }
}

// Claude sometimes wraps responses in ```html ... ``` fences or
// preambles like "Here's a draft:"; strip those before returning.
function toSafeHtml(raw: string): string {
  let s = raw.trim();
  // Strip markdown code fences.
  s = s.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "");
  // If Claude returned plain text (no <p>), wrap paragraphs ourselves.
  if (!/<\w+[^>]*>/.test(s)) {
    s = s
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br/>")}</p>`)
      .join("");
  }
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
