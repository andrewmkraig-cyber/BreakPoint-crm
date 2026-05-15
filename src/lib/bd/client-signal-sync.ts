// Nightly scan of existing Client records against TheirStack. Distinct
// from the BD discovery cron, which only routes client-matched
// discovery hits into ClientSignal. This helper independently asks
// TheirStack "does this client have any public job postings right now?"
// for every Client with a usable domain, and upserts a ClientSignal row
// per posting with source="CLIENT_MONITOR".
//
// Called from /api/cron/bd-discovery alongside the discovery loop so we
// get one daily morning sweep without a second cron schedule.

import { prisma } from "@/lib/prisma";

const THEIRSTACK_ENDPOINT = "https://api.theirstack.com/v1/jobs/search";

type TheirStackJob = {
  company_name?: string;
  company?: { name?: string; domain?: string };
  job_title?: string;
  title?: string;
  job_location?: string;
  location?: string;
  url?: string;
  job_url?: string;
  apply_url?: string;
  date_posted?: string;
  posted_at?: string;
  [key: string]: unknown;
};

function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim() || null;
}

async function fetchClientPostings(
  apiKey: string,
  domain: string,
): Promise<TheirStackJob[]> {
  const res = await fetch(THEIRSTACK_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      company_domain_or: [domain],
      limit: 10,
    }),
  });
  if (!res.ok) return [];
  const payload = (await res.json().catch(() => null)) as
    | { data?: TheirStackJob[] }
    | TheirStackJob[]
    | null;
  if (!payload) return [];
  const rows = Array.isArray(payload) ? payload : payload.data;
  return Array.isArray(rows) ? rows : [];
}

export type SyncClientSignalsResult = {
  clientsScanned: number;
  postingsUpserted: number;
  skipped: number;
};

export async function syncClientSignals(
  organizationId: string,
): Promise<SyncClientSignalsResult> {
  const apiKey = process.env.THEIRSTACK_API_KEY;
  if (!apiKey) {
    return { clientsScanned: 0, postingsUpserted: 0, skipped: 0 };
  }

  const clients = await prisma.client.findMany({
    where: { organizationId },
    select: { id: true, name: true, domain: true },
  });

  let clientsScanned = 0;
  let postingsUpserted = 0;
  let skipped = 0;
  const now = new Date();

  for (const client of clients) {
    const domain = normalizeDomain(client.domain);
    if (!domain) {
      skipped += 1;
      continue;
    }
    clientsScanned += 1;
    let postings: TheirStackJob[] = [];
    try {
      postings = await fetchClientPostings(apiKey, domain);
    } catch (err) {
      console.warn(
        `[client-signal-sync] TheirStack fetch failed for client=${client.name} domain=${domain}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    for (const p of postings) {
      const jobTitle = (p.job_title ?? p.title ?? "").trim();
      if (!jobTitle) continue;
      const companyName = (p.company_name ?? p.company?.name ?? client.name).trim();
      const jobLocation = (p.job_location ?? p.location ?? "").trim() || null;
      const jobPostingUrl = p.url ?? p.job_url ?? p.apply_url ?? null;
      const postedAtRaw = p.date_posted ?? p.posted_at ?? null;
      const postedAt =
        typeof postedAtRaw === "string" && !Number.isNaN(Date.parse(postedAtRaw))
          ? new Date(postedAtRaw)
          : null;

      try {
        await prisma.clientSignal.upsert({
          where: {
            organizationId_companyName_jobTitle: {
              organizationId,
              companyName,
              jobTitle,
            },
          },
          update: {
            jobLocation,
            jobPostingUrl,
            postedAt: postedAt ?? undefined,
            clientId: client.id,
            raw: (p as object) ?? undefined,
            lastSeenAt: now,
          },
          create: {
            organizationId,
            companyName,
            clientId: client.id,
            jobTitle,
            jobLocation,
            jobPostingUrl,
            postedAt,
            raw: (p as object) ?? undefined,
            source: "CLIENT_MONITOR",
            lastSeenAt: now,
          },
        });
        postingsUpserted += 1;
      } catch (err) {
        console.error(
          `[client-signal-sync] upsert failed for ${companyName} / ${jobTitle}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return { clientsScanned, postingsUpserted, skipped };
}
