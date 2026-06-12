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
