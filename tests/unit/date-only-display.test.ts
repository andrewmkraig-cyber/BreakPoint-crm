// Regression: /pipeline showed 8/30 for a placement whose expected start was
// 08/31. Date-only columns are stored at midnight UTC, and rendering one with
// a plain toLocaleDateString() in a behind-UTC zone (ET) prints the previous
// calendar day. Run this with TZ=America/New_York to reproduce the old bug:
//   TZ=America/New_York npx tsx tests/unit/date-only-display.test.ts
import assert from "node:assert/strict";
import { formatDate } from "../../src/lib/utils";
import { resolveGuaranteeEnd } from "../../src/components/placements/guarantee-period-utils";

// The value the edit drawer writes when the recruiter picks 08/31/2026.
const startIso = new Date("2026-08-31").toISOString();
assert.equal(startIso, "2026-08-31T00:00:00.000Z");

// Date-only → renders as the chosen day in every zone, matching the drawer.
assert.equal(formatDate(startIso, { month: "numeric", day: "numeric", year: "numeric" }, "en-US"), "8/31/2026");
assert.equal(formatDate(new Date(startIso), { month: "short", day: "numeric", year: "numeric" }, "en-US"), "Aug 31, 2026");

// A real instant still renders in local time. 2026-08-31T01:30:00Z is
// 8/30 at 9:30pm ET, so under TZ=America/New_York this must read 8/30 —
// timestamps like placedAt / lastActionAt must not get the UTC treatment.
const instant = "2026-08-31T01:30:00.000Z";
const expectedLocal = new Date(instant).toLocaleDateString("en-US", {
  month: "numeric",
  day: "numeric",
  year: "numeric",
});
assert.equal(formatDate(instant, { month: "numeric", day: "numeric", year: "numeric" }, "en-US"), expectedLocal);

assert.equal(formatDate(null), "—");
assert.equal(formatDate("not-a-date"), "—");

// 90-day guarantee off an 8/31 start lands on 11/29 — the local-day math it
// replaced resolved 11/28 in ET.
const guaranteeEnd = resolveGuaranteeEnd({
  startDateIso: startIso,
  guaranteePeriodDays: null,
  customGuaranteeDateIso: null,
});
assert.equal(guaranteeEnd, "2026-11-29T00:00:00.000Z");
assert.equal(formatDate(guaranteeEnd, { month: "numeric", day: "numeric", year: "numeric" }, "en-US"), "11/29/2026");

console.log("date-only-display tests passed");
