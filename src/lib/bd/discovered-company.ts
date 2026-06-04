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
