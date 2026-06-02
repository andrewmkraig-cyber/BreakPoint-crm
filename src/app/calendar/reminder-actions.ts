"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Server actions for the Ace-native reminders panel on /calendar.
// Both actions resolve org + user server-side so the caller can't
// spoof another tenant by passing a different orgId across the
// boundary (CLAUDE.md rule 8 - every tenant-scoped write checks
// organizationId). Dates cross the action boundary as ISO strings;
// Next handles native Date too but ISO is unambiguous and lighter
// on the wire.

// Notification leads (minutes before the reminder time) the panel
// offers. Kept server-side too so a spoofed payload can't persist an
// arbitrary lead. 0 means "fire exactly at the reminder time" and is
// reserved for event/interview-linked rows, not the panel.
const ALLOWED_LEADS = [0, 15, 30, 60, 120, 1440];

// Clean an incoming lead list: keep only allowed values, dedupe, sort
// soonest-notification-first (largest lead), cap at three. Falls back
// to the standard single 15-minute lead when nothing valid remains.
function sanitizeLeads(leads: number[] | undefined): number[] {
  const valid = Array.from(
    new Set((leads ?? []).filter((n) => ALLOWED_LEADS.includes(n))),
  ).sort((a, b) => b - a);
  const capped = valid.slice(0, 3);
  return capped.length > 0 ? capped : [15];
}

export async function createReminder(
  title: string,
  reminderAtIso: string,
  notifyLeadsMin?: number[],
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

  // [reminder-tz-diag] TEMP — remove once Andrew confirms reminder times
  // land correctly in prod. Shows the exact string that crossed the
  // boundary vs the absolute instant + the Eastern wall-clock it resolves
  // to, so a skew is visible at the storage hop.
  // eslint-disable-next-line no-console
  console.log("[reminder-tz-diag] createReminder.store", {
    reminderAtIso,
    storedUtc: reminderAt.toISOString(),
    storedEastern: reminderAt.toLocaleString("en-US", { timeZone: "America/New_York" }),
  });

  const row = await prisma.aceReminder.create({
    data: {
      organizationId: org.id,
      userId: session.user.id,
      title: trimmed,
      reminderAt,
      notifyLeadsMin: sanitizeLeads(notifyLeadsMin),
    },
    select: { id: true },
  });

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true, id: row.id };
}

export async function updateReminder(
  id: string,
  title: string,
  reminderAtIso: string,
  notifyLeadsMin: number[],
): Promise<{ ok: true }> {
  const org = await getCurrentOrg();

  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required");

  const reminderAt = new Date(reminderAtIso);
  if (Number.isNaN(reminderAt.getTime())) {
    throw new Error("Invalid reminder time");
  }

  // Reset notifiedLeadsMin so the new schedule re-fires cleanly; the
  // org filter keeps a cross-tenant id from mutating another org's row.
  await prisma.aceReminder.updateMany({
    where: { id, organizationId: org.id },
    data: {
      title: trimmed,
      reminderAt,
      notifyLeadsMin: sanitizeLeads(notifyLeadsMin),
      notifiedLeadsMin: [],
      dismissed: false,
    },
  });

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteReminder(id: string): Promise<{ ok: true }> {
  const org = await getCurrentOrg();
  await prisma.aceReminder.deleteMany({
    where: { id, organizationId: org.id },
  });

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function dismissReminder(id: string): Promise<{ ok: true }> {
  const org = await getCurrentOrg();
  // updateMany + the org filter is intentional - it makes the write a
  // no-op if the id belongs to a different org instead of throwing,
  // which is the behaviour we want for an idempotent dismiss.
  await prisma.aceReminder.updateMany({
    where: { id, organizationId: org.id },
    data: { dismissed: true },
  });

  revalidatePath("/calendar");
  return { ok: true };
}
