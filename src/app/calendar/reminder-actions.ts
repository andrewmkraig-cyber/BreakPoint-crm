"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Server actions for the Ace-native reminders panel on /calendar.
// Both actions resolve org + user server-side so the caller can't
// spoof another tenant by passing a different orgId across the
// boundary (CLAUDE.md rule 8 — every tenant-scoped write checks
// organizationId). Dates cross the action boundary as ISO strings;
// Next handles native Date too but ISO is unambiguous and lighter
// on the wire.

export async function createReminder(
  title: string,
  reminderAtIso: string,
): Promise<{ ok: true; id: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error("Not signed in");
  const org = await getCurrentOrg();

  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required");

  const reminderAt = new Date(reminderAtIso);
  if (Number.isNaN(reminderAt.getTime())) {
    throw new Error("Invalid reminder time");
  }

  const row = await prisma.aceReminder.create({
    data: {
      organizationId: org.id,
      userId: session.user.id,
      title: trimmed,
      reminderAt,
    },
    select: { id: true },
  });

  revalidatePath("/calendar");
  return { ok: true, id: row.id };
}

export async function dismissReminder(id: string): Promise<{ ok: true }> {
  const org = await getCurrentOrg();
  // updateMany + the org filter is intentional — it makes the write a
  // no-op if the id belongs to a different org instead of throwing,
  // which is the behaviour we want for an idempotent dismiss.
  await prisma.aceReminder.updateMany({
    where: { id, organizationId: org.id },
    data: { dismissed: true },
  });

  revalidatePath("/calendar");
  return { ok: true };
}
