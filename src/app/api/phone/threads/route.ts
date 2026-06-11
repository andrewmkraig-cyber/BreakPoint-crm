import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { callLineWhere, getQuoLineDigitsForUserEmail, smsLineWhere } from "@/lib/quo-line-owner";

export const dynamic = "force-dynamic";

// Phone Tab thread list. Each "thread" is the combined SMS + Call
// activity for one matched candidate (Phase 1 scope — client-contact
// matching arrives in Phase 2 when the webhook starts writing
// SmsMessage/CallLog rows against Contact phone numbers).
//
// All queries scope by organizationId per NN #8. CallLog rows whose
// candidateId points at an orphaned legacy numeric id (pre-Phase-5
// rows that never got a cuid backfill) are silently excluded — they
// have no resolvable candidate to display anyway.

type ThreadEntryLast =
  | {
      kind: "sms";
      at: string;
      body: string;
      direction: string;
    }
  | {
      kind: "call";
      at: string;
      direction: string;
      duration: number | null;
      status: string;
    };

type PhoneThread = {
  id: string;
  // "candidate" — joined to a Candidate row.
  // "unknown"   — no matching Candidate in the CRM. The thread is
  //               keyed by the other-party phone number so the
  //               recruiter can still see the activity and offer to
  //               add the contact to Ace afterwards.
  kind: "candidate" | "unknown";
  candidateId: string | null;
  contactName: string;
  phoneNumber: string;
  lastActivity: ThreadEntryLast | null;
  counts: { sms: number; calls: number; missedCalls: number };
  hasUnread: boolean;
};

