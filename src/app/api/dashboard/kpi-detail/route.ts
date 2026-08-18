import { NextRequest, NextResponse } from "next/server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { resolveTimeRange, timeRange } from "@/lib/time-range";

export const dynamic = "force-dynamic";

// Backs the Clubhouse KPI tile drill-down popups. Given a category +
// time range, returns the underlying rows that roll up into the six
// activity-strip counters (New Clients, Agreements Signed, Candidates
// Submitted, Interviews Scheduled, Offers Extended, Placements Made).
//
// Each branch reuses the EXACT same where-filter the tile count in
// src/app/dashboard/my-dashboard.tsx uses, swapping count() for
// findMany() so the row list length always equals the tile number. The
// window is resolved through the SAME timeRange() period math the tiles
// use (no second date logic) so the popup and the tile read the same
// {start, endExclusive} for any grain/offset.
//
// Query params:
//   category = new_clients | agreements_signed | candidates_submitted |
//              interviews_scheduled | offers_extended | placements_made
//   range    = encoded TimeRangeSelection, e.g. "week.0" / "quarter.-1"
//              (defaults to the current week, matching the strip default)
//
// Every read is org-scoped via getCurrentOrg() (Rule 8).

const CATEGORIES = [
  "new_clients",
  "agreements_signed",
  "candidates_submitted",
  "interviews_scheduled",
  "offers_extended",
  "placements_made",
] as const;
type Category = (typeof CATEGORIES)[number];

export type KpiDetailRow = {
  key: string;
  // Fully-formatted plain-text line per the category's spec format.
  text: string;
  primary?: string;
  detail?: string | null;
  meta?: string | null;
  // Link target (client or candidate page); null when the underlying
  // row can't resolve a destination (e.g. legacy RF rows with no cuid).
  href: string | null;
};

export type KpiDetailResponse = {
  rows: KpiDetailRow[];
  count: number;
};

const ET = "America/New_York";

// Candidate display name: full first + last name ("Caroline Chen").
function candLabel(
  c: { firstName: string; lastName: string | null } | null,
  rfId?: number | null,
): string {
  if (!c) return rfId != null ? `Candidate #${rfId}` : "Unknown candidate";
  const last = c.lastName?.trim();
  return last ? `${c.firstName} ${last}` : c.firstName;
}

function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

// "Jun 12, 2026". Its only caller passes expectedStartDate, a date-only column
// stored at midnight UTC — so this reads the day in UTC. Anchoring to Eastern
// (what this did before) shifted midnight UTC BACK to the previous evening and
// printed the day before the recruiter's chosen start date.
function shortDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

// "Jun 12, 2:00 PM" — interview date + time in Eastern.
function dateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

type SubmitMeta = {
  jobId?: unknown;
  clientId?: unknown;
  jobRfId?: unknown;
  clientRfId?: unknown;
  jobTitle?: unknown;
  clientName?: unknown;
};

function metaString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metaNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function rfIdFromSubject(subjectId: string | null | undefined): number | null {
  if (!subjectId || !/^-?\d+$/.test(subjectId)) return null;
  const n = Number(subjectId);
  return Number.isFinite(n) ? n : null;
}

function roleCompanyDetail(jobTitle?: string | null, clientName?: string | null): string | null {
  const job = jobTitle?.trim();
  const client = clientName?.trim();
  if (job && client) return `${job} at ${client}`;
  return job || client || null;
}

function detailText(primary: string, detail?: string | null, meta?: string | null): string {
  return [primary, detail, meta].filter((p): p is string => Boolean(p && p.trim())).join(" - ");
}

type PlacementFallbackRow = {
  candidateId: string | null;
  candidateRfId: number | null;
  jobId: string | null;
  jobRfId: number | null;
  clientId: string | null;
  clientRfId: number | null;
  stage: string;
  updatedAt: Date;
  job: { title: string; client: { name: string } | null } | null;
  client: { name: string } | null;
};

function sameCandidate(
  placement: PlacementFallbackRow,
  candidateId: string | null,
  candidateRfId: number | null,
): boolean {
  return Boolean(
    (candidateId && placement.candidateId === candidateId) ||
      (candidateRfId != null && placement.candidateRfId === candidateRfId),
  );
}

