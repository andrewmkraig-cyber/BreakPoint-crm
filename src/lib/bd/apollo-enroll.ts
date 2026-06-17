import { prisma } from "@/lib/prisma";
import {
  getDefaultApolloSequence,
  getApolloSequenceByName,
  getApolloSequenceById,
} from "@/lib/bd/apollo-sequences";
import { dedupeDiscoveredByCompany } from "@/lib/bd/discovered-company";
import {
  fetchApolloContacts,
  apolloResolveDomainByName,
} from "@/lib/bd/apollo-contacts";
import { fetchApolloMailboxes } from "@/lib/bd/apollo-email-accounts";

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
  // Genuine Apollo person id recovered from the persisted payload, when one
  // exists. Drives the same documented people/match match-by-id the search
  // path uses; "" when no real id was stored (curated chips that never
  // carried one, or legacy rows whose id field is a synthetic name slug).
  apolloId: string;
};

// Apollo person ids are 24-char hex (Mongo ObjectId style), e.g.
// "6a06068f8142ee001d2b3dd2". The persisted `id` field on a contact holds
// EITHER a real Apollo id like that OR a synthetic "first-last-title" slug
// (the apollo-contacts.ts fallback when the search result carried no id) —
// only the former is a valid people/match id, so legacy rows are checked
// against this before their id is reused.
function isApolloPersonId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value);
}

// Apollo sequence (emailer_campaign) ids are 24-char hex, the same shape as
// person/contact ids. A saved-search "handle" that isn't one of these (e.g.
// the human name "Great Neck BD" that never mapped to a row) must NEVER be
// sent as emailer_campaign_id — that is the silent-zero failure.
function isApolloSequenceId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value.trim());
}

