// One-shot backfill: populate the structured Job.locationCity /
// locationState / locationZip columns from the legacy free-form
// Job.locations[] array for jobs that have all three structured columns
// null but still carry a usable "City, ST [Zip]" string.
//
// WHY: the pipeline distance sub-line (src/app/pipeline/page.tsx
// attachDistanceLines) geocodes the job side off the structured columns.
// RF-imported jobs + any create path other than /jobs/new never set them,
// so 14 of 18 BreakPoint jobs had null structured columns and blanked the
// distance. The render path now falls back to locations[0] (Ace fix), but
// this backfill makes the structured columns the source of truth so search
// filtering (which keys off locationCity / locationState / locationZip)
// also benefits.
//
// PARSE ONLY — this script does NOT call the geocoder. It just splits the
// composed string the /jobs/new form writes ("City, ST" or "City, ST Zip")
// back into its columns. The render path still does the geocoding; lat/lng
// is never persisted on Job. Entries that don't parse to a "City, ST"
// shape (e.g. "Northeast Ohio", a bare state like "KY") are SKIPPED and
// left null — they blank cleanly, same as today.
//
// Idempotent + resumable: the WHERE clause only matches rows where all
// three structured columns are still null, so a row drops out of the set
// the moment it's written. Re-running is a no-op for already-filled rows.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/geocode-jobs.ts                 # all orgs, WRITE
//   npx tsx scripts/geocode-jobs.ts --org=<orgCuid> # one org only, WRITE
//   npx tsx scripts/geocode-jobs.ts --dry           # preview count, no write
//
// `--org=<cuid>` narrows the WHERE to a single Organization (Rule 8).
// `--dry` reports how many rows WOULD be updated without writing anything.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseOrgArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--org="));
  if (!arg) return null;
  const v = arg.slice("--org=".length).trim();
  return v.length > 0 ? v : null;
}

function isDryRun(): boolean {
  return process.argv.includes("--dry");
}

type ParsedLoc = { city: string; state: string; zip: string | null };

// Splits a composed "City, ST" / "City, ST Zip" string into its columns.
// Conservative on purpose: requires a comma (so a region/state-only blob
// like "Northeast Ohio" or "KY" returns null and is left untouched) and a
// 2-letter state token. Returns null when it can't confidently parse a
// city + 2-letter state.
function parseLocation(raw: string | null | undefined): ParsedLoc | null {
  const s = (raw ?? "").trim();
  const comma = s.indexOf(",");
  if (comma === -1) return null; // no "City, ST" shape
  const city = s.slice(0, comma).trim();
  const rest = s.slice(comma + 1).trim();
  if (!city) return null;
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const state = tokens[0].toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return null;
  const zipTok = tokens.slice(1).find((t) => /^\d{5}/.test(t));
  const zip = zipTok ? zipTok.slice(0, 5) : null;
  return { city, state, zip };
}

async function main() {
  const orgId = parseOrgArg();
  const dry = isDryRun();

  // Rule 8: tenant-scope by organizationId when --org is supplied. The
  // unscoped path stays available for parity with geocode-candidates.ts;
  // BreakPoint Talent is the only prod org today.
  const where = {
    locationCity: null,
    locationState: null,
    locationZip: null,
    locations: { isEmpty: false },
    ...(orgId ? { organizationId: orgId } : {}),
  };

  const candidates = await prisma.job.findMany({
    where,
    select: { id: true, title: true, locations: true },
  });

  console.log(
    orgId
      ? `Scanning ${candidates.length} jobs in org ${orgId} with null structured columns + non-empty locations[]...`
      : `Scanning ${candidates.length} jobs (all orgs) with null structured columns + non-empty locations[]...`,
  );
  if (dry) console.log("[DRY RUN] No rows will be written.\n");

  let parseable = 0;
  let skipped = 0;
  let written = 0;

  for (const j of candidates) {
    const first = j.locations.find((s) => (s ?? "").trim().length > 0) ?? "";
    const parsed = parseLocation(first);
    if (!parsed) {
      skipped++;
      console.log(`  [skip] "${j.title}" — unparseable location: "${first}"`);
      continue;
    }
    parseable++;
    console.log(
      `  [ok]   "${j.title}" — "${first}" -> city="${parsed.city}" state="${parsed.state}" zip="${parsed.zip ?? ""}"`,
    );
    if (!dry) {
      await prisma.job.update({
        where: { id: j.id },
        data: {
          locationCity: parsed.city,
          locationState: parsed.state,
          locationZip: parsed.zip,
        },
      });
      written++;
    }
  }

  console.log(
    `\nDone. parseable=${parseable} skipped=${skipped} written=${written}${dry ? " (dry run — nothing written)" : ""}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
