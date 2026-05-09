import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// GET /api/mail/contacts-search?q=… — typeahead source for the mail
// composer's To field. Searches both Candidates (firstName /
// lastName / email) and Contacts (firstName / lastName / name +
// every entry in the emails[] array), all scoped to the active org.
//
// Returns up to 6 { name, email } items merged across both sources,
// deduped on email (lowercased). The composer hits this on every
// keystroke (debounced 200ms client-side) so the route stays narrow:
// no joins, no extra fields beyond what the dropdown renders.
//
// Contact.emails is text[] in Postgres; Prisma's array filters can't
// do a partial-match on element contents, so the Contact branch
// drops to a parameterized $queryRaw — the only user-controlled
// value is the LIKE pattern, which is bound through Prisma's tag
// template (no string interpolation, no injection risk).

export const dynamic = "force-dynamic";

const MAX_RESULTS = 6;
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

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY_LEN) {
    return NextResponse.json({ ok: true, contacts: [] });
  }
  // Escape LIKE meta-characters in the user's query so a literal "%"
  // or "_" doesn't blow the search wide open.
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

  const [candidates, contacts] = await Promise.all([
    candidatesPromise,
    contactsPromise,
  ]);

  const seen = new Set<string>();
  const out: { name: string; email: string }[] = [];
  function push(name: string, email: string | null | undefined) {
    if (!email) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: name.trim() || email, email });
  }

  for (const c of candidates) {
    const fullName = [c.firstName, c.lastName]
      .filter((s): s is string => Boolean(s))
      .join(" ")
      .trim();
    push(fullName, c.email);
  }
  for (const c of contacts) {
    const display =
      c.name?.trim() ||
      [c.firstName, c.lastName].filter((s): s is string => Boolean(s)).join(" ").trim() ||
      "";
    for (const email of c.emails ?? []) {
      push(display, email);
      if (out.length >= MAX_RESULTS) break;
    }
    if (out.length >= MAX_RESULTS) break;
  }

  return NextResponse.json({
    ok: true,
    contacts: out.slice(0, MAX_RESULTS),
  });
}
