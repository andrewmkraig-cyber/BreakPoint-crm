"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  createInvoiceForPlacement,
  deleteInvoice,
  markInvoicePaid,
  markInvoiceSent,
  markInvoiceVoid,
  restoreInvoiceToDraft,
  nextInvoiceNumber,
  type InvoiceContact,
  type InvoicePaymentMethod,
} from "@/lib/invoices";

async function requireUserId(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  const email = s?.user?.email;
  if (!email) return null;
  if (s.user.id) return s.user.id;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return user?.id ?? null;
}

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function fail(error: string): Result<never> {
  return { ok: false, error } as Result<never>;
}

function sanitizeContacts(raw: unknown): InvoiceContact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const obj = row as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      const email = typeof obj.email === "string" ? obj.email.trim() : "";
      const title = typeof obj.title === "string" ? obj.title.trim() : "";
      if (!name && !email) return null;
      return { name, email, ...(title ? { title } : {}) } as InvoiceContact;
    })
    .filter((x): x is InvoiceContact => x !== null);
}

export async function createInvoiceFromPlacementAction(placementId: string): Promise<Result<{ id: string }>> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  const org = await getCurrentOrg();
  try {
    const result = await createInvoiceForPlacement({ placementId, organizationId: org.id });
    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    return ok({ id: result.id });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to create invoice");
  }
}

export type CreateDraftInvoiceInput = {
  roleTitle?: string | null;
  startDate?: string | null;
  feeAmount?: string | null;
  paymentTerms?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  candidateId?: string | null;
  clientId?: string | null;
  // Optional link back to the originating placement. The New Invoice
  // editor leaves this unset (null); programmatic callers (e.g. the
  // custom-installment trigger on Confirm Start) pass it so the draft is
  // tied to its placement like createInvoiceForPlacement's invoices are.
  placementId?: string | null;
  billingContacts?: unknown;
  hiringContacts?: unknown;
  sendFromAlias?: string | null;
  // Marks a pre-staged installment 2/3 draft so it lands in the
  // Future Invoices section on /finances instead of the main list.
  // Defaults to false. Used by the Confirm Start custom-payment trigger.
  isFuture?: boolean;
};

// Creates a DRAFT invoice from the editor's field values. This is the ONLY
// path that writes a new invoice row from the "New Invoice" flow, and it
// fires only on an explicit Save draft / Mark as sent click — opening the
// blank editor and cancelling never reaches here, so no orphan drafts. The
// invoice number is assigned here via the same nextInvoiceNumber sequence
// used everywhere else (max existing + 1); deferring creation to save-time
// leaves that logic untouched.
export async function createDraftInvoiceAction(
  input: CreateDraftInvoiceInput = {},
): Promise<Result<{ id: string }>> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  const org = await getCurrentOrg();
  try {
    const invoiceNumber = await nextInvoiceNumber(org.id);
    const today = new Date();
    const defaultDue = new Date(today);
    defaultDue.setDate(defaultDue.getDate() + 30);
    const feeCleaned = (input.feeAmount ?? "").toString().replace(/[,$\s]/g, "").trim();
    const created = await prisma.invoice.create({
      data: {
        organizationId: org.id,
        invoiceNumber,
        clientId: input.clientId ?? null,
        candidateId: input.candidateId ?? null,
        placementId: input.placementId ?? null,
        roleTitle: input.roleTitle?.trim() || null,
        startDate: input.startDate ? new Date(input.startDate) : today,
        dueDate: input.dueDate ? new Date(input.dueDate) : defaultDue,
        feeAmount: feeCleaned ? new Prisma.Decimal(feeCleaned) : null,
        paymentTerms: input.paymentTerms?.trim() || "Net 30",
        notes: input.notes?.trim() || null,
        billingContacts: sanitizeContacts(input.billingContacts) as unknown as Prisma.InputJsonValue,
        hiringContacts: sanitizeContacts(input.hiringContacts) as unknown as Prisma.InputJsonValue,
        sendFromAlias: input.sendFromAlias?.trim() || null,
        status: "DRAFT",
        isFuture: input.isFuture === true,
      },
      select: { id: true },
    });
    revalidatePath("/invoices");
    return ok({ id: created.id });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to create invoice");
  }
}

