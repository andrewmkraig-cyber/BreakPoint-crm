import { prisma } from "@/lib/prisma";
import { getDefaultApolloSequence } from "@/lib/bd/apollo-sequences";
import { dedupeDiscoveredByCompany } from "@/lib/bd/discovered-company";
import {
  fetchApolloContacts,
  apolloResolveDomainByName,
} from "@/lib/bd/apollo-contacts";

// Cap is enforced against everything enrolled today across the org's
// BDRuns, where "today" is calendar day in America/New_York. The cron
// runs in UTC, so a fixed offset would silently misalign during DST —
// we look up the live offset on each call.
const ZONE = "America/New_York";

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
  // Recovered company domain (provider field or rawPayload). Drives the
  // domain + BD Settings titles people search at enroll when no curated
  // list exists. "" when discovery never captured/resolved one.
  domain: string;
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
  // Dedup to one entry per company via the SAME shared helper the queue
  // serializer uses (bd-run-actions.ts extractDiscoveredCompaniesRaw), so
  // this list stays index-aligned with the approval popup's per-company
  // selection. Each company enrolls once, off the FIRST job (entry.primary).
  return dedupeDiscoveredByCompany(payload).map((entry) => {
    const obj = entry.primary;
    // entry.domain is recoverDomain(obj) — the same recovery the queue uses.
    const domain = entry.domain;
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
    return {
      companyName: entry.companyName,
      domain,
      jobTitle,
      jobUrl: rawUrl || undefined,
      jobLocation,
      curatedContacts,
    };
  });
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

// "City, State" → "City": everything before the first comma, trimmed.
// No comma → the whole string trimmed. The Posting Job City custom field
// holds the city alone, not the full location string.
export function cityOnly(location: string): string {
  const comma = location.indexOf(",");
  return (comma === -1 ? location : location.slice(0, comma)).trim();
}

// Apollo's contact create/update response wraps the record under `contact`.
type ApolloContactResponse = { contact?: { id?: string } };

