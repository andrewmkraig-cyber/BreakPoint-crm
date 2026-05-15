import { prisma } from "@/lib/prisma";

export type CompanyOutreachHistory = {
  runCount: number;
  contactsTriedTotal: number;
  lastOutreachAt: Date | null;
};

export type CompanyIdentifier = {
  // Optional — discoveredPayload entries written before domain was
  // populated upstream will only match on companyName. Provider/webhook
  // both write `domain` today, so newer runs match on either.
  domain?: string | null;
  companyName: string;
};

// Statuses where outreach actually went out — pre-approval and dismissed
// runs never contacted anyone, so they shouldn't count as prior history.
const OUTREACH_STATUSES = ["APPROVED", "ENROLLING", "COMPLETE"] as const;

export async function getCompanyOutreachHistory(
  identifier: CompanyIdentifier,
  orgId: string,
): Promise<CompanyOutreachHistory> {
  const normDomain = normalizeDomain(identifier.domain);
  const normName = normalizeName(identifier.companyName);
  if (!normDomain && !normName) {
    return { runCount: 0, contactsTriedTotal: 0, lastOutreachAt: null };
  }

  const runs = await prisma.bDRun.findMany({
    where: {
      organizationId: orgId,
      status: { in: [...OUTREACH_STATUSES] },
    },
    select: { id: true, discoveredPayload: true },
  });

  const matchingRunIds: string[] = [];
  for (const r of runs) {
    if (payloadIncludesCompany(r.discoveredPayload, normDomain, normName)) {
      matchingRunIds.push(r.id);
    }
  }

  if (matchingRunIds.length === 0) {
    return { runCount: 0, contactsTriedTotal: 0, lastOutreachAt: null };
  }

  const activities = await prisma.bDActivity.findMany({
    where: {
      organizationId: orgId,
      bdRunId: { in: matchingRunIds },
      kind: "ENROLL",
    },
    select: { occurredAt: true, metadata: true },
  });

  // BDActivity.metadata.contacts is a run-total (apollo-enroll writes one
  // BDActivity per run with the sum of enrolled contacts across every
  // company in that run). So this is "contacts in runs that included this
  // company", not strictly per-company. Per-company breakdown would need
  // schema changes.
  let contactsTriedTotal = 0;
  let lastOutreachAt: Date | null = null;
  for (const a of activities) {
    const c = (a.metadata as { contacts?: unknown } | null)?.contacts;
    if (typeof c === "number") contactsTriedTotal += c;
    if (!lastOutreachAt || a.occurredAt > lastOutreachAt) {
      lastOutreachAt = a.occurredAt;
    }
  }

  return {
    runCount: matchingRunIds.length,
    contactsTriedTotal,
    lastOutreachAt,
  };
}

function payloadIncludesCompany(
  payload: unknown,
  normDomain: string,
  normName: string,
): boolean {
  if (!Array.isArray(payload)) return false;
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (normDomain) {
      const d = normalizeDomain(typeof obj.domain === "string" ? obj.domain : null);
      if (d && d === normDomain) return true;
    }
    if (normName) {
      const n = normalizeName(typeof obj.companyName === "string" ? obj.companyName : null);
      if (n && n === normName) return true;
    }
  }
  return false;
}

function normalizeName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function normalizeDomain(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}
