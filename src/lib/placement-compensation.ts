export type PlacementCompensationType = "salary" | "hourly";

export const HOURS_PER_YEAR_FOR_HOURLY_PLACEMENT = 2080;

export function normalizePlacementCompensationType(
  value: string | null | undefined,
): PlacementCompensationType {
  return value === "hourly" ? "hourly" : "salary";
}

export function placementFeeBasisAmount(
  amount: number | null,
  type: PlacementCompensationType,
): number | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  return type === "hourly" ? amount * HOURS_PER_YEAR_FOR_HOURLY_PLACEMENT : amount;
}

// Canonical fee resolution for every placement editor: a flat override wins
// outright, otherwise the calculated fee (basis × fee %) is floored at the
// minimum fee. Lives here so the candidate-profile dialogs and the pipeline
// Edit Placement drawer can't drift into disagreeing about what a placement's
// fee is — they all save the same feeTotal.
export type PlacementFeeResolution = {
  // What to persist as Placement.feeTotal.
  feeTotal: number;
  // Basis × fee %, before the min-fee floor. 0 when either is missing.
  rawFee: number;
  // Annualized compensation the fee % applies to; null when unusable.
  basisAmount: number | null;
  usedOverride: boolean;
  usedMinFee: boolean;
};

export function resolvePlacementFee(args: {
  amount: number | null;
  compensationType: PlacementCompensationType;
  feePercentage: number | null;
  minFee: number | null;
  overrideAmount: number | null;
}): PlacementFeeResolution {
  const { amount, compensationType, feePercentage, minFee, overrideAmount } = args;
  const basisAmount = placementFeeBasisAmount(amount, compensationType);
  const pct = feePercentage != null && Number.isFinite(feePercentage) ? feePercentage : 0;
  const rawFee = basisAmount && pct ? Math.round(basisAmount * (pct / 100)) : 0;
  const calcFee = minFee && rawFee < minFee ? minFee : rawFee;
  return {
    feeTotal: overrideAmount != null ? overrideAmount : calcFee,
    rawFee,
    basisAmount,
    usedOverride: overrideAmount != null,
    usedMinFee: overrideAmount == null && minFee != null && rawFee < minFee,
  };
}

// Whether an editor should pre-fill its flat-override box from the saved
// feeTotal. feeTotal is the stored fee for dashboards and invoices, so it is
// only evidence of a typed override when it DISAGREES with what the row's
// own numbers produce. Three cases:
//   - nothing computable (no basis or no fee %): feeTotal genuinely is a
//     flat fee, pre-fill it
//   - computable and equal to the stored fee: leave blank so the editor
//     recalculates live and a later comp change moves the fee
//   - computable but different from the stored fee: the recruiter typed a
//     flat override, pre-fill it. Leaving this blank silently reverted the
//     override to the calculated fee on the next Save (Ace 102.0 fix). The
//     box shows the value with the "(flat override)" tag, so a stale fee is
//     visible and clearable rather than invisibly frozen.
// The min fee is part of the calc, so a fee that equals the floor is
// recognised as calculated, not as an override.
export function seedFlatFeeOverride(args: {
  amount: number | null;
  compensationType: PlacementCompensationType;
  feePercentage: number | null;
  minFee: number | null;
  feeTotal: number | null;
}): string {
  const { amount, compensationType, feePercentage, minFee, feeTotal } = args;
  if (feeTotal == null || feeTotal <= 0) return "";
  const calc = resolvePlacementFee({
    amount,
    compensationType,
    feePercentage,
    minFee,
    overrideAmount: null,
  });
  if (calc.feeTotal <= 0) return String(feeTotal);
  return calc.feeTotal === feeTotal ? "" : String(feeTotal);
}

export function formatPlacementCompensation(
  amount: number | null,
  currency: string | null | undefined = "USD",
  type: PlacementCompensationType = "salary",
): string {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return "-";
  const ccy = (currency || "USD").toUpperCase().slice(0, 3) || "USD";
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: ccy,
    minimumFractionDigits: type === "hourly" && amount % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: type === "hourly" ? 2 : 0,
  }).format(amount);
  return type === "hourly" ? `${formatted}/hr` : formatted;
}

export function formatPlacementFeeBasis(
  amount: number | null,
  currency: string | null | undefined = "USD",
  type: PlacementCompensationType = "salary",
): string {
  const basis = placementFeeBasisAmount(amount, type);
  if (basis == null) return "-";
  if (type === "salary") return `${formatPlacementCompensation(amount, currency, type)} base`;
  return `${formatPlacementCompensation(amount, currency, type)} rate (${formatPlacementCompensation(
    basis,
    currency,
    "salary",
  )} annualized)`;
}
