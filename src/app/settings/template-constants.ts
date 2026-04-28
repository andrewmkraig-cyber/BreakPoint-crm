// Plain constants shared by server actions + callers. Kept out of the
// "use server" file so Next allows non-async exports.
//
// Trigger taxonomy (post-26.0 cleanup): every value here corresponds
// to a real Ace pipeline action that auto-fires the matching template.
// Listed in pipeline order so the picker reads top-to-bottom along
// the funnel: Apply → Submit → Schedule Interview (split into
// client + candidate sides) → Offer Extended → Offer Accepted →
// Hired (Confirm Start) → Reject. Reference Check Request lives at
// the bottom because it's a tangential follow-up rather than a
// stage transition.

// ---- Currently wired auto-fire triggers ----
export const CANDIDATE_APPLIED_CONFIRMATION_TRIGGER = "candidate_applied_confirmation";
export const CANDIDATE_CONFIRMATION_TRIGGER = "candidate_submission_confirmation";
export const CLIENT_INTERVIEW_SCHEDULED_TRIGGER = "client_interview_scheduled";
export const CANDIDATE_INTERVIEW_PREP_TRIGGER = "candidate_interview_prep";
export const OFFER_EXTENDED_TRIGGER = "offer_extended";
export const OFFER_ACCEPTANCE_TRIGGER = "offer_acceptance";
export const CANDIDATE_HIRED_WELCOME_TRIGGER = "candidate_hired_welcome";
export const CANDIDATE_REJECTION_TRIGGER = "candidate_rejection";
export const REFERENCE_CHECK_REQUEST_TRIGGER = "reference_check_request";

// ---- Composer-only (NOT a trigger; not in the picker) ----
// The submittal composer still pulls its body source from this key.
// Kept as a constant so existing references compile, but excluded
// from TRIGGER_OPTIONS — recruiters never need to "trigger" it.
export const CLIENT_SUBMITTAL_TRIGGER = "client_submittal";

// Ordered list shown in Settings → Email Templates → trigger picker.
// Value "" maps to "Manual only" (no auto-fire). Each non-empty value
// is read at runtime by an action callsite (apply / submit /
// schedule-interview / record-offer / confirm-start / reject /
// reference-check) to decide whether to fire the matching template.
export const TRIGGER_OPTIONS: ReadonlyArray<{ value: string; label: string; description: string }> = [
  { value: "", label: "Manual only", description: "Not auto-sent. Pick this template by hand from the composer." },
  {
    value: CANDIDATE_APPLIED_CONFIRMATION_TRIGGER,
    label: "Candidate Applied — Confirmation",
    description: "Auto-sends to the candidate when you click Apply to Job (sets stage = Applied).",
  },
  {
    value: CANDIDATE_CONFIRMATION_TRIGGER,
    label: "Candidate Submitted — Confirmation",
    description: "Auto-sends to the candidate after a submittal email goes out to the client (stage = Submitted).",
  },
  {
    value: CLIENT_INTERVIEW_SCHEDULED_TRIGGER,
    label: "Interview Scheduled — Client Confirmation",
    description: "Auto-sends to the client when you Schedule Interview, confirming the time + calendar invite.",
  },
  {
    value: CANDIDATE_INTERVIEW_PREP_TRIGGER,
    label: "Interview Scheduled — Candidate Prep",
    description: "Auto-sends to the candidate when you Schedule Interview, with prep tips and the calendar invite.",
  },
  {
    value: OFFER_EXTENDED_TRIGGER,
    label: "Offer Extended",
    description: "Auto-sends to the candidate when you mark an offer extended (stage = Offer).",
  },
  {
    value: OFFER_ACCEPTANCE_TRIGGER,
    label: "Offer Accepted",
    description: "Auto-sends to the client (CC candidate) when you record offer acceptance (stage = Pending Start).",
  },
  {
    value: CANDIDATE_HIRED_WELCOME_TRIGGER,
    label: "Hired — Welcome / Next Steps",
    description: "Auto-sends to the candidate when you Confirm Start Date (stage = Hired).",
  },
  {
    value: CANDIDATE_REJECTION_TRIGGER,
    label: "Candidate Rejected",
    description: "Auto-sends to the candidate when you click Reject on a candidate-job pairing.",
  },
  {
    value: REFERENCE_CHECK_REQUEST_TRIGGER,
    label: "Reference Check Request",
    description: "Auto-sends to the candidate when you click Request References on a candidate profile.",
  },
];

export function labelForTrigger(value: string | null | undefined): string {
  if (!value) return "Manual only";
  return TRIGGER_OPTIONS.find((t) => t.value === value)?.label ?? value;
}
