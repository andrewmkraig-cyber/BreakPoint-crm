"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getRfJobsForOrg, getRfClientsForOrg } from "@/lib/candidates";
import { normalizeJob, normalizeClient } from "@/lib/rf-payload-shapes";
import { logActivity } from "@/lib/activity";
import { sendGmail } from "@/lib/gmail";

// Bulk Apply / Add-to-List actions backing the /candidates page's
// multi-row checkbox toolbar. Single-candidate flows still live in
// placement-actions.ts (RF) and local-placement-actions.ts (Ace-
// native); this file's bulk helpers loop one apply per candidate so
// dupe-by-(candidateId, jobId) skips and per-row activity logging
// keep working without a separate batch insert path.

type BulkResult = {
  ok: boolean;
  applied: number;
  skipped: number;
  errors: string[];
};

async function requireUser(): Promise<{ id: string; email: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true },
  });
  return u?.email ? { id: u.id, email: u.email } : null;
}

export type BulkPickerJob = {
  // jobRfId is the stable numeric key the picker uses for select state.
  // For Ace-native jobs without an RF id the legacyRfId is null and we
  // fall back to a synthetic negative id derived from the cuid (same
  // approach the RF shim uses elsewhere). The cuid + legacy id are both
  // returned so the bulk-apply server action can pick whichever
  // identity the Placement row needs.
  key: string;
  jobCuid: string | null;
  jobRfId: number | null;
  clientCuid: string | null;
  clientRfId: number | null;
  label: string;
};

// One-line label used by both the candidates-view bulk picker and the
// per-candidate Apply dropdown. Mirrors formatOpenJobOption in
// placement-flows so the two dropdowns read identically.
function buildLabel(j: {
  jobTitle: string;
  jobLocation: string;
  jobCompensation: string;
  clientName: string;
}): string {
  const head = j.clientName ? `${j.clientName} — ${j.jobTitle}` : j.jobTitle;
  const tail = [j.jobLocation, j.jobCompensation].filter(Boolean);
  return tail.length > 0 ? `${head} · ${tail.join(" · ")}` : head;
}

// Open jobs for the bulk-picker. Org-scoped (getRfJobsForOrg already
// gates by tenant). Sorted by client name then title for deterministic
// dropdown order.
export async function getOpenJobsForBulkPicker(): Promise<BulkPickerJob[]> {
  const [allJobs, allClients] = await Promise.all([
    getRfJobsForOrg(),
    getRfClientsForOrg(),
  ]);
  const clientById = new Map<number, ReturnType<typeof normalizeClient>>();
  for (const cl of allClients) clientById.set(cl.id, normalizeClient(cl));

  const rows = allJobs
    .filter((j) => j.is_open !== false)
    .map((raw) => {
      const j = normalizeJob(raw);
      const client = j.companyId != null ? clientById.get(j.companyId) ?? null : null;
      const aceJobId = (raw as { _aceJobId?: string })._aceJobId ?? null;
      const aceClientId = (raw as { _aceClientId?: string })._aceClientId ?? null;
      const clientName = client ? client.name : j.company;
      const label = buildLabel({
        jobTitle: j.title,
        jobLocation: j.location,
        jobCompensation: j.compensation,
        clientName,
      });
      const jobRfId = j.id > 0 ? j.id : null;
      const clientRfId = j.companyId != null && j.companyId > 0 ? j.companyId : null;
      // Composite key so the dropdown can stably identify Ace-native
      // jobs (cuid only) vs RF-imported jobs (numeric id).
      const key = aceJobId ? `c:${aceJobId}` : `r:${j.id}`;
      return {
        key,
        jobCuid: aceJobId,
        jobRfId,
        clientCuid: aceClientId,
        clientRfId,
        label,
      } satisfies BulkPickerJob;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return rows;
}

// Bulk apply: walk the candidateIds, create a Placement at stage
// "applied" for each one that isn't already linked to this job. The
// per-row dupe check keeps the operation idempotent — re-running with
// the same set just bumps `skipped`. Errors on individual rows don't
// abort the rest of the batch; they collect in `errors` so the UI can
// surface a partial-success toast.
export async function bulkApplyCandidatesToJob(input: {
  candidateIds: string[];
  jobCuid: string | null;
  jobRfId: number | null;
  clientCuid: string | null;
  clientRfId: number | null;
}): Promise<BulkResult> {
  const user = await requireUser();
  if (!user) return { ok: false, applied: 0, skipped: 0, errors: ["Not signed in."] };
  if (input.candidateIds.length === 0) {
    return { ok: false, applied: 0, skipped: 0, errors: ["No candidates selected."] };
  }
  if (input.jobRfId == null && !input.jobCuid) {
    return { ok: false, applied: 0, skipped: 0, errors: ["Missing job reference."] };
  }

  const org = await getCurrentOrg();

  // Verify each candidate belongs to the caller's org. Forged ids get
  // dropped silently into `errors` rather than throwing — same defense
  // pattern the single-candidate apply path uses.
  const allowed = await prisma.candidate.findMany({
    where: { id: { in: input.candidateIds }, organizationId: org.id },
    select: { id: true },
  });
  const allowedIds = new Set(allowed.map((c) => c.id));

  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const candidateId of input.candidateIds) {
    if (!allowedIds.has(candidateId)) {
      errors.push(`Candidate ${candidateId} not in this tenant`);
      continue;
    }
    try {
      const existing = input.jobCuid
        ? await prisma.placement.findUnique({
            where: { candidateId_jobId: { candidateId, jobId: input.jobCuid } },
            select: { id: true },
          })
        : await prisma.placement.findUnique({
            where: {
              candidateId_jobRfId: {
                candidateId,
                jobRfId: input.jobRfId!,
              },
            },
            select: { id: true },
          });
      if (existing) {
        skipped += 1;
        continue;
      }
      await prisma.placement.create({
        data: {
          candidateId,
          candidateRfId: null,
          jobRfId: input.jobRfId,
          jobId: input.jobCuid,
          clientRfId: input.clientRfId,
          clientId: input.clientCuid,
          stage: "applied",
          source: "recruiter_applied",
          createdById: user.id,
          organizationId: org.id,
          syncedToRf: false,
        },
      });
      await logActivity({
        organizationId: org.id,
        userId: user.id,
        actionType: "candidate_applied_to_job",
        targetType: "candidate",
        targetId: candidateId,
        metadata: {
          jobId: input.jobCuid ?? null,
          jobRfId: input.jobRfId ?? null,
          clientId: input.clientCuid ?? null,
          clientRfId: input.clientRfId ?? null,
          bulk: true,
        },
      });
      applied += 1;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "apply failed");
    }
  }

  revalidatePath("/candidates");
  revalidatePath("/pipeline");
  return { ok: errors.length === 0 || applied > 0, applied, skipped, errors };
}

