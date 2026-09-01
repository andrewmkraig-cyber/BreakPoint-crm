// Per-client revenue leaderboard.
//
// WHY IT CANNOT DISAGREE WITH THE GOAL METERS. Every filter below is
// IMPORTED from src/lib/goals/metrics.ts - the same objects resolveRevenue
// and resolvePlacements filter through. There is one definition of "which
// invoices count as billed", one of "which count as collected", and one of
// "which placements count", and none of them is restated here. Sum this
// module's rows and you get the org-wide resolver figure back, because both
// sides asked the same question.
//
// It groups rather than looping the scalar resolvers per client: 26 live
// clients would be ~100 round trips per page render, and calling a resolver
// once per client would not make the numbers any more consistent than
// sharing its filter does. The exclusions - cancelled and rejected
// placements out, VOID invoices out, retained placements out of earned -
// all arrive through the imported builders.
import { getEasternDayStart } from "@/lib/week";
import {
  CLIENT_SLUG_SELECT,
  clientSlug,
  extractFeePctFromCustomFields,
} from "@/lib/client-identity";
import { isActiveJobLifecycle } from "@/lib/job-lifecycle";
import { prisma } from "@/lib/prisma";
import {
  billedInvoiceWhere,
  collectedInvoiceWhere,
  earnedPlacementWhere,
  etWindow,
  placementCountWhere,
  retainedEarnedWhere,
} from "@/lib/goals/metrics";

export type ClientLeaderboardRow = {
  readonly clientId: string;
  // The URL segment /clients/[id] expects. Resolved by the shared
  // clientSlug helper, the same one src/lib/clients.ts uses.
  readonly slug: string;
  readonly name: string;
  readonly revenueCollected: number;
  readonly revenueBilled: number;
  // Work closed in the window: placement fees PLUS retained engagements
  // booked in the window. Retained PLACEMENTS stay excluded, so each
  // retainer counts exactly once (see retainedEarnedWhere in metrics.ts).
  readonly revenueEarned: number;
  readonly placements: number;
  // Jobs opened in the window, by Job.createdAt.
  readonly jobOrdersOpened: number;
  // Jobs active RIGHT NOW. Deliberately not window-scoped: "how many open
  // roles does this client have" is a present-tense question, and the
  // /jobs Active tab answers it the same way.
  readonly activeJobs: number;
  // Billed over placements. Null, never 0, when there were no placements.
  readonly avgDealSize: number | null;
  readonly feePct: number | null;
  readonly lastPlacementAt: Date | null;
};

export type ClientLeaderboardInput = {
  organizationId: string;
  // Inclusive UTC calendar-date markers, the same form the metric
  // resolvers take. Ignored when allTime is true.
  rangeStart: Date;
  rangeEnd: Date;
  // "All time" widens the window to everything rather than switching to a
  // different query, so the two modes cannot drift apart.
  allTime?: boolean;
  ownerUserId?: string | null;
};

// Everything Ace has ever recorded comfortably postdates this.
const ALL_TIME_START = new Date(Date.UTC(2000, 0, 1));

function num(v: unknown): number {
  if (v == null) return 0;
  return Number(v);
}

