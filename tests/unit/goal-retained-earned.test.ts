// Retained engagements inside `earned` - proving no double count.
// Pure: the filters are plain objects, so the exclusion rules are asserted
// directly rather than only through a live query.
//   npx tsx tests/unit/goal-retained-earned.test.ts
import assert from "node:assert/strict";

import {
  buildRevenueResult,
  earnedPlacementWhere,
  retainedEarnedWhere,
  revenueHeadline,
} from "../../src/lib/goals/metrics";

const ORG = "org_breakpoint";
const START = new Date("2026-07-01T04:00:00.000Z");
const END = new Date("2026-10-01T04:00:00.000Z");

// The two halves of `earned` and the invariant that keeps them disjoint.
const placementSide = earnedPlacementWhere(ORG, START, END, null) as Record<string, unknown>;
const retainedSide = retainedEarnedWhere(ORG, START, END, null) as Record<string, unknown>;

// ---- The exclusion that makes double counting impossible ----
// Retained money enters earned ONLY from the RetainedSearch side. The
// placement side drops every row carrying a retainedSearchId, so a retainer
// that later fills cannot be counted twice.
assert.equal(placementSide.retainedSearchId, null);
assert.deepEqual(placementSide.stage, { notIn: ["cancelled", "rejected"] });
assert.equal(placementSide.organizationId, ORG);

// The retained side is dated by createdAt - when the engagement was booked -
// NOT by closedAt (a live OPEN retainer would vanish), not by an
// installment dueDate (a billing schedule), and not by invoice sentAt
// (that is `billed` by definition).
assert.deepEqual(retainedSide.createdAt, { gte: START, lt: END });
assert.equal(retainedSide.organizationId, ORG);
assert.equal("closedAt" in retainedSide, false);
assert.equal("status" in retainedSide, false); // CLOSED_UNFILLED still earned its money
assert.equal("clientId" in retainedSide, false); // no owner scope asked for

// Owner scope goes through an explicit client id list, because
// RetainedSearch has scalar-only FKs and cannot filter on client.ownerId.
{
  const scoped = retainedEarnedWhere(ORG, START, END, ["c1", "c2"]) as Record<string, unknown>;
  assert.deepEqual(scoped.clientId, { in: ["c1", "c2"] });
  // An owner who owns no clients must match NOTHING, not everything.
  const none = retainedEarnedWhere(ORG, START, END, []) as Record<string, unknown>;
  assert.deepEqual(none.clientId, { in: [] });
}

// ---- Case 1: a retainer with NO placement (the live tsaADVET shape) ----
// $5,000 booked, no fill yet. It contributes once, from the retained side.
{
  const placementFees = 0; // nothing placed in the window
  const retainedTotal = 5_000;
  const earned = placementFees + retainedTotal;
  const r = buildRevenueResult(earned, 5_000, 5_000);
  assert.equal(r.earned, 5_000);
  assert.equal(revenueHeadline(r), 5_000);
  // Counted once: the retainer is not also present on the placement side,
  // because it has no placement at all.
  assert.equal(r.earned, retainedTotal);
  assert.equal(r.billedExceedsEarned, false);
}

// ---- Case 2: a retainer whose placement HAS landed ----
// The fill exists and carries its own feeTotal, but earnedPlacementWhere
// excludes it (retainedSearchId is set), so only the engagement's
// totalAmount counts. Before this rule the $5,000 would have been counted
// twice - once as the retainer, once as the placement fee.
{
  const retainedTotal = 5_000;
  const filledPlacementFeeTotal = 5_000; // on the row, but excluded
  const otherContingentPlacements = 46_750;

  // What the resolver actually sums: contingent placements only, plus the
  // retainer.
  const earned = otherContingentPlacements + retainedTotal;
  assert.equal(earned, 51_750);

  // The double-counted figure this guards against.
  const ifPlacementWereNotExcluded = earned + filledPlacementFeeTotal;
  assert.equal(ifPlacementWereNotExcluded, 56_750);
  assert.notEqual(earned, ifPlacementWereNotExcluded);

  // And the guard is structural, not arithmetic: the filter says so.
  assert.equal(placementSide.retainedSearchId, null);
}

// ---- Case 3: a STAGED retainer with only part billed ----
// Installments are a billing schedule, not an earning schedule. A
// contingent placement with custom terms earns its whole feeTotal on
// placedAt and bills it across three invoices; a retainer behaves
// identically. Part-billed changes `billed`, never `earned`.
{
  const retainedTotal = 30_000; // 3 x 10,000, engaged / midpoint / completion
  const billedSoFar = 10_000; // only installment 1 has been sent
  const collectedSoFar = 10_000;

  const r = buildRevenueResult(retainedTotal, billedSoFar, collectedSoFar);
  // The full engagement is earned the moment it is booked.
  assert.equal(r.earned, 30_000);
  assert.equal(revenueHeadline(r), 30_000);
  // Only a third has been billed, and that is the honest billed figure.
  assert.equal(r.billed, 10_000);
  assert.equal(r.collected, 10_000);
  // earned > billed here is NORMAL, not the anomaly flag.
  assert.equal(r.billedExceedsEarned, false);
  // Counted once: the remaining installments do not add to earned when
  // they are eventually sent - they only move billed.
  const afterSecondInstallment = buildRevenueResult(30_000, 20_000, 10_000);
  assert.equal(afterSecondInstallment.earned, 30_000);
  assert.equal(afterSecondInstallment.billed, 20_000);
}

// ---- The MILESTONE and AVG_DEAL_SIZE exceptions are untouched ----
{
  const r = buildRevenueResult(76_750, 51_000, 20_000);
  assert.equal(revenueHeadline(r), 76_750); // earned
  assert.equal(revenueHeadline(r, "QUARTERLY"), 76_750);
  // A milestone is lifetime CASH, unaffected by retained booking dates.
  assert.equal(revenueHeadline(r, "MILESTONE"), 20_000);
}

console.log("goal-retained-earned.test.ts: all assertions passed");
