import type { Client } from "@prisma/client";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { clientSlug, extractFeePctFromCustomFields } from "@/lib/client-identity";

// Re-exported so the existing
// `import { extractFeePctFromCustomFields } from "@/lib/clients"` call sites
// (candidate profile, job detail) keep working after the move.
export { clientSlug, extractFeePctFromCustomFields };
import type { RFClient } from "@/lib/rf-payload-shapes";

// Row shape used by the /clients list and the /jobs/new client dropdown.
// The `slug` is the stable URL segment — legacyRfId as a string for RF-
// imported rows (back-compat with existing URLs) or the cuid for Ace-
// native rows. Keeping both keys on the row lets callers decide which
// to surface without another round trip.
export type ClientListRow = {
  id: string;
  legacyRfId: number | null;
  slug: string;
  name: string;
  domain: string | null;
  industry: string | null;
  linkedIn: string | null;
  location: string | null;
  phone: string | null;
  openJobsCount: number;
  closedJobsCount: number;
  isVerified: boolean;
  feePct: number | null;
  // Per-user ownership. ownerId is null when the client is unclaimed /
  // available; ownerName is the owner's display name for the "Owned by"
  // badge in the All-clients view.
  ownerId: string | null;
  ownerName: string | null;
  // Client row creation timestamp. Used by /clients as the floor for the
  // Active/Quiet/Inactive bucket — a brand-new client with zero recorded
  // activity counts as Active until `createdAt + 7d` under the revised
  // rule (was 30d before Ace 67.22). Always set (Prisma default).
  createdAt: Date;
};

// Shared parser for Client.customFields (Json column). RF-imported
// clients carry their fee % inside this column as an array of
// {name, value} objects under one of three name variants ("Avg Fee %",
// "Fee %", "Fee Percent"). Returns null when the field is missing,
// malformed, or unparseable as a number. Reused by:
//   - /jobs/[id] page (where this logic originally lived)
//   - /candidates/[id] page  (defensive read when Client.feePct is null)
//   - LocalPlacementRows seed path via local-profile.tsx
//   - scripts/backfill-client-feepct.ts (one-shot Client.feePct backfill)

type LocationJson = {
  street_address_1?: string | null;
  street_address_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
} | null;

function compactLocation(raw: LocationJson): string {
  if (!raw) return "";
  const city = raw.city?.trim() ?? "";
  const state = raw.state?.trim() ?? "";
  const postalCode = raw.postal_code?.trim() ?? "";
  const cityState = [city, state].filter(Boolean).join(", ");
  return [cityState, postalCode].filter(Boolean).join(" ");
}

// Delegates to the canonical implementation in @/lib/client-identity so
// there is exactly one definition of the client URL segment.
const slugFor = clientSlug;

