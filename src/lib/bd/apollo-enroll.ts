import { prisma } from "@/lib/prisma";
import { getDefaultApolloSequence } from "@/lib/bd/apollo-sequences";

// Cap is enforced against everything enrolled today across the org's
// BDRuns, where "today" is calendar day in America/New_York. The cron
// runs in UTC, so a fixed offset would silently misalign during DST —
// we look up the live offset on each call.
const ZONE = "America/New_York";

// Decision-makers we want Apollo to surface at each target company.
// Order matters loosely (HR-side first because that's who fields BD
// pitches in the verticals we work), but Apollo returns up to per_page
// across all of them without rank-weighting, so this is essentially
// the union we accept.
const TARGET_TITLES = [
  "Head of People",
  "CHRO",
  "VP HR",
  "Head of Talent Acquisition",
  "TA Director",
  "CEO",
  "Founder",
  "Managing Partner",
  "Owner",
];

const APOLLO_BASE = "https://api.apollo.io";

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

type CuratedContact = {
  firstName: string;
  lastName: string;
  title: string;
};

type DiscoveredItem = {
  companyName: string;
  jobTitle: string;
  jobUrl?: string;
  // "City, State" string from the discovery provider (TheirStack/JSearch).
  // Empty string when the payload entry carries no location.
  jobLocation: string;
  // Andrew-curated contact list captured at approval time. When present
  // and non-empty, the enroll loop uses these instead of re-querying
  // Apollo for decision-makers.
  curatedContacts: CuratedContact[];
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
    const jobLocation =
      typeof obj.jobLocation === "string"
        ? obj.jobLocation
        : typeof obj.job_location === "string"
          ? obj.job_location
          : "";
    const curatedContacts: CuratedContact[] = [];
    if (Array.isArray(obj.contacts)) {
      for (const raw of obj.contacts) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        const firstName = typeof r.firstName === "string" ? r.firstName : "";
        const lastName = typeof r.lastName === "string" ? r.lastName : "";
        const title = typeof r.title === "string" ? r.title : "";
        if (!firstName && !lastName) continue;
        curatedContacts.push({ firstName, lastName, title });
      }
    }
    out.push({
      companyName,
      jobTitle,
      jobUrl: rawUrl || undefined,
      jobLocation,
      curatedContacts,
    });
  }
  return out;
}

function formatCuratedContacts(contacts: CuratedContact[]): string {
  if (contacts.length === 0) return "(none)";
  return contacts
    .map((c) => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "(unnamed)";
      return c.title ? `${name} (${c.title})` : name;
    })
    .join(", ");
}

type ApolloPerson = {
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  title?: string;
  organization_name?: string;
};

