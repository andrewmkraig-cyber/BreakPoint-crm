import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { formatLocation } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

// Tenure dropdown → [minMonths, maxMonths|null] inclusive lower, exclusive upper.
const TENURE_RANGES: Record<string, [number, number | null]> = {
  lt1: [0, 12],
  "1to3": [12, 36],
  "3to5": [36, 60],
  gt5: [60, null],
};

type ExperienceEntry = {
  from?: [number | null, number | null] | null;
  // other fields ignored for tenure
};

function composeName(first: string | null, last: string | null): string {
  const parts = [first, last].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : "(unnamed)";
}

function formatSalary(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "—";
  const n = (raw as { number?: unknown }).number;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "—";
  const ccy = (raw as { currency?: unknown }).currency;
  const symbol = ccy === "USD" || !ccy ? "$" : `${String(ccy)} `;
  return `${symbol}${n.toLocaleString()}`;
}

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo} mo${mo === 1 ? "" : "s"} ago`;
  const yr = Math.round(mo / 12);
  return `${yr} yr${yr === 1 ? "" : "s"} ago`;
}

// Months between [year, month] (1-indexed) and now. Returns null when
// the tuple is incomplete so callers can skip the row.
function tenureMonthsFrom(from: ExperienceEntry["from"]): number | null {
  if (!from) return null;
  const [y, m] = from;
  if (typeof y !== "number" || typeof m !== "number") return null;
  const now = new Date();
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
}

// Pick the most recent experience entry by startDate (year, month) desc.
function mostRecentExperience(raw: unknown): ExperienceEntry | null {
  if (!Array.isArray(raw)) return null;
  let best: ExperienceEntry | null = null;
  let bestKey = -Infinity;
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const from = (e as ExperienceEntry).from;
    if (!from) continue;
    const [y, m] = from;
    if (typeof y !== "number" || typeof m !== "number") continue;
    const key = y * 12 + m;
    if (key > bestKey) {
      bestKey = key;
      best = e as ExperienceEntry;
    }
  }
  return best;
}

// Boolean connectives that recruiters type between real terms — the
// search treats them as the implicit AND/OR they're already using
// at the clause level, so the literal words shouldn't have to appear
// in the candidate's data. "tax AND ohio" matches the same set as
// "tax ohio".
const BOOL_STOPWORDS = new Set(["and", "or"]);

function tokenize(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0 && !BOOL_STOPWORDS.has(s.toLowerCase()));
}

function parseNumber(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Earliest occurrence of any search token (case-insensitive) in the
// extracted resume text, with 200 chars of context centered loosely on
// the hit. Leading / trailing ellipses indicate truncation; collapsing
// whitespace keeps tabular PDFs from rendering as huge gaps.
const SNIPPET_LEN = 200;
const SNIPPET_LEAD = 80;
function buildResumeSnippet(text: string, tokens: string[]): string | null {
  if (!text || tokens.length === 0) return null;
  const lower = text.toLowerCase();
  let earliest = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (earliest < 0 || i < earliest)) earliest = i;
  }
  if (earliest < 0) return null;
  const start = Math.max(0, earliest - SNIPPET_LEAD);
  const end = Math.min(text.length, start + SNIPPET_LEN);
  let snip = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (!snip) return null;
  if (start > 0) snip = "…" + snip;
  if (end < text.length) snip = snip + "…";
  return snip;
}

// Per-token candidate ID resolution. Returns every candidate in the org
// whose data carries the token in ANY of three sources:
//   1. Structured columns — name, current title, current employer,
//      location, and skills (case-insensitive substring).
//   2. JSON profile data — experience and education, cast to text so
//      pdl/RF-imported job titles, company names, school names, and
//      free-form descriptions are searchable. Prisma can't ILIKE jsonb
//      directly, hence the raw SQL.
//   3. Parsed resume text — CandidateResume.extractedText (populated
//      by scripts/extract-resume-text.ts and on every new upload).
// Caller AND-composes the per-token sets via `id: { in: [...] }`
// clauses so a multi-word query honors "every token must match in at
// least one source for the same candidate".
//
// Backslash is the default Postgres LIKE escape character, so we
// escape `%`, `_`, and `\` in the user-supplied token before wrapping
// in `%…%` — a recruiter typing "100%" can't accidentally trigger a
// wildcard sweep.
async function resolveTokenCandidateIds(
  orgId: string,
  token: string,
): Promise<string[]> {
  const escaped = token.replace(/([\\%_])/g, "\\$1");
  const pattern = `%${escaped}%`;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Candidate"
    WHERE "organizationId" = ${orgId}
      AND (
        "firstName" ILIKE ${pattern}
        OR "lastName" ILIKE ${pattern}
        OR "currentDesignation" ILIKE ${pattern}
        OR "currentOrganization" ILIKE ${pattern}
        OR location ILIKE ${pattern}
        OR EXISTS (SELECT 1 FROM unnest(skills) s WHERE s ILIKE ${pattern})
        OR (experience IS NOT NULL AND experience::text ILIKE ${pattern})
        OR (education IS NOT NULL AND education::text ILIKE ${pattern})
      )
    UNION
    SELECT cr."candidateId" AS id
    FROM "CandidateResume" cr
    WHERE cr."organizationId" = ${orgId}
      AND cr."candidateId" IS NOT NULL
      AND cr."extractedText" ILIKE ${pattern}
  `);
  return rows.map((r) => r.id);
}

