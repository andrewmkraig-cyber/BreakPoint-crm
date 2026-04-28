// Client-side helper for the Prev/Next nav on candidate profiles.
// Whenever a list-style surface (candidates table, pipeline list,
// applicants table, list-detail page) navigates the user into a
// specific candidate, it stashes the *ordered list of candidate
// cuids* it was showing into sessionStorage so the profile page can
// read it back and offer Prev / Next arrows that respect that
// surface's current filter + sort.
//
// sessionStorage (not localStorage): the snapshot is meant to live
// for the duration of the recruiter's drill-down session and reset
// when they open a new tab. localStorage would let stale snapshots
// from yesterday's pipeline view leak into today's candidates list.

const STORAGE_KEY = "ace-candidate-nav";

export type CandidateNavSnapshot = {
  // Where the recruiter came from. Drives the back-link label so
  // "Back to all candidates" reads correctly when returning to /candidates,
  // and "Back to pipeline" reads correctly from /pipeline. Each surface
  // names itself when stashing.
  source: string;
  // Optional href the back button should route to (preserves filter +
  // sort + page query string from the source page). Defaults to a
  // sensible per-source fallback when omitted.
  backHref?: string;
  // Ordered candidate cuid list as the source surface displayed them.
  ids: string[];
};

export function setCandidateNavList(snapshot: CandidateNavSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota / strict-privacy modes can throw — Prev/Next gracefully
    // fall back to a plain back link if the stash fails.
  }
}

export function getCandidateNavSnapshot(): CandidateNavSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CandidateNavSnapshot;
    if (!parsed || !Array.isArray(parsed.ids)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCandidateNavList(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
