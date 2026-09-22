"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getBillingSettings } from "@/lib/billing-settings";
import {
  CONSULTING_COMPANIES,
  CONSULTING_INVOICE_SENDER_EMAIL,
  CONSULTING_INVOICE_TO,
  type ConsultingCompanyKey,
  formatConsultingDateLong,
  formatConsultingInvoiceNumber,
  formatConsultingUsd,
  isConsultingCompanyKey,
  isoDateToUtcMidnight,
  nextConsultingInvoiceNumber,
  utcMidnightToIso,
} from "@/lib/consulting-invoices";
import {
  type ConsultingInvoicePdfInput,
  consultingInvoicePdfFilename,
  renderConsultingInvoicePdfBuffer,
} from "@/lib/consulting-invoice-pdf";
import { findVerifiedSendAs } from "@/lib/deals-alias";
import { plainToHtml, sendGmail } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

// Server actions behind the Consulting Invoices section on /invoices:
// create (Generate Consulting Invoice), update (Edit) and delete.
//
// Order of operations on create and on an edit that re-sends, and why:
//   1. validate
//   2. write the consulting_invoices row (the only thing that must succeed)
//   3. render the PDF and email it, in its own try/catch
//
// The email is a NOTIFICATION about a row that already exists. A Gmail
// failure returns emailed:false with the reason and leaves the row in the
// table, so the recruiter can see the number was issued rather than
// reading "failed" and clicking again into a duplicate.
//
// The From is the Accounts Receivable address from Billing settings
// (ar@breakpointtalent.com), the same default the placement invoice page
// picks, sent as a verified "Send mail as" alias through Andrew's Gmail
// (CONSULTING_INVOICE_SENDER_EMAIL), whoever clicked the button. If that
// account cannot send (no token on file) and the signed-in user is someone
// else, their own account is tried next. If the account that sends does
// NOT have AR verified as an alias, the mail goes out from the account's
// own address and the result says so - never a silent fallback, because
// Gmail would otherwise rewrite the From without an error.

type SessionUser = { id: string; email: string; name: string | null };

// From label when the AR alias carries no display name of its own.
const CONSULTING_INVOICE_FROM_NAME = "BreakPoint Talent";

async function requireUser(): Promise<SessionUser | null> {
  const s = await getServerSession(authOptions);
  const email = s?.user?.email;
  if (!email) return null;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!user?.email) return null;
  return { id: user.id, email: user.email, name: user.name };
}

// The editable fields, shared by create and update. Company and number are
// fixed once issued: the number is a per-company sequence, so moving a row
// between companies would leave a hole in one and a clash in the other.
export type ConsultingInvoiceFieldsInput = {
  // Whole US dollars from the masked currency input.
  amount: number;
  // YYYY-MM-DD
  invoiceDate: string;
  dueDate: string;
  // Branzino only. Both or neither.
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
};

export type CreateConsultingInvoiceInput = ConsultingInvoiceFieldsInput & {
  company: string;
};

export type UpdateConsultingInvoiceInput = ConsultingInvoiceFieldsInput & {
  id: string;
  // Re-render the PDF from the saved fields and email it again.
  resend: boolean;
};

export type ConsultingInvoiceSaveResult =
  | {
      ok: true;
      id: string;
      invoiceNumberLabel: string;
      companyName: string;
      // False when no email was attempted (an edit without resend).
      emailAttempted: boolean;
      emailed: boolean;
      sentFrom: string | null;
      sentFromNote: string | null;
      emailError: string | null;
    }
  | { ok: false; error: string };

// Kept as an alias so the existing modal import keeps compiling.
export type CreateConsultingInvoiceResult = ConsultingInvoiceSaveResult;

function fail(error: string): ConsultingInvoiceSaveResult {
  return { ok: false, error };
}

type ParsedFields = {
  amount: number;
  amountDecimal: Prisma.Decimal;
  invoiceDate: Date;
  dueDate: Date;
  servicePeriodStart: Date | null;
  servicePeriodEnd: Date | null;
};

