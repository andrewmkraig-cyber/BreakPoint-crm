import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { BillingTower } from "@/app/dashboard/billing-tower";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { UpcomingInterviews, type UpcomingInterviewRow } from "@/app/dashboard/upcoming-interviews";
import { prisma } from "@/lib/prisma";
import { normalizeJob, normalizeClient } from "@/lib/recruiterflow";
import { getRfCandidatesForOrg, getRfClientsForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { getInterviewsForOrg } from "@/lib/interviews";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getEasternWeekBounds } from "@/lib/week";
import {
  CalendarCheck2,
  CalendarDays,
  DollarSign,
  Handshake,
  Send,
  Users,
} from "lucide-react";

export const dynamic = "force-dynamic";

// Every count in the "This week" strip is ACTIVITY-based: it counts
// the stage transition that happened in the last 7 days, NOT the
// current state of the placement. A candidate submitted Monday who
// got rejected Wednesday still counts as 1 in "Candidates submitted"
// for that week — the rejection doesn't remove them from the count.
// Exception: "Upcoming interviews" (below the strip) is state-based
// and shows only non-cancelled interviews in the next 7 days.
//
// Sources: ActionLog for transitions we log (apply / submit /
// schedule_interview) and Placement timestamp columns for
// transitions we stamp on the row (offerReceivedAt / placedAt).
// Interview completions read Interview directly since we want every
// non-cancelled past interview regardless of when it was booked.
const ACTIVITY_SUBTEXT = "this week's activity";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  const now = new Date();
  // Week bounds snap to Monday 00:00 ET through next Monday 00:00 ET
  // (exclusive). Using the ET-aware helper prevents the "Sunday 8pm
  // ET flips the week early" bug — `new Date()` is a UTC instant and
  // plain ms arithmetic would treat that moment (which is Monday
  // 00:00 UTC) as already in the next week on a UTC-running Vercel
  // box.
  const { start: weekStart, end: weekEnd } = getEasternWeekBounds(now);
  // Upcoming interviews is the state-based block (unlike the activity
  // counters) and always looks 7 real days ahead from right now.
  const upcomingWindowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Q2 2026 billed revenue: sum of feeTotal across placements whose expected
  // start date lands in the quarter. Only non-cancelled / non-rejected rows
  // count — the recruiter booked this revenue; cancellations come out of the
  // "placements made" counter elsewhere. Upper bound is exclusive so
  // 2026-07-01T00:00:00Z itself falls into Q3, not Q2. Hardcoded to Q2 2026
  // for now; when the BillingTower dropdown wires other periods this should
  // derive from the selected period instead.
  const q2Start = new Date("2026-04-01T00:00:00.000Z");
  const q2EndExclusive = new Date("2026-07-01T00:00:00.000Z");

  // Phase 4a: every Placement / Interview read on the dashboard scopes
  // by organizationId. The two row-fetch shapes (upcoming interviews +
  // RF context) route through the getInterviewsForOrg helper; the
  // count/aggregate shapes stay direct because the helper is a row
  // reader and doesn't project to counts. Single org lookup up top so
  // the nine queries below share the same tenant resolution.
  const org = await getCurrentOrg();

  const [
    upcomingInterviews,
    rfCandidates,
    rfJobs,
    rfClients,
    applyLogCount,
    submitLogCount,
    interviewsScheduledCount,
    interviewsCompletedCount,
    offersExtendedCount,
    placementsMadeCount,
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
    // Apply transitions logged by applyCandidateToJob. Inbound job-
    // board applicants don't write ActionLog yet; when that pipeline
    // lands, add another source here or bundle them into this query.
    prisma.actionLog.count({
      where: { actionType: "apply", organizationId: org.id, createdAt: { gte: weekStart, lt: weekEnd } },
    }),
    // Submit transitions — includes the `submit` log written by both
    // applyCandidateToJob follow-ups and the full submittal flow.
    prisma.actionLog.count({
      where: { actionType: "submit", organizationId: org.id, createdAt: { gte: weekStart, lt: weekEnd } },
    }),
    // Every interview booked in the ET week, regardless of its
    // current status. A scheduled-then-cancelled interview still
    // counts as "scheduled this week" because the scheduling event
    // is the activity we're measuring.
    prisma.interview.count({
      where: { organizationId: org.id, createdAt: { gte: weekStart, lt: weekEnd } },
    }),
    // Completed = past scheduledAt within the ET week AND not
    // cancelled. `lt: now` keeps us from counting interviews booked
    // for later today. Rescheduled interviews carry their original
    // id and status=scheduled after the move, so they're treated as
    // the same interview landing on its new time.
    prisma.interview.count({
      where: {
        organizationId: org.id,
        scheduledAt: { gte: weekStart, lt: now < weekEnd ? now : weekEnd },
        status: { not: "cancelled" },
      },
    }),
    // Offers — Placement.offerReceivedAt is stamped by recordOffer.
    // Counted regardless of whether the offer was later accepted,
    // declined, or the candidate was rejected — we want the activity.
    prisma.placement.count({
      where: { organizationId: org.id, offerReceivedAt: { gte: weekStart, lt: weekEnd } },
    }),
    // Placements — Placement.placedAt is stamped by recordPlacement.
    // Cancelled placements still count as activity that happened.
    prisma.placement.count({
      where: { organizationId: org.id, placedAt: { gte: weekStart, lt: weekEnd } },
    }),
    // Sum of feeTotal across Q2 2026 placements (expectedStartDate in-range),
    // limited to pending_start + hired so we don't count cancelled/rejected
    // rows that still carry a stale start date. feeTotal is an Int column
    // storing whole currency units; null rows contribute 0 automatically.
    prisma.placement.aggregate({
      _sum: { feeTotal: true },
      where: {
        organizationId: org.id,
        stage: { in: ["pending_start", "hired"] },
        expectedStartDate: { gte: q2Start, lt: q2EndExclusive },
      },
    }),
  ]);

  // getInterviewsForOrg returns full Interview rows but no `candidate`
  // relation — do a single batched Candidate lookup for the Ace-native
  // rows (candidateRfId null, candidateId set) so we can render their
  // names the way the previous `include: { candidate }` query did.
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
      durationMin: iv.durationMin,
      type: iv.type as UpcomingInterviewRow["type"],
      source: iv.source as UpcomingInterviewRow["source"],
      meetLink: iv.meetLink,
    };
  });

  return (
    <div>
      <PageHeader
        eyebrow="This week"
        title={`Welcome back, ${firstName}.`}
        description="A quick look at the desk this week. Everything here is live activity — no targets, just actuals."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="New Applicants" value={applyLogCount} icon={Users} hint={ACTIVITY_SUBTEXT} />
        <KpiTile label="Candidates Submitted" value={submitLogCount} icon={Send} hint={ACTIVITY_SUBTEXT} />
        <KpiTile label="Interviews Scheduled" value={interviewsScheduledCount} icon={CalendarDays} hint={ACTIVITY_SUBTEXT} />
        <KpiTile label="Interviews Completed" value={interviewsCompletedCount} icon={CalendarCheck2} hint={ACTIVITY_SUBTEXT} />
        <KpiTile label="Offers Extended" value={offersExtendedCount} icon={DollarSign} hint={ACTIVITY_SUBTEXT} />
        <KpiTile label="Placements Made" value={placementsMadeCount} icon={Handshake} hint={ACTIVITY_SUBTEXT} />
      </div>

      <div className="mt-8">
        <UpcomingInterviews rows={upcoming} />
      </div>

      <div className="mt-8">
        <BillingTower q2BilledRevenueUsd={q2BilledRevenueAgg._sum.feeTotal ?? 0} />
      </div>
    </div>
  );
}
