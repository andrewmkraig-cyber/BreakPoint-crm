import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  getThreadReplyHeaders,
  sendGmail,
  tagThreadByAddresses,
  type GmailAttachment,
} from "@/lib/gmail";
import { ensureEmailHtmlWrapped } from "@/lib/email-html";

export const dynamic = "force-dynamic";
// Inbound reply payloads can include attachments (PDF, DOCX, images)
// base64-encoded alongside the body. Bump the route's body size cap up
// to a generous 25MB so typical resume/benefits/deck attachments go
// through without a 413.
export const maxDuration = 60;

type ReplyPayload = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  // Selected "Send mail as" alias from the composer's From dropdown.
  // Falls back to the primary user.email when absent.
  sendAsEmail?: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    // base64 (standard, not base64url) — the client encodes File bytes
    // via FileReader.readAsDataURL and strips the "data:...;base64," prefix.
    dataBase64: string;
  }>;
};

// Strips tags for a plain-text alternative. Email clients still pick
// the HTML part when offered; the plain part is the fallback.
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, name: true },
  });
  if (!user?.email) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  let payload: ReplyPayload;
  try {
    payload = (await req.json()) as ReplyPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.to || payload.to.length === 0) {
    return NextResponse.json({ error: "At least one recipient required" }, { status: 400 });
  }
  if (!payload.subject) {
    return NextResponse.json({ error: "Subject required" }, { status: 400 });
  }

  // Pull the standard threading headers so external clients (Apple
  // Mail, Outlook) also thread the reply correctly. Gmail-internal
  // threading relies on threadId alone, but we send both anyway.
  const { messageId, references } = await getThreadReplyHeaders(user.id, params.id);

  const attachments: GmailAttachment[] | undefined = payload.attachments?.map((a) => ({
    filename: a.filename,
    mimeType: a.mimeType,
    data: Uint8Array.from(Buffer.from(a.dataBase64, "base64")),
  }));

  const bodyText = payload.bodyText ?? htmlToPlainText(payload.bodyHtml);
  const bodyHtml = ensureEmailHtmlWrapped(payload.bodyHtml);

  try {
    const fromAddress = payload.sendAsEmail?.trim() || user.email;
    const sent = await sendGmail({
      userId: user.id,
      from: fromAddress,
      fromName: user.name ?? undefined,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      bodyHtml,
      bodyText,
      threadId: params.id,
      inReplyTo: messageId ?? undefined,
      references: references ?? undefined,
      attachments,
    });
    // Auto-tag the thread to any candidate/client whose address
    // appears in To/CC. Idempotent; a failure here must not 502 a
    // successful reply.
    try {
      const org = await getCurrentOrg();
      await tagThreadByAddresses({
        threadId: sent.threadId,
        addresses: [...payload.to, ...(payload.cc ?? [])],
        organizationId: org.id,
      });
    } catch (tagErr) {
      console.warn("[mail/reply] auto-tag failed", tagErr);
    }

    return NextResponse.json({ ok: true, messageId: sent.id, threadId: sent.threadId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
