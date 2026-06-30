export type LinkedInProfileMetadata = {
  url: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  currentOrganization: string | null;
  location: string | null;
  education: string | null;
  skills: string[];
  summary: string | null;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_HTML_CHARS = 500_000;
const LINKEDIN_PROFILE_PATH_RE = /^\/in\/[^/?#]+\/?$/i;
const MASKED_RE = /^\*+(\s+\*+)*$/;
const CREDENTIAL_RE = /\b(CPA|CFA|MBA|EA|CMA|CIA|CISA|PMP|PHR|SPHR|SHRM-CP|SHRM-SCP|JD|ESQ\.?)\b/gi;

export async function fetchLinkedInProfileMetadata(
  rawUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<LinkedInProfileMetadata | null> {
  const url = normalizeLinkedInProfileUrl(rawUrl);
  if (!url) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;

    const html = (await res.text()).slice(0, MAX_HTML_CHARS);
    return parseLinkedInProfileMetadata(html, url);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseLinkedInProfileMetadata(
  html: string,
  url: string,
): LinkedInProfileMetadata | null {
  const meta = extractMetaTags(html);
  const ldPerson = extractJsonLdPerson(html);
  const description = firstNonEmpty(
    meta.get("description"),
    meta.get("og:description"),
    meta.get("twitter:description"),
  );
  const ogTitle = firstNonEmpty(meta.get("og:title"), meta.get("twitter:title"), extractTitle(html));

  const rawName = firstNonEmpty(
    toCleanString(ldPerson?.name),
    joinNameParts(meta.get("profile:first_name"), meta.get("profile:last_name")),
    parseNameFromTitle(ogTitle),
  );
  const nameParts = rawName ? splitNameAndCredentials(rawName) : null;
  const firstName = firstNonEmpty(nameParts?.firstName, meta.get("profile:first_name"));
  const lastName = firstNonEmpty(nameParts?.lastName, cleanLastName(meta.get("profile:last_name")));
  const descriptionSkills = extractCredentials(description ?? "");
  const skills = uniqueStrings([...(nameParts?.credentials ?? []), ...descriptionSkills]);

  const currentOrganization = firstNonEmpty(
    firstVisibleOrganization(ldPerson?.worksFor),
    readDescriptionPart(description, "Experience"),
    parseOrganizationFromTitle(ogTitle, rawName),
  );
  const education = firstNonEmpty(
    firstVisibleOrganization(ldPerson?.alumniOf),
    readDescriptionPart(description, "Education"),
  );
  const location = firstNonEmpty(
    toCleanString(readPath(ldPerson, ["address", "addressLocality"])),
    readDescriptionPart(description, "Location"),
  );

  const summaryParts = [
    currentOrganization ? `Experience: ${currentOrganization}` : null,
    education ? `Education: ${education}` : null,
    location ? `Location: ${location}` : null,
  ].filter((part): part is string => Boolean(part));

  if (!rawName && !currentOrganization && !education && !location && skills.length === 0) {
    return null;
  }

  return {
    url,
    name: rawName ?? null,
    firstName: firstName ?? null,
    lastName: lastName ?? null,
    currentOrganization: currentOrganization ?? null,
    location: location ?? null,
    education: education ?? null,
    skills,
    summary: summaryParts.length ? summaryParts.join("; ") : description ?? null,
  };
}

export function formatLinkedInMetadataForPrompt(meta: LinkedInProfileMetadata): string {
  return [
    "--- LinkedIn public profile metadata fetched from the URL ---",
    `Profile URL: ${meta.url}`,
    meta.name ? `Visible name: ${meta.name}` : null,
    meta.firstName ? `First name: ${meta.firstName}` : null,
    meta.lastName ? `Last name: ${meta.lastName}` : null,
    meta.currentOrganization ? `Current employer / visible experience: ${meta.currentOrganization}` : null,
    meta.location ? `Location: ${meta.location}` : null,
    meta.education ? `Education: ${meta.education}` : null,
    meta.skills.length ? `Visible certifications / skills: ${meta.skills.join(", ")}` : null,
    meta.summary ? `Public summary: ${meta.summary}` : null,
    "Use only these fetched metadata fields from the LinkedIn URL. Do not infer hidden or masked job titles.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function normalizeLinkedInProfileUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname.toLowerCase();
    if (host !== "linkedin.com" && host !== "www.linkedin.com") return null;
    if (!LINKEDIN_PROFILE_PATH_RE.test(parsed.pathname)) return null;
    parsed.protocol = "https:";
    parsed.hostname = "www.linkedin.com";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractMetaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  const re = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const attrs = extractAttributes(match[0]);
    const key = firstNonEmpty(attrs.property, attrs.name);
    const content = attrs.content;
    if (!key || !content) continue;
    tags.set(key.toLowerCase(), content);
  }
  return tags;
}

function extractAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:.-]+)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag)) !== null) {
    attrs[match[1].toLowerCase()] = cleanText(match[3]);
  }
  return attrs;
}

