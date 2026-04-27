import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

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
  kind: "candidate";
  candidateId: string;
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

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getCurrentOrg();

  const [smsRows, callRows] = await Promise.all([
    prisma.smsMessage.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        candidateId: true,
        direction: true,
        body: true,
        fromNumber: true,
        toNumber: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.callLog.findMany({
      where: { organizationId: org.id },
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
    new Set([
      ...smsRows.map((s) => s.candidateId),
      ...callRows.map((c) => c.candidateId),
    ]),
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
  function ensureThread(candidateId: string): PhoneThread | null {
    const cand = candById.get(candidateId);
    if (!cand) return null;
    const existing = threadMap.get(candidateId);
    if (existing) return existing;
    const fresh: PhoneThread = {
      id: candidateId,
      kind: "candidate",
      candidateId,
      contactName:
        `${cand.firstName ?? ""} ${cand.lastName ?? ""}`.trim() || "(unnamed)",
      phoneNumber: cand.phone ?? "",
      lastActivity: null,
      counts: { sms: 0, calls: 0, missedCalls: 0 },
      hasUnread: false,
    };
    threadMap.set(candidateId, fresh);
    return fresh;
  }

  for (const s of smsRows) {
    const t = ensureThread(s.candidateId);
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
    if (s.direction === "inbound") t.hasUnread = true;
  }
  for (const c of callRows) {
    const t = ensureThread(c.candidateId);
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

  const threads = Array.from(threadMap.values()).sort((a, b) => {
    const at = a.lastActivity?.at ?? "";
    const bt = b.lastActivity?.at ?? "";
    return bt.localeCompare(at);
  });

  // Bucket counts feed the left-rail badges. needsReply = the latest
  // entry on the thread is inbound (no outbound after it).
  const buckets: BucketCounts = {
    all: threads.length,
    texts: threads.filter((t) => t.counts.sms > 0).length,
    calls: threads.filter((t) => t.counts.calls > 0).length,
    missed: threads.filter((t) => t.counts.missedCalls > 0).length,
    // No voicemail concept in CallLog yet — leave at 0 until the
    // webhook starts writing voicemail-status rows.
    voicemails: 0,
    candidates: threads.length,
    // Phase 1 — client matching not yet wired.
    clients: 0,
    unknown: 0,
    needsReply: threads.filter(
      (t) => t.lastActivity?.kind === "sms" && t.lastActivity.direction === "inbound",
    ).length,
  };

  return NextResponse.json({ threads, bucketCounts: buckets });
}
