import { prisma } from "@/lib/prisma";
import {
  listReplies,
  listCampaigns,
  getEmail,
  isInstantlyConfigured,
} from "@/lib/instantly/client";
import { toTriBool } from "@/lib/instantly/types";
import {
  reservePollerSlots,
  releasePollerSlots,
  POLLER_MAX_PER_RUN,
} from "@/lib/instantly/budget";
import { getInstantlyPrefs } from "@/lib/instantly/prefs";
import { buildOwnIdentity, isOwnSender } from "@/lib/instantly/identity";
import { markInstantlyThreadRead } from "@/lib/instantly/mark-thread-read";
import { InstantlyError } from "@/lib/instantly/errors";

// =====================================================================
// Instantly reply poller.
//
// READ ONLY against Instantly - GET /emails and GET /emails/{id}, that
// is the whole surface. Every write goes to Neon.
//
// Run shape:
//   1. resolve the window from the last successful poll, clamped to a
//      MAX_LOOKBACK so a long outage can't trigger a huge catch-up
//   2. list inbound replies in that window
//   3. upsert on instantlyEmailId (idempotent - overlapping windows and
//      re-runs cannot double-count)
//   4. enrich rows whose auto-reply state is still unresolved, within
//      whatever budget the shared ledger grants
//   5. mark which rows are allowed to notify
//
// The notify decision is the point of the whole job. See shouldNotify().
// =====================================================================

const POLL_STATE_KEY = "instantly.poll";

// A cold start or a long outage looks back this far and no further.
// Seven days at ~3 replies/day is a couple of hundred rows worst case,
// which the per-run enrichment cap then drains over subsequent runs.
const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

// COLD START ONLY (no lastPolledAt yet). Reaches back far enough to
// mirror the whole existing Unibox in one pass, so the Replies view -
// which now reads from Neon - isn't showing a 7-day slice of a much
// longer history. Enrichment is still capped per run, so a big first
// haul drains over subsequent runs instead of blowing the budget.
const COLD_START_LOOKBACK_MS = 180 * 24 * 60 * 60 * 1000;

// Overlap the window slightly so a reply landing exactly on the boundary
// isn't skipped. Upsert-on-unique makes re-seeing rows free.
const WINDOW_OVERLAP_MS = 2 * 60 * 1000;

// Give up resolving auto-reply state after this many attempts. At that
// point the reply notifies ANYWAY, flagged unverified: missing a real
// client reply costs more than dismissing a stray out-of-office.
export const MAX_ENRICH_ATTEMPTS = 5;

// Attempts to mirror a local "read" into Instantly before giving up.
export const MAX_READ_SYNC_ATTEMPTS = 5;

// Floor for read-syncs per run. Enrichment gets first claim on the
// budget - an unresolved auto-reply flag decides whether you get
// notified, while an unsynced read only affects how a thread looks in
// Instantly's own Unibox. Whatever enrichment does not spend is handed
// to read-sync on top of this floor, so a "Mark all as read" over 25
// threads drains in a couple of runs instead of five.
const READ_SYNC_MIN_PER_RUN = 5;
const READ_SYNC_MAX_PER_RUN = 20;

export type PollState = {
  lastPolledAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
};

export async function getPollState(): Promise<PollState> {
  const row = await prisma.setting.findUnique({ where: { key: POLL_STATE_KEY } });
  const v = (row?.value ?? {}) as Partial<PollState>;
  return {
    lastPolledAt: typeof v.lastPolledAt === "string" ? v.lastPolledAt : null,
    lastRunAt: typeof v.lastRunAt === "string" ? v.lastRunAt : null,
    lastError: typeof v.lastError === "string" ? v.lastError : null,
  };
}

async function setPollState(patch: Partial<PollState>): Promise<void> {
  const current = await getPollState();
  const next = { ...current, ...patch };
  await prisma.setting.upsert({
    where: { key: POLL_STATE_KEY },
    create: { key: POLL_STATE_KEY, value: next },
    update: { value: next },
  });
}

