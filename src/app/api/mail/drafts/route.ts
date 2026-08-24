import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  findInvoiceIdFromDraftSubject,
  invoiceIdFromScheduledEmailSource,
  invoiceScheduledEmailSource,
  normalizeStoredAttachments,
  upsertInvoiceEmailDraft,
} from "@/lib/invoice-email-drafts";
import { prisma } from "@/lib/prisma";
import {
  createGmailDraft,
  deleteGmailDraft,
  getThreadReplyHeaders,
  type GmailAttachment,
} from "@/lib/gmail";
import { ensureEmailHtmlWrapped } from "@/lib/email-html";

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
  // Selected "Send mail as" alias from the composer's From dropdown.
  // Persisted into the draft's From header so Send-from-Gmail keeps
  // the recruiter's alias choice.
  sendAsEmail?: string;
  // Optional lineage for composer launches from /invoices/[id].
  // Lets Save Draft update the invoice's Ace-side draft payload too,
  // so reopening the same invoice does not regenerate stale template text.
  invoiceId?: string;
  scheduledEmailId?: string;
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

  let payload: SaveDraftPayload;
  try {
    payload = (await req.json()) as SaveDraftPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const to = (payload.to ?? []).map((email) => email.trim()).filter(Boolean);
  if (to.length === 0) {
    return NextResponse.json(
      { error: "At least one recipient required" },
      { status: 400 },
    );
  }
  const cc = (payload.cc ?? []).map((email) => email.trim()).filter(Boolean);
  const bcc = (payload.bcc ?? []).map((email) => email.trim()).filter(Boolean);
  const subject = payload.subject?.trim() || "(no subject)";
  const bodyHtml = payload.bodyHtml ?? "";
  const bodyText = payload.bodyText ?? htmlToPlainText(bodyHtml);
  const wrappedBodyHtml = ensureEmailHtmlWrapped(bodyHtml);
  const storedAttachments = normalizeStoredAttachments(payload.attachments ?? []);

  const org = await getCurrentOrg();
  const payloadInvoiceId = payload.invoiceId?.trim() || null;
  if (payloadInvoiceId) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: payloadInvoiceId, organizationId: org.id },
      select: { id: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
  }

  let linkedInvoiceDraft: {
    id: string;
    invoiceId: string;
    organizationId: string;
  } | null = null;
  let linkedScheduledEmail: {
    id: string;
    organizationId: string;
    source: string | null;
  } | null = null;
  const payloadScheduledEmailId = payload.scheduledEmailId?.trim() || null;
  if (payloadScheduledEmailId) {
    linkedScheduledEmail = await prisma.scheduledEmail.findFirst({
      where: {
        id: payloadScheduledEmailId,
        userId: user.id,
        organizationId: org.id,
        status: "SCHEDULED",
      },
      select: { id: true, organizationId: true, source: true },
    });
    if (!linkedScheduledEmail) {
      return NextResponse.json({ error: "Scheduled email not found" }, { status: 404 });
    }
  }
  if (payload.draftId) {
    const [invoiceDraftForDraftId, scheduledEmailForDraftId] = await Promise.all([
      prisma.invoiceEmailDraft.findFirst({
        where: { userId: user.id, gmailDraftId: payload.draftId },
        select: { id: true, invoiceId: true, organizationId: true },
      }),
      prisma.scheduledEmail.findFirst({
        where: {
          userId: user.id,
          gmailDraftId: payload.draftId,
          status: "SCHEDULED",
        },
        select: { id: true, organizationId: true, source: true },
      }),
    ]);
    linkedInvoiceDraft = invoiceDraftForDraftId;
    linkedScheduledEmail = linkedScheduledEmail ?? scheduledEmailForDraftId;
  }

  const linkedInvoiceId =
    linkedInvoiceDraft?.organizationId === org.id
      ? linkedInvoiceDraft.invoiceId
      : linkedScheduledEmail?.organizationId === org.id
        ? invoiceIdFromScheduledEmailSource(linkedScheduledEmail.source)
        : null;
  if (payloadInvoiceId && linkedInvoiceId && payloadInvoiceId !== linkedInvoiceId) {
    return NextResponse.json(
      { error: "Draft belongs to a different invoice" },
      { status: 409 },
    );
  }
  const invoiceIdForDraft =
    payloadInvoiceId ??
    linkedInvoiceId ??
    (await findInvoiceIdFromDraftSubject({
      organizationId: org.id,
      subject,
    }));

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

  const attachments: GmailAttachment[] | undefined =
    storedAttachments.length > 0
      ? storedAttachments.map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          data: Uint8Array.from(Buffer.from(a.dataBase64, "base64")),
        }))
      : undefined;

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
    const fromAddress = payload.sendAsEmail?.trim() || user.email;
    const created = await createGmailDraft({
      userId: user.id,
      from: fromAddress,
      fromName: user.name ?? undefined,
      to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      subject,
      bodyHtml: wrappedBodyHtml,
      bodyText,
      threadId: payload.threadId,
      inReplyTo,
      references,
      attachments,
    });
    let invoiceEmailDraftId: string | null = null;
    let scheduledEmailId: string | null = null;
    if (linkedScheduledEmail?.organizationId === org.id) {
      await prisma.scheduledEmail.update({
        where: { id: linkedScheduledEmail.id },
        data: {
          to,
          cc,
          bcc,
          subject,
          bodyHtml: wrappedBodyHtml,
          bodyText,
          threadId: payload.threadId ?? null,
          sendAsEmail: payload.sendAsEmail?.trim() || null,
          attachments:
            storedAttachments.length > 0
              ? (storedAttachments as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          gmailDraftId: created.draftId,
          source: invoiceIdForDraft
            ? invoiceScheduledEmailSource(invoiceIdForDraft)
            : linkedScheduledEmail.source,
        },
      });
      scheduledEmailId = linkedScheduledEmail.id;
    } else if (invoiceIdForDraft) {
      const stored = await upsertInvoiceEmailDraft({
        organizationId: org.id,
        userId: user.id,
        invoiceId: invoiceIdForDraft,
        to,
        cc,
        bcc,
        subject,
        bodyHtml: wrappedBodyHtml,
        bodyText,
        threadId: payload.threadId ?? null,
        sendAsEmail: payload.sendAsEmail?.trim() || null,
        attachments: storedAttachments,
        gmailDraftId: created.draftId,
        gmailThreadId: created.threadId,
      });
      invoiceEmailDraftId = stored.id;
    }
    return NextResponse.json({
      ok: true,
      draftId: created.draftId,
      messageId: created.messageId,
      threadId: created.threadId,
      invoiceEmailDraftId,
      scheduledEmailId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save Draft failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
