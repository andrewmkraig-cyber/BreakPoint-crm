// Nightly scan of existing Client records against TheirStack. Distinct
// from the BD discovery cron, which only routes client-matched
// discovery hits into ClientSignal. This helper independently asks
// TheirStack "does this client have any public job postings right now?"
// for every Client with a usable domain, and upserts a ClientSignal row
// per posting with source="CLIENT_MONITOR".
//
// Called from /api/cron/bd-discovery alongside the discovery loop so we
// get one daily morning sweep without a second cron schedule.

import { prisma } from "@/lib/prisma";
import { fetchJSearchPostingsByDomain, type JSearchPosting } from "@/lib/bd/jsearch-provider";

const THEIRSTACK_ENDPOINT = "https://api.theirstack.com/v1/jobs/search";

// Per-client fetch abort ceiling. The monitor loops one TheirStack POST
// (then a JSearch fallback) per client; without a per-call ceiling a
// single slow client stalls the whole sweep. Abort each at 10s.
const CLIENT_FETCH_TIMEOUT_MS = 10_000;
// Wall-clock budget for the entire monitor sweep. Discovery has already
// been written to the DB (status AWAITING_APPROVAL) before this runs, and
// a partial sweep is non-fatal (next daily tick continues), so we stop
// scanning new clients once the sweep has run this long rather than let N
// sequential per-client calls push the invocation past its function limit.
const SYNC_BUDGET_MS = 20_000;

type TheirStackJob = {
  company_name?: string;
  company?: { name?: string; domain?: string };
  job_title?: string;
  title?: string;
  job_location?: string;
  location?: string;
  url?: string;
  job_url?: string;
  apply_url?: string;
  date_posted?: string;
  posted_at?: string;
  [key: string]: unknown;
};

function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim() || null;
}

async function fetchClientPostings(
  apiKey: string,
  domain: string,
): Promise<TheirStackJob[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLIENT_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(THEIRSTACK_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        company_domain_or: [domain],
        limit: 10,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) return [];
  const payload = (await res.json().catch(() => null)) as
    | { data?: TheirStackJob[] }
    | TheirStackJob[]
    | null;
  if (!payload) return [];
  const rows = Array.isArray(payload) ? payload : payload.data;
  return Array.isArray(rows) ? rows : [];
}

export type SyncClientSignalsResult = {
  clientsScanned: number;
  postingsUpserted: number;
  skipped: number;
  // Count of clients that landed on the JSearch fallback because
  // TheirStack returned no postings. Useful for dashboards / dry-runs
  // to spot how much coverage the secondary provider is buying.
  fallbackClients: number;
};

