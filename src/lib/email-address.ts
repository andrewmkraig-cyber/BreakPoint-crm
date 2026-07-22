export function stripMailto(raw: string): string {
  return raw.trim().replace(/^mailto:/i, "").trim();
}

export function normalizeCopiedEmail(raw: string): string {
  const trimmed = raw.trim();
  const address = trimmed.match(/<([^>]+)>/)?.[1] ?? trimmed;
  const withoutMailto = stripMailto(address);
  const withoutParams = withoutMailto.split(/[?&]/)[0]?.trim() ?? "";
  try {
    return decodeURIComponent(withoutParams);
  } catch {
    return withoutParams;
  }
}
