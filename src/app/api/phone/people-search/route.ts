import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// GET /api/phone/people-search?q=… — typeahead source for the New Text
// composer and the FAB phone picker. Searches Candidate + Contact by
// name / phone / email, tenant-scoped via getCurrentOrg. Each result is
// flat-mapped to one row per phone number so a contact with two numbers
// surfaces twice with distinct labels.
//
// Contact.phoneNumbers is Json — `[{ number: "+1..." }]` or bare strings
// (legacy seed data). The SQL CAST-to-text + ILIKE gives a coarse but
// effective phone match; we then filter in-memory to pick the specific
// number that matched the query.

export const dynamic = "force-dynamic";

const MIN_QUERY_LEN = 1;
const PER_SOURCE_LIMIT = 20;
const MAX_RESULTS = 12;

export type PhoneSearchHit = {
  // Stable key for the React list. Combines source + record id + number
  // so multi-number contacts dedupe cleanly per phone.
  key: string;
  name: string;
  phoneNumber: string;
  // "candidate" rows carry the Candidate cuid so the New Text composer
  // can attach the SMS to that candidate at send time. "contact" rows
  // have no candidate to attach to — Quo still delivers the outbound
  // text and the row saves with candidateId=null.
  type: "candidate" | "contact";
  candidateId: string | null;
  // Surfaced as a small tag in the dropdown so the recruiter can tell
  // a candidate row from a client contact at a glance.
  tag: string;
};

type ContactRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  phoneNumbers: unknown;
  emails: string[] | null;
  clientName: string | null;
};

function fullName(firstName: string | null, lastName: string | null, fallback: string | null): string {
  const stitched = [firstName, lastName].filter((s): s is string => Boolean(s)).join(" ").trim();
  return stitched || (fallback ?? "").trim() || "";
}

// Pull every {number} (and bare-string) entry out of a Contact.phoneNumbers
// json column. Bare numbers + the {number, type, label, ...} object shape
// both surface; everything else is dropped.
function extractContactNumbers(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  const out: string[] = [];
  for (const entry of json) {
    if (typeof entry === "string" && entry.trim()) {
      out.push(entry.trim());
      continue;
    }
    if (entry && typeof entry === "object") {
      const num = (entry as { number?: unknown }).number;
      if (typeof num === "string" && num.trim()) out.push(num.trim());
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const org = await getCurrentOrg();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY_LEN) {
    return NextResponse.json({ ok: true, people: [] });
  }
  const lowerQ = q.toLowerCase();
  const queryDigits = q.replace(/\D/g, "");
  const escaped = q.replace(/[\\%_]/g, (m) => "\\" + m);
  const pattern = `%${escaped}%`;
  const digitsPattern = queryDigits ? `%${queryDigits}%` : null;

  const [candidates, contacts] = await Promise.all([
    prisma.candidate.findMany({
      where: {
        organizationId: org.id,
        // Candidates without a phone are useless to the New Text picker.
        phone: { not: null },
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          // Phone match: Prisma's contains on a String column is case-
          // sensitive in SQL but phone numbers are digits-only, so
          // a digit substring of the typed query (formatting stripped)
          // catches "(216) 340-9511" → "2163409511" → "1640".
          ...(queryDigits ? [{ phone: { contains: queryDigits } }] : []),
        ],
      },
      select: { id: true, firstName: true, lastName: true, phone: true },
      take: PER_SOURCE_LIMIT,
    }),
    // Contact.phoneNumbers is Json; Prisma can't ILIKE into nested JSON
    // without going raw. We do a coarse cast-to-text scan and refine in
    // app code below.
    prisma.$queryRaw<ContactRow[]>(Prisma.sql`
      SELECT
        c.id,
        c."firstName",
        c."lastName",
        c.name,
        c."phoneNumbers",
        c.emails,
        cl.name AS "clientName"
      FROM "Contact" c
      LEFT JOIN "Client" cl ON cl.id = c."clientId"
      WHERE c."organizationId" = ${org.id}
        AND (
          c."firstName" ILIKE ${pattern}
          OR c."lastName" ILIKE ${pattern}
          OR c.name ILIKE ${pattern}
          OR EXISTS (SELECT 1 FROM unnest(c.emails) e WHERE e ILIKE ${pattern})
          ${digitsPattern ? Prisma.sql`OR c."phoneNumbers"::text ILIKE ${digitsPattern}` : Prisma.empty}
        )
      LIMIT ${PER_SOURCE_LIMIT}
    `),
  ]);

  const hits: PhoneSearchHit[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    if (!c.phone) continue;
    const name = fullName(c.firstName, c.lastName, null) || c.phone;
    const dedupeKey = `cand:${c.id}:${c.phone.replace(/\D/g, "").slice(-10) || c.phone}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    hits.push({
      key: dedupeKey,
      name,
      phoneNumber: c.phone,
      type: "candidate",
      candidateId: c.id,
      tag: "Candidate",
    });
  }

  for (const row of contacts) {
    const numbers = extractContactNumbers(row.phoneNumbers);
    if (numbers.length === 0) continue;
    const name = fullName(row.firstName, row.lastName, row.name);
    const tag = row.clientName ? row.clientName : "Contact";
    // When the query was a digit substring, surface only numbers that
    // match so a contact with 3 phones doesn't dump all 3 into the
    // dropdown for an unrelated digit search. Name/email matches
    // surface every number on the row.
    const numbersToSurface =
      queryDigits.length >= 3
        ? numbers.filter((n) => n.replace(/\D/g, "").includes(queryDigits))
        : numbers;
    const fallbackList = numbersToSurface.length > 0 ? numbersToSurface : numbers;
    for (const num of fallbackList) {
      const lastTen = num.replace(/\D/g, "").slice(-10) || num;
      const dedupeKey = `ct:${row.id}:${lastTen}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      hits.push({
        key: dedupeKey,
        name: name || num,
        phoneNumber: num,
        type: "contact",
        candidateId: null,
        tag,
      });
    }
  }

  // Rank: candidate name starts-with > contact name starts-with > everything else,
  // then alphabetical by name for stability.
  hits.sort((a, b) => {
    const aRank = rank(a, lowerQ);
    const bRank = rank(b, lowerQ);
    if (aRank !== bRank) return bRank - aRank;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ ok: true, people: hits.slice(0, MAX_RESULTS) });
}

function rank(hit: PhoneSearchHit, lowerQ: string): number {
  const nameLower = hit.name.toLowerCase();
  if (nameLower.startsWith(lowerQ)) return hit.type === "candidate" ? 4 : 3;
  if (nameLower.includes(lowerQ)) return hit.type === "candidate" ? 2 : 1;
  return 0;
}

