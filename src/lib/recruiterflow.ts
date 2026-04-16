const RF_BASE_URL = process.env.RECRUITERFLOW_BASE_URL ?? "https://recruiterflow.com/api/external";

function getApiKey(): string {
  const key = process.env.RECRUITERFLOW_API_KEY;
  if (!key) {
    throw new Error("RECRUITERFLOW_API_KEY is not set in environment");
  }
  return key;
}

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
  files?: Array<{ id?: number; name?: string; url?: string; file_type?: string; added_time?: string }> | null;
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
  open_jobs?: Array<{ id: number; title?: string; name?: string }> | null;
  closed_jobs?: Array<{ id: number; title?: string; name?: string }> | null;
  tags?: Array<string | { id?: number; name?: string }> | null;
  custom_fields?: Array<{ id?: number; name?: string; value?: unknown }> | null;
  added_time?: string | null;
  added_by?: RFUserRef | null;
  last_contact?: string | null;
  last_engagement?: string | null;
  lead_owner?: RFUserRef | null;
  status?: { id?: number | null; name?: string | null } | null;
  revenue?: { number?: number | null; currency?: string | null } | null;
  files?: Array<{ id?: number; name?: string; url?: string; file_type?: string }> | null;
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

type RFRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  cache?: RequestCache;
  revalidate?: number;
};