function parseFields(
  company: ConsultingCompanyKey,
  input: ConsultingInvoiceFieldsInput,
): { ok: true; fields: ParsedFields } | { ok: false; error: string } {
  const amount = input.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }
  if (!Number.isInteger(Math.round(amount * 100))) {
    return { ok: false, error: "Enter an amount in dollars and cents." };
  }

  const invoiceDate = isoDateToUtcMidnight((input.invoiceDate ?? "").trim());
  if (!invoiceDate) return { ok: false, error: "Pick an invoice date." };
  const dueDate = isoDateToUtcMidnight((input.dueDate ?? "").trim());
  if (!dueDate) return { ok: false, error: "Pick a due date." };
  if (dueDate < invoiceDate) {
    return { ok: false, error: "The due date cannot be before the invoice date." };
  }

  let servicePeriodStart: Date | null = null;
  let servicePeriodEnd: Date | null = null;
  if (company === "branzino") {
    const startIso = (input.servicePeriodStart ?? "").trim();
    const endIso = (input.servicePeriodEnd ?? "").trim();
    if (startIso || endIso) {
      servicePeriodStart = isoDateToUtcMidnight(startIso);
      servicePeriodEnd = isoDateToUtcMidnight(endIso);
      if (!servicePeriodStart || !servicePeriodEnd) {
        return { ok: false, error: "Enter both service period dates, or leave both blank." };
      }
      if (servicePeriodEnd < servicePeriodStart) {
        return { ok: false, error: "The service period cannot end before it starts." };
      }
    }
  }

  return {
    ok: true,
    fields: {
      amount,
      amountDecimal: new Prisma.Decimal(amount.toFixed(2)),
      invoiceDate,
      dueDate,
      servicePeriodStart,
      servicePeriodEnd,
    },
  };
}

async function resolveSenders(current: SessionUser): Promise<SessionUser[]> {
  const andrew = await prisma.user.findFirst({
    where: { email: CONSULTING_INVOICE_SENDER_EMAIL },
    select: { id: true, email: true, name: true },
  });
  const list: SessionUser[] = [];
  if (andrew?.email) list.push({ id: andrew.id, email: andrew.email, name: andrew.name });
  if (!list.some((s) => s.id === current.id)) list.push(current);
  return list;
}

type EmailOutcome = {
  emailed: boolean;
  // The From header actually used (AR on the happy path).
  sentFrom: string | null;
  // Set when the sending account had no verified AR alias, so the mail
  // went out from that account's own address instead. Surfaced in the
  // toast so nobody assumes it read as AR.
  sentFromNote: string | null;
  emailError: string | null;
};