export type PollResult = {
  ok: boolean;
  skipped?: "disabled" | "not_configured" | "interval";
  windowFrom?: string;
  fetched?: number;
  inserted?: number;
  enrichAttempted?: number;
  enrichResolved?: number;
  gaveUp?: number;
  readSynced?: number;
  readSyncPending?: number;
  notifiable?: number;
  budgetGranted?: number;
  budgetReason?: string;
  error?: string;
};

/**
 * Decide whether a stored reply may raise a notification.
 *
 * This is the rule the whole feature exists for, so it lives in one
 * named function rather than being scattered through queries:
 *
 *   isAutoReply === false            -> YES. Confirmed genuine.
 *   isAutoReply === true             -> NO. Out-of-office and friends
 *                                       are stored but never notify and
 *                                       never touch the badge.
 *   isAutoReply === null, attempts
 *     below the cap                  -> NOT YET. Retry next run.
 *   isAutoReply === null, attempts
 *     at or past the cap             -> YES, flagged unverified. The
 *                                       auto-reply check never
 *                                       completed, and staying silent
 *                                       about a possible real client
 *                                       reply is the worse failure.
 */
export function shouldNotify(row: {
  isAutoReply: boolean | null;
  enrichAttempts: number;
}): boolean {
  if (row.isAutoReply === true) return false;
  if (row.isAutoReply === false) return true;
  return row.enrichAttempts >= MAX_ENRICH_ATTEMPTS;
}

