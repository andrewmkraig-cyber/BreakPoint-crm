import "server-only";

import { prisma } from "@/lib/prisma";

// The firm owner (Organization.ownerId, Andrew) has full access to every
// client and every job in the org, whoever owns the client (2026-11-24:
// "every client in Ace I should be able to have full access to"). Per-user
// client ownership still exists and still shows; it just never locks the
// firm owner out. Server-side check, used by the client page and by the
// job publishing actions that key off client ownership.
export async function isFirmOwner(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const org = await prisma.organization.findFirst({
    where: { ownerId: userId },
    select: { id: true },
  });
  return org != null;
}
