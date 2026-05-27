import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardAutoRefresh } from "@/app/dashboard/auto-refresh";
import { FinancialStrip } from "@/app/dashboard/financial-strip";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { ThisWeekWidget } from "@/app/dashboard/this-week-widget";
import { NewsFeed } from "@/components/news-feed";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getCurrentQuarterBillingSummary } from "@/lib/billing-events";
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
    billingSummary,
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
    getCurrentQuarterBillingSummary(org.id, now, prisma),
  ]);

  // Revenue is cash actually collected this quarter — paid billing
  // events bucketed by paidAt. Routed through the billing-events helper
  // for consistency with Outstanding + Goal Progress below; numerically
  // identical to the old getInvoiceSummary.collectedThisQuarterCents
  // read because only invoice-backed events ever reach status="paid".
  const revenueUsd = billingSummary.revenueCents / 100;
  const revenueCount = billingSummary.revenueCount;
  // Outstanding is unpaid $ coming due by end of quarter, INCLUDING
  // scheduled installments on custom-terms placements that haven't
  // had Confirm Start fire yet (Ethan's inst1=$3,750 lands here even
  // with zero Invoice rows). Collecting inst1 flips its event to
  // status="paid" → subtracts $3,750 from this tile and adds it to
  // Revenue above, leaving the rest of the placement's installments
  // in place.
  const outstandingUsd = billingSummary.outstandingCents / 100;
  const outstandingCount = billingSummary.outstandingCount;

  const Q2_GOAL_USD = 125_000;
  // Goal Progress reads "booked this quarter" — every billing event
  // (paid + scheduled + drafted + sent) bucketed by scheduledAt in
  // [qStart, qEnd). That's Revenue + the portion of Outstanding that
  // schedules within this quarter (excludes Outstanding amounts that
  // belong to a past quarter and just haven't been collected yet),
  // so the recruiter's read is "what work did I earn in this
  // quarter?" not "what cash came in?". Ethan's Q2 inst1 contributes
  // here even though Revenue doesn't move (he isn't paid yet).
  const bookedThisQuarterUsd = billingSummary.bookedCents / 100;
  const q2RevenuePct =
    Q2_GOAL_USD > 0 ? (bookedThisQuarterUsd / Q2_GOAL_USD) * 100 : 0;
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
