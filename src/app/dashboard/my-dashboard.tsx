import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardAutoRefresh } from "@/app/dashboard/auto-refresh";
import { FinancialStrip } from "@/app/dashboard/financial-strip";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { ThisWeekWidget } from "@/app/dashboard/this-week-widget";
import { NewsFeed } from "@/components/news-feed";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getBillingTowerData } from "@/app/dashboard/billing-tower-actions";
import { TimeRangeTabs } from "@/components/ui/time-range-selector";
import {
  timeRange,
  timeRangeChrome,
  type TimeRangeSelection,
} from "@/lib/time-range";
import { CLUBHOUSE_PERIOD_PARAM } from "@/app/dashboard/clubhouse-period";
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
  selection = { grain: "WEEK", offset: 0 },
}: {
  selection?: TimeRangeSelection;
} = {}) {
  const now = new Date();
  const { start: activityStart, endExclusive: activityEnd } = timeRange(
    selection,
    now,
  );
  const { eyebrow: periodEyebrow, rangeLabel: periodLabel } = timeRangeChrome(
    selection,
    now,
  );

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
    billingTowerInitial,
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
      // Offers Extended KPI — cancelled placements shouldn't pad the
      // counter even if the offer was originally received in-window.
      where: {
        organizationId: org.id,
        offerReceivedAt: { gte: activityStart, lt: activityEnd },
        stage: { not: "cancelled" },
      },
    }),
    prisma.placement.count({
      // Placements Made KPI — same exclusion rationale.
      where: {
        organizationId: org.id,
        placedAt: { gte: activityStart, lt: activityEnd },
        stage: { not: "cancelled" },
      },
    }),
    prisma.clientAgreement.count({
      where: { organizationId: org.id, uploadedAt: { gte: activityStart, lt: activityEnd } },
    }),
    // Initial Billing Tower payload, rendered as Current Quarter.
    // FinancialStrip reuses this on first paint and only refetches
    // when the user picks a different period from the dropdown.
    // Calling the same server action the client uses keeps the
    // shape + math in one place.
    getBillingTowerData({ grain: "QUARTER", offset: 0 }),
  ]);

  const currentQuarterLabel = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;

  return (
    <div className="flex w-full flex-col gap-6">
      <DashboardAutoRefresh />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TimeRangeTabs
          value={selection}
          paramKey={CLUBHOUSE_PERIOD_PARAM}
          defaultSelection={{ grain: "WEEK", offset: 0 }}
          eyebrow={periodEyebrow}
          rangeLabel={periodLabel}
          maxOffset={0}
          ariaLabel="Activity period"
        />
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
        initial={billingTowerInitial}
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
