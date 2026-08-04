import { ClientsView, type ClientCard, type QuietTier } from "@/app/clients/clients-view";
import { canonicalStage, emptyJobCounts, type JobPipelineCounts } from "@/lib/rf-payload-shapes";
import { getClientsForOrg } from "@/lib/clients";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getCurrentUserId } from "@/lib/auth/getCurrentUserId";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DAY_MS = 1000 * 60 * 60 * 24;
// Active → Quiet after 7 days of no activity; Quiet → Inactive 30
// days after that (37 days total). Buckets are mutually exclusive (a
// card is Active OR Quiet OR Inactive). The 7/37-day window applies
// unless one of the three Active OVERRIDES holds the client open:
//   1. a placement within the last 180 days (PLACEMENT_ACTIVE_DAYS)
//   2. a candidate in a live client-side stage — Interviewing, Offer,
//      or Pending Start (livePipelineOverride)
//   3. an interview on the calendar inside the live window
//      (LIVE_INTERVIEW_WINDOW_DAYS)
// 2 + 3 are the "actively interviewing is never quiet" rule.
const QUIET_AFTER_DAYS = 7;
const INACTIVE_AFTER_DAYS = 37;
// A placement (offer accepted = Placement.placedAt is set) keeps the
// client Active for 6 months from the placement date regardless of the
// normal 7-day window. Set per the revised activity rules: a placed
// client is, by definition, "warm" through the guarantee period even
// when no further submittals / interviews / jobs land.
const PLACEMENT_ACTIVE_DAYS = 180;
// An interview whose DATE lands inside this window (upcoming, or held
// within the last 7 days) means the client is actively interviewing right
// now. This is deliberately keyed off Interview.scheduledAt, not
// Interview.createdAt — an interview booked three weeks in advance would
// otherwise let the client drift to Quiet while the interview is still on
// the books.
const LIVE_INTERVIEW_WINDOW_DAYS = 7;
// "Activity" that resets the inactivity clock:
//   - Job created or reactivated for the client
//   - Any submittal (Placement row touched — stage moves bump updatedAt)
//   - Any interview scheduled for a client job
//   - Any ActivityLog row written against the client (manual notes,
//     candidate stage moves on a client job, etc.)
// Brand-new clients land Active immediately because client.createdAt
// is the floor for the last-activity timestamp (zero job / placement /
// interview / activity history still means createdAt = now → days = 0
// → Active).

