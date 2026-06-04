// Recovery helpers for a stored BDRun.discoveredPayload entry.
//
// Older runs (and any run discovered before the TheirStack provider
// mapping fix) stored companyName/domain as "" because the provider read
// row.company?.name while TheirStack returns the company name as a plain
// string at row.company, with the structured copy at row.company_object.
// The real name + domain still live in the entry's retained rawPayload,
// so we recover them at read time instead of forcing a re-run. New runs
// already store the right values, so for those the stored field wins and
// rawPayload is never consulted.
//
// Both the approval-queue serializer (extractDiscoveredCompaniesRaw) and
// the enroll extractor (extractDiscovered) must use the SAME recovery so
// they keep the same companies in the same order; the popup's per-company
// selection is keyed by array index into that shared list.

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

// One ADDITIONAL job beyond a company's primary. Carried alongside the
// count so the "+N more role(s)" note can deep-link to another posting.
// url is null when that collapsed job had no posting link.
export type ExtraRole = {
  title: string;
  url: string | null;
};

// One deduped company group. `primary` is the raw payload object of the
// FIRST job seen for this company (its title/location/posting link are the
// ones shown + enrolled); `extraRoleCount` is how many ADDITIONAL jobs the
// same company had, surfaced as a muted "+N more role(s)" note. `extraRoles`
// carries the {title,url} of those collapsed jobs (length === extraRoleCount)
// so the note can open one of the other postings. This is pure extra
// metadata: it does NOT affect dedup order or primary-company identity, so
// the index-alignment the queue popup and enroll extractor depend on is
// untouched.
export type DedupedDiscoveredEntry = {
  primary: Record<string, unknown>;
  companyName: string;
  domain: string;
  extraRoleCount: number;
  extraRoles: ExtraRole[];
};

// Dedup key: the recovered domain when present (companies are the same
// regardless of how the name is punctuated), falling back to the
// lowercased company name when no domain was captured.
function dedupKey(companyName: string, domain: string): string {
  const d = domain.trim().toLowerCase();
  if (d) return `domain:${d}`;
  return `name:${companyName.trim().toLowerCase()}`;
}

// Collapse a stored discoveredPayload to one entry per COMPANY, keeping the
// first job as the primary and counting the rest as extra roles. This is
// the SINGLE source of dedup for the whole BD approval flow: the queue
// serializer, the Review-companies popup, and the Apollo enroll extractor
// all build their lists from this, so they stay index-aligned (the popup's
// per-company checkbox selection maps to the enroll list by array index).
// The companyName-empty skip mirrors the pre-dedup extractors exactly.
export function dedupeDiscoveredByCompany(payload: unknown): DedupedDiscoveredEntry[] {
  if (!Array.isArray(payload)) return [];
  const order: string[] = [];
  const byKey = new Map<string, DedupedDiscoveredEntry>();
  for (const item of payload) {
    const obj = asRecord(item);
    if (!obj) continue;
    const companyName = recoverCompanyName(obj);
    if (!companyName) continue;
    const domain = recoverDomain(obj);
    const key = dedupKey(companyName, domain);
    const existing = byKey.get(key);
    if (existing) {
      existing.extraRoleCount += 1;
      existing.extraRoles.push({ title: recoverJobTitle(obj), url: recoverJobPostingUrl(obj) });
      continue;
    }
    byKey.set(key, { primary: obj, companyName, domain, extraRoleCount: 0, extraRoles: [] });
    order.push(key);
  }
  return order.map((k) => byKey.get(k) as DedupedDiscoveredEntry);
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// companyName, preferring the stored field, then the rawPayload sources
// TheirStack actually populates. Returns "" only when nothing is found.
export function recoverCompanyName(obj: Record<string, unknown>): string {
  const direct = trimmedString(obj.companyName);
  if (direct) return direct;

  const raw = asRecord(obj.rawPayload);
  if (!raw) return "";

  // TheirStack: company is a plain string ("HSBC").
  const companyString = trimmedString(raw.company);
  if (companyString) return companyString;

  // Structured copy: company_object.name.
  const companyObject = asRecord(raw.company_object);
  const objectName = companyObject ? trimmedString(companyObject.name) : "";
  if (objectName) return objectName;

  // Legacy/object-shaped company.name (other providers).
  const companyNested = asRecord(raw.company);
  const nestedName = companyNested ? trimmedString(companyNested.name) : "";
  if (nestedName) return nestedName;

  return "";
}

// domain, preferring the stored field, then rawPayload sources. Used for
// the favicon; "" falls back to the initials circle in ClientLogo.
export function recoverDomain(obj: Record<string, unknown>): string {
  const direct = trimmedString(obj.domain);
  if (direct) return direct;

  const raw = asRecord(obj.rawPayload);
  if (!raw) return "";

  const companyDomain = trimmedString(raw.company_domain);
  if (companyDomain) return companyDomain;

  const companyObject = asRecord(raw.company_object);
  if (companyObject) {
    const objectDomain = trimmedString(companyObject.domain) || trimmedString(companyObject.website);
    if (objectDomain) return objectDomain;
  }

  const companyNested = asRecord(raw.company);
  if (companyNested) {
    const nestedDomain = trimmedString(companyNested.domain) || trimmedString(companyNested.website);
    if (nestedDomain) return nestedDomain;
  }

  return "";
}

// Job title for an extra (collapsed) role; "" when none was stored.
function recoverJobTitle(obj: Record<string, unknown>): string {
  return trimmedString(obj.jobTitle);
}

// Posting URL for an extra (collapsed) role. Mirrors the field set the
// queue serializer and enroll extractor resolve (jobPostingUrl/jobUrl/url);
// null when the collapsed job carried no posting link.
function recoverJobPostingUrl(obj: Record<string, unknown>): string | null {
  const url =
    trimmedString(obj.jobPostingUrl) || trimmedString(obj.jobUrl) || trimmedString(obj.url);
  return url || null;
}
