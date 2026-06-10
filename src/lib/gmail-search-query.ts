export function expandGmailThreadSearchQueries(raw: string | null | undefined): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];

  const queries = [trimmed];
  const compact = compactPlainTwoWordQuery(trimmed);
  if (compact && compact.toLowerCase() !== trimmed.toLowerCase()) {
    queries.push(compact);
  }
  return queries;
}

function compactPlainTwoWordQuery(query: string): string | null {
  if (!/\s/.test(query)) return null;
  if (/[:"{}()[\]]/.test(query)) return null;

  const words = query.split(/\s+/).filter(Boolean);
  if (words.length !== 2) return null;
  if (words.some((word) => /^(and|or)$/i.test(word))) return null;
  if (words.some((word) => !/^[A-Za-z0-9]+$/.test(word))) return null;
  if (words.some((word) => word.length < 2)) return null;

  const compact = words.join("");
  if (compact.length < 4 || compact.length > 40) return null;
  return compact;
}