export default async function ClientsPage({
  searchParams,
}: {
  searchParams?: { view?: string };
}) {
  // Tab + search are now client-side state inside ClientsView. Only the
  // grid/list view persists across navigations via ?view=list.
  const initialView: "grid" | "list" = searchParams?.view === "list" ? "list" : "grid";

  let all: ClientCard[] = [];
  let error: string | null = null;
  let otherUserId: string | null = null;
  let otherUserName: string | null = null;

  try {
    const [clients, org, currentUserId] = await Promise.all([
      getClientsForOrg(),
      getCurrentOrg(),
      getCurrentUserId(),
    ]);

    // The "other" org member, for the "<Name>'s Clients" dropdown option.
    // Internal two-person org, so the first member that isn't the signed-in
    // user is the counterpart; null when there is no one else.
    const members = await prisma.organizationMembership.findMany({
      where: { organizationId: org.id },
      select: { user: { select: { id: true, name: true } } },
    });
    const other = members.map((m) => m.user).find((u) => u.id !== currentUserId) ?? null;
    otherUserId = other?.id ?? null;
    otherUserName = other?.name ?? null;
    // Pipeline counts read from Neon Placement.stage (canonical post-
    // Phase-5), one groupBy across the whole tenant rather than walking
    // every candidate's RF jobs[] array. Filters out null clientId
    // rows (the orphan-row class fixed by the 2026-04-28 backfill;
    // safety net here in case any new ones land).
    const placementGroups = await prisma.placement.groupBy({
      by: ["clientId", "stage"],
      where: {
        organizationId: org.id,
        clientId: { not: null },
        // Cancelled rows are dropped by the canonicalStage switch below
        // (default: break), so they don't affect counts today — but
        // filtering at the DB layer keeps the wire payload smaller and
        // makes the intent explicit. Mirrors the same pattern applied
        // to the per-client groupBy in clients/[id]/page.tsx.
        stage: { not: "cancelled" },
      },
      _count: { _all: true },
    });
    const counts = new Map<string, JobPipelineCounts>();
    for (const g of placementGroups) {
      if (!g.clientId) continue;
      const bucket = canonicalStage(g.stage);
      const n = g._count._all;
      const pc = counts.get(g.clientId) ?? emptyJobCounts();
      switch (bucket) {
        case "submitted":
          pc.submitted += n;
          pc.totalActive += n;
          break;
        case "interviewing":
          pc.interviewing += n;
          pc.totalActive += n;
          break;
        case "offer":
          pc.offer += n;
          pc.totalActive += n;
          break;
        case "pending_start":
          pc.pendingStart += n;
          pc.totalActive += n;
          break;
        case "hired":
          pc.hired += n;
          break;
        default:
          break;
      }
      counts.set(g.clientId, pc);
    }
    // Build per-client lastActivityAt from FIVE Neon signals + the
    // Client.createdAt floor. All queries are tenant-scoped (Rule 8).
    //
    //   1. ActivityLog targetType="client" — explicit client-targeted
    //      events (covers candidate stage moves on the client detail
    //      activity feed, manual notes, etc.). targetId is the cuid for
    //      Ace-native rows and the stringified legacyRfId for legacy RF
    //      back-compat, so we group across both.
    //   2. Job.createdAt — new job posted for this client.
    //   3. Job.updatedAt where isOpen=true — covers reactivation (any
    //      lifecycle transition that re-opens a job updates updatedAt;
    //      isOpen=true filter keeps closed-out jobs from anchoring the
    //      client to a stale edit).
    //   4. Placement.createdAt / updatedAt — placement made and any
    //      stage move (Prisma @updatedAt auto-bumps on every write),
    //      which covers the "any submittal" signal because submitted
    //      candidates write a Placement row at the submitted stage.
    //   5. Interview.createdAt — any interview scheduled on one of the
    //      client's jobs. Bumps the client's last-activity timestamp at
    //      schedule time so the 7-day clock resets on the recruiter
    //      action, not just on a later Placement.updatedAt nudge.
    //
    // Separately, Placement.placedAt is sampled per-client below to
    // power the 180-day "placement made" Active override.
    //
    // Brand-new clients with empty histories fall back to createdAt
    // below so they bucket as Active.
    const clientCuids = clients.map((c) => c.id);
    const clientLegacyIds = clients
      .map((c) => (c.legacyRfId != null ? String(c.legacyRfId) : null))
      .filter((x): x is string => x !== null);
    const targetIdNeedles = [...clientCuids, ...clientLegacyIds];

    const [
      activityGroups,
      jobCreatedGroups,
      jobOpenUpdatedGroups,
      placementGroupsForActivity,
      interviewCreatedGroups,
      placementPlacedAtGroups,
      liveInterviewGroups,
    ] = await Promise.all([
      targetIdNeedles.length > 0
        ? prisma.activityLog.groupBy({
            by: ["targetId"],
            where: {
              organizationId: org.id,
              targetType: "client",
              targetId: { in: targetIdNeedles },
            },
            _max: { timestamp: true },
          })
        : Promise.resolve([] as Array<{ targetId: string; _max: { timestamp: Date | null } }>),
      clientCuids.length > 0
        ? prisma.job.groupBy({
            by: ["clientId"],
            where: {
              organizationId: org.id,
              clientId: { in: clientCuids },
            },
            _max: { createdAt: true },
          })
        : Promise.resolve([] as Array<{ clientId: string | null; _max: { createdAt: Date | null } }>),
      clientCuids.length > 0
        ? prisma.job.groupBy({
            by: ["clientId"],
            where: {
              organizationId: org.id,
              clientId: { in: clientCuids },
              isOpen: true,
            },
            _max: { updatedAt: true },
          })
        : Promise.resolve([] as Array<{ clientId: string | null; _max: { updatedAt: Date | null } }>),
      clientCuids.length > 0
        ? prisma.placement.groupBy({
            by: ["clientId"],
            where: {
              organizationId: org.id,
              clientId: { in: clientCuids },
            },
            _max: { createdAt: true, updatedAt: true },
          })
        : Promise.resolve(
            [] as Array<{ clientId: string | null; _max: { createdAt: Date | null; updatedAt: Date | null } }>,
          ),
      // Interview signal — the recruiter scheduling an interview on a
      // client job is a "warming" event the 7-day window should respect
      // even before any Placement.updatedAt nudge catches up.
      clientCuids.length > 0
        ? prisma.interview.groupBy({
            by: ["clientId"],
            where: {
              organizationId: org.id,
              clientId: { in: clientCuids },
            },
            _max: { createdAt: true },
          })
        : Promise.resolve([] as Array<{ clientId: string | null; _max: { createdAt: Date | null } }>),
      // Placement-made 180-day Active override — sample the newest
      // Placement.placedAt per client. placedAt is the moment the offer
      // was accepted and the fee locked, which is the canonical
      // "placement made" event for the 6-month window.
      clientCuids.length > 0
        ? prisma.placement.groupBy({
            by: ["clientId"],
            where: {
              organizationId: org.id,
              clientId: { in: clientCuids },
              placedAt: { not: null },
            },
            _max: { placedAt: true },
          })
        : Promise.resolve([] as Array<{ clientId: string | null; _max: { placedAt: Date | null } }>),
      // "Actively interviewing" override, calendar side — any live (non
      // cancelled) interview dated inside LIVE_INTERVIEW_WINDOW_DAYS or in
      // the future. Keyed on scheduledAt so an interview booked well in
      // advance keeps the client Active right through the interview date.
      clientCuids.length > 0
        ? prisma.interview.groupBy({
            by: ["clientId"],
            where: {
              organizationId: org.id,
              clientId: { in: clientCuids },
              status: { not: "cancelled" },
              scheduledAt: { gte: new Date(Date.now() - LIVE_INTERVIEW_WINDOW_DAYS * DAY_MS) },
            },
            _count: { _all: true },
          })
        : Promise.resolve([] as Array<{ clientId: string | null; _count: { _all: number } }>),
    ]);

    const lastActivityLogByTargetId = new Map<string, Date>();
    for (const g of activityGroups) {
      if (g._max.timestamp) lastActivityLogByTargetId.set(g.targetId, g._max.timestamp);
    }
    const lastJobCreatedByClientId = new Map<string, Date>();
    for (const g of jobCreatedGroups) {
      if (g.clientId && g._max.createdAt) lastJobCreatedByClientId.set(g.clientId, g._max.createdAt);
    }
    const lastOpenJobUpdatedByClientId = new Map<string, Date>();
    for (const g of jobOpenUpdatedGroups) {
      if (g.clientId && g._max.updatedAt) lastOpenJobUpdatedByClientId.set(g.clientId, g._max.updatedAt);
    }
    const lastPlacementTouchByClientId = new Map<string, Date>();
    for (const g of placementGroupsForActivity) {
      if (!g.clientId) continue;
      const created = g._max.createdAt;
      const updated = g._max.updatedAt;
      const newest =
        created && updated
          ? created.getTime() >= updated.getTime()
            ? created
            : updated
          : (created ?? updated ?? null);
      if (newest) lastPlacementTouchByClientId.set(g.clientId, newest);
    }
    const lastInterviewCreatedByClientId = new Map<string, Date>();
    for (const g of interviewCreatedGroups) {
      if (g.clientId && g._max.createdAt) lastInterviewCreatedByClientId.set(g.clientId, g._max.createdAt);
    }
    // Per-client newest placedAt drives the 180-day Active override.
    // Holding it separately from the activity-signal map so the
    // bucket computation can apply the override independently of the
    // normal Active-vs-Quiet window.
    const lastPlacedAtByClientId = new Map<string, Date>();
    for (const g of placementPlacedAtGroups) {
      if (g.clientId && g._max.placedAt) lastPlacedAtByClientId.set(g.clientId, g._max.placedAt);
    }
    const clientsWithLiveInterview = new Set<string>();
    for (const g of liveInterviewGroups) {
      if (g.clientId && g._count._all > 0) clientsWithLiveInterview.add(g.clientId);
    }

    const pickNewer = (a: Date | null | undefined, b: Date | null | undefined): Date | null => {
      if (a && b) return a.getTime() >= b.getTime() ? a : b;
      return a ?? b ?? null;
    };

    const now = Date.now();
    all = clients.map((c) => {
      const legacyId = c.legacyRfId;
      const pc = counts.get(c.id) ?? emptyJobCounts();
      const website = c.domain ? (c.domain.startsWith("http") ? c.domain : `https://${c.domain}`) : null;

      // Walk every signal and keep the newest. ActivityLog targetId is
      // the cuid for Ace-native rows or the stringified legacyRfId for
      // legacy RF back-compat, so consult both.
      const cuidActivity = lastActivityLogByTargetId.get(c.id) ?? null;
      const legacyActivity =
        legacyId != null ? lastActivityLogByTargetId.get(String(legacyId)) ?? null : null;
      const jobCreated = lastJobCreatedByClientId.get(c.id) ?? null;
      const openJobUpdated = lastOpenJobUpdatedByClientId.get(c.id) ?? null;
      const placementTouch = lastPlacementTouchByClientId.get(c.id) ?? null;
      const interviewCreated = lastInterviewCreatedByClientId.get(c.id) ?? null;

      // createdAt floor: brand-new client with no jobs / placements /
      // interviews / activity log lands on its own createdAt, so
      // days = 0 and the bucket below evaluates to Active.
      let lastActivityAt: Date = c.createdAt;
      for (const candidate of [
        cuidActivity,
        legacyActivity,
        jobCreated,
        openJobUpdated,
        placementTouch,
        interviewCreated,
      ]) {
        const newer = pickNewer(lastActivityAt, candidate);
        if (newer) lastActivityAt = newer;
      }

      const daysSinceLastActivity = Math.floor((now - lastActivityAt.getTime()) / DAY_MS);

      // Placement-made override: any Placement with placedAt within
      // the last 180 days locks the client to Active regardless of the
      // 7-day window. Mirrors the guarantee-period intuition that a
      // placed client is "warm" through the 6-month mark even when no
      // additional submittals / interviews / jobs land.
      const lastPlacedAt = lastPlacedAtByClientId.get(c.id) ?? null;
      const daysSincePlacement =
        lastPlacedAt ? Math.floor((now - lastPlacedAt.getTime()) / DAY_MS) : null;
      const placementActiveOverride =
        daysSincePlacement != null && daysSincePlacement < PLACEMENT_ACTIVE_DAYS;

      // "Actively interviewing" Active override, pipeline side. A client
      // holding a candidate in a live CLIENT-SIDE stage — Interviewing,
      // Offer, or Pending Start — is by definition not quiet: the loop is
      // open on their end and there is nothing to nudge them about. This
      // is stage-based rather than clock-based on purpose; the recruiter
      // reported Mowat Mackie & Anderson sitting in Quiet at exactly the
      // 7-day mark while a candidate was mid-interview-process there.
      //
      // `submitted` is deliberately EXCLUDED. A submittal the client never
      // responded to is precisely the case Quiet exists to surface — that
      // one still needs a nudge.
      const livePipelineOverride = pc.interviewing > 0 || pc.offer > 0 || pc.pendingStart > 0;
      // Calendar side of the same rule — an interview on the books (see
      // LIVE_INTERVIEW_WINDOW_DAYS) even when the placement stage has not
      // been moved to Interviewing yet.
      const liveInterviewOverride = clientsWithLiveInterview.has(c.id);

      const bucket: "active" | "quiet" | "inactive" = placementActiveOverride ||
        livePipelineOverride ||
        liveInterviewOverride
        ? "active"
        : daysSinceLastActivity < QUIET_AFTER_DAYS
          ? "active"
          : daysSinceLastActivity < INACTIVE_AFTER_DAYS
            ? "quiet"
            : "inactive";

      return {
        id: c.id,
        slug: c.slug,
        legacyRfId: c.legacyRfId,
        name: c.name,
        domain: c.domain,
        website,
        industry: c.industry,
        linkedIn: c.linkedIn,
        location: c.location ?? "",
        phone: c.phone,
        openJobsCount: c.openJobsCount,
        closedJobsCount: c.closedJobsCount,
        isVerified: c.isVerified,
        feePct: c.feePct,
        submittedCount: pc.submitted,
        interviewingCount: pc.interviewing,
        // Offer + Pending Start are split into separate counters now —
        // recruiter wants to see "offer extended, awaiting acceptance"
        // distinct from "offer accepted, awaiting start date".
        offerCount: pc.offer,
        pendingStartCount: pc.pendingStart,
        hiredCount: pc.hired,
        // isActive mirrors the Active bucket so existing card readers
        // keep working. Quiet + Inactive are no longer subsets of
        // Active — every card lands in exactly one bucket now.
        isActive: bucket === "active",
        bucket,
        lastActivityAtIso: lastActivityAt.toISOString(),
        daysSinceLastActivity,
        ownedByMe: c.ownerId != null && c.ownerId === currentUserId,
        ownerId: c.ownerId,
        ownerName: c.ownerName,
      };
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to fetch clients";
  }

  const sortFn = (a: ClientCard, b: ClientCard) => {
    if (!a.name && b.name) return 1;
    if (a.name && !b.name) return -1;
    if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
    if (b.openJobsCount !== a.openJobsCount) return b.openJobsCount - a.openJobsCount;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  };

  // Mutually exclusive buckets under the revised spec:
  //   Active   = days since last activity < 7, OR any of the three
  //              Active overrides fires (placement within 180 days,
  //              a candidate at Interviewing / Offer / Pending Start,
  //              or an interview on the calendar inside the live
  //              window) — see the per-client bucket computation above
  //   Quiet    = 7-36 days and no override
  //   Inactive = 37+ days and no override
  // A card is in exactly one bucket — Quiet is not a decorated subset
  // of Active.
  const activeCards = all.filter((c) => c.bucket === "active").sort(sortFn);
  const inactiveCards = all.filter((c) => c.bucket === "inactive").sort(sortFn);
  const verifiedCount = all.filter((c) => c.isVerified).length;

  // Quiet tab — every Quiet card now carries the single "7-37 days
  // quiet" tier (the only Quiet band under the revised spec).
  const quietCards = all
    .filter((c) => c.bucket === "quiet")
    .map((c) => ({ ...c, quietTier: "7-37" as QuietTier }))
    .sort((a, b) => {
      // Stalest first.
      const aDays = a.daysSinceLastActivity ?? 0;
      const bDays = b.daysSinceLastActivity ?? 0;
      if (aDays !== bDays) return bDays - aDays;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

  return (
    <ClientsView
      activeCards={activeCards}
      inactiveCards={inactiveCards}
      quietCards={quietCards}
      initialView={initialView}
      verifiedCount={verifiedCount}
      error={error}
      otherUserId={otherUserId}
      otherUserName={otherUserName}
    />
  );
}
