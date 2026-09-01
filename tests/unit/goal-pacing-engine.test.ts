// Goal pacing engine - all three shapes. Pure, no database.
//   TZ=America/New_York npx tsx tests/unit/goal-pacing-engine.test.ts
import assert from "node:assert/strict";

import {
  etDaysInclusive,
  etWindow,
  utcMarkerDaysInclusive,
} from "../../src/lib/goals/metrics";
import {
  pacingForCumulative,
  pacingForMilestone,
  pacingForRatio,
  pacingShapeFor,
  priorEquivalentPeriod,
  statusFor,
} from "../../src/lib/goals/pacing";

const close = (a: number | null, b: number, eps = 1e-9) =>
  a !== null && Math.abs(a - b) < eps;

// Q1 2026 as the seed script writes it: UTC calendar-date markers.
const Q1_START = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
const Q1_END = new Date(Date.UTC(2026, 2, 31, 23, 59, 59, 999));

// ---- ET day helpers ----

// Jan 1 through Mar 31 inclusive = 31 + 28 + 31 = 90 days (2026 is not a
// leap year). Counted in marker space, which is what the bounds are.
assert.equal(utcMarkerDaysInclusive(Q1_START, Q1_END), 90);
assert.equal(utcMarkerDaysInclusive(Q1_START, Q1_START), 1);
// etDaysInclusive takes true INSTANTS. Same day, ET -> 1, not 0.
{
  const w = etWindow(Q1_START, Q1_END);
  assert.equal(etDaysInclusive(w.start, w.start), 1);
  assert.equal(etDaysInclusive(w.start, new Date(w.endExclusive.getTime() - 1)), 90);
}

// The window is re-anchored to ET midnight, not left on UTC midnight.
// ET is UTC-5 on Jan 1, so ET midnight Jan 1 is 05:00Z.
{
  const w = etWindow(Q1_START, Q1_END);
  assert.equal(w.start.toISOString(), "2026-01-01T05:00:00.000Z");
  // Exclusive end is ET midnight on Apr 1. April is EDT (UTC-4).
  assert.equal(w.endExclusive.toISOString(), "2026-04-01T04:00:00.000Z");
  // 8pm ET on Mar 31 (= Apr 1 00:00 UTC) must still be INSIDE the window.
  const lateMar31 = new Date("2026-04-01T00:00:00.000Z");
  assert.equal(lateMar31 >= w.start && lateMar31 < w.endExclusive, true);
  // Applying the anchoring twice changes nothing.
  const again = etWindow(w.start, Q1_END);
  assert.equal(again.start.getTime(), w.start.getTime());
}

// ---- Status bands ----

assert.equal(statusFor(1.05), "AHEAD");
assert.equal(statusFor(1.2), "AHEAD");
assert.equal(statusFor(1.0), "ON_PACE");
assert.equal(statusFor(0.95), "ON_PACE");
assert.equal(statusFor(0.9499), "BEHIND");
assert.equal(statusFor(0), "BEHIND");
assert.equal(statusFor(null), null); // unknown is not Behind

// ---- Shape selection ----

assert.equal(pacingShapeFor("REVENUE", "QUARTERLY"), "CUMULATIVE");
assert.equal(pacingShapeFor("REVENUE", "MILESTONE"), "MILESTONE");
assert.equal(pacingShapeFor("AVG_DEAL_SIZE", "QUARTERLY"), "RATIO");
// An all-time average is still a ratio, not a milestone.
assert.equal(pacingShapeFor("AVG_DEAL_SIZE", "MILESTONE"), "RATIO");

// ---- CUMULATIVE: day one ----
// The divide-by-zero guard: on the first morning of the quarter, elapsed
// is 1 day of 90, NOT 0, so the pace index and projection are both real
// numbers instead of Infinity or NaN.
{
  const p = pacingForCumulative({
    target: 125_000,
    actual: 0,
    periodStart: Q1_START,
    periodEnd: Q1_END,
    now: new Date("2026-01-01T14:00:00.000Z"), // 9am ET, day one
  });
  assert.equal(p.daysInPeriod, 90);
  assert.equal(p.daysElapsed, 1);
  assert.equal(p.daysRemaining, 89);
  assert.equal(close(p.elapsedFraction, 1 / 90), true);
  assert.equal(close(p.expectedToDate, 125_000 / 90), true);
  assert.equal(p.paceIndex, 0); // measured, and it is zero
  assert.equal(Number.isFinite(p.paceIndex!), true);
  assert.equal(p.projectedFinish, 0);
  assert.equal(p.status, "BEHIND");
  assert.equal(p.gapToTarget, 125_000);
}

