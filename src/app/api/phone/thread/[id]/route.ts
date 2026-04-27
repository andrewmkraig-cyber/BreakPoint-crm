import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

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
  const candidateId = params.id;

  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, organizationId: org.id },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const [smsRows, callRows] = await Promise.all([
    prisma.smsMessage.findMany({
      where: { candidateId, organizationId: org.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        direction: true,
        body: true,
        fromNumber: true,
        toNumber: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.callLog.findMany({
      where: { candidateId, organizationId: org.id },
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
