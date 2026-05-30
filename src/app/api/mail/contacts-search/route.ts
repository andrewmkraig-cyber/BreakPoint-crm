import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getGmailSentRecipients } from "@/lib/gmail-recipients";

// GET /api/mail/contacts-search?q=… — typeahead source for the mail
// composer's To field. Three sources, all merged into a single
// deduped { name, email } list (max 8), priority-sorted:
//
//   1. Candidates (firstName / lastName / email), org-scoped.
//   2. Contacts (firstName / lastName / name + every entry in
//      emails[]), org-scoped.
//   3. Gmail Sent recipients — anyone the recruiter has emailed
//      previously, even if they aren't in Ace. Snapshot of the
//      last 500 sent messages, cached 30min in-process. Filtered
//      against the query in-route so we hit Gmail at most once per
//      30 min per user, not per keystroke.
//
// Sort order: exact email match → prefix-of-local-part →
// prefix-of-name → contains. Within each tier, source rank wins
// (Ace > Gmail) since manually curated contacts outrank random
// sent-mail addresses.
//
// Contact.emails is text[] in Postgres; Prisma's array filters can't
// do a partial-match on element contents, so the Contact branch
// drops to a parameterized $queryRaw — the only user-controlled
// value is the LIKE pattern, which is bound through Prisma's tag
// template (no string interpolation, no injection risk).

export const dynamic = "force-dynamic";

const MAX_RESULTS = 8;
const MIN_QUERY_LEN = 2;
const PER_SOURCE_LIMIT = 20;

type ContactRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  emails: string[] | null;
};

type Candidate = { name: string; email: string; sourceRank: number };

// Score a candidate against the query. Higher is better.
//   3 — exact email match
//   2 — local-part starts with the query, or name starts with it
//   1 — substring match anywhere
//   0 — no match (caller filters these out)
// sourceRank breaks ties: Ace candidates/contacts (rank 1) come
// before Gmail history (rank 0) at the same score level.
function scoreMatch(name: string, email: string, q: string): number {
  const lowerEmail = email.toLowerCase();
  const lowerName = name.toLowerCase();
  if (lowerEmail === q) return 3;
  const localPart = lowerEmail.split("@")[0] ?? "";
  if (localPart.startsWith(q)) return 2;
  if (lowerName.startsWith(q)) return 2;
  if (lowerEmail.includes(q) || lowerName.includes(q)) return 1;
  return 0;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  const org = await getCurrentOrg();
  // The Gmail call needs a userId, not an email. Look it up once;
  // null means we silently skip the gmail branch (e.g. a service
  // account with no User row).
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });

  const url = new URL(req.url);
  // Warm-up ping fired when the composer opens: kick the Gmail snapshot
  // load in the background (non-blocking) so the sent-mail history is
  // ready by the time the recruiter starts typing, then return empty.
  if (url.searchParams.get("warm")) {
    if (user) void getGmailSentRecipients(user.id, { wait: false });
    return NextResponse.json({ ok: true, contacts: [] });
  }
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY_LEN) {
    return NextResponse.json({ ok: true, contacts: [] });
  }
  const lowerQ = q.toLowerCase();
  // Escape LIKE meta-characters so a literal "%" or "_" doesn't blow
  // the search wide open.
  const escaped = q.replace(/[\\%_]/g, (m) => "\\" + m);
  const pattern = `%${escaped}%`;

  const candidatesPromise = prisma.candidate.findMany({
    where: {
      organizationId: org.id,
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { firstName: true, lastName: true, email: true },
    take: PER_SOURCE_LIMIT,
  });

  const contactsPromise = prisma.$queryRaw<ContactRow[]>`
    SELECT id, "firstName", "lastName", name, emails
    FROM "Contact"
    WHERE "organizationId" = ${org.id}
      AND (
        "firstName" ILIKE ${pattern}
        OR "lastName" ILIKE ${pattern}
        OR name ILIKE ${pattern}
        OR EXISTS (SELECT 1 FROM unnest(emails) e WHERE e ILIKE ${pattern})
      )
    LIMIT ${PER_SOURCE_LIMIT}
  `;

  // Gmail Sent recipients: cached snapshot of the last 500 sent
  // messages, refreshed every 30 min. Helper returns [] on any
  // failure so a Gmail outage just hides these rows.
  // wait:false — never block the typeahead on a cold Gmail snapshot. The
  // Ace DB matches below return immediately; Gmail-history rows fold in
  // on a later keystroke once the background snapshot warms.
  const gmailPromise: Promise<{ name: string; email: string }[]> = user
    ? getGmailSentRecipients(user.id, { wait: false })
    : Promise.resolve([]);

  const [aceCandidates, aceContacts, gmailRecipients] = await Promise.all([
    candidatesPromise,
    contactsPromise,
    gmailPromise,
  ]);

  // Dedupe across all sources by lowercased email. Ace sources are
  // pushed first so the dedupe set keeps Ace versions of an address
  // (with the canonical Ace display name) over a Gmail header parse.
  const byEmail = new Map<string, Candidate>();

  function add(name: string, email: string | null | undefined, sourceRank: number) {
    if (!email) return;
    const key = email.toLowerCase();
    if (byEmail.has(key)) return;
    byEmail.set(key, {
      name: name.trim() || email,
      email,
      sourceRank,
    });
  }

  for (const c of aceCandidates) {
    const fullName = [c.firstName, c.lastName]
      .filter((s): s is string => Boolean(s))
      .join(" ")
      .trim();
    add(fullName, c.email, 1);
  }
  for (const c of aceContacts) {
    const display =
      c.name?.trim() ||
      [c.firstName, c.lastName].filter((s): s is string => Boolean(s)).join(" ").trim() ||
      "";
    for (const email of c.emails ?? []) {
      add(display, email, 1);
    }
  }
  for (const r of gmailRecipients) {
    add(r.name, r.email, 0);
  }

  // Filter to entries that match the query, then sort by score and
  // source rank. Equal-score-and-rank ties fall back to email order
  // for stable output.
  const scored = Array.from(byEmail.values())
    .map((c) => ({ ...c, score: scoreMatch(c.name, c.email, lowerQ) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.sourceRank !== a.sourceRank) return b.sourceRank - a.sourceRank;
      return a.email.localeCompare(b.email);
    });

  return NextResponse.json({
    ok: true,
    contacts: scored.slice(0, MAX_RESULTS).map(({ name, email }) => ({
      name,
      email,
    })),
  });
}