// ---- CUMULATIVE: a zero-actual period, halfway through ----
{
  const p = pacingForCumulative({
    target: 125_000,
    actual: 0,
    periodStart: Q1_START,
    periodEnd: Q1_END,
    now: new Date("2026-02-15T17:00:00.000Z"), // noon ET, day 46 of 90
  });
  assert.equal(p.daysElapsed, 46);
  assert.equal(p.actual, 0);
  assert.equal(p.paceIndex, 0);
  assert.equal(p.projectedFinish, 0);
  assert.equal(p.status, "BEHIND");
  assert.equal(p.gapToTarget, 125_000);
}

// ---- CUMULATIVE: exactly on pace, ahead, behind ----
{
  const halfway = { periodStart: Q1_START, periodEnd: Q1_END, now: new Date("2026-02-15T17:00:00.000Z") };
  const expected = 125_000 * (46 / 90);

  const onPace = pacingForCumulative({ target: 125_000, actual: expected, ...halfway });
  assert.equal(close(onPace.paceIndex, 1), true);
  assert.equal(onPace.status, "ON_PACE");
  assert.equal(close(onPace.projectedFinish, 125_000), true);

  const ahead = pacingForCumulative({ target: 125_000, actual: expected * 1.2, ...halfway });
  assert.equal(ahead.status, "AHEAD");
  assert.equal(close(ahead.projectedFinish, 125_000 * 1.2), true);
  assert.equal(ahead.gapToTarget < 125_000, true);

  const behind = pacingForCumulative({ target: 125_000, actual: expected * 0.5, ...halfway });
  assert.equal(behind.status, "BEHIND");
}

// ---- CUMULATIVE: target already beaten -> negative gap ----
{
  const p = pacingForCumulative({
    target: 125_000,
    actual: 140_000,
    periodStart: Q1_START,
    periodEnd: Q1_END,
    now: new Date("2026-03-31T20:00:00.000Z"),
  });
  assert.equal(p.daysElapsed, 90);
  assert.equal(p.daysRemaining, 0);
  assert.equal(p.elapsedFraction, 1);
  assert.equal(p.gapToTarget, -15_000);
  assert.equal(p.status, "AHEAD");
}

// ---- CUMULATIVE: guards ----
{
  // A zero target cannot produce a pace index.
  const zeroTarget = pacingForCumulative({
    target: 0,
    actual: 5,
    periodStart: Q1_START,
    periodEnd: Q1_END,
    now: new Date("2026-02-15T17:00:00.000Z"),
  });
  assert.equal(zeroTarget.paceIndex, null);
  assert.equal(zeroTarget.status, null);

  // A period that has not opened yet: nothing elapsed, nothing projected.
  const notStarted = pacingForCumulative({
    target: 125_000,
    actual: 0,
    periodStart: Q1_START,
    periodEnd: Q1_END,
    now: new Date("2025-12-15T17:00:00.000Z"),
  });
  assert.equal(notStarted.daysElapsed, 0);
  assert.equal(notStarted.elapsedFraction, 0);
  assert.equal(notStarted.expectedToDate, 0);
  assert.equal(notStarted.paceIndex, null);
  assert.equal(notStarted.projectedFinish, null);
  assert.equal(notStarted.status, null);

  // Elapsed never runs past the end of the period.
  const wayPast = pacingForCumulative({
    target: 125_000,
    actual: 100_000,
    periodStart: Q1_START,
    periodEnd: Q1_END,
    now: new Date("2027-06-01T17:00:00.000Z"),
  });
  assert.equal(wayPast.daysElapsed, 90);
  assert.equal(wayPast.daysRemaining, 0);
}

// ---- RATIO ----
{
  // Above target, and improving on last quarter.
  const p = pacingForRatio({ target: 20_000, actual: 24_000, priorActual: 18_000 });
  assert.equal(p.shape, "RATIO");
  assert.equal(close(p.percentDifference, 20), true);
  assert.equal(p.trend, "UP");
  assert.equal(p.status, "AHEAD");
  // A ratio never gets these - an average converges, it does not accrue.
  assert.equal("expectedToDate" in p, false);
  assert.equal("projectedFinish" in p, false);
}
{
  const p = pacingForRatio({ target: 20_000, actual: 19_800, priorActual: 21_000 });
  assert.equal(p.status, "ON_PACE");
  assert.equal(p.trend, "DOWN");
}
{
  const p = pacingForRatio({ target: 20_000, actual: 20_000, priorActual: 20_000 });
  assert.equal(p.trend, "FLAT");
  assert.equal(p.percentDifference, 0);
  assert.equal(p.status, "ON_PACE");
}

