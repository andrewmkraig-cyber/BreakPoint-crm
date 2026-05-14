"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { enrollCompaniesInApollo } from "@/lib/bd/apollo-enroll";

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
  return rows.map((r) => ({
    id: r.id,
    discoveredCount: r.discoveredCount,
    discoveredPayload: extractDiscoveredCompanies(r.discoveredPayload),
    createdAt: r.createdAt.toISOString(),
    discoveryProvider: r.discoveryProvider,
  }));
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

function extractDiscoveredCompanies(payload: unknown): DiscoveredCompanyLite[] {
  if (!Array.isArray(payload)) return [];
  const out: DiscoveredCompanyLite[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const companyName = typeof obj.companyName === "string" ? obj.companyName : "";
    const jobTitle = typeof obj.jobTitle === "string" ? obj.jobTitle : "";
    if (companyName) out.push({ companyName, jobTitle });
  }
  return out;
}
