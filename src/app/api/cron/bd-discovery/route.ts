import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TheirStackProvider } from "@/lib/bd/theirstack-provider";
import { getBDSettings } from "@/lib/bd/bd-settings";
import type { DiscoveredCompany } from "@/lib/bd/job-discovery-provider";
import { syncClientSignals } from "@/lib/bd/client-signal-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DISCOVERY_TITLES = [
  "Tax Manager",
  "Senior Tax Accountant",
  "Tax Senior",
  "Tax Supervisor",
  "Audit Senior",
  "Audit Supervisor",
  "Audit Manager",
];

const BIG4_AND_CONSULTING = [
  "Deloitte",
  "PwC",
  "Ernst & Young",
  "EY",
  "KPMG",
  "Accenture",
];

const STAFFING_KEYWORDS = [
  "Staffing",
  "Recruiting",
  "Talent",
  "Search Group",
  "Search Firm",
  "Placement",
  "Headhunt",
];

const MIN_HEADCOUNT = 10;
const MAX_HEADCOUNT = 300;
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

function nameMatchesAny(name: string, keywords: string[]): boolean {
  const lower = name.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
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

function extractEmployeeCount(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidateFields = [
    r.company_employee_count,
    r.num_employees,
    r.employee_count,
    r.employees,
  ];
  const company = r.company;
  if (company && typeof company === "object") {
    const c = company as Record<string, unknown>;
    candidateFields.push(c.num_employees, c.employee_count, c.employees);
  }
  for (const v of candidateFields) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
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

  const run = await prisma.bDRun.create({
    data: {
      organizationId,
      status: "RUNNING",
      discoveryProvider: "theirstack",
      startedAt: new Date(),
      maxContactsPerCompany,
    },
  });

  try {
    const raw = await new TheirStackProvider().discoverJobs({
      verticals: DISCOVERY_TITLES,
      locations: [],
      maxResults,
      postedSince,
    });

    let excludedCount = 0;
    const afterExclusions = raw.filter((r) => {
      if (
        nameMatchesAny(r.companyName, BIG4_AND_CONSULTING) ||
        nameMatchesAny(r.companyName, STAFFING_KEYWORDS)
      ) {
        excludedCount++;
        return false;
      }
      return true;
    });

    let dedupFilteredCount = 0;
    const afterDedup = afterExclusions.filter((r) => {
      if (dedupSet.has(fingerprint(r.companyName, r.jobTitle))) {
        dedupFilteredCount++;
        return false;
      }
      return true;
    });

    const afterHeadcount: DiscoveredCompany[] = afterDedup.filter((r) => {
      const headcount = extractEmployeeCount(r.rawPayload);
      if (headcount == null) return true;
      return headcount >= MIN_HEADCOUNT && headcount <= MAX_HEADCOUNT;
    });

    // Client matches used to be dropped here. Now they're routed to
    // ClientSignal so the recruiter sees "these clients are hiring
    // publicly — reach out before someone else does". `clientId` is
    // set when the fuzzy match resolved to a Client row; left null on
    // a soft match where the resolver couldn't pick a single client.
    let clientExcludedCount = 0;
    const clientSignalCandidates: { row: DiscoveredCompany; clientId: string | null }[] = [];
    const afterClientExclusion: DiscoveredCompany[] = afterHeadcount.filter((r) => {
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

    console.log(
      `[bd-discovery] runId=${run.id} raw=${raw.length} excluded=${excludedCount} dedupFiltered=${dedupFilteredCount} clientExcluded=${clientExcludedCount} clientSignals=${clientSignalsWritten} final=${afterClientExclusion.length}`,
    );

    await prisma.bDRun.update({
      where: { id: run.id },
      data: {
        status: "AWAITING_APPROVAL",
        discoveredCount: afterClientExclusion.length,
        discoveredPayload: afterClientExclusion as unknown as object[],
        completedAt: new Date(),
      },
    });

    // Direct scan of existing clients runs on the same daily tick.
    // Failures don't affect the discovery result we already wrote.
    let clientMonitor: Awaited<ReturnType<typeof syncClientSignals>> = {
      clientsScanned: 0,
      postingsUpserted: 0,
      skipped: 0,
      fallbackClients: 0,
    };
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

    return NextResponse.json({
      runId: run.id,
      status: "AWAITING_APPROVAL",
      discoveredCount: afterClientExclusion.length,
      excludedCount,
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
