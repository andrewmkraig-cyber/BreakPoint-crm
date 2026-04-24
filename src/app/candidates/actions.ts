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

export type QuickGlobalSearchResult =
  | {
      ok: true;
      candidates: QuickSearchRow[];
      clients: QuickClientRow[];
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

// Global header quick-search — returns both candidates + clients in
// one round-trip. Splits QUICK_LIMIT (8) between the two groups: up
// to 4 of each, but if one side has fewer matches the other can
// fill the remaining slots. Keeps the dropdown useful when the query
// is strongly weighted toward one entity type ("acme" → mostly
// clients; "smith" → mostly candidates).
export async function quickSearchGlobal(query: string): Promise<QuickGlobalSearchResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { ok: true, candidates: [], clients: [] };
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

    // Allocate slots: cap each side at half, but let the other side
    // absorb the remainder so the dropdown never comes back short when
    // more matches exist in one group than the other.
    const half = Math.floor(QUICK_LIMIT / 2);
    const candidateCount = Math.min(candidateRowsRaw.length, half);
    const clientBudget = QUICK_LIMIT - candidateCount;
    const clientCount = Math.min(clientRowsRaw.length, clientBudget);
    // If clients under-fill, let candidates expand into the slack.
    const candidateBudget = QUICK_LIMIT - clientCount;
    const candidateFinal = Math.min(candidateRowsRaw.length, candidateBudget);

    const candidates: QuickSearchRow[] = candidateRowsRaw.slice(0, candidateFinal).map((c) => ({
      id: c.id,
      name: c.name,
      title: c.title,
      employer: c.employer,
    }));

    const clients: QuickClientRow[] = clientRowsRaw.slice(0, clientCount).map((c) => {
      const loc = c.location as ClientLocationJson;
      const city = loc?.city?.trim() ?? "";
      return {
        slug: c.legacyRfId != null ? String(c.legacyRfId) : c.id,
        name: c.name || "(unnamed)",
        city,
      };
    });

    return { ok: true, candidates, clients };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Search failed." };
  }
}
