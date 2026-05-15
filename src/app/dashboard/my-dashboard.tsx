import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
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

  const billedThisQuarterUsd = invoiceSummary.billedThisQuarterCents / 100;
  const cashCollectedUsd = invoiceSummary.collectedThisQuarterCents / 100;
  // Outstanding on the Clubhouse view is "money earned but not yet
  // collected" — fold uninvoiced placements (locked fee, no invoice
  // yet) in with SENT invoices so today's placement shows up the
  // instant it's recorded instead of waiting on the invoice flow.
  const outstandingUsd =
    (invoiceSummary.outstandingCents + invoiceSummary.pendingBillingCents) / 100;
  const outstandingCount =
    invoiceSummary.outstandingCount + invoiceSummary.pendingBillingCount;
  const collectedCount = invoiceSummary.collectedThisQuarterCount;

  const Q2_GOAL_USD = 125_000;
  const q2RevenuePct = Q2_GOAL_USD > 0 ? (billedThisQuarterUsd / Q2_GOAL_USD) * 100 : 0;
  const currentQuarterLabel = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          {activityEyebrow}
        </p>
        <ClubhousePeriodTabs period={period} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <KpiTile label="New Clients" value={newClientsCount} icon={Building2} live={newClientsCount > 0} />
        <KpiTile label="Agreements Signed" value={agreementsSignedCount} icon={FileSignature} live={agreementsSignedCount > 0} />
        <KpiTile label="Candidates Submitted" value={submitLogCount} icon={Send} live={submitLogCount > 0} />
        <KpiTile label="Interviews Scheduled" value={interviewsScheduledCount} icon={CalendarDays} live={interviewsScheduledCount > 0} />
        <KpiTile label="Offers Extended" value={offersExtendedCount} icon={DollarSign} live={offersExtendedCount > 0} />
        <KpiTile label="Placements Made" value={placementsMadeCount} icon={Handshake} live={placementsMadeCount > 0} />
      </div>

      <FinancialStrip
        billedThisQuarterUsd={billedThisQuarterUsd}
        cashCollectedUsd={cashCollectedUsd}
        outstandingUsd={outstandingUsd}
        outstandingCount={outstandingCount}
        collectedCount={collectedCount}
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
