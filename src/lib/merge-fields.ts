// Merge-field registry for email templates. Tokens use square brackets and
// human-readable labels so recruiters see e.g. "[Candidate First Name]" in
// the editor. Resolved at send time by applyMergeFields().

export const MERGE_FIELDS = [
  { token: "[Candidate First Name]", label: "Candidate First Name" },
  { token: "[Candidate Last Name]", label: "Candidate Last Name" },
  { token: "[Candidate Email]", label: "Candidate Email" },
  { token: "[Client Name]", label: "Client Name" },
  { token: "[Job Title]", label: "Job Title" },
  { token: "[Job Location]", label: "Job Location" },
  { token: "[Job Description]", label: "Job Description" },
  { token: "[Recruiter Name]", label: "Recruiter Name" },
  { token: "[Recruiter Email]", label: "Recruiter Email" },
  { token: "[Recruiter Phone]", label: "Recruiter Phone" },
] as const;

export type MergeFieldToken = (typeof MERGE_FIELDS)[number]["token"];

export type MergeFieldValues = {
  candidateFirstName?: string;
  candidateLastName?: string;
  candidateEmail?: string;
  clientName?: string;
  jobTitle?: string;
  jobLocation?: string;
  jobDescription?: string;
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
    "[Candidate Email]": values.candidateEmail ?? "",
    "[Client Name]": values.clientName ?? "",
    "[Job Title]": values.jobTitle ?? "",
    "[Job Location]": values.jobLocation ?? "",
    "[Job Description]": values.jobDescription ?? "",
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
