// Phase 5: types + normalizers + helpers that consume cached RF-shaped
// payloads stored in Neon (Candidate.raw, Client.raw, Job.raw,
// Contact.raw). No HTTP — the RecruiterFlow API surface was deleted
// in Phase 5; this file is what survived of the old recruiterflow.ts.
//
// Split rationale: 20 files consume these types to parse RF-shaped
// `raw` JSON columns that Phase 0 stashed in Neon. Those types and
// helpers aren't "RF integration code" any more — they're Neon
// payload shapes. Filename reflects that.
import { formatExpectedCompensationFull } from "@/lib/candidate-compensation";
import { formatLocation } from "@/lib/utils";

export type RFLocation = {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;
  location?: string | null;
  street_address_1?: string | null;
  street_address_2?: string | null;
  google_place_id?: string | null;
};

export type RFUserRef = {
  id: number;
  name?: string | null;
  email?: string | null;
  img_link?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
};

export type RFCompanyRef = {
  id: number;
  name: string;
  img_link?: string | null;
};

export type RFCandidateJob = {
  job_id: number;
  candidate_id?: number;
  name?: string;
  title?: string;
  client_company_id?: number | null;
  client_company_name?: string | null;
  department?: { id?: number | null; name?: string | null } | null;
  department_name?: string | null;
  stage_name?: string | null;
  stage_moved?: string | null;
  added_time?: string | null;
  is_open?: boolean;
  job_status?: { id?: number | null; name?: string | null } | null;
  disqualification_reason?: string | null;
  starred?: number | null;
  [key: string]: unknown;
};

export type RFCandidate = {
  id: number;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string | string[];
  phone_number?: Array<string | { number?: string; type?: string }> | string | null;
  current_designation?: string;
  current_organization?: string;
  location?: RFLocation | null;
  linkedin_profile?: string | null;
  img_link?: string | null;
  rating?: number | null;
  tags?: Array<string | { id?: number; name?: string }> | null;
  attributes?: Array<string | { id?: number; name?: string }> | null;
  notes?: Array<{ id?: number; note?: string; added_time?: string; added_by?: RFUserRef | null }> | null;
  files?: RFFile[] | null;
  jobs?: RFCandidateJob[] | null;
  added_time?: string;
  added_by?: RFUserRef | null;
  latest_activity_time?: string;
  last_contacted?: string | null;
  source_name?: string | null;
  candidate_summary?: string | null;
  [key: string]: unknown;
};

export type RFJob = {
  id: number;
  title?: string;
  name?: string;
  company?: RFCompanyRef | null;
  locations?: string[] | null;
  is_open?: boolean;
  job_status?: { id?: number | null; name?: string | null; color?: string | null } | null;
  job_type?: { id?: number | null; name?: string | null } | null;
  employment_type?: string | null;
  department?: string | null;
  salary_range_start?: number | null;
  salary_range_end?: number | null;
  salary_range_currency?: string | null;
  salary_frequency?: string | null;
  expected_fee?: { number?: number | null; currency?: string | null } | Record<string, unknown> | null;
  bill_rate?: Record<string, unknown> | null;
  pay_rate?: Record<string, unknown> | null;
  current_opening?: number | null;
  number_of_openings?: number | null;
  hiring_team?: RFUserRef[] | null;
  custom_fields?: Array<{ id?: number; name?: string; value?: unknown }> | null;
  apply_link?: string | null;
  last_opened?: string | null;
  created_at?: string | null;
  notes?: unknown;
  [key: string]: unknown;
};

export type RFClientJobRef = {
  id: number;
  title?: string;
  name?: string;
  department_name?: string | null;
  candidates_submitted?: number | null;
  candidates_hired?: number | null;
  last_opened?: string | null;
  job_visibility_id?: number | null;
};

export type RFFile = {
  id?: number;
  filename?: string;
  name?: string;
  link?: string;
  url?: string;
  file_type?: string;
  file_category_id?: number;
  upload_time?: string;
  is_primary?: boolean;
};

