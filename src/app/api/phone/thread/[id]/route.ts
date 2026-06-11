import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { callLineWhere, getQuoLineDigitsForUserEmail, smsLineWhere } from "@/lib/quo-line-owner";

export const dynamic = "force-dynamic";

// Single-thread detail for the Phone Tab. The path param is the
// candidate cuid (Phase 1's only thread kind). Returns chronological
// SMS + Call entries plus the resolved contact metadata.
//
// Org scope on every query: the candidate lookup is org-scoped, and
// the SmsMessage / CallLog queries also filter by organizationId so
// cross-tenant rows can't leak even if a caller guesses a candidate
// cuid from another org.

type SmsEntry = {
  kind: "sms";
  id: string;
  direction: string;
  body: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  mediaUrl: string | null;
  createdAt: string;
};

type CallEntry = {
  kind: "call";
  id: string;
  direction: string;
  fromNumber: string;
  toNumber: string;
  duration: number | null;
  status: string;
  recordingUrl: string | null;
  createdAt: string;
};

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getCurrentOrg();
  const lineDigits = await getQuoLineDigitsForUserEmail(org.id, session.user.email);
  if (lineDigits.length === 0) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  // Thread id encoding mirrors the threads list endpoint:
  //   "cand:<cuid>"  → matched Candidate thread
  //   "unk:<digits>" → unknown-number thread, keyed by last-10 digits
  // Older callers may still pass a bare cuid (legacy "candidate-only"
  // ids); treat those as cand: for backward compat.
  const raw = params.id;
  const isUnknown = raw.startsWith("unk:");
  const isCandidate = raw.startsWith("cand:");
  const subjectId = isUnknown || isCandidate ? raw.slice(raw.indexOf(":") + 1) : raw;

  if (isUnknown) {
    const digits = subjectId.replace(/\D/g, "").slice(-10);
    if (!digits) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    const [smsRows, callRows] = await Promise.all([
      prisma.smsMessage.findMany({
        where: {
          organizationId: org.id,
          candidateId: null,
          AND: [
            {
              OR: [
                { fromNumber: { contains: digits } },
                { toNumber: { contains: digits } },
              ],
            },
            smsLineWhere(lineDigits),
          ],
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          direction: true,
          body: true,
          fromNumber: true,
          toNumber: true,
          status: true,
          mediaUrl: true,
          createdAt: true,
        },
      }),
      prisma.callLog.findMany({
        where: {
          organizationId: org.id,
          candidateId: null,
          AND: [
            {
              OR: [
                { fromNumber: { contains: digits } },
                { toNumber: { contains: digits } },
              ],
            },
            callLineWhere(lineDigits),
          ],
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          direction: true,
          fromNumber: true,
          toNumber: true,
          duration: true,
          status: true,
          recordingUrl: true,
          createdAt: true,
        },
      }),
    ]);
    const sms: SmsEntry[] = smsRows.map((s) => ({
      kind: "sms",
      id: s.id,
      direction: s.direction,
      body: s.body,
      fromNumber: s.fromNumber,
      toNumber: s.toNumber,
      status: s.status,
      mediaUrl: s.mediaUrl,
      createdAt: s.createdAt.toISOString(),
    }));
    const calls: CallEntry[] = callRows.map((c) => ({
      kind: "call",
      id: c.id,
      direction: c.direction,
      fromNumber: c.fromNumber,
      toNumber: c.toNumber,
      duration: c.duration,
      status: c.status,
      recordingUrl: c.recordingUrl,
      createdAt: c.createdAt.toISOString(),
    }));
    const entries: Array<SmsEntry | CallEntry> = [...sms, ...calls].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    // Pick the other-party number from the most recent row so the
    // header doesn't render "(unknown number)" when we have a
    // formatted version on hand.
    const all = [...smsRows, ...callRows].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const sample = all[0];
    const phoneNumber = sample
      ? sample.direction === "outbound"
        ? sample.toNumber
        : sample.fromNumber
      : digits;
    return NextResponse.json({
      contact: {
        kind: "unknown" as const,
        id: raw,
        name: phoneNumber || "(unknown number)",
        phoneNumber,
      },
      entries,
    });
  }

  const candidateId = subjectId;
  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, organizationId: org.id },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const [smsRows, callRows] = await Promise.all([
    prisma.smsMessage.findMany({
      where: { candidateId, organizationId: org.id, AND: [smsLineWhere(lineDigits)] },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        direction: true,
        body: true,
        fromNumber: true,
        toNumber: true,
        status: true,
        mediaUrl: true,
        createdAt: true,
      },
    }),
    prisma.callLog.findMany({
      where: { candidateId, organizationId: org.id, AND: [callLineWhere(lineDigits)] },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        direction: true,
        fromNumber: true,
        toNumber: true,
        duration: true,
        status: true,
        recordingUrl: true,
        createdAt: true,
      },
    }),
  ]);

  const sms: SmsEntry[] = smsRows.map((s) => ({
    kind: "sms",
    id: s.id,
    direction: s.direction,
    body: s.body,
    fromNumber: s.fromNumber,
    toNumber: s.toNumber,
    status: s.status,
    mediaUrl: s.mediaUrl,
    createdAt: s.createdAt.toISOString(),
  }));
  const calls: CallEntry[] = callRows.map((c) => ({
    kind: "call",
    id: c.id,
    direction: c.direction,
    fromNumber: c.fromNumber,
    toNumber: c.toNumber,
    duration: c.duration,
    status: c.status,
    recordingUrl: c.recordingUrl,
    createdAt: c.createdAt.toISOString(),
  }));

  const entries: Array<SmsEntry | CallEntry> = [...sms, ...calls].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  return NextResponse.json({
    contact: {
      kind: "candidate" as const,
      id: candidate.id,
      name:
        `${candidate.firstName ?? ""} ${candidate.lastName ?? ""}`.trim() ||
        "(unnamed)",
      phoneNumber: candidate.phone ?? "",
    },
    entries,
  });
}
