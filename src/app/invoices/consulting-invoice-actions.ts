"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  CONSULTING_COMPANIES,
  CONSULTING_INVOICE_SENDER_EMAIL,
  CONSULTING_INVOICE_TO,
  formatConsultingDateLong,
  formatConsultingInvoiceNumber,
  formatConsultingUsd,
  isConsultingCompanyKey,
  isoDateToUtcMidnight,
  nextConsultingInvoiceNumber,
  utcMidnightToIso,
} from "@/lib/consulting-invoices";
import {
  consultingInvoicePdfFilename,
  renderConsultingInvoicePdfBuffer,
} from "@/lib/consulting-invoice-pdf";
import { plainToHtml, sendGmail } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

// Server action behind the Generate Consulting Invoice modal on /invoices.
//
// Order of operations, and why:
//   1. validate + issue the next number for the company
//   2. write the consulting_invoices row (the only thing that must succeed)
//   3. render the PDF and email it, in its own try/catch
//
// The email is a NOTIFICATION about a row that already exists. A Gmail
// failure returns emailed:false with the reason and leaves the invoice in
// the table, so the recruiter can see the number was issued rather than
// reading "failed" and clicking again into a duplicate.
//
// The sender is Andrew's Gmail (CONSULTING_INVOICE_SENDER_EMAIL), the
// account Ace already sends from, whoever clicked the button. If that
// account cannot send (no token on file) and the signed-in user is someone
// else, their own account is tried next and the result says which address
// actually sent - never a silent fallback.

async function requireUser(): Promise<{ id: string; email: string; name: string | null } | null> {
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

export type CreateConsultingInvoiceInput = {
  company: string;
  // Whole US dollars from the masked currency input.
  amount: number;
  // YYYY-MM-DD
  invoiceDate: string;
  dueDate: string;
  // Branzino only. Both or neither.
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
};

export type CreateConsultingInvoiceResult =
  | {
      ok: true;
      id: string;
      invoiceNumberLabel: string;
      companyName: string;
      emailed: boolean;
      sentFrom: string | null;
      emailError: string | null;
    }
  | { ok: false; error: string };

function fail(error: string): CreateConsultingInvoiceResult {
  return { ok: false, error };
}

type SenderCandidate = { id: string; email: string; name: string | null };

async function resolveSenders(current: SenderCandidate): Promise<SenderCandidate[]> {
  const andrew = await prisma.user.findFirst({
    where: { email: CONSULTING_INVOICE_SENDER_EMAIL },
    select: { id: true, email: true, name: true },
  });
  const list: SenderCandidate[] = [];
  if (andrew?.email) list.push({ id: andrew.id, email: andrew.email, name: andrew.name });
  if (!list.some((s) => s.id === current.id)) list.push(current);
  return list;
}

export async function createConsultingInvoice(
  input: CreateConsultingInvoiceInput,
): Promise<CreateConsultingInvoiceResult> {
  const user = await requireUser();
  if (!user) return fail("Not signed in");

  // Tenant comes from the session, never from the caller. Rule 8.
  const org = await getCurrentOrg();

  if (!isConsultingCompanyKey(input.company)) return fail("Pick a company.");
  const company = input.company;
  const co = CONSULTING_COMPANIES[company];

  const amount = input.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return fail("Enter an amount greater than zero.");
  }
  if (!Number.isInteger(Math.round(amount * 100))) {
    return fail("Enter an amount in dollars and cents.");
  }

  const invoiceDate = isoDateToUtcMidnight((input.invoiceDate ?? "").trim());
  if (!invoiceDate) return fail("Pick an invoice date.");
  const dueDate = isoDateToUtcMidnight((input.dueDate ?? "").trim());
  if (!dueDate) return fail("Pick a due date.");
  if (dueDate < invoiceDate) return fail("The due date cannot be before the invoice date.");

  let servicePeriodStart: Date | null = null;
  let servicePeriodEnd: Date | null = null;
  if (company === "branzino") {
    const startIso = (input.servicePeriodStart ?? "").trim();
    const endIso = (input.servicePeriodEnd ?? "").trim();
    if (startIso || endIso) {
      servicePeriodStart = isoDateToUtcMidnight(startIso);
      servicePeriodEnd = isoDateToUtcMidnight(endIso);
      if (!servicePeriodStart || !servicePeriodEnd) {
        return fail("Enter both service period dates, or leave both blank.");
      }
      if (servicePeriodEnd < servicePeriodStart) {
        return fail("The service period cannot end before it starts.");
      }
    }
  }

  const amountDecimal = new Prisma.Decimal(amount.toFixed(2));

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
          amount: amountDecimal,
          invoiceDate,
          dueDate,
          servicePeriodStart,
          servicePeriodEnd,
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

  const invoiceNumberLabel = formatConsultingInvoiceNumber(company, created.invoiceNumber);

  // From here on the row exists. Nothing below may throw out of the action.
  let emailed = false;
  let sentFrom: string | null = null;
  let emailError: string | null = null;
  try {
    const pdfInput = {
      company,
      invoiceNumber: created.invoiceNumber,
      amountUsd: amount,
      invoiceDate: utcMidnightToIso(invoiceDate),
      dueDate: utcMidnightToIso(dueDate),
      servicePeriodStart: servicePeriodStart ? utcMidnightToIso(servicePeriodStart) : null,
      servicePeriodEnd: servicePeriodEnd ? utcMidnightToIso(servicePeriodEnd) : null,
    };
    const pdf = await renderConsultingInvoicePdfBuffer(pdfInput);
    const filename = consultingInvoicePdfFilename(pdfInput);

    const numberWord = company === "arfie" ? `Invoice ${invoiceNumberLabel}` : `Invoice No. ${invoiceNumberLabel}`;
    const subject = `${co.name} ${numberWord}`;
    const bodyText = [
      "Hi Andrew and Austin,",
      "",
      `Attached is ${co.name} ${numberWord} for ${formatConsultingUsd(amount)}, dated ${formatConsultingDateLong(pdfInput.invoiceDate)}. Payment is due upon receipt.`,
      "",
      "Generated from Ace.",
    ].join("\n");

    const senders = await resolveSenders(user);
    const errors: string[] = [];
    for (const sender of senders) {
      try {
        await sendGmail({
          userId: sender.id,
          from: sender.email,
          fromName: sender.name ?? undefined,
          to: [...CONSULTING_INVOICE_TO],
          cc: [co.ccEmail],
          subject,
          bodyText,
          bodyHtml: plainToHtml(bodyText),
          attachments: [{ filename, mimeType: "application/pdf", data: pdf }],
        });
        emailed = true;
        sentFrom = sender.email;
        break;
      } catch (e) {
        errors.push(`${sender.email}: ${e instanceof Error ? e.message : "send failed"}`);
      }
    }
    if (!emailed) emailError = errors.join(" / ") || "No sender account available";
  } catch (e) {
    emailError = e instanceof Error ? e.message : "Could not build the PDF";
  }

  if (emailed) {
    try {
      await prisma.consultingInvoice.update({
        where: { id: created.id },
        data: { emailedAt: new Date(), emailedFrom: sentFrom },
      });
      revalidatePath("/invoices");
    } catch {
      // The email went out; a failed stamp is not worth reporting as a
      // failure. The row still shows in the table without the sent mark.
    }
  }

  return {
    ok: true,
    id: created.id,
    invoiceNumberLabel,
    companyName: co.name,
    emailed,
    sentFrom,
    emailError,
  };
}
