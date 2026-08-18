import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { StoredAttachment } from "@/lib/scheduled-email";

export const INVOICE_SCHEDULED_EMAIL_SOURCE_PREFIX = "invoice:";

export type InvoiceEmailDraftSnapshot = {
  kind: "invoice_draft" | "scheduled_email";
  id: string;
  invoiceId: string;
  gmailDraftId: string | null;
  gmailThreadId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  threadId: string | null;
  sendAsEmail: string | null;
  attachments: StoredAttachment[];
  scheduledSendAt: Date | null;
};

export function invoiceScheduledEmailSource(invoiceId: string): string {
  return `${INVOICE_SCHEDULED_EMAIL_SOURCE_PREFIX}${invoiceId}`;
}

export function invoiceIdFromScheduledEmailSource(source: string | null | undefined): string | null {
  if (!source?.startsWith(INVOICE_SCHEDULED_EMAIL_SOURCE_PREFIX)) return null;
  return source.slice(INVOICE_SCHEDULED_EMAIL_SOURCE_PREFIX.length).trim() || null;
}

export function extractInvoiceNumberFromSubject(subject: string): string | null {
  const match = subject.match(/\bINV[-\s]?\d+\b/i);
  const digits = match?.[0].match(/\d+/)?.[0];
  return digits ? `INV-${digits}` : null;
}

export function normalizeStoredAttachments(raw: unknown): StoredAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const obj = value as Record<string, unknown>;
      const filename = typeof obj.filename === "string" ? obj.filename.trim() : "";
      const mimeType = typeof obj.mimeType === "string" ? obj.mimeType.trim() : "";
      const dataBase64 = typeof obj.dataBase64 === "string" ? obj.dataBase64 : "";
      if (!filename || !mimeType || !dataBase64) return null;
      return { filename, mimeType, dataBase64 };
    })
    .filter((value): value is StoredAttachment => value !== null);
}

function attachmentJson(attachments: StoredAttachment[]): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return attachments.length > 0
    ? (attachments.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        dataBase64: a.dataBase64,
      })) as Prisma.InputJsonValue)
    : Prisma.JsonNull;
}

export async function findInvoiceIdFromDraftSubject(params: {
  organizationId: string;
  subject: string;
}): Promise<string | null> {
  const invoiceNumber = extractInvoiceNumberFromSubject(params.subject);
  if (!invoiceNumber) return null;
  const invoice = await prisma.invoice.findUnique({
    where: {
      organizationId_invoiceNumber: {
        organizationId: params.organizationId,
        invoiceNumber,
      },
    },
    select: { id: true },
  });
  return invoice?.id ?? null;
}

export async function upsertInvoiceEmailDraft(params: {
  organizationId: string;
  userId: string;
  invoiceId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  threadId?: string | null;
  sendAsEmail?: string | null;
  attachments?: StoredAttachment[];
  gmailDraftId?: string | null;
  gmailThreadId?: string | null;
}): Promise<{ id: string }> {
  const attachments = normalizeStoredAttachments(params.attachments ?? []);
  return prisma.invoiceEmailDraft.upsert({
    where: {
      invoiceId_userId: {
        invoiceId: params.invoiceId,
        userId: params.userId,
      },
    },
    update: {
      organizationId: params.organizationId,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      bodyHtml: params.bodyHtml,
      bodyText: params.bodyText,
      threadId: params.threadId ?? null,
      sendAsEmail: params.sendAsEmail?.trim() || null,
      attachments: attachmentJson(attachments),
      gmailDraftId: params.gmailDraftId ?? null,
      gmailThreadId: params.gmailThreadId ?? null,
    },
    create: {
      organizationId: params.organizationId,
      userId: params.userId,
      invoiceId: params.invoiceId,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      bodyHtml: params.bodyHtml,
      bodyText: params.bodyText,
      threadId: params.threadId ?? null,
      sendAsEmail: params.sendAsEmail?.trim() || null,
      attachments: attachmentJson(attachments),
      gmailDraftId: params.gmailDraftId ?? null,
      gmailThreadId: params.gmailThreadId ?? null,
    },
    select: { id: true },
  });
}

export async function getInvoiceEmailDraftForInvoice(params: {
  organizationId: string;
  userId: string;
  invoiceId: string;
  invoiceNumber: string;
}): Promise<InvoiceEmailDraftSnapshot | null> {
  const scheduledWhere: Prisma.ScheduledEmailWhereInput = {
    organizationId: params.organizationId,
    userId: params.userId,
    status: "SCHEDULED",
    OR: [{ source: invoiceScheduledEmailSource(params.invoiceId) }],
  };
  if (params.invoiceNumber.trim()) {
    scheduledWhere.OR!.push({
      subject: { contains: params.invoiceNumber.trim(), mode: "insensitive" },
    });
  }

  const [scheduled, draft] = await Promise.all([
    prisma.scheduledEmail.findFirst({
      where: scheduledWhere,
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        to: true,
        cc: true,
        bcc: true,
        subject: true,
        bodyHtml: true,
        bodyText: true,
        threadId: true,
        sendAsEmail: true,
        attachments: true,
        gmailDraftId: true,
        scheduledSendAt: true,
      },
    }),
    prisma.invoiceEmailDraft.findUnique({
      where: {
        invoiceId_userId: {
          invoiceId: params.invoiceId,
          userId: params.userId,
        },
      },
      select: {
        id: true,
        to: true,
        cc: true,
        bcc: true,
        subject: true,
        bodyHtml: true,
        bodyText: true,
        threadId: true,
        sendAsEmail: true,
        attachments: true,
        gmailDraftId: true,
        gmailThreadId: true,
      },
    }),
  ]);

  if (scheduled) {
    return {
      kind: "scheduled_email",
      id: scheduled.id,
      invoiceId: params.invoiceId,
      gmailDraftId: scheduled.gmailDraftId,
      gmailThreadId: null,
      to: scheduled.to,
      cc: scheduled.cc,
      bcc: scheduled.bcc,
      subject: scheduled.subject,
      bodyHtml: scheduled.bodyHtml,
      bodyText: scheduled.bodyText,
      threadId: scheduled.threadId,
      sendAsEmail: scheduled.sendAsEmail,
      attachments: normalizeStoredAttachments(scheduled.attachments),
      scheduledSendAt: scheduled.scheduledSendAt,
    };
  }

  if (!draft) return null;
  return {
    kind: "invoice_draft",
    id: draft.id,
    invoiceId: params.invoiceId,
    gmailDraftId: draft.gmailDraftId,
    gmailThreadId: draft.gmailThreadId,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    bodyHtml: draft.bodyHtml,
    bodyText: draft.bodyText,
    threadId: draft.threadId,
    sendAsEmail: draft.sendAsEmail,
    attachments: normalizeStoredAttachments(draft.attachments),
    scheduledSendAt: null,
  };
}
