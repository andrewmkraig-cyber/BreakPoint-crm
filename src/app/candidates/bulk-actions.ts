"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getRfJobsForOrg, getRfClientsForOrg } from "@/lib/candidates";
import { normalizeJob, normalizeClient } from "@/lib/rf-payload-shapes";
import { logActivity } from "@/lib/activity";
import { plainToHtml } from "@/lib/gmail";
import { createScheduledEmail } from "@/lib/scheduled-email";
import { getBulkSendSettings } from "@/lib/preferences";
import {
  computeBulkSchedule,
  etDayKey,
  startOfEtDay,
} from "@/lib/bulk-send-queue";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import {
  applyMergeFields,
  htmlEmailWrap,
  looksLikeHtml,
  type MergeFieldValues,
} from "@/lib/merge-fields";
import { generateAndSaveClientBlurb } from "@/lib/client-blurb";

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
  const head = j.clientName ? `${j.clientName}: ${j.jobTitle}` : j.jobTitle;
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

  // Batch the placement-existence check across every allowed candidate in a
  // single query, replacing the per-candidate findUnique that fired once per
  // loop iteration (N+1). Scoped to the target job (cuid or RF id) and the
  // caller's org; the resulting Set lets the loop skip candidates already
  // placed on this job without another round trip.
  const allowedIdList = input.candidateIds.filter((id) => allowedIds.has(id));
  const existingPlacements = allowedIdList.length
    ? await prisma.placement.findMany({
        where: {
          organizationId: org.id,
          candidateId: { in: allowedIdList },
          ...(input.jobCuid
            ? { jobId: input.jobCuid }
            : { jobRfId: input.jobRfId! }),
        },
        select: { candidateId: true },
      })
    : [];
  const alreadyPlaced = new Set(
    existingPlacements
      .map((p) => p.candidateId)
      .filter((id): id is string => id != null),
  );

  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const candidateId of input.candidateIds) {
    if (!allowedIds.has(candidateId)) {
      errors.push(`Candidate ${candidateId} not in this tenant`);
      continue;
    }
    try {
      if (alreadyPlaced.has(candidateId)) {
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

// Bulk remove candidates from a Saved List. Deletes CandidateListMembership
// rows only — the candidates themselves stay in the database and every
// pipeline placement is left untouched. Tenant-checks the list + scopes
// the membership delete to in-org candidates so a forged listId or
// candidateId can't bleed across orgs.
export type BulkRemoveFromListResult = {
  ok: boolean;
  removed: number;
  error?: string;
};

export async function bulkRemoveCandidatesFromList(input: {
  candidateIds: string[];
  listId: string;
}): Promise<BulkRemoveFromListResult> {
  const user = await requireUser();
  if (!user) return { ok: false, removed: 0, error: "Not signed in." };
  if (input.candidateIds.length === 0) {
    return { ok: false, removed: 0, error: "No candidates selected." };
  }
  if (!input.listId) return { ok: false, removed: 0, error: "Missing list id." };

  const org = await getCurrentOrg();

  const list = await prisma.candidateList.findFirst({
    where: { id: input.listId, organizationId: org.id },
    select: { id: true },
  });
  if (!list) return { ok: false, removed: 0, error: "List not found." };

  const result = await prisma.candidateListMembership.deleteMany({
    where: {
      listId: list.id,
      candidateId: { in: input.candidateIds },
      candidate: { organizationId: org.id },
    },
  });

  revalidatePath("/candidates");
  revalidatePath("/candidates/lists");
  revalidatePath(`/candidates/lists/${list.id}`);
  return { ok: true, removed: result.count };
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
  // For the throttled bulk path this is the count QUEUED (not yet sent).
  // For scheduleBulkEmail it is the count scheduled at the chosen time.
  sent: number;
  skipped: number;
  errors: string[];
  // Present only on the throttled bulkSendEmail path. Lets the dialog show
  // the queue summary (spacing, ETA, next-day overflow, sender).
  queue?: {
    queued: number;
    firstAt: string | null; // ISO of the earliest send in this batch
    lastAt: string | null; // ISO of the latest send (the "finishes by" ETA)
    overflowCount: number; // how many rolled to a future ET day past the cap
    spacingMinutes: number;
    sender: string; // from-address for this batch (one Gmail today)
  };
};

// Live snapshot of the user's bulk send queue for the status panel.
export type BulkQueueStatus = {
  pending: number; // still waiting to send
  sentToday: number; // bulk emails already sent this ET day
  failed: number; // bulk rows that errored on send (not yet cleared)
  nextAt: string | null; // ISO of the next pending send
  lastAt: string | null; // ISO of the last pending send (ETA)
  overflowToNextDay: number; // pending rows scheduled past today (ET)
  sender: string;
  spacingMinutes: number;
  dailyCap: number;
};

// "Send to N candidates" - the throttled bulk path. Despite the name it no
// longer sends inline; it enqueues one ScheduledEmail per recipient with a
// staggered scheduledSendAt (spacing + jitter + per-ET-day cap from
// Settings) and lets the per-minute cron drain them. Returns the count
// queued plus a `queue` summary for the dialog's status panel.
export async function bulkSendEmail(input: {
  candidateIds: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  // Job + client merge values resolved once on the client (via
  // getJobMergeValuesForBulk) and reused across every recipient.
  // Per-candidate fields (candidateFirstName, etc.) are layered on
  // top per row inside the loop so the same job context can wrap
  // many personalized sends in one batch.
  jobMergeValues?: MergeFieldValues;
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
      phone: true,
      location: true,
      currentDesignation: true,
      currentOrganization: true,
    },
  });

  let skipped = 0;
  const errors: string[] = [];

  const jobValues = input.jobMergeValues ?? {};

  // Resolve every recipient's merged content NOW (same per-candidate merge
  // the old instant loop did), but instead of sending we hand the batch to
  // the throttled queue below. Candidates with no email on file are skipped.
  type ReadyRecipient = {
    candidateId: string;
    email: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
  };
  const ready: ReadyRecipient[] = [];

  for (const c of candidates) {
    const email = (c.email ?? "").trim();
    if (!email) {
      skipped += 1;
      continue;
    }
    const values: MergeFieldValues = {
      ...jobValues,
      candidateFirstName: c.firstName ?? "",
      candidateLastName: c.lastName ?? "",
      candidateEmail: email,
      candidatePhone: c.phone ?? "",
      candidateLocation: c.location ?? "",
      candidateCurrentTitle: c.currentDesignation ?? "",
      candidateCurrentEmployer: c.currentOrganization ?? "",
    };
    const mergedSubject = applyMergeFields(subject, values);
    const mergedBody = applyMergeFields(input.body, values);
    // Defensive: if a rich (HTML) template body reached here as text,
    // wrap it so <strong> survives instead of being escaped on send.
    const mergedHtml = input.bodyHtml
      ? applyMergeFields(input.bodyHtml, values)
      : looksLikeHtml(mergedBody)
        ? htmlEmailWrap(mergedBody)
        : undefined;
    ready.push({
      candidateId: c.id,
      email,
      subject: mergedSubject,
      bodyText: mergedBody,
      bodyHtml: mergedHtml,
    });
  }

  // Skip any candidate that didn't come back from the org-scoped
  // findMany (id forged for another tenant, or deleted between
  // selection and send). Count those toward `skipped` so the UI
  // reports an honest total.
  const foundIds = new Set(candidates.map((c) => c.id));
  skipped += input.candidateIds.filter((id) => !foundIds.has(id)).length;

  if (ready.length === 0) {
    return { ok: true, sent: 0, skipped, errors: [] };
  }

  // Throttled enqueue. Each recipient becomes one ScheduledEmail row with a
  // staggered scheduledSendAt; the per-minute cron fires them one at a time
  // so the send keeps going after the tab closes. computeBulkSchedule
  // appends after any in-flight queue, spaces + jitters the sends, and rolls
  // daily-cap overflow to the next ET day at 8am. The activity-log
  // "email_sent" row is written by fireScheduledEmail when each one
  // actually sends, not here.
  const { spacingMinutes, dailyCap } = await getBulkSendSettings();
  const { sendTimes, overflowCount } = await computeBulkSchedule({
    userId: user.id,
    count: ready.length,
    spacingMinutes,
    dailyCap,
  });

  let queued = 0;
  for (let i = 0; i < ready.length; i++) {
    const r = ready[i];
    try {
      await createScheduledEmail({
        organizationId,
        userId: user.id,
        userEmail: user.email,
        // Sender stored explicitly on the row. Single Gmail today; when
        // domain rotation lands later this is the only field that varies.
        sendAsEmail: user.email,
        to: [r.email],
        subject: r.subject,
        bodyHtml: r.bodyHtml ?? plainToHtml(r.bodyText),
        bodyText: r.bodyText,
        scheduledSendAt: sendTimes[i],
        timezone: DEFAULT_TIMEZONE,
        createDraft: false,
        autoTag: true,
        candidateId: r.candidateId,
        source: "bulk_email",
      });
      queued += 1;
    } catch (e) {
      errors.push(`${r.email}: ${e instanceof Error ? e.message : "queue failed"}`);
    }
  }

  return {
    ok: errors.length === 0,
    sent: queued,
    skipped,
    errors,
    queue: {
      queued,
      firstAt: sendTimes.length ? sendTimes[0].toISOString() : null,
      lastAt: sendTimes.length ? sendTimes[sendTimes.length - 1].toISOString() : null,
      overflowCount,
      spacingMinutes,
      sender: user.email,
    },
  };
}

// "Send Later" sibling of bulkSendEmail. Resolves each candidate's
// per-recipient merge fields NOW and persists one ScheduledEmail row per
// candidate (no Gmail mirror draft — one draft per recipient would flood
// the Drafts label). The per-minute cron fires each row independently and
// records the same "email_sent" activity bulkSendEmail would. `sent` here
// is the count scheduled.
export async function scheduleBulkEmail(input: {
  candidateIds: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  jobMergeValues?: MergeFieldValues;
  scheduledSendAt: string; // ISO UTC
  timezone: string;
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
  const when = new Date(input.scheduledSendAt);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, sent: 0, skipped: 0, errors: ["Invalid scheduled time."] };
  }
  if (when.getTime() < Date.now() - 30_000) {
    return {
      ok: false,
      sent: 0,
      skipped: 0,
      errors: ["Scheduled time must be in the future."],
    };
  }

  const { id: organizationId } = await getCurrentOrg();
  const candidates = await prisma.candidate.findMany({
    where: { id: { in: input.candidateIds }, organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      location: true,
      currentDesignation: true,
      currentOrganization: true,
    },
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];
  const jobValues = input.jobMergeValues ?? {};

  for (const c of candidates) {
    const email = (c.email ?? "").trim();
    if (!email) {
      skipped += 1;
      continue;
    }
    const values: MergeFieldValues = {
      ...jobValues,
      candidateFirstName: c.firstName ?? "",
      candidateLastName: c.lastName ?? "",
      candidateEmail: email,
      candidatePhone: c.phone ?? "",
      candidateLocation: c.location ?? "",
      candidateCurrentTitle: c.currentDesignation ?? "",
      candidateCurrentEmployer: c.currentOrganization ?? "",
    };
    const mergedSubject = applyMergeFields(subject, values);
    const mergedBody = applyMergeFields(input.body, values);
    // Defensive: rich (HTML) template body reaching here as text gets
    // wrapped so its formatting survives the scheduled send.
    const mergedHtml = input.bodyHtml
      ? applyMergeFields(input.bodyHtml, values)
      : looksLikeHtml(mergedBody)
        ? htmlEmailWrap(mergedBody)
        : undefined;

    try {
      await createScheduledEmail({
        organizationId,
        userId: user.id,
        userEmail: user.email,
        to: [email],
        subject: mergedSubject,
        bodyHtml: mergedHtml ?? plainToHtml(mergedBody),
        bodyText: mergedBody,
        scheduledSendAt: when,
        timezone: input.timezone,
        createDraft: false,
        autoTag: true,
        candidateId: c.id,
        source: "bulk_email",
      });
      sent += 1;
    } catch (e) {
      const name =
        [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || email;
      errors.push(`${name}: ${e instanceof Error ? e.message : "schedule failed"}`);
    }
  }

  const foundIds = new Set(candidates.map((c) => c.id));
  const missing = input.candidateIds.filter((id) => !foundIds.has(id)).length;
  skipped += missing;

  return { ok: errors.length === 0, sent, skipped, errors };
}

// Live status of the throttled bulk queue for the signed-in user. Powers
// the "Email queue" panel: how many are pending, when they finish, how
// many slipped past today's cap, and the single sender they go out from.
export async function getBulkQueueStatus(): Promise<BulkQueueStatus | null> {
  const user = await requireUser();
  if (!user) return null;

  const { spacingMinutes, dailyCap } = await getBulkSendSettings();

  const pendingRows = await prisma.scheduledEmail.findMany({
    where: { userId: user.id, source: "bulk_email", status: "SCHEDULED" },
    orderBy: { scheduledSendAt: "asc" },
    select: { scheduledSendAt: true },
  });
  const pending = pendingRows.length;
  const nextAt = pending ? pendingRows[0].scheduledSendAt.toISOString() : null;
  const lastAt = pending
    ? pendingRows[pending - 1].scheduledSendAt.toISOString()
    : null;

  const now = new Date();
  const todayKey = etDayKey(now);
  const overflowToNextDay = pendingRows.filter(
    (r) => etDayKey(r.scheduledSendAt) > todayKey,
  ).length;

  const [sentToday, failed] = await Promise.all([
    prisma.scheduledEmail.count({
      where: {
        userId: user.id,
        source: "bulk_email",
        status: "SENT",
        scheduledSendAt: { gte: startOfEtDay(now) },
      },
    }),
    prisma.scheduledEmail.count({
      where: { userId: user.id, source: "bulk_email", status: "FAILED" },
    }),
  ]);

  return {
    pending,
    sentToday,
    failed,
    nextAt,
    lastAt,
    overflowToNextDay,
    sender: user.email,
    spacingMinutes,
    dailyCap,
  };
}

// Cancel every still-pending bulk email for the signed-in user. Flips
// SCHEDULED rows to CANCELED; rows the cron has already claimed (SENDING)
// or sent are untouched, so this never cancels an in-flight send.
export async function cancelBulkQueue(): Promise<{
  ok: boolean;
  canceled: number;
  error?: string;
}> {
  const user = await requireUser();
  if (!user) return { ok: false, canceled: 0, error: "Not signed in." };
  try {
    const res = await prisma.scheduledEmail.updateMany({
      where: { userId: user.id, source: "bulk_email", status: "SCHEDULED" },
      data: { status: "CANCELED" },
    });
    return { ok: true, canceled: res.count };
  } catch (e) {
    return {
      ok: false,
      canceled: 0,
      error: e instanceof Error ? e.message : "Cancel failed.",
    };
  }
}

// Lazy fetch for the BulkEmailDialog's "View N recipients" panel.
// Returns each candidate's name + email (or null) so the recruiter
// can spot no-email-on-file rows before sending. Org-scoped so a
// forged candidateId from another tenant returns nothing.
export type BulkRecipient = {
  id: string;
  name: string;
  email: string | null;
};

export async function getCandidateContactsForBulk(
  candidateIds: string[],
): Promise<BulkRecipient[]> {
  if (!(await requireUser())) return [];
  if (candidateIds.length === 0) return [];
  const { id: organizationId } = await getCurrentOrg();
  const rows = await prisma.candidate.findMany({
    where: { id: { in: candidateIds }, organizationId },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Preserve the input order so the panel matches the recruiter's
  // selection sequence.
  return candidateIds.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const name =
      [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || "(no name)";
    return [{ id: r.id, name, email: r.email ?? null }];
  });
}

// Resolves a job's merge values (job + client fields) for the bulk
// dialog's "Job context" picker. Accepts the same id pair as
// bulkApplyCandidatesToJob so the same BulkPickerJob row can drive
// both flows. Org-scoped via getRfJobsForOrg / getRfClientsForOrg.
export async function getJobMergeValuesForBulk(input: {
  jobCuid: string | null;
  jobRfId: number | null;
  clientCuid: string | null;
  clientRfId: number | null;
}): Promise<MergeFieldValues> {
  if (!(await requireUser())) return {};
  const { id: organizationId } = await getCurrentOrg();

  // Job lookup: prefer the cuid path, fall back to legacyRfId for
  // RF-imported jobs. Job.locations is a String[] (one Job row can
  // carry multiple location strings); we surface the first entry for
  // the [Job Location] merge token since recruiters typically pick a
  // single job per bulk send.
  let jobRow: { title: string; locations: string[] } | null = null;
  if (input.jobCuid) {
    jobRow = await prisma.job.findFirst({
      where: { id: input.jobCuid, organizationId },
      select: { title: true, locations: true },
    });
  }
  if (!jobRow && input.jobRfId != null) {
    jobRow = await prisma.job.findFirst({
      where: { legacyRfId: input.jobRfId, organizationId },
      select: { title: true, locations: true },
    });
  }

  // Client lookup mirrors the same id-pair pattern. candidateBlurb is
  // selected here so the {{client_blurb}} merge field can resolve without
  // a second round trip; id is carried so we can save a freshly-generated
  // blurb back onto the row.
  let clientRow:
    | {
        id: string;
        name: string;
        candidateBlurb: string | null;
        domain: string | null;
        linkedinPage: string | null;
      }
    | null = null;
  if (input.clientCuid) {
    clientRow = await prisma.client.findFirst({
      where: { id: input.clientCuid, organizationId },
      select: { id: true, name: true, candidateBlurb: true, domain: true, linkedinPage: true },
    });
  }
  if (!clientRow && input.clientRfId != null) {
    clientRow = await prisma.client.findFirst({
      where: { legacyRfId: input.clientRfId, organizationId },
      select: { id: true, name: true, candidateBlurb: true, domain: true, linkedinPage: true },
    });
  }

  // Resolve the {{client_blurb}} merge value at queue time: use the saved
  // candidateBlurb; if null, generate one once (Claude) and save it; if
  // generation fails, fall back to "a confidential client" so an outreach
  // email never renders "My client, , ...". Only attempt generation when
  // we actually have a client row.
  let candidateBlurb = (clientRow?.candidateBlurb ?? "").trim();
  if (!candidateBlurb && clientRow) {
    try {
      candidateBlurb = await generateAndSaveClientBlurb({
        clientId: clientRow.id,
        organizationId,
      });
    } catch {
      candidateBlurb = "a confidential client";
    }
  }

  return {
    jobTitle: jobRow?.title ?? "",
    jobLocation: jobRow?.locations[0] ?? "",
    clientCompanyName: clientRow?.name ?? "",
    candidateBlurb,
    clientCompanyWebsite: clientRow?.domain ?? "",
    clientCompanyLinkedIn: clientRow?.linkedinPage ?? "",
  };
}
