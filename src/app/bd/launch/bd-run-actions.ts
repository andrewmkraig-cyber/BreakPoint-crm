"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { enrollCompaniesInApollo } from "@/lib/bd/apollo-enroll";
import {
  getCompanyOutreachHistory,
  type CompanyOutreachHistory,
} from "@/lib/bd/bd-history";
import { fetchApolloContacts, type ApolloContact } from "@/lib/bd/apollo-contacts";
import { dedupeDiscoveredByCompany } from "@/lib/bd/discovered-company";

export type { ApolloContact };

export type PendingBDRun = {
  id: string;
  discoveredCount: number;
  discoveredPayload: DiscoveredCompanyLite[];
  createdAt: string;
  discoveryProvider: string;
};

export type DiscoveredCompanyLite = {
  companyName: string;
  jobTitle: string;
  domain: string;
  // Surfaced from the raw stored payload for the approval popup's company
  // rows. jobLocation is "" when the discovery entry carried no location;
  // jobPostingUrl is null when no posting URL was captured.
  jobLocation: string;
  jobPostingUrl: string | null;
  // Additional jobs the same company had beyond the primary shown here.
  // Drives the muted "+N more role(s)" note; 0 when the company had one job.
  extraRoleCount: number;
  // {title,url} of those additional jobs (length === extraRoleCount) so the
  // note can open one of the other postings. url is null when unknown.
  extraRoles: { title: string; url: string | null }[];
  history: SerializedOutreachHistory;
  contacts: ApolloContact[];
};

export type SerializedOutreachHistory = {
  runCount: number;
  contactsTriedTotal: number;
  lastOutreachAt: string | null;
};

export async function getPendingBDRuns(): Promise<PendingBDRun[]> {
  const org = await getCurrentOrg();
  const rows = await prisma.bDRun.findMany({
    where: { organizationId: org.id, status: "AWAITING_APPROVAL" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      discoveredCount: true,
      discoveredPayload: true,
      createdAt: true,
      discoveryProvider: true,
    },
  });

  const rawRuns = rows.map((r) => ({
    id: r.id,
    discoveredCount: r.discoveredCount,
    companies: extractDiscoveredCompaniesRaw(r.discoveredPayload),
    createdAt: r.createdAt.toISOString(),
    discoveryProvider: r.discoveryProvider,
  }));

  const allCompanies = rawRuns.flatMap((r) => r.companies);
  const [histories, contactLists] = await Promise.all([
    Promise.all(
      allCompanies.map((c) =>
        getCompanyOutreachHistory({ domain: c.domain, companyName: c.companyName }, org.id),
      ),
    ),
    Promise.all(
      allCompanies.map((c) =>
        c.persistedContacts.length > 0
          ? Promise.resolve(c.persistedContacts)
          : c.domain
            ? fetchApolloContacts(c.domain, org.id)
            : Promise.resolve([] as ApolloContact[]),
      ),
    ),
  ]);
  const historyByCompany = new Map<string, CompanyOutreachHistory>();
  const contactsByCompany = new Map<string, ApolloContact[]>();
  allCompanies.forEach((c, i) => {
    const key = companyKey(c.companyName, c.domain);
    if (!historyByCompany.has(key)) historyByCompany.set(key, histories[i]);
    if (!contactsByCompany.has(key)) contactsByCompany.set(key, contactLists[i]);
  });

  return rawRuns.map((r) => ({
    id: r.id,
    // Count reflects DEDUPED unique companies, not the raw job count stored
    // on the run, so "N companies discovered" matches the rendered list.
    discoveredCount: r.companies.length,
    discoveredPayload: r.companies.map((c) => {
      const key = companyKey(c.companyName, c.domain);
      const h = historyByCompany.get(key) ?? {
        runCount: 0,
        contactsTriedTotal: 0,
        lastOutreachAt: null,
      };
      return {
        companyName: c.companyName,
        jobTitle: c.jobTitle,
        domain: c.domain,
        jobLocation: c.jobLocation,
        jobPostingUrl: c.jobPostingUrl,
        extraRoleCount: c.extraRoleCount,
        extraRoles: c.extraRoles,
        history: {
          runCount: h.runCount,
          contactsTriedTotal: h.contactsTriedTotal,
          lastOutreachAt: h.lastOutreachAt ? h.lastOutreachAt.toISOString() : null,
        },
        contacts: contactsByCompany.get(key) ?? [],
      };
    }),
    createdAt: r.createdAt,
    discoveryProvider: r.discoveryProvider,
  }));
}

