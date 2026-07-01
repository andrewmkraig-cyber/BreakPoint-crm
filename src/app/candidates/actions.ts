"use server";

import { Prisma } from "@prisma/client";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getCandidatesForOrg, type CandidateListRow } from "@/lib/candidates";

// Phase 5.1: server actions that back the two candidate-search
// surfaces. Both route through getCandidatesForOrg so the tenant-scope
// guarantees are identical to the initial server-render path.

export type SearchCandidatesResult =
  | { ok: true; candidates: CandidateListRow[] }
  | { ok: false; error: string };

// Used by the /candidates page's debounced in-place search input. Same
// result shape as the initial SSR load; client replaces its row list
// with whatever comes back.
export async function searchCandidates(query: string): Promise<SearchCandidatesResult> {
  try {
    const candidates = await getCandidatesForOrg({ query });
    return { ok: true, candidates };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Search failed." };
  }
}

export type QuickSearchRow = {
  id: string;
  name: string;
  title: string;
  employer: string;
};

export type QuickSearchResult =
  | { ok: true; rows: QuickSearchRow[] }
  | { ok: false; error: string };

// Used by the top-bar global quick-search dropdown. Same underlying
// query but capped to 8 rows and projected to only the fields the
// dropdown row renders. Separate server action so future tuning
// (dedicated ranking, different limit, different fields) doesn't
// affect the full-page list.
const QUICK_LIMIT = 8;

export async function quickSearchCandidates(query: string): Promise<QuickSearchResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { ok: true, rows: [] };
  try {
    const candidates = await getCandidatesForOrg({ query: trimmed });
    const rows: QuickSearchRow[] = candidates.slice(0, QUICK_LIMIT).map((c) => ({
      id: c.id,
      name: c.name,
      title: c.title,
      employer: c.employer,
    }));
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Search failed." };
  }
}

// Total candidate headcount for the current org. Powers the small
// "N candidates in your database" tally on the /candidates header so
// the recruiter can see roster size at a glance. Org-scoped through the
// same organizationId guard every other candidate query uses, so it
// only ever counts this tenant's records. Re-called by the client after
// a bulk import so the number ticks up as candidates are added.
export async function getCandidateTotal(): Promise<number> {
  try {
    const org = await getCurrentOrg();
    return await prisma.candidate.count({
      where: { organizationId: org.id },
    });
  } catch {
    // Fail soft — the tally is decorative; a bad count shouldn't blank
    // the whole page. Caller renders nothing when this returns null-ish.
    return 0;
  }
}

export type QuickClientRow = {
  // Slug used by /clients/[id] — legacyRfId-as-string for RF-imported
  // clients (keeps back-compat URLs) or the cuid for Ace-native.
  slug: string;
  name: string;
  city: string;
};

export type QuickContactRow = {
  id: string;
  name: string;
  // Company the contact belongs to — empty string if the contact has no
  // linked Client (rare but possible for imports that lost their FK).
  companyName: string;
  // Slug used by /clients/[id] — same back-compat rules as QuickClientRow.
  clientSlug: string;
};

export type QuickGlobalSearchResult =
  | {
      ok: true;
      candidates: QuickSearchRow[];
      clients: QuickClientRow[];
      contacts: QuickContactRow[];
    }
  | { ok: false; error: string };

type ClientLocationJson = {
  city?: string | null;
  state?: string | null;
  street_address_1?: string | null;
  street_address_2?: string | null;
  postal_code?: string | null;
  country?: string | null;
} | null;

type ContactRaw = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  clientId: string | null;
  clientName: string | null;
  clientLegacyRfId: number | null;
};

