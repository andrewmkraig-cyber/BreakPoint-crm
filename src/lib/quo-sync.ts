import { prisma } from "@/lib/prisma";
import { phoneTail } from "@/lib/quo-line-owner";
import { normalizeToE164 } from "@/lib/rf-payload-shapes";

// Safety-net sync for Quo (OpenPhone) text threads.
//
// Why this exists: Quo's webhook only sends Ace `message.received`
// (inbound) events. Texts you send from the Quo *app* fire no webhook
// at all, so they never reach Ace and the thread looks one-sided. This
// module pulls a thread's recent messages straight from the OpenPhone
// REST API and backfills any rows Ace is missing - both historical
// outbound texts and a self-heal for any future webhook miss.
//
// It is called lazily from /api/sms GET when a thread is opened, so the
// gap fills in the moment you look at the conversation. Best-effort:
// every failure path returns quietly and leaves the DB read untouched.

const BASE = "https://api.openphone.com/v1";
const KEY = process.env.QUO_API_KEY ?? "";
const FROM = process.env.QUO_FROM_NUMBER ?? "";
const ENV_PID = process.env.QUO_PHONE_NUMBER_ID ?? "";

function authHeaders() {
  return { Authorization: KEY };
}

// Resolve our OpenPhone phoneNumberId. The QUO_PHONE_NUMBER_ID env var
// has drifted out of sync with the real id across deploys (sends still
// work because sendSms authenticates via `from`), so we resolve it from
// the live phone-numbers list by matching QUO_FROM_NUMBER and only fall
// back to the env value. Cached for the warm instance's lifetime.
let cachedPid: string | null = null;
async function resolvePhoneNumberId(): Promise<string | null> {
  if (cachedPid) return cachedPid;
  try {
    const r = await fetch(`${BASE}/phone-numbers`, { headers: authHeaders() });
    if (r.ok) {
      const j = (await r.json()) as { data?: Array<{ id?: string; number?: string }> };
      const want = phoneTail(FROM);
      const list = Array.isArray(j?.data) ? j.data : [];
      const match = want ? list.find((p) => phoneTail(p.number ?? "") === want) : null;
      const id = match?.id ?? list[0]?.id ?? null;
      if (id) {
        cachedPid = id;
        return cachedPid;
      }
    } else {
      console.error("[quo-sync] phone-numbers lookup failed", r.status);
    }
  } catch (e) {
    console.error("[quo-sync] phone-numbers lookup threw", e);
  }
  cachedPid = ENV_PID || null;
  return cachedPid;
}

// Soft per-participant throttle so the 30s thread poll doesn't hammer the
// OpenPhone API. Module-scoped, so it's per warm serverless instance -
// a cold start re-syncs, which is fine (bounded, idempotent).
const lastSync = new Map<string, number>();
const THROTTLE_MS = 60_000;

type QuoApiMessage = {
  id?: string;
  direction?: string;
  from?: string;
  to?: string[] | string;
  text?: string;
  body?: string;
  status?: string;
  createdAt?: string;
  media?: Array<{ url?: string } | string>;
};

function pickToNumber(to: QuoApiMessage["to"]): string {
  if (Array.isArray(to)) return typeof to[0] === "string" ? to[0] : "";
  return typeof to === "string" ? to : "";
}

