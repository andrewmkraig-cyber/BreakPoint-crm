export type MailContactSuggestionSource = "ace" | "gmail";

export type MailContactSuggestion = {
  name: string;
  email: string;
  source: MailContactSuggestionSource;
  sourceIndex: number;
};

export type RankedMailContactSuggestion = MailContactSuggestion & {
  score: number;
  matchKind: MatchKind;
};

type MatchKind =
  | "none"
  | "exactEmail"
  | "localPrefix"
  | "namePrefix"
  | "domainPrefix"
  | "emailContains"
  | "nameContains";

function clean(s: string): string {
  return s.trim().toLowerCase();
}

// Recipient typeahead ranking is intentionally email-intent first.
// When a recruiter types "rec", a previously emailed
// receipts@mercury.com address is a stronger match than every Ace
// candidate whose display name starts with "Rec...".
export function scoreMailContactSuggestion(
  name: string,
  email: string,
  query: string,
): { score: number; matchKind: MatchKind } {
  const q = clean(query);
  if (!q) return { score: 0, matchKind: "none" };

  const lowerEmail = clean(email);
  const lowerName = clean(name);
  const [localPart = "", domain = ""] = lowerEmail.split("@");

  if (lowerEmail === q) return { score: 600, matchKind: "exactEmail" };
  if (localPart.startsWith(q)) return { score: 500, matchKind: "localPrefix" };
  if (lowerName.startsWith(q)) return { score: 400, matchKind: "namePrefix" };
  if (domain.startsWith(q)) return { score: 350, matchKind: "domainPrefix" };
  if (lowerEmail.includes(q)) return { score: 300, matchKind: "emailContains" };
  if (lowerName.includes(q)) return { score: 200, matchKind: "nameContains" };
  return { score: 0, matchKind: "none" };
}

function sourceTieBreak(
  source: MailContactSuggestionSource,
  matchKind: MatchKind,
): number {
  if (matchKind === "namePrefix" || matchKind === "nameContains") {
    return source === "ace" ? 1 : 0;
  }
  return source === "gmail" ? 1 : 0;
}

export function rankMailContactSuggestions(
  suggestions: MailContactSuggestion[],
  query: string,
): RankedMailContactSuggestion[] {
  return suggestions
    .map((s) => {
      const { score, matchKind } = scoreMailContactSuggestion(
        s.name,
        s.email,
        query,
      );
      return { ...s, score, matchKind };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      const aSource = sourceTieBreak(a.source, a.matchKind);
      const bSource = sourceTieBreak(b.source, b.matchKind);
      if (bSource !== aSource) return bSource - aSource;

      // Gmail snapshot order is newest-first, so preserve it for equal
      // sent-history matches. Ace rows do not have a meaningful recency
      // signal here, so email gives stable output.
      if (a.source === "gmail" && b.source === "gmail") {
        return a.sourceIndex - b.sourceIndex;
      }
      if (a.source === "ace" && b.source === "ace") {
        return a.email.localeCompare(b.email);
      }
      return a.email.localeCompare(b.email);
    });
}
