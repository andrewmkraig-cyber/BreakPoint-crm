import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getThreadReplyHeaders,
  sendGmail,
  type GmailAttachment,
} from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Universal send endpoint for the Mail composer — handles both
// thread-replies (pass `threadId`) and fresh sends (omit it). Used by
// /mail's Reply composer AND by the click-to-email popup that opens
// from candidate / client / job surfaces.
//
// Tenant isolation: the Gmail refresh token is pulled from the
// signed-in user's Account row, so cross-user sends are physically
// impossible. No tenant write happens here — the user's Gmail account
// IS the boundary.

type SendPayload = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  threadId?: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    dataBase64: string;
  }>;
};

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
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

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, name: true },
  });
  if (!user?.email) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  let payload: SendPayload;
  try {
    payload = (await req.json()) as SendPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!payload.to || payload.to.length === 0) {
    return NextResponse.json({ error: "At least one recipient required" }, { status: 400 });
  }
  if (!payload.subject?.trim()) {
    return NextResponse.json({ error: "Subject required" }, { status: 400 });
  }

  let inReplyTo: string | undefined;
  let references: string | undefined;
  if (payload.threadId) {
    // Threaded reply — pull RFC 5322 headers so Apple Mail / Outlook
    // thread the reply too (Gmail itself threads on threadId alone).
    const headers = await getThreadReplyHeaders(user.id, payload.threadId);
    inReplyTo = headers.messageId ?? undefined;
    references = headers.references ?? undefined;
  }

  const attachments: GmailAttachment[] | undefined = payload.attachments?.map((a) => ({
    filename: a.filename,
    mimeType: a.mimeType,
    data: Uint8Array.from(Buffer.from(a.dataBase64, "base64")),
  }));
  const bodyText = payload.bodyText ?? htmlToPlainText(payload.bodyHtml);

  try {
    const sent = await sendGmail({
      userId: user.id,
      from: user.email,
      fromName: user.name ?? undefined,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      bodyHtml: payload.bodyHtml,
      bodyText,
      threadId: payload.threadId,
      inReplyTo,
      references,
      attachments,
    });
    return NextResponse.json({ ok: true, messageId: sent.id, threadId: sent.threadId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
