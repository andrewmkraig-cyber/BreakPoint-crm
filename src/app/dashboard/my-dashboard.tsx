import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { BillingTower } from "@/app/dashboard/billing-tower";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { UpcomingInterviews, type UpcomingInterviewRow } from "@/app/dashboard/upcoming-interviews";
import { NewsFeed } from "@/components/news-feed";
import { prisma } from "@/lib/prisma";
import { normalizeJob, normalizeClient } from "@/lib/rf-payload-shapes";
import { getRfCandidatesForOrg, getRfClientsForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { getInterviewsForOrg } from "@/lib/interviews";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { formatUpcomingInterviewWhen } from "@/lib/interview-format";
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
// Exception: "Upcoming interviews" (below the strip) is state-based
// and shows only non-cancelled interviews in the next 7 days.
export async function MyDashboard() {
  const now = new Date();
  const { start: weekStart, end: weekEnd } = getEasternWeekBounds(now);
  const upcomingWindowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Q2 2026 billed revenue: sum of feeTotal across placements whose expected
  // start date lands in the quarter. Only non-cancelled / non-rejected rows
  // count — the recruiter booked this revenue.
  const q2Start = new Date("2026-04-01T00:00:00.000Z");
  const q2EndExclusive = new Date("2026-07-01T00:00:00.000Z");

  const [org, session] = await Promise.all([
    getCurrentOrg(),
    getServerSession(authOptions),
  ]);
  const firstName = session?.user?.name?.split(" ")[0]?.trim() ?? null;

  const [
    upcomingInterviews,
    rfCandidates,
    rfJobs,
    rfClients,
    newClientsCount,
    submitLogCount,
    interviewsScheduledCount,
    offersExtendedCount,
    placementsMadeCount,
    agreementsSignedCount,
    q2BilledRevenueAgg,
  ] = await Promise.all([
    getInterviewsForOrg({
      statuses: ["scheduled"],
      scheduledAfter: now,
      scheduledBefore: upcomingWindowEnd,
    }),
    getRfCandidatesForOrg().catch(() => []),
    getRfJobsForOrg().catch(() => []),
    getRfClientsForOrg().catch(() => []),
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
  ]);

  const aceCandidateIds = Array.from(
    new Set(
      upcomingInterviews
        .filter((iv) => iv.candidateRfId == null && iv.candidateId)
        .map((iv) => iv.candidateId as string),
    ),
  );
  const aceCandidates = aceCandidateIds.length > 0
    ? await prisma.candidate.findMany({
        where: { id: { in: aceCandidateIds }, organizationId: org.id },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const aceCandidateById = new Map(aceCandidates.map((c) => [c.id, c]));
  const interviews = upcomingInterviews;

  const rfCandidateName = new Map<number, string>();
  for (const c of rfCandidates) {
    const name = c.name ?? [c.first_name, c.last_name].filter(Boolean).join(" ") ?? "(unnamed)";
    rfCandidateName.set(c.id, name);
  }
  const rfJobTitle = new Map<number, string>();
  for (const j of rfJobs) rfJobTitle.set(j.id, normalizeJob(j).title);
  const rfClientName = new Map<number, string>();
  for (const cl of rfClients) rfClientName.set(cl.id, normalizeClient(cl).name);

  const upcoming: UpcomingInterviewRow[] = interviews.map((iv) => {
    const aceCandidate = iv.candidateId ? aceCandidateById.get(iv.candidateId) : undefined;
    const candidateName = iv.candidateRfId != null
      ? rfCandidateName.get(iv.candidateRfId) ?? "(unknown)"
      : aceCandidate
        ? [aceCandidate.firstName, aceCandidate.lastName].filter(Boolean).join(" ") || "(unnamed)"
        : "(unknown)";
    const candidateHref = iv.candidateRfId != null
      ? `/candidates/${iv.candidateRfId}`
      : iv.candidateId
        ? `/candidates/${iv.candidateId}`
        : "/candidates";
    return {
      id: iv.id,
      candidateName,
      candidateHref,
      jobTitle: iv.jobRfId != null ? rfJobTitle.get(iv.jobRfId) ?? "(job)" : "(job)",
      clientName: iv.clientRfId != null ? rfClientName.get(iv.clientRfId) ?? "" : "",
      scheduledAt: iv.scheduledAt.toISOString(),
      whenLabel: formatUpcomingInterviewWhen(iv.scheduledAt),
      durationMin: iv.durationMin,
      type: iv.type as UpcomingInterviewRow["type"],
      source: iv.source as UpcomingInterviewRow["source"],
      meetLink: iv.meetLink,
    };
  });

  const greeting = firstName ? `Welcome back, ${firstName}.` : "Welcome back.";
  const weekRange = formatEasternWeekRange(weekStart, weekEnd);

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
            Activity for {weekRange}. Everything here is live — no targets, just actuals.
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

      <BillingTower q2BilledRevenueUsd={q2BilledRevenueAgg._sum.feeTotal ?? 0} />

      <NewsFeed />

      <UpcomingInterviews rows={upcoming} />
    </div>
  );
}
