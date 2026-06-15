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

// The sweep is gated to once per calendar day in this zone. The morning cron
// is the only caller, but a duplicate cron fire must not re-spend credits.
const SIGNAL_ZONE = "America/New_York";

// "YYYY-MM-DD" for a Date in America/New_York, so two timestamps on the same ET
// calendar day compare equal regardless of UTC offset / DST.
function easternDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SIGNAL_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

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
        // Client-monitor only needs a yes/no on whether each client is hiring.
        // TheirStack bills 1 credit per job returned, so cap at 1 result per
        // client (a 25-job Sheehan sweep was burning 25 credits for a boolean).
        // This is the per-client monitor call ONLY; the main discovery run's
        // limit lives in theirstack-provider.ts and stays at its own cap.
        limit: 1,
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

  // Stable id ordering so the rotating cursor below has a deterministic
  // sequence to resume within. cuid string order matches `orderBy id asc`.
  const allClients = await prisma.client.findMany({
    where: { organizationId },
    select: { id: true, name: true, domain: true },
    orderBy: { id: "asc" },
  });

  // Rotating cursor. The 20s budget means a large client book can't be
  // scanned in one sweep, so we resume after the last client examined and
  // wrap around — guaranteeing every client is eventually covered. The
  // cursor is reset to null once a sweep completes a full uninterrupted
  // loop (see the persist step after the loop).
  const config = await prisma.bdOrgConfig.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
    select: { lastSignalCursorId: true, lastClientMonitorAt: true },
  });

  // Once-per-ET-calendar-day guard. Cron is the only caller, but a duplicate
  // cron fire (or any re-trigger) the same day must not re-run the per-domain
  // TheirStack searches. No-op when we already ran today.
  const todayKey = easternDayKey(new Date());
  if (
    config.lastClientMonitorAt &&
    easternDayKey(config.lastClientMonitorAt) === todayKey
  ) {
    console.log(
      `[client-signal-sync] already ran today (${todayKey} ET); skipping per-domain searches`,
    );
    return { clientsScanned: 0, postingsUpserted: 0, skipped: 0, fallbackClients: 0 };
  }

  const cursor = config.lastSignalCursorId;
  let clients = allClients;
  if (cursor && allClients.length > 0) {
    // First client strictly after the cursor; -1 means the cursor was the
    // last id (or now points past the book), so we start from the top.
    const idx = allClients.findIndex((c) => c.id > cursor);
    const startAt = idx === -1 ? 0 : idx;
    clients = [...allClients.slice(startAt), ...allClients.slice(0, startAt)];
  }

  let clientsScanned = 0;
  let postingsUpserted = 0;
  let skipped = 0;
  let fallbackClients = 0;
  const now = new Date();
  const start = Date.now();
  // Last client we committed to examining this sweep (scanned or skipped).
  // Drives the persisted cursor. completedFullLoop flips false the moment
  // the budget truncates the sweep.
  let lastProcessedId: string | null = null;
  let completedFullLoop = true;

  for (const client of clients) {
    // Stop scanning new clients once the sweep has spent its wall-clock
    // budget. Discovery is already persisted and a partial sweep is
    // non-fatal, so this protects the shared cron invocation from N
    // sequential per-client calls overrunning the function limit.
    if (Date.now() - start > SYNC_BUDGET_MS) {
      completedFullLoop = false;
      console.warn(
        `[client-signal-sync] budget ${SYNC_BUDGET_MS}ms reached; stopped after scanning=${clientsScanned} of ${clients.length} clients`,
      );
      break;
    }
    // Advance the cursor for every client we reach, scanned or skipped, so
    // a run that stalls on a stretch of domain-less clients still makes
    // forward progress through the book.
    lastProcessedId = client.id;
    const domain = normalizeDomain(client.domain);
    if (!domain) {
      console.warn(
        `[client-signal-sync] skipping client="${client.name}" reason="no domain"`,
      );
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

  // Persist the rotating cursor. A full uninterrupted loop resets to null
  // so the next sweep starts from the top of the id order; a budget-
  // truncated sweep stores the last client examined so the next run
  // resumes after it and the rest of the book gets covered.
  const nextCursor = completedFullLoop ? null : lastProcessedId;
  try {
    await prisma.bdOrgConfig.update({
      where: { organizationId },
      // Stamp the ET-day marker so a same-day re-fire of the cron no-ops above.
      data: { lastSignalCursorId: nextCursor, lastClientMonitorAt: now },
    });
  } catch (err) {
    console.warn(
      `[client-signal-sync] failed to persist cursor (${nextCursor}):`,
      err instanceof Error ? err.message : err,
    );
  }

  return { clientsScanned, postingsUpserted, skipped, fallbackClients };
}