function pickMediaUrl(m: QuoApiMessage): string | null {
  if (!Array.isArray(m.media)) return null;
  for (const item of m.media) {
    if (typeof item === "string" && /^https?:\/\//i.test(item)) return item;
    if (item && typeof item === "object" && typeof item.url === "string" && /^https?:\/\//i.test(item.url)) {
      return item.url;
    }
  }
  return null;
}

// Derive the other-party E.164 for a thread. Prefers the most recent
// stored row (works for both candidate and client threads, and for
// numbers that were typed in any format), falling back to the candidate's
// saved phone when the thread has no history yet.
export async function resolveThreadParticipant(opts: {
  candidateId?: string | null;
  clientId?: string | null;
}): Promise<string | null> {
  const lineTail = phoneTail(FROM);
  const where = opts.candidateId
    ? { candidateId: opts.candidateId }
    : opts.clientId
      ? { clientId: opts.clientId }
      : null;
  if (!where) return null;

  const latest = await prisma.smsMessage.findFirst({
    where,
    orderBy: { createdAt: "desc" },
    select: { fromNumber: true, toNumber: true },
  });
  if (latest) {
    const fromT = phoneTail(latest.fromNumber);
    const toT = phoneTail(latest.toNumber);
    const other =
      fromT && fromT !== lineTail
        ? latest.fromNumber
        : toT && toT !== lineTail
          ? latest.toNumber
          : null;
    const e164 = normalizeToE164(other);
    if (e164) return e164;
  }
  if (opts.candidateId) {
    const c = await prisma.candidate.findUnique({
      where: { id: opts.candidateId },
      select: { phone: true },
    });
    const e164 = normalizeToE164(c?.phone ?? null);
    if (e164) return e164;
  }
  return null;
}

// Pull the recent messages OpenPhone holds for this thread and create any
// rows Ace is missing. Dedupes against existing rows by Quo message id
// first, then by a direction+body+timestamp fuzzy match (covers legacy
// rows that were stored without a krispcallId). Returns null when it
// short-circuits (no key, throttled, miss), otherwise a small summary.
export async function syncQuoThread(opts: {
  participant: string;
  candidateId?: string | null;
  clientId?: string | null;
  organizationId: string;
  maxResults?: number;
}): Promise<{ fetched: number; created: number } | null> {
  if (!KEY) return null;
  const participant = normalizeToE164(opts.participant);
  if (!participant) return null;

  const now = Date.now();
  const prev = lastSync.get(participant);
  if (prev && now - prev < THROTTLE_MS) return null;
  lastSync.set(participant, now);

  const pid = await resolvePhoneNumberId();
  if (!pid) return null;

  const url =
    `${BASE}/messages?phoneNumberId=${encodeURIComponent(pid)}` +
    `&participants[]=${encodeURIComponent(participant)}` +
    `&maxResults=${opts.maxResults ?? 50}`;

  let messages: QuoApiMessage[] = [];
  try {
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) {
      console.error("[quo-sync] messages list failed", r.status);
      return null;
    }
    const j = (await r.json()) as { data?: QuoApiMessage[] };
    messages = Array.isArray(j?.data) ? j.data : [];
  } catch (e) {
    console.error("[quo-sync] messages list threw", e);
    return null;
  }
  if (messages.length === 0) return { fetched: 0, created: 0 };

  // Pull existing rows for the thread once for dedupe. Scoped by
  // candidate/client id, which is enough to recognize a duplicate.
  const threadWhere = opts.candidateId
    ? { candidateId: opts.candidateId }
    : { clientId: opts.clientId! };
  const existing = await prisma.smsMessage.findMany({
    where: threadWhere,
    select: { krispcallId: true, direction: true, body: true, createdAt: true },
  });
  const seenIds = new Set(
    existing.map((r) => r.krispcallId).filter((x): x is string => !!x),
  );
  const idlessRows = existing.filter((r) => !r.krispcallId);

  let created = 0;
  for (const m of messages) {
    const quoId = typeof m.id === "string" ? m.id : null;
    if (!quoId || seenIds.has(quoId)) continue;

    const direction =
      m.direction === "outgoing" || m.direction === "outbound" ? "outbound" : "inbound";
    const body = (typeof m.text === "string" ? m.text : m.body) ?? "";
    const createdAtRaw = m.createdAt ? new Date(m.createdAt) : null;
    const createdAt =
      createdAtRaw && !Number.isNaN(createdAtRaw.getTime()) ? createdAtRaw : null;

    // Fuzzy dedupe against legacy rows that were stored without a Quo id:
    // same direction + body, within 90s. Skips empty-body MMS to avoid
    // collapsing distinct image-only messages.
    if (
      body &&
      idlessRows.some(
        (r) =>
          r.direction === direction &&
          r.body === body &&
          createdAt != null &&
          Math.abs(r.createdAt.getTime() - createdAt.getTime()) < 90_000,
      )
    ) {
      continue;
    }

    await prisma.smsMessage.create({
      data: {
        candidateId: opts.candidateId ?? null,
        clientId: opts.clientId ?? null,
        organizationId: opts.organizationId,
        direction,
        body,
        fromNumber: typeof m.from === "string" ? m.from : "",
        toNumber: pickToNumber(m.to),
        status: typeof m.status === "string" ? m.status : direction === "outbound" ? "delivered" : "received",
        // Backfilled history is marked read so reconstructing an old
        // thread never inflates the unread badge. Outbound is always read;
        // inbound gaps are rare (the webhook handles live inbound) and old.
        isRead: true,
        krispcallId: quoId,
        mediaUrl: pickMediaUrl(m),
        ...(createdAt ? { createdAt } : {}),
      },
    });
    seenIds.add(quoId);
    created++;
  }

  if (created) {
    console.log(`[quo-sync] backfilled created=${created} fetched=${messages.length}`);
  }
  return { fetched: messages.length, created };
}
