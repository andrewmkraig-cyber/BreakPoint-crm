import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TheirStackProvider } from "@/lib/bd/theirstack-provider";
import { getBDSettings } from "@/lib/bd/bd-settings";
import type { DiscoveredCompany } from "@/lib/bd/job-discovery-provider";
import { syncClientSignals } from "@/lib/bd/client-signal-sync";
import { recoverDomain } from "@/lib/bd/discovered-company";
import { apolloResolveDomainByName, normalizeDomain } from "@/lib/bd/apollo-contacts";

export const dynamic = "force-dynamic";
// Safety margin only. The real fix for the 504 is the abort timeouts on the
// TheirStack/JSearch fetches and the wall-clock budget on the client-monitor
// sweep (theirstack-provider.ts, jsearch-provider.ts, client-signal-sync.ts);
// the discovery call itself is, and always was, a single TheirStack POST.
export const maxDuration = 120;

// FALLBACK role titles sent as job_title_or ONLY when no active saved
// search / vertical / per-vertical titles resolve (see resolveDiscoveryTitles
// below). The live path now reads the selected vertical's titles so the
// Verticals/Saved Search UI drives discovery. The big-4/agency exclusion, the
// company-name include/exclude, and the employee-count floor live in the
// TheirStack request body (theirstack-provider.ts) as proven server-side
// filters, so the cron no longer post-filters by company name or headcount.
const DISCOVERY_TITLES = [
  "Tax Manager",
  "Senior Tax Accountant",
  "Tax Senior",
  "Tax Supervisor",
];

type ResolvedTitles = {
  titles: string[];
  verticalId: string | null;
  savedSearchId: string | null;
  // The TheirStack saved-search id pasted on the Ace saved search. When set,
  // the provider replays that exact TheirStack search and ignores `titles`.
  theirstackSavedSearchId: string | null;
  // "theirstack-saved-search" = replay the pasted TheirStack saved search;
  // "vertical" = drove off the vertical's BdContactTargeting.primaryTitles;
  // "fallback-no-saved-search" / "fallback-no-titles" = used DISCOVERY_TITLES.
  source:
    | "theirstack-saved-search"
    | "vertical"
    | "fallback-no-saved-search"
    | "fallback-no-titles";
};

// Resolve what discovery should run, from the org's active saved search. This
// is the single resolution path for BOTH the 6 AM cron and "Run Discovery Now"
// (the manual trigger just GETs this same route), so the two can't drift.
// Precedence: (1) if the saved search has a TheirStack saved-search id, the
// provider replays that exact search; (2) else the vertical's
// BdContactTargeting.primaryTitles drive job_title_or; (3) else the hardcoded
// DISCOVERY_TITLES, so existing nationwide discovery keeps returning results.
// Location is untouched here (still nationwide); the saved-search
// locationOverride remains unwired.
async function resolveDiscoveryTitles(
  organizationId: string,
): Promise<ResolvedTitles> {
  // The active saved search picks the vertical that drives discovery. Ordered
  // by createdAt so a single-vertical org is unambiguous and a multi-vertical
  // org resolves deterministically.
  const savedSearch = await prisma.savedSearch.findFirst({
    where: { organizationId, active: true, vertical: { active: true } },
    orderBy: { createdAt: "asc" },
    select: { id: true, verticalId: true, theirstackSavedSearchId: true },
  });
  if (!savedSearch) {
    return {
      titles: DISCOVERY_TITLES,
      verticalId: null,
      savedSearchId: null,
      theirstackSavedSearchId: null,
      source: "fallback-no-saved-search",
    };
  }

  const theirstackSavedSearchId = savedSearch.theirstackSavedSearchId?.trim() || null;

  const targeting = await prisma.bdContactTargeting.findFirst({
    where: { organizationId, verticalId: savedSearch.verticalId },
    select: { primaryTitles: true },
  });
  const verticalTitles = (targeting?.primaryTitles ?? [])
    .map((t) => t.trim())
    .filter(Boolean);
  // titles are the fallback the provider uses ONLY when there is no TheirStack
  // saved-search id to replay; compute them either way so that path is covered.
  const titles = verticalTitles.length > 0 ? verticalTitles : DISCOVERY_TITLES;

  let source: ResolvedTitles["source"];
  if (theirstackSavedSearchId) source = "theirstack-saved-search";
  else if (verticalTitles.length > 0) source = "vertical";
  else source = "fallback-no-titles";

  return {
    titles,
    verticalId: savedSearch.verticalId,
    savedSearchId: savedSearch.id,
    theirstackSavedSearchId,
    source,
  };
}

