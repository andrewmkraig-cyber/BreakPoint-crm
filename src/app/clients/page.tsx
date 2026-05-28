import { ClientsView, type ClientCard, type QuietTier } from "@/app/clients/clients-view";
import { canonicalStage, emptyJobCounts, type JobPipelineCounts } from "@/lib/rf-payload-shapes";
import { getRfCandidatesForOrg } from "@/lib/candidates";
import { getClientsForOrg } from "@/lib/clients";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getCurrentUserId } from "@/lib/auth/getCurrentUserId";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PLACEMENT_WINDOW_MS = 1000 * 60 * 60 * 24 * 30 * 6; // ~6 months
const DAY_MS = 1000 * 60 * 60 * 24;
// Inactivity threshold for the Quiet tab. Anything past this is bucketed
// into one of the three tier labels rendered on the card.
const QUIET_MIN_DAYS = 21;

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
    const [clients, candidates, org, currentUserId] = await Promise.all([
      getClientsForOrg(),
      getRfCandidatesForOrg(),
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
    // recentlyPlacedClientIds still reads from RF payload — same
    // RF-leak class as the counters were before, queued as a follow-up.
    // Keying by legacyRfId here keeps the existing Active/Inactive
    // logic intact while the counters move to Neon.
    const recentPlacementIds = recentlyPlacedClientIds(candidates);

    // Last ActivityLog per client — used to build the Quiet tab. Writers
    // stamp `targetType="client"` with `targetId` set to either the
    // Client cuid (Ace-native) or a stringified legacyRfId (legacy RF
    // back-compat per /app/clients/[id]/actions.ts:447). Group by
    // targetId so a single query covers both keying conventions.
    const clientCuids = clients.map((c) => c.id);
    const clientLegacyIds = clients
      .map((c) => (c.legacyRfId != null ? String(c.legacyRfId) : null))
      .filter((x): x is string => x !== null);
    const targetIdNeedles = [...clientCuids, ...clientLegacyIds];
    const lastActivityByTargetId = new Map<string, Date>();
    if (targetIdNeedles.length > 0) {
      const groups = await prisma.activityLog.groupBy({
        by: ["targetId"],
        where: {
          organizationId: org.id,
          targetType: "client",
          targetId: { in: targetIdNeedles },
        },
        _max: { timestamp: true },
      });
      for (const g of groups) {
        if (g._max.timestamp) lastActivityByTargetId.set(g.targetId, g._max.timestamp);
      }
    }

    const now = Date.now();
    all = clients.map((c) => {
      const legacyId = c.legacyRfId;
      const pc = counts.get(c.id) ?? emptyJobCounts();
      const hadRecentPlacement = legacyId != null && recentPlacementIds.has(legacyId);
      const hasOpenJob = c.openJobsCount > 0;
      const website = c.domain ? (c.domain.startsWith("http") ? c.domain : `https://${c.domain}`) : null;

      const cuidActivity = lastActivityByTargetId.get(c.id);
      const legacyActivity = legacyId != null ? lastActivityByTargetId.get(String(legacyId)) : undefined;
      const lastActivityAt =
        cuidActivity && legacyActivity
          ? cuidActivity.getTime() >= legacyActivity.getTime()
            ? cuidActivity
            : legacyActivity
          : (cuidActivity ?? legacyActivity ?? null);
      const daysSinceLastActivity = lastActivityAt
        ? Math.floor((now - lastActivityAt.getTime()) / DAY_MS)
        : null;

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
        isActive: hasOpenJob || hadRecentPlacement,
        lastActivityAtIso: lastActivityAt?.toISOString() ?? null,
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
  const activeCards = all.filter((c) => c.isActive).sort(sortFn);
  const inactiveCards = all.filter((c) => !c.isActive).sort(sortFn);
  const verifiedCount = all.filter((c) => c.isVerified).length;

  // Quiet = active client that HAS prior ActivityLog history AND
  // whose most-recent entry is past the QUIET_MIN_DAYS threshold.
  // Brand-new clients with zero ActivityLog rows are intentionally
  // excluded (no history = no signal that the client has gone quiet).
  const quietCards = activeCards
    .map((c) => {
      const days = c.daysSinceLastActivity;
      if (days == null) return null;
      let tier: QuietTier | null = null;
      if (days >= 60) tier = "60+";
      else if (days >= 30) tier = "30-60";
      else if (days >= QUIET_MIN_DAYS) tier = "14-30";
      return tier ? { ...c, quietTier: tier } : null;
    })
    .filter((c): c is ClientCard & { quietTier: QuietTier } => c !== null)
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

// Walks every candidate's jobs[] array and returns the set of
// client_company_ids that have had a stage_moved to a "hired" stage
// within the last 6 months.
function recentlyPlacedClientIds(candidates: Awaited<ReturnType<typeof getRfCandidatesForOrg>>): Set<number> {
  const cutoff = Date.now() - PLACEMENT_WINDOW_MS;
  const out = new Set<number>();
  for (const c of candidates) {
    const jobs = Array.isArray(c.jobs) ? c.jobs : [];
    for (const j of jobs) {
      if (canonicalStage(j.stage_name) !== "hired") continue;
      if (typeof j.client_company_id !== "number") continue;
      if (!j.stage_moved) continue;
      const t = Date.parse(j.stage_moved);
      if (!Number.isFinite(t)) continue;
      if (t >= cutoff) out.add(j.client_company_id);
    }
  }
  return out;
}