export async function runInstantlyPoll(opts?: {
  force?: boolean;
}): Promise<PollResult> {
  if (!isInstantlyConfigured()) {
    return { ok: false, skipped: "not_configured" };
  }

  const prefs = await getInstantlyPrefs();
  if (!prefs.pollingEnabled && !opts?.force) {
    return { ok: false, skipped: "disabled" };
  }

  const state = await getPollState();
  const now = Date.now();

  // Vercel cron schedules are static, so the configurable interval is
  // enforced HERE: the cron fires every 5 minutes and we no-op until the
  // chosen interval has actually elapsed. This can only make polling
  // slower than 5 minutes, never faster.
  if (!opts?.force && state.lastPolledAt) {
    const elapsed = now - new Date(state.lastPolledAt).getTime();
    const wanted = prefs.pollIntervalMinutes * 60_000;
    // 30s of slack so a cron firing a hair early doesn't skip a slot.
    if (elapsed < wanted - 30_000) {
      return { ok: true, skipped: "interval" };
    }
  }

  const orgId = await resolvePollOrgId();
  if (!orgId) return { ok: false, error: "No organization to attribute replies to." };

  // Window: from the last successful poll (minus overlap), clamped to
  // MAX_LOOKBACK so a multi-day outage backfills a bounded amount.
  const isColdStart = !state.lastPolledAt;
  const lookbackMs = isColdStart ? COLD_START_LOOKBACK_MS : MAX_LOOKBACK_MS;
  const lastPolledMs = state.lastPolledAt
    ? new Date(state.lastPolledAt).getTime()
    : now - lookbackMs;
  const from = new Date(
    Math.max(lastPolledMs - WINDOW_OVERLAP_MS, now - lookbackMs),
  );

  try {
    const fetched = await listReplies({
      since: from.toISOString(),
      limit: 100,
      fetchAll: true,
      maxPages: isColdStart ? 20 : 5,
    });

    // Our own identity set, folding in the sending accounts visible on
    // this batch so a new warmed mailbox is recognized immediately.
    const identity = await buildOwnIdentity(fetched.map((r) => r.eaccount));

    // Campaign names, so the toast and row can say which campaign
    // without a per-reply lookup. One cheap cached call.
    let campaignNames = new Map<string, string>();
    try {
      const campaigns = await listCampaigns({ fetchAll: true });
      campaignNames = new Map(campaigns.map((c) => [c.id, c.name]));
    } catch {
      // Names are cosmetic - never fail a poll over them.
    }

    let inserted = 0;
    for (const r of fetched) {
      // Upsert on the Instantly email id. Re-polling an overlapping
      // window is therefore free and cannot double-count.
      const existing = await prisma.instantlyReply.findUnique({
        where: { instantlyEmailId: r.id },
        select: { id: true },
      });
      const own = isOwnSender(r.fromEmail, identity);
      if (existing) {
        // Refresh only cosmetic fields. Never clobber isAutoReply,
        // enrichAttempts, readAt, or notifiedAt - those are our state.
        await prisma.instantlyReply.update({
          where: { instantlyEmailId: r.id },
          data: {
            campaignName: r.campaignId ? (campaignNames.get(r.campaignId) ?? null) : null,
            snippet: r.snippet,
            eaccount: r.eaccount,
            // Re-evaluated each poll so a newly-learned identity
            // retroactively excludes rows stored before we knew it.
            isOwnSender: own,
          },
        });
        continue;
      }
      await prisma.instantlyReply.create({
        data: {
          organizationId: orgId,
          instantlyEmailId: r.id,
          threadId: r.threadId,
          campaignId: r.campaignId,
          campaignName: r.campaignId ? (campaignNames.get(r.campaignId) ?? null) : null,
          leadEmail: r.leadEmail,
          fromEmail: r.fromEmail,
          subject: r.subject,
          snippet: r.snippet,
          bodyText: r.bodyText,
          receivedAt: r.receivedAt ? new Date(r.receivedAt) : new Date(),
          eaccount: r.eaccount,
          isFocused: r.isFocused,
          // Always null off the list endpoint - it omits is_auto_reply.
          isAutoReply: null,
          enrichAttempts: 0,
          isOwnSender: own,
        },
      });
      inserted++;
    }

    // ---- enrichment, budget permitting -----------------------------
    const pending = await prisma.instantlyReply.findMany({
      where: {
        organizationId: orgId,
        isAutoReply: null,
        isOwnSender: false,
        enrichAttempts: { lt: MAX_ENRICH_ATTEMPTS },
      },
      orderBy: { receivedAt: "desc" },
      take: POLLER_MAX_PER_RUN,
      select: { id: true, instantlyEmailId: true, enrichAttempts: true },
    });

    const grant = await reservePollerSlots(pending.length);
    let attempted = 0;
    let resolved = 0;

    for (const row of pending) {
      if (attempted >= grant.granted) break;
      attempted++;
      try {
        const full = await getEmail(row.instantlyEmailId, { bucketMode: "wait" });
        const flag = toTriBool(full.is_auto_reply);
        await prisma.instantlyReply.update({
          where: { id: row.id },
          data: {
            isAutoReply: flag,
            enrichAttempts: { increment: 1 },
          },
        });
        if (flag !== null) resolved++;
      } catch (e) {
        // Count the attempt so a permanently-broken row eventually
        // crosses the cap and notifies as unverified rather than
        // staying silent forever.
        await prisma.instantlyReply.update({
          where: { id: row.id },
          data: { enrichAttempts: { increment: 1 } },
        });
        if (e instanceof InstantlyError && e.kind === "rate_limited") break;
      }
    }

    // Hand back anything we reserved but didn't spend.
    if (grant.granted > attempted) {
      await releasePollerSlots(grant.granted - attempted);
    }

    // Rows that just crossed the attempt cap without ever resolving.
    const gaveUpResult = await prisma.instantlyReply.updateMany({
      where: {
        organizationId: orgId,
        isAutoReply: null,
        enrichAttempts: { gte: MAX_ENRICH_ATTEMPTS },
        enrichGaveUp: false,
      },
      data: { enrichGaveUp: true },
    });

    // ---- read-sync retry ------------------------------------------
    // Rows read in Ace whose mark-as-read never reached Instantly. Local
    // readAt is authoritative and untouched here - this only retries the
    // outbound mirror, within the same budget and with a hard attempt
    // cap so a permanently-failing thread stops consuming slots.
    const leftoverBudget = Math.max(0, grant.granted - attempted);
    const readSyncBudget = Math.min(
      READ_SYNC_MAX_PER_RUN,
      READ_SYNC_MIN_PER_RUN + leftoverBudget,
    );
    const readSynced = await retryReadSync(orgId, readSyncBudget);

    const notifiable = await prisma.instantlyReply.count({
      where: notifiableWhere(orgId),
    });

    await setPollState({
      lastPolledAt: new Date(now).toISOString(),
      lastRunAt: new Date().toISOString(),
      lastError: null,
    });

    return {
      ok: true,
      windowFrom: from.toISOString(),
      fetched: fetched.length,
      inserted,
      enrichAttempted: attempted,
      enrichResolved: resolved,
      gaveUp: gaveUpResult.count,
      readSynced: readSynced.synced,
      readSyncPending: readSynced.pending,
      notifiable,
      budgetGranted: grant.granted,
      budgetReason: grant.reason,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Instantly poll failed.";
    // lastPolledAt is deliberately NOT advanced on failure, so the next
    // run re-covers this window instead of silently losing it.
    await setPollState({ lastRunAt: new Date().toISOString(), lastError: message });
    return { ok: false, error: message };
  }
}

/**
 * Retry the outbound read mirror for rows read in Ace but not yet
 * acknowledged by Instantly.
 *
 * Failure here NEVER touches readAt. The local state is what the badge
 * and the list are built on, and reverting it would make Ace lie about
 * what has already been seen - strictly worse than a thread staying
 * unread in Instantly's Unibox.
 */
async function retryReadSync(
  organizationId: string,
  budget: number,
): Promise<{ synced: number; pending: number }> {
  const pendingRows = await prisma.instantlyReply.findMany({
    where: {
      organizationId,
      readAt: { not: null },
      instantlyReadSyncedAt: null,
      threadId: { not: null },
      instantlyReadSyncAttempts: { lt: MAX_READ_SYNC_ATTEMPTS },
    },
    orderBy: { readAt: "desc" },
    take: Math.max(0, budget),
    select: { id: true, threadId: true },
  });

  let synced = 0;
  for (const row of pendingRows) {
    if (!row.threadId) continue;
    const result = await markInstantlyThreadRead(row.threadId);
    if (result.ok) {
      await prisma.instantlyReply.update({
        where: { id: row.id },
        data: { instantlyReadSyncedAt: new Date(), instantlyReadSyncAttempts: { increment: 1 } },
      });
      synced++;
    } else {
      await prisma.instantlyReply.update({
        where: { id: row.id },
        data: { instantlyReadSyncAttempts: { increment: 1 } },
      });
      // Budget exhausted - stop and let the next run continue.
      if (result.kind === "rate_limited") break;
    }
  }

  const pending = await prisma.instantlyReply.count({
    where: {
      organizationId,
      readAt: { not: null },
      instantlyReadSyncedAt: null,
      instantlyReadSyncAttempts: { lt: MAX_READ_SYNC_ATTEMPTS },
    },
  });

  return { synced, pending };
}

/**
 * Prisma filter for replies that are allowed to surface as a
 * notification / badge. Mirrors shouldNotify() exactly - keep them in
 * step. Confirmed auto-replies are excluded unconditionally.
 */
export function notifiableWhere(organizationId: string) {
  return {
    organizationId,
    // Our own outbound mail is not a lead reply. Excluded from the
    // badge, the toasts, and the count.
    isOwnSender: false,
    OR: [
      { isAutoReply: false },
      // Unresolved but out of attempts: notify, flagged unverified.
      { isAutoReply: null, enrichAttempts: { gte: MAX_ENRICH_ATTEMPTS } },
    ],
  };
}

// The poller has no session, so it attributes replies to the default
// org - same fallback the other crons use.
async function resolvePollOrgId(): Promise<string | null> {
  const fromEnv = process.env.DEFAULT_ORG_ID;
  if (fromEnv) return fromEnv;
  const org = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return org?.id ?? null;
}
