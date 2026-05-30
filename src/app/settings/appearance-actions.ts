"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Auto Night Mode preference lives on UserProfile (per signed-in user,
// not per org and not in localStorage) so the day/night flip follows
// the recruiter across every device they sign in on. The chosen Court
// Mode surface + theme stay in localStorage - this flag only controls
// whether the client auto-flips to the dark variant at 7:00 PM ET and
// back to light at 7:00 AM ET. Mirrors personal-info-actions.ts.

type Result = { ok: true } | { ok: false; error: string };

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function getAutoNightMode(): Promise<boolean> {
  const userId = await requireUserId();
  if (!userId) return false;
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { autoNightMode: true },
  });
  return profile?.autoNightMode ?? false;
}

// Persist the chosen Court Mode surface / theme to UserProfile so the
// preference survives a localStorage eviction (iOS PWA hard close) and
// follows the user across devices. Mirrors the localStorage write the
// client already does; either column can be written independently so a
// theme toggle doesn't clobber the surface and vice versa. Fire-and-forget
// on the client - the local state + localStorage are already correct for
// this session even if the network write lags or fails.
const SURFACE_VALUES = new Set(["hard", "clay", "grass", "night"]);
const THEME_VALUES = new Set(["light", "dark"]);

export async function setCourtMode(input: {
  surface?: string;
  theme?: string;
}): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const data: { courtSurface?: string; courtTheme?: string } = {};
  if (input.surface && SURFACE_VALUES.has(input.surface)) {
    data.courtSurface = input.surface;
  }
  if (input.theme && THEME_VALUES.has(input.theme)) {
    data.courtTheme = input.theme;
  }
  if (data.courtSurface === undefined && data.courtTheme === undefined) {
    return { ok: true };
  }
  try {
    await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to save Court Mode.",
    };
  }
}

export async function setAutoNightMode(enabled: boolean): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  try {
    await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, autoNightMode: enabled },
      update: { autoNightMode: enabled },
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to save Auto Night Mode.",
    };
  }
}