// The saved search persists its mapped sequence under criteria.apolloSequenceId
// as a NAME string (the dropdown stores names), or occasionally a raw id.
function sequenceHandleFromCriteria(criteria: unknown): string | null {
  if (!criteria || typeof criteria !== "object") return null;
  const value = (criteria as Record<string, unknown>).apolloSequenceId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Resolves the real Apollo sequence id (emailer_campaign_id) for a run,
// preferring the run's saved-search mapping over the env/default so a
// self-serve, table-only sequence ("Great Neck BD") enrolls into its own
// Apollo sequence:
//   1) saved search criteria handle -> self-serve BdSequence table (by name,
//      then by raw id), scoped to the org + active mappings;
//   2) -> hardcoded apollo-sequences.ts (by name/alias, then by id);
//   3) APOLLO_SEQUENCE_ID env override, then the default sequence — the
//      org-wide cron / no-saved-search path, unchanged from before.
// The returned value is validated by the caller's guard before use.
async function resolveRunSequenceId(orgId: string, criteria: unknown): Promise<string> {
  const handle = sequenceHandleFromCriteria(criteria);
  if (handle) {
    // Table first, matched by the mapping name.
    const byName = await prisma.bdSequence.findFirst({
      where: { organizationId: orgId, name: handle, active: true },
      select: { apolloSequenceId: true },
    });
    if (byName && isApolloSequenceId(byName.apolloSequenceId)) return byName.apolloSequenceId;
    // Table, matched when the handle is itself a raw Apollo id.
    if (isApolloSequenceId(handle)) {
      const byId = await prisma.bdSequence.findFirst({
        where: { organizationId: orgId, apolloSequenceId: handle, active: true },
        select: { apolloSequenceId: true },
      });
      if (byId && isApolloSequenceId(byId.apolloSequenceId)) return byId.apolloSequenceId;
    }
    // Hardcoded fallback (covers the built-in "Tax BD Sequence" + aliases).
    const hard = getApolloSequenceByName(handle) ?? getApolloSequenceById(handle);
    if (hard && isApolloSequenceId(hard.apolloId)) return hard.apolloId;
  }
  // No resolvable saved-search mapping: keep the original env -> default path.
  return process.env.APOLLO_SEQUENCE_ID ?? getDefaultApolloSequence()?.apolloId ?? "";
}

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
        // Recover the real Apollo person id end to end. New persisted rows
        // store it under `apolloId`; legacy rows only ever had `id`, which is
        // usable only when it's a genuine Apollo id (not the synthetic slug).
        const apolloIdRaw = typeof r.apolloId === "string" ? r.apolloId.trim() : "";
        const idRaw = typeof r.id === "string" ? r.id.trim() : "";
        const apolloId =
          apolloIdRaw || (isApolloPersonId(idRaw) ? idRaw : "");
        curatedContacts.push({ firstName, lastName, title, apolloId });
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
  // Genuine Apollo person id from the people-search result, when one exists.
  // Drives the documented people/match match-by-id; absent on curated
  // contacts (the stored payload never kept it), which fall back to name/domain.
  id?: string;
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
// With run_dedupe:true a RETURNING contact comes back with its existing
// sequence memberships, which we use for idempotency: `emailer_campaign_ids`
// (flat id list) and/or `contact_campaign_statuses` (per-campaign status rows).
type ApolloContactResponse = {
  contact?: {
    id?: string;
    emailer_campaign_ids?: string[];
    contact_campaign_statuses?: Array<{ emailer_campaign_id?: string; status?: string }>;
  };
};

// True when the contact is ALREADY associated with `sequenceId` in Apollo, so
// re-adding it would double-enroll. Conservative: any presence (in either
// shape) counts, so a re-run never re-enrolls a contact already in the
// sequence. This is the idempotency guard for the timeout-retry path.
function contactAlreadyInSequence(
  contact: ApolloContactResponse["contact"],
  sequenceId: string,
): boolean {
  if (!contact) return false;
  const ids = Array.isArray(contact.emailer_campaign_ids) ? contact.emailer_campaign_ids : [];
  if (ids.includes(sequenceId)) return true;
  const statuses = Array.isArray(contact.contact_campaign_statuses)
    ? contact.contact_campaign_statuses
    : [];
  return statuses.some((s) => s?.emailer_campaign_id === sequenceId);
}

// Outcome of one enroll attempt. "enrolled" = a NEW add to the sequence;
// "already" = the contact was already in the sequence (idempotent skip, not a
// new enroll, must not count against the cap); "failed" = the call errored.
export type EnrollOutcome = "enrolled" | "already" | "failed";

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

// Resolves the FULL set of sending mailbox ids to hand Apollo on the
// add_contact_ids call. Apollo only sets mailbox rotation at the moment
// contacts are added to a sequence, so passing every healthy mailbox here is
// what lets it rotate sends across them instead of pinning one.
//   - APOLLO_EMAIL_ACCOUNT_ID override (when set) always wins and pins that
//     single mailbox — same escape hatch the single resolver honors.
//   - Otherwise reuse the same email_accounts fetch the Sending Domains UI
//     uses (fetchApolloMailboxes), keeping only mailboxes that are Connected,
//     have sending enabled (not sendingDisabled), and carry a real id.
//   - If that surfaces zero healthy mailboxes (or the list call failed), fall
//     back to the single-mailbox resolver so enrollment still works as before.
// Never guesses an id. Returns [] only when no mailbox can be resolved at all.
export async function apolloResolveSendingMailboxIds(apiKey: string): Promise<string[]> {
  const override = process.env.APOLLO_EMAIL_ACCOUNT_ID;
  if (override) return [override];

  const mailboxes = await fetchApolloMailboxes();
  if (mailboxes && mailboxes.length > 0) {
    const healthy = mailboxes
      .filter((m) => m.status === "Connected" && !m.sendingDisabled && m.id)
      .map((m) => m.id);
    if (healthy.length > 0) return healthy;
    // All mailboxes resolved but NONE are healthy (Connected + sending-enabled
    // + a real id). Make that explicit — otherwise the fall-through to the
    // single resolver silently hides the fact that rotation has no healthy
    // mailbox, which can leave the add_contact_ids call pointing at a mailbox
    // Apollo refuses to send from (a phantom-success cause above).
    console.warn(
      `[Apollo] all ${mailboxes.length} mailbox(es) unhealthy (Connected + sending-enabled + id = 0): ` +
        mailboxes
          .map(
            (m) =>
              `${m.email}[status=${m.status}${m.sendingDisabled ? ",sendingDisabled" : ""}${m.id ? "" : ",no-id"}]`,
          )
          .join(", ") +
        ` — falling back to single email-account resolver`,
    );
  }

  const single = await apolloResolveEmailAccountId(apiKey);
  return single ? [single] : [];
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
  // One or more sending mailbox ids. A single id pins that mailbox (legacy
  // behavior); multiple ids enable Apollo's mailbox rotation across them.
  emailAccountIds: string[],
  payload: EnrollPayload,
): Promise<EnrollOutcome> {
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
      return "failed";
    }
    const created = JSON.parse(createRawText) as ApolloContactResponse;
    const contactId = created.contact?.id;
    console.log(
      `[Apollo] create contact captured contactId=${contactId ?? "(none)"} (${who})`,
    );
    if (!contactId) {
      console.warn(`[Apollo] create contact returned no contact id (${who})`);
      return "failed";
    }

    // Idempotency: if run_dedupe returned an EXISTING contact already in this
    // sequence, do NOT call add_contact_ids again — that would double-enroll.
    // This is what lets a timed-out batch be re-run safely: contacts enrolled
    // on the first pass are skipped on the retry.
    if (contactAlreadyInSequence(created.contact, sequenceId)) {
      console.log(
        `[Apollo] idempotent skip (${who}, contactId=${contactId}): already in sequence ${sequenceId}`,
      );
      return "already";
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
    // Apollo's add_contact_ids endpoint sets mailbox rotation HERE and only
    // here. One mailbox → pin it with the scalar param (legacy behavior).
    // Multiple → repeat the SAME unbracketed key once per mailbox id
    // (send_email_from_email_account_id=A&send_email_from_email_account_id=B…).
    // Apollo expects the mailbox key WITHOUT brackets; the bracketed form
    // (send_email_from_email_account_id[]) 422s "missing mailbox" and adds
    // nobody. Note contact_ids[] below IS bracketed — only the mailbox key is not.
    if (emailAccountIds.length === 1) {
      enrollUrl.searchParams.set("send_email_from_email_account_id", emailAccountIds[0]);
    } else {
      for (const id of emailAccountIds) {
        enrollUrl.searchParams.append("send_email_from_email_account_id", id);
      }
    }
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
      return "failed";
    }
    // Surface a PHANTOM success: Apollo can return 2xx while adding ZERO
    // contacts to the sequence (an invalid/Disabled sending mailbox for this
    // campaign, the contact already terminal in it, etc.). A 200 here is NOT
    // proof the contact landed — the body is the only signal. When it clearly
    // shows nothing was added (an empty `contacts` array), log loudly so a
    // "created the people but the sequence stays empty" run is visible instead
    // of being counted as a real enroll. Non-behavioral: we still return true
    // on 2xx (the success body shape varies, so we never downgrade a real
    // enroll on an unrecognized shape — we only flag the unambiguous zero case).
    try {
      const enrollBody = JSON.parse(enrollRawText) as { contacts?: unknown[] };
      if (Array.isArray(enrollBody.contacts) && enrollBody.contacts.length === 0) {
        // 2xx with an empty `contacts` array = nothing was added. The common
        // cause is the contact already being terminal/active in the sequence
        // (which our membership check above usually catches first); a Disabled
        // sending mailbox can also cause it. Either way it is NOT a new enroll,
        // so report "already" rather than counting a phantom success.
        console.warn(
          `[Apollo] sequence enroll returned 2xx but added ZERO contacts (${who}, contactId=${contactId}) — treating as already-enrolled / not added. Check the sending mailbox is valid for this campaign. Body=${enrollRawText.slice(0, 400)}`,
        );
        return "already";
      }
    } catch {
      // Body wasn't JSON we recognize; the full raw body was already logged above.
    }
    console.log(
      `[Apollo] sequence enroll returned ok (${who}, contactId=${contactId})`,
    );
    return "enrolled";
  } catch (err) {
    console.warn(
      `[Apollo] enroll contact threw (${who}):`,
      err instanceof Error ? err.message : err,
    );
    return "failed";
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
  person: { id?: string; first_name?: string; last_name?: string; organization_name?: string },
  domain: string,
): Promise<string | null> {
  try {
    // Match params stay in the JSON body. Apollo's documented match-by-id is
    // the most precise: when we have the person's Apollo id, send it alone —
    // name/organization/domain only narrow an already-exact match. Name/domain
    // are the fallback used only when no id exists (e.g. curated contacts).
    const body: Record<string, unknown> = {};
    if (person.id) {
      body.id = person.id;
    } else {
      if (person.first_name) body.first_name = person.first_name;
      if (person.last_name) body.last_name = person.last_name;
      if (person.organization_name) body.organization_name = person.organization_name;
      if (domain) body.domain = domain;
    }

    // Reveal flags must travel as query-string params on the people/match URL,
    // not in the JSON body — Apollo only honors them in the query string.
    const matchUrl = `${APOLLO_BASE}/api/v1/people/match?reveal_personal_emails=true`;
    const res = await fetch(matchUrl, {
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
      // Drives which Apollo sequence this run enrolls into:
      // criteria.apolloSequenceId holds the mapped sequence NAME (or a raw id).
      savedSearch: { select: { criteria: true } },
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
  // Resolve the Apollo sequence id for THIS run, preferring the saved
  // search's own mapping (self-serve BdSequence table -> hardcoded
  // apollo-sequences.ts) so a table-only sequence like "Great Neck BD"
  // enrolls into its real Apollo sequence instead of silently falling back to
  // the env/default ("Tax BD Sequence"). Runs with no resolvable mapping (the
  // org-wide cron) keep the original APOLLO_SEQUENCE_ID -> default behavior.
  const sequenceId = await resolveRunSequenceId(orgId, run.savedSearch?.criteria);

  if (!apiKey) {
    // No Apollo credentials (local / dry run): there is nothing to send, so
    // echo the curated list and mark the run complete. This is NOT the
    // silent-zero bug — it's the no-credentials path.
    console.warn(`[Apollo] runId=${run.id} cannot enroll: APOLLO_API_KEY unset (dry run)`);
    for (const c of companies) {
      console.log(
        `[Apollo stub] Would enroll ${c.companyName} into sequence=${sequenceId || "(unresolved)"}: ${formatCuratedContacts(c.curatedContacts)}`,
      );
    }
    await prisma.bDRun.update({
      where: { id: run.id },
      data: { status: "COMPLETE", completedAt: new Date() },
    });
    return { enrolled: 0, capped: false, skipped: [] };
  }

  // Guard: a missing or non-Apollo-id sequence means add_contact_ids would
  // fire against an empty/garbage emailer_campaign_id and silently enroll
  // ZERO. FAIL the run loudly instead of pretending it completed.
  if (!isApolloSequenceId(sequenceId)) {
    const msg =
      `[Apollo] runId=${run.id} ABORT: no valid Apollo sequence id resolved ` +
      `(got "${sequenceId || "(empty)"}"). The saved-search mapping, BdSequence ` +
      `table, apollo-sequences.ts, and APOLLO_SEQUENCE_ID all failed to yield a ` +
      `24-char Apollo id. NOT calling add_contact_ids.`;
    console.error(msg);
    await prisma.bDRun.update({
      where: { id: run.id },
      data: { status: "FAILED", errorMessage: msg.slice(0, 500), completedAt: new Date() },
    });
    return { enrolled: 0, capped: false, skipped: [] };
  }

  // Verifiable in Vercel: the exact emailer_campaign_id this run enrolls into.
  console.log(`[Apollo] runId=${run.id} resolved emailer_campaign_id=${sequenceId}`);

  // Sequence enrollment needs sending mailbox id(s). Resolve once per run.
  // All healthy connected mailboxes are handed to Apollo so it rotates sends
  // across them; falls back to a single mailbox when only one is healthy.
  const emailAccountIds = await apolloResolveSendingMailboxIds(apiKey);
  if (emailAccountIds.length === 0) {
    console.warn(
      `[Apollo] runId=${run.id} cannot enroll: no sending mailbox resolved (set APOLLO_EMAIL_ACCOUNT_ID or link a mailbox in Apollo)`,
    );
    await prisma.bDRun.update({
      where: { id: run.id },
      data: { status: "COMPLETE", completedAt: new Date() },
    });
    return { enrolled: 0, capped: false, skipped: [] };
  }
  console.log(
    `[Apollo] runId=${run.id} sending mailbox rotation: ${emailAccountIds.length} mailbox(es) [${emailAccountIds.join(", ")}]`,
  );

  let enrolledThisRun = 0;
  // Contacts skipped because they were already in the sequence (idempotency).
  // Tracked for the activity record; never counted as new enrolls.
  let alreadyInSequence = 0;
  const skipped: SkippedCompany[] = [];

  for (const c of companies) {
    if (remaining <= 0) break;

    // TEMP diag (silent-crash hunt, runId cmq51izow): wrap the ENTIRE
    // per-company body so a throw anywhere between the rotation log and the
    // contact-create call is logged with its full stack instead of silently
    // killing the run. The known gap is fetchApolloContacts -> loadTargeting,
    // a Prisma query that runs OUTSIDE that helper's own try/catch. We log and
    // continue to the next company so one bad company no longer kills the run.
    try {
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
        // Carry the real Apollo person id when we have one so the email
        // reveal below uses the precise match-by-id, exactly like the search
        // path. Only contacts with no real id fall back to name/domain.
        id: cc.apolloId || undefined,
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
        id: ct.apolloId ?? undefined,
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

      const outcome = await apolloEnrollContact(apiKey, sequenceId, emailAccountIds, {
        first_name: p.first_name ?? undefined,
        last_name: p.last_name ?? undefined,
        email: revealedEmail,
        title: p.title ?? undefined,
        organization_name: p.organization_name ?? c.companyName,
        typed_custom_fields: typedCustomFields,
      });
      const displayName =
        [p.first_name, p.last_name].filter(Boolean).join(" ") ||
        p.name ||
        "(unnamed)";
      if (outcome === "enrolled") {
        enrolledThisRun += 1;
        remaining -= 1;
        // Persist progress INCREMENTALLY so a mid-batch timeout still records
        // the contacts already pushed to Apollo (the old code only wrote
        // enrolledCount once at the very end, so a 60s kill lost the count).
        // Wrapped so a transient DB blip never aborts the enroll loop.
        try {
          await prisma.bDRun.update({
            where: { id: run.id },
            data: { enrolledCount: { increment: 1 } },
          });
        } catch (incErr) {
          console.warn(
            `[Apollo] runId=${run.id} incremental enrolledCount update failed:`,
            incErr instanceof Error ? incErr.message : incErr,
          );
        }
        console.log(
          `[Apollo] enrolled ${displayName}: title="${p.title ?? "(none)"}" company="${c.companyName}"`,
        );
      } else if (outcome === "already") {
        // Idempotent skip — already in the sequence. Does NOT count as a new
        // enroll and does NOT consume the daily cap, so retries converge.
        alreadyInSequence += 1;
        console.log(
          `[Apollo] already-enrolled (skipped) ${displayName}: company="${c.companyName}"`,
        );
      }
    }

    // One-line per-company summary: search size, reveals that succeeded, and
    // every skip with its reason. Visibility only — does not alter enrollment.
    logCompanySummary();
    } catch (err) {
      // TEMP diag (silent-crash hunt): make the silent post-rotation crash
      // visible with full message + stack, then keep processing the remaining
      // companies instead of letting the whole run die here.
      console.error(
        `[Apollo] company loop threw (${c.companyName}, runId=${run.id}): ` +
          (err instanceof Error
            ? `${err.message}\n${err.stack ?? "(no stack)"}`
            : String(err)),
      );
      skipped.push({
        companyName: c.companyName,
        reason: `unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
  }

  // Only the terminal status + timestamp here. enrolledCount is NOT re-set:
  // it was incremented per-contact above, so a re-run (which skips already-
  // enrolled contacts) keeps accumulating onto the prior partial count instead
  // of an absolute SET clobbering it.
  await prisma.bDRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETE",
      completedAt: new Date(),
    },
  });

  // Record the run outcome whenever there's anything to report — enrolled
  // contacts, idempotent skips, and/or skipped companies (with reasons) — so
  // the skips are queryable after the fact instead of vanishing.
  if (enrolledThisRun > 0 || alreadyInSequence > 0 || skipped.length > 0) {
    await prisma.bDActivity.create({
      data: {
        organizationId: orgId,
        bdRunId: run.id,
        kind: "ENROLL",
        metadata: {
          contacts: enrolledThisRun,
          alreadyInSequence,
          sequenceId,
          skipped,
        },
      },
    });
  }

  const capped = remaining <= 0 && enrolledThisRun + enrolledToday >= dailyCap;
  return { enrolled: enrolledThisRun, capped, skipped };
}
