import { cache } from "react";

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
//
// Wrapped in React's cache() because this is called ~314 times across 161
// files — Rule 8 means essentially every tenant-scoped query resolves the
// org first, and several pages call it more than once per render (see
// jobs/page.tsx, which resolves it in its Promise.all AND again inside
// buildLastTouchedByJobCuid). Without memoization each call re-decoded the
// session and re-queried the database. cache() collapses them to one
// resolution per request.
//
// cache() is request-scoped by React, not process-global, so a memoized org
// can never leak from one signed-in user to another — which matters here
// because this value IS the tenant boundary. Outside a request scope
// (scripts, background jobs) cache() degrades to no memoization rather than
// sharing, so the DEFAULT_ORG_ID path is unaffected.
export const getCurrentOrg = cache(async function getCurrentOrg(): Promise<{ id: string }> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (email) {
    // Single query via the memberships relation. This was previously a
    // findUnique for the user followed by a findFirst for the membership —
    // two serial round trips where the join does it in one. `take: 1` with
    // the same joinedAt ordering preserves the original "first membership"
    // semantics, and selecting only the relation still requires the user
    // row to exist, matching the old `if (user)` guard.
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        memberships: {
          orderBy: { joinedAt: "asc" },
          take: 1,
          select: { organizationId: true },
        },
      },
    });
    const organizationId = user?.memberships[0]?.organizationId;
    if (organizationId) return { id: organizationId };
  }

  const fallback = process.env.DEFAULT_ORG_ID;
  if (fallback) return { id: fallback };

  throw new Error(
    "getCurrentOrg: no session membership and no DEFAULT_ORG_ID env. Cannot resolve tenant",
  );
});
