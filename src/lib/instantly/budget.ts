import { prisma } from "@/lib/prisma";

// =====================================================================
// Cross-process /emails budget ledger.
//
// WHY THIS EXISTS. The in-memory sliding window in client.ts only
// coordinates calls inside ONE lambda instance. Vercel runs the poller
// cron in a different instance from the one serving your browser, so the
// two never see each other's usage - they only collide inside
// Instantly's server-side 20-requests-per-minute counter, and you find
// out via a 429. This ledger is the shared layer those two processes can
// both read.
//
// PRIORITY MODEL. The UI wins, always:
//   - The UI never consults this ledger and never waits on it. It just
//     RECORDS its calls (fire-and-forget, off the response path) so the
//     poller can see them.
//   - The poller CHECKS the ledger before enriching, and takes slots
//     only if doing so still leaves POLLER_RESERVE free for the UI.
//     When the bucket is contended it enriches nothing and picks the
//     work up next run - which is already what unresolved rows do, so
//     deferring costs nothing.
//
// HONEST LIMITATION. This is read-modify-write against a JSON blob, not
// a distributed mutex. Two simultaneous writers can both see room and
// both proceed. That is acceptable here: the real backstop is the
// 429-with-backoff path in client.ts, this is a single-user internal
// app, and at ~3 inbound replies/day the realistic per-run cost is one
// list call plus zero or one enrichment.
// =====================================================================

const LEDGER_KEY = "instantly.emails-budget";

// Instantly's documented ceiling for GET /emails.
const WINDOW_MS = 60_000;
export const EMAILS_LIMIT_PER_MIN = 20;

// Slots the poller must leave untouched for interactive UI use.
const POLLER_RESERVE = 8;

// Hard ceiling on enrichment calls in a single poll run, independent of
// how much budget happens to be free. Keeps a big backfill spread across
// runs instead of consuming the whole minute in one burst.
export const POLLER_MAX_PER_RUN = 10;

type Ledger = { calls: number[] };

function parse(raw: unknown): number[] {
  if (!raw || typeof raw !== "object") return [];
  const calls = (raw as Partial<Ledger>).calls;
  if (!Array.isArray(calls)) return [];
  return calls.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

function prune(calls: number[], now: number): number[] {
  return calls.filter((t) => now - t < WINDOW_MS);
}

async function readLedger(now: number): Promise<number[]> {
  const row = await prisma.setting.findUnique({ where: { key: LEDGER_KEY } });
  return prune(parse(row?.value), now);
}

async function writeLedger(calls: number[]): Promise<void> {
  const value = { calls } satisfies Ledger;
  await prisma.setting.upsert({
    where: { key: LEDGER_KEY },
    create: { key: LEDGER_KEY, value },
    update: { value },
  });
}

/**
 * Record N /emails calls the UI just made.
 *
 * Call this WITHOUT awaiting from interactive paths - it exists so the
 * poller can see UI activity, and it must never add latency to a page.
 * A failure here is swallowed: losing a ledger write degrades the
 * poller's politeness, it does not break anything.
 */
export async function recordEmailsCalls(count: number): Promise<void> {
  if (count <= 0) return;
  try {
    const now = Date.now();
    const calls = await readLedger(now);
    for (let i = 0; i < count; i++) calls.push(now);
    await writeLedger(calls);
  } catch {
    // Advisory only - never surface.
  }
}

export type BudgetGrant = {
  /** How many enrichment calls the poller may make this run. */
  granted: number;
  /** Slots used by anyone (UI or poller) in the current window. */
  used: number;
  /** Why we granted less than asked, for the run log. */
  reason: "ok" | "contended" | "capped" | "ledger_error";
};

/**
 * Reserve enrichment slots for the POLLER, yielding to the UI.
 *
 * Grants at most: POLLER_MAX_PER_RUN, and never enough to push usage
 * past (EMAILS_LIMIT_PER_MIN - POLLER_RESERVE). If the UI has been busy,
 * this returns 0 and the poller simply defers - unresolved replies are
 * retried on the next run by design.
 *
 * The reservation is written immediately so a concurrent run sees it.
 */
export async function reservePollerSlots(want: number): Promise<BudgetGrant> {
  const capped = Math.min(want, POLLER_MAX_PER_RUN);
  if (capped <= 0) return { granted: 0, used: 0, reason: "capped" };

  try {
    const now = Date.now();
    const calls = await readLedger(now);
    const used = calls.length;
    const pollerCeiling = EMAILS_LIMIT_PER_MIN - POLLER_RESERVE;
    const available = Math.max(0, pollerCeiling - used);
    const granted = Math.min(capped, available);

    if (granted > 0) {
      for (let i = 0; i < granted; i++) calls.push(now);
      await writeLedger(calls);
    }

    return {
      granted,
      used,
      reason: granted === 0 ? "contended" : granted < want ? "capped" : "ok",
    };
  } catch {
    // Ledger unavailable: fall back to a small fixed allowance rather
    // than either blocking the poller forever or letting it run wild.
    return { granted: Math.min(capped, 3), used: 0, reason: "ledger_error" };
  }
}

/** Slots the poller returns unused, so it doesn't hold them for a minute. */
export async function releasePollerSlots(count: number): Promise<void> {
  if (count <= 0) return;
  try {
    const now = Date.now();
    const calls = await readLedger(now);
    // Drop the most recent `count` entries - those are the ones this run
    // reserved a moment ago.
    calls.sort((a, b) => a - b);
    await writeLedger(calls.slice(0, Math.max(0, calls.length - count)));
  } catch {
    // Advisory.
  }
}