// Bulk add-to-list against an EXISTING list. Tenant-checks the list
// + filters the candidate set to in-org rows. createMany with
// skipDuplicates so re-running with the same set is a no-op.
export async function bulkAddCandidatesToList(input: {
  candidateIds: string[];
  listId: string;
}): Promise<{ ok: boolean; added: number; error?: string }> {
  const user = await requireUser();
  if (!user) return { ok: false, added: 0, error: "Not signed in." };
  if (input.candidateIds.length === 0) {
    return { ok: false, added: 0, error: "No candidates selected." };
  }
  if (!input.listId) return { ok: false, added: 0, error: "Missing list id." };

  const org = await getCurrentOrg();
  const list = await prisma.candidateList.findFirst({
    where: { id: input.listId, organizationId: org.id },
    select: { id: true },
  });
  if (!list) return { ok: false, added: 0, error: "List not found." };

  const allowed = await prisma.candidate.findMany({
    where: { id: { in: input.candidateIds }, organizationId: org.id },
    select: { id: true },
  });
  const ids = allowed.map((c) => c.id);
  if (ids.length === 0) return { ok: false, added: 0, error: "No matching candidates." };

  const result = await prisma.candidateListMembership.createMany({
    data: ids.map((candidateId) => ({ candidateId, listId: list.id })),
    skipDuplicates: true,
  });

  revalidatePath("/candidates");
  revalidatePath("/candidates/lists");
  return { ok: true, added: result.count };
}

// Bulk add-to-list, creating the list first. Mirrors createCandidateList's
// (organizationId, name) unique-constraint friendly-error handling.
export async function bulkAddCandidatesToNewList(input: {
  candidateIds: string[];
  name: string;
}): Promise<{ ok: boolean; added: number; listId?: string; error?: string }> {
  const user = await requireUser();
  if (!user) return { ok: false, added: 0, error: "Not signed in." };
  const name = input.name.trim();
  if (!name) return { ok: false, added: 0, error: "List name is required." };
  if (name.length > 80) return { ok: false, added: 0, error: "List name is too long (max 80)." };
  if (input.candidateIds.length === 0) {
    return { ok: false, added: 0, error: "No candidates selected." };
  }

  const org = await getCurrentOrg();
  const allowed = await prisma.candidate.findMany({
    where: { id: { in: input.candidateIds }, organizationId: org.id },
    select: { id: true },
  });
  const ids = allowed.map((c) => c.id);
  if (ids.length === 0) return { ok: false, added: 0, error: "No matching candidates." };

  try {
    const created = await prisma.candidateList.create({
      data: { name, organizationId: org.id, createdById: user.id },
      select: { id: true },
    });
    const result = await prisma.candidateListMembership.createMany({
      data: ids.map((candidateId) => ({ candidateId, listId: created.id })),
      skipDuplicates: true,
    });
    revalidatePath("/candidates");
    revalidatePath("/candidates/lists");
    return { ok: true, added: result.count, listId: created.id };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { ok: false, added: 0, error: `A list named "${name}" already exists.` };
    }
    return { ok: false, added: 0, error: e instanceof Error ? e.message : "Failed to create list." };
  }
}