// Resolves the sending mailbox id required by the add_contact_ids
// (sequence enrollment) endpoint. Prefers the APOLLO_EMAIL_ACCOUNT_ID
// override; otherwise picks the team's default active linked mailbox,
// falling back to the first active one. Never guesses an id.
export async function apolloResolveEmailAccountId(apiKey: string): Promise<string | null> {
  const override = process.env.APOLLO_EMAIL_ACCOUNT_ID;
  if (override) return override;
  try {
    const res = await fetch(`${APOLLO_BASE}/api/v1/email_accounts`, {
      method: "GET",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    });
    if (!res.ok) {
      console.warn(`[Apollo] email_accounts list failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = (await res.json()) as {
      email_accounts?: Array<{ id?: string; active?: boolean; default?: boolean }>;
    };
    const accounts = Array.isArray(data.email_accounts) ? data.email_accounts : [];
    const chosen =
      accounts.find((a) => a.default && a.active) ??
      accounts.find((a) => a.active) ??
      accounts[0];
    return chosen?.id ?? null;
  } catch (err) {
    console.warn(
      `[Apollo] email_accounts list threw:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export type EnrollPayload = {
  first_name?: string;
  last_name?: string;
  email?: string;
  title?: string;
  organization_name: string;
  // Apollo ignores raw top-level job_* keys; job context must be written
  // as typed_custom_fields keyed by the real Apollo custom field IDs.
  typed_custom_fields: Record<string, string>;
};

// Two Apollo calls per contact: (1) create/update the contact WITH the
// typed_custom_fields, capturing the returned contact id; (2) enroll that
// id into the sequence via add_contact_ids. Passing sequence_id on the
// contact-create call does NOT enroll — Apollo ignores it — so the second
// call is mandatory. Both use the X-Api-Key header.
export async function apolloEnrollContact(
  apiKey: string,
  sequenceId: string,
  emailAccountId: string,
  payload: EnrollPayload,
): Promise<boolean> {
  const who = `${payload.organization_name}/${payload.first_name ?? "—"} ${payload.last_name ?? ""}`;
  try {
    console.log(`[Apollo] typed_custom_fields →`, JSON.stringify(payload.typed_custom_fields));

    // 1) Create/update the contact with the custom fields. run_dedupe:true
    //    makes Apollo update an existing contact with the same email instead
    //    of creating a duplicate (the endpoint defaults to false).
    const createRes = await fetch(`${APOLLO_BASE}/api/v1/contacts`, {
      method: "POST",
      // Apollo requires the API key in the X-Api-Key header; passing it in
      // the JSON body is rejected with 422 INVALID_API_KEY_LOCATION.
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify({ ...payload, run_dedupe: true }),
    });
    // Visibility: log call 1's full status + raw JSON body before branching.
    const createRawText = await createRes.text().catch(() => "");
    console.log(
      `[Apollo] create contact response (${who}): status=${createRes.status} ${createRes.statusText} body=${createRawText}`,
    );
    if (!createRes.ok) {
      console.warn(
        `[Apollo] create contact failed (${who}): ${createRes.status} ${createRes.statusText} ${createRawText.slice(0, 200)}`,
      );
      return false;
    }
    const created = JSON.parse(createRawText) as ApolloContactResponse;
    const contactId = created.contact?.id;
    console.log(
      `[Apollo] create contact captured contactId=${contactId ?? "(none)"} (${who})`,
    );
    if (!contactId) {
      console.warn(`[Apollo] create contact returned no contact id (${who})`);
      return false;
    }

    // 2) Enroll the contact into the sequence. This is the call that
    //    actually populates contact_campaign_statuses.
    // This endpoint reads its params from the query string — sending them
    // only in the JSON body yields 422 "Please specify a emailer_campaign_id
    // and send_email_from_email_account_id".
    const enrollUrl = new URL(
      `${APOLLO_BASE}/api/v1/emailer_campaigns/${sequenceId}/add_contact_ids`,
    );
    enrollUrl.searchParams.set("emailer_campaign_id", sequenceId);
    enrollUrl.searchParams.set("send_email_from_email_account_id", emailAccountId);
    enrollUrl.searchParams.append("contact_ids[]", contactId);
    // Visibility: confirm call 2 is firing and against which contact id.
    console.log(
      `[Apollo] sequence enroll firing (${who}, contactId=${contactId}): ${enrollUrl.toString()}`,
    );
    const enrollRes = await fetch(enrollUrl, {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
    });
    // Visibility: log call 2's full status + raw JSON body before branching.
    const enrollRawText = await enrollRes.text().catch(() => "");
    console.log(
      `[Apollo] sequence enroll response (${who}, contactId=${contactId}): status=${enrollRes.status} ${enrollRes.statusText} body=${enrollRawText}`,
    );
    if (!enrollRes.ok) {
      console.warn(
        `[Apollo] sequence enroll failed (${who}, contactId=${contactId}): ${enrollRes.status} ${enrollRes.statusText} ${enrollRawText.slice(0, 200)}`,
      );
      return false;
    }
    console.log(
      `[Apollo] sequence enroll returned ok (${who}, contactId=${contactId})`,
    );
    return true;
  } catch (err) {
    console.warn(
      `[Apollo] enroll contact threw (${who}):`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

// Apollo's people/match response wraps the matched record under `person`.
// With reveal_personal_emails=true the unlocked address lands on `email`;
// personal addresses (when present) come back in `personal_emails`.
type ApolloMatchResponse = {
  person?: {
    email?: string | null;
    personal_emails?: Array<string | null> | null;
  };
};

// Apollo returns the literal "email_not_unlocked@domain.com" sentinel on
// `email` when an address exists on the record but was not actually revealed
// for this request — treat that (and anything without an @) as no email.
function isUsableEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (!e || !e.includes("@")) return false;
  if (e.includes("email_not_unlocked")) return false;
  return true;
}

// Per-contact email reveal. Calls POST /api/v1/people/match with
// reveal_personal_emails=true and returns the revealed address, or null when
// Apollo surfaces no usable email. The API key goes in the X-Api-Key header —
// NEVER the body (Apollo rejects an in-body key with 422
// INVALID_API_KEY_LOCATION, same as the contacts-create call above).
export async function apolloRevealPersonEmail(
  apiKey: string,
  person: { first_name?: string; last_name?: string; organization_name?: string },
  domain: string,
): Promise<string | null> {
  try {
    const body: Record<string, unknown> = { reveal_personal_emails: true };
    if (person.first_name) body.first_name = person.first_name;
    if (person.last_name) body.last_name = person.last_name;
    if (person.organization_name) body.organization_name = person.organization_name;
    if (domain) body.domain = domain;

    const res = await fetch(`${APOLLO_BASE}/api/v1/people/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify(body),
    });
    // Visibility: log the full Apollo response (status + raw JSON body) on
    // every call so reveal behavior is debuggable end-to-end.
    const rawText = await res.text().catch(() => "");
    console.log(
      `[Apollo] people/match response: status=${res.status} ${res.statusText} body=${rawText}`,
    );
    if (!res.ok) {
      console.warn(
        `[Apollo] people/match failed: ${res.status} ${res.statusText} ${rawText.slice(0, 200)}`,
      );
      return null;
    }
    const data = JSON.parse(rawText) as ApolloMatchResponse;
    const direct = data.person?.email;
    if (isUsableEmail(direct)) return direct.trim();
    const personal = Array.isArray(data.person?.personal_emails)
      ? data.person?.personal_emails?.find((e) => isUsableEmail(e))
      : undefined;
    return isUsableEmail(personal) ? personal.trim() : null;
  } catch (err) {
    console.warn(
      `[Apollo] people/match threw:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// Companies that produced no enrollable contact, with the reason, so the
// approval flow can report what was skipped instead of silently writing a
// nameless org-only shell into the sequence.
export type SkippedCompany = { companyName: string; reason: string };

export type EnrollResult = {
  enrolled: number;
  capped: boolean;
  skipped: SkippedCompany[];
};

export async function enrollCompaniesInApollo(
  runId: string,
  orgId: string,
  // Optional company subset chosen in the approval popup. Indexes align
  // with the rendered company list: both this extractor and the queue's
  // extractDiscoveredCompaniesRaw skip only companyName-empty entries, in
  // order, so index i refers to the same company on both sides. Undefined
  // enrolls every company (scheduled cron + legacy + back-compat). An
  // explicit empty array enrolls nothing.
  selectedIndexes?: number[],
): Promise<EnrollResult> {
  const run = await prisma.bDRun.findFirst({
    where: { id: runId, organizationId: orgId },
    select: {
      id: true,
      verticalId: true,
      discoveredPayload: true,
      status: true,
      maxContactsPerCompany: true,
    },
  });
  if (!run) {
    return { enrolled: 0, capped: false, skipped: [] };
  }

  const allCompanies = extractDiscovered(run.discoveredPayload);
  const companies =
    selectedIndexes === undefined
      ? allCompanies
      : allCompanies.filter((_, i) => selectedIndexes.includes(i));
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
    return { enrolled: 0, capped: true, skipped: [] };
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
    return { enrolled: 0, capped: false, skipped: [] };
  }

  // Sequence enrollment needs a sending mailbox id. Resolve once per run.
  const emailAccountId = await apolloResolveEmailAccountId(apiKey);
  if (!emailAccountId) {
    console.warn(
      `[Apollo] runId=${run.id} cannot enroll: no sending mailbox resolved (set APOLLO_EMAIL_ACCOUNT_ID or link a mailbox in Apollo)`,
    );
    await prisma.bDRun.update({
      where: { id: run.id },
      data: { status: "COMPLETE", completedAt: new Date() },
    });
    return { enrolled: 0, capped: false, skipped: [] };
  }

  let enrolledThisRun = 0;
  const skipped: SkippedCompany[] = [];

  for (const c of companies) {
    if (remaining <= 0) break;

    // Per-company visibility counters. peopleReturned is the people-search
    // result count; revealsSucceeded counts usable emails revealed; the
    // reasons array collects every skip (domain, no-matches, reveal failures)
    // so the end-of-company summary line can explain what was dropped and why.
    let peopleReturned = 0;
    let revealsSucceeded = 0;
    const companySkipReasons: string[] = [];
    const logCompanySummary = () =>
      console.log(
        `[Apollo] company summary ${c.companyName}: ` +
          `peopleReturned=${peopleReturned} revealsSucceeded=${revealsSucceeded} ` +
          `skipped=${companySkipReasons.length}` +
          (companySkipReasons.length ? ` (${companySkipReasons.join("; ")})` : ""),
      );

    // Prefer the curated list Andrew approved on the queue card. When there
    // is none (legacy runs, or a company that surfaced no chips because its
    // domain wasn't captured at queue load), run the SAME domain + BD
    // Settings titles search the preview uses (fetchApolloContacts), keyed
    // on the company's domain. Resolve a missing domain from the company
    // name via Apollo first so domain-less firms still get real people.
    // Best-known company domain, used both to find decision-makers and to
    // anchor the per-contact people/match email reveal below. Starts from the
    // discovery payload's domain and is upgraded to the Apollo-resolved one
    // when we have to look it up by name in the else branch.
    let companyDomain = c.domain;
    let people: ApolloPerson[];
    if (c.curatedContacts.length > 0) {
      // Andrew already curated and ordered these — preserve his sequence.
      people = c.curatedContacts.map((cc) => ({
        first_name: cc.firstName || undefined,
        last_name: cc.lastName || undefined,
        title: cc.title || undefined,
        organization_name: c.companyName,
      }));
    } else {
      const domain = c.domain || (await apolloResolveDomainByName(c.companyName));
      if (!domain) {
        // No domain and Apollo couldn't resolve one — there is no reliable
        // way to find this firm's decision-makers, so skip rather than
        // writing a nameless org-only shell into the sequence.
        const reason = "no resolvable domain";
        skipped.push({ companyName: c.companyName, reason });
        console.log(`[Apollo] skipped ${c.companyName}: ${reason}`);
        companySkipReasons.push(reason);
        logCompanySummary();
        continue;
      }
      companyDomain = domain;
      const contacts = await fetchApolloContacts(
        domain,
        orgId,
        run.verticalId ?? undefined,
        perCompany,
      );
      people = contacts.map((ct) => ({
        first_name: ct.firstName || undefined,
        last_name: ct.lastName || undefined,
        title: ct.title || undefined,
        organization_name: c.companyName,
      }));
    }

    // People-search result count, for the per-company summary line.
    peopleReturned = people.length;

    // Math.min keeps the daily-cap clamp intact: no matter how high
    // perCompany is, `remaining` (dailyCap - enrolledToday) still bounds
    // how many we enroll, so the global contact cap always holds.
    const candidates = people.slice(0, Math.min(perCompany, remaining));

    if (candidates.length === 0) {
      // People search returned nobody matching the BD Settings titles.
      // Skip (no nameless shell) and record why so it surfaces post-run.
      const reason = "no decision-makers matched BD Settings titles";
      skipped.push({ companyName: c.companyName, reason });
      console.log(`[Apollo] skipped ${c.companyName}: ${reason}`);
      companySkipReasons.push(reason);
      logCompanySummary();
      continue;
    }

    // The three job-context values Apollo stores as contact custom
    // fields, keyed by their real Apollo custom field IDs. Identical for
    // every contact enrolled at this company. Keys are always present;
    // jobUrl/jobLocation fall back to "" rather than being omitted.
    const typedCustomFields: Record<string, string> = {
      "6a207e120239f0000c18decd": c.jobTitle,
      "6a207e2290a45c00208eccbb": c.jobUrl ?? "",
      "6a207f8bc3715c0010ae118e": cityOnly(c.jobLocation),
    };

    for (const p of candidates) {
      if (remaining <= 0) break;

      // Reveal a real email before creating the contact. Apollo's people
      // SEARCH results don't carry an unlocked email; without one the
      // sequence has nothing to send to, so a contact with no usable revealed
      // email is skipped (it never counts against the daily cap because
      // `remaining` only decrements on a successful enroll below).
      const revealedEmail = await apolloRevealPersonEmail(apiKey, p, companyDomain);
      if (!revealedEmail) {
        const who =
          [p.first_name, p.last_name].filter(Boolean).join(" ") ||
          p.name ||
          "(unnamed)";
        const reason = `email reveal returned no usable email for ${who}`;
        skipped.push({ companyName: c.companyName, reason });
        console.log(`[Apollo] skipped ${c.companyName}: ${reason}`);
        companySkipReasons.push(reason);
        continue;
      }
      revealsSucceeded += 1;

      const ok = await apolloEnrollContact(apiKey, sequenceId, emailAccountId, {
        first_name: p.first_name ?? undefined,
        last_name: p.last_name ?? undefined,
        email: revealedEmail,
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

    // One-line per-company summary: search size, reveals that succeeded, and
    // every skip with its reason. Visibility only — does not alter enrollment.
    logCompanySummary();
  }

  await prisma.bDRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETE",
      enrolledCount: enrolledThisRun,
      completedAt: new Date(),
    },
  });

  // Record the run outcome whenever there's anything to report — enrolled
  // contacts and/or skipped companies (with reasons) — so the skips are
  // queryable after the fact instead of vanishing.
  if (enrolledThisRun > 0 || skipped.length > 0) {
    await prisma.bDActivity.create({
      data: {
        organizationId: orgId,
        bdRunId: run.id,
        kind: "ENROLL",
        metadata: {
          contacts: enrolledThisRun,
          sequenceId,
          skipped,
        },
      },
    });
  }

  const capped = remaining <= 0 && enrolledThisRun + enrolledToday >= dailyCap;
  return { enrolled: enrolledThisRun, capped, skipped };
}
