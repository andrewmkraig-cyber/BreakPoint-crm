import type {
  DiscoveredCompany,
  DiscoveryParams,
  JobDiscoveryProvider,
} from "./job-discovery-provider";

const THEIRSTACK_ENDPOINT = "https://api.theirstack.com/v1/jobs/search";

// Hard abort ceiling for the single discovery POST. TheirStack has been
// observed taking 42s+ on one request, which alone blows the cron's
// function budget. Abort at 25s so one slow response fails the run
// cleanly (caught by the route, marked FAILED with a clear message)
// instead of hanging until the platform 504s.
const THEIRSTACK_TIMEOUT_MS = 25_000;

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

// Fixed public-accounting filter set, validated live against the
// TheirStack /jobs/search API. These param names and values are exact;
// do not rename or normalize them. The role titles (job_title_or) and the
// result limit still come from the caller (the cron's DISCOVERY_TITLES and
// maxResults); everything below is the proven server-side filter that
// replaces the old JS post-filtering in the cron route.
//
// job_location_or is the US location TheirStack expects: an array holding a
// single { id } object. It is NOT a string and NOT a country code.
const JOB_TITLE_NOT = ["international", "M&A", "consultant", "corporate", "private"];
const JOB_LOCATION_OR = [{ id: 6252001 }];
const COMPANY_NAME_PARTIAL_MATCH_OR = [
  "CPA",
  "CPAs",
  "Certified Public Accountants",
  "Public Accountants",
  "Accountancy",
  "Accounting & Advisory",
  "Tax & Advisory",
  "Audit & Assurance",
  "Assurance",
  "Advisory Services",
  "Business Advisors",
  "Professional Services",
  "LLP",
  "PLLC",
  "Partners",
  "& Co.",
  "& Company",
  "Associates",
  "Group",
  "Firm",
  "Advisors",
  "Advisers",
  "Services Group",
  "Tax Services",
  "Accounting Services",
];
const COMPANY_NAME_PARTIAL_MATCH_NOT = [
  "recruiter",
  "recruitment",
  "consultants",
  "recruiting",
  "kpmg",
  "deloitte",
  "ey",
  "pwc",
  "international",
];
const COMPANY_ID_NOT = [
  "9trcU3IKUWbcTmr7BRisQQ==",
  "Ih2GPgyZGEXRsHdpDEArHA==",
  "wXu2OHHp69Ku5scBm3x5iQ==",
  "zscMff/ViJUt4UJ7eNYsuA==",
  "AdVU9cpoTXv0tPRU8lZ8kQ==",
];
const MIN_EMPLOYEE_COUNT = 10;

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
      job_title_not: JOB_TITLE_NOT,
      job_location_or: JOB_LOCATION_OR,
      company_name_partial_match_or: COMPANY_NAME_PARTIAL_MATCH_OR,
      company_name_partial_match_not: COMPANY_NAME_PARTIAL_MATCH_NOT,
      company_id_not: COMPANY_ID_NOT,
      min_employee_count: MIN_EMPLOYEE_COUNT,
      posted_at_max_age_days: postedMaxAgeDays,
      limit: params.maxResults,
      blur_company_data: false,
      include_total_results: false,
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

    // [bd-discovery][theirstack-body][diag] log the exact constructed body so
    // the param names + values can be eyeballed in prod logs against the live
    // TheirStack search. The API key rides in the Authorization header, not
    // the body, so this is safe to log. Remove once the query is confirmed.
    console.log(
      "[bd-discovery][theirstack-body][diag]",
      JSON.stringify(body),
    );

    // Abort the single discovery POST at THEIRSTACK_TIMEOUT_MS so one slow
    // response can never consume the whole cron budget. On abort we throw a
    // clear, distinct error that the route surfaces as the run's errorMessage.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), THEIRSTACK_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(THEIRSTACK_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `TheirStackProvider: request timed out after ${THEIRSTACK_TIMEOUT_MS / 1000}s`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

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
