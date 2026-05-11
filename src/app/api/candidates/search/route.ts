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

function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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
  const jobTitles = parseCsv(sp.get("jobTitles"));
  const skills = parseCsv(sp.get("skills"));
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
  const employer = (sp.get("employer") ?? "").trim();
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
      // Each token must match in at least one structured field. Scoping
      // to firstName/lastName/currentDesignation/currentOrganization/
      // location (contains, insensitive) plus skills (hasSome, exact)
      // keeps recruiter-typed keywords from hitting unrelated metadata
      // in the raw JSON payload (RF application notes, embedded job /
      // client names, etc.) — "vending" should only match candidates
      // whose visible profile carries the word, not someone who once
      // applied to a vending-machine company posting.
      for (const t of tokens) {
        andClauses.push({
          OR: [
            { firstName: { contains: t, mode: "insensitive" as const } },
            { lastName: { contains: t, mode: "insensitive" as const } },
            {
              currentDesignation: {
                contains: t,
                mode: "insensitive" as const,
              },
            },
            {
              currentOrganization: {
                contains: t,
                mode: "insensitive" as const,
              },
            },
            { location: { contains: t, mode: "insensitive" as const } },
            { skills: { hasSome: [t] } },
          ],
        });
      }
    }

    // Job-title pills: candidate matches if currentDesignation contains
    // ANY of the supplied titles (case-insensitive). The pills compose
    // disjunctively against the title column and AND with all other
    // active filters.
    if (jobTitles.length > 0) {
      andClauses.push({
        OR: jobTitles.map((t) => ({
          currentDesignation: { contains: t, mode: "insensitive" as const },
        })),
      });
    }

    // Skill pills: Candidate.skills is a String[] column, so OR semantics
    // map cleanly to Prisma's `hasSome` — candidate matches if their
    // skills array contains any of the supplied values (exact match;
    // case-sensitive at the DB layer).
    if (skills.length > 0) {
      andClauses.push({ skills: { hasSome: skills } });
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
    if (employer) {
      andClauses.push({
        currentOrganization: { contains: employer, mode: "insensitive" },
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
      return NextResponse.json({
        candidates: rows.map(toRow),
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
    return NextResponse.json({
      candidates: slice.map(toRow),
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
}) {
  return {
    id: c.id,
    name: composeName(c.firstName, c.lastName),
    title: c.currentDesignation ?? "",
    employer: c.currentOrganization ?? "",
    location: formatLocation(c.location) || "",
    salary: formatSalary(c.expectedSalary),
    lastApply: relativeTime(c.createdAt),
    lastAction: relativeTime(c.updatedAt),
  };
}
