import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

// Server-side invoice library — single source of truth for invoice
// lifecycle transitions and the merge data the PDF + email need.
//
// Lifecycle (matches Invoice.status enum):
//   DRAFT    — created locally, not sent. Editable. Auto-created when
//              a placement's start gets confirmed.
//   SENT     — emailed out from Accounts Receivable. Locked.
//   PAID     — Andrew flipped after seeing the bank deposit.
//   VOID     — cancelled out (wrong fee, wrong contact, etc.).
//
// Invoice numbers are workspace-monotonic, 4-digit padded (INV-1051).
// The sequence picks up from the design-anchored starting number 1051
// the first time an org needs one, then monotonically increments.

export type InvoiceContact = {
  name: string;
  email: string;
  title?: string;
};

export const INVOICE_STARTING_NUMBER = 1051;

export function formatInvoiceNumber(num: number | string): string {
  const n = typeof num === "string" ? num : `INV-${String(num).padStart(4, "0")}`;
  return n.startsWith("INV-") ? n : `INV-${String(n).padStart(4, "0")}`;
}

export function parseInvoiceContacts(value: Prisma.JsonValue | null): InvoiceContact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (!v || typeof v !== "object") return null;
      const obj = v as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      const email = typeof obj.email === "string" ? obj.email.trim() : "";
      const title = typeof obj.title === "string" ? obj.title.trim() : undefined;
      if (!name && !email) return null;
      return { name, email, title } as InvoiceContact;
    })
    .filter((x): x is InvoiceContact => x !== null);
}

export async function nextInvoiceNumber(organizationId: string): Promise<string> {
  const rows = await prisma.invoice.findMany({
    where: { organizationId },
    select: { invoiceNumber: true },
  });
  let maxN = INVOICE_STARTING_NUMBER - 1;
  for (const row of rows) {
    const m = row.invoiceNumber.match(/(\d+)/);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    if (!Number.isNaN(n) && n > maxN) maxN = n;
  }
  return formatInvoiceNumber(maxN + 1);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function termsToDays(terms: string | null | undefined): number {
  const match = (terms ?? "").match(/(\d+)/);
  if (!match) return 30;
  const n = parseInt(match[1]!, 10);
  return Number.isFinite(n) ? n : 30;
}

export type CreateFromPlacementInput = {
  placementId: string;
  organizationId: string;
};

export async function createInvoiceForPlacement(
  input: CreateFromPlacementInput,
): Promise<{ id: string; created: boolean }> {
  const placement = await prisma.placement.findUnique({
    where: { id: input.placementId },
    select: {
      id: true,
      organizationId: true,
      candidateId: true,
      clientId: true,
      offerTitle: true,
      expectedStartDate: true,
      feeTotal: true,
      acceptedSalary: true,
      feePercentage: true,
      billingContactName: true,
      billingContactEmail: true,
      billingContacts: true,
      hiringManagerName: true,
      hiringManagerEmail: true,
    },
  });
  if (!placement) throw new Error("Placement not found");
  if (placement.organizationId !== input.organizationId) {
    throw new Error("Placement is not in this organization");
  }

  // Idempotent: if a non-VOID invoice already exists for this placement,
  // return it instead of creating a duplicate. Confirm Start can re-fire
  // (re-upload screenshot, etc.) and we don't want it to stack drafts.
  const existing = await prisma.invoice.findFirst({
    where: {
      placementId: placement.id,
      organizationId: input.organizationId,
      status: { not: "VOID" },
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const invoiceNumber = await nextInvoiceNumber(input.organizationId);
  const issueDate = placement.expectedStartDate ?? new Date();
  const termsString = "Net 30";
  const dueDate = addDays(issueDate, termsToDays(termsString));

  const billingContacts = parseInvoiceContacts(placement.billingContacts);
  if (billingContacts.length === 0 && placement.billingContactEmail) {
    billingContacts.push({
      name: placement.billingContactName ?? "",
      email: placement.billingContactEmail,
    });
  }
  const hiringContacts: InvoiceContact[] = [];
  if (placement.hiringManagerEmail) {
    hiringContacts.push({
      name: placement.hiringManagerName ?? "",
      email: placement.hiringManagerEmail,
    });
  }

  const feeAmount = placement.feeTotal != null
    ? new Prisma.Decimal(placement.feeTotal.toString())
    : null;
  // Snapshot base salary + fee % from the placement so the Invoice row
  // is self-describing. The PDF + detail view read these columns
  // directly (no Placement join), which means downstream edits to the
  // placement after the invoice ships don't quietly rewrite history.
  const baseSalary = placement.acceptedSalary != null
    ? new Prisma.Decimal(placement.acceptedSalary.toString())
    : null;
  const feePercentage = placement.feePercentage != null
    ? new Prisma.Decimal(placement.feePercentage.toString())
    : null;

  const created = await prisma.invoice.create({
    data: {
      organizationId: input.organizationId,
      invoiceNumber,
      placementId: placement.id,
      candidateId: placement.candidateId ?? null,
      clientId: placement.clientId ?? null,
      roleTitle: placement.offerTitle ?? null,
      startDate: placement.expectedStartDate ?? null,
      feeAmount,
      baseSalary,
      feePercentage,
      paymentTerms: termsString,
      dueDate,
      billingContacts: billingContacts as unknown as Prisma.InputJsonValue,
      hiringContacts: hiringContacts as unknown as Prisma.InputJsonValue,
      status: "DRAFT",
    },
    select: { id: true },
  });

  return { id: created.id, created: true };
}

export async function markInvoiceSent(
  id: string,
  organizationId: string,
  userId: string,
): Promise<void> {
  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId },
    select: { id: true, status: true, placementId: true },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status === "SENT" || invoice.status === "PAID") return;
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "SENT", sentAt: new Date() },
  });
  await logActivity({
    organizationId,
    userId,
    actionType: "invoice_sent",
    targetType: "invoice",
    targetId: invoice.id,
    metadata: { placementId: invoice.placementId },
  });
}

