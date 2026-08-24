import { cache } from "react";

import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Current signed-in user's id, for ownership scoping and stamping.
// Reads the id off the JWT session (stamped in src/lib/auth.ts) to avoid
// a DB round-trip, falling back to an email lookup for older sessions.
// Returns null when there is no session.
//
// cache()d for the same reason as getCurrentOrg: it is called alongside it
// on nearly every tenant-scoped path, and the older-session fallback below
// hits the database. Request-scoped, so no cross-user leakage.
export const getCurrentUserId = cache(async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  if (session.user.id) return session.user.id;
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return u?.id ?? null;
});