export type RFClient = {
  id: number;
  name: string;
  domain?: string | null;
  industry?: string | null;
  linkedin_page?: string | null;
  careers_page?: string | null;
  company_size?: string | null;
  overview?: string | null;
  location?: RFLocation | null;
  phone_number?: Array<string | { number?: string; type?: string }> | null;
  open_jobs?: RFClientJobRef[] | null;
  closed_jobs?: RFClientJobRef[] | null;
  tags?: Array<string | { id?: number; name?: string }> | null;
  custom_fields?: Array<{ id?: number; name?: string; value?: unknown }> | null;
  added_time?: string | null;
  added_by?: RFUserRef | null;
  last_contact?: string | null;
  last_engagement?: string | null;
  lead_owner?: RFUserRef | null;
  status?: { id?: number | null; name?: string | null } | null;
  revenue?: { number?: number | null; currency?: string | null } | null;
  files?: RFFile[] | null;
  notes?: unknown;
  [key: string]: unknown;
};

export type RFContact = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  email?: string[] | string | null;
  phone_number?: Array<string | { number?: string; type?: string }> | null;
  client_company_id?: number | null;
  client_company_name?: string | null;
  current_designation?: string | null;
  linkedin_profile?: string | null;
  added_time?: string | null;
  latest_activity_time?: string | null;
  lead_owner?: RFUserRef | null;
  [key: string]: unknown;
};

// Ace-native augmentation parallel to RFJobWithAce. RF-imported contacts
// keep their numeric legacyRfId on `id`; Ace-native contacts get a
// synthetic negative `id` (djb2-of-cuid) so existing numeric indexers
// still compile. `_aceClientId` carries the Client cuid (the canonical
// FK per CLAUDE.md rule 3) on every contact — RF or Ace-native — so
// consumers can match by cuid without relying on the numeric
// client_company_id pathway. `_aceContactId` is the Contact cuid.
export type RFContactWithAce = RFContact & {
  _aceContactId?: string;
  _aceClientId?: string;
};

// ---- Normalizers / helpers ----

export function normalizeCandidate(c: RFCandidate) {
  const name =
    c.name ??
    [c.first_name, c.last_name].filter(Boolean).join(" ") ??
    "(unnamed)";
  const location = formatLocation(c.location);
  return {
    id: c.id,
    name: name || "(unnamed)",
    title: c.current_designation ?? "",
    employer: c.current_organization ?? "",
    location,
    updatedAt: c.latest_activity_time ?? c.added_time ?? null,
  };
}

export function formatCompensation(
  job: Pick<RFJob, "salary_range_start" | "salary_range_end" | "salary_range_currency" | "salary_frequency">,
): string {
  const { salary_range_start: s, salary_range_end: e, salary_range_currency: ccy } = job;
  if (!s && !e) return "";
  // "hour" covers both legacy seeded "hour" and the form's canonical
  // "hourly" — recruiter quotes are dollars-per-hour so we render raw,
  // not the k-suffix used for annual salary.
  const isHourly = typeof job.salary_frequency === "string" && job.salary_frequency.toLowerCase().startsWith("hour");
  const fmtAnnual = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
    return String(n);
  };
  const fmtHourly = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  const fmt = isHourly ? fmtHourly : fmtAnnual;
  const currency = ccy ?? "USD";
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const suffix = isHourly ? "/hr" : "";
  if (s && e && s !== e) return `${symbol}${fmt(s)}–${fmt(e)}${suffix}`;
  const only = s ?? e!;
  return `${symbol}${fmt(only)}${suffix}`;
}

export function normalizeJob(j: RFJob) {
  const title = j.title ?? j.name ?? "(untitled)";
  const company = j.company?.name ?? "";
  const location = Array.isArray(j.locations) && j.locations.length > 0 ? j.locations.join(", ") : "";
  return {
    id: j.id,
    title,
    company,
    companyId: j.company?.id ?? null,
    location,
    compensation: formatCompensation(j),
    employmentType: j.employment_type ?? null,
    jobType: j.job_type?.name ?? null,
    statusName: j.job_status?.name ?? null,
    isOpen: Boolean(j.is_open),
    openings: j.current_opening ?? j.number_of_openings ?? 0,
    lastEditedAt: j.last_opened ?? j.created_at ?? null,
    createdAt: j.created_at ?? null,
  };
}

export type PipelineBucket =
  | "applied"
  | "sourced"
  | "kept"
  | "submitted"
  | "interviewing"
  | "offer"
  | "pending_start"
  | "hired"
  | "rejected"
  | "cancelled"
  | "other";

