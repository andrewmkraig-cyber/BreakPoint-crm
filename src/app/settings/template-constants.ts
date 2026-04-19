// Plain constants shared by server actions + callers. Kept out of the
// "use server" file so Next allows non-async exports.

export const CANDIDATE_CONFIRMATION_TRIGGER = "candidate_submission_confirmation";
export const CLIENT_SUBMITTAL_TRIGGER = "client_submittal";
export const OFFER_ACCEPTANCE_TRIGGER = "offer_acceptance";
export const CANDIDATE_REJECTION_TRIGGER = "candidate_rejection";
export const INTERVIEW_CONFIRMATION_TRIGGER = "interview_confirmation";
export const REFERENCE_CHECK_REQUEST_TRIGGER = "reference_check_request";
export const CLIENT_INTERVIEW_CONFIRMATION_TRIGGER = "client_interview_confirmation";
export const CANDIDATE_INTERVIEW_PREP_TRIGGER = "candidate_interview_prep";

// Ordered list shown in Settings → Email Templates → trigger picker. Value ""
// maps to "Manual only" (no auto-fire). Each non-empty value is a trigger key
// known to one of the flow hooks (placement-actions, etc.).
export const TRIGGER_OPTIONS: ReadonlyArray<{ value: string; label: string; description: string }> = [
  { value: "", label: "Manual only", description: "Not auto-sent. Pick this template by hand." },
  {
    value: CANDIDATE_CONFIRMATION_TRIGGER,
    label: "Candidate Submission Confirmation",
    description: "Auto-sends to the candidate after a successful client submittal.",
  },
  {
    value: CANDIDATE_REJECTION_TRIGGER,
    label: "Candidate Rejection",
    description: "Auto-sends to the candidate when you reject them for a job.",
  },
  {
    value: OFFER_ACCEPTANCE_TRIGGER,
    label: "Offer Acceptance",
    description: "Auto-sends to the client (CC candidate) when you mark an offer as accepted.",
  },
  {
    value: INTERVIEW_CONFIRMATION_TRIGGER,
    label: "Interview Confirmation (legacy)",
    description: "Legacy candidate-facing confirmation. Replaced by Client Interview Confirmation + Candidate Interview Prep.",
  },
  {
    value: CLIENT_INTERVIEW_CONFIRMATION_TRIGGER,
    label: "Client Interview Confirmation",
    description: "Used in the Schedule Interview flow — email to the client confirming the interview and adding them to the calendar event.",
  },
  {
    value: CANDIDATE_INTERVIEW_PREP_TRIGGER,
    label: "Candidate Interview Prep",
    description: "Used in the Schedule Interview flow — email to the candidate with prep + calendar invite.",
  },
  {
    value: REFERENCE_CHECK_REQUEST_TRIGGER,
    label: "Reference Check Request",
    description: "Sends when you click Request References on a candidate profile.",
  },
  {
    value: CLIENT_SUBMITTAL_TRIGGER,
    label: "Client Submittal (used in composer)",
    description: "Source for the submittal email composer body. Not auto-sent.",
  },
];

export function labelForTrigger(value: string | null | undefined): string {
  if (!value) return "Manual only";
  return TRIGGER_OPTIONS.find((t) => t.value === value)?.label ?? value;
}