function buildUrl(path: string, query?: RFRequestOptions["query"]): string {
  const url = new URL(`${RF_BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

export async function rfFetch<T = unknown>(
  path: string,
  opts: RFRequestOptions = {},
): Promise<T> {
  const url = buildUrl(path, opts.query);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "rf-api-key": getApiKey(),
  };

  const nextOpts: { revalidate?: number } = {};
  if (typeof opts.revalidate === "number") nextOpts.revalidate = opts.revalidate;

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: opts.cache,
    next: Object.keys(nextOpts).length ? nextOpts : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RecruiterFlow API ${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

function unwrap<T>(res: T[] | { data?: T[] } | null | undefined): T[] {
  if (Array.isArray(res)) return res;
  return res?.data ?? [];
}

async function listAllPaged<T>(
  fetcher: (page: number, perPage: number) => Promise<T[]>,
  perPage = 100,
  maxPages = 40,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await fetcher(page, perPage);
    out.push(...batch);
    if (batch.length < perPage) break;
  }
  return out;
}

export const recruiterflow = {
  // ---- Candidates ----

  async listCandidates(params: {
    query?: string;
    page?: number;
    perPage?: number;
  } = {}): Promise<RFCandidate[]> {
    const res = await rfFetch<RFCandidate[] | { data?: RFCandidate[] }>("/candidate/list", {
      query: {
        search_query: params.query,
        current_page: params.page ?? 1,
        items_per_page: params.perPage ?? 25,
      },
      revalidate: 60,
    });
    return unwrap(res);
  },

  async listAllCandidates(params: {
    query?: string;
    perPage?: number;
    maxPages?: number;
  } = {}): Promise<RFCandidate[]> {
    return listAllPaged(
      (page, perPage) =>
        this.listCandidates({ query: params.query, page, perPage }),
      params.perPage ?? 100,
      params.maxPages ?? 40,
    );
  },

  async getCandidate(id: number): Promise<RFCandidate> {
    return rfFetch<RFCandidate>(`/candidate/${id}`, { revalidate: 30 });
  },

  // ---- Jobs ----

  async listJobs(params: {
    page?: number;
    perPage?: number;
  } = {}): Promise<RFJob[]> {
    const res = await rfFetch<RFJob[] | { data?: RFJob[] }>("/job/list", {
      query: {
        current_page: params.page ?? 1,
        items_per_page: params.perPage ?? 100,
      },
      revalidate: 60,
    });
    return unwrap(res);
  },

  async listAllJobs(params: { perPage?: number; maxPages?: number } = {}): Promise<RFJob[]> {
    return listAllPaged(
      (page, perPage) => this.listJobs({ page, perPage }),
      params.perPage ?? 100,
      params.maxPages ?? 20,
    );
  },

  // ---- Clients (companies) ----

  async listClients(params: {
    page?: number;
    perPage?: number;
  } = {}): Promise<RFClient[]> {
    const res = await rfFetch<RFClient[] | { data?: RFClient[] }>("/client/list", {
      query: {
        current_page: params.page ?? 1,
        items_per_page: params.perPage ?? 100,
      },
      revalidate: 60,
    });
    return unwrap(res);
  },

  async listAllClients(params: { perPage?: number; maxPages?: number } = {}): Promise<RFClient[]> {
    return listAllPaged(
      (page, perPage) => this.listClients({ page, perPage }),
      params.perPage ?? 100,
      params.maxPages ?? 20,
    );
  },

  // ---- Contacts ----

  async listContacts(params: {
    page?: number;
    perPage?: number;
    query?: string;
  } = {}): Promise<RFContact[]> {
    const res = await rfFetch<RFContact[] | { data?: RFContact[] }>("/contact/list", {
      query: {
        current_page: params.page ?? 1,
        items_per_page: params.perPage ?? 100,
        search_query: params.query,
      },
      revalidate: 60,
    });
    return unwrap(res);
  },

  async listAllContacts(params: { perPage?: number; maxPages?: number; query?: string } = {}): Promise<RFContact[]> {
    return listAllPaged(
      (page, perPage) => this.listContacts({ query: params.query, page, perPage }),
      params.perPage ?? 100,
      params.maxPages ?? 20,
    );
  },

  async createContact(body: {
    first_name: string;
    last_name: string;
    email?: string;
    phone_number?: string;
    current_designation?: string;
    client_company_id?: number;
    linkedin_profile?: string;
  }): Promise<RFContact> {
    return rfFetch<RFContact>("/contact", { method: "POST", body });
  },
};

// ---- Normalizers / helpers ----

export function normalizeCandidate(c: RFCandidate) {
  const name =
    c.name ??
    [c.first_name, c.last_name].filter(Boolean).join(" ") ??
    "(unnamed)";
  const location = c.location
    ? c.location.location ??
      [c.location.city, c.location.state].filter(Boolean).join(", ")
    : "";
  return {
    id: c.id,
    name: name || "(unnamed)",
    title: c.current_designation ?? "",
    employer: c.current_organization ?? "",
    location,
    updatedAt: c.latest_activity_time ?? c.added_time ?? null,
  };
}

export function formatCompensation(job: Pick<RFJob, "salary_range_start" | "salary_range_end" | "salary_range_currency">): string {
  const { salary_range_start: s, salary_range_end: e, salary_range_currency: ccy } = job;
  if (!s && !e) return "";
  const fmt = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
    return String(n);
  };
  const currency = ccy ?? "USD";
  const symbol = currency === "USD" ? "$" : `${currency} `;
  if (s && e && s !== e) return `${symbol}${fmt(s)}–${fmt(e)}`;
  const only = s ?? e!;
  return `${symbol}${fmt(only)}`;
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

export type PipelineBucket = "submitted" | "interviewing" | "offer" | "pending_start" | "hired" | "sourced" | "rejected" | "other";

export const PIPELINE_LABELS: Record<Exclude<PipelineBucket, "sourced" | "rejected" | "other">, string> = {
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

export function canonicalStage(stageName: string | null | undefined): PipelineBucket {
  if (!stageName) return "other";
  const s = stageName.toLowerCase().trim();
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

// Builds a jobId → counts map by flattening every candidate's `jobs[]` array.
// Counts only the 5 pipeline stages we care about; "sourced" and "rejected" are ignored.
export function buildJobCounts(candidates: RFCandidate[]): Map<number, JobPipelineCounts> {
  const map = new Map<number, JobPipelineCounts>();
  for (const c of candidates) {
    const jobs = Array.isArray(c.jobs) ? c.jobs : [];
    for (const j of jobs) {
      if (typeof j?.job_id !== "number") continue;
      const bucket = canonicalStage(j.stage_name);
      const prev = map.get(j.job_id) ?? emptyJobCounts();
      switch (bucket) {
        case "submitted":
          prev.submitted += 1;
          prev.totalActive += 1;
          break;
        case "interviewing":
          prev.interviewing += 1;
          prev.totalActive += 1;
          break;
        case "offer":
          prev.offer += 1;
          prev.totalActive += 1;
          break;
        case "pending_start":
          prev.pendingStart += 1;
          prev.totalActive += 1;
          break;
        case "hired":
          prev.hired += 1;
          break;
        default:
          break;
      }
      map.set(j.job_id, prev);
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
  candidateLocation: string;
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
    const locationLabel = c.location
      ? c.location.location ??
        [c.location.city, c.location.state].filter(Boolean).join(", ")
      : "";

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
        candidateLocation: locationLabel ?? "",
      });
    }
  }
  return rows;
}

export function daysBetween(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diffMs = now.getTime() - t;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}