function pickPlacementFallback(
  placements: PlacementFallbackRow[],
  input: {
    candidateId?: string | null;
    candidateRfId?: number | null;
    jobId?: string | null;
    jobRfId?: number | null;
    clientId?: string | null;
    clientRfId?: number | null;
    anchor: Date;
    preferredStage?: string;
  },
): PlacementFallbackRow | null {
  const candidateId = input.candidateId ?? null;
  const candidateRfId = input.candidateRfId ?? null;
  const sameCandidatePlacements = placements.filter((p) =>
    sameCandidate(p, candidateId, candidateRfId),
  );
  if (sameCandidatePlacements.length === 0) return null;

  const exact = sameCandidatePlacements.find(
    (p) =>
      (input.jobId && p.jobId === input.jobId) ||
      (input.jobRfId != null && p.jobRfId === input.jobRfId) ||
      (input.clientId && p.clientId === input.clientId) ||
      (input.clientRfId != null && p.clientRfId === input.clientRfId),
  );
  if (exact) return exact;

  const stageMatches = input.preferredStage
    ? sameCandidatePlacements.filter((p) => p.stage === input.preferredStage)
    : [];
  const candidates = stageMatches.length > 0 ? stageMatches : sameCandidatePlacements;
  return candidates
    .slice()
    .sort(
      (a, b) =>
        Math.abs(a.updatedAt.getTime() - input.anchor.getTime()) -
        Math.abs(b.updatedAt.getTime() - input.anchor.getTime()),
    )[0] ?? null;
}