export type InvoicePaymentMethod = "CHECK" | "ACH" | "CREDIT";

export async function markInvoicePaid(
  id: string,
  organizationId: string,
  userId: string,
  paymentMethod: InvoicePaymentMethod,
): Promise<void> {
  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId },
    select: { id: true, status: true, placementId: true },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status === "PAID") return;
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "PAID", paidAt: new Date(), paymentMethod },
  });
  if (invoice.placementId) {
    await prisma.placement.update({
      where: { id: invoice.placementId },
      data: { invoicedAt: new Date() },
    });
  }
  await logActivity({
    organizationId,
    userId,
    actionType: "invoice_paid",
    targetType: "invoice",
    targetId: invoice.id,
    metadata: { placementId: invoice.placementId, paymentMethod },
  });
}

export async function markInvoiceVoid(
  id: string,
  organizationId: string,
  userId: string,
): Promise<void> {
  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId },
    select: { id: true, status: true },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status === "VOID") return;
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "VOID" },
  });
  await logActivity({
    organizationId,
    userId,
    actionType: "invoice_voided",
    targetType: "invoice",
    targetId: invoice.id,
  });
}

export async function restoreInvoiceToDraft(
  id: string,
  organizationId: string,
): Promise<void> {
  await prisma.invoice.updateMany({
    where: { id, organizationId },
    data: { status: "DRAFT", sentAt: null, paidAt: null },
  });
}

export async function deleteInvoice(
  id: string,
  organizationId: string,
): Promise<void> {
  await prisma.invoice.deleteMany({
    where: { id, organizationId, status: "DRAFT" },
  });
}

export type InvoiceListFilter = "all" | "drafts" | "sent" | "paid" | "overdue" | "void";

export async function listInvoices(
  organizationId: string,
  filter: InvoiceListFilter = "all",
) {
  const where: Prisma.InvoiceWhereInput = { organizationId };
  const today = new Date();
  if (filter === "drafts") where.status = "DRAFT";
  else if (filter === "sent") where.status = "SENT";
  else if (filter === "paid") where.status = "PAID";
  else if (filter === "void") where.status = "VOID";
  else if (filter === "overdue") {
    where.status = "SENT";
    where.dueDate = { lt: today };
  }
  return prisma.invoice.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      roleTitle: true,
      feeAmount: true,
      paymentTerms: true,
      startDate: true,
      dueDate: true,
      sentAt: true,
      paidAt: true,
      createdAt: true,
      billingContacts: true,
      hiringContacts: true,
      candidate: { select: { id: true, firstName: true, lastName: true } },
      client: { select: { id: true, name: true } },
      placement: { select: { id: true } },
    },
  });
}

export async function getInvoice(id: string, organizationId: string) {
  return prisma.invoice.findFirst({
    where: { id, organizationId },
    include: {
      candidate: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      client: {
        select: { id: true, name: true, domain: true, location: true },
      },
      // Placement is still joined so the PDF can resolve the Account
      // Executive name (placement.createdBy). Base salary + fee % no
      // longer rely on this join — they live on Invoice as snapshot
      // columns and are pulled from the top-level row instead.
      placement: {
        select: {
          id: true,
          expectedStartDate: true,
          offerTitle: true,
          createdById: true,
          createdBy: { select: { name: true, email: true } },
        },
      },
    },
  });
}

export type InvoiceSummary = {
  outstandingCents: number;
  outstandingCount: number;
  overdueCents: number;
  overdueCount: number;
  billedThisQuarterCents: number;
  collectedThisQuarterCents: number;
  draftCount: number;
};

function quarterRange(now: Date): { start: Date; end: Date } {
  const month = now.getMonth();
  const startMonth = Math.floor(month / 3) * 3;
  const start = new Date(now.getFullYear(), startMonth, 1);
  const end = new Date(now.getFullYear(), startMonth + 3, 1);
  return { start, end };
}

function toCents(amount: Prisma.Decimal | null): number {
  if (amount == null) return 0;
  const n = Number(amount.toString());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export async function getInvoiceSummary(organizationId: string): Promise<InvoiceSummary> {
  const now = new Date();
  const { start: qStart, end: qEnd } = quarterRange(now);

  const [outstanding, overdue, billedQ, collectedQ, draftCount] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId, status: "SENT" },
      select: { feeAmount: true },
    }),
    prisma.invoice.findMany({
      where: { organizationId, status: "SENT", dueDate: { lt: now } },
      select: { feeAmount: true },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId,
        status: { in: ["SENT", "PAID"] },
        sentAt: { gte: qStart, lt: qEnd },
      },
      select: { feeAmount: true },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId,
        status: "PAID",
        paidAt: { gte: qStart, lt: qEnd },
      },
      select: { feeAmount: true },
    }),
    prisma.invoice.count({ where: { organizationId, status: "DRAFT" } }),
  ]);

  return {
    outstandingCents: outstanding.reduce((s, r) => s + toCents(r.feeAmount), 0),
    outstandingCount: outstanding.length,
    overdueCents: overdue.reduce((s, r) => s + toCents(r.feeAmount), 0),
    overdueCount: overdue.length,
    billedThisQuarterCents: billedQ.reduce((s, r) => s + toCents(r.feeAmount), 0),
    collectedThisQuarterCents: collectedQ.reduce((s, r) => s + toCents(r.feeAmount), 0),
    draftCount,
  };
}
