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
//
// createIfMissing flag: when true, any parseable name that doesn't match an
// existing candidate is lazily inserted as a new Candidate (firstName,
// lastName, organizationId, createdById only — no email/phone/location)
// and returned with `created: true`. This is the bulk-PDF upload path's
// way of saying "if I have a PDF for someone we don't have yet, just make
// the candidate now and attach the resume in the next step." Names whose
// `splitName` fails (no whitespace, e.g. "Resume.pdf") still come back
// with `candidateId: null` so the client can flag them.
type MatchInput = { name: string };
type MatchResult = {
  name: string;
  candidateId: string | null;
  created?: boolean;
};

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
  if (!session?.user?.email) {
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
  const createIfMissing = (body as { createIfMissing?: unknown }).createIfMissing === true;

  if (inputs.length === 0) {
    return NextResponse.json({ ok: true, matches: [] as MatchResult[] });
  }

  const org = await getCurrentOrg();

  // Resolve the signed-in user once; createIfMissing needs createdById and
  // we don't want to pay the lookup per-row inside the Promise.all below.
  let createdById: string | null = null;
  if (createIfMissing) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found." }, { status: 401 });
    }
    createdById = user.id;
  }

  // Parse every name once, then resolve all matches in a single findMany over
  // the OR of each (first, last) pair, replacing the per-name findFirst that
  // fired once per input (N+1). The in-memory map is keyed by lowercased
  // "first|last" and built from updatedAt-desc rows so the first hit per key
  // is the most recent match — reproducing the original orderBy semantics.
  const dedupKey = (first: string, last: string) =>
    `${first.toLowerCase()}|${last.toLowerCase()}`;
  const parsedInputs = inputs.map(({ name }) => ({ name, parts: splitName(name) }));
  const uniquePairs = Array.from(
    new Map(
      parsedInputs
        .filter((p): p is { name: string; parts: { first: string; last: string } } => p.parts !== null)
        .map((p) => [dedupKey(p.parts.first, p.parts.last), p.parts]),
    ).values(),
  );
  const matchRows = uniquePairs.length
    ? await prisma.candidate.findMany({
        where: {
          organizationId: org.id,
          OR: uniquePairs.map((p) => ({
            firstName: { equals: p.first, mode: "insensitive" as const },
            lastName: { equals: p.last, mode: "insensitive" as const },
          })),
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const matchByKey = new Map<string, string>();
  for (const row of matchRows) {
    if (!row.firstName || !row.lastName) continue;
    const key = dedupKey(row.firstName, row.lastName);
    if (!matchByKey.has(key)) matchByKey.set(key, row.id); // first row = most recent
  }

  // createIfMissing stays per-name, but only fires for genuinely-unmatched
  // names (the rare path) rather than once per input, so it isn't an N+1.
  const matches: MatchResult[] = await Promise.all(
    parsedInputs.map(async ({ name, parts }) => {
      if (!parts) return { name, candidateId: null };
      const existingId = matchByKey.get(dedupKey(parts.first, parts.last));
      if (existingId) return { name, candidateId: existingId, created: false };
      if (!createIfMissing || !createdById) return { name, candidateId: null };

      const created = await prisma.candidate.create({
        data: {
          firstName: parts.first,
          lastName: parts.last,
          organizationId: org.id,
          createdById,
        },
        select: { id: true },
      });
      return { name, candidateId: created.id, created: true };
    }),
  );

  return NextResponse.json({ ok: true, matches });
}
