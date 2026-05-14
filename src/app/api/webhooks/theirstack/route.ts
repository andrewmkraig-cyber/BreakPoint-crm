import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { DiscoveredCompany } from "@/lib/bd/job-discovery-provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BIG4_AND_CONSULTING = [
  "Deloitte",
  "PwC",
  "Ernst & Young",
  "EY",
  "KPMG",
  "Accenture",
];

const STAFFING_KEYWORDS = [
  "Staffing",
  "Recruiting",
  "Talent",
  "Search Group",
  "Search Firm",
  "Placement",
  "Headhunt",
];

const MIN_HEADCOUNT = 10;
const MAX_HEADCOUNT = 300;
const DEDUP_WINDOW_DAYS = 30;

// Mirrors bd-discovery cron. Kept inline (not shared) so changes to the
// cron's filter list never silently rewire the webhook.
const CLIENT_SUFFIX_PATTERNS = [
  /\s*&\s*associates\b/i,
  /\bp\s*l\s*l\s*c\b\.?/i,
  /\bllp\b\.?/i,
  /\bllc\b\.?/i,
  /\binc\b\.?/i,
  /\bpc\b\.?/i,
  /\bco\b\.?/i,
];

function normalizeClientName(name: string): string {
  let s = name.toLowerCase().trim();
  for (const pat of CLIENT_SUFFIX_PATTERNS) {
    s = s.replace(pat, "");
  }
  s = s.replace(/[.,]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

function isExcludedByClients(companyName: string, clientNorms: string[]): boolean {
  const norm = normalizeClientName(companyName);
  if (!norm) return false;
  for (const client of clientNorms) {
    if (!client) continue;
    if (norm.includes(client) || client.includes(norm)) return true;
  }
  return false;
}

function nameMatchesAny(name: string, keywords: string[]): boolean {
  const lower = name.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function fingerprint(companyName: string, jobTitle: string): string {
  return `${companyName.trim().toLowerCase()}|${jobTitle.trim().toLowerCase()}`;
}

// TheirStack may send the signature as either bare hex or "sha256=<hex>".
// Accept either form; reject everything else.
function extractSignatureHex(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const stripped = trimmed.startsWith("sha256=") ? trimmed.slice(7) : trimmed;
  if (!/^[a-f0-9]+$/i.test(stripped)) return null;
  return stripped.toLowerCase();
}

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  const provided = extractSignatureHex(header);
  if (!provided) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.THEIRSTACK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[theirstack-webhook] THEIRSTACK_WEBHOOK_SECRET not set");
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-theirstack-signature-256");
  if (!verifySignature(rawBody, sigHeader, secret)) {
    console.warn("[theirstack-webhook] signature mismatch");
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.warn("[theirstack-webhook] invalid json body");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const eventType = typeof parsed.event_type === "string" ? parsed.event_type : "";
  if (eventType !== "job.new") {
    console.log(`[theirstack-webhook] ignored event_type=${eventType || "(missing)"}`);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const job =
    parsed.job && typeof parsed.job === "object"
      ? (parsed.job as Record<string, unknown>)
      : null;
  if (!job) {
    console.warn("[theirstack-webhook] job.new event missing job payload");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const jobTitle = typeof job.title === "string" ? job.title.trim() : "";
  const companyName =
    typeof job.company_name === "string" ? job.company_name.trim() : "";
  const companyDomain =
    typeof job.company_domain === "string" ? job.company_domain.trim() : "";
  const jobLocation =
    typeof job.location === "string" ? job.location.trim() : "";
  const jobUrl = typeof job.url === "string" ? job.url.trim() : "";
  const employeeCountRaw = job.employee_count;
  let employeeCount: number | null = null;
  if (typeof employeeCountRaw === "number" && Number.isFinite(employeeCountRaw)) {
    employeeCount = employeeCountRaw;
  } else if (typeof employeeCountRaw === "string") {
    const n = Number(employeeCountRaw);
    if (Number.isFinite(n)) employeeCount = n;
  }

  if (!companyName || !jobTitle) {
    console.warn(
      `[theirstack-webhook] missing required fields: companyName="${companyName}" jobTitle="${jobTitle}"`,
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (
    nameMatchesAny(companyName, BIG4_AND_CONSULTING) ||
    nameMatchesAny(companyName, STAFFING_KEYWORDS)
  ) {
    console.log(
      `[theirstack-webhook] filtered: big4/staffing match company="${companyName}"`,
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (employeeCount != null && (employeeCount < MIN_HEADCOUNT || employeeCount > MAX_HEADCOUNT)) {
    console.log(
      `[theirstack-webhook] filtered: headcount=${employeeCount} out of range company="${companyName}"`,
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let organizationId = process.env.ORG_ID;
  if (!organizationId) {
    const firstOrg = await prisma.organization.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    organizationId = firstOrg?.id;
  }
  if (!organizationId) {
    console.error("[theirstack-webhook] no organization resolved");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const clients = await prisma.client.findMany({
    where: { organizationId },
    select: { name: true },
  });
  const clientNormSet = new Set<string>();
  for (const c of clients) {
    const norm = normalizeClientName(c.name);
    if (norm) clientNormSet.add(norm);
  }
  if (isExcludedByClients(companyName, Array.from(clientNormSet))) {
    console.log(
      `[theirstack-webhook] filtered: matches existing client company="${companyName}"`,
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const windowStart = new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentRuns = await prisma.bDRun.findMany({
    where: { organizationId, createdAt: { gte: windowStart } },
    select: { discoveredPayload: true },
  });
  const fp = fingerprint(companyName, jobTitle);
  for (const r of recentRuns) {
    const payload = r.discoveredPayload;
    if (!Array.isArray(payload)) continue;
    for (const item of payload) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const name = typeof obj.companyName === "string" ? obj.companyName : "";
      const title = typeof obj.jobTitle === "string" ? obj.jobTitle : "";
      if (name && title && fingerprint(name, title) === fp) {
        console.log(
          `[theirstack-webhook] dedup hit: company="${companyName}" title="${jobTitle}"`,
        );
        return NextResponse.json({ ok: true }, { status: 200 });
      }
    }
  }

  const discovered: DiscoveredCompany = {
    companyName,
    domain: companyDomain,
    jobTitle,
    jobLocation,
    jobPostingUrl: jobUrl || undefined,
    source: "theirstack-webhook",
    rawPayload: job,
  };

  const now = new Date();
  const run = await prisma.bDRun.create({
    data: {
      organizationId,
      status: "AWAITING_APPROVAL",
      discoveryProvider: "theirstack-webhook",
      discoveredCount: 1,
      discoveredPayload: [discovered] as unknown as object[],
      startedAt: now,
      completedAt: now,
    },
  });

  console.log(
    `[theirstack-webhook] created runId=${run.id} company="${companyName}" title="${jobTitle}"`,
  );

  return NextResponse.json({ ok: true }, { status: 200 });
}
