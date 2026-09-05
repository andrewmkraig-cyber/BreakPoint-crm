// Whether a placement filled a role for the first time or replaced someone
// who did not stick. Every deal is exactly one of the two.
//
// Stored on Placement.dealType as the raw key, not the label, so the value
// stays stable if the wording changes.

export type DealType = "new" | "replacement";

export const DEAL_TYPE_LABEL: Record<DealType, string> = {
  new: "New placement",
  replacement: "Replacement",
};

export const DEAL_TYPES: DealType[] = ["new", "replacement"];

// Coerces whatever is on the row to a usable value. The column carries a
// "new" default so this should never see null in practice, but rows written
// before the column existed and any hand-edited value land here, and "new"
// is the correct reading for both.
export function normalizeDealType(value: string | null | undefined): DealType {
  return value === "replacement" ? "replacement" : "new";
}