export const PIPELINE_LABELS: Record<Exclude<PipelineBucket, "applied" | "sourced" | "kept" | "rejected" | "cancelled" | "other">, string> = {
  submitted: "Submitted",
  interviewing: "Interviewing",
  offer: "Offer",
  pending_start: "Pending Start",
  hired: "Hired",
};

export const PIPELINE_ORDER: Array<keyof typeof PIPELINE_LABELS> = [
  "submitted",
  "interviewing",
  "offer",
  "pending_start",
  "hired",
];

// Set of every canonical PipelineBucket string. Lets canonicalStage()
// short-circuit when called with an already-canonical value (e.g. a Neon
// Placement.stage column) — the substring matching below was written for
// RF payload stage_name strings (which use spaces / hyphens like "pending
// start" / "pre-start") and silently mapped "pending_start" / "cancelled"
// to "other" because no substring rule matched. That hid the Pending
// Start counter on every page that runs canonicalStage(Placement.stage).
const CANONICAL_BUCKETS: ReadonlySet<PipelineBucket> = new Set<PipelineBucket>([
  "sourced",
  "applied",
  "kept",
  "submitted",
  "interviewing",
  "offer",
  "pending_start",
  "hired",
  "rejected",
  "cancelled",
  "other",
]);

export function canonicalStage(stageName: string | null | undefined): PipelineBucket {
  if (!stageName) return "other";
  const s = stageName.toLowerCase().trim();
  if (CANONICAL_BUCKETS.has(s as PipelineBucket)) return s as PipelineBucket;
  if (s === "sourced" || s === "new" || s === "lead") return "sourced";
  if (s.includes("reject") || s.includes("disqualif") || s.includes("declin")) return "rejected";
  if (s.includes("hired") || s.includes("placed") || s === "joined" || s === "started") return "hired";
  if (s.includes("pending start") || s.includes("pre-start") || s.includes("prestart") || s === "offer accepted") return "pending_start";
  if (s.includes("offer")) return "offer";
  if (
    s.includes("interview") ||
    s.includes("phone screen") ||
    s.includes("screen") ||
    s.includes("onsite") ||
    s.includes("technical") ||
    s.includes("client review") ||
    s.includes("client presentation")
  ) {
    return "interviewing";
  }
  if (s.includes("submit") || s.includes("client submission")) return "submitted";
  if (s.includes("applied") || s === "application" || s.includes("application received")) return "applied";
  return "other";
}

export type JobPipelineCounts = {
  submitted: number;
  interviewing: number;
  offer: number;
  pendingStart: number;
  hired: number;
  totalActive: number;
};

export function emptyJobCounts(): JobPipelineCounts {
  return { submitted: 0, interviewing: 0, offer: 0, pendingStart: 0, hired: 0, totalActive: 0 };
}

function tallyBucket(counts: JobPipelineCounts, bucket: PipelineBucket): void {
  switch (bucket) {
    case "submitted":
      counts.submitted += 1;
      counts.totalActive += 1;
      break;
    case "interviewing":
      counts.interviewing += 1;
      counts.totalActive += 1;
      break;
    case "offer":
      counts.offer += 1;
      counts.totalActive += 1;
      break;
    case "pending_start":
      counts.pendingStart += 1;
      counts.totalActive += 1;
      break;
    case "hired":
      counts.hired += 1;
      break;
    default:
      break;
  }
}

// Builds a jobId → counts map by flattening every candidate's `jobs[]` array.
// Counts only the 5 pipeline stages we care about; "sourced" and "rejected" are ignored.
export function buildJobCounts(candidates: RFCandidate[]): Map<number, JobPipelineCounts> {
  const map = new Map<number, JobPipelineCounts>();
  for (const c of candidates) {
    const jobs = Array.isArray(c.jobs) ? c.jobs : [];
    for (const j of jobs) {
      if (typeof j?.job_id !== "number") continue;
      const prev = map.get(j.job_id) ?? emptyJobCounts();
      tallyBucket(prev, canonicalStage(j.stage_name));
      map.set(j.job_id, prev);
    }
  }
  return map;
}

// Builds a clientCompanyId → counts map, same rules as buildJobCounts.
export function buildClientCounts(candidates: RFCandidate[]): Map<number, JobPipelineCounts> {
  const map = new Map<number, JobPipelineCounts>();
  for (const c of candidates) {
    const jobs = Array.isArray(c.jobs) ? c.jobs : [];
    for (const j of jobs) {
      const clientId = j?.client_company_id;
      if (typeof clientId !== "number") continue;
      const prev = map.get(clientId) ?? emptyJobCounts();
      tallyBucket(prev, canonicalStage(j.stage_name));
      map.set(clientId, prev);
    }
  }
  return map;
}

