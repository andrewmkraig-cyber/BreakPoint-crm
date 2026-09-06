import { NextRequest, NextResponse } from "next/server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  getBillingEventsForRange,
  type BillingEventStatus,
  type BillingEventWithPlacement,
} from "@/lib/billing-events";
import { resolveTimeRange, timeRange } from "@/lib/time-range";
// Same formatter the Billing Tower tiles use, so a row, this popup's
// total and the number that opened it are the same string of digits.
import { formatUsdExactFromCents } from "@/lib/money";

export const dynamic = "force-dynamic";

// Backs the Clubhouse Billing Tower drill-down popups — the sibling of
// /api/dashboard/kpi-detail, which does the same job for the six activity
// tiles above the tower.
//
// Given a kind + time range, returns the individual billing events that
// roll up into the tower's Revenue and Outstanding numbers. Both kinds read
// getBillingEventsForRange, the SAME helper getBillingSummaryForRange totals,
// so the row list always reconciles to the number that opened it:
//
//   revenue     — every event in the window (paid + unpaid)
//   outstanding — the status !== "paid" subset of the same list
//
// Query params:
//   kind  = revenue | outstanding
//   range = encoded TimeRangeSelection, e.g. "quarter.0" / "year.0"
//           (defaults to the current quarter, the tower's default window)
//
// Every read is org-scoped via getCurrentOrg() (Rule 8).

const KINDS = ["revenue", "outstanding"] as const;
type Kind = (typeof KINDS)[number];

export type BillingDetailRow = {
  key: string;
  // Candidate name — the row's headline.
  title: string;
  // "Client - Job title", blank when neither resolves.
  subtitle: string;
  // "$8,750"
  amountLabel: string;
  // "Aug 12, 2026" — when this dollar lands on the books.
  dateLabel: string;
  // "Paid" / "Invoice sent" / "Draft invoice" / "Scheduled" / …
  statusLabel: string;
  paid: boolean;
  // Candidate page, or null when the placement has no Ace-native candidate.
  href: string | null;
};

export type BillingDetailResponse = {
  rows: BillingDetailRow[];
  count: number;
  // Sum of the returned rows, formatted. Lets the popup header prove it
  // reconciles to the tower tile without the client re-adding cents.
  totalLabel: string;
  // "Q3 2026" / "YTD 2026"
  periodLabel: string;
};

const ET = "America/New_York";

// Plain-English status wording. The internal taxonomy is documented in
// billing-events.ts; these are the recruiter-facing labels.
const STATUS_LABEL: Record<BillingEventStatus, string> = {
  paid: "Paid",
  sent: "Invoice sent",
  draft: "Draft invoice",
  future_draft: "Scheduled invoice",
  scheduled: "Not invoiced yet",
};

function candLabel(
  c: { firstName: string; lastName: string | null } | null,
  rfId?: number | null,
): string {
  if (!c) return rfId != null ? `Candidate #${rfId}` : "Unknown candidate";
  const last = c.lastName?.trim();
  return last ? `${c.firstName} ${last}` : c.firstName;
}

// "Aug 12, 2026" — anchored to Eastern so a UTC server doesn't shift the day.
function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  const rangeParam = url.searchParams.get("range");

  if (!KINDS.includes(kindParam as Kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  const kind = kindParam as Kind;

  const org = await getCurrentOrg();
  const now = new Date();
  // Same period math the tower uses; default to the current quarter (the
  // tower's default window) when no/invalid range is supplied.
  const selection = resolveTimeRange(rangeParam, { grain: "QUARTER", offset: 0 });
  const { start, endExclusive, label } = timeRange(selection, now);

  const events = await getBillingEventsForRange(org.id, start, endExclusive, prisma);
  // Outstanding is the unpaid subset of Revenue — the exact same split
  // getBillingSummaryForRange applies when it totals the two tiles.
  const scoped =
    kind === "outstanding" ? events.filter((e) => e.status !== "paid") : events;

  // Soonest-first: the tower is a forward-looking billing view, so the
  // next dollar to land reads at the top.
  const sorted = [...scoped].sort(
    (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
  );

  const totalCents = sorted.reduce((s, e) => s + e.amountCents, 0);

  const body: BillingDetailResponse = {
    rows: sorted.map(toRow),
    count: sorted.length,
    totalLabel: formatUsdExactFromCents(totalCents),
    periodLabel: label,
  };
  return NextResponse.json(body);
}

function toRow(e: BillingEventWithPlacement, i: number): BillingDetailRow {
  const p = e.placement;
  const subtitle = [p.client?.name?.trim(), p.job?.title?.trim()]
    .filter((s): s is string => Boolean(s))
    .join(" - ");
  return {
    // A placement can contribute several events (installments), so the
    // placement id alone is not unique — pair it with the index.
    key: `${p.id}:${e.invoiceId ?? e.source}:${i}`,
    title: candLabel(p.candidate, p.candidateRfId),
    subtitle,
    amountLabel: formatUsdExactFromCents(e.amountCents),
    // Always scheduledAt — that is the field the tower windows on, so this
    // is the date that actually put the row in the period being viewed.
    // Payment state is carried separately by statusLabel.
    dateLabel: shortDate(e.scheduledAt),
    statusLabel: STATUS_LABEL[e.status],
    paid: e.status === "paid",
    href: p.candidate ? `/candidates/${p.candidate.id}` : null,
  };
}
