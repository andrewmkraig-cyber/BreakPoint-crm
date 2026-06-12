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

// "Jun 12, 2026" — anchored to Eastern so a UTC server doesn't shift the day.
function shortDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
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
      select: { id: true, subjectId: true, metadata: true },
      orderBy: { createdAt: "desc" },
    });

    // subjectId is the candidate cuid (Ace) or String(rfId) (legacy RF).
    // metadata carries the jobId / clientId cuids written at submit time.
    const candIds = new Set<string>();
    const jobIds = new Set<string>();
    const clientIds = new Set<string>();
    for (const l of logs) {
      if (l.subjectId) candIds.add(l.subjectId);
      const meta = (l.metadata ?? {}) as { jobId?: string | null; clientId?: string | null };
      if (meta.jobId) jobIds.add(meta.jobId);
      if (meta.clientId) clientIds.add(meta.clientId);
    }

    const [cands, jobs, clients] = await Promise.all([
      candIds.size
        ? prisma.candidate.findMany({
            where: { organizationId: orgId, id: { in: Array.from(candIds) } },
            select: { id: true, firstName: true, lastName: true },
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
    ]);

    const candMap = new Map(cands.map((c) => [c.id, c]));
    const jobMap = new Map(jobs.map((j) => [j.id, j.title]));
    const clientMap = new Map(clients.map((c) => [c.id, c.name]));

    return logs.map((l) => {
      const meta = (l.metadata ?? {}) as { jobId?: string | null; clientId?: string | null };
      const cand = candMap.get(l.subjectId) ?? null;
      const parts = [
        candLabel(cand),
        meta.jobId ? jobMap.get(meta.jobId) : null,
        meta.clientId ? clientMap.get(meta.clientId) : null,
      ].filter((p): p is string => Boolean(p && p.trim()));
      return {
        key: l.id,
        text: parts.join(" - "),
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
        candidateRfId: true,
        candidate: { select: { id: true, firstName: true, lastName: true } },
        client: { select: { name: true } },
        job: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return interviews.map((iv) => {
      const parts = [
        candLabel(iv.candidate, iv.candidateRfId),
        iv.job?.title?.trim() || null,
        iv.client?.name?.trim() || null,
        dateTime(iv.scheduledAt),
      ].filter((p): p is string => Boolean(p));
      return {
        key: iv.id,
        text: parts.join(" - "),
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
