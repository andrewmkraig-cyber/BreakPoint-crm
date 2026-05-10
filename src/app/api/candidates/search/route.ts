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

function tokenize(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean);
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
  const location = (sp.get("location") ?? "").trim();
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
      for (const t of tokenize(q)) {
        andClauses.push({
          OR: [
            { firstName: { contains: t, mode: "insensitive" } },
            { lastName: { contains: t, mode: "insensitive" } },
            { currentDesignation: { contains: t, mode: "insensitive" } },
            { currentOrganization: { contains: t, mode: "insensitive" } },
            { location: { contains: t, mode: "insensitive" } },
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

    if (location) {
      andClauses.push({
        location: { contains: location, mode: "insensitive" },
      });
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
