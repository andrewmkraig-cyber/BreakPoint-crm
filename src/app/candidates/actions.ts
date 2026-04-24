"use server";

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
