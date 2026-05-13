import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { FinancialStrip } from "@/app/dashboard/financial-strip";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { ThisWeekWidget } from "@/app/dashboard/this-week-widget";
import { NewsFeed } from "@/components/news-feed";
import { ownerKeyForCalendar } from "@/lib/calendar/owner-key";
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

// "Next in" copy bucketed so a multi-day-out event renders as "2 days"
// rather than "2742 min". Mirrors the helper in this-week-widget.tsx
// so the welcome-row meta stays in sync with the widget below.
function formatNextIn(now: Date, then: Date): string | null {
  const diffMs = then.getTime() - now.getTime();
  if (diffMs <= 0) return null;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin} min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffMin < 24 * 60) return `${diffHr} hr`;
  const diffDays = Math.round(diffMin / (24 * 60));
  return `${diffDays} day${diffDays === 1 ? "" : "s"}`;
}

function formatShortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

// Every count in the "This week" strip is ACTIVITY-based: it counts
// the stage transition that happened in the last 7 days, NOT the
// current state of the placement. A candidate submitted Monday who
// got rejected Wednesday still counts as 1 in "Candidates submitted"
// for that week — the rejection doesn't remove them from the count.
export async function MyDashboard() {
  const now = new Date();
  const { start: weekStart, end: weekEnd } = getEasternWeekBounds(now);
  // Calendar strip only renders Mon–Fri; mirror that window so the
  // welcome meta count matches what the 5-day tile row displays.
  const calWeekEnd = new Date(weekStart.getTime() + 5 * 24 * 60 * 60 * 1000);

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
    invoiceSummary,
    calendarRows,
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
    prisma.calendarEvent.findMany({
      where: {
        organizationId: org.id,
        status: { not: "CANCELLED" },
        startTime: { gte: weekStart, lt: calWeekEnd },
      },
      orderBy: { startTime: "asc" },
      select: {
        id: true,
        startTime: true,
        calendarId: true,
        calendarName: true,
      },
    }),
  ]);

  const billedThisQuarterUsd = invoiceSummary.billedThisQuarterCents / 100;
  const cashCollectedUsd = invoiceSummary.collectedThisQuarterCents / 100;
  const outstandingUsd = invoiceSummary.outstandingCents / 100;
  const outstandingCount = invoiceSummary.outstandingCount;
  const billedCount = invoiceSummary.billedThisQuarterCount;

  const Q2_GOAL_USD = 125_000;
  const q2RevenuePct = Q2_GOAL_USD > 0 ? (billedThisQuarterUsd / Q2_GOAL_USD) * 100 : 0;
  const currentQuarterLabel = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;

  // Andrew-only filter matches the widget below so the welcome-row
  // count and "next in" marker stay coherent with the 5-day strip.
  const akEvents = calendarRows.filter(
    (r) =>
      ownerKeyForCalendar(
        { calendarId: r.calendarId, calendarName: r.calendarName },
        selfPerson,
      ) === "ak",
  );
  const weekEventCount = akEvents.length;
  const nextEvent = akEvents.find((e) => e.startTime.getTime() > now.getTime());
  const nextInLabel = nextEvent ? formatNextIn(now, nextEvent.startTime) : null;

  const greeting = firstName ? `Welcome back, ${firstName}.` : "Welcome back.";
  const weekRange = formatEasternWeekRange(weekStart, weekEnd);
  const todayShort = formatShortDate(now);

  return (
    <div className="flex w-full flex-col gap-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="min-w-0">
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
        <div className="hidden shrink-0 text-right text-[12.5px] text-court-fg-muted sm:block">
          <div className="text-[24px] font-bold tracking-[-0.01em] text-court-fg">
            {todayShort}
          </div>
          <div className="mt-0.5">
            {weekEventCount} event{weekEventCount === 1 ? "" : "s"} this week
            {nextInLabel != null && (
              <>
                {" · "}
                <span className="font-semibold text-court-brand-dark">
                  Next in {nextInLabel}
                </span>
              </>
            )}
          </div>
        </div>
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