type BucketCounts = {
  all: number;
  texts: number;
  calls: number;
  missed: number;
  voicemails: number;
  candidates: number;
  clients: number;
  unknown: number;
  needsReply: number;
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getCurrentOrg();
  // Optional cap on threads returned. Used by the FAB popup's "last
  // N contacts" surface so the popover doesn't try to render the
  // entire org's history.
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(100, parseInt(limitParam, 10) || 0)) : null;
  const lineDigits = await getQuoLineDigitsForUserEmail(org.id, session.user.email);
  if (lineDigits.length === 0) {
    const emptyBuckets: BucketCounts = {
      all: 0,
      texts: 0,
      calls: 0,
      missed: 0,
      voicemails: 0,
      candidates: 0,
      clients: 0,
      unknown: 0,
      needsReply: 0,
    };
    return NextResponse.json({ threads: [], bucketCounts: emptyBuckets, unreadCount: 0 });
  }

  const [smsRows, callRows] = await Promise.all([
    prisma.smsMessage.findMany({
      where: { organizationId: org.id, AND: [smsLineWhere(lineDigits)] },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        candidateId: true,
        direction: true,
        body: true,
        fromNumber: true,
        toNumber: true,
        status: true,
        isRead: true,
        createdAt: true,
      },
    }),
    prisma.callLog.findMany({
      where: { organizationId: org.id, AND: [callLineWhere(lineDigits)] },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        candidateId: true,
        direction: true,
        fromNumber: true,
        toNumber: true,
        duration: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);

  // Bucket every row by candidateId so we can hydrate contact names
  // in one round-trip and assemble per-thread aggregates.
  const candidateIds = Array.from(
    new Set(
      [...smsRows, ...callRows]
        .map((r) => r.candidateId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const candidates = candidateIds.length
    ? await prisma.candidate.findMany({
        where: { id: { in: candidateIds }, organizationId: org.id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      })
    : [];
  const candById = new Map(candidates.map((c) => [c.id, c]));

  const threadMap = new Map<string, PhoneThread>();

  function ensureCandidateThread(candidateId: string): PhoneThread | null {
    const cand = candById.get(candidateId);
    if (!cand) return null;
    const key = `cand:${candidateId}`;
    const existing = threadMap.get(key);
    if (existing) return existing;
    const fresh: PhoneThread = {
      id: key,
      kind: "candidate",
      candidateId,
      contactName:
        `${cand.firstName ?? ""} ${cand.lastName ?? ""}`.trim() || "(unnamed)",
      phoneNumber: cand.phone ?? "",
      lastActivity: null,
      counts: { sms: 0, calls: 0, missedCalls: 0 },
      hasUnread: false,
    };
    threadMap.set(key, fresh);
    return fresh;
  }

  // Unknown-number threads are keyed by the last-10 digits of the other
  // party's number. Same digits always collapse into the same thread,
  // even if Quo formats the number differently across events ((937)
  // 555-1234 vs +1 937 555 1234, etc.).
  function normalizeOther(num: string | null | undefined): string {
    return (num ?? "").replace(/\D/g, "").slice(-10);
  }
  function ensureUnknownThread(rawNumber: string): PhoneThread {
    const digits = normalizeOther(rawNumber);
    const key = `unk:${digits || rawNumber}`;
    const existing = threadMap.get(key);
    if (existing) return existing;
    const fresh: PhoneThread = {
      id: key,
      kind: "unknown",
      candidateId: null,
      contactName: rawNumber || "(unknown number)",
      phoneNumber: rawNumber,
      lastActivity: null,
      counts: { sms: 0, calls: 0, missedCalls: 0 },
      hasUnread: false,
    };
    threadMap.set(key, fresh);
    return fresh;
  }

  for (const s of smsRows) {
    const t = s.candidateId
      ? ensureCandidateThread(s.candidateId)
      : ensureUnknownThread(s.direction === "outbound" ? s.toNumber : s.fromNumber);
    if (!t) continue;
    t.counts.sms += 1;
    if (!t.lastActivity || s.createdAt > new Date(t.lastActivity.at)) {
      t.lastActivity = {
        kind: "sms",
        at: s.createdAt.toISOString(),
        body: s.body,
        direction: s.direction,
      };
    }
    // Any unread inbound row flips the thread's hasUnread flag. The
    // markThreadRead server action (fired when the thread is opened)
    // updates SmsMessage.isRead → true for inbound rows, so on the
    // next fetch this branch stops contributing for opened threads.
    if (s.direction === "inbound" && !s.isRead) {
      t.hasUnread = true;
    }
  }
  for (const c of callRows) {
    const t = c.candidateId
      ? ensureCandidateThread(c.candidateId)
      : ensureUnknownThread(c.direction === "outbound" ? c.toNumber : c.fromNumber);
    if (!t) continue;
    t.counts.calls += 1;
    const isMissed = c.status === "missed" || c.status === "no-answer";
    if (isMissed) t.counts.missedCalls += 1;
    if (!t.lastActivity || c.createdAt > new Date(t.lastActivity.at)) {
      t.lastActivity = {
        kind: "call",
        at: c.createdAt.toISOString(),
        direction: c.direction,
        duration: c.duration,
        status: c.status,
      };
    }
  }

  const allThreads = Array.from(threadMap.values()).sort((a, b) => {
    const at = a.lastActivity?.at ?? "";
    const bt = b.lastActivity?.at ?? "";
    return bt.localeCompare(at);
  });
  const threads = limit ? allThreads.slice(0, limit) : allThreads;

  // Bucket counts feed the left-rail badges. Per spec, badges show
  // UNREAD-only counts — not totals. Now that SmsMessage.isRead drives
  // each thread's hasUnread flag, compute the counts from it instead of
  // returning 0. Calls deliberately do NOT contribute — only unread
  // inbound texts flip hasUnread. Computed over the FULL set (allThreads)
  // not the limited slice so the badge reflects the whole inbox.
  // BucketItem still hides any badge whose count is <= 0, and the bucket
  // FILTERING in PhoneView works on the threads array directly, so this
  // doesn't break clicking through to "Texts" / "Candidates" / etc.
  const unreadThreads = allThreads.filter((t) => t.hasUnread);
  const buckets: BucketCounts = {
    all: unreadThreads.length,
    texts: unreadThreads.length,
    calls: 0,
    missed: 0,
    voicemails: 0,
    candidates: unreadThreads.filter((t) => t.kind === "candidate").length,
    // This endpoint only models candidate + unknown threads (no client
    // kind yet), so the clients bucket stays 0 here.
    clients: 0,
    unknown: unreadThreads.filter((t) => t.kind === "unknown").length,
    needsReply: unreadThreads.length,
  };

  // unreadCount mirrors the unread-thread total. The sidebar Phone-tab
  // badge does NOT read this (it uses the lighter /api/phone/unread-count
  // via PhoneContext); we compute it here only so this endpoint stops
  // reporting a stale 0.
  const unreadCount = unreadThreads.length;

  return NextResponse.json({ threads, bucketCounts: buckets, unreadCount });
}
