import { encode } from "next-auth/jwt";
import { prisma } from "../../src/lib/prisma";
import type { BrowserContext } from "@playwright/test";

// Auth strategy: compute a valid NextAuth JWT for Andrew's user row and set
// it directly as the session cookie on the Playwright browser context.
// That skips the Google OAuth round-trip entirely (impossible in CI) and
// avoids any test-only modifications to the production auth config.
// Only requirement is NEXTAUTH_SECRET in the test runner's env — same
// secret the running dev server is using, otherwise the cookie won't
// verify.

// NextAuth cookie name in non-HTTPS dev. In production (HTTPS) the cookie
// would be `__Secure-next-auth.session-token`; smoke tests always run
// against http://localhost, so the unprefixed form is correct.
const COOKIE_NAME = "next-auth.session-token";

const OWNER_EMAIL = "andrew@breakpointtalent.com";

export async function signInAsOwner(context: BrowserContext, baseURL: string): Promise<{ userId: string }> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET not set — smoke tests can't forge a session without it.");
  }

  const user = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    throw new Error(`Test owner ${OWNER_EMAIL} not found in Neon — seed the user or run the seed-default-org script first.`);
  }

  const token = await encode({
    token: {
      sub: user.id,
      id: user.id,
      email: user.email,
      name: user.name,
      role: "ADMIN",
      // NextAuth stamps iat / exp itself when we pass `maxAge`.
    },
    secret,
    maxAge: 30 * 24 * 60 * 60, // 30 days — way longer than any smoke run.
  });

  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: token,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      // Non-secure because we're on http://localhost.
      secure: false,
    },
  ]);

  return { userId: user.id };
}

// Teardown helper — removes every Placement, Interview, ActionLog,
// CandidateResume, and SmsMessage that points at the test candidate, then
// the Candidate itself. Safe to call even if prior cleanup partially ran.
export async function deleteCandidateDeep(candidateId: string): Promise<void> {
  // Cascade handles: Placement, Interview, CandidateResume (FK to Candidate
  // with onDelete: Cascade), KrispcallLog.candidateId = SetNull.
  // ActionLog rows keyed by subjectId = candidateId don't have a FK, so
  // delete them manually to keep the activity table tidy.
  await prisma.actionLog.deleteMany({
    where: { subjectType: "candidate", subjectId: candidateId },
  });
  await prisma.candidate.delete({ where: { id: candidateId } }).catch(() => {
    // Candidate may already be gone if a prior run cleaned up.
  });
}

// Bulk cleanup — nukes any leftover smoke-test candidates matching the
// name prefix. Called at the start of the test in case a prior run
// crashed before reaching its own teardown.
export async function cleanupStaleSmokeCandidates(): Promise<void> {
  const stale = await prisma.candidate.findMany({
    where: { firstName: { startsWith: "Smoke" }, lastName: { startsWith: "Test" } },
    select: { id: true },
  });
  for (const s of stale) {
    await deleteCandidateDeep(s.id);
  }
}
