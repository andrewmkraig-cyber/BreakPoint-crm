"use server";

import { revalidatePath } from "next/cache";

import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  addDaysUtc,
  isKnownPaymentTerms,
  termsToDays,
} from "@/lib/payment-terms";
import {
  createRetainedInvoiceRow,
  resolveClientInvoiceContacts,
} from "@/lib/invoices";
import { createReminder } from "@/app/calendar/reminder-actions";
import { priorFridayIfWeekendUtc } from "@/lib/business-days";
import { zonedWallTimeToUtc } from "@/lib/timezone";
import { formatDate } from "@/lib/utils";

// Reminder lead time for later retained installments. Mirrors
// INSTALLMENT_REMINDER_LEAD_DAYS in the placement-side confirmStart flow:
// the nudge fires 10 calendar days before the installment is due, so the
// recruiter has time to send it and the client has time to pay.
const INSTALLMENT_REMINDER_LEAD_DAYS = 10;

// Server action behind the "Send Retained Invoice" modal on /invoices.
//
// A retained search is money committed against a Client + Job before any
// candidate exists, so this action deliberately touches neither Placement
// nor Candidate. It writes ONE RetainedSearch row at status OPEN and stops
// there — no Invoice is created here. Invoice generation (single or
// installment) lands in the next prompt.
//
// Shape / error handling / revalidation mirror the invoice actions next
// door in ./actions.ts: requireUserId + getCurrentOrg for auth and tenant
// scope, a discriminated ok/error result, one revalidatePath on success.
// The one intentional difference is the success payload: callers asked for
// `retainedSearchId` at the top level rather than actions.ts's nested
// `{ ok: true, data }`.

async function requireUserId(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  const email = s?.user?.email;
  if (!email) return null;
  if (s.user.id) return s.user.id;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return user?.id ?? null;
}

export type RetainedSearchInstallmentInput = {
  // Whole US dollars, matching RetainedSearch.totalAmount (Int).
  amount: number;
  // "YYYY-MM-DD" from the modal's date inputs.
  dueDate: string;
};

export type CreateRetainedSearchInput = {
  clientId: string;
  jobId: string;
  // Whole US dollars. RetainedSearch.totalAmount is an Int to match
  // Placement.feeTotal, so cents are not accepted here.
  totalAmount: number;
  // Must be one of PAYMENT_TERMS_OPTIONS in src/lib/payment-terms.ts.
  paymentTerms: string;
  guaranteeDays: number;
  useInstallments: boolean;
  // Required (and only read) when useInstallments is true.
  installments?: RetainedSearchInstallmentInput[];
};

export type CreateRetainedSearchResult =
  | {
      ok: true;
      retainedSearchId: string;
      // The DRAFT the caller should land on. Single-payment engagements get
      // one invoice for the full amount; installment engagements get
      // installment 1's draft. Null only if invoice generation failed, in
      // which case the RetainedSearch still saved and the caller stays put.
      invoiceId: string | null;
    }
  | { ok: false; error: string };

function fail(error: string): CreateRetainedSearchResult {
  return { ok: false, error };
}

