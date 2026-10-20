// A placement "fell off" when the candidate started and then left: laid
// off, resigned, let go. It is deliberately a different thing from Cancel.
//
//   Cancel   = the deal never happened. The row is hidden from every
//              dashboard, the map, the guarantee table and the hired count.
//   Fell off = the deal happened, was billed and usually paid. It stays on
//              the books. What it adds is the follow-up: the client may be
//              owed a free replacement, and part of the fee may have been
//              refunded. A refund books as a negative billing event.
//
// Pure helpers only. Safe to import from client components and server code.

export type FellOffReason = "laid_off" | "resigned" | "terminated" | "other";

export const FELL_OFF_REASON_LABEL: Record<FellOffReason, string> = {
  laid_off: "Laid off",
  resigned: "Candidate resigned",
  terminated: "Let go by client",
  other: "Other",
};

export const FELL_OFF_REASONS: FellOffReason[] = [
  "laid_off",
  "resigned",
  "terminated",
  "other",
];

export function normalizeFellOffReason(
  value: string | null | undefined,
): FellOffReason {
  return value === "laid_off" ||
    value === "resigned" ||
    value === "terminated" ||
    value === "other"
    ? value
    : "other";
}

// The columns every surface that shows a fall-off needs. Dates are ISO
// strings so the shape crosses the server / client boundary unchanged.
export type FellOffSnapshot = {
  fellOffAt: string | null;
  fellOffReason: string | null;
  fellOffNotes: string | null;
  replacementOwed: boolean;
  refundAmount: number | null;
  refundedAt: string | null;
};

export function hasFellOff(
  s: Pick<FellOffSnapshot, "fellOffAt"> | null | undefined,
): boolean {
  return Boolean(s?.fellOffAt);
}

// Short chips for pills and cards: ["Replacement owed", "$5,000 refunded"].
export function fellOffChips(
  s: Pick<FellOffSnapshot, "replacementOwed" | "refundAmount">,
): string[] {
  const out: string[] = [];
  if (s.replacementOwed) out.push("Replacement owed");
  if (s.refundAmount != null && s.refundAmount > 0) {
    out.push(`$${Math.round(s.refundAmount).toLocaleString("en-US")} refunded`);
  }
  return out;
}
