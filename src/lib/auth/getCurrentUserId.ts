import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Current signed-in user's id, for ownership scoping and stamping.
// Reads the id off the JWT session (stamped in src/lib/auth.ts) to avoid
// a DB round-trip, falling back to an email lookup for older sessions.
// Returns null when there is no session.
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  if (session.user.id) return session.user.id;
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return u?.id ?? null;
}
