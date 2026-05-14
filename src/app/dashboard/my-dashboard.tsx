import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { FinancialStrip } from "@/app/dashboard/financial-strip";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { ThisWeekWidget } from "@/app/dashboard/this-week-widget";
import { NewsFeed } from "@/components/news-feed";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getInvoiceSummary } from "@/lib/invoices";
import { getEasternWeekBounds, formatEasternWeekRange } from "@/lib/week";
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
    getInvoiceSummary(org.id),
  ]);

  const billedThisQuarterUsd = invoiceSummary.billedThisQuarterCents / 100;
  const cashCollectedUsd = invoiceSummary.collectedThisQuarterCents / 100;
  const outstandingUsd = invoiceSummary.outstandingCents / 100;
  const outstandingCount = invoiceSummary.outstandingCount;
  const billedCount = invoiceSummary.billedThisQuarterCount;

  const Q2_GOAL_USD = 125_000;
  const q2RevenuePct = Q2_GOAL_USD > 0 ? (billedThisQuarterUsd / Q2_GOAL_USD) * 100 : 0;
  const currentQuarterLabel = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;

  const weekRange = formatEasternWeekRange(weekStart, weekEnd).replace(/^Week of /, "");
  const activityEyebrow = `ACTIVITY FOR WEEK OF ${weekRange}`.toUpperCase();

  return (
    <div className="flex w-full flex-col gap-6 pt-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
        {activityEyebrow}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
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
        billedCount={billedCount}
        goalUsd={Q2_GOAL_USD}
        goalPct={q2RevenuePct}
        currentQuarterLabel={currentQuarterLabel}
      />

      <div className="grid grid-cols-5 items-stretch gap-5">
        <div className="col-span-3 h-full">
          <ThisWeekWidget orgId={org.id} selfPerson={selfPerson} />
        </div>
        <div className="col-span-2 h-full">
          <NewsFeed />
        </div>
      </div>
    </div>
  );
}