function companyKey(name: string, domain: string): string {
  return `${name.trim().toLowerCase()}|${domain.trim().toLowerCase()}`;
}

type ApproveResult =
  | {
      success: true;
      runId: string;
      enrolled: number;
      capped: boolean;
      // Companies that yielded no enrollable contact, with the reason, so
      // the queue can report what was skipped instead of silently dropping.
      skipped: { companyName: string; reason: string }[];
    }
  | { success: false; error: string };

export async function approveBDRun(
  runId: string,
  curatedContacts?: Record<string, ApolloContact[]>,
  // Company subset selected in the approval popup, as indexes into the
  // rendered company list. Omitted = enroll every company (back-compat
  // with the pre-popup call site and any caller that wants the whole run).
  selectedIndexes?: number[],
): Promise<ApproveResult> {
  const org = await getCurrentOrg();
  const existing = await prisma.bDRun.findUnique({
    where: { id: runId },
    select: { id: true, organizationId: true, status: true, discoveredPayload: true },
  });
  if (!existing || existing.organizationId !== org.id) {
    return { success: false, error: "Run not found" };
  }
  if (existing.status !== "AWAITING_APPROVAL") {
    return { success: false, error: `Run is ${existing.status}, not awaiting approval` };
  }

  // Normalize curated keys to lowercase company names so the merge is
  // case-insensitive (the component keys by companyName as-rendered).
  const normalizedCurated: Record<string, ApolloContact[]> = {};
  if (curatedContacts) {
    for (const [name, contacts] of Object.entries(curatedContacts)) {
      normalizedCurated[normalizeCompanyKey(name)] = contacts;
    }
  }

  const updateData: { status: "APPROVED"; approvedAt: Date; discoveredPayload?: unknown } = {
    status: "APPROVED",
    approvedAt: new Date(),
  };
  if (Object.keys(normalizedCurated).length > 0) {
    updateData.discoveredPayload = mergeCuratedContactsIntoPayload(
      existing.discoveredPayload,
      normalizedCurated,
    );
  }
  await prisma.bDRun.update({
    where: { id: runId },
    data: updateData as never,
  });
  const result = await enrollCompaniesInApollo(runId, org.id, selectedIndexes);
  revalidatePath("/bd/launch");
  return {
    success: true,
    runId,
    enrolled: result.enrolled,
    capped: result.capped,
    skipped: result.skipped,
  };
}

type DismissResult =
  | { success: true }
  | { success: false; error: string };

export async function dismissBDRun(runId: string): Promise<DismissResult> {
  const org = await getCurrentOrg();
  const existing = await prisma.bDRun.findUnique({
    where: { id: runId },
    select: { id: true, organizationId: true, status: true },
  });
  if (!existing || existing.organizationId !== org.id) {
    return { success: false, error: "Run not found" };
  }
  if (existing.status !== "AWAITING_APPROVAL") {
    return { success: false, error: `Run is ${existing.status}, not awaiting approval` };
  }
  await prisma.bDRun.update({
    where: { id: runId },
    data: { status: "DISMISSED" },
  });
  revalidatePath("/bd/launch");
  return { success: true };
}

type TriggerResult =
  | { success: true; runId: string; discoveredCount: number }
  | { success: false; error: string };

