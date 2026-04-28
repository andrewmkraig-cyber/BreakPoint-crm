import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { extractCandidateFields } from "@/lib/candidate-fields";
import { getRecruiterPhone } from "@/lib/preferences";
import { formatLocation } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import {
  type RFJob,
  type RFClient,
  type RFContact,
} from "@/lib/rf-payload-shapes";
import { getRfCandidatesForOrg, getRfCandidateByRfId, getRfClientsForOrg } from "@/lib/candidates";
import { getRfShapedContactsForOrg } from "@/lib/contacts";
import type { MergeFieldValues } from "@/lib/merge-fields";

export type BuildMergeContextInput = {
  candidateRfId?: number;
  jobRfId?: number;
  clientRfId?: number;
  // Override values applied on top of the RF-sourced data. Used when the
  // caller already has authoritative strings (e.g. offer amount formatted
  // from the form, start date picked by the user). Falsy overrides are
  // ignored so they don't blank out resolved data.
  overrides?: Partial<MergeFieldValues>;
};

// Single server-side source of truth for every merge-field render. Fetches
// candidate / job / client from RF fresh on each call so no blank tokens
// leak through. Callers only need to pass the IDs they know; everything
// else is resolved here.
//
// We console.log a one-line summary per call so prod debugging is visible
// in Vercel logs — each log line shows which ids were used and which fields
// ended up populated.
export async function buildFullMergeValues(
  input: BuildMergeContextInput,
): Promise<MergeFieldValues> {
  const session = await getServerSession(authOptions);
  const recruiterEmail = session?.user?.email ?? "";
  const recruiterName = session?.user?.name ?? "";

  // RF /candidate/{id} and /job/{id} 404 on the external API. The rest of the
  // app uses listAll + find; we do the same here so merge fields never leak
  // blank values just because the detail endpoints are dark.
  const [candidate, job, clientList, contactList] = await Promise.all([
    input.candidateRfId
      ? safeCall(async () => {
          try {
            const direct = await getRfCandidateByRfId(input.candidateRfId!);
            if (direct && typeof direct === "object") return direct;
          } catch {
            // fall through to list
          }
          const all = await getRfCandidatesForOrg();
          return all.find((x) => x.id === input.candidateRfId) ?? null;
        })
      : null,
    input.jobRfId
      ? safeCall(async () => {
          // Phase 5: Neon is the only source. The shim indexes the shim
          // output by jobRfId (RF-imported positive ids); misses return
          // null and downstream fields come back as empty strings.
          const { getRfJobsForOrg } = await import("@/lib/candidates");
          const all = await getRfJobsForOrg();
          return all.find((x) => x.id === input.jobRfId) ?? null;
        })
      : null,
    input.clientRfId ? safeCall(() => getRfClientsForOrg()) : null,
    input.clientRfId ? safeCall(() => getRfShapedContactsForOrg()) : null,
  ]);

  const candidateFields = candidate ? extractCandidateFields(candidate) : null;

  const client = pickClient(clientList, input.clientRfId);
  const primaryContact = pickPrimaryContact(contactList, input.clientRfId);
  const jobTitle = job ? job.title ?? job.name ?? "" : "";
  const jobLocation = job ? formatLocation(firstLocation(job)) : "";
  const jobDescription = job ? extractJobDescription(job) : "";
  const clientCompanyName = (client?.name ?? job?.company?.name ?? "").toString();

  const recruiterPhone = await getRecruiterPhone(recruiterEmail);

  const values: MergeFieldValues = {
    candidateFirstName: candidateFields?.firstName ?? "",
    candidateLastName: candidateFields?.lastName ?? "",
    candidateFullName: candidateFields?.fullName ?? "",
    candidateEmail: candidateFields?.email ?? "",
    clientCompanyName,
    clientContactFullName: primaryContact?.fullName ?? "",
    clientContactFirstName: primaryContact?.firstName ?? "",
    jobTitle,
    jobLocation,
    jobDescription,
    offerAmount: "",
    startDate: "",
    recruiterName,
    recruiterEmail,
    recruiterPhone,
  };

  if (input.overrides) {
    for (const [k, v] of Object.entries(input.overrides)) {
      if (typeof v === "string" && v.trim() !== "") {
        (values as Record<string, string>)[k] = v;
      }
    }
  }

  // Prod-visible debug: single line per build so we can trace blank tokens.
  // eslint-disable-next-line no-console
  console.log("[merge-context]", {
    candidateRfId: input.candidateRfId ?? null,
    jobRfId: input.jobRfId ?? null,
    clientRfId: input.clientRfId ?? null,
    populated: {
      candidateFirstName: values.candidateFirstName,
      candidateLastName: values.candidateLastName,
      candidateEmail: values.candidateEmail ? "(present)" : "",
      clientCompanyName: values.clientCompanyName,
      clientContactFullName: values.clientContactFullName,
      jobTitle: values.jobTitle,
      jobLocation: values.jobLocation,
      offerAmount: values.offerAmount,
      startDate: values.startDate,
      recruiterName: values.recruiterName,
      recruiterPhone: values.recruiterPhone,
    },
  });

  return values;
}

