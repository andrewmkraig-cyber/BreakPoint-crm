import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bulk name-resolver used by the candidates-page resume upload flow. The
// recruiter drops a folder of PDFs whose filenames carry the candidate name
// before the last underscore — we resolve each parsed name to a Candidate.id
// in one query so the client can fan out chunked uploads. Tenant-scoped.
//
// Match rule: split the parsed name on the first whitespace into first +
// remainder. The remainder becomes the last-name match (so "Scott
// Jumawan-Spahr" → first="Scott", last="Jumawan-Spahr"). Comparisons are
// case-insensitive via Prisma's `mode: "insensitive"`. If multiple
// candidates share the same first+last we pick the most-recently-updated
// row — recruiter can re-attach manually if it lands on the wrong one.
type MatchInput = { name: string };
type MatchResult = { name: string; candidateId: string | null };

function splitName(raw: string): { first: string; last: string } | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  const idx = trimmed.indexOf(" ");
  if (idx < 0) return null;
  return {
    first: trimmed.slice(0, idx),
    last: trimmed.slice(idx + 1),
  };
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const inputs = Array.isArray((body as { names?: unknown }).names)
    ? ((body as { names: unknown[] }).names.filter(
        (v): v is MatchInput =>
          v != null &&
          typeof v === "object" &&
          typeof (v as { name?: unknown }).name === "string",
      ))
    : [];
  if (inputs.length === 0) {
    return NextResponse.json({ ok: true, matches: [] as MatchResult[] });
  }

  const org = await getCurrentOrg();

  // Resolve each name independently so a parser miss on one row doesn't
  // poison the rest. We could batch with OR clauses but the per-name
  // findFirst keeps the result list aligned 1:1 with the input order and
  // the cardinality is bounded by the 50-file UI cap.
  const matches: MatchResult[] = await Promise.all(
    inputs.map(async ({ name }) => {
      const parts = splitName(name);
      if (!parts) return { name, candidateId: null };
      const row = await prisma.candidate.findFirst({
        where: {
          organizationId: org.id,
          firstName: { equals: parts.first, mode: "insensitive" },
          lastName: { equals: parts.last, mode: "insensitive" },
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      return { name, candidateId: row?.id ?? null };
    }),
  );

  return NextResponse.json({ ok: true, matches });
}