export type UpdateInvoiceInput = {
  id: string;
  roleTitle?: string | null;
  startDate?: string | null;
  feeAmount?: string | null;
  paymentTerms?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  candidateId?: string | null;
  clientId?: string | null;
  billingContacts?: unknown;
  hiringContacts?: unknown;
};

export async function updateInvoiceAction(input: UpdateInvoiceInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  const org = await getCurrentOrg();
  try {
    const existing = await prisma.invoice.findFirst({
      where: { id: input.id, organizationId: org.id },
      select: { id: true, status: true },
    });
    if (!existing) return fail("Invoice not found");
    if (existing.status !== "DRAFT") return fail("Only drafts can be edited");

    const data: Prisma.InvoiceUpdateInput = {};
    if (input.roleTitle !== undefined) data.roleTitle = input.roleTitle?.trim() || null;
    if (input.startDate !== undefined) {
      data.startDate = input.startDate ? new Date(input.startDate) : null;
    }
    if (input.feeAmount !== undefined) {
      const cleaned = (input.feeAmount ?? "").toString().replace(/[,$\s]/g, "").trim();
      data.feeAmount = cleaned ? new Prisma.Decimal(cleaned) : null;
    }
    if (input.paymentTerms !== undefined) {
      data.paymentTerms = input.paymentTerms?.trim() || "Net 30";
    }
    if (input.dueDate !== undefined) {
      data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    }
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    if (input.candidateId !== undefined) {
      data.candidate = input.candidateId
        ? { connect: { id: input.candidateId } }
        : { disconnect: true };
    }
    if (input.clientId !== undefined) {
      data.client = input.clientId
        ? { connect: { id: input.clientId } }
        : { disconnect: true };
    }
    if (input.billingContacts !== undefined) {
      data.billingContacts = sanitizeContacts(input.billingContacts) as unknown as Prisma.InputJsonValue;
    }
    if (input.hiringContacts !== undefined) {
      data.hiringContacts = sanitizeContacts(input.hiringContacts) as unknown as Prisma.InputJsonValue;
    }

    await prisma.invoice.update({ where: { id: existing.id }, data });
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${existing.id}`);
    return ok(undefined);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update invoice");
  }
}

// Persists the "Send mail as" alias the invoice should go out from.
// Allowed on every status (not just DRAFT) — recruiter may want to set
// the From for a re-send of an already-sent invoice. Empty string /
// null clears the override so the next send falls back to the billing
// AR email or the Gmail primary.
export async function updateInvoiceSendFromAliasAction(
  id: string,
  alias: string | null,
): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  const org = await getCurrentOrg();
  try {
    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: org.id },
      select: { id: true },
    });
    if (!existing) return fail("Invoice not found");
    const value = alias?.trim() || null;
    await prisma.invoice.update({
      where: { id: existing.id },
      data: { sendFromAlias: value },
    });
    revalidatePath(`/invoices/${existing.id}`);
    return ok(undefined);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update From alias");
  }
}

export async function markInvoiceSentAction(id: string): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  const org = await getCurrentOrg();
  try {
    await markInvoiceSent(id, org.id, userId);
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/dashboard");
    return ok(undefined);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to mark sent");
  }
}

export async function markInvoicePaidAction(
  id: string,
  paymentMethod: InvoicePaymentMethod,
): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  if (paymentMethod !== "CHECK" && paymentMethod !== "ACH" && paymentMethod !== "CREDIT") {
    return fail("Pick a payment method");
  }
  const org = await getCurrentOrg();
  try {
    await markInvoicePaid(id, org.id, userId, paymentMethod);
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/dashboard");
    return ok(undefined);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to mark paid");
  }
}

export async function markInvoiceVoidAction(id: string): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  const org = await getCurrentOrg();
  try {
    await markInvoiceVoid(id, org.id, userId);
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/dashboard");
    return ok(undefined);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to void");
  }
}

export async function restoreInvoiceDraftAction(id: string): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  const org = await getCurrentOrg();
  try {
    await restoreInvoiceToDraft(id, org.id);
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
    return ok(undefined);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to restore");
  }
}

export async function deleteInvoiceAction(id: string): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  const org = await getCurrentOrg();
  try {
    await deleteInvoice(id, org.id);
    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    return ok(undefined);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to delete");
  }
}

// Spawns a fully-populated DRAFT invoice matching the design canvas
// (Miles Atchison · tsaADVET · Senior Accountant · $7,500 · Net 14)
// with both billing + hiring contacts pointed at Andrew's inbox so the
// Draft Email preview lands in his own mailbox. The demo Candidate +
// Client are find-or-created (idempotent) so re-running this from the
// dashboard doesn't stack duplicate Miles/tsaADVET rows; the Invoice
// row itself is created fresh every click.
export async function createTestInvoice(): Promise<Result<{ id: string }>> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  const org = await getCurrentOrg();
  try {
    const TEST_CANDIDATE_EMAIL = "test-miles-atchison@ace.test";
    const TEST_CLIENT_NAME = "tsaADVET";
    const TEST_RECIPIENT_EMAIL = "andrew@breakpointtalent.com";

    let candidate = await prisma.candidate.findUnique({
      where: { email: TEST_CANDIDATE_EMAIL },
      select: { id: true },
    });
    if (!candidate) {
      candidate = await prisma.candidate.create({
        data: {
          firstName: "Miles",
          lastName: "Atchison",
          email: TEST_CANDIDATE_EMAIL,
          currentDesignation: "Senior Accountant",
          tags: ["test-invoice"],
          createdById: userId,
          organizationId: org.id,
        },
        select: { id: true },
      });
    }

    let client = await prisma.client.findFirst({
      where: { organizationId: org.id, name: TEST_CLIENT_NAME },
      select: { id: true },
    });
    if (!client) {
      client = await prisma.client.create({
        data: {
          name: TEST_CLIENT_NAME,
          tags: ["test-invoice"],
          organizationId: org.id,
        },
        select: { id: true },
      });
    }

    const invoiceNumber = await nextInvoiceNumber(org.id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 14);

    const billingContacts: InvoiceContact[] = [
      { name: "Renee Pratt", title: "AP Lead", email: TEST_RECIPIENT_EMAIL },
    ];
    const hiringContacts: InvoiceContact[] = [
      { name: "Andrea Symroth", title: "VP Finance", email: TEST_RECIPIENT_EMAIL },
    ];

    const created = await prisma.invoice.create({
      data: {
        organizationId: org.id,
        invoiceNumber,
        candidateId: candidate.id,
        clientId: client.id,
        roleTitle: "Senior Accountant",
        startDate: today,
        feeAmount: new Prisma.Decimal("7500.00"),
        // Snapshot the canvas values directly — the test invoice has
        // no linked Placement, so without these the Base Salary / Fee%
        // tiles render "—" instead of $150,000 / 20%.
        baseSalary: new Prisma.Decimal("150000"),
        feePercentage: new Prisma.Decimal("20"),
        paymentTerms: "Net 14",
        dueDate,
        billingContacts: billingContacts as unknown as Prisma.InputJsonValue,
        hiringContacts: hiringContacts as unknown as Prisma.InputJsonValue,
        status: "DRAFT",
        notes: "Test invoice. Generated from the /invoices header.",
      },
      select: { id: true },
    });

    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    return ok({ id: created.id });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to create test invoice");
  }
}
