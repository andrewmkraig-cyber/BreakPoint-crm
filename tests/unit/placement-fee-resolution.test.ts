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

// Seeding the override box: blank whenever the fee is computable, so opening
// an editor can't freeze the fee.
assert.equal(
  seedFlatFeeOverride({
    amount: 23,
    compensationType: "hourly",
    feePercentage: 15,
    feeTotal: 7000,
  }),
  "",
);
// No fee % → feeTotal genuinely is a flat fee, so it pre-fills.
assert.equal(
  seedFlatFeeOverride({
    amount: 23,
    compensationType: "hourly",
    feePercentage: null,
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
    feeTotal: 7000,
  }),
  "7000",
);
assert.equal(
  seedFlatFeeOverride({
    amount: null,
    compensationType: "salary",
    feePercentage: null,
    feeTotal: null,
  }),
  "",
);

console.log("placement-fee-resolution tests passed");