async function safeCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[merge-context] fetch failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

function pickClient(clients: RFClient[] | null | undefined, clientId?: number): RFClient | null {
  if (!clients || !clientId) return null;
  return clients.find((c) => c.id === clientId) ?? null;
}

type NormalizedContact = { fullName: string; firstName: string; email: string };

function pickPrimaryContact(
  contacts: RFContact[] | null | undefined,
  clientId?: number,
): NormalizedContact | null {
  if (!contacts || !clientId) return null;
  const match = contacts.find((c) => c.client_company_id === clientId);
  if (!match) return null;
  const firstEmail = Array.isArray(match.email) ? match.email[0] ?? "" : match.email ?? "";
  const fullName =
    [match.first_name, match.last_name].filter(Boolean).join(" ") || match.name || "";
  const firstName = match.first_name || fullName.split(/\s+/)[0] || "";
  return { fullName, firstName, email: firstEmail };
}

function firstLocation(job: RFJob): string | null {
  if (Array.isArray(job.locations) && job.locations.length > 0) return job.locations[0];
  return null;
}

function extractJobDescription(job: RFJob): string {
  const raw = job as unknown as { description?: string; job_description?: string };
  return (raw.description ?? raw.job_description ?? "").toString();
}

// ---- Cuid-aware merge resolver (Ace-native + RF) ----
//
// Identity-agnostic merge values builder. Takes whichever id shape
// the caller has — RF numeric ids OR cuid strings — and resolves the
// candidate / job / client rows directly from Neon. Replaces the
// older buildFullMergeValues for trigger-fire callers that need to
// support Ace-native candidates (which carry no rfId).
//
// The candidate is the primary identity gate: at least one of
// `candidateRfId` or `candidateId` must resolve, otherwise we
// return values with empty candidate fields and skip the email
// lookup. Job and client follow the same fallback pattern.

export type BuildPlacementMergeContextInput = {
  candidateRfId?: number | null;
  candidateId?: string | null;
  jobRfId?: number | null;
  jobId?: string | null;
  clientRfId?: number | null;
  clientId?: string | null;
  overrides?: Partial<MergeFieldValues>;
};

