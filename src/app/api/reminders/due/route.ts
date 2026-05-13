import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Past-due, undismissed reminders for the active org. The global
// ReminderToastProvider polls this every 60s + on mount so reminder
// toasts surface regardless of which page the recruiter is on (the
// previous design only ticked while /calendar was mounted).
//
// Unauthenticated callers get an empty list rather than a 401 — the
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

  const rows = await prisma.aceReminder.findMany({
    where: {
      organizationId: orgId,
      dismissed: false,
      reminderAt: { lte: new Date() },
    },
    orderBy: { reminderAt: "asc" },
    take: 20,
    select: { id: true, title: true, reminderAt: true },
  });

  return NextResponse.json({
    reminders: rows.map((r) => ({
      id: r.id,
      title: r.title,
      reminderAt: r.reminderAt.toISOString(),
    })),
  });
}
