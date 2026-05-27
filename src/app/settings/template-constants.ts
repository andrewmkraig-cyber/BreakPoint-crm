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
// 2026-05-27: Confirm Start now opens the client-facing invoice email
// composer in addition to firing the candidate welcome trigger. The
// invoice trigger pre-populates the composer (compose-prefill, never
// auto-sends) so the recruiter reviews and hits Send manually.
export const CONFIRMED_START_INVOICE_TRIGGER = "confirmed_start_invoice";
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
//
// audience + eventName are surfaced in the Triggers tab as read-only
// "who gets it" / "what fires it" fields so the manager UI doesn't have
// to parse them out of the description prose. dispatch describes how
// the trigger actually ships:
//   - "auto-send": fireTemplatedEmail sends immediately (default mode).
//   - "compose-prefill": the template's subject/body seed an open
//     composer; nothing leaves Ace until the recruiter hits Send. The
//     two interview-scheduled triggers use this path — the calendar
//     invite is the only thing that ships automatically.
// "compose-prefill" rows expose template + enabled (so a recruiter can
// pause the seeding) but hide approve-before-sending in the editor —
// there's nothing to draft.
export type TriggerDispatch = "auto-send" | "compose-prefill";
export type TriggerAudience = "candidate" | "client" | "client+candidate";
export type TriggerOption = {
  value: string;
  label: string;
  description: string;
  audience: TriggerAudience;
  eventName: string;
  dispatch: TriggerDispatch;
};

export const TRIGGER_OPTIONS: ReadonlyArray<TriggerOption> = [
  {
    value: "",
    label: "Manual only",
    description: "Not auto-sent. Pick this template by hand from the composer.",
    audience: "candidate",
    eventName: "Manual",
    dispatch: "auto-send",
  },
  {
    value: CANDIDATE_APPLIED_CONFIRMATION_TRIGGER,
    label: "Candidate Applied: Confirmation",
    description: "Auto-sends to the candidate when you click Apply to Job (sets stage = Applied).",
    audience: "candidate",
    eventName: "Apply to Job",
    dispatch: "auto-send",
  },
  {
    value: CANDIDATE_CONFIRMATION_TRIGGER,
    label: "Candidate Submitted: Confirmation",
    description: "Auto-sends to the candidate after a submittal email goes out to the client (stage = Submitted).",
    audience: "candidate",
    eventName: "Submittal sent",
    dispatch: "auto-send",
  },
  {
    value: CLIENT_INTERVIEW_SCHEDULED_TRIGGER,
    label: "Interview Scheduled: Client Confirmation",
    description:
      "Pre-populates the Send Client Invite composer when you Schedule Interview. Does NOT auto-send. The calendar invite is the only thing that ships.",
    audience: "client",
    eventName: "Schedule Interview",
    dispatch: "compose-prefill",
  },
  {
    value: CANDIDATE_INTERVIEW_PREP_TRIGGER,
    label: "Interview Scheduled: Candidate Prep",
    description:
      "Pre-populates the Send Candidate Invite composer when you Schedule Interview. Does NOT auto-send. The calendar invite is the only thing that ships.",
    audience: "candidate",
    eventName: "Schedule Interview",
    dispatch: "compose-prefill",
  },
  {
    value: OFFER_EXTENDED_TRIGGER,
    label: "Offer Extended",
    description: "Auto-sends to the candidate when you mark an offer extended (stage = Offer).",
    audience: "candidate",
    eventName: "Record Offer",
    dispatch: "auto-send",
  },
  {
    value: OFFER_ACCEPTANCE_TRIGGER,
    label: "Offer Accepted",
    description: "Auto-sends to the client (CC candidate) when you record offer acceptance (stage = Pending Start).",
    audience: "client+candidate",
    eventName: "Record Placement",
    dispatch: "auto-send",
  },
  {
    value: CANDIDATE_HIRED_WELCOME_TRIGGER,
    label: "Hired: Welcome / Next Steps",
    description: "Auto-sends to the candidate when you Confirm Start Date (stage = Hired).",
    audience: "candidate",
    eventName: "Confirm Start",
    dispatch: "auto-send",
  },
  {
    value: CONFIRMED_START_INVOICE_TRIGGER,
    label: "Confirmed Start: Invoice Draft",
    description:
      "Pops the client-facing invoice email composer (with the invoice PDF attached) when you Confirm Start. Does NOT auto-send. You review and hit Send manually.",
    audience: "client",
    eventName: "Confirm Start",
    dispatch: "compose-prefill",
  },
  {
    value: CANDIDATE_REJECTION_TRIGGER,
    label: "Candidate Rejected",
    description: "Auto-sends to the candidate when you click Reject on a candidate-job pairing.",
    audience: "candidate",
    eventName: "Reject Candidate",
    dispatch: "auto-send",
  },
  {
    value: REFERENCE_CHECK_REQUEST_TRIGGER,
    label: "Reference Check Request",
    description: "Auto-sends to the candidate when you click Request References on a candidate profile.",
    audience: "candidate",
    eventName: "Request References",
    dispatch: "auto-send",
  },
];

export function labelForTrigger(value: string | null | undefined): string {
  if (!value) return "Manual only";
  return TRIGGER_OPTIONS.find((t) => t.value === value)?.label ?? value;
}
