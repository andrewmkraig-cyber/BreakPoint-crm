import type {
  DiscoveredCompany,
  DiscoveryParams,
  JobDiscoveryProvider,
} from "./job-discovery-provider";

const THEIRSTACK_ENDPOINT = "https://api.theirstack.com/v1/jobs/search";

// TheirStack now rejects any /jobs/search request that lacks at least one
// "mandatory" filter (posted_at_max_age_days / posted_at_gte / posted_at_lte /
// job_id_or / company_name_or / ...) with a 422. job_title_or and limit do not
// count. We therefore always send posted_at_max_age_days (integer days) so
// every call -- cron and Run Discovery Now -- satisfies the requirement.
// We deliberately do NOT send posted_at_gte: it is a date-only field, so the
// full ISO timestamp from postedSince 422s on every run after the first.
const DEFAULT_POSTED_MAX_AGE_DAYS = 7;
// Hard ceiling on the recency window. The window widens to "days since the
// last successful run" so a normal cadence never misses a posting, but a
// long gap between successful runs (sparse runs, an outage) would otherwise
// pull the window wide open and surface very old postings. Cap it at 14 days
// so the worst case is still recent.
const MAX_POSTED_MAX_AGE_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface TheirStackJob {
  company_name?: string;
  // TheirStack returns the company name as a plain STRING at `company`
  // (e.g. "HSBC"), with the structured record at `company_object`. The
  // older object-shaped `company` is kept in the union for other providers.
  company?: string | { name?: string; domain?: string; website?: string };
  company_object?: { name?: string; domain?: string; website?: string };
  company_domain?: string;
  domain?: string;
  job_title?: string;
  title?: string;
  job_location?: string;
  location?: string;
  url?: string;
  job_url?: string;
  apply_url?: string;
  [key: string]: unknown;
}

// `company` is a string on TheirStack jobs but an object on some other
// providers; pull `name`/`domain` only when it is actually an object.
function companyObjectField(
  company: TheirStackJob["company"],
  field: "name" | "domain" | "website",
): string | undefined {
  return company && typeof company === "object" ? company[field] : undefined;
}

export class TheirStackProvider implements JobDiscoveryProvider {
  async discoverJobs(params: DiscoveryParams): Promise<DiscoveredCompany[]> {
    const apiKey = process.env.THEIRSTACK_API_KEY;
    if (!apiKey) {
      throw new Error(
        "TheirStackProvider: THEIRSTACK_API_KEY is not set in environment",
      );
    }

    // Always present so TheirStack's mandatory-filter check passes. When we
    // have a postedSince anchor, widen the window to whole days since that
    // timestamp (min 1) so we don't miss anything posted since the last run;
    // otherwise fall back to the last-7-days default.
    let postedMaxAgeDays = DEFAULT_POSTED_MAX_AGE_DAYS;
    if (params.postedSince) {
      const days = Math.ceil((Date.now() - params.postedSince.getTime()) / MS_PER_DAY);
      if (Number.isFinite(days) && days >= 1) {
        // Cap at MAX_POSTED_MAX_AGE_DAYS so a sparse-run gap can never pull
        // very old postings into the batch.
        postedMaxAgeDays = Math.min(days, MAX_POSTED_MAX_AGE_DAYS);
      }
    }

    const body: Record<string, unknown> = {
      job_title_or: params.verticals,
      company_location_pattern_or: params.locations,
      limit: params.maxResults,
      posted_at_max_age_days: postedMaxAgeDays,
    };
    // posted_at_gte is intentionally NOT sent. TheirStack's posted_at_gte
    // is a date-only field; a full ISO timestamp (what postedSince would
    // serialize to) 422s on every run after the first. The always-present
    // posted_at_max_age_days above is the mandatory recency filter and is
    // already widened from postedSince at the top of this method, so the
    // window is covered without the timestamp param.
    if (typeof params.minRevenue === "number") {
      body.company_revenue_usd_gte = params.minRevenue;
    }

    const res = await fetch(THEIRSTACK_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `TheirStackProvider: request failed ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
      );
    }

    const payload = (await res.json()) as { data?: TheirStackJob[] } | TheirStackJob[];
    const rows: TheirStackJob[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

    return rows.map((row) => ({
      companyName:
        row.company_name ??
        (typeof row.company === "string" ? row.company : undefined) ??
        row.company_object?.name ??
        companyObjectField(row.company, "name") ??
        "",
      domain:
        row.company_domain ??
        row.domain ??
        row.company_object?.domain ??
        row.company_object?.website ??
        companyObjectField(row.company, "domain") ??
        companyObjectField(row.company, "website") ??
        "",
      jobTitle: row.job_title ?? row.title ?? "",
      jobLocation: row.job_location ?? row.location ?? "",
      jobPostingUrl: row.url ?? row.job_url ?? row.apply_url,
      source: "theirstack",
      rawPayload: row,
    }));
  }
}
