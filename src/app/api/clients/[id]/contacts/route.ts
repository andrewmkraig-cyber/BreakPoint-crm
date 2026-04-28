import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

// Returns the contact roster for one client as { name, email } pairs
// suitable for the email composer's To-field typeahead. Used by the
// global FAB when launched from /clients/[id] so the recruiter can
// start typing a contact name and pick from the org's roster instead
// of memorizing the email.
//
// Resolves the URL segment as either a Client cuid (Ace-native) or
// the legacy numeric RF id, mirroring getClientByIdentifier on the
// page side. Tenant-scoped: a forged id from another org returns the
// empty list rather than a leak.

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const raw = params.id;
  if (!raw) return NextResponse.json({ contacts: [] });

  const org = await getCurrentOrg();
  const client = /^-?\d+$/.test(raw)
    ? await prisma.client.findFirst({
        where: { legacyRfId: Number(raw), organizationId: org.id },
        select: { id: true },
      })
    : await prisma.client.findFirst({
        where: { id: raw, organizationId: org.id },
        select: { id: true },
      });
  if (!client) return NextResponse.json({ contacts: [] });

  const peers = await prisma.contact.findMany({
    where: { organizationId: org.id, clientId: client.id },
    select: {
      firstName: true,
      lastName: true,
      name: true,
      emails: true,
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  const contacts: Array<{ name: string; email: string }> = [];
  for (const p of peers) {
    const composed =
      [p.firstName, p.lastName].filter(Boolean).join(" ") || p.name || "";
    const emails = Array.isArray(p.emails) ? p.emails : [];
    for (const e of emails) {
      if (!e) continue;
      contacts.push({ name: composed || e, email: e });
      break;
    }
  }

  return NextResponse.json({ contacts });
}
