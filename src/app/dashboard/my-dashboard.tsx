import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { BillingTower } from "@/app/dashboard/billing-tower";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { RevenueGoalTile } from "@/app/dashboard/revenue-goal-tile";
import { ThisWeekWidget } from "@/app/dashboard/this-week-widget";
import { NewsFeed } from "@/components/news-feed";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getInvoiceSummary } from "@/lib/invoices";
import { getEasternWeekBounds, formatEasternWeekRange } from "@/lib/week";
import { Prisma } from "@prisma/client";
import {
  Building2,
  CalendarDays,
  DollarSign,
  FileSignature,
  Handshake,
  Send,
} from "lucide-react";

// Every count in the "This week" strip is ACTIVITY-based: it counts
// the stage transition that happened in the last 7 days, NOT the
// current state of the placement. A candidate submitted Monday who
// got rejected Wednesday still counts as 1 in "Candidates submitted"
// for that week — the rejection doesn't remove them from the count.
export async function MyDashboard() {
  const now = new Date();
  const { start: weekStart, end: weekEnd } = getEasternWeekBounds(now);

  // Q2 2026 billed revenue: sum of feeTotal across placements whose expected
  // start date lands in the quarter. Only non-cancelled / non-rejected rows
  // count — the recruiter booked this revenue.
  const q2Start = new Date("2026-04-01T00:00:00.000Z");
  const q2EndExclusive = new Date("2026-07-01T00:00:00.000Z");

  // YTD billed revenue: SENT + PAID invoices whose sentAt lands in the
  // current calendar year. Matches the Q2 query in getInvoiceSummary
  // (SENT + PAID) but widened to the full year so the Annual Revenue
  // tile reflects every dollar Andrew has booked since Jan 1.
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEndExclusive = new Date(now.getFullYear() + 1, 0, 1);

  const [org, session] = await Promise.all([
    getCurrentOrg(),
    getServerSession(authOptions),
  ]);
  const firstName = session?.user?.name?.split(" ")[0]?.trim() ?? null;
  const selfPerson = {
    name: session?.user?.name ?? null,
    email: session?.user?.email ?? null,
  };

  const [
    newClientsCount,
    submitLogCount,
    interviewsScheduledCount,
    offersExtendedCount,
    placementsMadeCount,
    agreementsSignedCount,
    q2BilledRevenueAgg,
    invoiceSummary,
    ytdBilledInvoices,
  ] = await Promise.all([
    prisma.client.count({
      where: { organizationId: org.id, createdAt: { gte: weekStart, lt: weekEnd } },
    }),
    prisma.actionLog.count({
      where: { actionType: "submit", organizationId: org.id, createdAt: { gte: weekStart, lt: weekEnd } },
    }),
    prisma.interview.count({
      where: { organizationId: org.id, createdAt: { gte: weekStart, lt: weekEnd } },
    }),
    prisma.placement.count({
      where: { organizationId: org.id, offerReceivedAt: { gte: weekStart, lt: weekEnd } },
    }),
    prisma.placement.count({
      where: { organizationId: org.id, placedAt: { gte: weekStart, lt: weekEnd } },
    }),
    prisma.clientAgreement.count({
      where: { organizationId: org.id, uploadedAt: { gte: weekStart, lt: weekEnd } },
    }),
    prisma.placement.aggregate({
      _sum: { feeTotal: true },
      where: {
        organizationId: org.id,
        stage: { in: ["pending_start", "hired"] },
        expectedStartDate: { gte: q2Start, lt: q2EndExclusive },
      },
    }),
    getInvoiceSummary(org.id),
    prisma.invoice.findMany({
      where: {
        organizationId: org.id,
        status: { in: ["SENT", "PAID"] },
        sentAt: { gte: yearStart, lt: yearEndExclusive },
      },
      select: { feeAmount: true },
    }),
  ]);

  const ytdBilledRevenueCents = ytdBilledInvoices.reduce<number>((sum, row) => {
    if (row.feeAmount == null) return sum;
    const n = Number((row.feeAmount as Prisma.Decimal).toString());
    if (!Number.isFinite(n)) return sum;
    return sum + Math.round(n * 100);
  }, 0);
  const ytdBilledRevenueUsd = ytdBilledRevenueCents / 100;
  const q2BilledRevenueFromInvoicesUsd = invoiceSummary.billedThisQuarterCents / 100;

  const Q2_GOAL_USD = 125_000;
  const ANNUAL_GOAL_USD = 300_000;

  const greeting = firstName ? `Welcome back, ${firstName}.` : "Welcome back.";
  const weekRange = formatEasternWeekRange(weekStart, weekEnd);

  const q2RevenuePct = Q2_GOAL_USD > 0 ? (q2BilledRevenueFromInvoicesUsd / Q2_GOAL_USD) * 100 : 0;
  const annualRevenuePct = ANNUAL_GOAL_USD > 0 ? (ytdBilledRevenueUsd / ANNUAL_GOAL_USD) * 100 : 0;

  return (
    <div className="flex w-full flex-col gap-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
            This Week
          </p>
          <h2 className="mt-1 font-serif text-2xl font-extrabold tracking-tight text-court-fg sm:text-3xl">
            {greeting}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-court-fg-muted">
            Activity for {weekRange}. Everything here is live: no targets, just actuals.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <KpiTile label="New Clients" value={newClientsCount} icon={Building2} />
        <KpiTile label="Agreements Signed" value={agreementsSignedCount} icon={FileSignature} />
        <KpiTile label="Candidates Submitted" value={submitLogCount} icon={Send} />
        <KpiTile label="Interviews Scheduled" value={interviewsScheduledCount} icon={CalendarDays} />
        <KpiTile label="Offers Extended" value={offersExtendedCount} icon={DollarSign} />
        <KpiTile label="Placements Made" value={placementsMadeCount} icon={Handshake} />
      </div>

      <div className="grid grid-cols-2 items-stretch gap-5">
        <div className="flex flex-col gap-3">
          <BillingTower
            q2BilledRevenueUsd={q2BilledRevenueAgg._sum.feeTotal ?? 0}
            cashCollectedQtdUsd={invoiceSummary.collectedThisQuarterCents / 100}
          />
          <div className="grid grid-cols-2 gap-3">
            <RevenueGoalTile
              label="Q2 Revenue"
              valueLabel={formatCompactUsd(q2BilledRevenueFromInvoicesUsd)}
              goalLabel={`of ${formatGoalUsd(Q2_GOAL_USD)} goal`}
              pct={q2RevenuePct}
            />
            <RevenueGoalTile
              label="Annual Revenue"
              valueLabel={formatCompactUsd(ytdBilledRevenueUsd)}
              goalLabel={`of ${formatGoalUsd(ANNUAL_GOAL_USD)} goal`}
              pct={annualRevenuePct}
            />
          </div>
        </div>
        <NewsFeed />
      </div>

      <ThisWeekWidget orgId={org.id} selfPerson={selfPerson} />
    </div>
  );
}

// Match the Billing Tower's compact USD style so the new tiles read in
// the same shorthand. Big values render as "$7.5K" / "$1.2M"; sub-1K
// drops to the plain integer so an empty quarter shows "$0" not "$0K".
function formatCompactUsd(amount: number): string {
  if (amount === 0) return "$0";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    return `$${(amount / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `$${Math.round(amount)}`;
}

// Goal numbers are static and recruiter-facing — render the full
// comma-separated dollars ("$125,000") rather than the compact form so
// the subline reads explicitly.
function formatGoalUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}
