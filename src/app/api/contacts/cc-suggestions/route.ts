import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

// Same-company CC picker source. Given the email address typed into a
// composer's To field, looks the email up against Contact.emails (a
// String[] in Postgres), reads that contact's clientId, and returns
// every OTHER Contact at the same Client. Recruiter clicks one to add
// it as a CC. Tenant-scoped — a stranger probing by email gets the
// empty list, never a cross-org leak.
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ contacts: [] });
  }

  const org = await getCurrentOrg();

  // Postgres String[] uses the `has` operator for exact-match against
  // any element. Email casing in Gmail is canonically lowercase but
  // some imports keep mixed case, so we match on the lowered form by
  // pulling candidate rows then filtering — there's no case-insensitive
  // array-contains operator in Prisma's filter grammar.
  const seed = await prisma.contact.findFirst({
    where: {
      organizationId: org.id,
      emails: { has: email },
    },
    select: { clientId: true },
  });
  // Fallback for mixed-case stored emails: a wider lookup that's still
  // tenant-scoped, then filter in memory.
  let clientId = seed?.clientId ?? null;
  if (!clientId) {
    const candidates = await prisma.contact.findMany({
      where: { organizationId: org.id, clientId: { not: null } },
      select: { id: true, clientId: true, emails: true },
      take: 5000,
    });
    const match = candidates.find((c) =>
      Array.isArray(c.emails)
        ? c.emails.some((e) => e?.toLowerCase() === email)
        : false,
    );
    clientId = match?.clientId ?? null;
  }
  if (!clientId) {
    return NextResponse.json({ contacts: [] });
  }

  const peers = await prisma.contact.findMany({
    where: { organizationId: org.id, clientId },
    select: {
      firstName: true,
      lastName: true,
      name: true,
      emails: true,
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  // Project down to {name, email} pairs the composer's CC picker
  // expects. Skip the seed contact itself (caller already typed them
  // into the To row) and skip rows without any email — they can't be
  // CC'd anyway.
  const contacts: Array<{ name: string; email: string }> = [];
  for (const p of peers) {
    const composed =
      [p.firstName, p.lastName].filter(Boolean).join(" ") || p.name || "";
    const emails = Array.isArray(p.emails) ? p.emails : [];
    for (const e of emails) {
      if (!e) continue;
      if (e.toLowerCase() === email) continue;
      contacts.push({ name: composed || e, email: e });
      break;
    }
  }

  return NextResponse.json({ contacts });
}
