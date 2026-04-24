"use server";

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
    // Clients direct — no existing helper carries a query filter, and
    // the client search is narrower than the candidate one (name only
    // — domain / industry / etc. aren't what you search by typing two
    // characters in the header).
    const clientRowsRaw = await prisma.client.findMany({
      where: {
        organizationId: org.id,
        name: { contains: trimmed, mode: "insensitive" },
      },
      select: { id: true, legacyRfId: true, name: true, location: true },
      orderBy: { name: "asc" },
      take: QUICK_LIMIT,
    });
    // Contacts: firstName / lastName / legacy `name` ILIKE, plus a
    // substring check into the `emails: String[]` array. Prisma has no
    // ILIKE operator for array elements, so this path goes through
    // $queryRaw — org scope is asserted explicitly in the WHERE since
    // $queryRaw bypasses the tenant-scope extension.
    const pattern = `%${trimmed}%`;
    const contactRowsRaw = await prisma.$queryRaw<ContactRaw[]>`
      SELECT c.id, c."firstName", c."lastName", c.name,
             c."clientId",
             cl.name         AS "clientName",
             cl."legacyRfId" AS "clientLegacyRfId"
      FROM "Contact" c
      LEFT JOIN "Client" cl ON cl.id = c."clientId"
      WHERE c."organizationId" = ${org.id}
        AND (
          c."firstName" ILIKE ${pattern}
          OR c."lastName" ILIKE ${pattern}
          OR c.name ILIKE ${pattern}
          OR EXISTS (SELECT 1 FROM unnest(c.emails) e WHERE e ILIKE ${pattern})
        )
      ORDER BY COALESCE(c."lastName", c.name, '') ASC
      LIMIT ${QUICK_LIMIT}
    `;

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