// Flattens candidates[].jobs[] into one row per submittal across the pipeline stages we care about.
export type PipelineRow = {
  candidateId: number;
  candidateName: string;
  jobId: number;
  jobTitle: string;
  clientName: string;
  stageName: string;
  bucket: PipelineBucket;
  stageMovedAt: string | null;
  addedAt: string | null;
  isKept: boolean;
  candidateTitle: string;
  // Current employer the candidate works for right now. Sourced from
  // RFCandidate.current_organization. Empty string when unknown so the
  // shared "Current Title/Employer" sub-line stays blank instead of
  // rendering "(unknown)" noise. Added Ace 68.0 for the pipeline
  // column-standardization pass (sub-line of the unified
  // "Current Title/Employer" column).
  candidateEmployer: string;
  candidateLocation: string;
  // Candidate's expected comp as a display string. Blank when the blob is
  // missing/zero so the Salary cell can render fully blank per Item 2 of the
  // column-standardization spec.
  candidateExpectedSalary: string;
};

function candidateTagSet(c: RFCandidate): Set<string> {
  const out = new Set<string>();
  const push = (t: string | { name?: string } | undefined | null) => {
    if (!t) return;
    const name = typeof t === "string" ? t : t.name;
    if (name) out.add(name.toLowerCase().trim());
  };
  (c.tags ?? []).forEach(push);
  (c.attributes ?? []).forEach(push);
  return out;
}

export function flattenPipeline(candidates: RFCandidate[]): PipelineRow[] {
  const rows: PipelineRow[] = [];
  for (const c of candidates) {
    const jobs = Array.isArray(c.jobs) ? c.jobs : [];
    if (jobs.length === 0) continue;
    const tags = candidateTagSet(c);
    const isKept = tags.has("kept") || tags.has("keep");
    const name =
      c.name ??
      [c.first_name, c.last_name].filter(Boolean).join(" ") ??
      "(unnamed)";
    const locationLabel = formatLocation(c.location);

    for (const j of jobs) {
      if (typeof j?.job_id !== "number") continue;
      const bucket = canonicalStage(j.stage_name);
      rows.push({
        candidateId: c.id,
        candidateName: name || "(unnamed)",
        jobId: j.job_id,
        jobTitle: j.title ?? j.name ?? "(untitled)",
        clientName: j.client_company_name ?? "",
        stageName: j.stage_name ?? "",
        bucket,
        stageMovedAt: j.stage_moved ?? null,
        addedAt: j.added_time ?? null,
        isKept,
        candidateTitle: c.current_designation ?? "",
        candidateEmployer: c.current_organization ?? "",
        candidateLocation: locationLabel ?? "",
        // RFCandidate doesn't declare expected_salary in its TS interface
        // (the [key: string]: unknown index signature is the escape hatch).
        // Read defensively and keep hourly targets labeled for the pipeline.
        candidateExpectedSalary: formatExpectedCompensationFull(c.expected_salary),
      });
    }
  }
  return rows;
}

function getCustomField(fields: RFClient["custom_fields"] | RFJob["custom_fields"], match: (name: string) => boolean): unknown {
  if (!Array.isArray(fields)) return undefined;
  return fields.find((f) => typeof f?.name === "string" && match(f.name.toLowerCase()))?.value;
}

