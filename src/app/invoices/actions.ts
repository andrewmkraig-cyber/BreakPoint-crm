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

export type CreateBlankInvoiceInput = {
  clientId?: string | null;
  candidateId?: string | null;
};

export async function createBlankInvoiceAction(
  input: CreateBlankInvoiceInput = {},
): Promise<Result<{ id: string }>> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  const org = await getCurrentOrg();
  try {
    const invoiceNumber = await nextInvoiceNumber(org.id);
    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 30);
    const created = await prisma.invoice.create({
      data: {
        organizationId: org.id,
        invoiceNumber,
        clientId: input.clientId ?? null,
        candidateId: input.candidateId ?? null,
        startDate: today,
        paymentTerms: "Net 30",
        dueDate,
        billingContacts: [] as unknown as Prisma.InputJsonValue,
        hiringContacts: [] as unknown as Prisma.InputJsonValue,
        status: "DRAFT",
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

export async function markInvoicePaidAction(id: string): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");
  const org = await getCurrentOrg();
  try {
    await markInvoicePaid(id, org.id, userId);
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
