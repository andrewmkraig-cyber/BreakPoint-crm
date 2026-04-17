// Plain constants shared by server actions + callers. Kept out of the
// "use server" file so Next allows non-async exports.

export const CANDIDATE_CONFIRMATION_TRIGGER = "candidate_submission_confirmation";
export const CLIENT_SUBMITTAL_TRIGGER = "client_submittal";
export const OFFER_ACCEPTANCE_TRIGGER = "offer_acceptance";
export const CANDIDATE_REJECTION_TRIGGER = "candidate_rejection";
export const INTERVIEW_CONFIRMATION_TRIGGER = "interview_confirmation";
