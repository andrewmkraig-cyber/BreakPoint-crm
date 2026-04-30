import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createGmailDraft,
  deleteGmailDraft,
  getThreadReplyHeaders,
  type GmailAttachment,
} from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ace 28.0b — Save Draft endpoint for the Mail composer. Mirrors the
// /api/mail/send shape so the client doesn't need a second payload
// type; the only behavioral difference is that we POST to Gmail's
// drafts endpoint instead of sending immediately. The user's
// per-account refresh token (Account row) is the tenant boundary —
// drafts always land in the signed-in user's own Gmail Drafts label.
//
// When `draftId` is supplied, the route deletes the prior draft
// before creating the new one so a recruiter who saves multiple times
// in one session doesn't pile up duplicates in their Drafts label.

type SaveDraftPayload = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  threadId?: string;
  // When present, Gmail's existing draft is deleted before the new one
  // is created — keeps the Drafts label tidy across multiple Save Draft
  // clicks in a single composer session.
  draftId?: string;
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

  let payload: SaveDraftPayload;
  try {
    payload = (await req.json()) as SaveDraftPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!payload.to || payload.to.length === 0) {
    return NextResponse.json(
      { error: "At least one recipient required" },
      { status: 400 },
    );
  }

  let inReplyTo: string | undefined;
  let references: string | undefined;
  if (payload.threadId) {
    try {
      const headers = await getThreadReplyHeaders(user.id, payload.threadId);
      inReplyTo = headers.messageId ?? undefined;
      references = headers.references ?? undefined;
    } catch {
      // Threading headers are nice-to-have for drafts; if Gmail rejects
      // the lookup we still want the draft persisted so the recruiter
      // doesn't lose work.
    }
  }

  const attachments: GmailAttachment[] | undefined = payload.attachments?.map(
    (a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      data: Uint8Array.from(Buffer.from(a.dataBase64, "base64")),
    }),
  );
  const bodyText = payload.bodyText ?? htmlToPlainText(payload.bodyHtml);

  if (payload.draftId) {
    // Best-effort cleanup of the prior draft so multi-Save sessions
    // don't duplicate. Failure here doesn't block the new draft from
    // landing — we log + proceed.
    try {
      await deleteGmailDraft(user.id, payload.draftId);
    } catch (e) {
      console.warn("[mail/drafts] prior-draft delete failed", e);
    }
  }

  try {
    const created = await createGmailDraft({
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
    return NextResponse.json({
      ok: true,
      draftId: created.draftId,
      messageId: created.messageId,
      threadId: created.threadId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save Draft failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
