"use server";

import { revalidatePath } from "next/cache";

import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { isKnownPaymentTerms } from "@/lib/payment-terms";

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
  | { ok: true; retainedSearchId: string }
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
        select: { id: true },
      }),
      prisma.job.findFirst({
        where: { id: jobId, organizationId: org.id },
        select: { id: true, clientId: true },
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

    const created = await prisma.retainedSearch.create({
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

    revalidatePath("/invoices");
    return { ok: true, retainedSearchId: created.id };
  } catch (e) {
    return fail(
      e instanceof Error ? e.message : "Failed to create retained search",
    );
  }
}