// ---- RATIO with zero placements: null, never zero ----
{
  const p = pacingForRatio({ target: 20_000, actual: null, priorActual: 18_000 });
  assert.equal(p.actual, null);
  assert.equal(p.percentDifference, null);
  assert.equal(p.trend, null); // no direction without a current value
  assert.equal(p.status, null); // NOT "BEHIND"
}
{
  // No prior period either (the first quarter ever).
  const p = pacingForRatio({ target: 20_000, actual: 22_000, priorActual: null });
  assert.equal(p.trend, null);
  assert.equal(p.status, "AHEAD");
}
{
  // A zero target cannot produce a percentage.
  const p = pacingForRatio({ target: 0, actual: 22_000, priorActual: null });
  assert.equal(p.percentDifference, null);
  assert.equal(p.status, null);
}

// ---- Prior equivalent period ----
{
  const prior = priorEquivalentPeriod(Q1_START, Q1_END);
  // Q1 2026 is 90 days, so the prior window is the 90 days ending the day
  // before Jan 1 - i.e. Oct 3 through Dec 31, 2025.
  assert.equal(utcMarkerDaysInclusive(prior.start, prior.end), 90);
  assert.equal(prior.start.toISOString(), "2025-10-03T00:00:00.000Z");
  assert.equal(prior.end.toISOString(), "2025-12-31T00:00:00.000Z");
  assert.equal(prior.end < Q1_START, true);

  // Q2 2026 spans the spring DST change and Q1 does not. "Equivalent"
  // means the same LENGTH, so the window before Q2 is 91 days ending
  // Mar 31 - one day longer than Q1 itself. Marker-space math keeps that
  // exact, where raw-millisecond math would drift an extra hour across
  // the DST change and could round to a different day.
  const q2Start = new Date(Date.UTC(2026, 3, 1));
  const q2End = new Date(Date.UTC(2026, 5, 30, 23, 59, 59, 999));
  const beforeQ2 = priorEquivalentPeriod(q2Start, q2End);
  assert.equal(utcMarkerDaysInclusive(q2Start, q2End), 91);
  assert.equal(utcMarkerDaysInclusive(beforeQ2.start, beforeQ2.end), 91);
  assert.equal(beforeQ2.end.toISOString(), "2026-03-31T00:00:00.000Z");
}

// ---- MILESTONE ----
{
  const now = new Date("2026-09-01T16:00:00.000Z");
  const p = pacingForMilestone({
    target: 150_000,
    actual: 60_000,
    trailingWindowActual: 45_000, // 90 days -> 500/day
    now,
  });
  assert.equal(p.shape, "MILESTONE");
  assert.equal(close(p.percentComplete, 40), true);
  assert.equal(close(p.runRatePerDay, 500), true);
  assert.equal(p.remaining, 90_000);
  assert.equal(p.alreadyReached, false);
  // 90,000 remaining at 500/day = 180 days out.
  assert.notEqual(p.projectedDate, null);
  const daysOut = (p.projectedDate!.getTime() - now.getTime()) / 86_400_000;
  assert.equal(close(daysOut, 180, 1e-6), true);
  // A milestone is never "on pace" - there is no period to pace against.
  assert.equal("status" in p, false);
  assert.equal("expectedToDate" in p, false);
}

// ---- MILESTONE with no activity ----
{
  const p = pacingForMilestone({
    target: 150_000,
    actual: 0,
    trailingWindowActual: 0,
    now: new Date("2026-09-01T16:00:00.000Z"),
  });
  assert.equal(p.percentComplete, 0);
  assert.equal(p.runRatePerDay, 0);
  assert.equal(p.remaining, 150_000);
  assert.equal(p.projectedDate, null); // no honest date at a zero run rate
  assert.equal(p.alreadyReached, false);
}
{
  // Stalled partway: progress made, but nothing in the last 90 days.
  const p = pacingForMilestone({
    target: 150_000,
    actual: 60_000,
    trailingWindowActual: 0,
    now: new Date("2026-09-01T16:00:00.000Z"),
  });
  assert.equal(close(p.percentComplete, 40), true);
  assert.equal(p.projectedDate, null);
}
{
  // Already past the line.
  const p = pacingForMilestone({
    target: 150_000,
    actual: 175_000,
    trailingWindowActual: 45_000,
    now: new Date("2026-09-01T16:00:00.000Z"),
  });
  assert.equal(p.alreadyReached, true);
  assert.equal(p.remaining, -25_000);
  assert.equal(p.projectedDate, null);
  assert.equal(close(p.percentComplete, 116.666666, 1e-4), true);
}
{
  // A zero target has no percentage.
  const p = pacingForMilestone({ target: 0, actual: 10, trailingWindowActual: 5 });
  assert.equal(p.percentComplete, null);
}

console.log("goal-pacing-engine.test.ts: all assertions passed");