async function apolloSearchPeople(
  apiKey: string,
  companyName: string,
  perPage: number,
): Promise<ApolloPerson[]> {
  try {
    const res = await fetch(`${APOLLO_BASE}/api/v1/mixed_people/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        q_organization_name: companyName,
        person_titles: TARGET_TITLES,
        per_page: perPage,
      }),
    });
    if (!res.ok) {
      console.warn(
        `[Apollo] people search failed for "${companyName}": ${res.status} ${res.statusText}`,
      );
      return [];
    }
    const data = (await res.json()) as { people?: ApolloPerson[]; contacts?: ApolloPerson[] };
    const people = data.people ?? data.contacts ?? [];
    return Array.isArray(people) ? people : [];
  } catch (err) {
    console.warn(
      `[Apollo] people search threw for "${companyName}":`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

type EnrollPayload = {
  first_name?: string;
  last_name?: string;
  email?: string;
  title?: string;
  organization_name: string;
  // Apollo ignores raw top-level job_* keys; job context must be written
  // as typed_custom_fields keyed by the real Apollo custom field IDs.
  typed_custom_fields: Record<string, string>;
};

async function apolloEnrollContact(
  apiKey: string,
  sequenceId: string,
  payload: EnrollPayload,
): Promise<boolean> {
  try {
    console.log(`[Apollo] typed_custom_fields →`, JSON.stringify(payload.typed_custom_fields));
    const res = await fetch(`${APOLLO_BASE}/api/v1/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        sequence_id: sequenceId,
        ...payload,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[Apollo] enroll contact failed (${payload.organization_name}/${payload.first_name ?? "—"} ${payload.last_name ?? ""}): ${res.status} ${res.statusText} ${text.slice(0, 200)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[Apollo] enroll contact threw:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

export type EnrollResult = { enrolled: number; capped: boolean };

export async function enrollCompaniesInApollo(
  runId: string,
  orgId: string,
): Promise<EnrollResult> {
  const run = await prisma.bDRun.findFirst({
    where: { id: runId, organizationId: orgId },
    select: { id: true, discoveredPayload: true, status: true, maxContactsPerCompany: true },
  });
  if (!run) {
    return { enrolled: 0, capped: false };
  }

  const companies = extractDiscovered(run.discoveredPayload);
  // Per-run override from the "Run Discovery Now" popup; null on the
  // scheduled cron + legacy runs, which keep the original default of 4.
  // The daily-cap clamp below still bounds the total regardless of this.
  const perCompany = run.maxContactsPerCompany ?? 4;

  const orgConfig = await prisma.bdOrgConfig.findUnique({
    where: { organizationId: orgId },
    select: { globalDailyCap: true },
  });
  const dailyCap = orgConfig?.globalDailyCap ?? 80;

  const dayStart = easternMidnightUtc();
  const todaysRuns = await prisma.bDRun.findMany({
    where: {
      organizationId: orgId,
      createdAt: { gte: dayStart },
    },
    select: { enrolledCount: true },
  });
  const enrolledToday = todaysRuns.reduce((sum, r) => sum + (r.enrolledCount ?? 0), 0);
  let remaining = dailyCap - enrolledToday;

  if (remaining <= 0) {
    await prisma.bDRun.update({
      where: { id: run.id },
      data: { status: "COMPLETE", completedAt: new Date() },
    });
    console.log(
      `[Apollo] runId=${run.id} skipped: daily cap (${dailyCap}) already reached (${enrolledToday} enrolled today)`,
    );
    return { enrolled: 0, capped: true };
  }

  const apiKey = process.env.APOLLO_API_KEY;
  // Prefer the explicit APOLLO_SEQUENCE_ID env var (set for staging /
  // one-off overrides); otherwise resolve from apollo-sequences.ts so
  // prod has a single source of truth for the live BD Outbound sequence.
  const sequenceId = process.env.APOLLO_SEQUENCE_ID ?? getDefaultApolloSequence()?.apolloId ?? "";
  if (!apiKey || !sequenceId) {
    console.warn(
      `[Apollo] runId=${run.id} cannot enroll: APOLLO_API_KEY or APOLLO_SEQUENCE_ID unset`,
    );
    // Echo Andrew's curated list per company so the approval flow is
    // verifiable end-to-end even without live Apollo credentials.
    for (const c of companies) {
      console.log(
        `[Apollo stub] Would enroll ${c.companyName}: ${formatCuratedContacts(c.curatedContacts)}`,
      );
    }
    await prisma.bDRun.update({
      where: { id: run.id },
      data: { status: "COMPLETE", completedAt: new Date() },
    });
    return { enrolled: 0, capped: false };
  }

  let enrolledThisRun = 0;

  for (const c of companies) {
    if (remaining <= 0) break;

    // Prefer the curated list Andrew approved on the queue card. Only
    // fall back to a live Apollo people search when the run was approved
    // before this UI shipped (no curated array on the payload entry).
    const people: ApolloPerson[] =
      c.curatedContacts.length > 0
        ? c.curatedContacts.map((cc) => ({
            first_name: cc.firstName || undefined,
            last_name: cc.lastName || undefined,
            title: cc.title || undefined,
            organization_name: c.companyName,
          }))
        : await apolloSearchPeople(apiKey, c.companyName, perCompany);
    // Math.min keeps the daily-cap clamp intact: no matter how high
    // perCompany is, `remaining` (dailyCap - enrolledToday) still bounds
    // how many we enroll, so the global contact cap always holds.
    const candidates = people.slice(0, Math.min(perCompany, remaining));

    // The three job-context values Apollo stores as contact custom
    // fields, keyed by their real Apollo custom field IDs. Identical for
    // every contact enrolled at this company. Keys are always present;
    // jobUrl/jobLocation fall back to "" rather than being omitted.
    const typedCustomFields: Record<string, string> = {
      "6a207e120239f0000c18decd": c.jobTitle,
      "6a207e2290a45c00208eccbb": c.jobUrl ?? "",
      "6a207f8bc3715c0010ae118e": c.jobLocation,
    };

    if (candidates.length > 0) {
      for (const p of candidates) {
        if (remaining <= 0) break;
        const ok = await apolloEnrollContact(apiKey, sequenceId, {
          first_name: p.first_name ?? undefined,
          last_name: p.last_name ?? undefined,
          email: p.email ?? undefined,
          title: p.title ?? undefined,
          organization_name: p.organization_name ?? c.companyName,
          typed_custom_fields: typedCustomFields,
        });
        if (ok) {
          enrolledThisRun += 1;
          remaining -= 1;
          const displayName =
            [p.first_name, p.last_name].filter(Boolean).join(" ") ||
            p.name ||
            "(unnamed)";
          console.log(
            `[Apollo] enrolled ${displayName}: title="${p.title ?? "(none)"}" company="${c.companyName}"`,
          );
        }
      }
    } else {
      // Apollo found no decision-makers — enroll a company-level
      // placeholder so the run still records the BD touch. Apollo's
      // sequence will treat the org_name + title as the address.
      const ok = await apolloEnrollContact(apiKey, sequenceId, {
        organization_name: c.companyName,
        typed_custom_fields: typedCustomFields,
      });
      if (ok) {
        enrolledThisRun += 1;
        remaining -= 1;
        console.log(
          `[Apollo] enrolled company-only placeholder: company="${c.companyName}" job="${c.jobTitle}"`,
        );
      }
    }
  }

  await prisma.bDRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETE",
      enrolledCount: enrolledThisRun,
      completedAt: new Date(),
    },
  });

  if (enrolledThisRun > 0) {
    await prisma.bDActivity.create({
      data: {
        organizationId: orgId,
        bdRunId: run.id,
        kind: "ENROLL",
        metadata: {
          contacts: enrolledThisRun,
          sequenceId,
        },
      },
    });
  }

  const capped = remaining <= 0 && enrolledThisRun + enrolledToday >= dailyCap;
  return { enrolled: enrolledThisRun, capped };
}
