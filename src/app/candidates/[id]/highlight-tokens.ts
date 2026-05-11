// Shared parser for the ?highlight=token1,token2 query param the
// candidates split-view threads into the embed profile. Mirrors the
// candidates rail's highlightTokens(): split on commas, trim, drop
// empties + boolean stopwords so &highlight=tax,and,CPA does not
// surface "and" as a matched word.

const EMBED_HIGHLIGHT_STOPWORDS = new Set(["and", "or"]);

export function parseHighlightTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !EMBED_HIGHLIGHT_STOPWORDS.has(s.toLowerCase()));
}
