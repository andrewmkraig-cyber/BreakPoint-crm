export type GmailSearchRecipient = {
  email?: string | null;
};

export function expandGmailThreadSearchQueries(
  raw: string | null | undefined,
  extraQueries: string[] = [],
): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];

  const queries: string[] = [];
  const seen = new Set<string>();
  const addQuery = (query: string) => {
    const normalized = query.trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(normalized);
  };

  addQuery(trimmed);
  const compact = compactPlainTwoWordQuery(trimmed);
  if (compact && compact.toLowerCase() !== trimmed.toLowerCase()) {
    addQuery(compact);
  }
  for (const query of extraQueries) {
    addQuery(query);
  }
  return queries;
}

export function buildSentRecipientDomainSearchQueries(
  raw: string | null | undefined,
  recipients: GmailSearchRecipient[],
): string[] {
  const needle = compactPlainSearchNeedle(raw);
  if (!needle) return [];

  const domains = new Set<string>();
  for (const recipient of recipients) {
    const domain = domainFromEmail(recipient.email);
    if (!domain) continue;
    const domainFirstLabel = domain.split(".")[0] ?? "";
    const compactDomain = domain.replace(/[^a-z0-9]/g, "");
    if (
      !domain.includes(needle) &&
      !domainFirstLabel.includes(needle) &&
      !compactDomain.includes(needle)
    ) {
      continue;
    }
    domains.add(domain);
    if (domains.size >= 5) break;
  }

  const queries: string[] = [];
  for (const domain of Array.from(domains)) {
    queries.push(
      domain,
      `to:${domain}`,
      `cc:${domain}`,
      `bcc:${domain}`,
      `from:${domain}`,
    );
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

function compactPlainSearchNeedle(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (/[:"{}()[\]@]/.test(trimmed)) return null;
  if (/\b(and|or)\b/i.test(trimmed)) return null;

  const compact = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact.length < 3 || compact.length > 40) return null;
  if (["com", "net", "org", "edu", "gov", "io", "co", "us"].includes(compact)) {
    return null;
  }
  return compact;
}

function domainFromEmail(raw: string | null | undefined): string | null {
  const email = raw?.trim().toLowerCase();
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return domain;
}
