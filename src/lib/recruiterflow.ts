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

export type RFCandidate = {
  id: number;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string | string[];
  current_designation?: string;
  current_organization?: string;
  location?: RFLocation | null;
  linkedin_profile?: string | null;
  img_link?: string | null;
  added_time?: string;
  latest_activity_time?: string;
  last_contacted?: string | null;
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

export const recruiterflow = {
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
    if (Array.isArray(res)) return res;
    return res?.data ?? [];
  },
  async getCandidate(id: number): Promise<RFCandidate> {
    return rfFetch<RFCandidate>(`/candidate/${id}`);
  },
};

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
