const RESUME_EXTENSION_RE = /\.(pdf|docx?|txt)$/i;
const TRAILING_RESUME_LABEL_RE =
  /(?:^|[\s_.-]+)(resume|cv|curriculum vitae|profile)(?:[\s_.-]*(final|copy|updated|new|\d{4}))?$/i;
const TRAILING_CREDENTIAL_RE =
  /(?:[\s,_.-]+)(cpa|msa|mst|mba|macc|ea|cma|cfa|cfp|jd|esq|phr|sphr|shrm[\s-]?cp|\d{4})$/i;

function titleCaseNameToken(token: string): string {
  if (!token) return token;
  if (/[a-z]/.test(token) && /[A-Z]/.test(token.slice(1))) return token;
  return token
    .split(/([-'])/)
    .map((part) => {
      if (part === "-" || part === "'") return part;
      if (!part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

export function normalizeCandidateNameForMatching(raw: string): string {
  let name = raw
    .replace(RESUME_EXTENSION_RE, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[_]+/g, " ")
    .trim();

  for (let i = 0; i < 3; i++) {
    const next = name.replace(TRAILING_RESUME_LABEL_RE, "").trim();
    if (next === name) break;
    name = next;
  }

  name = name.replace(/\s+/g, " ").trim();

  for (let i = 0; i < 5; i++) {
    const next = name.replace(TRAILING_CREDENTIAL_RE, "").trim();
    if (next === name) break;
    name = next;
  }

  if (!/\s/.test(name) && /-/.test(name)) {
    name = name.replace(/-+/g, " ");
  }

  return name
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(titleCaseNameToken)
    .join(" ");
}
