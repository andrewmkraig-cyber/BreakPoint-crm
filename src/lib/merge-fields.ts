// Merge-field registry for email templates. Tokens use square brackets and
// human-readable labels so recruiters see e.g. "[Candidate First Name]" in
// the editor. Resolved at send time by applyMergeFields().

export const MERGE_FIELDS = [
  { token: "[Candidate First Name]", label: "Candidate First Name" },
  { token: "[Candidate Last Name]", label: "Candidate Last Name" },
  { token: "[Candidate Full Name]", label: "Candidate Full Name" },
  { token: "[Candidate Email]", label: "Candidate Email" },
  { token: "[Client Contact Full Name]", label: "Client Contact Full Name" },
  { token: "[Client Contact First Name]", label: "Client Contact First Name" },
  { token: "[Client Company Name]", label: "Client Company Name" },
  { token: "[Job Title]", label: "Job Title" },
  { token: "[Job Location]", label: "Job Location" },
  { token: "[Job Description]", label: "Job Description" },
  { token: "[Offer Amount]", label: "Offer Amount" },
  { token: "[Start Date]", label: "Start Date" },
  { token: "[Recruiter Name]", label: "Recruiter Name" },
  { token: "[Recruiter Email]", label: "Recruiter Email" },
  { token: "[Recruiter Phone]", label: "Recruiter Phone" },
] as const;

export type MergeFieldToken = (typeof MERGE_FIELDS)[number]["token"];

export type MergeFieldValues = {
  candidateFirstName?: string;
  candidateLastName?: string;
  candidateFullName?: string;
  candidateEmail?: string;
  clientContactFullName?: string;
  clientContactFirstName?: string;
  clientCompanyName?: string;
  jobTitle?: string;
  jobLocation?: string;
  jobDescription?: string;
  offerAmount?: string;
  startDate?: string;
  recruiterName?: string;
  recruiterEmail?: string;
  recruiterPhone?: string;
};

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Replaces every `[Field Name]` bracket token in the input string with the
// matching value from the values map. Missing values become empty strings so
// the output never exposes raw tokens. Case-sensitive to avoid accidentally
// munging unrelated bracketed text in bodies.
export function applyMergeFields(text: string, values: MergeFieldValues): string {
  const map: Record<MergeFieldToken, string> = {
    "[Candidate First Name]": values.candidateFirstName ?? "",
    "[Candidate Last Name]": values.candidateLastName ?? "",
    "[Candidate Full Name]":
      values.candidateFullName ??
      [values.candidateFirstName, values.candidateLastName].filter(Boolean).join(" "),
    "[Candidate Email]": values.candidateEmail ?? "",
    "[Client Contact Full Name]": values.clientContactFullName ?? "",
    "[Client Contact First Name]": values.clientContactFirstName ?? "",
    "[Client Company Name]": values.clientCompanyName ?? "",
    "[Job Title]": values.jobTitle ?? "",
    "[Job Location]": values.jobLocation ?? "",
    "[Job Description]": values.jobDescription ?? "",
    "[Offer Amount]": values.offerAmount ?? "",
    "[Start Date]": values.startDate ?? "",
    "[Recruiter Name]": values.recruiterName ?? "",
    "[Recruiter Email]": values.recruiterEmail ?? "",
    "[Recruiter Phone]": values.recruiterPhone ?? "",
  };
  let out = text;
  for (const field of MERGE_FIELDS) {
    out = out.replace(new RegExp(escapeForRegex(field.token), "g"), map[field.token]);
  }
  return out;
}
