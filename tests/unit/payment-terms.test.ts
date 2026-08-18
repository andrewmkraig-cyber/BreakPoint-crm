// Client payable window → invoice terms + due date. Run in a behind-UTC zone
// to also cover the date-only handling:
//   TZ=America/New_York npx tsx tests/unit/payment-terms.test.ts
import assert from "node:assert/strict";
import {
  DEFAULT_PAYMENT_TERMS_DAYS,
  addDaysUtc,
  dueDateIsoFromTerms,
  paymentTermsLabel,
  termsToDays,
} from "../../src/lib/payment-terms";

// Labels
assert.equal(paymentTermsLabel(10), "Net 10");
assert.equal(paymentTermsLabel(30), "Net 30");
assert.equal(paymentTermsLabel(0), "Due on receipt");
assert.equal(paymentTermsLabel(null), `Net ${DEFAULT_PAYMENT_TERMS_DAYS}`);

// Free-text terms → days, with the client's window as the fallback for text
// we can't parse.
assert.equal(termsToDays("Net 10"), 10);
assert.equal(termsToDays("net 15 from start date"), 15);
assert.equal(termsToDays("Due on receipt"), 0);
assert.equal(termsToDays(""), DEFAULT_PAYMENT_TERMS_DAYS);
assert.equal(termsToDays("payable promptly", 10), 10);

// Sheehan Brothers: 8/18 issue + 10-day payable → 8/28 (was 9/17 at Net 30).
assert.equal(dueDateIsoFromTerms("2026-08-18", "Net 10"), "2026-08-28");
assert.equal(dueDateIsoFromTerms("2026-08-18", "Net 30"), "2026-09-17");
assert.equal(dueDateIsoFromTerms("2026-08-18", "Due on receipt"), "2026-08-18");
// Unparseable terms fall back to the client's window, not a generic 30.
assert.equal(dueDateIsoFromTerms("2026-08-18", "on receipt of invoice", 10), "2026-08-18");
assert.equal(dueDateIsoFromTerms("", "Net 10"), "");
assert.equal(dueDateIsoFromTerms("garbage", "Net 10"), "");

// Crossing a month end and a DST boundary must not drift a day: the whole
// point of doing this in UTC.
assert.equal(dueDateIsoFromTerms("2026-10-28", "Net 10"), "2026-11-07");
assert.equal(dueDateIsoFromTerms("2026-12-28", "Net 10"), "2027-01-07");

// addDaysUtc keeps a date-only value on the midnight-UTC grid.
const start = new Date("2026-08-31T00:00:00.000Z");
assert.equal(addDaysUtc(start, 10).toISOString(), "2026-09-10T00:00:00.000Z");
assert.equal(addDaysUtc(start, 90).toISOString(), "2026-11-29T00:00:00.000Z");

console.log("payment-terms tests passed");
