import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bulk hard-delete cascade — mirrors deleteCandidate (src/app/candidates/[id]/actions.ts)
// with one tenant-scoped lookup up front. SmsMessage / CallLog / ActivityLog
// don't have FK relations to Candidate, and CallTranscript points at CallLog
// without onDelete, so the cascade is explicit. Wrapped in $transaction so
// a partial failure doesn't leave orphaned children.
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const ids = Array.isArray((body as { ids?: unknown }).ids)
    ? ((body as { ids: unknown[] }).ids.filter((v): v is string => typeof v === "string" && v.length > 0))
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "No candidate ids provided." }, { status: 400 });
  }

  const org = await getCurrentOrg();

  const owned = await prisma.candidate.findMany({
    where: { id: { in: ids }, organizationId: org.id },
    select: { id: true },
  });
  const ownedIds = owned.map((r) => r.id);
  if (ownedIds.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const callLogIds = await tx.callLog.findMany({
        where: { candidateId: { in: ownedIds } },
        select: { id: true },
      });
      if (callLogIds.length > 0) {
        await tx.callTranscript.deleteMany({
          where: { callLogId: { in: callLogIds.map((r) => r.id) } },
        });
      }
      await tx.callLog.deleteMany({ where: { candidateId: { in: ownedIds } } });
      await tx.smsMessage.deleteMany({ where: { candidateId: { in: ownedIds } } });
      await tx.activityLog.deleteMany({
        where: { targetType: "candidate", targetId: { in: ownedIds } },
      });
      await tx.candidateResume.deleteMany({ where: { candidateId: { in: ownedIds } } });
      await tx.placement.deleteMany({ where: { candidateId: { in: ownedIds } } });
      await tx.interview.deleteMany({ where: { candidateId: { in: ownedIds } } });
      await tx.candidateListMembership.deleteMany({ where: { candidateId: { in: ownedIds } } });
      await tx.gmailThreadTag.deleteMany({ where: { candidateId: { in: ownedIds } } });
      await tx.candidate.deleteMany({
        where: { id: { in: ownedIds }, organizationId: org.id },
      });
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Bulk delete failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, deleted: ownedIds.length });
}
