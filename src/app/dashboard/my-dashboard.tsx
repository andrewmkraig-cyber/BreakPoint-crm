import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardAutoRefresh } from "@/app/dashboard/auto-refresh";
import { FinancialStrip } from "@/app/dashboard/financial-strip";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { ThisWeekWidget } from "@/app/dashboard/this-week-widget";
import { NewsFeed } from "@/components/news-feed";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getInvoiceSummary } from "@/lib/invoices";
import {
  clubhousePeriodRange,
  type ClubhousePeriod,
} from "@/app/dashboard/clubhouse-period";
import { ClubhousePeriodTabs } from "@/app/dashboard/clubhouse-period-tabs";
import {
  Building2,
  CalendarDays,
  DollarSign,
  FileSignature,
  Handshake,
  Send,
} from "lucide-react";

// Every count in the activity strip is ACTIVITY-based: it counts the
// stage transition that happened inside the selected window, NOT the
// current state of the placement. A candidate submitted Monday who
// got rejected Wednesday still counts as 1 in "Candidates submitted"
// for that week — the rejection doesn't remove them from the count.
export async function MyDashboard({
  period = "THIS_WEEK",
}: {
  period?: ClubhousePeriod;
} = {}) {
  const now = new Date();
  const {
    start: activityStart,
    endExclusive: activityEnd,
    eyebrowLabel: activityEyebrow,
  } = clubhousePeriodRange(period, now);

  const [org, session] = await Promise.all([
    getCurrentOrg(),
    getServerSession(authOptions),
  ]);
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
    invoiceSummary,
  ] = await Promise.all([
    prisma.client.count({
      where: { organizationId: org.id, createdAt: { gte: activityStart, lt: activityEnd } },
    }),
    prisma.actionLog.count({
      where: { actionType: "submit", organizationId: org.id, createdAt: { gte: activityStart, lt: activityEnd } },
    }),
    prisma.interview.count({
      where: { organizationId: org.id, createdAt: { gte: activityStart, lt: activityEnd } },
    }),
    prisma.placement.count({
      where: { organizationId: org.id, offerReceivedAt: { gte: activityStart, lt: activityEnd } },
    }),
    prisma.placement.count({
      where: { organizationId: org.id, placedAt: { gte: activityStart, lt: activityEnd } },
    }),
    prisma.clientAgreement.count({
      where: { organizationId: org.id, uploadedAt: { gte: activityStart, lt: activityEnd } },
    }),
    getInvoiceSummary(org.id),
  ]);

  // Revenue is cash actually collected this quarter — PAID invoices
  // whose paidAt landed in the window. Strictly invoice-level so a
  // $3,750 inst-2 collection moves Revenue by exactly $3,750, not by
  // the full placement value. Previously this also folded in
  // "uninvoiced placements" (placements with feeTotal but no Invoice
  // row), but the recruiter-side flow now creates Invoice rows at
  // Confirm Start (one per installment for custom-terms placements),
  // so the uninvoiced bucket is empty in practice and inflated the
  // tile when present.
  const revenueUsd = invoiceSummary.collectedThisQuarterCents / 100;
  const revenueCount = invoiceSummary.collectedThisQuarterCount;
  // Outstanding is invoice-level: DRAFT + SENT invoices due by end of
  // the current quarter, with isFuture=false so pre-staged inst-2/3
  // drafts don't show until they're ready to send. Collecting inst-2
  // subtracts exactly inst2Amount from this tile, leaving the rest of
  // the placement's installments in place.
  const outstandingUsd = invoiceSummary.currentQuarterOutstandingCents / 100;
  const outstandingCount = invoiceSummary.currentQuarterOutstandingCount;

  const Q2_GOAL_USD = 125_000;
  // Goal Progress denominator mirrors the Revenue tile so all three
  // tiles read off the same "earned this quarter" figure — switching
  // to billedThisQuarter (SENT + PAID) would let Goal % drift below
  // Revenue the moment an uninvoiced placement lands.
  const q2RevenuePct = Q2_GOAL_USD > 0 ? (revenueUsd / Q2_GOAL_USD) * 100 : 0;
  const currentQuarterLabel = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;

  return (
    <div className="flex w-full flex-col gap-6">
      <DashboardAutoRefresh />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          {activityEyebrow}
        </p>
        <ClubhousePeriodTabs period={period} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <KpiTile label="New Clients" value={newClientsCount} icon={Building2} live={newClientsCount > 0} />
        <KpiTile label="Agreements Signed" value={agreementsSignedCount} icon={FileSignature} live={agreementsSignedCount > 0} />
        <KpiTile label="Candidates Submitted" value={submitLogCount} icon={Send} live={submitLogCount > 0} />
        <KpiTile label="Interviews Scheduled" value={interviewsScheduledCount} icon={CalendarDays} live={interviewsScheduledCount > 0} />
        <KpiTile label="Offers Extended" value={offersExtendedCount} icon={DollarSign} live={offersExtendedCount > 0} />
        <KpiTile label="Placements Made" value={placementsMadeCount} icon={Handshake} live={placementsMadeCount > 0} />
      </div>

      <FinancialStrip
        revenueUsd={revenueUsd}
        revenueCount={revenueCount}
        outstandingUsd={outstandingUsd}
        outstandingCount={outstandingCount}
        goalUsd={Q2_GOAL_USD}
        goalPct={q2RevenuePct}
        currentQuarterLabel={currentQuarterLabel}
      />

      <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-5">
        <div className="h-full md:col-span-3">
          <ThisWeekWidget orgId={org.id} selfPerson={selfPerson} />
        </div>
        <div className="h-full md:col-span-2">
          <NewsFeed />
        </div>
      </div>
    </div>
  );
}