function extractJsonLdPerson(html: string): Record<string, unknown> | null {
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1].trim()));
      const person = findPersonNode(parsed);
      if (person) return person;
    } catch {
      // Ignore malformed metadata blocks.
    }
  }
  return null;
}

function findPersonNode(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPersonNode(item);
      if (found) return found;
    }
    return null;
  }

  const obj = value as Record<string, unknown>;
  if (obj["@type"] === "Person") return obj;
  if (Array.isArray(obj["@graph"])) return findPersonNode(obj["@graph"]);
  return null;
}

function firstVisibleOrganization(value: unknown): string | null {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  for (const item of items) {
    const name = toCleanString(readPath(item, ["name"]));
    if (name && !MASKED_RE.test(name)) return name;
  }
  return null;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object" || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readDescriptionPart(description: string | null | undefined, label: string): string | null {
  if (!description) return null;
  const re = new RegExp(`${escapeRegExp(label)}:\\s*([^·|]+)`, "i");
  const match = description.match(re);
  return match ? cleanVisibleValue(match[1]) : null;
}

function parseNameFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const beforeLinkedIn = title.replace(/\s*\|\s*LinkedIn\s*$/i, "");
  return cleanVisibleValue(beforeLinkedIn.split(/\s+-\s+/)[0]);
}

function parseOrganizationFromTitle(
  title: string | null | undefined,
  rawName: string | null | undefined,
): string | null {
  if (!title) return null;
  const beforeLinkedIn = title.replace(/\s*\|\s*LinkedIn\s*$/i, "");
  const parts = beforeLinkedIn.split(/\s+-\s+/).map(cleanVisibleValue).filter(Boolean);
  if (parts.length < 2) return null;
  const candidate = parts[parts.length - 1];
  if (!candidate || (rawName && candidate.toLowerCase() === rawName.toLowerCase())) return null;
  return candidate;
}

function splitNameAndCredentials(rawName: string): {
  firstName: string | null;
  lastName: string | null;
  credentials: string[];
} {
  const credentials = extractCredentials(rawName);
  const nameOnly = stripTrailingCredentials(rawName, credentials);
  const parts = nameOnly.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null, credentials };
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
    credentials,
  };
}

function extractCredentials(value: string): string[] {
  const found: string[] = [];
  CREDENTIAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CREDENTIAL_RE.exec(value)) !== null) {
    found.push(match[1].replace(/\.$/, "").toUpperCase());
  }
  return uniqueStrings(found);
}

function cleanLastName(value: string | null | undefined): string | null {
  if (!value) return null;
  const credentials = extractCredentials(value);
  return cleanVisibleValue(stripTrailingCredentials(value, credentials));
}

function stripTrailingCredentials(rawName: string, credentials: string[]): string {
  let cleaned = cleanText(rawName);
  if (credentials.length) {
    const credentialPattern = credentials.map(escapeRegExp).join("|");
    cleaned = cleaned.replace(new RegExp(`,?\\s*(?:${credentialPattern})\\.?\\s*$`, "i"), "");
  }
  return cleaned.replace(/,\s*$/, "").trim();
}

function joinNameParts(first: string | null | undefined, last: string | null | undefined): string | null {
  const joined = [first, last].map(cleanVisibleValue).filter(Boolean).join(" ").trim();
  return joined || null;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanText(match[1]) : null;
}

function cleanVisibleValue(value: string | null | undefined): string | null {
  const cleaned = cleanText(value ?? "");
  if (!cleaned || MASKED_RE.test(cleaned)) return null;
  return cleaned;
}

function toCleanString(value: unknown): string | null {
  return typeof value === "string" ? cleanVisibleValue(value) : null;
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const cleaned = cleanVisibleValue(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
