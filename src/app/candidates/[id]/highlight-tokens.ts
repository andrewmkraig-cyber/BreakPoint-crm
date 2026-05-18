// Shared parser for the ?highlight=token1,token2 query param the
// candidates split-view threads into the embed profile. The rail
// already flattens its boolean parse (lib/search/boolean-query) into
// a deduped list before comma-joining, so this consumer just splits
// on commas and trims. AND/OR keywords were dropped upstream — we
// drop them here too as a belt-and-suspenders guard against any
// older saved/bookmarked URL that still passes them inline.

const EMBED_HIGHLIGHT_STOPWORDS = new Set(["and", "or"]);

export function parseHighlightTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !EMBED_HIGHLIGHT_STOPWORDS.has(s.toLowerCase()));
}

// Narrow a highlight-token list to only the tokens that appear (case-
// insensitive) somewhere in the supplied candidate haystack. Used by the
// embed profile so the chip strip + in-doc highlights only surface terms
// that actually matched the candidate, dropping tokens that hit through
// a different field on a sibling row but found nothing on this person.
export function filterTokensToHaystack(
  tokens: string[],
  haystack: string,
): string[] {
  if (tokens.length === 0) return tokens;
  const lower = haystack.toLowerCase();
  return tokens.filter((t) => lower.includes(t.toLowerCase()));
}

