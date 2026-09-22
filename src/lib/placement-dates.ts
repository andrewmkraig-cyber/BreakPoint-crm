// The ONE definition of "when did this deal actually happen?".
//
// Pure module on purpose — no prisma import — so client components can
// import these without dragging the Prisma client into the browser bundle
// (ACE_RULES: pure helpers must not live in prisma-importing modules).
//
// Andrew's rule (2026-09-22): a deal is dated by when the candidate
// ACTUALLY STARTS whenever that is EARLIER than the date the app would
// otherwise use. The David case: a placement booked for an October 5
// start was moved to a September 21 start because he started early, and
// every quarter-bucketed surface — billing, goals, metrics, placements —
// has to follow him back into Q3. Nothing here ever pushes a deal LATER;
// moving a start date out does not let a booked deal escape its quarter.
//
// Three dates exist on a placement and each answers a different question:
//   placedAt          — when the offer was accepted and the fee locked.
//   expectedStartDate — the agreed calendar day the candidate starts.
//   startConfirmedAt  — when the RECRUITER confirmed the start (uploaded
//                       the screenshot). This is a bookkeeping timestamp,
//                       NOT the day work began: confirming a September 21
//                       start on October 10 used to drag the whole billing
//                       schedule into Q4.

export type PlacementStartFields = {
  placedAt: Date | null;
  expectedStartDate: Date | null;
  startConfirmedAt: Date | null;
};

function earliest(...dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!Number.isFinite(d.getTime())) continue;
    if (best === null || d.getTime() < best.getTime()) best = d;
  }
  return best;
}

// The day the candidate actually started, as well as we know it.
//
// The EARLIER of the agreed start and the confirmation stamp wins. Taking
// startConfirmedAt outright (the old billing anchor) dated the deal to
// whenever the recruiter got round to uploading the screenshot; taking
// expectedStartDate outright ignores a candidate who came in early and was
// confirmed on the real day. Earliest-wins is the only rule that puts both
// cases in the quarter the work happened.
//
// Null when neither date is set (an offer-stage row that has no start yet).
export function placementActualStart(p: PlacementStartFields): Date | null {
  return earliest(p.expectedStartDate, p.startConfirmedAt);
}

// The date a placement's MONEY lands on the books — the billing anchor.
// Falls back to placedAt so a freshly-locked placement with no start date
// yet still casts its fee into a quarter instead of vanishing.
export function placementBillingAnchor(p: PlacementStartFields): Date | null {
  return placementActualStart(p) ?? p.placedAt ?? null;
}

// The date a placement COUNTS on — what `earned`, placement count, and
// every goals metric bucket by (they all query Placement.placedAt).
//
// A start that lands before placedAt pulls the deal back to the start day.
// A start after placedAt changes nothing: the deal was still booked when it
// was booked, which is the standing revenue definition.
export function placementEarnedAt(p: PlacementStartFields): Date | null {
  const start = placementActualStart(p);
  if (!p.placedAt) return start;
  if (!start) return p.placedAt;
  return start.getTime() < p.placedAt.getTime() ? start : p.placedAt;
}

// The placedAt correction to WRITE, or null when the stored value is
// already right. Write paths call this after computing the new start date
// so a start moved earlier than placedAt drags placedAt back with it.
// Returns null (leave the column alone) in every other case, including
// when there is no placedAt to correct.
export function placedAtCorrection(p: PlacementStartFields): Date | null {
  if (!p.placedAt) return null;
  const earnedAt = placementEarnedAt(p);
  if (!earnedAt) return null;
  return earnedAt.getTime() < p.placedAt.getTime() ? earnedAt : null;
}

// Same calendar instant? Used to skip no-op invoice writes.
export function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}
