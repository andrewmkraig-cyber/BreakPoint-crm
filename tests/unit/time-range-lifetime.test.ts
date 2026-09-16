// Lifetime grain + jump-to-period list for the dashboard time selectors.
//
// Run via: npx tsx tests/unit/time-range-lifetime.test.ts

import {
  LIFETIME_END,
  LIFETIME_START,
  buildPeriodJumpOptions,
  encodeTimeRange,
  parseTimeRange,
  quarterOffsetFor,
  timeRange,
  timeRangeChrome,
} from "@/lib/time-range";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`ok: ${msg}`);
  }
}

const now = new Date(2026, 8, 16); // Sep 16, 2026 (Q3)

const life = timeRange({ grain: "ALL", offset: 0 }, now);
assert(life.start === LIFETIME_START && life.endExclusive === LIFETIME_END, "Lifetime spans the fixed bounds");
assert(life.label === "Lifetime", "Lifetime label");
const chrome = timeRangeChrome({ grain: "ALL", offset: 0 }, now);
assert(chrome.eyebrow === "ALL TIME" && chrome.rangeLabel === "Lifetime", "Lifetime chrome");
assert(encodeTimeRange({ grain: "ALL", offset: 0 }) === "all.0", "encodes as all.0");
assert(parseTimeRange("all.0")?.grain === "ALL", "parses all.0");
assert(parseTimeRange("lifetime")?.grain === "ALL", "parses the lifetime legacy token");

assert(quarterOffsetFor(now, 2027, 0) === 2, "Q1 2027 is two quarters ahead of Q3 2026");
assert(quarterOffsetFor(now, 2025, 3) === -3, "Q4 2025 is three quarters back");

const opts = buildPeriodJumpOptions(
  { earliest: new Date(2025, 10, 3), latest: new Date(2027, 1, 20) },
  now,
);
const labels = opts.map((o) => o.label);
assert(labels[0] === "Q4 2025", `first quarter is Q4 2025 (got ${labels[0]})`);
assert(labels.includes("Q1 2027"), "includes the future quarter that has billing");
assert(!labels.includes("Q2 2027"), "stops at the last billed quarter");
const q1 = opts.find((o) => o.label === "Q1 2027")!;
assert(q1.selection.grain === "QUARTER" && q1.selection.offset === 2, "Q1 2027 resolves to quarter offset +2");
assert(timeRange(q1.selection, now).label === "Q1 2027", "that offset round-trips to Q1 2027");
const years = opts.filter((o) => o.group === "year").map((o) => o.label);
assert(years.join(",") === "2025,YTD 2026,2027", `years 2025..2027 with YTD on the current (got ${years.join(",")})`);
assert(opts[opts.length - 1].selection.grain === "ALL", "Lifetime is the last option");

const empty = buildPeriodJumpOptions(null, now);
assert(empty.map((o) => o.label).join(",") === "Q3 2026,YTD 2026,Lifetime", "no billing yet: current quarter, current year, Lifetime");

if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("all time-range-lifetime assertions passed");