async function fetchPlacementFallbacks(
  orgId: string,
  candidateIds: Set<string>,
  candidateRfIds: Set<number>,
): Promise<PlacementFallbackRow[]> {
  const or: Array<{ candidateId: { in: string[] } } | { candidateRfId: { in: number[] } }> = [];
  if (candidateIds.size > 0) {
    or.push({ candidateId: { in: Array.from(candidateIds) } });
  }
  if (candidateRfIds.size > 0) {
    or.push({ candidateRfId: { in: Array.from(candidateRfIds) } });
  }
  if (or.length === 0) return [];

  return prisma.placement.findMany({
    where: { organizationId: orgId, OR: or },
    select: {
      candidateId: true,
      candidateRfId: true,
      jobId: true,
      jobRfId: true,
      clientId: true,
      clientRfId: true,
      stage: true,
      updatedAt: true,
      job: { select: { title: true, client: { select: { name: true } } } },
      client: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const categoryParam = url.searchParams.get("category");
  const rangeParam = url.searchParams.get("range");

  if (!CATEGORIES.includes(categoryParam as Category)) {
    return NextResponse.json({ error: "invalid category" }, { status: 400 });
  }
  const category = categoryParam as Category;

  const org = await getCurrentOrg();
  const now = new Date();
  // Same period math the tiles use; default to the current week (the
  // activity strip's default) when no/invalid range is supplied.
  const selection = resolveTimeRange(rangeParam, { grain: "WEEK", offset: 0 });
  const { start, endExclusive } = timeRange(selection, now);

  const rows = await buildRows(category, org.id, start, endExclusive);

  const body: KpiDetailResponse = { rows, count: rows.length };
  return NextResponse.json(body);
}

async function buildRows(
  category: Category,
  orgId: string,
  start: Date,
  endExclusive: Date,
): Promise<KpiDetailRow[]> {
  if (category === "new_clients") {
    const clients = await prisma.client.findMany({
      where: { organizationId: orgId, createdAt: { gte: start, lt: endExclusive } },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    });
    return clients.map((c) => ({
      key: c.id,
      text: c.name?.trim() || "(unnamed client)",
      href: `/clients/${c.id}`,
    }));
  }

  if (category === "agreements_signed") {
    const agreements = await prisma.clientAgreement.findMany({
      where: { organizationId: orgId, uploadedAt: { gte: start, lt: endExclusive } },
      select: {
        id: true,
        client: { select: { id: true, name: true, feePct: true } },
      },
      orderBy: { uploadedAt: "desc" },
    });
    return agreements.map((a) => {
      const name = a.client?.name?.trim() || "(client)";
      const pct = a.client?.feePct != null ? ` - ${a.client.feePct}%` : "";
      return {
        key: a.id,
        text: `${name}${pct}`,
        href: a.client ? `/clients/${a.client.id}` : null,
      };
    });
  }

  if (category === "candidates_submitted") {
    const logs = await prisma.actionLog.findMany({
      where: {
        actionType: "submit",
        organizationId: orgId,
        createdAt: { gte: start, lt: endExclusive },
      },
      select: { id: true, subjectId: true, metadata: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    // subjectId is the candidate cuid (Ace) or String(rfId) (legacy RF).
    // metadata carries either Ace cuids or legacy RF labels/ids depending on
    // which submit path wrote the log. Placement fallback covers older rows
    // where only the candidate linkage survived.
    const candIds = new Set<string>();
    const candRfIds = new Set<number>();
    const jobIds = new Set<string>();
    const clientIds = new Set<string>();
    for (const l of logs) {
      if (l.subjectId) candIds.add(l.subjectId);
      const rfId = rfIdFromSubject(l.subjectId);
      if (rfId != null) candRfIds.add(rfId);
      const meta = (l.metadata ?? {}) as SubmitMeta;
      const jobId = metaString(meta.jobId);
      const clientId = metaString(meta.clientId);
      if (jobId) jobIds.add(jobId);
      if (clientId) clientIds.add(clientId);
    }

    const candidateOr: Array<{ id: { in: string[] } } | { rfId: { in: number[] } }> = [];
    if (candIds.size > 0) candidateOr.push({ id: { in: Array.from(candIds) } });
    if (candRfIds.size > 0) candidateOr.push({ rfId: { in: Array.from(candRfIds) } });

    const [cands, jobs, clients, placementFallbacks] = await Promise.all([
      candidateOr.length > 0
        ? prisma.candidate.findMany({
            where: { organizationId: orgId, OR: candidateOr },
            select: { id: true, rfId: true, firstName: true, lastName: true },
          })
        : [],
      jobIds.size
        ? prisma.job.findMany({
            where: { organizationId: orgId, id: { in: Array.from(jobIds) } },
            select: { id: true, title: true },
          })
        : [],
      clientIds.size
        ? prisma.client.findMany({
            where: { organizationId: orgId, id: { in: Array.from(clientIds) } },
            select: { id: true, name: true },
          })
        : [],
      fetchPlacementFallbacks(orgId, candIds, candRfIds),
    ]);

    const candMap = new Map(cands.map((c) => [c.id, c]));
    const candRfMap = new Map(
      cands
        .filter((c) => c.rfId != null)
        .map((c) => [c.rfId as number, c]),
    );
    const jobMap = new Map(jobs.map((j) => [j.id, j.title]));
    const clientMap = new Map(clients.map((c) => [c.id, c.name]));

    return logs.map((l) => {
      const meta = (l.metadata ?? {}) as SubmitMeta;
      const subjectRfId = rfIdFromSubject(l.subjectId);
      const cand =
        candMap.get(l.subjectId) ??
        (subjectRfId != null ? candRfMap.get(subjectRfId) : null) ??
        null;
      const jobId = metaString(meta.jobId);
      const clientId = metaString(meta.clientId);
      const jobRfId = metaNumber(meta.jobRfId);
      const clientRfId = metaNumber(meta.clientRfId);
      const fallback = pickPlacementFallback(placementFallbacks, {
        candidateId: cand?.id ?? (subjectRfId == null ? l.subjectId : null),
        candidateRfId: cand?.rfId ?? subjectRfId,
        jobId,
        jobRfId,
        clientId,
        clientRfId,
        anchor: l.createdAt,
        preferredStage: "submitted",
      });
      const primary = candLabel(cand, subjectRfId);
      const jobTitle =
        metaString(meta.jobTitle) ?? (jobId ? jobMap.get(jobId) : null) ?? fallback?.job?.title ?? null;
      const clientName =
        metaString(meta.clientName) ??
        (clientId ? clientMap.get(clientId) : null) ??
        fallback?.client?.name ??
        fallback?.job?.client?.name ??
        null;
      const detail = roleCompanyDetail(jobTitle, clientName);
      return {
        key: l.id,
        text: detailText(primary, detail),
        primary,
        detail,
        href: cand ? `/candidates/${cand.id}` : null,
      };
    });
  }

  if (category === "interviews_scheduled") {
    const interviews = await prisma.interview.findMany({
      where: { organizationId: orgId, createdAt: { gte: start, lt: endExclusive } },
      select: {
        id: true,
        scheduledAt: true,
        createdAt: true,
        candidateId: true,
        candidateRfId: true,
        jobId: true,
        jobRfId: true,
        clientId: true,
        clientRfId: true,
        candidate: { select: { id: true, rfId: true, firstName: true, lastName: true } },
        client: { select: { name: true } },
        job: { select: { title: true, client: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    const candIds = new Set<string>();
    const candRfIds = new Set<number>();
    const jobRfIds = new Set<number>();
    const clientRfIds = new Set<number>();
    for (const iv of interviews) {
      if (iv.candidateId) candIds.add(iv.candidateId);
      if (iv.candidateRfId != null) candRfIds.add(iv.candidateRfId);
      if (iv.jobRfId != null) jobRfIds.add(iv.jobRfId);
      if (iv.clientRfId != null) clientRfIds.add(iv.clientRfId);
    }
    const [legacyJobs, legacyClients, placementFallbacks] = await Promise.all([
      jobRfIds.size
        ? prisma.job.findMany({
            where: { organizationId: orgId, legacyRfId: { in: Array.from(jobRfIds) } },
            select: { legacyRfId: true, title: true, client: { select: { name: true } } },
          })
        : [],
      clientRfIds.size
        ? prisma.client.findMany({
            where: { organizationId: orgId, legacyRfId: { in: Array.from(clientRfIds) } },
            select: { legacyRfId: true, name: true },
          })
        : [],
      fetchPlacementFallbacks(orgId, candIds, candRfIds),
    ]);
    const legacyJobMap = new Map(
      legacyJobs
        .filter((j) => j.legacyRfId != null)
        .map((j) => [j.legacyRfId as number, j]),
    );
    const legacyClientMap = new Map(
      legacyClients
        .filter((c) => c.legacyRfId != null)
        .map((c) => [c.legacyRfId as number, c.name]),
    );
    return interviews.map((iv) => {
      const fallback = pickPlacementFallback(placementFallbacks, {
        candidateId: iv.candidate?.id ?? iv.candidateId,
        candidateRfId: iv.candidate?.rfId ?? iv.candidateRfId,
        jobId: iv.jobId,
        jobRfId: iv.jobRfId,
        clientId: iv.clientId,
        clientRfId: iv.clientRfId,
        anchor: iv.createdAt,
        preferredStage: "interviewing",
      });
      const legacyJob = iv.jobRfId != null ? legacyJobMap.get(iv.jobRfId) : null;
      const primary = candLabel(iv.candidate, iv.candidateRfId);
      const jobTitle =
        iv.job?.title?.trim() || legacyJob?.title?.trim() || fallback?.job?.title || null;
      const clientName =
        iv.client?.name?.trim() ||
        iv.job?.client?.name?.trim() ||
        legacyJob?.client?.name?.trim() ||
        (iv.clientRfId != null ? legacyClientMap.get(iv.clientRfId) : null) ||
        fallback?.client?.name ||
        fallback?.job?.client?.name ||
        null;
      const detail = roleCompanyDetail(jobTitle, clientName);
      const meta = dateTime(iv.scheduledAt);
      return {
        key: iv.id,
        text: detailText(primary, detail, meta),
        primary,
        detail,
        meta,
        href: iv.candidate ? `/candidates/${iv.candidate.id}` : null,
      };
    });
  }

  if (category === "offers_extended") {
    const offers = await prisma.placement.findMany({
      where: {
        organizationId: orgId,
        offerReceivedAt: { gte: start, lt: endExclusive },
        stage: { not: "cancelled" },
      },
      select: {
        id: true,
        offerSalary: true,
        candidateRfId: true,
        candidate: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { offerReceivedAt: "desc" },
    });
    return offers.map((p) => ({
      key: p.id,
      text: `${candLabel(p.candidate, p.candidateRfId)} - ${usd(p.offerSalary)}`,
      href: p.candidate ? `/candidates/${p.candidate.id}` : null,
    }));
  }

  // placements_made
  const placements = await prisma.placement.findMany({
    where: {
      organizationId: orgId,
      placedAt: { gte: start, lt: endExclusive },
      stage: { not: "cancelled" },
    },
    select: {
      id: true,
      feeTotal: true,
      expectedStartDate: true,
      candidateRfId: true,
      candidate: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { placedAt: "desc" },
  });
  return placements.map((p) => ({
    key: p.id,
    text: `${candLabel(p.candidate, p.candidateRfId)} - ${usd(p.feeTotal)} - ${shortDate(
      p.expectedStartDate,
    )}`,
    href: p.candidate ? `/candidates/${p.candidate.id}` : null,
  }));
}
