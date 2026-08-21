// Payment terms ↔ due date math, shared by the server (invoice creation) and
// the browser (the invoice editor's live due-date recompute) so both produce
// the same date. No prisma / node imports here — this module is client-safe.
//
// The canonical per-client value is Client.paymentTermsDays, an Int set from
// the signed fee agreement ("10 day payable" → 10). Invoice.paymentTerms stays
// a free-text string ("Net 10", "Due on receipt") because that's what prints on
// the PDF, so we round-trip between the two with the helpers below.

// Used only when neither the client nor the invoice says otherwise.
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

// 10 → "Net 10". Zero is "Due on receipt" — an invoice payable the day it
// issues shouldn't print as "Net 0".
export function paymentTermsLabel(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days) || days < 0) {
    return `Net ${DEFAULT_PAYMENT_TERMS_DAYS}`;
  }
  return days === 0 ? "Due on receipt" : `Net ${Math.trunc(days)}`;
}

// The terms a picker may offer, and the whitelist the server validates
// against. Every label is produced by paymentTermsLabel() above, so this
// list can never drift from the string that ends up on the invoice PDF.
//
// The day values are the ones already in use across the app: 0 (the
// helper's "Due on receipt" branch), 10 (the client-payable example this
// module documents), 14 (the test invoice in invoices/actions.ts), and 30
// (DEFAULT_PAYMENT_TERMS_DAYS, and the Invoice.paymentTerms column
// default). Add a day value here and both the picker and the validator
// pick it up with no other change.
export const PAYMENT_TERMS_DAY_OPTIONS = [0, 10, 14, 30] as const;

export const PAYMENT_TERMS_OPTIONS: ReadonlyArray<{
  label: string;
  days: number;
}> = PAYMENT_TERMS_DAY_OPTIONS.map((days) => ({
  label: paymentTermsLabel(days),
  days,
}));

// True when `terms` is one of the labels above. Used server-side so a
// hand-crafted request can't store a terms string the picker would never
// produce. Existing free-text invoice terms are unaffected: nothing calls
// this on the invoice editor's path.
export function isKnownPaymentTerms(terms: string | null | undefined): boolean {
  const t = (terms ?? "").trim();
  return PAYMENT_TERMS_OPTIONS.some((o) => o.label === t);
}

// "Net 10" → 10. Recruiters type this field free-hand, so anything with a
// number in it reads as that many days and the receipt-style phrasings read as
// 0. Falls back to `fallbackDays` (the client's terms, when a caller has them)
// for text we can't parse.
export function termsToDays(
  terms: string | null | undefined,
  fallbackDays: number = DEFAULT_PAYMENT_TERMS_DAYS,
): number {
  const text = (terms ?? "").trim();
  if (!text) return fallbackDays;
  const match = text.match(/(\d+)/);
  if (match) {
    const n = parseInt(match[1]!, 10);
    return Number.isFinite(n) ? n : fallbackDays;
  }
  if (/receipt|upon\s+receipt|immediate/i.test(text)) return 0;
  return fallbackDays;
}

// Day math in UTC. Our date-only columns (Invoice.startDate / dueDate,
// Placement.expectedStartDate) sit at midnight UTC; local setDate() would
// shift the stored instant off that grid by the runtime's offset and make the
// rendered day drift. See the formatDate note in src/lib/utils.ts.
export function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

// "2026-08-18" + "Net 10" → "2026-08-28". Both sides are the YYYY-MM-DD
// strings an <input type="date"> speaks. Returns "" when the issue date is
// empty or unparseable so the caller can leave the field alone.
export function dueDateIsoFromTerms(
  issueDateIso: string,
  terms: string | null | undefined,
  fallbackDays: number = DEFAULT_PAYMENT_TERMS_DAYS,
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((issueDateIso ?? "").trim());
  if (!m) return "";
  const issue = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(issue.getTime())) return "";
  return addDaysUtc(issue, termsToDays(terms, fallbackDays)).toISOString().slice(0, 10);
}
