// Merge-field registry for email templates. Tokens use square brackets and
// human-readable labels so recruiters see e.g. "[Candidate First Name]" in
// the editor. Resolved at send time by applyMergeFields().

export const MERGE_FIELDS = [
  // Candidate
  { token: "[Candidate First Name]", label: "Candidate First Name", group: "Candidate" },
  { token: "[Candidate Last Name]", label: "Candidate Last Name", group: "Candidate" },
  { token: "[Candidate Full Name]", label: "Candidate Full Name", group: "Candidate" },
  { token: "[Candidate Email]", label: "Candidate Email", group: "Candidate" },
  { token: "[Candidate Phone]", label: "Candidate Phone", group: "Candidate" },
  { token: "[Candidate Location]", label: "Candidate Location", group: "Candidate" },
  { token: "[Candidate Current Title]", label: "Candidate Current Title", group: "Candidate" },
  { token: "[Candidate Current Employer]", label: "Candidate Current Employer", group: "Candidate" },
  // Client
  { token: "[Client Company Name]", label: "Client Company Name", group: "Client" },
  { token: "[Client Company Website]", label: "Client Company Website", group: "Client" },
  { token: "[Client Company LinkedIn]", label: "Client Company LinkedIn", group: "Client" },
  { token: "[Client Contact First Name]", label: "Client Contact First Name", group: "Client" },
  { token: "[Client Contact Full Name]", label: "Client Contact Full Name", group: "Client" },
  { token: "[Client Contact Email]", label: "Client Contact Email", group: "Client" },
  // Job
  { token: "[Job Title]", label: "Job Title", group: "Job" },
  { token: "[Job Location]", label: "Job Location", group: "Job" },
  { token: "[Job Description]", label: "Job Description", group: "Job" },
  { token: "[Job Salary Range]", label: "Job Salary Range", group: "Job" },
  // Interview
  { token: "[Interview Date]", label: "Interview Date", group: "Interview" },
  { token: "[Interview Time]", label: "Interview Time", group: "Interview" },
  { token: "[Interview Date Time]", label: "Interview Date Time", group: "Interview" },
  { token: "[Interview Duration]", label: "Interview Duration", group: "Interview" },
  { token: "[Interview Type]", label: "Interview Type", group: "Interview" },
  { token: "[Meet Link]", label: "Meet Link", group: "Interview" },
  { token: "[Interview Meet Link]", label: "Meet Link (legacy)", group: "Interview" },
  { token: "[Interviewer Name]", label: "Interviewer Name", group: "Interview" },
  { token: "[Interviewer Email]", label: "Interviewer Email", group: "Interview" },
  // Offer / Placement
  { token: "[Offer Amount]", label: "Offer Amount", group: "Offer" },
  { token: "[Start Date]", label: "Start Date", group: "Offer" },
  // Recruiter (you)
  { token: "[Recruiter First Name]", label: "Recruiter First Name", group: "Recruiter" },
  { token: "[Recruiter Full Name]", label: "Recruiter Full Name", group: "Recruiter" },
  { token: "[Recruiter Name]", label: "Recruiter Full Name (legacy)", group: "Recruiter" },
  { token: "[Recruiter Email]", label: "Recruiter Email", group: "Recruiter" },
  { token: "[Recruiter Phone]", label: "Recruiter Phone", group: "Recruiter" },
] as const;

export type MergeFieldToken = (typeof MERGE_FIELDS)[number]["token"];

