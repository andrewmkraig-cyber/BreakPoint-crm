// Merge-field registry for email templates. Tokens use square brackets and
// human-readable labels so recruiters see e.g. "[Candidate First Name]" in
// the editor. Resolved at send time by applyMergeFields().

import { stripMarkdownToPlain } from "@/lib/markdown-to-plain";
import { extractCityFromLocation } from "@/lib/candidate-compensation";

export const MERGE_FIELDS = [
  // Candidate
  { token: "[Candidate First Name]", label: "Candidate First Name", group: "Candidate" },
  { token: "[Candidate Last Name]", label: "Candidate Last Name", group: "Candidate" },
  { token: "[Candidate Full Name]", label: "Candidate Full Name", group: "Candidate" },
  { token: "[Candidate Email]", label: "Candidate Email", group: "Candidate" },
  { token: "[Candidate Phone]", label: "Candidate Phone", group: "Candidate" },
  { token: "[Candidate Location]", label: "Candidate Location", group: "Candidate" },
  { token: "[Candidate City]", label: "Candidate City", group: "Candidate" },
  { token: "[Candidate Compensation]", label: "Candidate Compensation", group: "Candidate" },
  { token: "[Candidate Current Title]", label: "Candidate Current Title", group: "Candidate" },
  { token: "[Candidate Current Employer]", label: "Candidate Current Employer", group: "Candidate" },
  // General
  { token: "[Greeting]", label: "Greeting (smart, by recipient count)", group: "General" },
  // Client
  { token: "[Client Company Name]", label: "Client Company Name", group: "Client" },
  // Anonymous descriptor for candidate outreach — resolves to the
  // client's candidateBlurb (e.g. "a growing CPA firm in Northeast
  // Ohio"). Uses the {{snake_case}} form to match the Candidate Recruit
  // template wording "My client, {{client_blurb}}, ...".
  { token: "{{client_blurb}}", label: "Client Blurb (anonymous)", group: "Client" },
  { token: "[Client Company Website]", label: "Client Company Website", group: "Client" },
  { token: "[Client Company LinkedIn]", label: "Client Company LinkedIn", group: "Client" },
  { token: "[Client Contact First Name]", label: "Client Contact First Name", group: "Client" },
  { token: "[Client Contact Full Name]", label: "Client Contact Full Name", group: "Client" },
  { token: "[Client Contact Email]", label: "Client Contact Email", group: "Client" },
  // Job
  { token: "[Job Title]", label: "Job Title", group: "Job" },
  { token: "[Job Location]", label: "Job Location", group: "Job" },
  // City portion only of the job location (no state, no zip), e.g.
  // "Great Neck" not "Great Neck, NY 11021". Uses the {{snake_case}} form
  // to match the Candidate Recruit outreach wording.
  { token: "{{job_city}}", label: "Job City", group: "Job" },
  { token: "[Job Description]", label: "Job Description", group: "Job" },
  // Job description as clean plain text (markdown stripped). Same value as
  // [Job Description]; the {{snake_case}} form pairs with {{job_city}} in
  // the outreach template.
  { token: "{{job_description}}", label: "Job Description (plain text)", group: "Job" },
  { token: "[Job Salary Range]", label: "Job Salary Range", group: "Job" },
  // Interview
  { token: "[Interview Date]", label: "Interview Date", group: "Interview" },
  { token: "[Interview Time]", label: "Interview Time", group: "Interview" },
  { token: "[Interview Date Time]", label: "Interview Date Time", group: "Interview" },
  { token: "[Interview Time Zone]", label: "Interview Time Zone (ET/CT/MT/PT)", group: "Interview" },
  { token: "[Interview Duration]", label: "Interview Duration", group: "Interview" },
  { token: "[Interview Type]", label: "Interview Type", group: "Interview" },
  { token: "[Interview Format]", label: "Interview Format (alias for Interview Type)", group: "Interview" },
  { token: "[Interview Location]", label: "Interview Location (in-person address)", group: "Interview" },
  { token: "[Meet Link]", label: "Meet Link", group: "Interview" },
  { token: "[Interview Meet Link]", label: "Meet Link (legacy)", group: "Interview" },
  { token: "[Interviewer Name]", label: "Interviewer Name", group: "Interview" },
  { token: "[Interviewer Email]", label: "Interviewer Email", group: "Interview" },
  // Offer / Placement
  { token: "[Offer Amount]", label: "Offer Amount", group: "Offer" },
  { token: "[Start Date]", label: "Start Date", group: "Offer" },
  // Invoice
  { token: "[Invoice Number]", label: "Invoice Number", group: "Invoice" },
  { token: "[Fee Amount]", label: "Fee Amount", group: "Invoice" },
  { token: "[Invoice Due Date]", label: "Invoice Due Date", group: "Invoice" },
  // Recruiter (you)
  { token: "[Recruiter First Name]", label: "Recruiter First Name", group: "Recruiter" },
  { token: "[Recruiter Full Name]", label: "Recruiter Full Name", group: "Recruiter" },
  { token: "[Recruiter Name]", label: "Recruiter Full Name (legacy)", group: "Recruiter" },
  { token: "[Recruiter Email]", label: "Recruiter Email", group: "Recruiter" },
  { token: "[Recruiter Phone]", label: "Recruiter Phone", group: "Recruiter" },
] as const;

