// Diagnostic only — pulls Ethan Larocca + Andrew Kraig and prints every
// case-insensitive occurrence of "tax" in their raw payload (cast to
// text, matching what the search route does with raw::text) plus the
// structured fields that the search also scans. 50 chars of context on
// either side so we can see whether the match is the actual word "tax"
// or a substring inside another token.
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

type Hit = {
  field: string;
  snippet: string;
  matchedText: string;
  start: number;
};

function findHits(field: string, value: string | null | undefined): Hit[] {
  if (!value) return [];
  const hits: Hit[] = [];
  const re = /tax/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const start = Math.max(0, m.index - 50);
    const end = Math.min(value.length, m.index + m[0].length + 50);
    const snippet = value.slice(start, end);
    hits.push({
      field,
      snippet,
      matchedText: m[0],
      start: m.index,
    });
  }
  return hits;
}

async function loadCandidate(firstName: string, lastName: string) {
  // Pull structured fields + raw::text in one shot so we mirror what
  // the search route sees server-side.
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      currentDesignation: string | null;
      currentOrganization: string | null;
      location: string | null;
      raw_text: string | null;
    }>
  >(Prisma.sql`
    SELECT
      id,
      "firstName",
      "lastName",
      "currentDesignation",
      "currentOrganization",
      location,
      raw::text AS raw_text
    FROM "Candidate"
    WHERE LOWER("firstName") = LOWER(${firstName})
      AND LOWER("lastName") = LOWER(${lastName})
    LIMIT 5
  `);
  return rows;
}

function reportCandidate(label: string, rows: Awaited<ReturnType<typeof loadCandidate>>) {
  console.log("\n==============================================================");
  console.log(`CANDIDATE LOOKUP: ${label}`);
  console.log("==============================================================");
  if (rows.length === 0) {
    console.log("  (no matching candidate row found)");
    return;
  }
  for (const r of rows) {
    const name = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
    console.log(`\n— ${name} (${r.id})`);
    const allHits: Hit[] = [
      ...findHits("firstName", r.firstName),
      ...findHits("lastName", r.lastName),
      ...findHits("currentDesignation", r.currentDesignation),
      ...findHits("currentOrganization", r.currentOrganization),
      ...findHits("location", r.location),
      ...findHits("raw::text", r.raw_text),
    ];
    if (allHits.length === 0) {
      console.log("    no 'tax' substring matches anywhere — would NOT match production query");
      continue;
    }
    console.log(`    ${allHits.length} substring hit(s) for 'tax':`);
    for (const h of allHits) {
      // Mark whether this hit is bounded by non-word chars on both
      // sides (i.e. would survive the new \m...\M word-boundary
      // regex). Tells us at a glance which hits the deployed fix
      // should reject.
      const value = h.field === "raw::text" ? r.raw_text! : (
        h.field === "firstName" ? r.firstName! :
        h.field === "lastName" ? r.lastName! :
        h.field === "currentDesignation" ? r.currentDesignation! :
        h.field === "currentOrganization" ? r.currentOrganization! :
        r.location!
      );
      const before = h.start > 0 ? value[h.start - 1] : "";
      const after = value[h.start + h.matchedText.length] ?? "";
      const wordChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);
      const isWholeWord = !wordChar(before) && !wordChar(after);
      const marker = isWholeWord ? "WHOLE-WORD" : "substring  ";
      console.log(`      [${marker}] ${h.field}  …${h.snippet.replace(/\s+/g, " ")}…`);
    }
  }
}

async function main() {
  const ethan = await loadCandidate("Ethan", "Larocca");
  reportCandidate("Ethan Larocca", ethan);

  const andrew = await loadCandidate("Andrew", "Kraig");
  reportCandidate("Andrew Kraig", andrew);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
