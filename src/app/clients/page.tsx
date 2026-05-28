import { ClientsView, type ClientCard, type QuietTier } from "@/app/clients/clients-view";
import { canonicalStage, emptyJobCounts, type JobPipelineCounts } from "@/lib/rf-payload-shapes";
import { getClientsForOrg } from "@/lib/clients";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getCurrentUserId } from "@/lib/auth/getCurrentUserId";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DAY_MS = 1000 * 60 * 60 * 24;
// Active → Quiet after 30 days of no activity; Quiet → Inactive at 60
// total. Buckets are mutually exclusive (a card is Active OR Quiet OR
// Inactive — Quiet is no longer a decorated subset of Active).
const QUIET_AFTER_DAYS = 30;
const INACTIVE_AFTER_DAYS = 60;
// "Activity" that resets the inactivity clock: new job created, job
// reactivated, placement made, candidate stage move on one of their
// jobs, or any ActivityLog row written against the client. Brand-new
// clients land Active because client.createdAt is the floor for the
// last-activity timestamp (zero job / placement / activity history
// still means createdAt = now → days = 0 → Active).

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
    // Build per-client lastActivityAt from FOUR Neon signals + the
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
    //      stage move (Prisma @updatedAt auto-bumps on every write).
    //
    // Brand-new clients with empty histories fall back to createdAt
    // below so they bucket as Active.
    const clientCuids = clients.map((c) => c.id);
    const clientLegacyIds = clients
      .map((c) => (c.legacyRfId != null ? String(c.legacyRfId) : null))
      .filter((x): x is string => x !== null);
    const targetIdNeedles = [...clientCuids, ...clientLegacyIds];

    const [activityGroups, jobCreatedGroups, jobOpenUpdatedGroups, placementGroupsForActivity] =
      await Promise.all([
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

      // createdAt floor: brand-new client with no jobs / placements /
      // activity log lands on its own createdAt, so days = 0 and the
      // bucket below evaluates to Active.
      let lastActivityAt: Date = c.createdAt;
      for (const candidate of [cuidActivity, legacyActivity, jobCreated, openJobUpdated, placementTouch]) {
        const newer = pickNewer(lastActivityAt, candidate);
        if (newer) lastActivityAt = newer;
      }

      const daysSinceLastActivity = Math.floor((now - lastActivityAt.getTime()) / DAY_MS);
      const bucket: "active" | "quiet" | "inactive" =
        daysSinceLastActivity < QUIET_AFTER_DAYS
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

  // Mutually exclusive buckets under the new spec:
  //   Active   = days since last activity < 30
  //   Quiet    = 30-59 days
  //   Inactive = 60+ days
  // A card is in exactly one bucket — Quiet is no longer a decorated
  // subset of Active.
  const activeCards = all.filter((c) => c.bucket === "active").sort(sortFn);
  const inactiveCards = all.filter((c) => c.bucket === "inactive").sort(sortFn);
  const verifiedCount = all.filter((c) => c.isVerified).length;

  // Quiet tab — every Quiet card now carries the single "30-60 days
  // quiet" tier (the only Quiet band under the new spec). The 14-30
  // tier rolls into Active and the 60+ tier rolls into Inactive, so
  // we no longer surface those labels here.
  const quietCards = all
    .filter((c) => c.bucket === "quiet")
    .map((c) => ({ ...c, quietTier: "30-60" as QuietTier }))
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
