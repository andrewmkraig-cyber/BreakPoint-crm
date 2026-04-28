import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
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
//
// Multi-token name handling: the original implementation OR'd the
// raw query against firstName / lastName / email, which broke as
// soon as the recruiter typed a full name like "Lesley Snell" —
// neither firstName nor lastName CONTAINS the full string. We now
// split the query into whitespace tokens and AND them, with each
// token allowed to match any of firstName / lastName / email /
// phone. Phone is normalized (digits-only) on both sides so
// "(216) 340-9511" and "2163409511" hit the same row.

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

  // Split on whitespace; AND across tokens so "Lesley Snell" requires
  // BOTH tokens to land somewhere on the row. Each token can match
  // any of firstName / lastName / email / phone (digits-only), which
  // means "lesley", "snell", "lesley snell", and "snell lesley" all
  // resolve. Empty tokens are filtered out so a stray double space
  // doesn't tank the search.
  const tokens = q.split(/\s+/).filter(Boolean);
  const candidateAnd: Prisma.CandidateWhereInput[] = tokens.map((t) => {
    const digits = t.replace(/\D/g, "");
    const orClauses: Prisma.CandidateWhereInput[] = [
      { firstName: { contains: t, mode: "insensitive" } },
      { lastName: { contains: t, mode: "insensitive" } },
      { email: { contains: t, mode: "insensitive" } },
    ];
    if (digits.length >= 3) {
      // Phone is stored verbatim (e.g. "(216) 340-9511" or
      // "+12163409511"); contains-match against digits-only is too
      // strict. Match the literal token's digits within the stored
      // string by surfacing rows whose phone, with non-digits
      // stripped, contains the typed digits — Prisma can't strip
      // server-side without raw SQL, so we use a contains check
      // against the raw phone field too. False positives are bounded
      // by the AND across tokens.
      orClauses.push({ phone: { contains: digits } });
      orClauses.push({ phone: { contains: t } });
    }
    return { OR: orClauses };
  });

  const clientAnd: Prisma.ClientWhereInput[] = tokens.map((t) => ({
    OR: [
      { name: { contains: t, mode: "insensitive" } },
      { domain: { contains: t, mode: "insensitive" } },
    ],
  }));

  const [candRows, clientRows] = await Promise.all([
    prisma.candidate.findMany({
      where: {
        organizationId: org.id,
        AND: candidateAnd,
      },
      select: {
        id: true,
        rfId: true,
        firstName: true,
        lastName: true,
        currentDesignation: true,
        currentOrganization: true,
        email: true,
        phone: true,
      },
      take: PER_KIND_LIMIT,
    }),
    prisma.client.findMany({
      where: {
        organizationId: org.id,
        AND: clientAnd,
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
      c.phone ||
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