// Render + send. Never throws: every failure lands in emailError. The row
// this describes already exists, so nothing here may roll it back.
async function emailConsultingInvoice(args: {
  company: ConsultingCompanyKey;
  invoiceNumber: number;
  fields: ParsedFields;
  user: SessionUser;
  // "Attached is ..." on a fresh issue, "Attached is the updated ..." on a
  // re-send so the recipients know this replaces an earlier PDF.
  updated: boolean;
}): Promise<EmailOutcome> {
  const { company, invoiceNumber, fields, user, updated } = args;
  const co = CONSULTING_COMPANIES[company];
  const invoiceNumberLabel = formatConsultingInvoiceNumber(company, invoiceNumber);
  try {
    const pdfInput: ConsultingInvoicePdfInput = {
      company,
      invoiceNumber,
      amountUsd: fields.amount,
      invoiceDate: utcMidnightToIso(fields.invoiceDate),
      dueDate: utcMidnightToIso(fields.dueDate),
      servicePeriodStart: fields.servicePeriodStart
        ? utcMidnightToIso(fields.servicePeriodStart)
        : null,
      servicePeriodEnd: fields.servicePeriodEnd ? utcMidnightToIso(fields.servicePeriodEnd) : null,
    };
    const pdf = await renderConsultingInvoicePdfBuffer(pdfInput);
    const filename = consultingInvoicePdfFilename(pdfInput);

    const numberWord =
      company === "arfie" ? `Invoice ${invoiceNumberLabel}` : `Invoice No. ${invoiceNumberLabel}`;
    const subject = `${co.name} ${numberWord}${updated ? " (updated)" : ""}`;
    const bodyText = [
      "Hi Andrew and Austin,",
      "",
      `Attached is ${updated ? "the updated " : ""}${co.name} ${numberWord} for ${formatConsultingUsd(fields.amount)}, dated ${formatConsultingDateLong(pdfInput.invoiceDate)}. Payment is due upon receipt.${updated ? " This replaces the earlier copy." : ""}`,
      "",
      "Generated from Ace.",
    ].join("\n");

    const arEmail = (await getBillingSettings()).arEmail.trim();
    const senders = await resolveSenders(user);
    const errors: string[] = [];
    for (const sender of senders) {
      // Verified alias on THIS account, or the account's own address with
      // a note. Checked per account because each Gmail keeps its own list.
      const alias = arEmail ? await findVerifiedSendAs(sender.id, arEmail) : null;
      const from = alias?.sendAsEmail ?? sender.email;
      const fromName = alias
        ? alias.displayName || CONSULTING_INVOICE_FROM_NAME
        : (sender.name ?? undefined);
      const sentFromNote =
        alias || !arEmail
          ? null
          : `${arEmail} is not a verified "Send mail as" on ${sender.email}'s Gmail, so it went out from ${sender.email}.`;
      try {
        await sendGmail({
          userId: sender.id,
          from,
          fromName,
          to: [...CONSULTING_INVOICE_TO],
          cc: [co.ccEmail],
          subject,
          bodyText,
          bodyHtml: plainToHtml(bodyText),
          attachments: [{ filename, mimeType: "application/pdf", data: pdf }],
        });
        return { emailed: true, sentFrom: from, sentFromNote, emailError: null };
      } catch (e) {
        errors.push(`${sender.email}: ${e instanceof Error ? e.message : "send failed"}`);
      }
    }
    return {
      emailed: false,
      sentFrom: null,
      sentFromNote: null,
      emailError: errors.join(" / ") || "No sender account available",
    };
  } catch (e) {
    return {
      emailed: false,
      sentFrom: null,
      sentFromNote: null,
      emailError: e instanceof Error ? e.message : "Could not build the PDF",
    };
  }
}

// The email went out; a failed stamp is not worth reporting as a failure.
// The row still shows in the table without the sent mark.
async function stampEmailed(id: string, sentFrom: string | null): Promise<void> {
  try {
    await prisma.consultingInvoice.update({
      where: { id },
      data: { emailedAt: new Date(), emailedFrom: sentFrom },
    });
    revalidatePath("/invoices");
  } catch {
    // see above
  }
}

export async function createConsultingInvoice(
  input: CreateConsultingInvoiceInput,
): Promise<ConsultingInvoiceSaveResult> {
  const user = await requireUser();
  if (!user) return fail("Not signed in");

  // Tenant comes from the session, never from the caller. Rule 8.
  const org = await getCurrentOrg();

  if (!isConsultingCompanyKey(input.company)) return fail("Pick a company.");
  const company = input.company;
  const co = CONSULTING_COMPANIES[company];

  const parsed = parseFields(company, input);
  if (!parsed.ok) return fail(parsed.error);
  const { fields } = parsed;

  // Issue the number and write the row. A concurrent click for the same
  // company lands on the unique key; re-read the max once and try again.
  let created: { id: string; invoiceNumber: number } | null = null;
  for (let attempt = 0; attempt < 2 && !created; attempt += 1) {
    const invoiceNumber = await nextConsultingInvoiceNumber(org.id, company);
    try {
      created = await prisma.consultingInvoice.create({
        data: {
          organizationId: org.id,
          company,
          invoiceNumber,
          amount: fields.amountDecimal,
          invoiceDate: fields.invoiceDate,
          dueDate: fields.dueDate,
          servicePeriodStart: fields.servicePeriodStart,
          servicePeriodEnd: fields.servicePeriodEnd,
          createdByUserId: user.id,
        },
        select: { id: true, invoiceNumber: true },
      });
    } catch (e) {
      const isUniqueClash =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!isUniqueClash || attempt === 1) {
        return fail(e instanceof Error ? e.message : "Failed to save the invoice");
      }
    }
  }
  if (!created) return fail("Failed to save the invoice");

  revalidatePath("/invoices");

  // From here on the row exists. Nothing below may throw out of the action.
  const outcome = await emailConsultingInvoice({
    company,
    invoiceNumber: created.invoiceNumber,
    fields,
    user,
    updated: false,
  });
  if (outcome.emailed) await stampEmailed(created.id, outcome.sentFrom);

  return {
    ok: true,
    id: created.id,
    invoiceNumberLabel: formatConsultingInvoiceNumber(company, created.invoiceNumber),
    companyName: co.name,
    emailAttempted: true,
    ...outcome,
  };
}

