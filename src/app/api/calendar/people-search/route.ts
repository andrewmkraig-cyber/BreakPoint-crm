import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// GET /api/calendar/people-search?q=… — typeahead source for the
// calendar event drawer's guest field. Three org-scoped sources:
//   1. Team members (org users) — typing "au" → austin@…
//   2. Candidates
//   3. Contacts (Contact.emails is text[], hit via $queryRaw to match
//      against array elements).
// Returns up to 8 deduped { name, email } rows scored by match quality.

export const dynamic = "force-dynamic";

const MAX_RESULTS = 8;
const MIN_QUERY_LEN = 1;
const PER_SOURCE_LIMIT = 20;

type ContactRow = {
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  emails: string[] | null;
};

type Person = { name: string; email: string; sourceRank: number };

function score(name: string, email: string, q: string): number {
  const lowerEmail = email.toLowerCase();
  const lowerName = name.toLowerCase();
  if (lowerEmail === q) return 3;
  const local = lowerEmail.split("@")[0] ?? "";
  if (local.startsWith(q) || lowerName.startsWith(q)) return 2;
  if (lowerEmail.includes(q) || lowerName.includes(q)) return 1;
  return 0;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const org = await getCurrentOrg();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY_LEN) {
    return NextResponse.json({ ok: true, people: [] });
  }
  const lowerQ = q.toLowerCase();
  const escaped = q.replace(/[\\%_]/g, (m) => "\\" + m);
  const pattern = `%${escaped}%`;

  const [teamUsers, candidates, contacts] = await Promise.all([
    // Team members are sourced from OrganizationMembership → User.
    // Rank 2 (above candidates/contacts) because "au" should pop
    // Austin instantly without contacts/candidates outscoring him.
    prisma.organizationMembership.findMany({
      where: {
        organizationId: org.id,
        user: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
      },
      include: { user: { select: { name: true, email: true } } },
      take: PER_SOURCE_LIMIT,
    }),
    prisma.candidate.findMany({
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
    }),
    prisma.$queryRaw<ContactRow[]>`
      SELECT "firstName", "lastName", name, emails
      FROM "Contact"
      WHERE "organizationId" = ${org.id}
        AND (
          "firstName" ILIKE ${pattern}
          OR "lastName" ILIKE ${pattern}
          OR name ILIKE ${pattern}
          OR EXISTS (SELECT 1 FROM unnest(emails) e WHERE e ILIKE ${pattern})
        )
      LIMIT ${PER_SOURCE_LIMIT}
    `,
  ]);

  const byEmail = new Map<string, Person>();
  function add(name: string, email: string | null | undefined, sourceRank: number) {
    if (!email) return;
    const key = email.toLowerCase();
    if (byEmail.has(key)) return;
    byEmail.set(key, { name: name.trim() || email, email, sourceRank });
  }

  for (const m of teamUsers) {
    add(m.user.name ?? "", m.user.email, 2);
  }
  for (const c of candidates) {
    const fullName = [c.firstName, c.lastName]
      .filter((s): s is string => Boolean(s))
      .join(" ")
      .trim();
    add(fullName, c.email, 1);
  }
  for (const c of contacts) {
    const display =
      c.name?.trim() ||
      [c.firstName, c.lastName].filter((s): s is string => Boolean(s)).join(" ").trim() ||
      "";
    for (const email of c.emails ?? []) {
      add(display, email, 1);
    }
  }

  const scored = Array.from(byEmail.values())
    .map((p) => ({ ...p, s: score(p.name, p.email, lowerQ) }))
    .filter((p) => p.s > 0)
    .sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      if (b.sourceRank !== a.sourceRank) return b.sourceRank - a.sourceRank;
      return a.email.localeCompare(b.email);
    });

  return NextResponse.json({
    ok: true,
    people: scored.slice(0, MAX_RESULTS).map(({ name, email }) => ({ name, email })),
  });
}