export async function triggerManualDiscovery(opts?: {
  companies?: number;
  maxContactsPerCompany?: number;
}): Promise<TriggerResult> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { success: false, error: "CRON_SECRET not configured" };
  }
  try {
    const h = await headers();
    const host = h.get("host");
    if (!host) return { success: false, error: "Cannot resolve request host" };
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    // Thread the popup's overrides through to the cron as query params.
    // Omitting them (the scheduled cron path) keeps today's defaults.
    const params = new URLSearchParams();
    if (opts?.companies && opts.companies > 0) {
      params.set("companies", String(Math.floor(opts.companies)));
    }
    if (opts?.maxContactsPerCompany && opts.maxContactsPerCompany > 0) {
      params.set("maxContactsPerCompany", String(Math.floor(opts.maxContactsPerCompany)));
    }
    const qs = params.toString();
    const url = `${proto}://${host}/api/cron/bd-discovery${qs ? `?${qs}` : ""}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      runId?: string;
      discoveredCount?: number;
      error?: string;
    };
    if (!res.ok || !data.runId) {
      return { success: false, error: data.error ?? `Discovery failed (HTTP ${res.status})` };
    }
    revalidatePath("/bd/launch");
    return {
      success: true,
      runId: data.runId,
      discoveredCount: typeof data.discoveredCount === "number" ? data.discoveredCount : 0,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Discovery failed" };
  }
}

type DiscoveredCompanyRaw = {
  companyName: string;
  jobTitle: string;
  domain: string;
  jobLocation: string;
  jobPostingUrl: string | null;
  extraRoleCount: number;
  extraRoles: { title: string; url: string | null }[];
  persistedContacts: ApolloContact[];
};

function extractDiscoveredCompaniesRaw(payload: unknown): DiscoveredCompanyRaw[] {
  // Dedup to one entry per company via the shared helper so this list stays
  // index-aligned with the enroll extractor (apollo-enroll.ts) -- the popup's
  // per-company checkbox selection maps to enroll by array index. The primary
  // job's fields are read from `entry.primary` (recovered name/domain handle
  // older runs stored with empty companyName from the provider mapping defect).
  return dedupeDiscoveredByCompany(payload).map((entry) => {
    const obj = entry.primary;
    const jobTitle = typeof obj.jobTitle === "string" ? obj.jobTitle : "";
    const jobLocation =
      typeof obj.jobLocation === "string"
        ? obj.jobLocation
        : typeof obj.job_location === "string"
          ? obj.job_location
          : "";
    // Mirror the enroll extractor's URL resolution so the popup link and
    // the Apollo custom field read the same source field.
    const jobPostingUrl =
      typeof obj.jobPostingUrl === "string"
        ? obj.jobPostingUrl
        : typeof obj.jobUrl === "string"
          ? obj.jobUrl
          : typeof obj.url === "string"
            ? obj.url
            : null;
    return {
      companyName: entry.companyName,
      jobTitle,
      domain: entry.domain,
      jobLocation,
      jobPostingUrl,
      extraRoleCount: entry.extraRoleCount,
      extraRoles: entry.extraRoles,
      persistedContacts: parsePersistedContacts(obj.contacts),
    };
  });
}

function parsePersistedContacts(value: unknown): ApolloContact[] {
  if (!Array.isArray(value)) return [];
  const out: ApolloContact[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const firstName = typeof obj.firstName === "string" ? obj.firstName : "";
    const lastName = typeof obj.lastName === "string" ? obj.lastName : "";
    if (!firstName && !lastName) continue;
    out.push({
      id: typeof obj.id === "string" ? obj.id : `${firstName}-${lastName}`.toLowerCase(),
      // Real Apollo id only when the persisted payload kept one; legacy rows
      // never stored it, so they stay null and fall back to name/domain match.
      apolloId: typeof obj.apolloId === "string" && obj.apolloId.trim() ? obj.apolloId.trim() : null,
      firstName,
      lastName,
      title: typeof obj.title === "string" ? obj.title : "",
      linkedinUrl: typeof obj.linkedinUrl === "string" ? obj.linkedinUrl : null,
    });
  }
  return out;
}

function normalizeCompanyKey(name: string): string {
  return name.trim().toLowerCase();
}

function mergeCuratedContactsIntoPayload(
  payload: unknown,
  curated: Record<string, ApolloContact[]>,
): unknown[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((item) => {
    if (!item || typeof item !== "object") return item;
    const obj = item as Record<string, unknown>;
    const companyName = typeof obj.companyName === "string" ? obj.companyName : "";
    if (!companyName) return obj;
    const key = normalizeCompanyKey(companyName);
    const curatedForCompany = curated[key];
    if (!curatedForCompany) return obj;
    return { ...obj, contacts: curatedForCompany };
  });
}
