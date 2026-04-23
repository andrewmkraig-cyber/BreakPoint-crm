import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Resolves the current tenant's organization id for the active request.
//
// Lookup order:
//   1. The signed-in user's first OrganizationMembership (by joinedAt).
//      Single-org per user is the current reality; when we add multi-org
//      switching this is where we'll honour the active-org cookie.
//   2. DEFAULT_ORG_ID env var — the Phase 1 fallback that lets transitional
//      code paths (unauthenticated background jobs, scripts, etc.) resolve
//      to the BreakPoint Talent org without a session.
//
// Throws if neither resolves. Callers should treat that as a bug: every
// tenant-scoped code path must run inside either a session or a context
// with DEFAULT_ORG_ID set.
export async function getCurrentOrg(): Promise<{ id: string }> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (email) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (user) {
      const membership = await prisma.organizationMembership.findFirst({
        where: { userId: user.id },
        orderBy: { joinedAt: "asc" },
        select: { organizationId: true },
      });
      if (membership) return { id: membership.organizationId };
    }
  }

  const fallback = process.env.DEFAULT_ORG_ID;
  if (fallback) return { id: fallback };

  throw new Error(
    "getCurrentOrg: no session membership and no DEFAULT_ORG_ID env — cannot resolve tenant",
  );
}
