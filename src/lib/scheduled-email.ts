import "server-only";
import { prisma } from "@/lib/prisma";
import {
  createGmailDraft,
  deleteGmailDraft,
  getThreadReplyHeaders,
  plainToHtml,
  sendGmail,
  tagThreadByAddresses,
  type GmailAttachment,
} from "@/lib/gmail";
import { logActivity } from "@/lib/activity";
import type { ScheduledEmail } from "@prisma/client";

// Shared plumbing for the "Send Later" scheduler. Both the HTTP route
// (/api/mail/schedule) and the server actions (candidate + bulk) create
// rows through createScheduledEmail; the per-minute cron and the Retry
// route both fire rows through fireScheduledEmail. Keeping it in one
// place means the send behavior (Gmail send + draft cleanup + auto-tag +
// activity log) stays identical no matter which surface scheduled it.

export type StoredAttachment = {
  filename: string;
  mimeType: string;
  dataBase64: string;
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

function parseStoredAttachments(json: unknown): StoredAttachment[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (a): a is StoredAttachment =>
      !!a &&
      typeof a === "object" &&
      typeof (a as StoredAttachment).filename === "string" &&
      typeof (a as StoredAttachment).mimeType === "string" &&
      typeof (a as StoredAttachment).dataBase64 === "string",
  );
}

export type CreateScheduledEmailParams = {
  organizationId: string;
  userId: string;
  userEmail: string;
  userName?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  threadId?: string;
  sendAsEmail?: string;
  attachments?: StoredAttachment[];
  scheduledSendAt: Date;
  timezone: string;
  // Single-send surfaces mirror the email into Gmail Drafts so it shows
  // in the Drafts folder until it fires. Bulk skips this (one draft per
  // recipient would flood the label).
  createDraft?: boolean;
  autoTag?: boolean;
  candidateId?: string;
  source?: string;
};

export async function createScheduledEmail(
  params: CreateScheduledEmailParams,
): Promise<{ id: string; gmailDraftId: string | null }> {
  const bodyText = params.bodyText ?? htmlToPlainText(params.bodyHtml);
  const fromAddress = params.sendAsEmail?.trim() || params.userEmail;

  // Mirror to Gmail Drafts (best-effort) so the scheduled email lives in
  // the Drafts folder until the cron fires it. A draft-create failure
  // must not block scheduling — the row is the source of truth.
  let gmailDraftId: string | null = null;
  if (params.createDraft) {
    try {
      let inReplyTo: string | undefined;
      let references: string | undefined;
      if (params.threadId) {
        try {
          const headers = await getThreadReplyHeaders(
            params.userId,
            params.threadId,
          );
          inReplyTo = headers.messageId ?? undefined;
          references = headers.references ?? undefined;
        } catch {
          // Threading headers are nice-to-have on the mirror draft.
        }
      }
      const drafted = await createGmailDraft({
        userId: params.userId,
        from: fromAddress,
        fromName: params.userName ?? undefined,
        to: params.to,
        cc: params.cc,
        bcc: params.bcc,
        subject: params.subject,
        bodyHtml: params.bodyHtml,
        bodyText,
        threadId: params.threadId,
        inReplyTo,
        references,
        attachments: params.attachments?.map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          data: Uint8Array.from(Buffer.from(a.dataBase64, "base64")),
        })),
      });
      gmailDraftId = drafted.draftId;
    } catch (e) {
      console.warn("[scheduled-email] mirror draft create failed", e);
    }
  }

  const row = await prisma.scheduledEmail.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      to: params.to,
      cc: params.cc ?? [],
      bcc: params.bcc ?? [],
      subject: params.subject,
      bodyHtml: params.bodyHtml,
      bodyText,
      threadId: params.threadId ?? null,
      sendAsEmail: params.sendAsEmail?.trim() || null,
      attachments:
        params.attachments && params.attachments.length > 0
          ? (params.attachments as unknown as object[])
          : undefined,
      gmailDraftId,
      scheduledSendAt: params.scheduledSendAt,
      timezone: params.timezone,
      autoTag: params.autoTag ?? true,
      candidateId: params.candidateId ?? null,
      source: params.source ?? null,
    },
    select: { id: true },
  });

  return { id: row.id, gmailDraftId };
}

