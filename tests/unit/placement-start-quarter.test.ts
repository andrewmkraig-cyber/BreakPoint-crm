// A deal is dated by when the candidate ACTUALLY STARTS whenever that is
// earlier than the date the app would otherwise use. Covers the David case
// (2026-09-22): a placement booked for an October 5 start, moved to a
// September 21 start because he started early, has to land in Q3 on every
// quarter-bucketed surface.
//
//   npx tsx tests/unit/placement-start-quarter.test.ts
import assert from "node:assert/strict";
import {
  placedAtCorrection,
  placementActualStart,
  placementBillingAnchor,
  placementEarnedAt,
  sameInstant,
} from "../../src/lib/placement-dates";

const d = (iso: string) => new Date(iso);

// --- placementActualStart: earliest of the two start signals -------------

// Not confirmed yet — the agreed start is all we have.
assert.equal(
  placementActualStart({
    placedAt: d("2026-08-01T00:00:00Z"),
    expectedStartDate: d("2026-09-21T00:00:00Z"),
    startConfirmedAt: null,
  })?.toISOString(),
  "2026-09-21T00:00:00.000Z",
);

// The bug this fixes: a September 21 start confirmed on October 10. The
// confirmation stamp must NOT win, or the money books into Q4.
assert.equal(
  placementActualStart({
    placedAt: d("2026-08-01T00:00:00Z"),
    expectedStartDate: d("2026-09-21T00:00:00Z"),
    startConfirmedAt: d("2026-10-10T14:03:00Z"),
  })?.toISOString(),
  "2026-09-21T00:00:00.000Z",
);

// Came in EARLY and was confirmed on the real day — the confirmation is
// now the earlier signal and wins.
assert.equal(
  placementActualStart({
    placedAt: d("2026-08-01T00:00:00Z"),
    expectedStartDate: d("2026-10-05T00:00:00Z"),
    startConfirmedAt: d("2026-09-21T13:00:00Z"),
  })?.toISOString(),
  "2026-09-21T13:00:00.000Z",
);

// No start dates at all.
assert.equal(
  placementActualStart({
    placedAt: d("2026-08-01T00:00:00Z"),
    expectedStartDate: null,
    startConfirmedAt: null,
  }),
  null,
);

// --- placementBillingAnchor: falls back to placedAt ----------------------

assert.equal(
  placementBillingAnchor({
    placedAt: d("2026-08-01T00:00:00Z"),
    expectedStartDate: null,
    startConfirmedAt: null,
  })?.toISOString(),
  "2026-08-01T00:00:00.000Z",
);

// David: start moved Oct 5 -> Sep 21. The billing anchor moves to Q3.
const david = {
  placedAt: d("2026-08-12T00:00:00Z"),
  expectedStartDate: d("2026-09-21T00:00:00Z"),
  startConfirmedAt: null,
};
const davidAnchor = placementBillingAnchor(david)!;
assert.equal(davidAnchor.getUTCMonth(), 8, "September is month index 8");
assert.ok(davidAnchor < d("2026-10-01T00:00:00Z"), "anchor lands in Q3");

// --- placementEarnedAt / placedAtCorrection ------------------------------

// Normal deal: placed in August, starts in September. placedAt stands —
// the standing revenue definition ("a deal counts when it CLOSES") is not
// weakened, this rule only ever pulls a deal EARLIER.
assert.equal(
  placementEarnedAt(david)?.toISOString(),
  "2026-08-12T00:00:00.000Z",
);
assert.equal(placedAtCorrection(david), null, "no correction when placed first");

// A start BEFORE placedAt drags placedAt back to the start day, so goals
// and placement count score it in the quarter the work began.
const startedBeforePlaced = {
  placedAt: d("2026-10-02T09:00:00Z"),
  expectedStartDate: d("2026-09-21T00:00:00Z"),
  startConfirmedAt: null,
};
assert.equal(
  placementEarnedAt(startedBeforePlaced)?.toISOString(),
  "2026-09-21T00:00:00.000Z",
);
assert.equal(
  placedAtCorrection(startedBeforePlaced)?.toISOString(),
  "2026-09-21T00:00:00.000Z",
);

// Nothing to correct when placedAt is unset (offer stage).
assert.equal(
  placedAtCorrection({
    placedAt: null,
    expectedStartDate: d("2026-09-21T00:00:00Z"),
    startConfirmedAt: null,
  }),
  null,
);

// Correction is idempotent: re-running on the corrected row is a no-op.
assert.equal(
  placedAtCorrection({
    placedAt: d("2026-09-21T00:00:00Z"),
    expectedStartDate: d("2026-09-21T00:00:00Z"),
    startConfirmedAt: null,
  }),
  null,
);

// --- sameInstant ---------------------------------------------------------

assert.equal(sameInstant(d("2026-09-21T00:00:00Z"), d("2026-09-21T00:00:00Z")), true);
assert.equal(sameInstant(d("2026-09-21T00:00:00Z"), d("2026-10-05T00:00:00Z")), false);
assert.equal(sameInstant(null, null), true);
assert.equal(sameInstant(null, d("2026-09-21T00:00:00Z")), false);

// eslint-disable-next-line no-console
console.log("placement-start-quarter: all assertions passed");
