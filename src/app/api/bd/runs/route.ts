import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST /api/bd/runs
// Body: { verticalId: string, savedSearchId: string }
// Inserts a BDRun row with status=QUEUED scoped to the caller's org.
// The morning cron picks up QUEUED rows and runs them through Indeed +
// Apollo — wiring lands in a later BD session. For now this endpoint
// just records the launch intent so the UI can confirm the row was
// written.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { verticalId?: unknown; savedSearchId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  const verticalId = typeof body.verticalId === "string" ? body.verticalId : null;
  const savedSearchId = typeof body.savedSearchId === "string" ? body.savedSearchId : null;
  if (!verticalId || !savedSearchId) {
    return NextResponse.json(
      { error: "verticalId and savedSearchId required" },
      { status: 400 },
    );
  }

  const org = await getCurrentOrg();

  // Verify both rows belong to the caller's org. Without this an
  // attacker with a valid session could enqueue a run against another
  // tenant's vertical / search.
  const [vertical, savedSearch] = await Promise.all([
    prisma.vertical.findFirst({
      where: { id: verticalId, organizationId: org.id },
      select: { id: true, slug: true },
    }),
    prisma.savedSearch.findFirst({
      where: { id: savedSearchId, organizationId: org.id, verticalId },
      select: { id: true, name: true, contactCap: true },
    }),
  ]);
  if (!vertical || !savedSearch) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Snapshot the rotation pool + sequence name at launch time so the
  // cron picks them up even if a domain cools or a sequence is renamed
  // between now and 6am.
  const domains = await prisma.sendingDomain.findMany({
    where: { organizationId: org.id, status: "HEALTHY" },
    orderBy: { lastUsedAt: "asc" },
    take: 5,
    select: { domain: true, apolloMailboxId: true },
  });

  const run = await prisma.bDRun.create({
    data: {
      organizationId: org.id,
      verticalId: vertical.id,
      savedSearchId: savedSearch.id,
      status: "QUEUED",
      plan: {
        contactCap: savedSearch.contactCap ?? 80,
        domains: domains.map((d) => d.domain),
      },
    },
    select: { id: true, createdAt: true, status: true },
  });

  return NextResponse.json(run, { status: 201 });
}
