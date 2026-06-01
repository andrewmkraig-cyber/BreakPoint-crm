// Client-safe date-only formatter for invoice copy. Mirrors the PDF's
// formatDate (src/lib/invoice-pdf.tsx) EXACTLY so the email body and the
// rendered PDF always print the same start / due dates.
//
// The invoice page hands the detail view date-only strings (YYYY-MM-DD,
// from Invoice.startDate.toISOString().slice(0, 10)). Parsing one of those
// with `new Date("2026-06-01")` yields midnight UTC, which a browser in a
// behind-UTC zone (ET) then renders as the PREVIOUS calendar day (5/31).
// We parse the Y/M/D parts into a LOCAL date so there's no UTC shift, then
// format with the same Intl options the PDF uses ("Jun 1, 2026").
const DATE_LABEL_OPTS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

// Format a YYYY-MM-DD date-only string the same way the invoice PDF does.
// Returns "" for an empty / malformed input so callers can supply their own
// placeholder (e.g. "TBD").
export function formatInvoiceDateLabelFromIso(isoDateOnly: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((isoDateOnly ?? "").trim());
  if (!m) return "";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Local midnight of the chosen day — no UTC reinterpretation.
  const dt = new Date(year, month - 1, day);
  return dt.toLocaleDateString("en-US", DATE_LABEL_OPTS);
}
