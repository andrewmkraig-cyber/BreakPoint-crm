import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  createGmailDraft,
  getThreadReplyHeaders,
  sendGmail,
  tagThreadByAddresses,
  type GmailAttachment,
} from "@/lib/gmail";
import { ensureEmailHtmlWrapped } from "@/lib/email-html";

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
  // Selected "Send mail as" alias from the composer's From dropdown.
  // Must be a verified sendAs on the user's Gmail account; falls back
  // to the primary user.email when absent.
  sendAsEmail?: string;
  // When the composer picked an EmailTemplate for this draft, its id
  // travels with the payload so we can honor the per-template
  // "Approve before sending" flag (EmailTemplate.sendAsDraft). When
  // true we divert the send to Gmail Drafts instead of calling
  // messages.send. Omitted for blank composers / AI-compose drafts /
  // any other path with no template lineage.
  templateId?: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    dataBase64: string;
  }>;
};

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
  // Wrap the composer's raw editor HTML in the shared email container so New
  // Email and Reply (both the MailComposer) send with the SAME Arial / 14px /
  // line-height:1.55 spacing as the submittal path — the three composers'
  // Tiptap editors already agree, the divergence was that this route shipped
  // bodyHtml unwrapped. Guarded against double-wrapping. Plain text is derived
  // above from the unwrapped body, so the container never leaks into it.
  const wrappedBodyHtml = ensureEmailHtmlWrapped(payload.bodyHtml);

  // Per-template "Approve before sending" override. When the picked
  // template has sendAsDraft=true, divert this send to Gmail Drafts
  // instead of messages.send so the recruiter can review before it
  // actually goes out. A missing/deleted templateId silently falls
  // through to the normal send path — the toggle is opt-in.
  let asDraft = false;
  if (payload.templateId) {
    const tpl = await prisma.emailTemplate.findUnique({
      where: { id: payload.templateId },
      select: { sendAsDraft: true },
    });
    asDraft = tpl?.sendAsDraft ?? false;
  }

  try {
    const fromAddress = payload.sendAsEmail?.trim() || user.email;
    if (asDraft) {
      // Drafts share the same MIME/threading plumbing as send; we just
      // POST to /drafts instead of /messages/send. No auto-tagging —
      // tagThreadByAddresses runs on send (when a real message lands
      // in Sent), not on draft creation.
      const drafted = await createGmailDraft({
        userId: user.id,
        from: fromAddress,
        fromName: user.name ?? undefined,
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        subject: payload.subject,
        bodyHtml: wrappedBodyHtml,
        bodyText,
        threadId: payload.threadId,
        inReplyTo,
        references,
        attachments,
      });
      return NextResponse.json({
        ok: true,
        asDraft: true,
        draftId: drafted.draftId,
        messageId: drafted.messageId,
        threadId: drafted.threadId,
      });
    }

    const sent = await sendGmail({
      userId: user.id,
      from: fromAddress,
      fromName: user.name ?? undefined,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      bodyHtml: wrappedBodyHtml,
      bodyText,
      threadId: payload.threadId,
      inReplyTo,
      references,
      attachments,
    });
    // Auto-tag the resulting thread to any candidate/client whose
    // address appears in To/CC. Idempotent; failure must not 502 a
    // successful send.
    try {
      const org = await getCurrentOrg();
      await tagThreadByAddresses({
        threadId: sent.threadId,
        addresses: [...payload.to, ...(payload.cc ?? [])],
        organizationId: org.id,
      });
    } catch (tagErr) {
      console.warn("[mail/send] auto-tag failed", tagErr);
    }

    return NextResponse.json({ ok: true, messageId: sent.id, threadId: sent.threadId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
