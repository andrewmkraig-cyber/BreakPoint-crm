import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getGmailSentRecipients } from "@/lib/gmail-recipients";
import {
  rankMailContactSuggestions,
  type MailContactSuggestion,
} from "@/lib/mail-contact-suggestions";

// GET /api/mail/contacts-search?q=… — typeahead source for the mail
// composer's To field. Three sources, all merged into a single
// deduped { name, email } list (max 10), priority-sorted:
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
// Sort order is email-intent first: exact email → prefix-of-local-part
// → prefix-of-name → prefix-of-domain → contains. This keeps
// previously emailed external addresses (receipts@mercury.com) from
// being buried under ACE candidates whose names happen to start with
// the same letters.
//
// Contact.emails is text[] in Postgres; Prisma's array filters can't
// do a partial-match on element contents, so the Contact branch
// drops to a parameterized $queryRaw — the only user-controlled
// value is the LIKE pattern, which is bound through Prisma's tag
// template (no string interpolation, no injection risk).

export const dynamic = "force-dynamic";

const MAX_RESULTS = 10;
const MIN_QUERY_LEN = 2;
const PER_SOURCE_LIMIT = 20;

type ContactRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  emails: string[] | null;
};

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
  // load so the sent-mail history is ready by the time the recruiter
  // starts typing. `wait=1` lets the client rerun the current prefix
  // when the warm finishes; without it this stays the legacy fire-and-
  // forget ping.
  if (url.searchParams.get("warm")) {
    const wait = url.searchParams.get("wait") === "1";
    const recipients = user
      ? await getGmailSentRecipients(user.id, { wait })
      : [];
    return NextResponse.json({
      ok: true,
      contacts: [],
      warmed: wait,
      count: recipients.length,
    });
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
  const byEmail = new Map<string, MailContactSuggestion>();

  function add(
    name: string,
    email: string | null | undefined,
    source: MailContactSuggestion["source"],
    sourceIndex: number,
  ) {
    if (!email) return;
    const key = email.toLowerCase();
    if (byEmail.has(key)) return;
    byEmail.set(key, {
      name: name.trim() || email,
      email,
      source,
      sourceIndex,
    });
  }

  for (let i = 0; i < aceCandidates.length; i++) {
    const c = aceCandidates[i]!;
    const fullName = [c.firstName, c.lastName]
      .filter((s): s is string => Boolean(s))
      .join(" ")
      .trim();
    add(fullName, c.email, "ace", i);
  }
  for (let i = 0; i < aceContacts.length; i++) {
    const c = aceContacts[i]!;
    const display =
      c.name?.trim() ||
      [c.firstName, c.lastName].filter((s): s is string => Boolean(s)).join(" ").trim() ||
      "";
    for (const email of c.emails ?? []) {
      add(display, email, "ace", aceCandidates.length + i);
    }
  }
  for (let i = 0; i < gmailRecipients.length; i++) {
    const r = gmailRecipients[i]!;
    add(r.name, r.email, "gmail", i);
  }

  const scored = rankMailContactSuggestions(Array.from(byEmail.values()), lowerQ);

  return NextResponse.json({
    ok: true,
    contacts: scored.slice(0, MAX_RESULTS).map(({ name, email }) => ({
      name,
      email,
    })),
  });
}