export type FireResult = { ok: true } | { ok: false; error: string };

// Send one scheduled email. Atomically claims the row (SCHEDULED ->
// SENDING) so an overlapping cron tick can't double-send, then sends via
// the same Gmail path the live composer uses, deletes the mirror draft,
// auto-tags the thread, and records an activity-log row when the email
// is tied to a candidate.
export async function fireScheduledEmail(row: ScheduledEmail): Promise<FireResult> {
  const claimed = await prisma.scheduledEmail.updateMany({
    where: { id: row.id, status: "SCHEDULED" },
    data: { status: "SENDING" },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "Already claimed or no longer scheduled" };
  }

  const user = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { email: true, name: true },
  });
  if (!user?.email) {
    await prisma.scheduledEmail.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        lastError: "Sender account not found",
        attempts: { increment: 1 },
      },
    });
    return { ok: false, error: "Sender account not found" };
  }

  const attachments: GmailAttachment[] | undefined = (() => {
    const stored = parseStoredAttachments(row.attachments);
    if (stored.length === 0) return undefined;
    return stored.map((a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      data: Uint8Array.from(Buffer.from(a.dataBase64, "base64")),
    }));
  })();

  let inReplyTo: string | undefined;
  let references: string | undefined;
  if (row.threadId) {
    try {
      const headers = await getThreadReplyHeaders(row.userId, row.threadId);
      inReplyTo = headers.messageId ?? undefined;
      references = headers.references ?? undefined;
    } catch {
      // External-client threading headers are nice-to-have; Gmail still
      // threads on threadId alone.
    }
  }

  try {
    const sent = await sendGmail({
      userId: row.userId,
      from: row.sendAsEmail?.trim() || user.email,
      fromName: user.name ?? undefined,
      to: row.to,
      cc: row.cc.length > 0 ? row.cc : undefined,
      bcc: row.bcc.length > 0 ? row.bcc : undefined,
      subject: row.subject,
      bodyHtml: row.bodyHtml,
      bodyText: row.bodyText || plainToHtml(row.bodyHtml),
      threadId: row.threadId ?? undefined,
      inReplyTo,
      references,
      attachments,
    });

    // The mirror draft has now been superseded by the real Sent message;
    // delete it so Gmail doesn't leave a duplicate in Drafts.
    if (row.gmailDraftId) {
      try {
        await deleteGmailDraft(row.userId, row.gmailDraftId);
      } catch (e) {
        console.warn("[scheduled-send] mirror draft delete failed", e);
      }
    }

    if (row.autoTag) {
      try {
        await tagThreadByAddresses({
          threadId: sent.threadId,
          addresses: [...row.to, ...row.cc],
          organizationId: row.organizationId,
        });
      } catch (e) {
        console.warn("[scheduled-send] auto-tag failed", e);
      }
    }

    if (row.candidateId) {
      try {
        await logActivity({
          organizationId: row.organizationId,
          userId: row.userId,
          actionType: "email_sent",
          targetType: "candidate",
          targetId: row.candidateId,
          metadata: {
            source: row.source ?? "scheduled_send",
            subject: row.subject,
            recipient: row.to[0] ?? "",
          },
        });
      } catch {
        // Audit write is observability; never fail the send over it.
      }
    }

    await prisma.scheduledEmail.update({
      where: { id: row.id },
      data: {
        status: "SENT",
        sentMessageId: sent.id,
        sentThreadId: sent.threadId,
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed";
    await prisma.scheduledEmail.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        lastError: msg,
        attempts: { increment: 1 },
        failureAcknowledged: false,
      },
    });
    return { ok: false, error: msg };
  }
}
