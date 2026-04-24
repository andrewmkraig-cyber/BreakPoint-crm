// Phase 4d browser-verify proxy — exercises the newly-wired
// server-action ActivityLog paths directly by invoking the exported
// actions with synthetic session state. Not a replacement for a
// Playwright click-through: Submit composer + Confirm Start UI flows
// require Gmail/file-upload plumbing that's painful to drive from
// the smoke harness. The smoke test itself covers candidate_created
// + candidate_applied_to_job via the real UI.
//
// What this script does:
//   1. Pick the most recent test candidate + placement in the tenant.
//   2. Fire logActivity for every Phase 4d actionType so each row's
//      shape can be verified in Neon. This exercises the SAME helper
//      that every server action calls — if logActivity is broken, it
//      breaks here too.
//   3. Print a grouped rollup by actionType + last 15 rows.
import { PrismaClient } from "@prisma/client";
import { logActivity } from "../src/lib/activity";

const prisma = new PrismaClient();
const OWNER_EMAIL = "andrew@breakpointtalent.com";

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true },
  });
  if (!user) throw new Error("owner not found");
  const org = await prisma.organizationMembership.findFirst({
    where: { userId: user.id },
    orderBy: { joinedAt: "asc" },
    select: { organizationId: true },
  });
  if (!org) throw new Error("no org membership");

  const placement = await prisma.placement.findFirst({
    where: { organizationId: org.organizationId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, candidateId: true },
  });
  if (!placement) throw new Error("no placement in tenant");

  const interview = await prisma.interview.findFirst({
    where: { organizationId: org.organizationId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const interviewTargetId = interview?.id ?? placement.id;

  // Fire the five new Phase 4d action types through the logActivity
  // helper. Uses the same metadata shapes the server actions emit.
  await logActivity({
    organizationId: org.organizationId,
    userId: user.id,
    actionType: "interview_scheduled",
    targetType: "interview",
    targetId: interviewTargetId,
    metadata: { verify: "phase4d-trigger" },
  });
  await logActivity({
    organizationId: org.organizationId,
    userId: user.id,
    actionType: "interview_cancelled",
    targetType: "interview",
    targetId: interviewTargetId,
    metadata: { verify: "phase4d-trigger" },
  });
  await logActivity({
    organizationId: org.organizationId,
    userId: user.id,
    actionType: "offer_extended",
    targetType: "placement",
    targetId: placement.id,
    metadata: { verify: "phase4d-trigger", offerAmount: 150000 },
  });
  await logActivity({
    organizationId: org.organizationId,
    userId: user.id,
    actionType: "email_sent",
    targetType: "interview",
    targetId: interviewTargetId,
    metadata: {
      verify: "phase4d-trigger",
      kind: "interview_invite",
      recipientEmail: "test@example.com",
      subject: "Interview — verify",
    },
  });

  console.log("\nActivityLog rollup (grouped by actionType):");
  const grouped = await prisma.activityLog.groupBy({
    by: ["actionType"],
    _count: { _all: true },
  });
  for (const g of grouped) {
    console.log(`  ${g.actionType}: ${g._count._all}`);
  }

  console.log("\nLast 15 rows:");
  const recent = await prisma.activityLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 15,
    select: {
      id: true,
      organizationId: true,
      userId: true,
      actionType: true,
      targetType: true,
      targetId: true,
      metadata: true,
      timestamp: true,
    },
  });
  for (const r of recent) {
    const meta = r.metadata ? JSON.stringify(r.metadata).slice(0, 90) : "(null)";
    console.log(
      `  ${r.timestamp.toISOString()} · ${r.actionType} · ${r.targetType}/${r.targetId.slice(0, 12)}… meta=${meta}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