// Global header quick-search — returns candidates + clients + contacts
// in one round-trip. Splits QUICK_LIMIT (8) across all three groups
// via round-robin: take one from each pool in turn until the budget
// is spent or every pool is drained. This keeps the dropdown balanced
// when the query skews toward one entity type and absorbs slack when
// one pool is short.
export async function quickSearchGlobal(query: string): Promise<QuickGlobalSearchResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { ok: true, candidates: [], clients: [], contacts: [] };
  try {
    const org = await getCurrentOrg();
    // Candidates via the shared helper (same ILIKE pattern as the full
    // candidates page + Phase 5 tenant-scope extension on top).
    const candidateRowsRaw = await getCandidatesForOrg({ query: trimmed });
    // Phase 5A.2-fix: tokenize on whitespace and AND each token. Same
    // multi-word-name fix as the candidate search — "andrew kraig"
    // splits into ["andrew", "kraig"] and each token must match the
    // searchable haystack so a Contact whose firstName is "Andrew" and
    // lastName is "Kraig" surfaces under either single-word or full-
    // name queries.
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const clientRowsRaw = await prisma.client.findMany({
      where: {
        organizationId: org.id,
        AND: tokens.map((t) => ({
          name: { contains: t, mode: "insensitive" },
        })),
      },
      select: { id: true, legacyRfId: true, name: true, location: true },
      orderBy: { name: "asc" },
      take: QUICK_LIMIT,
    });
    // Contacts: ILIKE across firstName / lastName / legacy `name` /
    // emails[]. Prisma has no ILIKE operator for array elements, so
    // this path goes through $queryRaw. Tokens are AND-joined against a
    // concatenated haystack so multi-word queries (e.g. "andrew kraig")
    // match contacts whose first/last names span tokens. Org scope is
    // asserted explicitly in the WHERE since $queryRaw bypasses the
    // tenant-scope extension.
    let contactRowsRaw: ContactRaw[] = [];
    if (tokens.length > 0) {
      // Build "AND haystack ILIKE %t%" clauses one per token. We use
      // Prisma.sql template tagging so each pattern is parameterized
      // safely; Prisma.join with " AND " concatenates the per-token
      // conditions into the final WHERE.
      const haystack = Prisma.sql`(
        COALESCE(c."firstName", '') || ' ' ||
        COALESCE(c."lastName", '')  || ' ' ||
        COALESCE(c.name, '')        || ' ' ||
        COALESCE(array_to_string(c.emails, ' '), '')
      )`;
      const tokenClauses = Prisma.join(
        tokens.map((t) => Prisma.sql`${haystack} ILIKE ${`%${t}%`}`),
        " AND ",
      );
      contactRowsRaw = await prisma.$queryRaw<ContactRaw[]>(Prisma.sql`
        SELECT c.id, c."firstName", c."lastName", c.name,
               c."clientId",
               cl.name         AS "clientName",
               cl."legacyRfId" AS "clientLegacyRfId"
        FROM "Contact" c
        LEFT JOIN "Client" cl ON cl.id = c."clientId"
        WHERE c."organizationId" = ${org.id}
          AND (${tokenClauses})
        ORDER BY COALESCE(c."lastName", c.name, '') ASC
        LIMIT ${QUICK_LIMIT}
      `);
    }

    // Round-robin allocation across three pools. One pass takes one
    // from each non-empty pool until the budget is spent; short pools
    // drop out and the remaining pools absorb the slack.
    let remaining = QUICK_LIMIT;
    let takeCand = 0;
    let takeCli = 0;
    let takeCon = 0;
    while (remaining > 0) {
      const before = remaining;
      if (takeCand < candidateRowsRaw.length && remaining > 0) {
        takeCand++;
        remaining--;
      }
      if (takeCli < clientRowsRaw.length && remaining > 0) {
        takeCli++;
        remaining--;
      }
      if (takeCon < contactRowsRaw.length && remaining > 0) {
        takeCon++;
        remaining--;
      }
      if (remaining === before) break;
    }

    const candidates: QuickSearchRow[] = candidateRowsRaw.slice(0, takeCand).map((c) => ({
      id: c.id,
      name: c.name,
      title: c.title,
      employer: c.employer,
    }));

    const clients: QuickClientRow[] = clientRowsRaw.slice(0, takeCli).map((c) => {
      const loc = c.location as ClientLocationJson;
      const city = loc?.city?.trim() ?? "";
      return {
        slug: c.legacyRfId != null ? String(c.legacyRfId) : c.id,
        name: c.name || "(unnamed)",
        city,
      };
    });

    const contacts: QuickContactRow[] = contactRowsRaw.slice(0, takeCon).map((c) => {
      const fullName =
        [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
        c.name?.trim() ||
        "(unnamed)";
      return {
        id: c.id,
        name: fullName,
        companyName: c.clientName?.trim() ?? "",
        clientSlug:
          c.clientLegacyRfId != null
            ? String(c.clientLegacyRfId)
            : c.clientId ?? "",
      };
    });

    return { ok: true, candidates, clients, contacts };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Search failed." };
  }
}