export async function buildPlacementMergeValues(
  input: BuildPlacementMergeContextInput,
): Promise<MergeFieldValues> {
  const session = await getServerSession(authOptions);
  const recruiterEmail = session?.user?.email ?? "";
  const recruiterName = session?.user?.name ?? "";

  // Candidate: resolve cuid first (Ace-native is the dominant path
  // post-26.0); fall back to RF id only when the cuid lookup misses.
  let candidate:
    | {
        firstName: string;
        lastName: string;
        fullName: string;
        email: string;
        phone: string;
      }
    | null = null;

  if (input.candidateId) {
    const row = await prisma.candidate.findUnique({
      where: { id: input.candidateId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    });
    if (row) {
      const first = row.firstName ?? "";
      const last = row.lastName ?? "";
      candidate = {
        firstName: first,
        lastName: last,
        fullName: [first, last].filter(Boolean).join(" "),
        email: row.email ?? "",
        phone: row.phone ?? "",
      };
    }
  }
  if (!candidate && input.candidateRfId != null) {
    try {
      const c = await getRfCandidateByRfId(input.candidateRfId);
      if (c) {
        const fields = extractCandidateFields(c);
        candidate = {
          firstName: fields.firstName ?? "",
          lastName: fields.lastName ?? "",
          fullName: fields.fullName ?? "",
          email: fields.email ?? "",
          phone: "",
        };
      }
    } catch {
      // Ignore — fall through to empty candidate fields.
    }
  }

  // Job: same priority — cuid first, then RF id.
  let job: { title: string; location: string; description: string; clientId: string | null } | null = null;
  if (input.jobId) {
    const row = await prisma.job.findUnique({
      where: { id: input.jobId },
      select: {
        title: true,
        locations: true,
        description: true,
        clientId: true,
        raw: true,
      },
    });
    if (row) {
      const rawAny = (row.raw ?? null) as
        | { description?: string; job_description?: string }
        | null;
      job = {
        title: row.title ?? "",
        location: Array.isArray(row.locations) && row.locations.length > 0
          ? row.locations.join(", ")
          : "",
        description: row.description ?? rawAny?.description ?? rawAny?.job_description ?? "",
        clientId: row.clientId,
      };
    }
  }
  if (!job && input.jobRfId != null) {
    const row = await prisma.job.findFirst({
      where: { legacyRfId: input.jobRfId },
      select: {
        title: true,
        locations: true,
        description: true,
        clientId: true,
        raw: true,
      },
    });
    if (row) {
      const rawAny = (row.raw ?? null) as
        | { description?: string; job_description?: string }
        | null;
      job = {
        title: row.title ?? "",
        location: Array.isArray(row.locations) && row.locations.length > 0
          ? row.locations.join(", ")
          : "",
        description: row.description ?? rawAny?.description ?? rawAny?.job_description ?? "",
        clientId: row.clientId,
      };
    }
  }

  // Client + primary contact. Resolve client row by cuid first,
  // falling back to legacy RF id, with a final fall-back to whatever
  // clientId the Job carries (so a recruiter can pass jobId only and
  // still get the client name resolved).
  const clientCuid =
    input.clientId ??
    (input.clientRfId != null
      ? (await prisma.client.findFirst({
          where: { legacyRfId: input.clientRfId },
          select: { id: true },
        }))?.id ?? null
      : null) ??
    job?.clientId ??
    null;

  let clientCompanyName = "";
  let primaryContact: { fullName: string; firstName: string; email: string } | null = null;
  if (clientCuid) {
    const client = await prisma.client.findUnique({
      where: { id: clientCuid },
      select: { name: true },
    });
    if (client?.name) clientCompanyName = client.name;
    // Primary contact: first one alphabetically by first/last name.
    // Existing buildFullMergeValues picked the first match in an
    // unsorted list — same effective behavior.
    const contact = await prisma.contact.findFirst({
      where: { clientId: clientCuid },
      select: { firstName: true, lastName: true, name: true, emails: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    if (contact) {
      const first = contact.firstName ?? "";
      const last = contact.lastName ?? "";
      const composed = [first, last].filter(Boolean).join(" ") || contact.name || "";
      const firstEmail = Array.isArray(contact.emails) ? contact.emails[0] ?? "" : "";
      primaryContact = {
        fullName: composed,
        firstName: first || composed.split(/\s+/)[0] || "",
        email: firstEmail,
      };
    }
  }

  const recruiterPhone = await getRecruiterPhone(recruiterEmail);

  const values: MergeFieldValues = {
    candidateFirstName: candidate?.firstName ?? "",
    candidateLastName: candidate?.lastName ?? "",
    candidateFullName: candidate?.fullName ?? "",
    candidateEmail: candidate?.email ?? "",
    candidatePhone: candidate?.phone ?? "",
    clientCompanyName,
    clientContactFullName: primaryContact?.fullName ?? "",
    clientContactFirstName: primaryContact?.firstName ?? "",
    clientContactEmail: primaryContact?.email ?? "",
    jobTitle: job?.title ?? "",
    jobLocation: job?.location ?? "",
    jobDescription: job?.description ?? "",
    offerAmount: "",
    startDate: "",
    recruiterName,
    recruiterFullName: recruiterName,
    recruiterEmail,
    recruiterPhone,
  };

  if (input.overrides) {
    for (const [k, v] of Object.entries(input.overrides)) {
      if (typeof v === "string" && v.trim() !== "") {
        (values as Record<string, string>)[k] = v;
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log("[merge-context:placement]", {
    candidateId: input.candidateId ?? null,
    candidateRfId: input.candidateRfId ?? null,
    jobId: input.jobId ?? null,
    jobRfId: input.jobRfId ?? null,
    clientCuid,
    populated: {
      candidate: values.candidateFullName,
      candidateEmail: values.candidateEmail ? "(present)" : "",
      jobTitle: values.jobTitle,
      clientCompanyName: values.clientCompanyName,
      primaryContact: values.clientContactFullName,
    },
  });

  return values;
}