export type MergeFieldToken = (typeof MERGE_FIELDS)[number]["token"];

export type MergeFieldValues = {
  // General
  // Pre-computed smart greeting line (e.g. "Hi Jane and Tom,"). When absent,
  // [Greeting] falls back to a one-person greeting from the client contact
  // first name, then to "Hi there,". Built via buildSmartGreeting().
  greeting?: string;
  // Candidate
  candidateFirstName?: string;
  candidateLastName?: string;
  candidateFullName?: string;
  candidateEmail?: string;
  candidatePhone?: string;
  candidateLocation?: string;
  candidateCity?: string;
  candidateCompensation?: string;
  candidateCurrentTitle?: string;
  candidateCurrentEmployer?: string;
  publicAccountingSubmittalBullets?: string;
  // Client
  clientCompanyName?: string;
  // Anonymous candidate-facing descriptor ({{client_blurb}}).
  candidateBlurb?: string;
  clientCompanyWebsite?: string;
  clientCompanyLinkedIn?: string;
  clientContactFirstName?: string;
  clientContactFullName?: string;
  clientContactEmail?: string;
  // Job
  jobTitle?: string;
  jobLocation?: string;
  // City portion only ({{job_city}}). When absent it is derived from
  // jobLocation (everything before the first comma).
  jobCity?: string;
  jobDescription?: string;
  jobSalaryRange?: string;
  // Interview
  interviewDate?: string;
  interviewTime?: string;
  interviewDateTime?: string;
  // Short abbreviation (ET/CT/MT/PT). Source of truth lives in
  // src/lib/timezones.ts; abbrForTimeZone() maps the IANA name picked
  // by the scheduler to this short label. Always surfaced alongside
  // interviewTime / interviewDateTime so candidates know "1:00 PM"
  // means 1:00 PM in WHICH zone — the prior templates dropped this
  // information and candidates from a different zone showed up an
  // hour off.
  interviewTimeZone?: string;
  interviewDuration?: string;
  interviewType?: string;
  interviewLocation?: string;
  interviewMeetLink?: string;
  interviewerName?: string;
  interviewerEmail?: string;
  // Offer / Placement
  offerAmount?: string;
  startDate?: string;
  // Invoice
  invoiceNumber?: string;
  feeAmount?: string;
  invoiceDueDate?: string;
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

// Resolve merge tokens against a values map. By default values are spliced
// in verbatim — correct for plain-text bodies and subjects. Pass
// { html: true } when the target is an HTML body: each value is then
// HTML-escaped and its newlines become <br/> via plainToHtmlInline, so a
// multi-line value like {{job_description}} keeps its line breaks instead
// of collapsing into one run-on line when the browser renders the email.
export function applyMergeFields(
  text: string,
  values: MergeFieldValues,
  opts?: { html?: boolean },
): string {
  // Splice values with a replacement FUNCTION (not a string) so any "$" the
  // value carries — e.g. a "$120,000" comp — is treated literally instead of
  // as a $-pattern reference. In html mode the value is escaped + <br/>'d.
  const renderValue = (v: string): string =>
    opts?.html ? plainToHtmlInline(v) : v;
  const fullName = nonEmpty(
    values.candidateFullName,
    [values.candidateFirstName, values.candidateLastName].filter(Boolean).join(" "),
  );
  const recruiterFull = nonEmpty(values.recruiterFullName, values.recruiterName);
  const recruiterFirst = nonEmpty(values.recruiterFirstName, recruiterFull.split(/\s+/)[0]);
  const meetLink = nonEmpty(values.interviewMeetLink);
  const candidateLocation = values.candidateLocation ?? "";
  const candidateCity = nonEmpty(values.candidateCity, extractCityFromLocation(candidateLocation));
  const candidateCompensation = values.candidateCompensation ?? "";
  // City portion only of the job location — reuse the shared
  // extractCityFromLocation (everything before the first comma) rather
  // than a second parser. Falls back to an explicit jobCity if provided.
  const jobCity = nonEmpty(values.jobCity, extractCityFromLocation(values.jobLocation));
  // JD as clean plain text — computed once, shared by [Job Description]
  // and {{job_description}}.
  const jobDescriptionPlain = values.jobDescription ? stripMarkdownToPlain(values.jobDescription) : "";
  const greeting = nonEmpty(
    values.greeting,
    values.clientContactFirstName
      ? `Hi ${values.clientContactFirstName.trim().split(/\s+/)[0]},`
      : "",
    "Hi there,",
  );
  const map: Record<MergeFieldToken, string> = {
    // General
    "[Greeting]": greeting,
    // Candidate
    "[Candidate First Name]": values.candidateFirstName ?? "",
    "[Candidate Last Name]": values.candidateLastName ?? "",
    "[Candidate Full Name]": fullName,
    "[Candidate Email]": values.candidateEmail ?? "",
    "[Candidate Phone]": values.candidatePhone ?? "",
    "[Candidate Location]": candidateLocation,
    "[Candidate City]": candidateCity,
    "[Candidate Compensation]": candidateCompensation,
    "[Candidate Current Title]": values.candidateCurrentTitle ?? "",
    "[Candidate Current Employer]": values.candidateCurrentEmployer ?? "",
    // Client
    "[Client Company Name]": values.clientCompanyName ?? "",
    "{{client_blurb}}": values.candidateBlurb ?? "",
    "[Client Company Website]": values.clientCompanyWebsite ?? "",
    "[Client Company LinkedIn]": values.clientCompanyLinkedIn ?? "",
    "[Client Contact First Name]": values.clientContactFirstName ?? "",
    "[Client Contact Full Name]": values.clientContactFullName ?? "",
    "[Client Contact Email]": values.clientContactEmail ?? "",
    // Job
    "[Job Title]": values.jobTitle ?? "",
    "[Job Location]": values.jobLocation ?? "",
    "{{job_city}}": jobCity,
    // JD is stored as markdown for the rich JD preview render — convert
    // back to plain text here so the token pastes cleanly into email body
    // copy without literal `##` characters.
    "[Job Description]": jobDescriptionPlain,
    "{{job_description}}": jobDescriptionPlain,
    "[Job Salary Range]": values.jobSalaryRange ?? "",
    // Interview
    "[Interview Date]": values.interviewDate ?? "",
    "[Interview Time]": values.interviewTime ?? "",
    "[Interview Date Time]": values.interviewDateTime ?? "",
    "[Interview Time Zone]": values.interviewTimeZone ?? "",
    "[Interview Duration]": values.interviewDuration ?? "",
    "[Interview Type]": values.interviewType ?? "",
    "[Interview Format]": values.interviewType ?? "",
    "[Interview Location]": values.interviewLocation ?? "",
    "[Meet Link]": meetLink,
    "[Interview Meet Link]": meetLink,
    "[Interviewer Name]": values.interviewerName ?? "",
    "[Interviewer Email]": values.interviewerEmail ?? "",
    // Offer / Placement
    "[Offer Amount]": values.offerAmount ?? "",
    "[Start Date]": values.startDate ?? "",
    // Invoice
    "[Invoice Number]": values.invoiceNumber ?? "",
    "[Fee Amount]": values.feeAmount ?? "",
    "[Invoice Due Date]": values.invoiceDueDate ?? "",
    // Recruiter
    "[Recruiter First Name]": recruiterFirst,
    "[Recruiter Full Name]": recruiterFull,
    "[Recruiter Name]": recruiterFull,
    "[Recruiter Email]": values.recruiterEmail ?? "",
    "[Recruiter Phone]": values.recruiterPhone ?? "",
  };
  let out = text;
  for (const field of MERGE_FIELDS) {
    const replacement = renderValue(map[field.token]);
    out = out.replace(new RegExp(escapeForRegex(field.token), "g"), () => replacement);
  }
  const aliases: Array<readonly [string, string]> = [
    ["[Candidate Comp]", candidateCompensation],
    ["[candidate comp]", candidateCompensation],
    ["[Public Accounting Submittal Bullets]", values.publicAccountingSubmittalBullets ?? ""],
    ["{{candidate_name}}", fullName],
    ["{{candidateName}}", fullName],
    ["{{candidate_full_name}}", fullName],
    ["{{candidateFullName}}", fullName],
    ["{{candidate_first_name}}", values.candidateFirstName ?? ""],
    ["{{candidateFirstName}}", values.candidateFirstName ?? ""],
    ["{{candidate_city}}", candidateCity],
    ["{{candidateCity}}", candidateCity],
    ["{{candidate_comp}}", candidateCompensation],
    ["{{candidateComp}}", candidateCompensation],
    ["{{candidate_compensation}}", candidateCompensation],
    ["{{candidateCompensation}}", candidateCompensation],
    ["{{job_title}}", values.jobTitle ?? ""],
    ["{{jobTitle}}", values.jobTitle ?? ""],
    ["{{client_company_name}}", values.clientCompanyName ?? ""],
    ["{{clientCompanyName}}", values.clientCompanyName ?? ""],
    ["{{client_contact_first_name}}", values.clientContactFirstName ?? ""],
    ["{{clientContactFirstName}}", values.clientContactFirstName ?? ""],
    ["{{public_accounting_submittal_bullets}}", values.publicAccountingSubmittalBullets ?? ""],
  ];
  for (const [alias, value] of aliases) {
    const replacement = renderValue(value);
    out = out.replace(new RegExp(escapeForRegex(alias), "g"), () => replacement);
  }
  return out;
}

// Builds the greeting line for an email addressed to a set of recipients,
// deduped by person (same email, or same name when no email). Pure string
// helper — safe on both client and server. Single source of truth for the
// invoice email greeting; the [Greeting] merge field above resolves to the
// string this returns when callers pass it through as values.greeting.
//   1 person  -> "Hi Jane,"
//   2 people  -> "Hi Jane and Tom,"
//   3+ people -> "Hi Team,"
// A contact with no usable first name (email-only) still counts as a person;
// if that leaves the 1- or 2-person name slots unfillable we fall back to
// "Hi Team," so the line never reads "Hi ,". Zero recipients -> "Hi there,".
export function buildSmartGreeting(
  recipients: Array<{ name?: string | null; email?: string | null }>,
): string {
  const seen = new Set<string>();
  const firstNames: string[] = [];
  let personCount = 0;
  for (const r of recipients) {
    const name = (r?.name ?? "").trim();
    const email = (r?.email ?? "").trim().toLowerCase();
    if (!name && !email) continue;
    const key = email || name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    personCount += 1;
    const first = name ? name.split(/\s+/)[0] : "";
    if (first) firstNames.push(first);
  }
  if (personCount === 0) return "Hi there,";
  if (personCount >= 3) return "Hi Team,";
  if (personCount === 1) {
    return firstNames.length === 1 ? `Hi ${firstNames[0]},` : "Hi Team,";
  }
  // Exactly two people.
  return firstNames.length === 2
    ? `Hi ${firstNames[0]} and ${firstNames[1]},`
    : "Hi Team,";
}

// ── Template body HTML helpers ────────────────────────────────────────
// Email template bodies used to be plain text. The rich template editor
// now stores HTML (so recruiters can bold copy and bold inserted merge
// fields), but legacy templates and several send paths still deal in
// plain text. These pure helpers let every surface treat a body as
// "plain text OR HTML" without guessing. Pure string functions only —
// safe to import from both client components and server actions.

// Heuristic: does this string already carry HTML element markup? A bare
// "<3" or "a < b" won't match; "<p>", "<strong>", "<br/>" all do.
export function looksLikeHtml(s: string): boolean {
  return /<[a-z][a-z0-9]*(\s[^>]*)?\/?>/i.test(s);
}

function escapeHtmlEntities(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Single source of truth for turning plain text into inline HTML: escape
// entities, then every newline (CRLF/CR/LF) becomes a <br/>. A blank line
// (\n\n) becomes <br/><br/>, which renders as a visible paragraph gap.
// Shared by templateBodyToEditorHtml (whole-body conversion) and
// applyMergeFields' html mode (per-value insertion) so a template's own
// blank lines and a multi-line merge value get IDENTICAL break handling.
function plainToHtmlInline(s: string): string {
  return escapeHtmlEntities(s).replace(/\r\n|\r|\n/g, "<br/>");
}

// Convert a stored template body to the HTML the TipTap editor seeds
// from. Already-HTML bodies pass through untouched; legacy plain text is
// escaped and its newlines become <br/> inside a single paragraph
// (mirrors the mail composer's pickTemplate conversion). This is the ONE
// converter the bulk composer reuses too — no second copy.
export function templateBodyToEditorHtml(body: string): string {
  if (!body) return "";
  if (looksLikeHtml(body)) return body;
  return `<p>${plainToHtmlInline(body)}</p>`;
}

// Wrap already-HTML body content in the same email-safe container
// plainToHtml() uses, WITHOUT escaping, so <strong>/<u> survive into the
// recipient's inbox. Server send paths use this for HTML template bodies.
export function htmlEmailWrap(html: string): string {
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.55; color: #111111;">${html}</div>`;
}

// Flatten an HTML body back to readable plain text for surfaces that are
// still plain-text only (the bulk composer textarea, the submittal
// composer's text mode, the template-card preview). Block tags and <br>
// become newlines; remaining tags are stripped; core entities decoded.
// Plain-text input is returned unchanged.
export function htmlToReadableText(body: string): string {
  if (!body || !looksLikeHtml(body)) return body;
  return body
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
