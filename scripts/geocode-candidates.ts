// One-shot backfill: geocode every Candidate row whose lat is null
// and whose location is non-null, then write lat/lng back to the row.
//
// Uses Nominatim (OpenStreetMap) — free, no API key, 1 req/sec rate
// limit per their usage policy. We respect that with a 1100 ms sleep
// between requests (slight buffer so a slow round trip doesn't push
// the next call into the same second).
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/geocode-candidates.ts                 # all orgs
//   npx tsx scripts/geocode-candidates.ts --org=<orgCuid> # one org only
//
// `--org=<cuid>` narrows the WHERE clause to a single Organization.
// Backward compatible: omitting it preserves the prior cross-org
// behavior verbatim. Today BreakPoint Talent is the only prod org so
// the two are functionally identical, but the flag exists so future
// re-runs can stay scoped without editing the script.
//
// Resumable: each run pulls only rows that still have null lat, so
// killing this mid-flight and re-running picks up where it stopped.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// Nominatim asks every consumer to identify themselves so they can
// reach out if a script misbehaves. Bake the contact email into the
// UA so we don't get rate-limit-banned anonymously.
const USER_AGENT =
  "Ace-BreakPointTalent-Geocoder/1.0 (andrew@breakpointtalent.com)";
const REQUEST_DELAY_MS = 1100;
const BATCH_SIZE = 50;
const PROGRESS_EVERY = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type NominatimHit = {
  lat: string;
  lon: string;
};

// Returns { lat, lng } when Nominatim recognized the string, null
// otherwise (e.g. "Remote", "—", or a free-form blob the geocoder
// can't parse). Network errors also return null so the loop can skip
// and continue rather than blow up the whole run.
async function geocode(
  location: string,
): Promise<{ lat: number; lng: number } | null> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(location)}&format=json&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      console.warn(`  [skip] HTTP ${res.status} for "${location}"`);
      return null;
    }
    const arr = (await res.json()) as NominatimHit[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const lat = Number.parseFloat(arr[0].lat);
    const lng = Number.parseFloat(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  [skip] fetch error for "${location}": ${msg}`);
    return null;
  }
}

function parseOrgArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--org="));
  if (!arg) return null;
  const v = arg.slice("--org=".length).trim();
  return v.length > 0 ? v : null;
}

async function main() {
  const orgId = parseOrgArg();
  // Base WHERE clause shared by count + findMany — adding the
  // organizationId filter only when --org was passed keeps the
  // unscoped path byte-identical to the prior behavior.
  const baseWhere = {
    lat: null,
    location: { not: null },
    ...(orgId ? { organizationId: orgId } : {}),
  };
  const totalPending = await prisma.candidate.count({ where: baseWhere });
  console.log(
    orgId
      ? `Geocoding ${totalPending} candidates in org ${orgId}...`
      : `Geocoding ${totalPending} candidates...`,
  );
  console.log(
    `Estimated runtime: ~${Math.ceil((totalPending * REQUEST_DELAY_MS) / 1000 / 60)} min at 1 req/sec\n`,
  );

  let processed = 0;
  let geocoded = 0;
  let skipped = 0;

  // Loop until no rows match. Each pass reads BATCH_SIZE rows, geocodes
  // them in serial (Nominatim rate limit), then re-queries — successful
  // rows drop out via the `lat: null` filter, so the next batch is
  // automatically the next chunk. Rows that geocode to null stay in
  // the queryable set; mark them as attempted by writing lat=0 OR just
  // accept they'll be re-attempted on the next full run. We don't
  // write 0 — keeping null lets the script be re-run after a hand-fix
  // of bad location strings.
  //
  // To avoid an infinite loop when every row in a batch fails to
  // geocode, track an in-memory skip set of candidate IDs we've
  // already attempted this run.
  const attempted = new Set<string>();

  while (true) {
    const batch = await prisma.candidate.findMany({
      where: {
        ...baseWhere,
        id: { notIn: Array.from(attempted) },
      },
      select: { id: true, location: true },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    for (const c of batch) {
      attempted.add(c.id);
      const loc = c.location;
      if (!loc) {
        skipped++;
        continue;
      }
      const hit = await geocode(loc);
      processed++;
      if (hit) {
        await prisma.candidate.update({
          where: { id: c.id },
          data: { lat: hit.lat, lng: hit.lng },
        });
        geocoded++;
      } else {
        skipped++;
      }
      if (processed % PROGRESS_EVERY === 0) {
        console.log(
          `  ${processed}/${totalPending} processed — ${geocoded} geocoded, ${skipped} skipped`,
        );
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(
    `\nDone. processed=${processed} geocoded=${geocoded} skipped=${skipped}`,
  );
  await prisma.$disconnect();
}

void main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