export type MergeFieldValues = {
  // Candidate
  candidateFirstName?: string;
  candidateLastName?: string;
  candidateFullName?: string;
  candidateEmail?: string;
  candidatePhone?: string;
  candidateLocation?: string;
  candidateCurrentTitle?: string;
  candidateCurrentEmployer?: string;
  // Client
  clientCompanyName?: string;
  clientCompanyWebsite?: string;
  clientCompanyLinkedIn?: string;
  clientContactFirstName?: string;
  clientContactFullName?: string;
  clientContactEmail?: string;
  // Job
  jobTitle?: string;
  jobLocation?: string;
  jobDescription?: string;
  jobSalaryRange?: string;
  // Interview
  interviewDate?: string;
  interviewTime?: string;
  interviewDateTime?: string;
  interviewDuration?: string;
  interviewType?: string;
  interviewMeetLink?: string;
  interviewerName?: string;
  interviewerEmail?: string;
  // Offer / Placement
  offerAmount?: string;
  startDate?: string;
  // Recruiter
  recruiterFirstName?: string;
  recruiterFullName?: string;
  recruiterName?: string; // legacy alias for recruiterFullName
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
// Falls through empty strings (unlike `??`) so incomplete callers still
// benefit from the constructed fallback (e.g. candidateFullName built from
// firstName + lastName when the caller passed fullName: "").
function nonEmpty(...candidates: Array<string | undefined | null>): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c;
  }
  return "";
}

export function applyMergeFields(text: string, values: MergeFieldValues): string {
  const fullName = nonEmpty(
    values.candidateFullName,
    [values.candidateFirstName, values.candidateLastName].filter(Boolean).join(" "),
  );
  const recruiterFull = nonEmpty(values.recruiterFullName, values.recruiterName);
  const recruiterFirst = nonEmpty(values.recruiterFirstName, recruiterFull.split(/\s+/)[0]);
  const meetLink = nonEmpty(values.interviewMeetLink);
  const map: Record<MergeFieldToken, string> = {
    // Candidate
    "[Candidate First Name]": values.candidateFirstName ?? "",
    "[Candidate Last Name]": values.candidateLastName ?? "",
    "[Candidate Full Name]": fullName,
    "[Candidate Email]": values.candidateEmail ?? "",
    "[Candidate Phone]": values.candidatePhone ?? "",
    "[Candidate Location]": values.candidateLocation ?? "",
    "[Candidate Current Title]": values.candidateCurrentTitle ?? "",
    "[Candidate Current Employer]": values.candidateCurrentEmployer ?? "",
    // Client
    "[Client Company Name]": values.clientCompanyName ?? "",
    "[Client Company Website]": values.clientCompanyWebsite ?? "",
    "[Client Company LinkedIn]": values.clientCompanyLinkedIn ?? "",
    "[Client Contact First Name]": values.clientContactFirstName ?? "",
    "[Client Contact Full Name]": values.clientContactFullName ?? "",
    "[Client Contact Email]": values.clientContactEmail ?? "",
    // Job
    "[Job Title]": values.jobTitle ?? "",
    "[Job Location]": values.jobLocation ?? "",
    "[Job Description]": values.jobDescription ?? "",
    "[Job Salary Range]": values.jobSalaryRange ?? "",
    // Interview
    "[Interview Date]": values.interviewDate ?? "",
    "[Interview Time]": values.interviewTime ?? "",
    "[Interview Date Time]": values.interviewDateTime ?? "",
    "[Interview Duration]": values.interviewDuration ?? "",
    "[Interview Type]": values.interviewType ?? "",
    "[Meet Link]": meetLink,
    "[Interview Meet Link]": meetLink,
    "[Interviewer Name]": values.interviewerName ?? "",
    "[Interviewer Email]": values.interviewerEmail ?? "",
    // Offer / Placement
    "[Offer Amount]": values.offerAmount ?? "",
    "[Start Date]": values.startDate ?? "",
    // Recruiter
    "[Recruiter First Name]": recruiterFirst,
    "[Recruiter Full Name]": recruiterFull,
    "[Recruiter Name]": recruiterFull,
    "[Recruiter Email]": values.recruiterEmail ?? "",
    "[Recruiter Phone]": values.recruiterPhone ?? "",
  };
  let out = text;
  for (const field of MERGE_FIELDS) {
    out = out.replace(new RegExp(escapeForRegex(field.token), "g"), map[field.token]);
  }
  return out;
}