// Bulk email send. One Gmail send per recipient (not a single multi-To
// message) so each candidate sees only their own address in the To
// header, and per-row failures don't sink the rest of the batch.
//
// Merge fields supported (replaced per recipient before send):
//   [Candidate First Name]      → Candidate.firstName
//   [Candidate Last Name]       → Candidate.lastName
//   [Candidate Current Title]   → Candidate.currentDesignation
//   [Candidate Current Company] → Candidate.currentOrganization
//
// Candidates without an email on file are tallied as `skipped`. Any
// per-row send failure lands in `errors` with the candidate name and
// the Gmail error string; the action still resolves so the caller can
// surface a partial-success toast.
export type BulkEmailResult = {
  ok: boolean;
  sent: number;
  skipped: number;
  errors: string[];
};

function applyCandidateMergeFields(
  text: string,
  c: {
    firstName: string | null;
    lastName: string | null;
    currentDesignation: string | null;
    currentOrganization: string | null;
  },
): string {
  // .split().join() instead of regex: token literals contain `[` and
  // spaces, so escaping for new RegExp() is fragile. String-replace is
  // case-sensitive on purpose — Andrew's templates use the exact
  // bracketed casing surfaced in the composer hint.
  return text
    .split("[Candidate First Name]").join(c.firstName ?? "")
    .split("[Candidate Last Name]").join(c.lastName ?? "")
    .split("[Candidate Current Title]").join(c.currentDesignation ?? "")
    .split("[Candidate Current Company]").join(c.currentOrganization ?? "");
}

export async function bulkSendEmail(input: {
  candidateIds: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
}): Promise<BulkEmailResult> {
  const user = await requireUser();
  if (!user) {
    return { ok: false, sent: 0, skipped: 0, errors: ["Not signed in."] };
  }
  if (input.candidateIds.length === 0) {
    return { ok: true, sent: 0, skipped: 0, errors: [] };
  }
  const subject = (input.subject ?? "").trim();
  if (subject.length === 0) {
    return { ok: false, sent: 0, skipped: 0, errors: ["Subject is required."] };
  }

  const { id: organizationId } = await getCurrentOrg();
  const candidates = await prisma.candidate.findMany({
    where: { id: { in: input.candidateIds }, organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      currentDesignation: true,
      currentOrganization: true,
    },
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const c of candidates) {
    const email = (c.email ?? "").trim();
    if (!email) {
      skipped += 1;
      continue;
    }
    const mergedSubject = applyCandidateMergeFields(subject, c);
    const mergedBody = applyCandidateMergeFields(input.body, c);
    const mergedHtml = input.bodyHtml
      ? applyCandidateMergeFields(input.bodyHtml, c)
      : undefined;

    try {
      await sendGmail({
        userId: user.id,
        from: user.email,
        to: [email],
        subject: mergedSubject,
        bodyText: mergedBody,
        bodyHtml: mergedHtml,
      });
      sent += 1;
      try {
        await logActivity({
          organizationId,
          userId: user.id,
          actionType: "email_sent",
          targetType: "candidate",
          targetId: c.id,
          metadata: {
            source: "bulk_email",
            subject: mergedSubject,
            recipient: email,
          },
        });
      } catch {
        // Audit write is observability — never fail the send.
      }
    } catch (e) {
      const name =
        [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || email;
      errors.push(`${name}: ${e instanceof Error ? e.message : "send failed"}`);
    }
  }

  // Skip any candidate that didn't come back from the org-scoped
  // findMany (id forged for another tenant, or deleted between
  // selection and send). Count those toward `skipped` so the UI
  // reports an honest total.
  const foundIds = new Set(candidates.map((c) => c.id));
  const missing = input.candidateIds.filter((id) => !foundIds.has(id)).length;
  skipped += missing;

  return { ok: errors.length === 0, sent, skipped, errors };
}