// Strip JSON punctuation to whitespace so a buildResumeSnippet pass
// over an experience array reads as recruitable copy ("title  Vending
// Sales Manager  company  ABC Corp") rather than dense JSON. Whitespace
// is collapsed by the snippet builder downstream.
function jsonToSearchableText(value: unknown): string {
  if (value == null) return "";
  try {
    return JSON.stringify(value).replace(/[{}\[\]",\\]/g, " ");
  } catch {
    return "";
  }
}

function allTokensPresent(text: string, tokens: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const t of tokens) {
    if (lower.indexOf(t.toLowerCase()) < 0) return false;
  }
  return true;
}

// For the visible page of candidates, resolve a single highlighted
// snippet per candidate when every token appears together in either
// source. Priority is resume first (recruiter-shipped copy) and the
// candidate's experience JSON as fallback (RF/Pin import data) — that
// way a structured-field-only match (e.g. token in the candidate's
// name) still tries to surface adjacent context from a richer source.
// One query for resumes covers the whole page; the experience fallback
// reads off the rows already in memory from the main candidate query.
async function snippetsForCandidates(
  orgId: string,
  pageRows: Array<{ id: string; experience: unknown }>,
  tokens: string[],
): Promise<Map<string, string>> {
  if (tokens.length === 0 || pageRows.length === 0) return new Map();
  const candidateIds = pageRows.map((r) => r.id);
  const resumes = await prisma.candidateResume.findMany({
    where: {
      organizationId: orgId,
      candidateId: { in: candidateIds },
      extractedText: { not: null },
      AND: tokens.map((t) => ({
        extractedText: { contains: t, mode: "insensitive" as const },
      })),
    },
    select: {
      candidateId: true,
      extractedText: true,
      uploadedAt: true,
    },
    orderBy: { uploadedAt: "desc" },
  });
  const out = new Map<string, string>();
  for (const r of resumes) {
    if (!r.candidateId || out.has(r.candidateId)) continue;
    const snip = buildResumeSnippet(r.extractedText ?? "", tokens);
    if (snip) out.set(r.candidateId, snip);
  }

  // Experience-JSON fallback for any candidate still missing a snippet.
  for (const c of pageRows) {
    if (out.has(c.id)) continue;
    const text = jsonToSearchableText(c.experience);
    if (!allTokensPresent(text, tokens)) continue;
    const snip = buildResumeSnippet(text, tokens);
    if (snip) out.set(c.id, snip);
  }
  return out;
}

function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Pipe-delimited list. Used for fields whose values can legitimately
// contain commas (employer names like "Microsoft, Inc.").
function parsePipe(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// For employer scope="any": resolve the candidate IDs whose
// currentOrganization or experience JSON matches ANY of the supplied
// values (case-insensitive). Returns an empty array when values is
// empty so the caller can branch on whether to push a clause at all.
// Same LIKE escape rules as resolveTokenCandidateIds — Postgres default
// is backslash, and `%`/`_`/`\` in the user input are escaped so a
// recruiter pasting "AT&T 100%" can't trigger a wildcard sweep.
async function resolveEmployerAnyIds(
  orgId: string,
  values: string[],
): Promise<string[]> {
  if (values.length === 0) return [];
  const patterns = values.map((v) => `%${v.replace(/([\\%_])/g, "\\$1")}%`);
  const orParts = patterns.map(
    (p) =>
      Prisma.sql`("currentOrganization" ILIKE ${p} OR (experience IS NOT NULL AND experience::text ILIKE ${p}))`,
  );
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Candidate"
    WHERE "organizationId" = ${orgId}
      AND (${Prisma.join(orParts, " OR ")})
  `);
  return rows.map((r) => r.id);
}

// Nominatim hits for the search-pill location are reused across requests
// within a server process. Recruiter typing "Akron, OH" 12 times in a
// minute only burns the Nominatim quota once. Module-level Map is fine
// here — Next's serverless runtime recycles the process often enough
// that cache freshness isn't a concern (city centroids don't move).
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();
const NOMINATIM_UA =
  "Ace-BreakPointTalent-Search/1.0 (andrew@breakpointtalent.com)";

type GeoHit = { lat: number; lng: number };
type NominatimHit = { lat: string; lon: string };

async function geocodePill(loc: string): Promise<GeoHit | null> {
  const key = loc.toLowerCase().trim();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(loc)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_UA },
      // 5s upper bound so a slow Nominatim doesn't stall the search
      // request — caller falls back to text contains on null return.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      geocodeCache.set(key, null);
      return null;
    }
    const arr = (await res.json()) as NominatimHit[];
    if (!Array.isArray(arr) || arr.length === 0) {
      geocodeCache.set(key, null);
      return null;
    }
    const lat = Number.parseFloat(arr[0].lat);
    const lng = Number.parseFloat(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      geocodeCache.set(key, null);
      return null;
    }
    const hit = { lat, lng };
    geocodeCache.set(key, hit);
    return hit;
  } catch {
    geocodeCache.set(key, null);
    return null;
  }
}

// Approximate degrees per mile. 1° latitude ≈ 69 miles everywhere; 1°
// longitude shrinks with cos(lat). Good enough for filter pre-pass —
// the bounding box is intentionally a little generous near the poles
// rather than a great-circle calculation.
function milesToBox(center: GeoHit, miles: number): {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
} {
  const degLat = miles / 69;
  const degLng = miles / (69 * Math.cos((center.lat * Math.PI) / 180));
  return {
    latMin: center.lat - degLat,
    latMax: center.lat + degLat,
    lngMin: center.lng - degLng,
    lngMax: center.lng + degLng,
  };
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Not signed in." },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const sp = url.searchParams;
  const q = (sp.get("q") ?? "").trim();
  // Job titles / skills are comma-delimited and split into include
  // (must match at least one) and exclude (must match none) lists. The
  // rail emits each list on its own param so the server doesn't need an
  // in-band sigil to tell them apart.
  const jobTitlesInclude = parseCsv(sp.get("jobTitles"));
  const jobTitlesExclude = parseCsv(sp.get("excludeJobTitles"));
  const skillsInclude = parseCsv(sp.get("skills"));
  const skillsExclude = parseCsv(sp.get("excludeSkills"));
  const minComp = parseNumber(sp.get("minComp"));
  const maxComp = parseNumber(sp.get("maxComp"));
  // Locations are pipe-delimited because each pill ("Akron, OH") already
  // contains a comma. Legacy `location` (singular, string) is still
  // honored so any bookmarked URL or older client keeps working — the
  // singular value is folded into the pills list.
  const locations = (() => {
    const multi = (sp.get("locations") ?? "").trim();
    if (multi) {
      return multi
        .split("|")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    const single = (sp.get("location") ?? "").trim();
    return single ? [single] : [];
  })();
  // Distance pill in miles. UI options are 10/25/50/100; we accept any
  // positive integer but clamp the resolved bounding box at 500 miles
  // so a stray "10000" can't paint the whole continent.
  const distanceMi = (() => {
    const raw = parseNumber(sp.get("distance"));
    if (raw == null || raw <= 0) return 25;
    return Math.min(Math.round(raw), 500);
  })();
  // Job scope: when the Matches tab calls in, it sends the job's cuid so
  // the API can exclude candidates already rejected for that job (they
  // live in the Rejected tab and shouldn't reappear in the matches list).
  const jobId = (sp.get("jobId") ?? "").trim();
  // Employer pills: pipe-delimited include and exclude lists. Legacy
  // `employer=` singleton is folded into the include list so any
  // bookmarked URL or older client keeps working without a redirect.
  const employersInclude = parsePipe(sp.get("employers"));
  const employersExclude = parsePipe(sp.get("excludeEmployers"));
  const legacyEmployer = (sp.get("employer") ?? "").trim();
  if (legacyEmployer && !employersInclude.includes(legacyEmployer)) {
    employersInclude.push(legacyEmployer);
  }
  // "current" (default) → currentOrganization contains substring only.
  // "any" → either currentOrganization or anywhere inside the
  // experience JSON. Anything other than the literal "any" falls
  // through to the safe default so a malformed query never accidentally
  // widens the result set.
  const employerScope =
    (sp.get("employerScope") ?? "current").trim() === "any" ? "any" : "current";
  const tenure = (sp.get("tenure") ?? "any").trim();
  // workAuth is accepted but currently a no-op — Candidate has no
  // workAuthorization column. When/if the schema gains one this filter
  // becomes a single Prisma equals clause; until then accepting the
  // param keeps the UI wired without forcing a schema change in this
  // shell prompt.
  const _workAuth = (sp.get("workAuth") ?? "all").trim();
  void _workAuth;

  const rawPage = sp.get("page");
  const parsedPage = rawPage ? Number(rawPage) : 1;
  const page =
    Number.isFinite(parsedPage) && parsedPage >= 1
      ? Math.floor(parsedPage)
      : 1;

  try {
    const org = await getCurrentOrg();

    const where: Prisma.CandidateWhereInput = { organizationId: org.id };
    const andClauses: Prisma.CandidateWhereInput[] = [];

    if (q) {
      const tokens = tokenize(q);
      if (tokens.length > 0) {
        // Per token, resolve the union of candidate IDs across all
        // three sources (structured columns, experience/education JSON
        // cast to text, parsed resume text). Push one `id: { in: [...] }`
        // clause per token so the final AND across them produces the
        // intersection — a candidate must hit every token, but each
        // token can land in any of the sources independently. Resolved
        // in parallel since the queries are independent per token.
        const idSetsByToken = await Promise.all(
          tokens.map((t) => resolveTokenCandidateIds(org.id, t)),
        );
        for (const ids of idSetsByToken) {
          andClauses.push({ id: { in: ids } });
        }
      }
    }

    // Job-title pills: includes are OR'd (candidate matches if
    // currentDesignation contains ANY of the included titles); excludes
    // are AND-NOT'd as a NOT(OR(...)) so no excluded title may appear.
    // Both clauses compose into the outer AND alongside every other
    // active filter.
    if (jobTitlesInclude.length > 0) {
      andClauses.push({
        OR: jobTitlesInclude.map((t) => ({
          currentDesignation: { contains: t, mode: "insensitive" as const },
        })),
      });
    }
    if (jobTitlesExclude.length > 0) {
      andClauses.push({
        NOT: {
          OR: jobTitlesExclude.map((t) => ({
            currentDesignation: { contains: t, mode: "insensitive" as const },
          })),
        },
      });
    }

    // Skill pills: includes use Prisma's `hasSome` (candidate matches
    // if their skills array overlaps the include set); excludes flip
    // the same operator inside a NOT so a candidate with ANY excluded
    // skill drops out. Skills are case-sensitive at the DB layer — the
    // rail commits the exact pill text.
    if (skillsInclude.length > 0) {
      andClauses.push({ skills: { hasSome: skillsInclude } });
    }
    if (skillsExclude.length > 0) {
      andClauses.push({ NOT: { skills: { hasSome: skillsExclude } } });
    }

    // expectedSalary is JSON `{ number, currency }`; Prisma's JSON path
    // operators let us range-filter directly on the embedded number.
    if (minComp != null) {
      andClauses.push({
        expectedSalary: { path: ["number"], gte: minComp },
      });
    }
    if (maxComp != null) {
      andClauses.push({
        expectedSalary: { path: ["number"], lte: maxComp },
      });
    }

    if (locations.length > 0) {
      // Each pill resolves to its own clause; the pills OR together so
      // a candidate matches if they fall in ANY of the resolved boxes.
      // Geocoding runs in parallel — N pills cost one network RTT, not
      // N — and any pill that fails to geocode degrades to a
      // text-contains match on the literal pill value rather than
      // silently dropping out of the union.
      const pillHits = await Promise.all(
        locations.map(async (loc) => ({
          loc,
          hit: await geocodePill(loc),
        })),
      );
      const orClauses: Prisma.CandidateWhereInput[] = [];
      for (const { loc, hit } of pillHits) {
        if (hit) {
          const box = milesToBox(hit, distanceMi);
          orClauses.push({
            lat: { gte: box.latMin, lte: box.latMax },
            lng: { gte: box.lngMin, lte: box.lngMax },
          });
        } else {
          orClauses.push({
            location: { contains: loc, mode: "insensitive" },
          });
        }
      }
      andClauses.push({ OR: orClauses });
    }
    // Employer pills. `scope === "current"` filters against the
    // currentOrganization column directly via Prisma (no roundtrip);
    // `scope === "any"` widens to anywhere in the experience JSON,
    // which requires raw SQL because Prisma can't ILIKE on a jsonb cast.
    // For both scopes: includes OR together, excludes wrap into a NOT
    // / `id: { notIn: ... }` so a candidate matching ANY excluded
    // employer is dropped.
    if (employerScope === "current") {
      if (employersInclude.length > 0) {
        andClauses.push({
          OR: employersInclude.map((e) => ({
            currentOrganization: { contains: e, mode: "insensitive" as const },
          })),
        });
      }
      if (employersExclude.length > 0) {
        andClauses.push({
          NOT: {
            OR: employersExclude.map((e) => ({
              currentOrganization: { contains: e, mode: "insensitive" as const },
            })),
          },
        });
      }
    } else {
      // scope === "any" — resolve the ID set for each side via a
      // single raw-SQL query, then plug into the where via id-IN /
      // id-notIn so the result composes with every other AND clause.
      if (employersInclude.length > 0) {
        const ids = await resolveEmployerAnyIds(org.id, employersInclude);
        andClauses.push({ id: { in: ids } });
      }
      if (employersExclude.length > 0) {
        const ids = await resolveEmployerAnyIds(org.id, employersExclude);
        andClauses.push({ id: { notIn: ids } });
      }
    }

    // Hide candidates already rejected for this job. Stage is stored
    // lowercase ("rejected") — see /api/placements where the upsert
    // writes that exact value. NOT + some-subquery composes with the
    // rest of the where so it works alongside any other active filter.
    if (jobId) {
      andClauses.push({
        NOT: { placements: { some: { jobId, stage: "rejected" } } },
      });
    }

    if (andClauses.length > 0) where.AND = andClauses;

    const select = {
      id: true,
      firstName: true,
      lastName: true,
      currentDesignation: true,
      currentOrganization: true,
      location: true,
      expectedSalary: true,
      experience: true,
      createdAt: true,
      updatedAt: true,
    } as const;

    const tenureRange = TENURE_RANGES[tenure];

    // Tokens for the resume-snippet pass. Empty when the query has no
    // keyword (snippet enrichment becomes a no-op). Computed once so
    // both code paths share the same token list.
    const snippetTokens = q ? tokenize(q) : [];

    if (!tenureRange) {
      // No tenure filter — paginate at the DB level.
      const [rows, total] = await Promise.all([
        prisma.candidate.findMany({
          where,
          select,
          orderBy: { updatedAt: "desc" },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
        prisma.candidate.count({ where }),
      ]);
      const snippetMap = await snippetsForCandidates(
        org.id,
        rows,
        snippetTokens,
      );
      return NextResponse.json({
        candidates: rows.map((c) => toRow(c, snippetMap.get(c.id))),
        total,
      });
    }

    // Tenure filter requires JS-side filtering against the JSON
    // experience column. Cap the fetch so a wide query can't pull
    // tens of thousands of rows into memory; the cap is generous
    // enough that current org sizes won't truncate.
    const [min, max] = tenureRange;
    const candidates = await prisma.candidate.findMany({
      where,
      select,
      orderBy: { updatedAt: "desc" },
      take: 2000,
    });
    const filtered = candidates.filter((c) => {
      const recent = mostRecentExperience(c.experience);
      const months = tenureMonthsFrom(recent?.from ?? null);
      if (months == null) return false;
      if (months < min) return false;
      if (max != null && months >= max) return false;
      return true;
    });
    const total = filtered.length;
    const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const snippetMap = await snippetsForCandidates(
      org.id,
      slice,
      snippetTokens,
    );
    return NextResponse.json({
      candidates: slice.map((c) => toRow(c, snippetMap.get(c.id))),
      total,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Search failed.",
      },
      { status: 500 },
    );
  }
}

function toRow(c: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  currentDesignation: string | null;
  currentOrganization: string | null;
  location: string | null;
  expectedSalary: unknown;
  createdAt: Date;
  updatedAt: Date;
}, resumeSnippet?: string) {
  return {
    id: c.id,
    name: composeName(c.firstName, c.lastName),
    title: c.currentDesignation ?? "",
    employer: c.currentOrganization ?? "",
    location: formatLocation(c.location) || "",
    salary: formatSalary(c.expectedSalary),
    lastApply: relativeTime(c.createdAt),
    lastAction: relativeTime(c.updatedAt),
    resumeSnippet: resumeSnippet ?? null,
  };
}
