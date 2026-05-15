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
  history: SerializedOutreachHistory;
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
  const histories = await Promise.all(
    allCompanies.map((c) =>
      getCompanyOutreachHistory({ domain: c.domain, companyName: c.companyName }, org.id),
    ),
  );
  const historyByCompany = new Map<string, CompanyOutreachHistory>();
  allCompanies.forEach((c, i) => {
    historyByCompany.set(companyKey(c.companyName, c.domain), histories[i]);
  });

  return rawRuns.map((r) => ({
    id: r.id,
    discoveredCount: r.discoveredCount,
    discoveredPayload: r.companies.map((c) => {
      const h = historyByCompany.get(companyKey(c.companyName, c.domain)) ?? {
        runCount: 0,
        contactsTriedTotal: 0,
        lastOutreachAt: null,
      };
      return {
        companyName: c.companyName,
        jobTitle: c.jobTitle,
        domain: c.domain,
        history: {
          runCount: h.runCount,
          contactsTriedTotal: h.contactsTriedTotal,
          lastOutreachAt: h.lastOutreachAt ? h.lastOutreachAt.toISOString() : null,
        },
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
  | { success: true; runId: string; enrolled: number; capped: boolean }
  | { success: false; error: string };

export async function approveBDRun(runId: string): Promise<ApproveResult> {
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
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  const result = await enrollCompaniesInApollo(runId, org.id);
  revalidatePath("/bd/launch");
  return { success: true, runId, enrolled: result.enrolled, capped: result.capped };
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

export async function triggerManualDiscovery(): Promise<TriggerResult> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { success: false, error: "CRON_SECRET not configured" };
  }
  try {
    const h = await headers();
    const host = h.get("host");
    if (!host) return { success: false, error: "Cannot resolve request host" };
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    const url = `${proto}://${host}/api/cron/bd-discovery`;

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
};

function extractDiscoveredCompaniesRaw(payload: unknown): DiscoveredCompanyRaw[] {
  if (!Array.isArray(payload)) return [];
  const out: DiscoveredCompanyRaw[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const companyName = typeof obj.companyName === "string" ? obj.companyName : "";
    const jobTitle = typeof obj.jobTitle === "string" ? obj.jobTitle : "";
    const domain = typeof obj.domain === "string" ? obj.domain : "";
    if (companyName) out.push({ companyName, jobTitle, domain });
  }
  return out;
}
