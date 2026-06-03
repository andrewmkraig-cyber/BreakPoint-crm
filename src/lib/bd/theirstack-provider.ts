import type {
  DiscoveredCompany,
  DiscoveryParams,
  JobDiscoveryProvider,
} from "./job-discovery-provider";

const THEIRSTACK_ENDPOINT = "https://api.theirstack.com/v1/jobs/search";

// TheirStack now rejects any /jobs/search request that lacks at least one
// "mandatory" filter (posted_at_max_age_days / posted_at_gte / posted_at_lte /
// job_id_or / company_name_or / ...) with a 422. job_title_or and limit do not
// count. posted_at_gte is only present when we have a prior run to anchor to,
// so it cannot be relied on for the first discovery. We therefore always send
// posted_at_max_age_days (integer days) so every call -- cron and Run Discovery
// Now -- satisfies the requirement.
const DEFAULT_POSTED_MAX_AGE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface TheirStackJob {
  company_name?: string;
  company?: { name?: string; domain?: string; website?: string };
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
        postedMaxAgeDays = days;
      }
    }

    const body: Record<string, unknown> = {
      job_title_or: params.verticals,
      company_location_pattern_or: params.locations,
      limit: params.maxResults,
      posted_at_max_age_days: postedMaxAgeDays,
    };
    if (params.postedSince) {
      body.posted_at_gte = params.postedSince.toISOString();
    }
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
      companyName: row.company_name ?? row.company?.name ?? "",
      domain: row.company_domain ?? row.domain ?? row.company?.domain ?? row.company?.website ?? "",
      jobTitle: row.job_title ?? row.title ?? "",
      jobLocation: row.job_location ?? row.location ?? "",
      jobPostingUrl: row.url ?? row.job_url ?? row.apply_url,
      source: "theirstack",
      rawPayload: row,
    }));
  }
}
