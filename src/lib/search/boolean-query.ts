// Boolean query parser shared by the candidate search API and the
// candidates rail's highlight tokenizer. Goals:
//   1. Default whitespace-separated terms are AND'd (every term must hit).
//   2. Explicit `OR` between two terms groups them so a hit on either side
//      satisfies that clause; the surrounding terms stay AND'd.
//   3. Double-quoted phrases collapse to a single token preserving spaces
//      so a recruiter can search "tax manager" as one phrase rather than
//      requiring tax AND manager separately.
//
// Examples:
//   parseBooleanQuery("tax cpa shane") => [["tax"], ["cpa"], ["shane"]]
//   parseBooleanQuery("tax OR cpa")    => [["tax", "cpa"]]
//   parseBooleanQuery("tax OR cpa shane") => [["tax", "cpa"], ["shane"]]
//   parseBooleanQuery('"tax manager" cpa') => [["tax manager"], ["cpa"]]
//   parseBooleanQuery("tax AND cpa")   => [["tax"], ["cpa"]]
//
// The outer array is AND-composed; each inner array is OR-composed.

export function parseBooleanQuery(q: string): string[][] {
  const tokens = tokenizeRaw(q);
  const groups: string[][] = [];
  let current: string[] = [];
  let pendingOr = false;
  for (const t of tokens) {
    const upper = t.toUpperCase();
    if (upper === "OR") {
      pendingOr = true;
      continue;
    }
    if (upper === "AND") {
      if (current.length > 0) groups.push(current);
      current = [];
      pendingOr = false;
      continue;
    }
    if (pendingOr && current.length > 0) {
      current.push(t);
      pendingOr = false;
    } else {
      if (current.length > 0) groups.push(current);
      current = [t];
      pendingOr = false;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.filter((g) => g.length > 0);
}

// Honors double-quoted phrases as single tokens. Whitespace splits the
// rest. An unterminated opening quote captures everything through end of
// string so a recruiter typing a half-quoted phrase still gets a sensible
// last token rather than dropping the tail.
function tokenizeRaw(q: string): string[] {
  const out: string[] = [];
  const s = q.trim();
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      const end = s.indexOf('"', i + 1);
      if (end === -1) {
        const tail = s.slice(i + 1).trim();
        if (tail) out.push(tail);
        break;
      }
      const phrase = s.slice(i + 1, end).trim();
      if (phrase) out.push(phrase);
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < s.length && !/\s/.test(s[j]) && s[j] !== '"') j++;
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

// Flatten the parsed query into a unique list of tokens (preserving
// first-seen casing). Used wherever the consumer wants every searchable
// term without the AND/OR structure — highlight chip strip, resume
// snippet pivot, etc.
export function flattenBooleanQuery(q: string): string[] {
  const groups = parseBooleanQuery(q);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    for (const t of g) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}