// Edit an issued invoice's amount, dates and (Branzino) service period.
// Company and number never change. With resend the corrected PDF goes out
// to the same recipients, after the row is saved, under the same
// row-first / notification-second rule as create.
export async function updateConsultingInvoice(
  input: UpdateConsultingInvoiceInput,
): Promise<ConsultingInvoiceSaveResult> {
  const user = await requireUser();
  if (!user) return fail("Not signed in");
  const org = await getCurrentOrg();

  const id = (input.id ?? "").trim();
  if (!id) return fail("Missing invoice.");

  // Scoped by organizationId (Rule 8) so an id from another tenant is
  // simply not found.
  const existing = await prisma.consultingInvoice.findFirst({
    where: { id, organizationId: org.id },
    select: { id: true, company: true, invoiceNumber: true },
  });
  if (!existing || !isConsultingCompanyKey(existing.company)) {
    return fail("That invoice no longer exists.");
  }
  const company = existing.company;
  const co = CONSULTING_COMPANIES[company];

  const parsed = parseFields(company, input);
  if (!parsed.ok) return fail(parsed.error);
  const { fields } = parsed;

  try {
    await prisma.consultingInvoice.update({
      where: { id: existing.id },
      data: {
        amount: fields.amountDecimal,
        invoiceDate: fields.invoiceDate,
        dueDate: fields.dueDate,
        servicePeriodStart: fields.servicePeriodStart,
        servicePeriodEnd: fields.servicePeriodEnd,
      },
      select: { id: true },
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to save the invoice");
  }
  revalidatePath("/invoices");

  const invoiceNumberLabel = formatConsultingInvoiceNumber(company, existing.invoiceNumber);
  if (!input.resend) {
    return {
      ok: true,
      id: existing.id,
      invoiceNumberLabel,
      companyName: co.name,
      emailAttempted: false,
      emailed: false,
      sentFrom: null,
      sentFromNote: null,
      emailError: null,
    };
  }

  const outcome = await emailConsultingInvoice({
    company,
    invoiceNumber: existing.invoiceNumber,
    fields,
    user,
    updated: true,
  });
  if (outcome.emailed) await stampEmailed(existing.id, outcome.sentFrom);

  return {
    ok: true,
    id: existing.id,
    invoiceNumberLabel,
    companyName: co.name,
    emailAttempted: true,
    ...outcome,
  };
}

export type DeleteConsultingInvoiceResult =
  | { ok: true; invoiceNumberLabel: string; companyName: string }
  | { ok: false; error: string };

// Removes the row. No email goes out: the PDF already sent cannot be
// recalled, and the recruiter says so themselves if it matters. Deleting
// the latest number frees it, so the next Generate reissues it; deleting
// an older one leaves a gap on purpose (the number was used).
export async function deleteConsultingInvoice(
  idInput: string,
): Promise<DeleteConsultingInvoiceResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const org = await getCurrentOrg();

  const id = (idInput ?? "").trim();
  if (!id) return { ok: false, error: "Missing invoice." };

  const existing = await prisma.consultingInvoice.findFirst({
    where: { id, organizationId: org.id },
    select: { id: true, company: true, invoiceNumber: true },
  });
  if (!existing || !isConsultingCompanyKey(existing.company)) {
    return { ok: false, error: "That invoice no longer exists." };
  }

  try {
    // deleteMany with the org in the where so the tenant scope is on the
    // write itself, not only on the read above.
    await prisma.consultingInvoice.deleteMany({
      where: { id: existing.id, organizationId: org.id },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete the invoice" };
  }
  revalidatePath("/invoices");

  return {
    ok: true,
    invoiceNumberLabel: formatConsultingInvoiceNumber(existing.company, existing.invoiceNumber),
    companyName: CONSULTING_COMPANIES[existing.company].name,
  };
}
