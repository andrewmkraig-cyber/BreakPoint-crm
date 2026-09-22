// Fee resolution shared by the candidate-profile Offer / Record Placement
// dialogs and the pipeline Edit Placement drawer: override > min-vs-calc >
// calc. Run: npx tsx tests/unit/placement-fee-resolution.test.ts
import assert from "node:assert/strict";
import {
  resolvePlacementFee,
  seedFlatFeeOverride,
} from "../../src/lib/placement-compensation";

// Robert Rowland: $23/hr, 15%, $7,000 min fee. 23 × 2080 = $47,840 annualized,
// × 15% = $7,176 — above the min fee, so the calculated fee wins. The saved
// feeTotal of $7,000 was a stale flat override suppressing $176 of fee.
const rowland = resolvePlacementFee({
  amount: 23,
  compensationType: "hourly",
  feePercentage: 15,
  minFee: 7000,
  overrideAmount: null,
});
assert.equal(rowland.basisAmount, 47840);
assert.equal(rowland.rawFee, 7176);
assert.equal(rowland.feeTotal, 7176);
assert.equal(rowland.usedMinFee, false);
assert.equal(rowland.usedOverride, false);

// Min fee floors a calculated fee that comes in under it.
const floored = resolvePlacementFee({
  amount: 40000,
  compensationType: "salary",
  feePercentage: 15,
  minFee: 7000,
  overrideAmount: null,
});
assert.equal(floored.rawFee, 6000);
assert.equal(floored.feeTotal, 7000);
assert.equal(floored.usedMinFee, true);

// A typed flat override beats everything, including the min fee.
const overridden = resolvePlacementFee({
  amount: 23,
  compensationType: "hourly",
  feePercentage: 15,
  minFee: 7000,
  overrideAmount: 5000,
});
assert.equal(overridden.feeTotal, 5000);
assert.equal(overridden.usedOverride, true);
assert.equal(overridden.usedMinFee, false);

// Nothing to compute from → 0, which the drawer maps to a null fee rather
// than saving a bogus zero.
assert.equal(
  resolvePlacementFee({
    amount: null,
    compensationType: "salary",
    feePercentage: null,
    minFee: null,
    overrideAmount: null,
  }).feeTotal,
  0,
);

// Seeding the override box: blank when the saved fee is exactly what the
// numbers produce, so opening an editor keeps recalculating live.
assert.equal(
  seedFlatFeeOverride({
    amount: 23,
    compensationType: "hourly",
    feePercentage: 15,
    minFee: null,
    feeTotal: 7176,
  }),
  "",
);
// A saved fee that equals the min-fee floor is a calculated fee, not an
// override, so it stays blank too.
assert.equal(
  seedFlatFeeOverride({
    amount: 40000,
    compensationType: "salary",
    feePercentage: 15,
    minFee: 7000,
    feeTotal: 7000,
  }),
  "",
);
// The Solutionwhere case (Ace 102.0): $70,000 × 10% = $7,000 but the
// recruiter typed a $5,000 flat override. The saved fee disagrees with the
// calc, so the box pre-fills and a reopen + Save keeps $5,000 instead of
// silently reverting to $7,000.
assert.equal(
  seedFlatFeeOverride({
    amount: 70000,
    compensationType: "salary",
    feePercentage: 10,
    minFee: 5000,
    feeTotal: 5000,
  }),
  "5000",
);
// Rowland: the stale $7,000 is now shown in the box with the override tag
// (visible and clearable) rather than dropped.
assert.equal(
  seedFlatFeeOverride({
    amount: 23,
    compensationType: "hourly",
    feePercentage: 15,
    minFee: 7000,
    feeTotal: 7000,
  }),
  "7000",
);
// No fee % → feeTotal genuinely is a flat fee, so it pre-fills.
assert.equal(
  seedFlatFeeOverride({
    amount: 23,
    compensationType: "hourly",
    feePercentage: null,
    minFee: null,
    feeTotal: 7000,
  }),
  "7000",
);
// No compensation basis → same.
assert.equal(
  seedFlatFeeOverride({
    amount: null,
    compensationType: "salary",
    feePercentage: 20,
    minFee: null,
    feeTotal: 7000,
  }),
  "7000",
);
assert.equal(
  seedFlatFeeOverride({
    amount: null,
    compensationType: "salary",
    feePercentage: null,
    minFee: null,
    feeTotal: null,
  }),
  "",
);

console.log("placement-fee-resolution tests passed");
