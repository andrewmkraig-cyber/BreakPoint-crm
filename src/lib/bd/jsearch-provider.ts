// Fallback job-board lookup used by the Client Signal sync when
// TheirStack returns nothing for a given client domain. TheirStack
// doesn't index every external board (ZipRecruiter, smaller niche
// sites); JSearch wraps Indeed/LinkedIn/ZipRecruiter/etc. through
// RapidAPI so we get a second shot at surfacing the posting.
//
// Silent degrade: if JSEARCH_API_KEY is unset, the function returns []
// and the caller treats this client as "no postings found".

const JSEARCH_ENDPOINT = "https://jsearch.p.rapidapi.com/search";

export type JSearchPosting = {
  jobTitle: string;
  jobLocation: string | null;
  jobPostingUrl: string | null;
  postedAt: Date | null;
  raw: unknown;
};

type JSearchRaw = {
  employer_name?: string;
  employer_website?: string;
  job_title?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_apply_link?: string;
  job_offer_expiration_datetime_utc?: string;
  job_posted_at_datetime_utc?: string;
  job_posted_at_timestamp?: number;
};

type JSearchResponse = {
  status?: string;
  data?: JSearchRaw[];
};

function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return (
    trimmed
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .trim() || null
  );
}

function postingMatchesDomain(raw: JSearchRaw, needle: string): boolean {
  const empWeb = normalizeDomain(raw.employer_website);
  if (empWeb && empWeb === needle) return true;
  const applyHost = normalizeDomain(raw.job_apply_link);
  if (applyHost && applyHost === needle) return true;
  return false;
}

// Searches JSearch for the company name + "jobs" and filters returned
// rows to ones whose employer_website / apply link match the client's
// domain. Returns [] on missing key, transport failure, malformed
// payload, or zero matches — the sync always sees a clean array.
export async function fetchJSearchPostingsByDomain(input: {
  companyName: string;
  domain: string;
}): Promise<JSearchPosting[]> {
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey) return [];
  const norm = normalizeDomain(input.domain);
  if (!norm) return [];

  const url = new URL(JSEARCH_ENDPOINT);
  // The free-form query field is JSearch's only documented company
  // filter — pair the name with "jobs" so we don't pollute results
  // with company-profile rows.
  url.searchParams.set("query", `${input.companyName} jobs`);
  url.searchParams.set("page", "1");
  url.searchParams.set("num_pages", "1");
  url.searchParams.set("date_posted", "month");

  let payload: JSearchResponse | null = null;
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      },
      cache: "no-store",
    });
    if (!res.ok) return [];
    payload = (await res.json().catch(() => null)) as JSearchResponse | null;
  } catch {
    return [];
  }
  const rows = Array.isArray(payload?.data) ? payload!.data : [];
  if (rows.length === 0) return [];

  const out: JSearchPosting[] = [];
  for (const r of rows) {
    if (!postingMatchesDomain(r, norm)) continue;
    const title = (r.job_title ?? "").trim();
    if (!title) continue;
    const locParts = [r.job_city, r.job_state].filter((x): x is string => typeof x === "string" && x.length > 0);
    const location = locParts.length > 0 ? locParts.join(", ") : null;
    const apply = typeof r.job_apply_link === "string" && r.job_apply_link ? r.job_apply_link : null;
    let postedAt: Date | null = null;
    if (typeof r.job_posted_at_datetime_utc === "string" && !Number.isNaN(Date.parse(r.job_posted_at_datetime_utc))) {
      postedAt = new Date(r.job_posted_at_datetime_utc);
    } else if (typeof r.job_posted_at_timestamp === "number") {
      postedAt = new Date(r.job_posted_at_timestamp * 1000);
    }
    out.push({
      jobTitle: title,
      jobLocation: location,
      jobPostingUrl: apply,
      postedAt,
      raw: r,
    });
  }
  return out;
}