// Whole-dollar integer guard. Rejects NaN / Infinity / fractional input so
// a fractional amount can never silently truncate into the Int column.
function isWholeDollars(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n);
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export async function createRetainedSearch(
  input: CreateRetainedSearchInput,
): Promise<CreateRetainedSearchResult> {
  const userId = await requireUserId();
  if (!userId) return fail("Not signed in");

  // Tenant comes from the session, never from the caller. Rule 8.
  const org = await getCurrentOrg();

  const clientId = (input.clientId ?? "").trim();
  const jobId = (input.jobId ?? "").trim();
  if (!clientId) return fail("Pick a client.");
  if (!jobId) return fail("Pick a job.");

  if (!isWholeDollars(input.totalAmount) || input.totalAmount <= 0) {
    return fail("Enter a retainer amount greater than zero.");
  }
  if (!isWholeDollars(input.guaranteeDays) || input.guaranteeDays <= 0) {
    return fail("Enter a guarantee period of at least one day.");
  }

  const paymentTerms = (input.paymentTerms ?? "").trim();
  if (!isKnownPaymentTerms(paymentTerms)) {
    return fail("Pick payment terms from the list.");
  }

  const useInstallments = input.useInstallments === true;
  const installments = useInstallments ? (input.installments ?? []) : [];

  if (useInstallments) {
    if (installments.length === 0) {
      return fail("Add at least one installment, or turn off split payments.");
    }
    for (let i = 0; i < installments.length; i += 1) {
      const row = installments[i]!;
      const n = i + 1;
      if (!isWholeDollars(row.amount) || row.amount <= 0) {
        return fail(`Installment ${n} needs an amount greater than zero.`);
      }
      const due = (row.dueDate ?? "").trim();
      if (!due || Number.isNaN(new Date(due).getTime())) {
        return fail(`Installment ${n} needs a valid due date.`);
      }
    }
    // Both sides are whole-dollar integers, so this is an exact comparison
    // with no floating-point tolerance needed.
    const sum = installments.reduce((s, r) => s + r.amount, 0);
    if (sum !== input.totalAmount) {
      return fail(
        `Installments add up to ${USD.format(sum)}, but the retainer is ${USD.format(
          input.totalAmount,
        )}. Adjust them to match.`,
      );
    }
  }

  try {
    // Both lookups are org-scoped, so a client or job id belonging to
    // another tenant reads as "not found" rather than leaking existence.
    const [client, job] = await Promise.all([
      prisma.client.findFirst({
        where: { id: clientId, organizationId: org.id },
        select: { id: true, name: true },
      }),
      prisma.job.findFirst({
        where: { id: jobId, organizationId: org.id },
        select: { id: true, clientId: true, title: true },
      }),
    ]);
    if (!client) return fail("That client was not found.");
    if (!job) return fail("That job was not found.");
    // The picker only offers jobs for the chosen client, so a mismatch here
    // means the form drifted (another tab reassigned the job) rather than
    // ordinary use. Jobs with no client attached are allowed through since
    // they cannot contradict the selection.
    if (job.clientId && job.clientId !== client.id) {
      return fail("That job belongs to a different client.");
    }

    // The RetainedSearch and its installment rows land in ONE transaction,
    // so a partial save (a search with half its schedule, or a schedule with
    // no parent) is impossible. Validation above has already run, so nothing
    // in here can reject on business rules.
    const created = await prisma.$transaction(async (tx) => {
      const search = await tx.retainedSearch.create({
        data: {
          organizationId: org.id,
          clientId: client.id,
          jobId: job.id,
          totalAmount: input.totalAmount,
          paymentTerms,
          guaranteeDays: input.guaranteeDays,
          useInstallments,
          status: "OPEN",
        },
        select: { id: true },
      });

      // No rows at all when the engagement bills in one payment.
      if (useInstallments && installments.length > 0) {
        await tx.retainedSearchInstallment.createMany({
          data: installments.map((row, i) => ({
            organizationId: org.id,
            retainedSearchId: search.id,
            sequence: i + 1,
            amount: row.amount,
            dueDate: new Date(row.dueDate),
          })),
        });
      }

      return search;
    });

    // Invoice generation runs AFTER the transaction commits: it needs the
    // saved rows, it calls out to the reminder action, and a failure here
    // must not roll back a retained search the recruiter already agreed to.
    // A null invoiceId simply means the caller stays on /invoices.
    const invoiceId = await generateRetainedInvoices({
      organizationId: org.id,
      retainedSearchId: created.id,
      clientId: client.id,
      clientName: client.name ?? "Client",
      roleTitle: job.title ?? null,
      paymentTerms,
      totalAmount: input.totalAmount,
      useInstallments,
    });

    revalidatePath("/invoices");
    return { ok: true, retainedSearchId: created.id, invoiceId };
  } catch (e) {
    return fail(
      e instanceof Error ? e.message : "Failed to create retained search",
    );
  }
}

export type CloseRetainedSearchResult =
  | { ok: true }
  | { ok: false; error: string };

