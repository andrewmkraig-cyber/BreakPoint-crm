// Pure constants + formatters for the two consulting companies that bill
// BreakPoint Talent. No prisma import here on purpose: the /invoices modal
// is a client component and reads these, and a client bundle that reaches
// @/lib/prisma fails the check-client-prisma build gate. The server-side
// queries live in src/lib/consulting-invoices.ts.

export type ConsultingCompanyKey = "arfie" | "branzino";

export type ConsultingCompany = {
  key: ConsultingCompanyKey;
  // Legal name as printed on the invoice header.
  name: string;
  // The owner this company belongs to, for the tally tiles.
  ownerName: string;
  // Short display name for the tally tile label.
  shortName: string;
  addressLines: string[];
  ein: string;
  billToLines: string[];
  terms: string;
  // Invoice numbers print differently per template: Arfie is "#9",
  // Branzino is a zero-padded "0002".
  formatNumber: (n: number) => string;
  // The number to issue when the company has no rows yet. With the seeded
  // history in place this is never reached; it exists so an empty table
  // still issues the right next number rather than #1.
  firstNumberWithoutHistory: number;
  // Every consulting invoice goes To both owners. The owner of the selected
  // company is also Cc'd at their personal address.
  ccEmail: string;
};

export const CONSULTING_INVOICE_TO = [
  "andrew@breakpointtalent.com",
  "austin@breakpointtalent.com",
] as const;

export const CONSULTING_INVOICE_SENDER_EMAIL = "andrew@breakpointtalent.com";

export const CONSULTING_COMPANIES: Record<ConsultingCompanyKey, ConsultingCompany> = {
  arfie: {
    key: "arfie",
    name: "Arfie Management LLC",
    ownerName: "Andrew Kraig",
    shortName: "Arfie Management",
    addressLines: ["5074 Hidden Creek Circle", "Solon, OH 44139"],
    ein: "42-3102385",
    billToLines: ["BreakPoint Talent", "5074 Hidden Creek Circle", "Solon, OH 44139"],
    terms: "Due Upon Receipt",
    formatNumber: (n) => `#${n}`,
    firstNumberWithoutHistory: 9,
    ccEmail: "andrewmkraig@gmail.com",
  },
  branzino: {
    key: "branzino",
    name: "Branzino Holdings LLC",
    ownerName: "Austin Barnard",
    shortName: "Branzino Holdings",
    addressLines: ["20629 W Lakeridge Ct", "Kildeer, IL 60047"],
    ein: "33-2401439",
    billToLines: ["Kraig Talent LLC d/b/a BreakPoint Talent", "Attn: Andrew Kraig, Founder"],
    terms: "Due on Receipt",
    formatNumber: (n) => String(n).padStart(4, "0"),
    firstNumberWithoutHistory: 2,
    ccEmail: "austinbarnard@gmail.com",
  },
};

export const CONSULTING_COMPANY_KEYS: ConsultingCompanyKey[] = ["arfie", "branzino"];

export function isConsultingCompanyKey(v: unknown): v is ConsultingCompanyKey {
  return v === "arfie" || v === "branzino";
}

export function formatConsultingInvoiceNumber(
  company: ConsultingCompanyKey,
  n: number,
): string {
  return CONSULTING_COMPANIES[company].formatNumber(n);
}

// Plain row shape handed from the server page to the client section.
// Decimal + Date do not cross the server/client boundary, so amount is a
// number and the dates are YYYY-MM-DD strings.
export type ConsultingInvoiceRow = {
  id: string;
  company: ConsultingCompanyKey;
  invoiceNumber: number;
  amount: number;
  invoiceDate: string;
  dueDate: string;
  emailedAt: string | null;
};

// Always two decimals ("$3,500.00"), matching how the source invoices print
// their amounts. Deliberately not formatUsdExact, which drops .00.
export function formatConsultingUsd(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// "2026-09-18" -> "September 18, 2026". Parsed as UTC so a date-only value
// never slips a day for a viewer behind UTC.
export function formatConsultingDateLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// "2026-09-18" -> "Sep 18, 2026" for the history table.
export function formatConsultingDateShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "2026-09-18" -> the UTC-midnight Date the DateTime columns store.
export function isoDateToUtcMidnight(iso: string): Date | null {
  if (!ISO_DATE_RE.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Reject "2026-02-31" style rollovers.
  if (d.toISOString().slice(0, 10) !== iso) return null;
  return d;
}

export function utcMidnightToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// YYYY-MM-DD shifted by N days, in UTC.
export function shiftIsoDate(iso: string, days: number): string {
  const d = isoDateToUtcMidnight(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return utcMidnightToIso(d);
}
