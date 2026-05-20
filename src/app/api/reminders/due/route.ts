import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Due, undismissed reminder notifications for the active org. The
// global ReminderToastProvider polls this every 60s + on mount so
// toasts surface regardless of which page the recruiter is on.
//
// A reminder fires at reminderAt minus each lead in notifyLeadsMin
// (e.g. 15 min before). Each lead pops once: we mark fired leads in
// notifiedLeadsMin here so a reload or the next poll does not re-fire
// it. Marking inside this GET is a deliberate side effect - it is the
// single place that decides a notification has gone out.
//
// Unauthenticated callers get an empty list rather than a 401 - the
// poll runs from every page including the sign-in flow and we don't
// want noisy network errors there.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ reminders: [] });
  }

  let orgId: string;
  try {
    const org = await getCurrentOrg();
    orgId = org.id;
  } catch {
    return NextResponse.json({ reminders: [] });
  }

  const now = new Date();
  const candidates = await prisma.aceReminder.findMany({
    where: {
      organizationId: orgId,
      dismissed: false,
      // Anchor no older than a day so we never resurrect stale leads,
      // but future anchors stay in range so their before-leads can fire.
      reminderAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
    orderBy: { reminderAt: "asc" },
    take: 100,
    select: {
      id: true,
      title: true,
      reminderAt: true,
      notifyLeadsMin: true,
      notifiedLeadsMin: true,
    },
  });

  const due: Array<{ key: string; id: string; title: string; reminderAt: string }> = [];
  for (const r of candidates) {
    const leads = r.notifyLeadsMin.length > 0 ? r.notifyLeadsMin : [15];
    const fired = new Set(r.notifiedLeadsMin);
    const dueLeads = leads.filter(
      (lead) =>
        !fired.has(lead) &&
        r.reminderAt.getTime() - lead * 60_000 <= now.getTime(),
    );
    if (dueLeads.length === 0) continue;

    await prisma.aceReminder.update({
      where: { id: r.id },
      data: {
        notifiedLeadsMin: Array.from(new Set([...r.notifiedLeadsMin, ...dueLeads])),
      },
    });

    // Collapse a batch into one toast (closest lead to the anchor); the
    // key dedupes per lead-batch on the client.
    const lead = Math.min(...dueLeads);
    due.push({
      key: `${r.id}:${lead}`,
      id: r.id,
      title: r.title,
      reminderAt: r.reminderAt.toISOString(),
    });
  }

  return NextResponse.json({ reminders: due });
}