export async function syncClientSignals(
  organizationId: string,
): Promise<SyncClientSignalsResult> {
  const theirStackKey = process.env.THEIRSTACK_API_KEY ?? null;
  const jsearchKey = process.env.JSEARCH_API_KEY ?? null;
  // Skip entirely only when both providers are unconfigured — otherwise
  // run with whichever is available so a partially-keyed env still
  // surfaces something on the Client Signal page.
  if (!theirStackKey && !jsearchKey) {
    return { clientsScanned: 0, postingsUpserted: 0, skipped: 0, fallbackClients: 0 };
  }

  const clients = await prisma.client.findMany({
    where: { organizationId },
    select: { id: true, name: true, domain: true },
  });

  let clientsScanned = 0;
  let postingsUpserted = 0;
  let skipped = 0;
  let fallbackClients = 0;
  const now = new Date();
  const start = Date.now();

  for (const client of clients) {
    // Stop scanning new clients once the sweep has spent its wall-clock
    // budget. Discovery is already persisted and a partial sweep is
    // non-fatal, so this protects the shared cron invocation from N
    // sequential per-client calls overrunning the function limit.
    if (Date.now() - start > SYNC_BUDGET_MS) {
      console.warn(
        `[client-signal-sync] budget ${SYNC_BUDGET_MS}ms reached; stopped after scanning=${clientsScanned} of ${clients.length} clients`,
      );
      break;
    }
    const domain = normalizeDomain(client.domain);
    if (!domain) {
      skipped += 1;
      continue;
    }
    clientsScanned += 1;
    let postings: TheirStackJob[] = [];
    if (theirStackKey) {
      try {
        postings = await fetchClientPostings(theirStackKey, domain);
      } catch (err) {
        console.warn(
          `[client-signal-sync] TheirStack fetch failed for client=${client.name} domain=${domain}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // JSearch fallback. Runs when TheirStack returned nothing (either
    // because it isn't keyed or because its index didn't carry this
    // company). JSearch wraps Indeed/LinkedIn/ZipRecruiter so it can
    // catch postings on boards TheirStack misses. Silent degrade when
    // JSEARCH_API_KEY isn't set or the lookup returns no domain match.
    let fallbackPostings: JSearchPosting[] = [];
    if (postings.length === 0 && jsearchKey) {
      try {
        fallbackPostings = await fetchJSearchPostingsByDomain({
          companyName: client.name,
          domain,
        });
        if (fallbackPostings.length > 0) fallbackClients += 1;
      } catch (err) {
        console.warn(
          `[client-signal-sync] JSearch fallback failed for client=${client.name} domain=${domain}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    for (const p of postings) {
      const jobTitle = (p.job_title ?? p.title ?? "").trim();
      if (!jobTitle) continue;
      const companyName = (p.company_name ?? p.company?.name ?? client.name).trim();
      const jobLocation = (p.job_location ?? p.location ?? "").trim() || null;
      const jobPostingUrl = p.url ?? p.job_url ?? p.apply_url ?? null;
      const postedAtRaw = p.date_posted ?? p.posted_at ?? null;
      const postedAt =
        typeof postedAtRaw === "string" && !Number.isNaN(Date.parse(postedAtRaw))
          ? new Date(postedAtRaw)
          : null;

      try {
        await prisma.clientSignal.upsert({
          where: {
            organizationId_companyName_jobTitle: {
              organizationId,
              companyName,
              jobTitle,
            },
          },
          update: {
            jobLocation,
            jobPostingUrl,
            postedAt: postedAt ?? undefined,
            clientId: client.id,
            raw: (p as object) ?? undefined,
            lastSeenAt: now,
          },
          create: {
            organizationId,
            companyName,
            clientId: client.id,
            jobTitle,
            jobLocation,
            jobPostingUrl,
            postedAt,
            raw: (p as object) ?? undefined,
            source: "CLIENT_MONITOR",
            lastSeenAt: now,
          },
        });
        postingsUpserted += 1;
      } catch (err) {
        console.error(
          `[client-signal-sync] upsert failed for ${companyName} / ${jobTitle}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Upsert JSearch fallback postings using the same CLIENT_MONITOR
    // source — UI doesn't distinguish providers, the recruiter just
    // sees that this client has a public posting we should act on.
    for (const p of fallbackPostings) {
      try {
        await prisma.clientSignal.upsert({
          where: {
            organizationId_companyName_jobTitle: {
              organizationId,
              companyName: client.name,
              jobTitle: p.jobTitle,
            },
          },
          update: {
            jobLocation: p.jobLocation,
            jobPostingUrl: p.jobPostingUrl,
            postedAt: p.postedAt ?? undefined,
            clientId: client.id,
            raw: (p.raw as object) ?? undefined,
            lastSeenAt: now,
          },
          create: {
            organizationId,
            companyName: client.name,
            clientId: client.id,
            jobTitle: p.jobTitle,
            jobLocation: p.jobLocation,
            jobPostingUrl: p.jobPostingUrl,
            postedAt: p.postedAt,
            raw: (p.raw as object) ?? undefined,
            source: "CLIENT_MONITOR",
            lastSeenAt: now,
          },
        });
        postingsUpserted += 1;
      } catch (err) {
        console.error(
          `[client-signal-sync] JSearch upsert failed for ${client.name} / ${p.jobTitle}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return { clientsScanned, postingsUpserted, skipped, fallbackClients };
}
