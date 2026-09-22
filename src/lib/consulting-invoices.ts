// Server-side reads for the Consulting Invoices section on /invoices.
// Every query scopes by organizationId (Rule 8). The pure constants and
// formatters are re-exported from the client-safe shared module so server
// callers have one import.

import { prisma } from "@/lib/prisma";
import {
  CONSULTING_COMPANIES,
  type ConsultingCompanyKey,
  type ConsultingInvoiceRow,
  isConsultingCompanyKey,
  utcMidnightToIso,
} from "@/lib/consulting-invoices-shared";

export * from "@/lib/consulting-invoices-shared";

// Most recent first. Ties on the same day fall back to the number so the
// newest issue sits on top.
export async function listConsultingInvoices(
  organizationId: string,
): Promise<ConsultingInvoiceRow[]> {
  const rows = await prisma.consultingInvoice.findMany({
    where: { organizationId },
    orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }],
    select: {
      id: true,
      company: true,
      invoiceNumber: true,
      amount: true,
      invoiceDate: true,
      dueDate: true,
      servicePeriodStart: true,
      servicePeriodEnd: true,
      emailedAt: true,
    },
  });
  return rows
    .filter((r) => isConsultingCompanyKey(r.company))
    .map((r) => ({
      id: r.id,
      company: r.company as ConsultingCompanyKey,
      invoiceNumber: r.invoiceNumber,
      amount: Number(r.amount.toString()),
      invoiceDate: utcMidnightToIso(r.invoiceDate),
      dueDate: utcMidnightToIso(r.dueDate),
      servicePeriodStart: r.servicePeriodStart ? utcMidnightToIso(r.servicePeriodStart) : null,
      servicePeriodEnd: r.servicePeriodEnd ? utcMidnightToIso(r.servicePeriodEnd) : null,
      emailedAt: r.emailedAt ? r.emailedAt.toISOString() : null,
    }));
}

// Sum per company in whole cents, so two invoices of $3,750.00 can never
// add up to 7499.999999.
export function consultingTotalsCents(
  rows: ConsultingInvoiceRow[],
): Record<ConsultingCompanyKey, number> {
  const totals: Record<ConsultingCompanyKey, number> = { arfie: 0, branzino: 0 };
  for (const r of rows) {
    totals[r.company] += Math.round(r.amount * 100);
  }
  return totals;
}

// max(invoiceNumber) + 1 for the company, or the documented first number
// when the company has no rows at all. The (org, company, number) unique
// key turns a concurrent double-issue into a P2002 the action retries.
export async function nextConsultingInvoiceNumber(
  organizationId: string,
  company: ConsultingCompanyKey,
): Promise<number> {
  const agg = await prisma.consultingInvoice.aggregate({
    where: { organizationId, company },
    _max: { invoiceNumber: true },
  });
  const max = agg._max.invoiceNumber;
  return max == null ? CONSULTING_COMPANIES[company].firstNumberWithoutHistory : max + 1;
}
