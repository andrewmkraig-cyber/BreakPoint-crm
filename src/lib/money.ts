// One place for exact dollar formatting, so a total and the rows behind
// it can never disagree.
//
// The Billing Tower used to render its Revenue / Outstanding tiles with a
// compact formatter ($123.13K) while its drill-down popup listed the same
// money exactly ($123,125). Two formatters over one number reads as a bug
// every time: the headline said 123.13 and the receipts said 123,125.
// Both sides now call these helpers.
//
// Cents are shown only when they exist, so a whole-dollar fee stays
// "$123,125" rather than "$123,125.00" - and a stray half-dollar is never
// silently rounded away on one surface and kept on the other.

export function formatUsdExact(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  // Guard against binary-float dust (e.g. 123124.99999999999) before
  // deciding whether this amount has cents at all.
  const cents = Math.round(usd * 100);
  return formatUsdExactFromCents(cents);
}

export function formatUsdExactFromCents(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100);
  const remainder = abs % 100;
  const dollars = whole.toLocaleString("en-US");
  return remainder === 0
    ? `${sign}$${dollars}`
    : `${sign}$${dollars}.${String(remainder).padStart(2, "0")}`;
}
