import { prisma } from "@/lib/prisma";

// Cap is enforced against everything enrolled today across the org's
// BDRuns, where "today" is calendar day in America/New_York. The cron
// runs in UTC, so a fixed offset would silently misalign during DST —
// we look up the live offset on each call.
const ZONE = "America/New_York";
const DAILY_ENROLL_CAP = 75;

function easternMidnightUtc(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = ymd.split("-").map(Number);
  const placeholder = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offsetToken =
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      timeZoneName: "shortOffset",
      hour: "2-digit",
    })
      .formatToParts(placeholder)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const match = offsetToken.match(/GMT([+-])(\d+)(?::(\d+))?/);
  const sign = match && match[1] === "+" ? 1 : -1;
  const hours = match ? Number(match[2]) : 5;
  const mins = match && match[3] ? Number(match[3]) : 0;
  const offsetMinutes = sign * (hours * 60 + mins);
  return new Date(placeholder.getTime() - offsetMinutes * 60_000);
}

type DiscoveredItem = {
  companyName: string;
  jobTitle: string;
  jobUrl?: string;
};

function extractDiscovered(payload: unknown): DiscoveredItem[] {
  if (!Array.isArray(payload)) return [];
  const out: DiscoveredItem[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const companyName = typeof obj.companyName === "string" ? obj.companyName : "";
    if (!companyName) continue;
    const jobTitle = typeof obj.jobTitle === "string" ? obj.jobTitle : "";
    const rawUrl =
      typeof obj.jobUrl === "string"
        ? obj.jobUrl
        : typeof obj.url === "string"
          ? obj.url
          : typeof obj.jobPostingUrl === "string"
            ? obj.jobPostingUrl
            : "";
    out.push({ companyName, jobTitle, jobUrl: rawUrl || undefined });
  }
  return out;
}

export type EnrollResult = { enrolled: number; capped: boolean };

export async function enrollCompaniesInApollo(
  runId: string,
  orgId: string,
): Promise<EnrollResult> {
  const run = await prisma.bDRun.findFirst({
    where: { id: runId, organizationId: orgId },
    select: { id: true, discoveredPayload: true, status: true },
  });
  if (!run) {
    return { enrolled: 0, capped: false };
  }

  const companies = extractDiscovered(run.discoveredPayload);

  const dayStart = easternMidnightUtc();
  const todaysRuns = await prisma.bDRun.findMany({
    where: {
      organizationId: orgId,
      createdAt: { gte: dayStart },
    },
    select: { enrolledCount: true },
  });
  const enrolledToday = todaysRuns.reduce((sum, r) => sum + (r.enrolledCount ?? 0), 0);
  const remaining = DAILY_ENROLL_CAP - enrolledToday;

  if (remaining <= 0) {
    await prisma.bDRun.update({
      where: { id: run.id },
      data: { status: "COMPLETE", completedAt: new Date() },
    });
    console.log(
      `[Apollo stub] runId=${run.id} skipped — daily cap (${DAILY_ENROLL_CAP}) already reached (${enrolledToday} enrolled today)`,
    );
    return { enrolled: 0, capped: true };
  }

  const sequenceId = process.env.APOLLO_SEQUENCE_ID ?? "(APOLLO_SEQUENCE_ID unset)";
  const toEnroll = companies.slice(0, remaining);

  for (const c of toEnroll) {
    console.log(
      `[Apollo stub] Would enroll ${c.companyName} into sequence ${sequenceId} — title="${c.jobTitle}" url="${c.jobUrl ?? "(none)"}"`,
    );
  }
  console.log(
    `[Apollo stub] runId=${run.id} would enroll ${toEnroll.length} companies into sequence ${sequenceId} (remaining capacity ${remaining}, ${enrolledToday} already enrolled today)`,
  );

  await prisma.bDRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETE",
      enrolledCount: toEnroll.length,
      completedAt: new Date(),
    },
  });

  if (toEnroll.length > 0) {
    await prisma.bDActivity.create({
      data: {
        organizationId: orgId,
        bdRunId: run.id,
        kind: "ENROLL",
        metadata: {
          contacts: toEnroll.length,
          sequenceId,
          stub: true,
        },
      },
    });
  }

  return { enrolled: toEnroll.length, capped: false };
}