export async function getClientLeaderboard(
  input: ClientLeaderboardInput,
): Promise<ClientLeaderboardRow[]> {
  const { organizationId, allTime = false, ownerUserId = null } = input;

  // All-time still runs through etWindow so both modes share one set of
  // boundary rules; only the bounds differ.
  const { start, endExclusive } = allTime
    ? {
        start: ALL_TIME_START,
        endExclusive: new Date(getEasternDayStart().getTime() + 86_400_000),
      }
    : etWindow(input.rangeStart, input.rangeEnd);

  const [
    clients,
    placementGroups,
    earnedGroups,
    retainedGroups,
    billedGroups,
    collectedGroups,
    jobs,
  ] = await Promise.all([
      prisma.client.findMany({
        where: { organizationId },
        select: {
          // The slug columns travel with clientSlug, so this query cannot
          // select the wrong ones.
          ...CLIENT_SLUG_SELECT,
          name: true,
          // Needed to owner-scope retained engagements: RetainedSearch has
          // scalar-only FKs and cannot filter through client.ownerId.
          ownerId: true,
          feePct: true,
          // The typed Json column, NOT the legacy `raw` blob. Canonical
          // Client.feePct wins; this is the fallback for unbackfilled
          // legacy imports, resolved through the SAME shared parser the
          // candidate profile and job page use (the dfe3349 fix). No new
          // raw-blob read is introduced.
          customFields: true,
        },
      }),
      prisma.placement.groupBy({
        by: ["clientId"],
        where: placementCountWhere(organizationId, start, endExclusive, ownerUserId),
        _count: { _all: true },
        _max: { placedAt: true },
      }),
      prisma.placement.groupBy({
        by: ["clientId"],
        where: earnedPlacementWhere(organizationId, start, endExclusive, ownerUserId),
        _sum: { feeTotal: true },
      }),
      // Retained engagements booked in the window, grouped the same way.
      // Owner scope is applied by the caller-resolved client id list below
      // rather than a relation filter - RetainedSearch has scalar-only FKs.
      prisma.retainedSearch.groupBy({
        by: ["clientId"],
        where: retainedEarnedWhere(organizationId, start, endExclusive, null),
        _sum: { totalAmount: true },
      }),
      prisma.invoice.groupBy({
        by: ["clientId"],
        where: billedInvoiceWhere(organizationId, start, endExclusive, ownerUserId),
        _sum: { feeAmount: true },
      }),
      prisma.invoice.groupBy({
        by: ["clientId"],
        where: collectedInvoiceWhere(organizationId, start, endExclusive, ownerUserId),
        _sum: { feeAmount: true },
      }),
      // Jobs are few (~50 live), so one fetch and a JS reduce beats two
      // groupBys - and `activeJobs` needs resolveJobLifecycle, which is a
      // function, not something a groupBy can express.
      prisma.job.findMany({
        where: {
          organizationId,
          ...(ownerUserId ? { client: { ownerId: ownerUserId } } : {}),
        },
        select: {
          clientId: true,
          createdAt: true,
          lifecycle: true,
          isOpen: true,
        },
      }),
    ]);

  const placementCount = new Map<string, number>();
  const lastPlacement = new Map<string, Date>();
  for (const g of placementGroups) {
    if (!g.clientId) continue;
    placementCount.set(g.clientId, g._count._all);
    if (g._max.placedAt) lastPlacement.set(g.clientId, g._max.placedAt);
  }

  const earned = new Map<string, number>();
  for (const g of earnedGroups) {
    if (!g.clientId) continue;
    earned.set(g.clientId, num(g._sum.feeTotal));
  }
  // Retained engagements add onto the same client's earned figure.
  //
  // Owner scope is applied HERE rather than in the query: RetainedSearch
  // carries scalar-only FKs, so it cannot filter through client.ownerId
  // the way Placement and Invoice do. Dropping this would leak another
  // recruiter's retainer into an owner-scoped leaderboard.
  const ownedClientIds = ownerUserId
    ? new Set(clients.filter((c) => c.ownerId === ownerUserId).map((c) => c.id))
    : null;
  for (const g of retainedGroups) {
    if (!g.clientId) continue;
    if (ownedClientIds && !ownedClientIds.has(g.clientId)) continue;
    earned.set(g.clientId, (earned.get(g.clientId) ?? 0) + num(g._sum.totalAmount));
  }

  const billed = new Map<string, number>();
  for (const g of billedGroups) {
    if (!g.clientId) continue;
    billed.set(g.clientId, num(g._sum.feeAmount));
  }

  const collected = new Map<string, number>();
  for (const g of collectedGroups) {
    if (!g.clientId) continue;
    collected.set(g.clientId, num(g._sum.feeAmount));
  }

  const opened = new Map<string, number>();
  const active = new Map<string, number>();
  for (const j of jobs) {
    if (!j.clientId) continue;
    if (j.createdAt >= start && j.createdAt < endExclusive) {
      opened.set(j.clientId, (opened.get(j.clientId) ?? 0) + 1);
    }
    if (isActiveJobLifecycle(j.lifecycle, j.isOpen)) {
      active.set(j.clientId, (active.get(j.clientId) ?? 0) + 1);
    }
  }

  const rows: ClientLeaderboardRow[] = [];
  for (const c of clients) {
    const placements = placementCount.get(c.id) ?? 0;
    const revenueBilled = billed.get(c.id) ?? 0;
    const revenueCollected = collected.get(c.id) ?? 0;
    const revenueEarned = earned.get(c.id) ?? 0;
    const jobOrdersOpened = opened.get(c.id) ?? 0;
    const activeJobs = active.get(c.id) ?? 0;

    // A client with nothing at all in the window is omitted rather than
    // rendered as a row of zeros - in a Day or Week view that would be
    // every client on the books, and the panel would say nothing.
    if (
      placements === 0 &&
      revenueBilled === 0 &&
      revenueCollected === 0 &&
      revenueEarned === 0 &&
      jobOrdersOpened === 0 &&
      activeJobs === 0
    ) {
      continue;
    }

    rows.push({
      clientId: c.id,
      slug: clientSlug(c),
      name: c.name,
      revenueCollected,
      revenueBilled,
      revenueEarned,
      placements,
      jobOrdersOpened,
      activeJobs,
      // Billed over placements, matching resolveAvgDealSize. Null rather
      // than 0 when nothing was placed.
      avgDealSize: placements === 0 ? null : revenueBilled / placements,
      feePct: c.feePct ?? extractFeePctFromCustomFields(c.customFields) ?? null,
      lastPlacementAt: lastPlacement.get(c.id) ?? null,
    });
  }

  // Default order: revenue collected, highest first. The table can re-sort
  // client-side; this is what it opens on.
  rows.sort((a, b) => b.revenueCollected - a.revenueCollected || b.revenueBilled - a.revenueBilled);
  return rows;
}