// Lists every Client in the signed-in tenant. Returns both RF-imported
// rows (legacyRfId set, rich `raw` payload) and Ace-native rows
// (legacyRfId null, raw null). Consumers render from the native Neon
// columns; the RF-shaped `raw` column is only consulted for fields we
// don't yet surface as first-class columns (open_jobs snapshot, custom
// fields, files).
export async function getClientsForOrg(): Promise<ClientListRow[]> {
  const org = await getCurrentOrg();
  const rows = await prisma.client.findMany({
    where: { organizationId: org.id },
    select: {
      id: true,
      legacyRfId: true,
      name: true,
      domain: true,
      industry: true,
      linkedinPage: true,
      location: true,
      phoneNumbers: true,
      // Canonical fee column written by updateClientCompany + the agreement
      // auto-fill, and read by the client Overview. The grid cards must read
      // the SAME field (see feePct below) so a fee set in Ace shows on the
      // /clients cards, not just the detail page.
      feePct: true,
      raw: true,
      ownerId: true,
      owner: { select: { name: true } },
      // Needed by /clients to seed lastActivityAt for brand-new rows
      // (Active until createdAt + 7d under the revised rule, regardless
      // of empty job / placement / interview / activity-log history).
      createdAt: true,
    },
  });

  // Live Open/Closed job counts per client. Replaces the legacy
  // Client.raw.open_jobs / closed_jobs RF snapshot, which never picked
  // up Ace-native creates (raw is null on every Ace-native client and
  // never re-syncs on existing ones). One groupBy across the tenant
  // keyed by (clientId, isOpen); tenant-scoped per Rule 8.
  //
  // Legacy RF-imported jobs (legacyRfId != null) are EXCLUDED
  // from the count. The card should reflect only what is currently a real
  // Ace-native job for the client - imported RF rows carry a frozen
  // is_open snapshot that drifts from the live Ace lifecycle (an RF job
  // reopened in Ace still showed on this card while the /jobs Active tab
  // correctly dropped it), so they were producing a phantom Open count.
  // Ace-native rows only (legacyRfId IS NULL) keeps this card in lockstep
  // with the live /jobs view.
  const jobCountGroups = await prisma.job.groupBy({
    by: ["clientId", "isOpen"],
    where: {
      organizationId: org.id,
      clientId: { not: null },
      legacyRfId: null,
    },
    _count: { _all: true },
  });
  const openCountByClientId = new Map<string, number>();
  const closedCountByClientId = new Map<string, number>();
  for (const g of jobCountGroups) {
    if (!g.clientId) continue;
    const target = g.isOpen ? openCountByClientId : closedCountByClientId;
    target.set(g.clientId, g._count._all);
  }

  // Ace-native verification source of truth (Rule 6). The verified shield
  // means "signed fee agreement on file" — the canonical signal is an
  // uploaded ClientAgreement (uploadComplete), the SAME table the client
  // detail page reads. Without this, the lists fell back to legacy RF
  // raw data only, so an agreement uploaded in Ace lit the badge on the
  // detail page but not on /clients or /jobs. One tenant-scoped query
  // (Rule 8); we key by both clientId (Ace-native canonical) and the
  // legacy clientRfId so older records that only carry the RF id match.
  const agreementRows = await prisma.clientAgreement.findMany({
    where: { organizationId: org.id, uploadComplete: true },
    select: { clientId: true, clientRfId: true },
  });
  const agreementClientIds = new Set<string>();
  const agreementRfIds = new Set<number>();
  for (const a of agreementRows) {
    if (a.clientId) agreementClientIds.add(a.clientId);
    if (a.clientRfId != null) agreementRfIds.add(a.clientRfId);
  }

  return rows.map((r) => {
    const raw = (r.raw ?? null) as RFClient | null;
    const phoneFromJson = Array.isArray(r.phoneNumbers) && r.phoneNumbers.length > 0
      ? (typeof r.phoneNumbers[0] === "string"
          ? (r.phoneNumbers[0] as string)
          : (r.phoneNumbers[0] as { number?: string }).number ?? null)
      : null;
    const openJobsCount = openCountByClientId.get(r.id) ?? 0;
    const closedJobsCount = closedCountByClientId.get(r.id) ?? 0;

    const signed = Array.isArray(raw?.custom_fields)
      ? raw!.custom_fields!.find(
          (f) => typeof f?.name === "string" && f.name.toLowerCase().includes("signed agreement"),
        )?.value
      : undefined;
    const fileWithAgreement = Array.isArray(raw?.files)
      ? raw!.files!.some((f) => typeof f?.filename === "string" && f.filename.toLowerCase().includes("agreement"))
      : false;
    // Ace-native uploaded agreement is PRIMARY (matches the detail page);
    // legacy RF custom-field / file signals stay as back-compat fallback
    // for clients that predate Ace-native uploads.
    const hasAceAgreement =
      agreementClientIds.has(r.id) || (r.legacyRfId != null && agreementRfIds.has(r.legacyRfId));
    const isVerified = hasAceAgreement || Boolean(signed) || fileWithAgreement;

    // Canonical Neon column FIRST (set by updateClientCompany + agreement
    // auto-fill, and what the Overview shows); fall back to the legacy RF
    // custom field only for RF-imported rows whose Client.feePct was never
    // backfilled. Ace-native clients have raw === null, so the old
    // raw-only read always returned null and their cards showed no fee.
    const feePct = r.feePct ?? extractFeePctFromCustomFields(raw?.custom_fields);

    return {
      id: r.id,
      legacyRfId: r.legacyRfId,
      slug: slugFor({ id: r.id, legacyRfId: r.legacyRfId }),
      name: r.name || "(unnamed)",
      domain: r.domain,
      industry: r.industry,
      linkedIn: r.linkedinPage,
      location: compactLocation(r.location as LocationJson),
      phone: phoneFromJson,
      openJobsCount,
      closedJobsCount,
      isVerified,
      feePct,
      ownerId: r.ownerId,
      ownerName: r.owner?.name ?? null,
      createdAt: r.createdAt,
    };
  });
}

// Resolves a `/clients/[id]` URL segment to a Client row. Accepts either
// a cuid (Ace-native, post-cutover canonical) or a numeric legacy RF id
// (back-compat with URLs that predate Phase 3). Scoped by the caller's
// tenant so cross-org lookups return null.
export async function getClientByIdentifier(raw: string): Promise<Client | null> {
  const org = await getCurrentOrg();
  if (/^-?\d+$/.test(raw)) {
    const legacyRfId = Number(raw);
    if (!Number.isFinite(legacyRfId)) return null;
    return prisma.client.findFirst({ where: { legacyRfId, organizationId: org.id } });
  }
  return prisma.client.findFirst({ where: { id: raw, organizationId: org.id } });
}

// Normalizes a domain for comparison: drops protocol, www, path. Used by
// the pre-flight duplicate check on the create form.
export function normalizeDomainKey(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[\/?#]/)[0] ?? "";
}

// Searches the tenant's Clients for a domain collision. Returns the
// matching Client's display name and resolved id (legacyRfId if
// present, else cuid) so the form can deep-link to the existing record.
export async function findClientByDomain(
  domain: string,
): Promise<{ id: string; legacyRfId: number | null; slug: string; name: string; domain: string } | null> {
  const needle = normalizeDomainKey(domain);
  if (!needle) return null;
  const org = await getCurrentOrg();
  const rows = await prisma.client.findMany({
    where: { organizationId: org.id, domain: { not: null } },
    select: { id: true, legacyRfId: true, name: true, domain: true },
  });
  for (const r of rows) {
    if (!r.domain) continue;
    if (normalizeDomainKey(r.domain) === needle) {
      return {
        id: r.id,
        legacyRfId: r.legacyRfId,
        slug: slugFor({ id: r.id, legacyRfId: r.legacyRfId }),
        name: r.name || "(unnamed)",
        domain: r.domain,
      };
    }
  }
  return null;
}