// Closes an OPEN retained search that never produced a hire.
//
// Deliberately touches NOTHING on the money side: invoices already sent or
// collected against this engagement stay exactly as they are. Closing
// records that the search ended, it does not reverse the billing. Prompt 5
// decides how a closed-unfilled engagement reads in revenue.
//
// FILLED searches are rejected — a filled search ended by being filled, and
// the card only offers this action on OPEN rows.
export async function closeRetainedSearch(input: {
  retainedSearchId: string;
  closeReason: string;
}): Promise<CloseRetainedSearchResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  const org = await getCurrentOrg();

  const reason = (input.closeReason ?? "").trim();
  if (!reason) return { ok: false, error: "Add a short reason for closing." };
  if (reason.length > 500) {
    return { ok: false, error: "Keep the reason under 500 characters." };
  }

  try {
    const existing = await prisma.retainedSearch.findFirst({
      where: { id: input.retainedSearchId, organizationId: org.id },
      select: { id: true, status: true },
    });
    if (!existing) return { ok: false, error: "That retained search was not found." };
    if (existing.status === "FILLED") {
      return { ok: false, error: "That search is already filled." };
    }
    if (existing.status === "CLOSED_UNFILLED") {
      return { ok: false, error: "That search is already closed." };
    }

    await prisma.retainedSearch.update({
      where: { id: existing.id },
      data: {
        status: "CLOSED_UNFILLED",
        closedAt: new Date(),
        closeReason: reason,
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/invoices");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to close the search",
    };
  }
}

// Generates the DRAFT invoice(s) for a freshly-saved retained search and
// returns the id the recruiter should land on.
//
// Single payment  → one draft for the full amount, due today + terms.
// Installments    → a live draft for installment 1 (the one that bills now),
//                   pre-staged isFuture drafts for the rest, and a 9:00 AM ET
//                   reminder 10 days before each later installment is due.
//                   That is the same staging the placement-side custom-terms
//                   flow performs in confirmStart, so both kinds of
//                   installment invoice behave identically downstream.
//
// Every failure is swallowed and logged: the retained search is already
// saved, and losing an invoice draft is recoverable while losing the
// engagement record is not.
async function generateRetainedInvoices(args: {
  organizationId: string;
  retainedSearchId: string;
  clientId: string;
  clientName: string;
  roleTitle: string | null;
  paymentTerms: string;
  totalAmount: number;
  useInstallments: boolean;
}): Promise<string | null> {
  try {
    // Idempotence guard mirroring createInvoiceForPlacement: never stack a
    // second set of drafts on the same engagement.
    const existing = await prisma.invoice.findFirst({
      where: {
        retainedSearchId: args.retainedSearchId,
        organizationId: args.organizationId,
        status: { not: "VOID" },
        isFuture: false,
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    const { billingContacts, hiringContacts } = await resolveClientInvoiceContacts({
      clientId: args.clientId,
      organizationId: args.organizationId,
    });

    // Issue date is today, normalized to midnight UTC so it sits on the same
    // date-only grid as every other Invoice.startDate / dueDate.
    const now = new Date();
    const issueDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const rows = await prisma.retainedSearchInstallment.findMany({
      where: {
        retainedSearchId: args.retainedSearchId,
        organizationId: args.organizationId,
      },
      orderBy: { sequence: "asc" },
      select: { id: true, sequence: true, amount: true, dueDate: true },
    });

    // ---- Single payment ----
    if (!args.useInstallments || rows.length === 0) {
      const created = await createRetainedInvoiceRow({
        organizationId: args.organizationId,
        retainedSearchId: args.retainedSearchId,
        clientId: args.clientId,
        roleTitle: args.roleTitle,
        feeAmountUsd: args.totalAmount,
        issueDate,
        dueDate: addDaysUtc(issueDate, termsToDays(args.paymentTerms)),
        paymentTerms: args.paymentTerms,
        notes: "Retained search fee",
        isFuture: false,
        billingContacts,
        hiringContacts,
      });
      return created.id;
    }

    // ---- Installments ----
    const count = rows.length;
    let firstInvoiceId: string | null = null;

    for (const row of rows) {
      const isFirst = row.sequence === 1;
      const dueLabel = formatDate(
        row.dueDate.toISOString(),
        { month: "short", day: "numeric", year: "numeric" },
        "en-US",
      );
      // Note prefixes mirror the placement-side wording so the two
      // installment families read the same in the invoice list.
      const notes = isFirst
        ? `Installment 1 of ${count} - retained search`
        : `Future - Installment ${row.sequence} of ${count} - do not send until ${dueLabel} - retained search`;

      const created = await createRetainedInvoiceRow({
        organizationId: args.organizationId,
        retainedSearchId: args.retainedSearchId,
        clientId: args.clientId,
        roleTitle: args.roleTitle,
        feeAmountUsd: row.amount,
        issueDate,
        dueDate: row.dueDate,
        paymentTerms: args.paymentTerms,
        notes,
        // Installments 2+ stay out of the main Invoices list until they are
        // sendable, landing in the Future Invoices section instead.
        isFuture: !isFirst,
        billingContacts,
        hiringContacts,
      });

      // Stamp the generated invoice onto its installment row so each stage
      // knows which invoice bills it.
      await prisma.retainedSearchInstallment.update({
        where: { id: row.id },
        data: { invoiceId: created.id },
      });

      if (isFirst) firstInvoiceId = created.id;
    }

    // Reminders for the later installments, matching confirmStart: 9:00 AM ET,
    // 10 calendar days before the due date, sliding back to the prior Friday
    // if that lands on a weekend. Deduped by title so a repeat can't stack.
    for (const row of rows) {
      if (row.sequence === 1) continue;
      const title = `Invoice installment ${row.sequence} - ${args.roleTitle ?? "Retained search"} / ${args.clientName} - $${row.amount.toLocaleString("en-US")} due (${row.sequence} of ${count})`;
      const dupe = await prisma.aceReminder.findFirst({
        where: { organizationId: args.organizationId, title },
        select: { id: true },
      });
      if (dupe) continue;
      const reminderCal = priorFridayIfWeekendUtc(
        new Date(
          Date.UTC(
            row.dueDate.getUTCFullYear(),
            row.dueDate.getUTCMonth(),
            row.dueDate.getUTCDate() - INSTALLMENT_REMINDER_LEAD_DAYS,
          ),
        ),
      );
      const remindAt = zonedWallTimeToUtc(
        reminderCal.getUTCFullYear(),
        reminderCal.getUTCMonth() + 1,
        reminderCal.getUTCDate(),
        9,
        0,
        "America/New_York",
      );
      await createReminder(title, remindAt.toISOString(), [0]);
    }

    return firstInvoiceId;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[createRetainedSearch] invoice generation failed", {
      retainedSearchId: args.retainedSearchId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
