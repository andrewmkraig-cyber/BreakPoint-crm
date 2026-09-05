// Shared vocabulary for cancelling a placement.
//
// Lives here rather than in placement-actions.ts because that module is
// "use server": every export from a server-action file must be an async
// function, so a plain label map and a numeric constant cannot ship from
// there. Both the action and the cancel dialog import from this module.

export type CancellationReason =
  | "candidate_resigned"
  | "client_terminated"
  | "failed_background_check"
  | "other";

export const CANCELLATION_REASON_LABEL: Record<CancellationReason, string> = {
  candidate_resigned: "Candidate resigned",
  client_terminated: "Client terminated",
  failed_background_check: "Failed background check",
  other: "Other",
};

export const VALID_CANCEL_REASON: ReadonlySet<CancellationReason> =
  new Set<CancellationReason>([
    "candidate_resigned",
    "client_terminated",
    "failed_background_check",
    "other",
  ]);

// Minimum explanation length. Low enough not to be a chore, high enough
// that "n/a" and "." don't satisfy the requirement. The cancel dialog
// disables its confirm button on the same threshold so the recruiter is
// never bounced by the server for something the form could have caught.
export const MIN_CANCEL_DETAIL_CHARS = 10;