export function normalizeClient(c: RFClient) {
  const website = c.domain ? (c.domain.startsWith("http") ? c.domain : `https://${c.domain}`) : null;
  const locationLabel = formatLocation(c.location);
  const signedFlag = getCustomField(c.custom_fields, (n) => n.includes("signed agreement"));
  const agreementDate = getCustomField(c.custom_fields, (n) => n === "agreement date" || n.includes("agreement date"));
  const feePct = getCustomField(c.custom_fields, (n) => n.includes("avg fee") || n.includes("fee %") || n.includes("fee percent"));
  const billingContact = getCustomField(c.custom_fields, (n) => n.includes("billing contact"));

  const agreementFile =
    Array.isArray(c.files) ? c.files.find((f) => typeof f?.filename === "string" && f.filename.toLowerCase().includes("agreement")) ?? null : null;

  const isVerified = Boolean(signedFlag) || Boolean(agreementFile);

  const firstPhone = Array.isArray(c.phone_number) && c.phone_number.length > 0
    ? (typeof c.phone_number[0] === "string" ? c.phone_number[0] : c.phone_number[0]?.number ?? null)
    : null;

  return {
    id: c.id,
    name: c.name || "(unnamed)",
    domain: c.domain ?? null,
    website,
    industry: c.industry ?? null,
    linkedIn: c.linkedin_page ?? null,
    location: locationLabel ?? "",
    locationRaw: c.location ?? null,
    phone: firstPhone,
    openJobsCount: Array.isArray(c.open_jobs) ? c.open_jobs.length : 0,
    closedJobsCount: Array.isArray(c.closed_jobs) ? c.closed_jobs.length : 0,
    isVerified,
    agreementDate: typeof agreementDate === "string" ? agreementDate : null,
    feePct: typeof feePct === "number" ? feePct : typeof feePct === "string" ? parseFloat(feePct) || null : null,
    billingContact: typeof billingContact === "string" ? billingContact.trim() || null : null,
    agreementFileUrl: agreementFile?.link ?? null,
    agreementFileName: agreementFile?.filename ?? null,
    statusName: c.status?.name ?? null,
  };
}

// All Ace phone displays are normalized to `+1 XXX-XXX-XXXX` — Krispcall/Quo
// click-to-call expects the +1 prefix on tel: links. Non-US numbers fall
// through with a `+` prefix on the digits so they still dial out correctly.
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1 ${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length > 0) return `+${digits}`;
  return raw;
}

// Normalizes a raw phone to storage form with country code. If a `+` prefix is
// already present we trust it (won't double-add). 10-digit bare numbers are
// treated as US and get `+1` prepended. 11-digit numbers starting with 1 are
// treated as US with a missing `+` and get normalized. Unknown shapes pass
// through unchanged so we never corrupt international numbers we don't
// recognize.
export function normalizeToE164(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits ? `+${digits}` : trimmed;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}

// Builds a `tel:` href (E.164) so Krispcall/Quo click-to-call always receives
// a leading + and country code. Optional extension is appended via the RFC
// 3966 ;ext=N suffix — most clients (incl. Quo desktop) honor it as the
// post-dial digits, callers that don't just ignore it.
export function telHref(
  raw: string | null | undefined,
  extension?: string | null,
): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const base =
    digits.length === 10
      ? `tel:+1${digits}`
      : digits.length === 11 && digits.startsWith("1")
        ? `tel:+${digits}`
        : `tel:+${digits}`;
  const ext = (extension ?? "").trim().replace(/[^\d#*]/g, "");
  return ext ? `${base};ext=${ext}` : base;
}

// Coerces whatever shape the recruiter pasted into a clickable LinkedIn
// URL. Inputs we tolerate (all common copy/paste patterns):
//   • full URL — "https://www.linkedin.com/in/jeannie-seery-..."  → kept as is
//   • host-only path — "linkedin.com/in/jeannie-..."              → prefixed
//   • path-only — "in/jeannie-..." or "/in/jeannie-..."           → prefixed
//   • bare slug — "jeannie-seery-..."                              → assumed
//                                                                   personal,
//                                                                   prefixed
//                                                                   with /in/
//   • bare company slug — "company/foo"                           → kept under
//                                                                   /company/
// Returns "" when input is empty so callers can `if (href)` cleanly. The
// bug this fixes: links rendered with bare-slug values resolved as
// site-relative URLs (Ace's own host) and 404'd.
export function linkedinUrlFrom(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Strip leading slashes + "linkedin.com/" / "www.linkedin.com/" prefix.
  let rest = trimmed.replace(/^\/+/, "");
  rest = rest.replace(/^(?:www\.)?linkedin\.com\//i, "");
  rest = rest.replace(/^\/+/, "");
  const lower = rest.toLowerCase();
  if (lower.startsWith("in/") || lower.startsWith("company/") || lower.startsWith("school/") || lower.startsWith("pub/")) {
    return `https://www.linkedin.com/${rest}`;
  }
  // Bare slug → personal profile.
  return `https://www.linkedin.com/in/${rest}`;
}

export function daysBetween(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diffMs = now.getTime() - t;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}
