import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { extractCandidateFields } from "@/lib/candidate-fields";
import { getRecruiterPhone } from "@/lib/preferences";
import { formatLocation } from "@/lib/utils";
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