const MAX_RESULTS = 25;
const DEDUP_WINDOW_DAYS = 30;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

function fingerprint(companyName: string, jobTitle: string): string {
  return `${companyName.trim().toLowerCase()}|${jobTitle.trim().toLowerCase()}`;
}

// Strip the common legal-entity tails so "Acme LLC" and "Acme Inc."
// fold to the same key as "Acme" when comparing against existing
// Client rows. Order matters: "& Associates" must come before "&"
// candidates so it strips as a unit.
const CLIENT_SUFFIX_PATTERNS = [
  /\s*&\s*associates\b/i,
  /\bp\s*l\s*l\s*c\b\.?/i,
  /\bllp\b\.?/i,
  /\bllc\b\.?/i,
  /\binc\b\.?/i,
  /\bpc\b\.?/i,
  /\bco\b\.?/i,
];

function normalizeClientName(name: string): string {
  let s = name.toLowerCase().trim();
  // Strip suffixes iteratively in case of stacks like "Foo LLC, Inc."
  for (const pat of CLIENT_SUFFIX_PATTERNS) {
    s = s.replace(pat, "");
  }
  // Collapse residual punctuation + whitespace so trailing commas
  // from a stripped suffix don't break the includes() comparison.
  s = s.replace(/[.,]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

function isExcludedByClients(companyName: string, clientNorms: string[]): boolean {
  const norm = normalizeClientName(companyName);
  if (!norm) return false;
  for (const client of clientNorms) {
    if (!client) continue;
    if (norm.includes(client) || client.includes(norm)) return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let organizationId = process.env.ORG_ID;
  if (!organizationId) {
    const firstOrg = await prisma.organization.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    organizationId = firstOrg?.id;
  }
  if (!organizationId) {
    return NextResponse.json(
      { ok: false, error: "No organization found and ORG_ID env var not set" },
      { status: 500 },
    );
  }

  const settings = await getBDSettings(organizationId);
  if (!settings.engineActive) {
    return NextResponse.json(
      { skipped: true, reason: "BD engine inactive" },
      { status: 200 },
    );
  }
  // Pause All (BdOrgConfig.pauseAll, Section 4 of /settings/bd) is the
  // recruiter's hard stop. getBDSettings already returns the full config
  // row, so this is a free read on top of the engineActive check above.
  // Both the scheduled cron and "Run Discovery Now" (triggerManualDiscovery
  // GETs this same route) bail here. The `error` field gives the manual
  // path a clean message, since it surfaces data.error on a runId-less reply.
  if (settings.pauseAll) {
    console.log(
      `[bd-discovery] skipped: pauseAll enabled for org=${organizationId}`,
    );
    return NextResponse.json(
      {
        skipped: true,
        reason: "BD paused (Pause All)",
        error:
          "BD is paused. Turn off Pause All in BD settings to run discovery.",
      },
      { status: 200 },
    );
  }

  // Manual "Run Discovery Now" overrides arrive as query params; the
  // scheduled cron passes none, so both fall back to today's behavior
  // (25 companies, enroll-time default of 4 contacts/company). Companies
  // is a free pull — overriding maxResults only changes how many jobs
  // TheirStack surfaces for approval, never the send budget. Clamp both
  // to sane ceilings so a typo can't fire an enormous request.
  const sp = req.nextUrl.searchParams;
  const companiesParam = Number.parseInt(sp.get("companies") ?? "", 10);
  const maxResults =
    Number.isFinite(companiesParam) && companiesParam > 0
      ? Math.min(companiesParam, 200)
      : MAX_RESULTS;
  const perCompanyParam = Number.parseInt(sp.get("maxContactsPerCompany") ?? "", 10);
  const maxContactsPerCompany =
    Number.isFinite(perCompanyParam) && perCompanyParam > 0
      ? Math.min(perCompanyParam, 100)
      : null;
  // "Run Discovery Now" sets manual=1; the scheduled cron sends no params. The
  // per-client-domain client-signal sweep is daily-cron-only, so a manual run
  // does the main job search and nothing else (zero client-signal calls).
  const isManual = sp.get("manual") === "1";

  const lastRun = await prisma.bDRun.findFirst({
    where: {
      organizationId,
      status: { in: ["AWAITING_APPROVAL", "COMPLETE"] },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const postedSince = lastRun?.createdAt ?? undefined;

  const clients = await prisma.client.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });
  // Map each normalized client name back to a `{id, name}` pair so a
  // fuzzy hit on the discovery side can resolve to the actual Client
  // row when writing ClientSignal. Order is stable for deterministic
  // first-match wins on the rare normalization collision.
  const clientNormPairs: { id: string; name: string; norm: string }[] = [];
  const clientNormSet = new Set<string>();
  for (const c of clients) {
    const norm = normalizeClientName(c.name);
    if (!norm) continue;
    clientNormSet.add(norm);
    clientNormPairs.push({ id: c.id, name: c.name, norm });
  }
  const clientNorms = Array.from(clientNormSet);

  function resolveClientMatch(companyName: string): { id: string; name: string } | null {
    const norm = normalizeClientName(companyName);
    if (!norm) return null;
    for (const cp of clientNormPairs) {
      if (norm.includes(cp.norm) || cp.norm.includes(norm)) {
        return { id: cp.id, name: cp.name };
      }
    }
    return null;
  }

  const dedupSet = new Set<string>();
  const windowStart = new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentRuns = await prisma.bDRun.findMany({
    where: { organizationId, createdAt: { gte: windowStart } },
    select: { discoveredPayload: true },
  });
  for (const r of recentRuns) {
    const payload = r.discoveredPayload;
    if (!Array.isArray(payload)) continue;
    for (const item of payload) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const name = typeof obj.companyName === "string" ? obj.companyName : "";
      const title = typeof obj.jobTitle === "string" ? obj.jobTitle : "";
      if (name && title) dedupSet.add(fingerprint(name, title));
    }
  }

  // Read the selected vertical's titles (cron + manual share this one path).
  // Stamp the resolved vertical/savedSearch onto the run so the enroll path
  // (which loads BDRun.verticalId for its contact targeting) and the campaign
  // history stay tied to the same vertical instead of the cron's old null.
  const resolved = await resolveDiscoveryTitles(organizationId);

  const run = await prisma.bDRun.create({
    data: {
      organizationId,
      status: "RUNNING",
      discoveryProvider: "theirstack",
      startedAt: new Date(),
      maxContactsPerCompany,
      verticalId: resolved.verticalId,
      savedSearchId: resolved.savedSearchId,
    },
  });

  console.log(
    `[bd-discovery] runId=${run.id} titlesSource=${resolved.source} titleCount=${resolved.titles.length} theirstackSavedSearchId=${resolved.theirstackSavedSearchId ?? "none"} verticalId=${resolved.verticalId ?? "none"}`,
  );

  try {
    const raw = await new TheirStackProvider().discoverJobs({
      verticals: resolved.titles,
      locations: [],
      maxResults,
      postedSince,
      theirstackSavedSearchId: resolved.theirstackSavedSearchId,
    });

    // Big-4/agency exclusion and the employee-count floor are now done
    // server-side in the TheirStack request body, so the only post-filters
    // left here are the 30-day dedup and the client-signal routing below.
    let dedupFilteredCount = 0;
    const afterDedup = raw.filter((r) => {
      if (dedupSet.has(fingerprint(r.companyName, r.jobTitle))) {
        dedupFilteredCount++;
        return false;
      }
      return true;
    });

    // Client matches used to be dropped here. Now they're routed to
    // ClientSignal so the recruiter sees "these clients are hiring
    // publicly — reach out before someone else does". `clientId` is
    // set when the fuzzy match resolved to a Client row; left null on
    // a soft match where the resolver couldn't pick a single client.
    let clientExcludedCount = 0;
    const clientSignalCandidates: { row: DiscoveredCompany; clientId: string | null }[] = [];
    const afterClientExclusion: DiscoveredCompany[] = afterDedup.filter((r) => {
      if (isExcludedByClients(r.companyName, clientNorms)) {
        clientExcludedCount++;
        const match = resolveClientMatch(r.companyName);
        clientSignalCandidates.push({ row: r, clientId: match?.id ?? null });
        return false;
      }
      return true;
    });

    let clientSignalsWritten = 0;
    for (const { row, clientId } of clientSignalCandidates) {
      const postedAtRaw = (row.rawPayload && typeof row.rawPayload === "object")
        ? (row.rawPayload as Record<string, unknown>).date_posted ??
          (row.rawPayload as Record<string, unknown>).posted_at ??
          (row.rawPayload as Record<string, unknown>).datePosted ??
          null
        : null;
      const postedAt =
        typeof postedAtRaw === "string" && !Number.isNaN(Date.parse(postedAtRaw))
          ? new Date(postedAtRaw)
          : null;
      try {
        await prisma.clientSignal.upsert({
          where: {
            organizationId_companyName_jobTitle: {
              organizationId,
              companyName: row.companyName,
              jobTitle: row.jobTitle,
            },
          },
          update: {
            jobLocation: row.jobLocation || null,
            jobPostingUrl: row.jobPostingUrl ?? null,
            postedAt: postedAt ?? undefined,
            clientId: clientId ?? undefined,
            raw: (row.rawPayload as object) ?? undefined,
          },
          create: {
            organizationId,
            companyName: row.companyName,
            clientId,
            jobTitle: row.jobTitle,
            jobLocation: row.jobLocation || null,
            jobPostingUrl: row.jobPostingUrl ?? null,
            postedAt,
            raw: (row.rawPayload as object) ?? undefined,
          },
        });
        clientSignalsWritten++;
      } catch (sigErr) {
        console.error(
          `[bd-discovery] clientSignal upsert failed for ${row.companyName} / ${row.jobTitle}:`,
          sigErr instanceof Error ? sigErr.message : sigErr,
        );
      }
    }

    // Ensure every stored entry carries a usable domain so the queue-load
    // people search (fetchApolloContacts, keyed on domain + BD Settings
    // titles) actually runs instead of hitting the empty-domain skip. Prefer
    // the domain the provider/rawPayload already holds (recoverDomain), and
    // only when that's genuinely empty fall back to Apollo's name→domain
    // resolution. Normalize so dedup keys and the Apollo filter stay clean.
    let domainResolvedCount = 0;
    let domainMissingCount = 0;
    const withDomains: DiscoveredCompany[] = await Promise.all(
      afterClientExclusion.map(async (r) => {
        const recovered = normalizeDomain(
          recoverDomain(r as unknown as Record<string, unknown>),
        );
        if (recovered) return { ...r, domain: recovered };
        const resolved = await apolloResolveDomainByName(r.companyName);
        if (resolved) domainResolvedCount++;
        else domainMissingCount++;
        return { ...r, domain: resolved };
      }),
    );

    console.log(
      `[bd-discovery] runId=${run.id} raw=${raw.length} dedupFiltered=${dedupFilteredCount} clientExcluded=${clientExcludedCount} clientSignals=${clientSignalsWritten} final=${afterClientExclusion.length} domainResolvedByName=${domainResolvedCount} domainStillMissing=${domainMissingCount}`,
    );

    await prisma.bDRun.update({
      where: { id: run.id },
      data: {
        status: "AWAITING_APPROVAL",
        discoveredCount: withDomains.length,
        discoveredPayload: withDomains as unknown as object[],
        completedAt: new Date(),
      },
    });

    // Per-client-domain client-signal sweep. CRON-ONLY: the manual "Run
    // Discovery Now" path (manual=1) never runs it, so manual discovery makes
    // ZERO client-signal TheirStack calls. On the cron path, syncClientSignals
    // self-throttles to once per America/New_York calendar day, so a duplicate
    // cron fire the same day no-ops. Failures don't affect the discovery
    // result we already wrote.
    let clientMonitor: Awaited<ReturnType<typeof syncClientSignals>> = {
      clientsScanned: 0,
      postingsUpserted: 0,
      skipped: 0,
      fallbackClients: 0,
    };
    if (isManual) {
      console.log(
        `[bd-discovery] manual run — client-signal sweep skipped (cron-only)`,
      );
    } else {
      try {
        clientMonitor = await syncClientSignals(organizationId);
        console.log(
          `[bd-discovery] clientMonitor scanned=${clientMonitor.clientsScanned} upserted=${clientMonitor.postingsUpserted} skipped=${clientMonitor.skipped} fallback=${clientMonitor.fallbackClients}`,
        );
      } catch (monitorErr) {
        console.error(
          `[bd-discovery] clientMonitor sync failed:`,
          monitorErr instanceof Error ? monitorErr.message : monitorErr,
        );
      }
    }

    return NextResponse.json({
      runId: run.id,
      status: "AWAITING_APPROVAL",
      discoveredCount: afterClientExclusion.length,
      dedupFilteredCount,
      clientExcludedCount,
      clientSignalsWritten,
      clientMonitor,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[bd-discovery] runId=${run.id} failed:`, message);
    await prisma.bDRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage: message,
        completedAt: new Date(),
      },
    });
    return NextResponse.json(
      { runId: run.id, status: "FAILED", error: message },
      { status: 500 },
    );
  }
}
