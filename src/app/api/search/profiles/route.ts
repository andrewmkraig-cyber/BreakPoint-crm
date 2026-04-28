import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

// Profile picker source for the global FAB's Notes popup. Returns the
// top candidate + client matches against a free-text query so the
// recruiter can type "sara" or "acme" and one-click their way to the
// right profile to attach a note to. Tenant-scoped — every row is
// gated on getCurrentOrg().
//
// Output rows include the navigation URL (legacyRfId-aware for the
// candidate case so deep-linking matches the existing /candidates/<rfId>
// pages where they exist) so the FAB never has to re-derive routes.

type CandidateHit = {
  kind: "candidate";
  id: string;
  href: string;
  label: string;
  sublabel: string | null;
};
type ClientHit = {
  kind: "client";
  id: string;
  href: string;
  label: string;
  sublabel: string | null;
};

const PER_KIND_LIMIT = 8;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json({ candidates: [], clients: [] });

  const org = await getCurrentOrg();

  // Three-prong candidate match: firstName / lastName / email. Results
  // surfaced in that priority order via the LHS map below — Prisma's
  // findMany with OR doesn't preserve a stable per-clause order across
  // matches, so we tag rows by which clause hit and re-sort.
  const [candRows, clientRows] = await Promise.all([
    prisma.candidate.findMany({
      where: {
        organizationId: org.id,
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        rfId: true,
        firstName: true,
        lastName: true,
        currentDesignation: true,
        currentOrganization: true,
        email: true,
      },
      take: PER_KIND_LIMIT,
    }),
    prisma.client.findMany({
      where: {
        organizationId: org.id,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { domain: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        legacyRfId: true,
        name: true,
        domain: true,
      },
      take: PER_KIND_LIMIT,
    }),
  ]);

  const candidates: CandidateHit[] = candRows.map((c) => {
    const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ") || "(unnamed)";
    const slug = c.rfId != null ? String(c.rfId) : c.id;
    const sublabel =
      [c.currentDesignation, c.currentOrganization].filter(Boolean).join(" · ") ||
      c.email ||
      null;
    return {
      kind: "candidate",
      id: c.id,
      href: `/candidates/${slug}`,
      label: fullName,
      sublabel,
    };
  });

  const clients: ClientHit[] = clientRows.map((c) => {
    const slug = c.legacyRfId != null ? String(c.legacyRfId) : c.id;
    return {
      kind: "client",
      id: c.id,
      href: `/clients/${slug}`,
      label: c.name,
      sublabel: c.domain,
    };
  });

  return NextResponse.json({ candidates, clients });
}
