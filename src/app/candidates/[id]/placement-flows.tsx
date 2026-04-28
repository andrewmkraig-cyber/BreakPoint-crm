"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent, type DragEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Briefcase,
  ChevronDown,
  Edit3,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  UploadCloud,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { submittalMarkdownToEditorHtml } from "@/lib/submittal-format";
import { PIPELINE_LABELS, type PipelineBucket } from "@/lib/rf-payload-shapes";
import { StageBadge } from "@/components/stage-badge";
import { LabeledField, LabeledTextarea } from "@/app/candidates/[id]/editable-helpers";
import {
  applyCandidateToJob,
  cancelPlacement,
  confirmStart,
  deliverCandidateConfirmation,
  generateSubmittal,
  listSubmittalResumeOptions,
  moveCancelledToAceStage,
  reapplyCancelledPlacement,
  recordOffer,
  recordPlacement,
  rejectCandidateJob,
  removeCancelledFromJob,
  sendInterviewConfirmationEmail,
  sendOfferAcceptanceEmail,
  sendRejectionEmail,
  sendSubmittalEmail,
  unrejectCandidateJob,
  type SubmittalResumeOption,
  type SubmittalResumeVariant,
} from "@/app/candidates/[id]/placement-actions";
import {
  rescheduleInterview,
  scheduleInterview,
  sendInterviewInvite,
  type InterviewType,
} from "@/app/candidates/[id]/interview-actions";
import { createClientContact } from "@/app/candidates/[id]/contact-actions";
import { EmailComposer, type EmailDraft } from "@/components/email-composer";
import { DateTime15Picker } from "@/components/datetime-15-picker";
import { applyMergeFields as applyMergeFieldsClient } from "@/lib/merge-fields";
import { PipelineRowActions } from "@/app/jobs/[id]/pipeline-row-actions";

export type ClientContactRef = {
  id: number;
  name: string;
  title: string;
  email: string;
};

export type OpenJobOption = {
  jobRfId: number;
  // Phase 4b: cuid FKs for the target Job / Client — populated at page
  // build time via getJob/getClientByIdentifier lookups so server actions
  // can stamp Placement.jobId / clientId alongside the legacy numeric
  // ids. For Ace-native Jobs (shim synthetic negative jobRfId) the cuid
  // is the true identity; for RF-imported Jobs it's a redundant pointer
  // that makes cross-identity joins work server-side.
  jobCuid: string | null;
  clientCuid: string | null;
  jobTitle: string;
  clientRfId: number;
  clientName: string;
  alreadyLinked: boolean;
  clientContacts: ClientContactRef[];
};

export type PlacementContextJob = {
  jobRfId: number;
  jobCuid: string | null;
  clientCuid: string | null;
  jobTitle: string;
  jobLocation: string;
  jobDescription: string;
  jobSalaryRange: string;
  clientRfId: number;
  clientName: string;
  clientWebsite: string;
  clientLinkedIn: string;
  clientFeePct: number | null;
  rfStageBucket: PipelineBucket;
  rfStageMovedAt: string | null;
  clientContacts: ClientContactRef[];
  placement: PlacementSnapshot | null;
  interviews: InterviewSummary[];
};

export type InterviewSummary = {
  id: string;
  scheduledAt: string;
  durationMin: number;
  type: "phone_screen" | "video" | "in_person";
  status: "scheduled" | "completed" | "cancelled" | "rescheduled";
  source: "ace_scheduled" | "client_scheduled";
  meetLink: string | null;
  attendees: { name: string; email: string }[];
  candidatePhone: string | null;
  notes: string | null;
};

// State for the two-step invite composer pipeline that runs after a
// successful Schedule Interview save. `step` advances on each composer close
// (send or skip); "done" tears the whole flow down and refreshes the page.
type InviteFlowState = {
  step: "client" | "candidate" | "done";
  interviewId: string;
  scheduledAtISO: string;
  durationMin: number;
  type: InterviewType;
  meetLink: string | null;
  // Street address for in-person interviews. Empty for video / phone_screen.
  interviewLocation: string;
  jobTitle: string;
  jobLocation: string;
  jobDescription: string;
  jobSalaryRange: string;
  clientName: string;
  clientWebsite: string;
  clientLinkedIn: string;
  clientContactName: string;
  clientContactEmail: string;
  // Additional recipients chosen on the schedule dialog. Forwarded into
  // both per-party invite events so Austin (or anyone else) stays in the
  // loop without being added separately on both composers.
  ccEmails: string[];
  bccEmails: string[];
};

type CandidateInviteContext = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  currentTitle: string;
  currentEmployer: string;
};

export type PlacementSnapshot = {
  id: string;
  stage: "offer" | "pending_start" | "hired" | "cancelled" | "rejected" | "sourced" | "applied";
  cancelledAt: string | null;
  cancellationReason: string | null;
  cancellationDetail: string | null;
  rejectedAt: string | null;
  syncedToRf: boolean;
  offerSalary: number | null;
  offerCurrency: string | null;
  offerTitle: string | null;
  offerStartDate: string | null;
  offerNotes: string | null;
  acceptedSalary: number | null;
  acceptedCurrency: string | null;
  feePercentage: number | null;
  feeTotal: number | null;
  minFee: number | null;
  guaranteePeriodDays: number | null;
  billingContactName: string | null;
  billingContactEmail: string | null;
  // Array of { name, email } contacts. Populated from the new billingContacts
  // JSON column; null on rows saved before the multi-contact migration (reads
  // fall back to the single billingContactName/Email fields above).
  billingContacts: Array<{ name: string; email: string }> | null;
  hiringManagerName: string | null;
  hiringManagerEmail: string | null;
  expectedStartDate: string | null;
  placementNotes: string | null;
  startConfirmedAt: string | null;
};

type Bucket = PipelineBucket;

export type AceTeamContact = { id: string; name: string; email: string };

export function PlacementActions({
  candidateRfId,
  candidateFirstName,
  candidateLastName,
  candidateEmail,
  candidatePhone,
  candidateLocation,
  candidateCurrentTitle,
  candidateCurrentEmployer,
  recruiter,
  jobs,
  openJobs,
  aceTeam,
}: {
  candidateRfId: number;
  candidateFirstName: string;
  candidateLastName: string;
  candidateEmail: string;
  candidatePhone: string;
  candidateLocation: string;
  candidateCurrentTitle: string;
  candidateCurrentEmployer: string;
  recruiter: { firstName: string; fullName: string; email: string; phone: string };
  jobs: PlacementContextJob[];
  openJobs: OpenJobOption[];
  aceTeam: AceTeamContact[];
}) {
  const [offerFor, setOfferFor] = useState<PlacementContextJob | null>(null);
  const [placementFor, setPlacementFor] = useState<PlacementContextJob | null>(null);
  const [confirmFor, setConfirmFor] = useState<PlacementContextJob | null>(null);
  const [scheduleFor, setScheduleFor] = useState<PlacementContextJob | null>(null);
  const [clientInviteFor, setClientInviteFor] = useState<PlacementContextJob | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<InterviewSummary | null>(null);
  // Post-Schedule multi-step invite flow: after the interview is saved + on
  // the calendar, we open the client composer, then the candidate composer.
  const [inviteFlow, setInviteFlow] = useState<InviteFlowState | null>(null);
  const [rejectFor, setRejectFor] = useState<PlacementContextJob | null>(null);
  const [unrejectFor, setUnrejectFor] = useState<PlacementContextJob | null>(null);
  const [cancelFor, setCancelFor] = useState<PlacementContextJob | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitInitialJobRfId, setSubmitInitialJobRfId] = useState<number | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);

  // Deep-link from /applicants and /jobs/[id] pipeline rows. The
  // expected query is ?compose=submittal&jobId=NN — when both are
  // present we open the SubmitToJobDialog with the matching job
  // pre-selected so the user lands directly in the composer step.
  // Then strip the params via router.replace so a refresh doesn't
  // re-trigger and the back button works.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    const compose = searchParams?.get("compose");
    const jobIdRaw = searchParams?.get("jobId");
    if (compose !== "submittal" || !jobIdRaw) return;
    const jobId = Number(jobIdRaw);
    if (!Number.isFinite(jobId)) return;
    // Only honor the deep-link if the candidate is actually eligible
    // for that job (it appears in openJobs and isn't already linked
    // past sourced/applied) — otherwise show the dialog at the picker
    // step so the user sees the conflict and can cancel.
    const target = openJobs.find((j) => j.jobRfId === jobId);
    if (target) {
      setSubmitInitialJobRfId(jobId);
    }
    setSubmitOpen(true);
    // Strip the query so it doesn't re-fire on every render or on a
    // back-nav.
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("compose");
    next.delete("jobId");
    const queryString = next.toString();
    router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`, { scroll: false });
    // We deliberately depend only on the search params + pathname —
    // openJobs reference changes on every parent re-render but the
    // initial query is what matters here. Also stripping the params
    // changes searchParams, which would re-run; the early-return on
    // missing compose/jobId handles that cleanly.
  }, [searchParams, pathname, router, openJobs]);

  // ?openApply=1 / ?openSubmit=1 — header-button entry points from
  // page.tsx now that the standalone in-island Apply/Submit row was
  // removed. Open the corresponding modal with no pre-selected job
  // (the per-row PipelineRowActions buttons cover the per-job case).
  useEffect(() => {
    const openApply = searchParams?.get("openApply");
    const openSubmit = searchParams?.get("openSubmit");
    if (!openApply && !openSubmit) return;
    if (openApply) setApplyOpen(true);
    if (openSubmit) setSubmitOpen(true);
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("openApply");
    next.delete("openSubmit");
    const queryString = next.toString();
    router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`, { scroll: false });
  }, [searchParams, pathname, router]);

  // Deep-link for the Pipeline page's Edit Placement button. Format is
  // ?edit=placement&jobId=NN — we find the matching job in `jobs` (which
  // unlike openJobs includes pending_start / hired rows) and open the
  // PlacementDialog pre-filled, then strip the params so refreshes / back
  // navigation don't re-open the modal.
  useEffect(() => {
    const edit = searchParams?.get("edit");
    const jobIdRaw = searchParams?.get("jobId");
    if (edit !== "placement" || !jobIdRaw) return;
    const jobId = Number(jobIdRaw);
    if (!Number.isFinite(jobId)) return;
    const target = jobs.find((j) => j.jobRfId === jobId);
    if (!target) return;
    setPlacementFor(target);
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("edit");
    next.delete("jobId");
    const queryString = next.toString();
    router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`, { scroll: false });
  }, [searchParams, pathname, router, jobs]);


  return (
    <>
      {jobs.length === 0 && (
        <div className="rounded-xl border border-dashed border-court-border bg-court-surface-subtle/40 px-5 py-4 text-xs text-court-fg-muted">
          No jobs linked to this candidate yet — click <span className="font-semibold">Submit to Job</span> to add one.
        </div>
      )}

      <div className="divide-y divide-court-border rounded-xl border border-court-border bg-court-surface">
        {jobs.map((j) => (
          <JobActionRow
            key={j.jobRfId}
            job={j}
            candidateRfId={candidateRfId}
            candidateName={[candidateFirstName, candidateLastName].filter(Boolean).join(" ")}
            onOffer={() => setOfferFor(j)}
            onPlacement={() => setPlacementFor(j)}
            onConfirm={() => setConfirmFor(j)}
            onSchedule={() => setScheduleFor(j)}
            onClientInvite={() => setClientInviteFor(j)}
            onReject={() => setRejectFor(j)}
            onCancel={() => setCancelFor(j)}
          />
        ))}
      </div>

      {offerFor && (
        <OfferDialog
          candidateRfId={candidateRfId}
          job={offerFor}
          onClose={() => setOfferFor(null)}
        />
      )}
      {placementFor && (
        <PlacementDialog
          candidateRfId={candidateRfId}
          job={placementFor}
          onClose={() => setPlacementFor(null)}
        />
      )}
      {confirmFor && confirmFor.placement && (
        <ConfirmStartDialog
          placementId={confirmFor.placement.id}
          jobTitle={confirmFor.jobTitle}
          onClose={() => setConfirmFor(null)}
          onEditPlacement={() => {
            // Chain Confirm → Edit: close this modal, open the placement
            // editor for the same job. The editor upserts the existing
            // Placement row (unique on candidateRfId+jobRfId) so the row
            // stays pending_start and the stamped placedAt is preserved.
            const job = confirmFor;
            setConfirmFor(null);
            setPlacementFor(job);
          }}
        />
      )}
      {scheduleFor && (
        <ScheduleInterviewDialog
          candidateRef={{ candidateRfId }}
          candidateName={[candidateFirstName, candidateLastName].filter(Boolean).join(" ")}
          candidateEmail={candidateEmail}
          job={scheduleFor}
          aceTeam={aceTeam}
          onClose={() => setScheduleFor(null)}
          onScheduled={(ctx) => {
            setScheduleFor(null);
            setInviteFlow({ ...ctx, step: "client" });
          }}
        />
      )}
      {inviteFlow && inviteFlow.step === "client" && (
        <ClientInviteComposer
          invite={inviteFlow}
          candidate={{
            firstName: candidateFirstName,
            lastName: candidateLastName,
            email: candidateEmail,
            phone: candidatePhone,
            location: candidateLocation,
            currentTitle: candidateCurrentTitle,
            currentEmployer: candidateCurrentEmployer,
          }}
          recruiter={recruiter}
          clientContacts={findClientContactsForJob(jobs, inviteFlow.jobTitle, inviteFlow.clientName)}
          aceTeam={aceTeam}
          onDone={(meetLink) => setInviteFlow({ ...inviteFlow, step: "candidate", meetLink: meetLink ?? inviteFlow.meetLink })}
        />
      )}
      {inviteFlow && inviteFlow.step === "candidate" && (
        <CandidateInviteComposer
          invite={inviteFlow}
          candidate={{
            firstName: candidateFirstName,
            lastName: candidateLastName,
            email: candidateEmail,
            phone: candidatePhone,
            location: candidateLocation,
            currentTitle: candidateCurrentTitle,
            currentEmployer: candidateCurrentEmployer,
          }}
          recruiter={recruiter}
          clientContacts={findClientContactsForJob(jobs, inviteFlow.jobTitle, inviteFlow.clientName)}
          aceTeam={aceTeam}
          onDone={() => {
            setInviteFlow(null);
            toast.success("Interview scheduled", {
              description: "Client and candidate invites processed. The interview is on everyone's calendar.",
            });
          }}
        />
      )}
      {clientInviteFor && (
        <ClientInviteDialog
          candidateRef={{ candidateRfId }}
          candidateName={[candidateFirstName, candidateLastName].filter(Boolean).join(" ")}
          job={clientInviteFor}
          onClose={() => setClientInviteFor(null)}
        />
      )}
      {rescheduleFor && (
        <RescheduleDialog
          interview={rescheduleFor}
          onClose={() => setRescheduleFor(null)}
        />
      )}
      {rejectFor && (
        <RejectDialog
          candidateRfId={candidateRfId}
          candidateFullName={[candidateFirstName, candidateLastName].filter(Boolean).join(" ")}
          job={rejectFor}
          onClose={() => setRejectFor(null)}
        />
      )}
      {unrejectFor && (
        <UnrejectDialog
          candidateRfId={candidateRfId}
          job={unrejectFor}
          onClose={() => setUnrejectFor(null)}
        />
      )}
      {cancelFor && cancelFor.placement && (
        <CancelPlacementDialog
          placementId={cancelFor.placement.id}
          jobTitle={cancelFor.jobTitle}
          clientName={cancelFor.clientName}
          onClose={() => setCancelFor(null)}
        />
      )}
      {submitOpen && (
        <SubmitToJobDialog
          candidateRfId={candidateRfId}
          candidateFirstName={candidateFirstName}
          candidateLastName={candidateLastName}
          candidateEmail={candidateEmail}
          openJobs={openJobs}
          initialJobRfId={submitInitialJobRfId ?? undefined}
          onClose={() => {
            setSubmitOpen(false);
            setSubmitInitialJobRfId(null);
          }}
        />
      )}
      {applyOpen && (
        <ApplyToJobDialog
          candidateRfId={candidateRfId}
          openJobs={openJobs}
          onClose={() => setApplyOpen(false)}
        />
      )}
    </>
  );
}

function JobActionRow({
  job,
  candidateRfId,
  candidateName,
  onOffer,
  onPlacement,
  onConfirm,
  onSchedule,
  onReject,
  onCancel,
}: {
  job: PlacementContextJob;
  candidateRfId: number;
  candidateName: string;
  onOffer: () => void;
  onPlacement: () => void;
  onConfirm: () => void;
  onSchedule: () => void;
  onClientInvite: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  // Local Neon Placement.stage is the single source of truth for which
  // action buttons render. If there's no local Placement yet, treat the
  // candidate as "sourced" (unengaged RF record). Dropped the previous
  // `?? job.rfStageBucket` fallback so RF's stage_name / canonicalStage
  // plumbing is fully out of the button-render path.
  //
  // Normalized (trim + lowercase) before use so any non-canonical
  // casing or whitespace in the column can't silently fall through
  // to the default "View-only" case and hide the Submit button.
  const effective: Bucket = ((job.placement?.stage ?? "sourced").trim().toLowerCase()) as Bucket;
  const isCancelled = effective === "cancelled";
  // Inline next-upcoming interview. Past scheduled rows are
  // intentionally hidden — the stage chip already says
  // "Interviewing" / "Hired" / "Disqualified".
  const nextInterview = job.interviews
    .filter((iv) => iv.status === "scheduled" && new Date(iv.scheduledAt).getTime() > Date.now())
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Briefcase className="h-3 w-3 shrink-0 text-court-fg-muted" />
          <span className="truncate text-sm font-medium text-court-fg">{job.jobTitle}</span>
          {job.clientName && (
            <span className="truncate text-xs text-court-fg-muted">· {job.clientName}</span>
          )}
          {/* No label prop — StageBadge falls back to its canonical
              bucket label so an Ace-side stage move shows immediately
              without waiting for RF's stage_name to catch up. */}
          <StageBadge bucket={effective} />
          {nextInterview && (
            <span className="truncate text-xs text-court-fg-muted">{formatNextInterview(nextInterview)}</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Action set parity with the Job-page Pipeline rows. The
              dialog-heavy actions (Schedule / Offer / Placement /
              Confirm / Cancel) hand back to the existing profile-side
              dialog state via the inline callbacks; the lighter ones
              (Apply / Submit / Keep / Reject / Un-reject) call the
              same server actions PipelineRowActions uses on the Job
              page. */}
          <PipelineRowActions
            candidateRfId={candidateRfId}
            candidateName={candidateName}
            jobRfId={job.jobRfId}
            clientRfId={job.clientRfId}
            jobTitle={job.jobTitle}
            clientName={job.clientName}
            stage={effective}
            onSchedule={onSchedule}
            onOffer={onOffer}
            onPlacement={onPlacement}
            onConfirmStart={onConfirm}
            onCancelPlacement={onCancel}
            onRejectDialog={onReject}
          />
          {isCancelled && job.placement && (
            <CancelledRowActions placementId={job.placement.id} />
          )}
        </div>
      </div>

      {isCancelled && job.placement?.cancellationReason && (
        <div className="px-3 pb-1.5 text-[11px] text-red-700">
          Reason: {CANCEL_REASON_LABELS[job.placement.cancellationReason] ?? job.placement.cancellationReason}
          {job.placement.cancellationDetail ? ` — ${job.placement.cancellationDetail}` : ""}
        </div>
      )}

    </div>
  );
}

// Inline "· Apr 19 · 8:59 AM · Video" formatter — the next-upcoming
// interview surfaces on the row title line. Cancelled / past rows are
// hidden upstream; this only renders for an iv we already know is in
// the future and still scheduled.
function formatNextInterview(iv: InterviewSummary): string {
  const d = new Date(iv.scheduledAt);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const type = iv.type === "phone_screen" ? "Phone" : iv.type === "video" ? "Video" : "In-Person";
  return `· ${date} · ${time} · ${type}`;
}

const CANCEL_REASON_LABELS: Record<string, string> = {
  candidate_resigned: "Candidate Resigned",
  client_terminated: "Client Terminated",
  failed_background_check: "Failed Background Check",
  other: "Other",
};

function CancelledRowActions({ placementId }: { placementId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setOpen(false);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(`Couldn't ${label.toLowerCase()}`, { description: result.error ?? "Unknown error" });
        return;
      }
      toast.success(label);
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-semibold text-court-fg shadow-sm transition hover:border-brand/40 hover:text-brand-dark disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Actions
      </button>
      {open && (
        <>
          {/* z-[60]/z-[70] keeps the dropdown above the modal backdrop's
              z-50 so click-outside dismisses ONLY the dropdown — without
              this, the click bubbled up to the backdrop's onClose and
              the whole dialog unmounted (taking any state with it). */}
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[70] mt-1 w-60 overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg">
            <ul className="py-1 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() =>
                    run("Moved to Submitted", () =>
                      reapplyCancelledPlacement({ placementId }),
                    )
                  }
                  className="block w-full px-3 py-2 text-left text-court-fg hover:bg-brand-tint"
                >
                  Reapply (move to Submitted)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() =>
                    run("Moved to Sourced", () =>
                      moveCancelledToAceStage({ placementId, target: "sourced" }),
                    )
                  }
                  className="block w-full px-3 py-2 text-left text-court-fg hover:bg-brand-tint"
                >
                  Move to Sourced
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() =>
                    run("Moved to Applied", () =>
                      moveCancelledToAceStage({ placementId, target: "applied" }),
                    )
                  }
                  className="block w-full px-3 py-2 text-left text-court-fg hover:bg-brand-tint"
                >
                  Move to Applied
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm("Remove this candidate from the job entirely? This deletes the row.")) {
                      setOpen(false);
                      return;
                    }
                    run("Removed from job", () =>
                      removeCancelledFromJob({ placementId }),
                    );
                  }}
                  className="block w-full border-t border-court-border px-3 py-2 text-left text-red-700 hover:bg-red-50"
                >
                  Remove from Job
                </button>
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- Offer dialog ----------------

function OfferDialog({
  candidateRfId,
  job,
  onClose,
}: {
  candidateRfId: number;
  job: PlacementContextJob;
  onClose: () => void;
}) {
  const router = useRouter();
  const [salary, setSalary] = useState(job.placement?.offerSalary ? String(job.placement.offerSalary) : "");
  const [currency, setCurrency] = useState(job.placement?.offerCurrency ?? "USD");
  const [title, setTitle] = useState(job.placement?.offerTitle ?? job.jobTitle);
  const [startDate, setStartDate] = useState(
    job.placement?.offerStartDate ? job.placement.offerStartDate.slice(0, 10) : "",
  );
  const [notes, setNotes] = useState(job.placement?.offerNotes ?? "");
  const [accepted, setAccepted] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  const primaryContact = job.clientContacts.find((c) => c.email) ?? null;

  function onSave() {
    setErr(null);
    const salaryNum = parseCompensation(salary);
    if (salaryNum != null && salaryNum < 0) {
      setErr("Salary can't be negative.");
      return;
    }
    if (accepted) {
      if (!salaryNum) {
        setErr("Offer amount required to mark as accepted.");
        return;
      }
      if (!startDate) {
        setErr("Start date required to mark as accepted.");
        return;
      }
      if (!primaryContact?.email) {
        setErr("No client contact email on file — add one before marking accepted.");
        return;
      }
    }
    startSave(async () => {
      const result = await recordOffer({
        candidateRfId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        jobCuid: job.jobCuid,
        clientCuid: job.clientCuid,
        salary: salaryNum,
        currency: currency.toUpperCase().slice(0, 3),
        title: title.trim(),
        startDate: startDate || null,
        notes: notes.trim(),
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't save offer", { description: result.error });
        return;
      }

      if (accepted && salaryNum && startDate && primaryContact?.email) {
        const cc = job.clientContacts
          .filter((c) => c.email && c.email !== primaryContact.email)
          .map((c) => c.email);
        const offerAmount = formatMoney(salaryNum, currency);
        const emailResult = await sendOfferAcceptanceEmail({
          candidateRfId,
          jobRfId: job.jobRfId,
          clientRfId: job.clientRfId,
          jobTitle: job.jobTitle,
          clientCompanyName: job.clientName,
          clientContactFullName: primaryContact.name,
          clientContactFirstName: primaryContact.name.trim().split(/\s+/)[0] ?? "",
          offerAmount,
          startDate: formatDate(startDate),
          to: [primaryContact.email, ...cc],
        });
        if (emailResult.ok) {
          const v = emailResult.value;
          if (v.status === "sent") {
            toast.success("Offer acceptance email sent", { description: `Sent "${v.subject}" to ${v.to}.` });
          } else if (v.status === "drafted") {
            toast.success("Offer recorded", { description: "Acceptance email saved to your Gmail Drafts." });
          } else if (v.status === "skipped") {
            toast.success("Offer recorded", {
              description:
                v.reason === "missing"
                  ? "No Offer Acceptance template found. Set one in Settings."
                  : v.reason === "inactive"
                    ? "Offer Acceptance template is inactive. Enable it in Settings to auto-send."
                    : "Acceptance email skipped (no recipient).",
            });
          } else {
            toast.success("Offer recorded", { description: `Acceptance email failed: ${v.error}` });
          }
        } else {
          toast.success("Offer recorded", { description: `Acceptance email failed: ${emailResult.error}` });
        }
      } else {
        toast.success("Offer recorded");
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title="Offer received" subtitle={`${job.jobTitle} · ${job.clientName}`} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledField label="Offered salary" value={salary} onChange={setSalary} placeholder="e.g. 120000 or 120k" />
        <LabeledField label="Currency" value={currency} onChange={setCurrency} />
        <div className="sm:col-span-2">
          <LabeledField label="Offered title" value={title} onChange={setTitle} />
        </div>
        <LabeledField label="Proposed start date" type="date" value={startDate} onChange={setStartDate} />
        <div className="sm:col-span-2">
          <LabeledTextarea label="Notes" value={notes} onChange={setNotes} rows={3} />
        </div>
      </div>
      <label className="mt-4 flex items-start gap-2 rounded-lg border border-court-border bg-court-surface-subtle/60 p-3 text-xs">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-court-border text-brand focus:ring-brand/30"
        />
        <span>
          <span className="font-semibold text-court-fg">Candidate accepted this offer</span>
          <span className="block text-court-fg-muted">
            When checked, sending saves the offer and auto-emails the client (CC the candidate) using your
            Offer Acceptance template with [Offer Amount] and [Start Date] filled in.
          </span>
        </span>
      </label>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel={accepted ? "Save & send acceptance" : "Save"} />
    </Modal>
  );
}

// ---------------- Placement dialog ----------------

function PlacementDialog({
  candidateRfId,
  job,
  onClose,
}: {
  candidateRfId: number;
  job: PlacementContextJob;
  onClose: () => void;
}) {
  const router = useRouter();
  // Edit mode fires when the row is already at Pending Start — the recruiter
  // is amending saved placement details (e.g. typing in a fee that hadn't been
  // recorded on the initial save). The existing recordPlacement upsert is
  // reused, so no separate server action needed; only the UI labels and the
  // placedAt-preservation rule differ.
  const isEdit = job.placement?.stage === "pending_start";
  const seedSalary = job.placement?.acceptedSalary ?? job.placement?.offerSalary ?? null;
  const seedFeePct = job.placement?.feePercentage ?? job.clientFeePct ?? null;
  const [acceptedSalary, setAcceptedSalary] = useState(seedSalary ? String(seedSalary) : "");
  const [acceptedCurrency, setAcceptedCurrency] = useState(
    job.placement?.acceptedCurrency ?? job.placement?.offerCurrency ?? "USD",
  );
  const [feePct, setFeePct] = useState(seedFeePct != null ? String(seedFeePct) : "");
  const [minFee, setMinFee] = useState(job.placement?.minFee ? String(job.placement.minFee) : "");
  // Direct fee-amount override. Populated from the existing row's feeTotal when
  // editing so the recruiter sees what's on file and can revise it. For the
  // initial record-placement path it stays empty and the salary × % calc
  // drives feeTotal. When set, the override wins — useful for flat-fee deals
  // that don't map cleanly to a percentage of salary.
  const [feeAmountOverride, setFeeAmountOverride] = useState(
    isEdit && job.placement?.feeTotal ? String(job.placement.feeTotal) : "",
  );
  const [guarantee, setGuarantee] = useState(
    job.placement?.guaranteePeriodDays ? String(job.placement.guaranteePeriodDays) : "",
  );
  // Multi-contact billing list. Seed priority:
  //   1. Existing billingContacts JSON array (post-migration rows)
  //   2. Legacy single billingContactName/Email (pre-migration rows — shown
  //      as one row so editing doesn't wipe their previously-saved contact)
  //   3. One empty row so the UI always has at least one slot to fill in.
  // Each row carries a stable local id so the Add/Remove UX doesn't lose
  // focus on re-render.
  const [billingContacts, setBillingContacts] = useState<
    Array<{ key: string; name: string; email: string }>
  >(() => {
    const seeded = seedBillingContactList(job.placement);
    return seeded.length > 0
      ? seeded
      : [{ key: makeLocalKey(), name: "", email: "" }];
  });
  const [hiringName, setHiringName] = useState(job.placement?.hiringManagerName ?? "");
  const [hiringEmail, setHiringEmail] = useState(job.placement?.hiringManagerEmail ?? "");
  const [startDate, setStartDate] = useState(
    job.placement?.expectedStartDate
      ? job.placement.expectedStartDate.slice(0, 10)
      : job.placement?.offerStartDate
        ? job.placement.offerStartDate.slice(0, 10)
        : "",
  );
  const [notes, setNotes] = useState(job.placement?.placementNotes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  const salaryNum = parseCompensation(acceptedSalary);
  const pctNum = parseFloat(feePct) || 0;
  const minFeeNum = parseCompensation(minFee);
  const overrideNum = parseCompensation(feeAmountOverride);
  const guaranteeNum = guarantee ? Number(guarantee) : null;
  const rawFee = salaryNum && pctNum ? Math.round(salaryNum * (pctNum / 100)) : 0;
  // Fee resolution priority: explicit override > min-fee-vs-calc > calc.
  const calcFee = minFeeNum && rawFee < minFeeNum ? minFeeNum : rawFee;
  const feeTotal = overrideNum != null ? overrideNum : calcFee;
  const usedMinFee = overrideNum == null && minFeeNum != null && rawFee < minFeeNum;
  const usedOverride = overrideNum != null;

  function setContactField(key: string, field: "name" | "email", value: string) {
    setBillingContacts((prev) =>
      prev.map((c) => (c.key === key ? { ...c, [field]: value } : c)),
    );
  }

  function addContactRow() {
    setBillingContacts((prev) => [...prev, { key: makeLocalKey(), name: "", email: "" }]);
  }

  function removeContactRow(key: string) {
    setBillingContacts((prev) => {
      const next = prev.filter((c) => c.key !== key);
      // Keep at least one row present so the section never collapses to
      // "nothing to edit" — adding back would be one extra click.
      return next.length > 0 ? next : [{ key: makeLocalKey(), name: "", email: "" }];
    });
  }

  function pickKnownContact(key: string, contactId: string) {
    const match = job.clientContacts.find((c) => String(c.id) === contactId);
    if (!match) return;
    setBillingContacts((prev) =>
      prev.map((c) =>
        c.key === key ? { ...c, name: match.name, email: match.email ?? "" } : c,
      ),
    );
  }

  function validate(): string | null {
    // Direct fee-amount override short-circuits the salary × pct math —
    // salary/pct stay optional when the recruiter is typing a flat fee in.
    if (overrideNum != null) {
      if (overrideNum < 0) return "Fee amount can't be negative.";
    } else {
      if (salaryNum == null) return "Accepted salary required (or enter a flat fee amount).";
      if (salaryNum < 0) return "Salary can't be negative.";
      if (!pctNum) return "Fee percentage required (or enter a flat fee amount).";
      if (pctNum < 0) return "Fee percentage can't be negative.";
    }
    if (minFeeNum != null && minFeeNum < 0) return "Minimum fee can't be negative.";
    if (guaranteeNum != null && (Number.isNaN(guaranteeNum) || guaranteeNum < 0)) {
      return "Guarantee period can't be negative.";
    }
    if (!startDate) return "Expected start date required.";
    return null;
  }

  function onSave() {
    setErr(null);
    const problem = validate();
    if (problem) {
      setErr(problem);
      return;
    }

    // Strip empty rows before send; the server also filters defensively.
    const cleanedContacts = billingContacts
      .map((c) => ({ name: c.name.trim(), email: c.email.trim() }))
      .filter((c) => c.name || c.email);
    const primary = cleanedContacts[0] ?? { name: "", email: "" };
    startSave(async () => {
      const result = await recordPlacement({
        candidateRfId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        jobCuid: job.jobCuid,
        clientCuid: job.clientCuid,
        // When the recruiter is using a flat fee override without a salary,
        // we still need a non-null integer for acceptedSalary (schema column
        // is Int?). Zero is acceptable; the prior value would have been
        // overwritten on every save anyway.
        acceptedSalary: salaryNum ?? 0,
        acceptedCurrency: acceptedCurrency.toUpperCase().slice(0, 3),
        feePercentage: pctNum,
        feeTotal,
        minFee: minFeeNum,
        guaranteePeriodDays: guaranteeNum,
        // Legacy single-contact fields get the first contact mirrored in —
        // the server repeats this derivation but passing it up keeps the
        // payload self-describing.
        billingContactName: primary.name,
        billingContactEmail: primary.email,
        billingContacts: cleanedContacts,
        hiringManagerName: hiringName.trim(),
        hiringManagerEmail: hiringEmail.trim(),
        expectedStartDate: startDate,
        notes: notes.trim(),
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error(isEdit ? "Couldn't save changes" : "Couldn't save placement", { description: result.error });
        return;
      }
      toast.success(isEdit ? "Placement updated" : "Placement recorded", {
        description: isEdit ? "Changes saved." : "Candidate moved to Pending Start.",
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal
      title={isEdit ? "Edit placement" : "Placement"}
      subtitle={`${job.jobTitle} · ${job.clientName}`}
      onClose={onClose}
      wide
    >
      <div className="rounded-lg border border-brand/30 bg-brand-tint/20 p-3 text-xs text-brand-dark">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            Client agreement default:{" "}
            <strong>{job.clientFeePct != null ? `${job.clientFeePct}% fee` : "no fee % on file"}</strong>. Override
            below if this placement has different terms.
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledField
          label="Accepted salary"
          value={acceptedSalary}
          onChange={setAcceptedSalary}
          placeholder="120000 or 120k"
        />
        <LabeledField label="Currency" value={acceptedCurrency} onChange={setAcceptedCurrency} />
        <NumericField label="Fee %" value={feePct} onChange={setFeePct} placeholder="25" min={0} step="0.1" />
        <NumericField label="Min fee" value={minFee} onChange={setMinFee} placeholder="20000 (optional)" min={0} />
        <NumericField
          label="Fee amount (flat, overrides calc)"
          value={feeAmountOverride}
          onChange={setFeeAmountOverride}
          placeholder="7500 — wins over salary × fee %"
          min={0}
        />
        <NumericField
          label="Guarantee period (days)"
          value={guarantee}
          onChange={setGuarantee}
          placeholder="90"
          min={0}
          step="1"
        />
        <LabeledField label="Expected start date" type="date" value={startDate} onChange={setStartDate} />
      </div>

      <div className="mt-4 rounded-lg border border-court-border bg-court-surface-subtle/40 p-3">
        <div className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          {usedOverride ? "Fee (flat override)" : "Calculated fee"}
        </div>
        <div className="mt-1 font-serif text-2xl font-semibold text-court-fg">
          {formatMoney(feeTotal, acceptedCurrency)}
          {usedMinFee && <span className="ml-2 text-xs text-amber-700">(min fee applied)</span>}
          {usedOverride && <span className="ml-2 text-xs text-brand-dark">(flat override)</span>}
        </div>
        {usedOverride ? (
          <div className="mt-1 text-xs text-court-fg-muted">
            Flat-fee amount; salary × fee % calc is ignored while this is set.
          </div>
        ) : salaryNum && pctNum ? (
          <div className="mt-1 text-xs text-court-fg-muted">
            {formatMoney(salaryNum, acceptedCurrency)} × {pctNum}% = {formatMoney(rawFee, acceptedCurrency)}
          </div>
        ) : (
          <div className="mt-1 text-xs text-court-fg-muted">
            Enter salary + fee % to calculate, or type a flat fee amount above.
          </div>
        )}
      </div>

      <div className="mt-5 flex items-end justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Billing contacts
        </h3>
        <button
          type="button"
          onClick={addContactRow}
          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-semibold text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
        >
          <Plus className="h-3 w-3" /> Add Contact
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {billingContacts.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-1 items-end gap-2 rounded-lg border border-court-border bg-court-surface-subtle/30 p-3 sm:grid-cols-[1fr_1fr_auto]"
          >
            <div>
              <label className="text-[11px] uppercase tracking-wider text-court-fg-muted">Name</label>
              <input
                type="text"
                value={row.name}
                onChange={(e) => setContactField(row.key, "name", e.target.value)}
                placeholder="Contact name"
                list={`billing-contact-suggestions-${row.key}`}
                className="mt-1 w-full rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              {/* Native datalist mirrors the candidate's known client contacts
                  so typing offers quick-fill. Picking via onChange of a
                  nearby button would be heavier; keeping the input free-text
                  with suggestions is the simplest surface that still lets
                  Andrew add someone not in the client contacts list. */}
              <datalist id={`billing-contact-suggestions-${row.key}`}>
                {job.clientContacts.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
              {job.clientContacts.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {job.clientContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickKnownContact(row.key, String(c.id))}
                      className="rounded-full border border-court-border bg-court-surface px-2 py-0.5 text-[10px] text-court-fg-muted transition hover:border-brand/40 hover:text-court-fg"
                      title={`Fill from ${c.name}`}
                    >
                      {c.name.split(/\s+/)[0]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-court-fg-muted">Email</label>
              <input
                type="email"
                value={row.email}
                onChange={(e) => setContactField(row.key, "email", e.target.value)}
                placeholder="name@client.com"
                className="mt-1 w-full rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>
            <button
              type="button"
              onClick={() => removeContactRow(row.key)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-court-border bg-court-surface text-court-fg-muted transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
              title="Remove this contact"
              aria-label="Remove contact"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">Hiring manager</h3>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledField label="Name" value={hiringName} onChange={setHiringName} />
        <LabeledField label="Email" type="email" value={hiringEmail} onChange={setHiringEmail} />
      </div>

      <div className="mt-5">
        <LabeledTextarea label="Placement notes" value={notes} onChange={setNotes} rows={3} />
      </div>

      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter
        onCancel={onClose}
        onSave={onSave}
        saving={isPending}
        saveLabel={isEdit ? "Save changes" : "Record placement"}
      />
    </Modal>
  );
}

// Stable client-side row ids — just needs to be unique within the list while
// the modal is open, so a monotonic counter via Math.random().toString() is
// plenty. We can't use the contact's own email as the key because two blank
// rows would collide before the recruiter types anything in.
function makeLocalKey(): string {
  return `c_${Math.random().toString(36).slice(2, 10)}`;
}

// Prefer the saved multi-contact JSON if present; otherwise reconstitute a
// single-row list from the legacy billingContactName/Email columns so a row
// saved before the migration still shows its contact when reopened. Returns
// an empty array when neither source has data so the caller can seed one
// blank row via the initializer.
function seedBillingContactList(
  placement: PlacementSnapshot | null,
): Array<{ key: string; name: string; email: string }> {
  const fromJson = placement?.billingContacts ?? null;
  if (fromJson && fromJson.length > 0) {
    return fromJson.map((c) => ({ key: makeLocalKey(), name: c.name, email: c.email }));
  }
  const legacyName = placement?.billingContactName ?? "";
  const legacyEmail = placement?.billingContactEmail ?? "";
  if (legacyName || legacyEmail) {
    return [{ key: makeLocalKey(), name: legacyName, email: legacyEmail }];
  }
  return [];
}

// ---------------- Confirm Start dialog ----------------

function ConfirmStartDialog({
  placementId,
  jobTitle,
  onClose,
  onEditPlacement,
}: {
  placementId: string;
  jobTitle: string;
  onClose: () => void;
  // Called when Andrew wants to amend placement fields (fee, start date,
  // billing contacts) before actually confirming the start. Parent handles
  // the transition — we just close Confirm and let the parent open Edit.
  onEditPlacement: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  // Block the browser's default behavior of opening a dropped image in a new
  // tab if the user releases the mouse outside the dropzone. Use capture phase
  // so we preventDefault before any handler (inside or outside React) can react.
  useEffect(() => {
    const block = (e: Event) => {
      e.preventDefault();
    };
    window.addEventListener("dragenter", block, true);
    window.addEventListener("dragover", block, true);
    window.addEventListener("drop", block, true);
    return () => {
      window.removeEventListener("dragenter", block, true);
      window.removeEventListener("dragover", block, true);
      window.removeEventListener("drop", block, true);
    };
  }, []);

  function handleFile(f: File | null) {
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
    setErr(null);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    handleFile(e.target.files?.[0] ?? null);
  }

  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (!dragActive) setDragActive(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const dropped = e.dataTransfer?.files?.[0];
    if (!dropped) return;
    if (!dropped.type.startsWith("image/")) {
      setErr("Only image files are supported.");
      return;
    }
    handleFile(dropped);
  }

  async function onSave() {
    setErr(null);
    if (!file) {
      setErr("Upload a screenshot confirming the start.");
      return;
    }
    startSave(async () => {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const result = await confirmStart({ placementId, screenshotBase64: base64, mimeType: file.type || "image/png" });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't confirm start", { description: result.error });
        return;
      }
      toast.success("Start confirmed — candidate moved to Hired", {
        description: "Invoicing flag set. Invoice workflow lands later.",
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title="Confirm start" subtitle={jobTitle} onClose={onClose}>
      <p className="text-sm text-court-fg-muted">
        Upload a screenshot of the start confirmation (email, portal, HR tool). This seals the placement and flags it
        for invoicing.
      </p>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-court-border bg-court-surface-subtle/40 px-6 py-8 text-center transition hover:border-brand/40 hover:bg-brand-tint/20",
          (file || dragActive) && "border-brand/40 bg-brand-tint/20",
        )}
      >
        <UploadCloud className="h-5 w-5 text-court-fg-muted" />
        <div className="text-sm font-semibold text-court-fg">
          {file ? file.name : dragActive ? "Drop screenshot here" : "Click or drag a screenshot here"}
        </div>
        <div className="text-xs text-court-fg-muted">PNG / JPG up to 4MB</div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onPick}
        />
      </div>
      {previewUrl && (
        <div className="mt-3 overflow-hidden rounded-lg border border-court-border bg-court-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Start confirmation preview" className="max-h-64 w-full object-contain" />
        </div>
      )}
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel="Confirm start" />
      {/* Third location for the Edit Placement affordance (candidate profile
          + pipeline row are the other two). Sits below the primary Confirm
          Start footer so it never competes with the main action; distinctly
          outlined so it reads as secondary navigation, not a destructive
          button. Closes Confirm and hands off to the parent, which opens
          the pre-filled PlacementDialog for the same (candidate, job). */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-court-border bg-court-surface-subtle/40 px-3 py-2 text-xs">
        <span className="text-court-fg-muted">
          Need to fix the fee, start date, or billing contacts first?
        </span>
        <button
          type="button"
          onClick={() => {
            onClose();
            onEditPlacement();
          }}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-semibold text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg disabled:opacity-60"
        >
          <Edit3 className="h-3 w-3" /> Edit Placement
        </button>
      </div>
    </Modal>
  );
}

// ---------------- Schedule Interview dialog ----------------

function ScheduleInterviewDialog({
  candidateRef,
  candidateName,
  candidateEmail,
  job,
  aceTeam,
  onClose,
  onScheduled,
}: {
  candidateRef: { candidateRfId?: number; candidateId?: string };
  candidateName: string;
  candidateEmail?: string;
  job: PlacementContextJob;
  aceTeam: AceTeamContact[];
  onClose: () => void;
  onScheduled: (ctx: Omit<InviteFlowState, "step">) => void;
}) {
  void candidateEmail;
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [durationMin, setDurationMin] = useState<number>(30);
  const [type, setType] = useState<InterviewType>("video");
  const [interviewerName, setInterviewerName] = useState("");
  const [interviewerEmail, setInterviewerEmail] = useState("");
  const [location, setLocation] = useState("");
  const [ccCsv, setCcCsv] = useState("");
  const [bccCsv, setBccCsv] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setErr(null);
    if (!scheduledAt) {
      setErr("Pick a date and time.");
      return;
    }
    if (!interviewerName.trim()) {
      setErr("Interviewer name required.");
      return;
    }
    if (type === "in_person" && !location.trim()) {
      setErr("Address required for in-person interviews.");
      return;
    }
    startSave(async () => {
      const snapped = snapTo15Minutes(scheduledAt);
      const attendees = interviewerName.trim()
        ? [{ name: interviewerName.trim(), email: interviewerEmail.trim() }]
        : [];
      const result = await scheduleInterview({
        candidateRfId: candidateRef.candidateRfId ?? null,
        candidateId: candidateRef.candidateId ?? null,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        scheduledAt: snapped.toISOString(),
        durationMin,
        type,
        attendees,
        notes: notes.trim(),
        source: "ace_scheduled",
        jobTitle: job.jobTitle,
        clientName: job.clientName,
        candidateName,
        location: type === "in_person" ? location.trim() : undefined,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't schedule interview", { description: result.error });
        return;
      }
      void sendInterviewConfirmationEmail;
      onScheduled({
        interviewId: result.value.interviewId,
        scheduledAtISO: snapped.toISOString(),
        durationMin,
        type,
        meetLink: result.value.meetLink,
        interviewLocation: type === "in_person" ? location.trim() : "",
        jobTitle: job.jobTitle,
        jobLocation: job.jobLocation,
        jobDescription: job.jobDescription,
        jobSalaryRange: job.jobSalaryRange,
        clientName: job.clientName,
        clientWebsite: job.clientWebsite,
        clientLinkedIn: job.clientLinkedIn,
        clientContactName: interviewerName.trim(),
        clientContactEmail: interviewerEmail.trim(),
        ccEmails: parseEmailCsv(ccCsv),
        bccEmails: parseEmailCsv(bccCsv),
      });
    });
  }

  return (
    <Modal title="Schedule interview" subtitle={`${job.jobTitle} · ${job.clientName}`} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm sm:col-span-2">
            <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Date &amp; time</span>
            <DateTime15Picker
              value={scheduledAt}
              onChange={setScheduledAt}
              className="mt-1"
            />
          </label>
          <DurationSelect value={durationMin} onChange={setDurationMin} />
        </div>
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as InterviewType)}
            className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            <option value="phone_screen">Phone Screen</option>
            <option value="video">Video (Google Meet)</option>
            <option value="in_person">In-Person</option>
          </select>
        </label>
        {type === "in_person" && (
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Address</span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. 500 Main St, Suite 300, Columbus OH 43215"
              className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <span className="mt-1 block text-[11px] text-court-fg-muted">
              Appears in the calendar invite with a Map link.
            </span>
          </label>
        )}
        <InterviewerPicker
          clientRfId={job.clientRfId}
          clientName={job.clientName}
          initialContacts={job.clientContacts}
          name={interviewerName}
          email={interviewerEmail}
          onChange={(n, e) => {
            setInterviewerName(n);
            setInterviewerEmail(e);
          }}
        />
        <CcBccPicker
          clientContacts={job.clientContacts}
          aceTeam={aceTeam}
          cc={ccCsv}
          bcc={bccCsv}
          onCcChange={setCcCsv}
          onBccChange={setBccCsv}
        />
        <LabeledTextarea label="Notes" value={notes} onChange={setNotes} rows={3} />
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel="Schedule" />
    </Modal>
  );
}

// Snaps a datetime-local value (YYYY-MM-DDTHH:mm in local time) to the
// nearest 15-minute boundary. Defense in depth: the `step={900}` attribute
// forces browsers to expose only 15-min slots, but users can still type
// arbitrary values in some browsers, and the payload reaches the server
// regardless. This guarantees the stored time is always aligned.
function snapTo15Minutes(datetimeLocal: string): Date {
  const d = new Date(datetimeLocal);
  const ms = 15 * 60 * 1000;
  return new Date(Math.round(d.getTime() / ms) * ms);
}

function ClientInviteDialog({
  candidateRef,
  candidateName,
  job,
  onClose,
}: {
  candidateRef: { candidateRfId?: number; candidateId?: string };
  candidateName: string;
  job: PlacementContextJob;
  onClose: () => void;
}) {
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [durationMin, setDurationMin] = useState<number>(30);
  const [type, setType] = useState<InterviewType>("video");
  const [interviewerName, setInterviewerName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setErr(null);
    if (!scheduledAt) {
      setErr("Pick a date and time.");
      return;
    }
    if (type === "in_person" && !location.trim()) {
      setErr("Address required for in-person interviews.");
      return;
    }
    startSave(async () => {
      const attendees = interviewerName.trim() ? [{ name: interviewerName.trim(), email: "" }] : [];
      const result = await scheduleInterview({
        candidateRfId: candidateRef.candidateRfId ?? null,
        candidateId: candidateRef.candidateId ?? null,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        scheduledAt: snapTo15Minutes(scheduledAt).toISOString(),
        durationMin,
        type,
        attendees,
        notes: notes.trim(),
        source: "client_scheduled",
        jobTitle: job.jobTitle,
        clientName: job.clientName,
        candidateName,
        location: type === "in_person" ? location.trim() : undefined,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't record interview", { description: result.error });
        return;
      }
      toast.success("Logged client-scheduled interview", {
        description: "Added to your calendar for tracking. No invites were sent to candidate or client.",
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal
      title="Client sending invite"
      subtitle={`${job.jobTitle} · ${job.clientName}`}
      onClose={onClose}
    >
      <p className="mb-3 text-xs text-court-fg-muted">
        Use this when the client is scheduling the interview themselves and will send the invite. We&apos;ll
        log it for tracking and drop it on your calendar — no invite is sent to the candidate or client.
      </p>
      <div className="grid grid-cols-1 gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm sm:col-span-2">
            <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Date &amp; time</span>
            <DateTime15Picker value={scheduledAt} onChange={setScheduledAt} className="mt-1" />
          </label>
          <DurationSelect value={durationMin} onChange={setDurationMin} />
        </div>
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as InterviewType)}
            className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            <option value="phone_screen">Phone Screen</option>
            <option value="video">Video</option>
            <option value="in_person">In-Person</option>
          </select>
        </label>
        {type === "in_person" && (
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Address</span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. 500 Main St, Suite 300, Columbus OH 43215"
              className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
        )}
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Interviewer name (optional)</span>
          <input
            type="text"
            value={interviewerName}
            name={`ace-interviewer-name-${job.jobRfId}`}
            autoComplete="off"
            data-lpignore="true"
            data-form-type="other"
            onChange={(e) => setInterviewerName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <LabeledTextarea label="Notes" value={notes} onChange={setNotes} rows={3} />
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel="Log interview" />
    </Modal>
  );
}

function RescheduleDialog({
  interview,
  onClose,
}: {
  interview: InterviewSummary;
  onClose: () => void;
}) {
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState<string>(() => toDatetimeLocalValue(interview.scheduledAt));
  const [durationMin, setDurationMin] = useState<number>(interview.durationMin);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setErr(null);
    if (!scheduledAt) {
      setErr("Pick a date and time.");
      return;
    }
    startSave(async () => {
      const result = await rescheduleInterview({
        interviewId: interview.id,
        scheduledAt: snapTo15Minutes(scheduledAt).toISOString(),
        durationMin,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't reschedule", { description: result.error });
        return;
      }
      toast.success("Interview rescheduled");
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title="Reschedule interview" onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Date &amp; time</span>
          <DateTime15Picker
            value={scheduledAt}
            onChange={setScheduledAt}
            className="mt-1"
          />
        </label>
        <DurationSelect value={durationMin} onChange={setDurationMin} />
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel="Reschedule" />
    </Modal>
  );
}

// InterviewList + InterviewRow removed — past interviews no longer
// render on the row; the inline `formatNextInterview` text on the row
// title carries the next-upcoming interview only. Reschedule UX moved
// off the per-row strip; recruiters reschedule via Schedule again or
// the Quo / calendar surfaces.
function formatInterviewType(t: InterviewType): string {
  if (t === "phone_screen") return "Phone Screen";
  if (t === "video") return "Video";
  return "In-Person";
}

function formatInterviewWhen(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatInterviewDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatInterviewTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function toDatetimeLocalValue(iso: string): string {
  // Convert ISO into the local-time string shape `datetime-local` expects
  // (YYYY-MM-DDTHH:mm). The browser displays this in the user's local zone.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------- Reject dialog ----------------

function RejectDialog({
  candidateRfId,
  candidateFullName,
  job,
  onClose,
}: {
  candidateRfId: number;
  candidateFullName: string;
  job: PlacementContextJob;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();
  const [mode, setMode] = useState<null | "send" | "only">(null);

  const previousStage = job.placement?.stage ?? job.rfStageBucket;
  const nameLabel = candidateFullName || "this candidate";

  function run(sendEmail: boolean) {
    setErr(null);
    setMode(sendEmail ? "send" : "only");
    startSave(async () => {
      const result = await rejectCandidateJob({
        candidateRfId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        jobCuid: job.jobCuid,
        clientCuid: job.clientCuid,
        previousStage,
        reason: reason.trim(),
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't reject candidate", { description: result.error });
        setMode(null);
        return;
      }

      if (!sendEmail) {
        toast.success("Rejection recorded", { description: "No email sent." });
        onClose();
        router.refresh();
        return;
      }

      const emailResult = await sendRejectionEmail({
        candidateRfId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        jobTitle: job.jobTitle,
        clientCompanyName: job.clientName,
      });

      if (emailResult.ok) {
        const v = emailResult.value;
        if (v.status === "sent") {
          toast.success("Rejection email sent", {
            description: `Sent "${v.subject}" to ${v.to}.`,
          });
        } else if (v.status === "drafted") {
          toast.success("Rejection recorded", {
            description: "Auto-send disabled — draft saved to your Gmail Drafts.",
          });
        } else if (v.status === "skipped") {
          toast.success("Rejection recorded", {
            description:
              v.reason === "no_recipient"
                ? "No candidate email on file — email skipped."
                : v.reason === "missing"
                  ? "No Candidate Rejection template found. Set one in Settings."
                  : "Candidate Rejection template is inactive. Enable it in Settings to auto-send.",
          });
        } else {
          toast.success("Rejection recorded", {
            description: `Email send failed: ${v.error}`,
          });
        }
      } else {
        toast.success("Rejection recorded", {
          description: `Email send failed: ${emailResult.error}`,
        });
      }

      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title="Reject candidate" subtitle={`${job.jobTitle} · ${job.clientName}`} onClose={onClose}>
      <p className="text-sm text-court-fg">
        <span className="font-semibold">Reject {nameLabel} for {job.jobTitle}?</span>
      </p>
      <p className="mt-2 text-xs text-court-fg-muted">
        Pick one: <span className="font-semibold text-court-fg">Reject &amp; Send Email</span> runs your Candidate Rejection
        template to the candidate. <span className="font-semibold text-court-fg">Reject Only</span> updates the stage with no
        email sent. Either way the stage moves to Rejected.
      </p>
      <div className="mt-3">
        <LabeledTextarea label="Internal reason (optional — not sent)" value={reason} onChange={setReason} rows={3} />
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-court-border pt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => run(false)}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-court-surface px-3 py-2 text-xs font-semibold text-red-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 grass:hover:bg-red-900/30 disabled:opacity-60"
        >
          {isPending && mode === "only" ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
          Reject Only
        </button>
        <button
          type="button"
          onClick={() => run(true)}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
        >
          {isPending && mode === "send" ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
          Reject &amp; Send Email
        </button>
      </div>
    </Modal>
  );
}

// ---------------- Unreject dialog ----------------

function UnrejectDialog({
  candidateRfId,
  job,
  onClose,
}: {
  candidateRfId: number;
  job: PlacementContextJob;
  onClose: () => void;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  // We don't currently store the pre-rejection stage locally, so fall back to
  // "submitted" per the UX spec.
  const targetStage = "submitted";

  function onConfirm() {
    setErr(null);
    startSave(async () => {
      const result = await unrejectCandidateJob({
        candidateRfId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        jobCuid: job.jobCuid,
        clientCuid: job.clientCuid,
        targetStage,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't reactivate candidate", { description: result.error });
        return;
      }
      toast.success("Candidate reactivated");
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title="Reactivate candidate" subtitle={`${job.jobTitle} · ${job.clientName}`} onClose={onClose}>
      <p className="text-sm text-court-fg-muted">
        Reactivating sends this candidate back into the pipeline at{" "}
        <strong>{PIPELINE_LABELS[targetStage]}</strong> and logs the action to activity.
      </p>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onConfirm} saving={isPending} saveLabel="Reactivate" />
    </Modal>
  );
}

// ---------------- Cancel Placement dialog ----------------

const CANCEL_REASONS = [
  { value: "candidate_resigned", label: "Candidate Resigned" },
  { value: "client_terminated", label: "Client Terminated" },
  { value: "failed_background_check", label: "Failed Background Check" },
  { value: "other", label: "Other" },
] as const;

type CancelReasonValue = (typeof CANCEL_REASONS)[number]["value"];

function CancelPlacementDialog({
  placementId,
  jobTitle,
  clientName,
  onClose,
}: {
  placementId: string;
  jobTitle: string;
  clientName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState<CancelReasonValue>("candidate_resigned");
  const [detail, setDetail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onConfirm() {
    setErr(null);
    if (reason === "other" && !detail.trim()) {
      setErr("Please describe the reason.");
      return;
    }
    startSave(async () => {
      const result = await cancelPlacement({ placementId, reason, detail: detail.trim() });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't cancel placement", { description: result.error });
        return;
      }
      toast.success("Placement cancelled", {
        description: "Candidate moved out of Hired. Reason logged to activity.",
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title="Cancel placement" subtitle={`${jobTitle}${clientName ? ` · ${clientName}` : ""}`} onClose={onClose}>
      <p className="text-sm text-court-fg-muted">
        This moves the candidate out of Hired and logs the cancellation. Invoicing flag is cleared; the placement
        record is kept for audit.
      </p>

      <label className="mt-4 block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Reason</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as CancelReasonValue)}
          className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          {CANCEL_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3">
        <LabeledTextarea
          label={reason === "other" ? "Details (required)" : "Details (optional)"}
          value={detail}
          onChange={setDetail}
          rows={3}
        />
      </div>

      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onConfirm} saving={isPending} saveLabel="Cancel placement" />
    </Modal>
  );
}

// ---------------- Apply to Job flow ----------------
//
// Simpler than Submit: no email composer, just pick an open job and we push
// the candidate to RF at stage "Applied". Intended for self-apply or
// lightweight tracking where no external email goes out.

function ApplyToJobDialog({
  candidateRfId,
  openJobs,
  onClose,
}: {
  candidateRfId: number;
  openJobs: OpenJobOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  const picked = openJobs.find((o) => String(o.jobRfId) === selectedId) ?? null;
  const hasAvailable = openJobs.some((j) => !j.alreadyLinked);

  function onSave() {
    setErr(null);
    if (!picked) {
      setErr("Pick an open job to apply to.");
      return;
    }
    if (picked.alreadyLinked) {
      setErr("Candidate is already linked to this job.");
      return;
    }
    startSave(async () => {
      const result = await applyCandidateToJob({
        candidateRfId,
        jobRfId: picked.jobRfId,
        clientRfId: picked.clientRfId,
        jobCuid: picked.jobCuid,
        clientCuid: picked.clientCuid,
        jobTitle: picked.jobTitle,
        clientName: picked.clientName,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't apply candidate", { description: result.error });
        return;
      }
      if (!result.value.placementId) {
        const msg = "No Placement record was created — candidate won't appear on the Pipeline.";
        setErr(msg);
        toast.error("Apply failed silently", { description: msg });
        return;
      }
      toast.success("Candidate applied", {
        description: `${picked.jobTitle}${picked.clientName ? ` · ${picked.clientName}` : ""} → Applied stage.`,
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title="Apply to Job" subtitle="Pick an open job — no email goes out." onClose={onClose}>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Open job</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="">Select a job…</option>
          {openJobs.map((j) => (
            <option key={j.jobRfId} value={String(j.jobRfId)} disabled={j.alreadyLinked}>
              {j.clientName ? `${j.clientName} — ${j.jobTitle}` : j.jobTitle}
              {j.alreadyLinked ? " (already linked)" : ""}
            </option>
          ))}
        </select>
      </label>
      {!hasAvailable && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          This candidate is already linked to every open job.
        </div>
      )}
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel="Apply" />
    </Modal>
  );
}

// ---------------- Submit to Job flow ----------------
//
// Two-step UX: pick the open job, then compose the submittal email. After
// sending, the candidate confirmation ("Great News…") is auto-drafted in
// Gmail for the recruiter to review and send manually.

function SubmitToJobDialog({
  candidateRfId,
  candidateFirstName,
  candidateLastName,
  candidateEmail,
  openJobs,
  initialJobRfId,
  onClose,
}: {
  candidateRfId: number;
  candidateFirstName: string;
  candidateLastName: string;
  candidateEmail: string;
  openJobs: OpenJobOption[];
  // When set (e.g. via the ?compose=submittal&jobId=X deep link from
  // the Applicants page or the Job-page pipeline row), skip the
  // job-picker step entirely and open the composer for that job.
  initialJobRfId?: number;
  onClose: () => void;
}) {
  const router = useRouter();
  // Pre-seed the picker selection AND the composer flag from the
  // deep-link prop so the user lands directly in compose.
  const initialPick = initialJobRfId
    ? openJobs.find((o) => o.jobRfId === initialJobRfId) ?? null
    : null;
  const [selectedId, setSelectedId] = useState<string>(
    initialPick ? String(initialPick.jobRfId) : "",
  );
  const [err, setErr] = useState<string | null>(null);
  const [composing, setComposing] = useState<boolean>(Boolean(initialPick));

  const picked = openJobs.find((o) => String(o.jobRfId) === selectedId) ?? null;

  function onPickJob() {
    setErr(null);
    if (!picked) {
      setErr("Pick an open job to submit to.");
      return;
    }
    // alreadyLinked is surfaced informationally on each option but no
    // longer blocks selection — recruiters sometimes want to send a
    // fresh submittal even when the candidate is already tracked on
    // the job (e.g. re-submitting after a client request).
    setComposing(true);
  }

  if (composing && picked) {
    return (
      <SubmittalEmailCompose
        candidateRfId={candidateRfId}
        candidateFirstName={candidateFirstName}
        candidateLastName={candidateLastName}
        candidateEmail={candidateEmail}
        job={picked}
        onBack={() => setComposing(false)}
        onDone={() => {
          onClose();
          router.refresh();
        }}
      />
    );
  }

  return (
    <Modal title="Submit to Job" subtitle="Pick an open job for this candidate" onClose={onClose}>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Open job</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="">Select a job…</option>
          {openJobs.map((j) => (
            <option key={j.jobRfId} value={String(j.jobRfId)}>
              {j.clientName ? `${j.clientName} — ${j.jobTitle}` : j.jobTitle}
              {j.alreadyLinked ? " (already linked)" : ""}
            </option>
          ))}
        </select>
      </label>
      {picked && (
        <div className="mt-3 rounded-lg border border-court-border bg-court-surface-subtle/60 p-3 text-xs text-court-fg">
          <div className="font-semibold">{picked.jobTitle}</div>
          <div className="text-court-fg-muted">{picked.clientName || "—"}</div>
          <div className="mt-1 text-[11px] text-court-fg-muted">
            {picked.clientContacts.length > 0
              ? `${picked.clientContacts.length} contact${picked.clientContacts.length === 1 ? "" : "s"} on file — first becomes the To:, rest are Cc.`
              : "No client contacts on file — you'll need to enter the recipient manually."}
          </div>
        </div>
      )}
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onPickJob} saving={false} saveLabel="Continue" />
    </Modal>
  );
}

function SubmittalEmailCompose({
  candidateRfId,
  candidateFirstName,
  candidateLastName,
  candidateEmail,
  job,
  onBack,
  onDone,
}: {
  candidateRfId: number;
  candidateFirstName: string;
  candidateLastName: string;
  candidateEmail: string;
  job: OpenJobOption;
  onBack: () => void;
  onDone: () => void;
}) {
  const fullName = [candidateFirstName, candidateLastName].filter(Boolean).join(" ") || candidateFirstName;
  const subject = `Candidate Submittal - ${fullName} | ${job.jobTitle}`;
  const contactOptions = job.clientContacts.map((c) => ({
    id: String(c.id),
    name: c.name,
    email: c.email,
  }));

  const [resumeOptions, setResumeOptions] = useState<SubmittalResumeOption[]>([]);
  const [resumeLoaded, setResumeLoaded] = useState(false);
  const [resumeVariant, setResumeVariant] = useState<SubmittalResumeVariant | null>(null);
  // Per-send override on the candidate confirmation email. Defaults ON so
  // the current behavior (send submittal → auto-follow-up to the candidate)
  // stays the path of least friction; unchecking lets the recruiter ship
  // just the client-facing submittal for the one send where the candidate
  // doesn't need a follow-up (e.g. they already know, or Andrew is texting).
  // Overrides the Settings-level auto-send/draft preference — when this is
  // OFF we skip the deliverCandidateConfirmation call entirely.
  const [sendCandidateConfirmation, setSendCandidateConfirmation] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listSubmittalResumeOptions(candidateRfId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setResumeOptions(res.value);
        // Default selection: branded if available, else original, else none.
        const branded = res.value.find((o) => o.variant === "branded");
        const original = res.value.find((o) => o.variant === "original");
        setResumeVariant(branded?.variant ?? original?.variant ?? null);
      }
      setResumeLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [candidateRfId]);

  const hasResume = resumeOptions.length > 0;
  const selectedOption = resumeVariant
    ? resumeOptions.find((o) => o.variant === resumeVariant) ?? null
    : null;
  const sendBlocked = resumeLoaded && !hasResume;

  return (
    <EmailComposer
      title="Submittal email"
      subtitle={`${fullName} → ${job.jobTitle}${job.clientName ? ` · ${job.clientName}` : ""}`}
      initial={{
        to: [],
        cc: [],
        bcc: [],
        subject,
        body: "",
      }}
      recipientOptions={contactOptions}
      onClose={onBack}
      sendLabel="Send Submittal"
      sendingLabel="Sending…"
      helperText="Pick a client contact, then Generate with Claude. Cmd+B / Cmd+U toggle bold and underline in the editor — Gmail renders them as real bold / underline."
      showTemplatePicker
      enableEditWithClaude
      richTextBody
      toEditorHtml={submittalMarkdownToEditorHtml}
      templateFilter={(t) => t.audience !== "candidate"}
      sendDisabled={sendBlocked}
      sendDisabledReason={sendBlocked ? "No resume uploaded for this candidate — upload one before sending." : undefined}
      attachmentsSlot={
        <div className="space-y-3">
          <SubmittalResumeAttachmentPicker
            loaded={resumeLoaded}
            options={resumeOptions}
            selected={resumeVariant}
            onSelect={setResumeVariant}
            selectedOption={selectedOption}
          />
          {/* Per-send toggle for the candidate follow-up. Sits directly
              above the Send Submittal button (attachmentsSlot is the
              composer's row above the footer) so the recruiter sees the
              current state at send time. Defaults ON; flipping OFF skips
              deliverCandidateConfirmation for this one send only. */}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-court-border bg-court-surface-subtle/30 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={sendCandidateConfirmation}
              onChange={(e) => setSendCandidateConfirmation(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-court-border text-brand focus:ring-brand/30"
            />
            <span className="flex-1">
              <span className="font-semibold text-court-fg">Send candidate confirmation email</span>
              <span className="block text-court-fg-muted">
                {sendCandidateConfirmation
                  ? "After the submittal sends, auto-fires the candidate confirmation using the Settings-level send/draft preference."
                  : "Turned off for this send only — only the client submittal will go out; no candidate follow-up."}
              </span>
            </span>
          </label>
        </div>
      }
      resolveTemplate={(t) => {
        const primaryContact = job.clientContacts.find((c) => c.email) ?? null;
        const primaryContactFirst = primaryContact?.name?.trim().split(/\s+/)[0] ?? "";
        const values = {
          candidateFirstName,
          candidateLastName,
          candidateFullName: fullName,
          candidateEmail,
          clientCompanyName: job.clientName,
          clientContactFullName: primaryContact?.name ?? "",
          clientContactFirstName: primaryContactFirst,
          jobTitle: job.jobTitle,
        };
        return {
          subject: applyMergeFieldsClient(t.subject, values),
          body: applyMergeFieldsClient(t.body, values),
        };
      }}
      onGenerate={async () => {
        // Same pattern as the working Summarize buttons on the clients page:
        // direct server-action call, read result.value, no fetch / no route
        // handler / no content-type shenanigans.
        const primaryContact = job.clientContacts.find((c) => c.email) ?? null;
        const primaryContactFirst = primaryContact?.name?.trim().split(/\s+/)[0] ?? "";
        const result = await generateSubmittal({
          candidateRfId,
          jobRfId: job.jobRfId,
          jobTitle: job.jobTitle,
          clientName: job.clientName,
          clientContactFirstName: primaryContactFirst,
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
        return result.value.text;
      }}
      onSend={async (draft: EmailDraft) => {
        const result = await sendSubmittalEmail({
          candidateRfId,
          jobRfId: job.jobRfId,
          clientRfId: job.clientRfId,
          jobCuid: job.jobCuid,
          clientCuid: job.clientCuid,
          jobTitle: job.jobTitle,
          clientName: job.clientName,
          to: draft.to,
          cc: draft.cc,
          subject: draft.subject,
          body: draft.body,
          bodyHtml: draft.bodyHtml,
          attachment: resumeVariant ? { variant: resumeVariant } : null,
        });
        if (!result.ok) throw new Error(result.error);
        // Hard check: the server must return a placementId. If it didn't, the
        // local Placement write silently failed — surface it loudly instead
        // of pretending the submit worked.
        if (!result.value.placementId) {
          throw new Error(
            "Submittal email sent, but no Placement record was created in Ace. The candidate will not appear on the Pipeline. Please report this.",
          );
        }

        if (!sendCandidateConfirmation) {
          // Recruiter explicitly opted out for this send. Skip the follow-up
          // server action entirely — this overrides the Settings-level auto-
          // send/draft preference for this one submittal.
          toast.success("Submittal sent", {
            description: "Candidate confirmation turned off — only the client email went out.",
          });
        } else if (candidateEmail) {
          const primaryContact = job.clientContacts.find((c) => c.email) ?? null;
          const primaryFirst = primaryContact?.name?.trim().split(/\s+/)[0] ?? "";
          const confirmResult = await deliverCandidateConfirmation({
            candidateRfId,
            candidateEmail,
            candidateFirstName,
            candidateLastName,
            jobRfId: job.jobRfId,
            clientRfId: job.clientRfId,
            clientCompanyName: job.clientName,
            clientContactFullName: primaryContact?.name ?? "",
            clientContactFirstName: primaryFirst,
            jobTitle: job.jobTitle,
          });
          if (confirmResult.ok) {
            toast.success("Submittal sent", {
              description:
                confirmResult.value.mode === "sent"
                  ? "Candidate confirmation auto-sent."
                  : "Candidate confirmation saved to your Gmail Drafts — review and send.",
            });
          } else {
            toast.success("Submittal sent", {
              description: `Candidate confirmation failed: ${confirmResult.error}`,
            });
          }
        } else {
          toast.success("Submittal sent", {
            description: "No candidate email on file — skipped the confirmation.",
          });
        }
        onDone();
      }}
    />
  );
}

function SubmittalResumeAttachmentPicker({
  loaded,
  options,
  selected,
  onSelect,
  selectedOption,
}: {
  loaded: boolean;
  options: SubmittalResumeOption[];
  selected: SubmittalResumeVariant | null;
  onSelect: (v: SubmittalResumeVariant | null) => void;
  selectedOption: SubmittalResumeOption | null;
}) {
  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-court-fg-muted">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading resumes…
      </div>
    );
  }
  if (options.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <UploadCloud className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <div className="font-semibold">No resume uploaded</div>
          <div>Upload one on the candidate profile before sending this submittal.</div>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Resume attachment
        </div>
        {selectedOption && (
          <div className="text-[11px] text-court-fg-muted">
            {formatBytes(selectedOption.size)} · uploaded {formatDate(selectedOption.uploadedAt)}
          </div>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {options.map((o) => (
          <label
            key={o.variant}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs transition",
              selected === o.variant
                ? "border-brand bg-brand-tint"
                : "border-court-border bg-court-surface hover:border-brand/40",
            )}
          >
            <input
              type="radio"
              name="submittal-resume-variant"
              checked={selected === o.variant}
              onChange={() => onSelect(o.variant)}
              className="mt-0.5 h-3.5 w-3.5 text-brand focus:ring-brand/30"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium text-court-fg">{o.label}</span>
              <span className="truncate text-[11px] text-court-fg-muted">
                {o.filename} · {formatBytes(o.size)} · {formatDate(o.uploadedAt)}
              </span>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------- Shared ----------------

function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className={cn(
          "w-full overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-xl",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-court-border px-5 py-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-court-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-court-fg-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({
  onCancel,
  onSave,
  saving,
  saveLabel = "Save",
}: {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel?: string;
}) {
  const lowered = saveLabel.toLowerCase();
  const SaveIcon = lowered === "reject"
    ? UserX
    : lowered === "reactivate"
      ? RotateCcw
      : Save;
  // Variant chooses by intent so "Apply" → amber chip, "Reject" →
  // red chip, everything else → primary green. Keeps the hierarchy
  // consistent across every modal that uses this footer.
  const variant: "primary" | "apply" | "danger" =
    lowered === "apply" ? "apply" : lowered === "reject" ? "danger" : "primary";
  return (
    <div className="mt-5 flex items-center justify-end gap-2 border-t border-court-border pt-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
      >
        <X className="h-3 w-3" /> Cancel
      </button>
      <Button
        type="button"
        size="sm"
        variant={variant}
        onClick={onSave}
        disabled={saving}
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <SaveIcon className="h-3 w-3" />}
        {saveLabel}
      </Button>
    </div>
  );
}

function NumericField({
  label,
  value,
  onChange,
  placeholder,
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: number;
  step?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        step={step}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "") {
            onChange("");
            return;
          }
          const n = Number(next);
          if (Number.isNaN(n)) return;
          if (min != null && n < min) return;
          onChange(next);
        }}
        className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}

function parseCompensation(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/[\s,$]/g, "");
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === "k") n *= 1000;
  if (m[2] === "m") n *= 1_000_000;
  return Math.round(n);
}

function formatMoney(n: number | null, currency: string): string {
  if (!n) return "—";
  const sym = (currency || "USD").toUpperCase() === "USD" ? "$" : `${currency.toUpperCase()} `;
  return `${sym}${n.toLocaleString()}`;
}

// Shown alongside the success toast when Google Meet refused to set
// accessType=OPEN — usually a missing OAuth scope. The interview itself is
// valid; users just need to re-grant Meet permissions for future invites
// to auto-open the room.
function surfaceMeetWarning(warning: { reason: string; message: string }): void {
  if (warning.reason === "scope_missing") {
    toast.warning("Meet locked to TRUSTED access", {
      description:
        "Google hasn't granted the Meet settings permission yet. Revoke Ace at myaccount.google.com/permissions, sign in again, and new interviews will default to Anyone-can-join.",
      duration: 12_000,
    });
  } else {
    toast.warning("Meet access stayed TRUSTED", {
      description: warning.message,
      duration: 12_000,
    });
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

// ---------------- Interview invite composers ----------------

function buildInterviewMergeValues(args: {
  invite: InviteFlowState;
  candidate: CandidateInviteContext;
  recruiter: { firstName: string; fullName: string; email: string; phone: string };
}) {
  const candidateFullName = [args.candidate.firstName, args.candidate.lastName].filter(Boolean).join(" ");
  const when = new Date(args.invite.scheduledAtISO);
  return {
    // Candidate
    candidateFirstName: args.candidate.firstName,
    candidateLastName: args.candidate.lastName,
    candidateFullName,
    candidateEmail: args.candidate.email,
    candidatePhone: args.candidate.phone,
    candidateLocation: args.candidate.location,
    candidateCurrentTitle: args.candidate.currentTitle,
    candidateCurrentEmployer: args.candidate.currentEmployer,
    // Client
    clientCompanyName: args.invite.clientName,
    clientCompanyWebsite: args.invite.clientWebsite,
    clientCompanyLinkedIn: args.invite.clientLinkedIn,
    clientContactFirstName: args.invite.clientContactName.split(/\s+/)[0] ?? "",
    clientContactFullName: args.invite.clientContactName,
    clientContactEmail: args.invite.clientContactEmail,
    // Job
    jobTitle: args.invite.jobTitle,
    jobLocation: args.invite.jobLocation,
    jobDescription: args.invite.jobDescription,
    jobSalaryRange: args.invite.jobSalaryRange,
    // Interview
    interviewDate: formatInterviewDate(when),
    interviewTime: formatInterviewTime(when),
    interviewDateTime: formatInterviewWhen(when),
    interviewDuration: `${args.invite.durationMin} min`,
    interviewType: formatInterviewType(args.invite.type),
    interviewLocation: args.invite.interviewLocation,
    interviewMeetLink: args.invite.meetLink ?? "",
    interviewerName: args.invite.clientContactName,
    interviewerEmail: args.invite.clientContactEmail,
    // Recruiter
    recruiterFirstName: args.recruiter.firstName,
    recruiterFullName: args.recruiter.fullName,
    recruiterName: args.recruiter.fullName,
    recruiterEmail: args.recruiter.email,
    recruiterPhone: args.recruiter.phone,
  };
}

function fallbackClientSubject(invite: InviteFlowState, candidateFull: string): string {
  return `Interview Confirmed - ${candidateFull || "Candidate"} for ${invite.jobTitle}`;
}

function fallbackCandidateSubject(invite: InviteFlowState): string {
  return `You're confirmed - ${invite.jobTitle} with ${invite.clientName}`;
}

function fallbackBody(invite: InviteFlowState, who: "client" | "candidate", candidateFull: string): string {
  const when = formatInterviewWhen(new Date(invite.scheduledAtISO));
  const type = formatInterviewType(invite.type);
  const addr = invite.type === "in_person" && invite.interviewLocation
    ? `\n• Location: ${invite.interviewLocation}`
    : "";
  // For video interviews, spell out the Meet join URL in the body so
  // the candidate (and client) can click straight through from the
  // email body — Gmail's calendar-invite rendering shows a Join button
  // too, but the body copy is what ends up pasted into reminder
  // emails, SMS confirmations, and forwarded threads. Only shows up
  // once invite.meetLink is populated (i.e., after the client invite
  // has been sent and returned its Meet link).
  const meet = invite.type === "video" && invite.meetLink
    ? `\n• Join on Google Meet: ${invite.meetLink}`
    : "";
  if (who === "client") {
    const first = invite.clientContactName.split(/\s+/)[0] || "there";
    return (
      `Hi ${first},\n\nConfirming the interview with ${candidateFull || "the candidate"} for the ${invite.jobTitle} role. ` +
      `The calendar invite is on its way.\n\n` +
      `• When: ${when}\n• Duration: ${invite.durationMin} min\n• Format: ${type}${addr}${meet}\n\n` +
      `Reply to this email if anything needs to change.`
    );
  }
  return (
    `Hi ${candidateFull.split(/\s+/)[0] || "there"},\n\n` +
    `You are confirmed for your ${type} interview with ${invite.clientName} for the ${invite.jobTitle} role. ` +
    `The calendar invite is on its way.\n\n` +
    `• When: ${when}\n• Duration: ${invite.durationMin} min\n• Format: ${type}${addr}${meet}\n\n` +
    `Good luck!`
  );
}

function ClientInviteComposer({
  invite,
  candidate,
  recruiter,
  clientContacts,
  aceTeam,
  onDone,
}: {
  invite: InviteFlowState;
  candidate: CandidateInviteContext;
  recruiter: { firstName: string; fullName: string; email: string; phone: string };
  clientContacts: ClientContactRef[];
  aceTeam: AceTeamContact[];
  // Returns the Meet link the server ended up using (either freshly
  // minted on this send, or the existing one re-attached) so the
  // parent can thread it into the candidate composer.
  onDone: (meetLink: string | null) => void;
}) {
  const candidateFullName = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ");
  const values = buildInterviewMergeValues({ invite, candidate, recruiter });
  const hasClient = Boolean(invite.clientContactEmail);
  const ccPickerOptions = buildCcBccOptions(clientContacts);
  const bccPickerOptions = aceTeam.map((m) => ({ id: m.id, name: m.name, email: m.email }));
  return (
    <EmailComposer
      title="Send client calendar invite"
      subtitle={`${invite.jobTitle} · ${invite.clientName}`}
      draftKey={`interview-invite-${invite.interviewId}-client`}
      initial={{
        to: hasClient ? [invite.clientContactEmail] : [],
        cc: invite.ccEmails,
        bcc: invite.bccEmails,
        subject: applyMergeFieldsClient(fallbackClientSubject(invite, candidateFullName), values),
        body: applyMergeFieldsClient(fallbackBody(invite, "client", candidateFullName), values),
      }}
      showTemplatePicker
      templateFilter={(t) => t.category === "interview"}
      resolveTemplate={(t) => ({
        subject: applyMergeFieldsClient(t.subject, values),
        body: applyMergeFieldsClient(t.body, values),
      })}
      ccOptions={ccPickerOptions}
      bccOptions={bccPickerOptions}
      mergeValues={values}
      helperText="Subject becomes the calendar event title; body becomes the event description. Sending adds the client to the event — Google emails them the native invite with Accept / Maybe / Decline."
      sendLabel="Send Invite"
      sendingLabel="Sending invite…"
      onClose={() => onDone(null)}
      onSend={async (draft: EmailDraft) => {
        if (draft.to.length === 0) {
          toast.error("Add a client contact email", { description: "The recipient list is empty." });
          throw new Error("No recipient");
        }
        const result = await sendInterviewInvite({
          interviewId: invite.interviewId,
          party: "client",
          attendeeEmail: draft.to[0],
          attendeeName: invite.clientContactName || undefined,
          ccEmails: draft.cc,
          bccEmails: draft.bcc,
          subject: draft.subject,
          bodyText: draft.body,
        });
        if (!result.ok) {
          toast.error("Client invite failed", { description: result.error });
          throw new Error(result.error);
        }
        toast.success("Client calendar invite sent", {
          description: "They'll see Accept / Maybe / Decline in their inbox.",
        });
        if (result.value.meetAccessWarning) surfaceMeetWarning(result.value.meetAccessWarning);
        onDone(result.value.meetLink);
      }}
    />
  );
}

function CandidateInviteComposer({
  invite,
  candidate,
  recruiter,
  clientContacts,
  aceTeam,
  onDone,
}: {
  invite: InviteFlowState;
  candidate: CandidateInviteContext;
  recruiter: { firstName: string; fullName: string; email: string; phone: string };
  clientContacts: ClientContactRef[];
  aceTeam: AceTeamContact[];
  onDone: () => void;
}) {
  const candidateFullName = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ");
  const candidateEmail = candidate.email;
  const values = buildInterviewMergeValues({ invite, candidate, recruiter });
  const ccPickerOptions = buildCcBccOptions(clientContacts);
  const bccPickerOptions = aceTeam.map((m) => ({ id: m.id, name: m.name, email: m.email }));
  return (
    <EmailComposer
      title="Send candidate calendar invite"
      subtitle={`${invite.jobTitle} · ${invite.clientName}`}
      draftKey={`interview-invite-${invite.interviewId}-candidate`}
      initial={{
        to: candidateEmail ? [candidateEmail] : [],
        cc: invite.ccEmails,
        bcc: invite.bccEmails,
        subject: applyMergeFieldsClient(fallbackCandidateSubject(invite), values),
        body: applyMergeFieldsClient(fallbackBody(invite, "candidate", candidateFullName), values),
      }}
      showTemplatePicker
      templateFilter={(t) => t.category === "interview"}
      resolveTemplate={(t) => ({
        subject: applyMergeFieldsClient(t.subject, values),
        body: applyMergeFieldsClient(t.body, values),
      })}
      ccOptions={ccPickerOptions}
      bccOptions={bccPickerOptions}
      mergeValues={values}
      helperText="Subject becomes the calendar event title; body becomes the event description. Sending adds the candidate to the event — Google emails them the native invite with Accept / Maybe / Decline."
      sendLabel="Send Invite"
      sendingLabel="Sending…"
      onClose={onDone}
      onSend={async (draft: EmailDraft) => {
        if (draft.to.length === 0) {
          toast.error("Add a candidate email", { description: "No email on file for this candidate." });
          throw new Error("No recipient");
        }
        const result = await sendInterviewInvite({
          interviewId: invite.interviewId,
          party: "candidate",
          attendeeEmail: draft.to[0],
          attendeeName: candidateFullName || undefined,
          ccEmails: draft.cc,
          bccEmails: draft.bcc,
          subject: draft.subject,
          bodyText: draft.body,
        });
        if (!result.ok) {
          toast.error("Candidate invite failed", { description: result.error });
          throw new Error(result.error);
        }
        toast.success("Candidate calendar invite sent", {
          description: "They'll see Accept / Maybe / Decline in their inbox.",
        });
        if (result.value.meetAccessWarning) surfaceMeetWarning(result.value.meetAccessWarning);
        onDone();
      }}
    />
  );
}

// Austin Barnard is always in the Cc/Bcc quick-pick slot regardless of
// whether the client has him on file — it's a shortcut for the Ops loop.
export const AUSTIN_PINNED_CONTACT = {
  id: "U0AJB4AM631",
  name: "Austin Barnard",
  email: "austin@breakpointtalent.com",
};

// 15-min-stepped duration picker. Matches the DateTime15Picker so scheduled
// interviews never end at :07 or :53 — Google Calendar handles odd intervals
// fine but recruiters expect 15/30/45 increments.
const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 105, 120] as const;

export function DurationSelect({
  value,
  onChange,
  label = "Duration",
}: {
  value: number;
  onChange: (n: number) => void;
  label?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      >
        {DURATION_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n} min
          </option>
        ))}
      </select>
    </label>
  );
}

export function parseEmailCsv(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildCcBccOptions(
  clientContacts: ClientContactRef[],
): { id: string; name: string; email: string }[] {
  return clientContacts
    .filter((c) => c.email)
    .map((c) => ({ id: String(c.id), name: c.name, email: c.email }));
}

// Pre-composer Cc / Bcc picker shown on the Schedule Interview dialog.
// Same semantics as the composer's Cc/Bcc (multi-select contacts with a
// pinned quick-pick row + free-text entry) but emits CSV strings so the
// existing state model doesn't need to change.
export function CcBccPicker({
  clientContacts,
  aceTeam,
  cc,
  bcc,
  onCcChange,
  onBccChange,
}: {
  clientContacts: ClientContactRef[];
  aceTeam: AceTeamContact[];
  cc: string;
  bcc: string;
  onCcChange: (v: string) => void;
  onBccChange: (v: string) => void;
}) {
  // Cc draws from the current job's CLIENT contacts only — a Cc'd
  // recipient is openly looped on the thread, so it should be someone
  // the candidate would expect to see on the email. Bcc draws from
  // ACE TEAM members only (Andrew, Austin, etc.) so the recruiter
  // can keep ops/colleagues informed without exposing them on the
  // visible header. The two pools are intentionally disjoint.
  const ccPickerOptions = buildCcBccOptions(clientContacts);
  const bccPickerOptions = aceTeam.map((m) => ({ id: m.id, name: m.name, email: m.email }));
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          Cc (optional) · client contacts
        </span>
        <InlineContactMultiInput
          value={cc}
          onChange={onCcChange}
          options={ccPickerOptions}
          placeholder="Pick a client contact or type email…"
        />
      </label>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          Bcc (optional) · Ace team
        </span>
        <InlineContactMultiInput
          value={bcc}
          onChange={onBccChange}
          options={bccPickerOptions}
          placeholder="Pick a teammate or type email…"
        />
      </label>
    </div>
  );
}

// One row in the dropdown. Uses onMouseDown + preventDefault so the
// toggle commits BEFORE the typed input's blur handler fires; without
// this the blur ran addTyped with the pre-toggle `selected` closure
// and the parent's onChange got called with the stale value, racing
// the click-driven toggle and dropping the chip.
function PickerOption({
  name,
  email,
  checked,
  onToggle,
}: {
  name: string;
  email: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseDown={(e) => {
          if (!email) return;
          e.preventDefault();
          onToggle();
        }}
        disabled={!email}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-court-fg hover:bg-brand-tint disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
            checked ? "border-brand bg-brand text-white" : "border-court-border bg-court-surface",
          )}
        >
          {checked && (
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 6.5l2.5 2.5L10 3" />
            </svg>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{name}</span>
          <span className="truncate text-[11px] text-court-fg-muted">
            {email || "No email on file"}
          </span>
        </span>
      </button>
    </li>
  );
}

// Smaller sibling of the composer's ContactComboMulti that lives outside
// a modal. Intentionally duplicated (not imported from email-composer.tsx)
// to keep the composer module's client dependency tree focused on email
// concerns. Exported so the Ace-native Submit modal can reuse the same
// picker semantics (same chip rendering, same rapid-click-safe latest-
// value ref, same dropdown close-on-outside-click behaviour).
export function InlineContactMultiInput({
  value,
  onChange,
  options,
  pinned,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string; email: string }[];
  pinned?: { id: string; name: string; email: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const selected = new Set(parseEmailCsv(value));
  const pinnedList = pinned ?? [];
  const pinnedEmails = new Set(pinnedList.map((p) => p.email.toLowerCase()));
  const rest = options.filter((o) => !pinnedEmails.has(o.email.toLowerCase()));

  // Ref holds the authoritative chip string in sync with mutations.
  // Rapid-fire clicks on dropdown options (pick contact A, then B
  // before React re-renders) used to lose the first chip because the
  // second click's handler still saw the stale `selected` closure
  // derived from the unchanged prop `value`. We now read and write
  // through the ref so each mutation sees the freshest state.
  const latestValueRef = useRef(value);
  latestValueRef.current = value;

  function commit(next: Set<string>) {
    const joined = Array.from(next).join(", ");
    latestValueRef.current = joined;
    onChange(joined);
  }
  function toggle(email: string) {
    if (!email) return;
    const next = new Set(parseEmailCsv(latestValueRef.current));
    if (next.has(email)) next.delete(email);
    else next.add(email);
    commit(next);
  }
  function addTyped() {
    // Early-return when typed is empty so blur events don't replay
    // an empty commit and wipe chips committed by a concurrent
    // dropdown toggle.
    const raw = typedRef.current.trim();
    if (!raw) return;
    const next = new Set(parseEmailCsv(latestValueRef.current));
    for (const p of parseEmailCsv(raw)) next.add(p);
    commit(next);
    setTyped("");
  }
  function remove(email: string) {
    const next = new Set(parseEmailCsv(latestValueRef.current));
    next.delete(email);
    commit(next);
  }

  // Outside-click guard: a document-level mousedown listener gated by
  // `open` and scoped to this picker's container. Earlier code rendered
  // a `fixed inset-0 z-[60]` overlay to catch outside clicks, but that
  // overlay sat ON TOP of the surrounding email composer and ate every
  // click on the body editor, toolbar buttons, and the X close — leaving
  // the composer "frozen" until refresh after a chip was added. Using a
  // document listener instead lets clicks reach their real targets
  // while still dismissing the picker when the click lands outside.
  const containerRef = useRef<HTMLDivElement>(null);
  const typedRef = useRef(typed);
  typedRef.current = typed;
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const node = containerRef.current;
      if (node && node.contains(e.target as Node)) return;
      // Commit whatever's typed before dismissing, so clicking outside
      // chips a partial entry — same intent as the prior overlay.
      addTyped();
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={containerRef} className="relative mt-1">
      <div
        className="flex min-h-[34px] w-full flex-wrap items-center gap-1 rounded-lg border border-court-border bg-court-surface px-2 py-1 text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20"
        onClick={() => setOpen(true)}
      >
        {Array.from(selected).map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] text-court-fg"
          >
            {email}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(email);
              }}
              aria-label={`Remove ${email}`}
              className="text-court-fg-muted hover:text-court-fg"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="email"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") {
              e.preventDefault();
              addTyped();
            } else if (e.key === "Tab") {
              // Don't preventDefault — let native Tab move focus — but
              // still commit the chip so Tab-out-of-field chips what's
              // typed, same as onBlur would.
              addTyped();
            }
          }}
          onBlur={addTyped}
          onFocus={() => setOpen(true)}
          placeholder={selected.size === 0 ? placeholder : ""}
          className="min-w-[160px] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
        />
      </div>
      {open && (
        <>
          {/* Outside-click handled by the document mousedown listener
              above. Earlier code rendered a fixed-inset overlay here
              to catch the dismiss click; that overlay sat on top of
              the entire viewport and ate clicks on the surrounding
              email composer (body editor, toolbar buttons, X close),
              leaving the composer frozen until page refresh after a
              chip was added. */}
          <div className="absolute left-0 top-full z-[70] mt-1 w-full overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg">
            <ul className="max-h-56 overflow-y-auto py-1">
              {pinnedList.length > 0 && (
                <>
                  <li className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                    Quick pick
                  </li>
                  {pinnedList.map((c) => (
                    <PickerOption
                      key={`pinned-${c.id}`}
                      name={c.name}
                      email={c.email}
                      checked={selected.has(c.email)}
                      onToggle={() => toggle(c.email)}
                    />
                  ))}
                  <li className="mx-2 my-1 border-t border-court-border" />
                </>
              )}
              {rest.length === 0 && pinnedList.length === 0 && (
                <li className="px-3 py-2 text-xs text-court-fg-muted">
                  No contacts on file. Type an email + Enter to add.
                </li>
              )}
              {rest.map((c) => (
                <PickerOption
                  key={c.id}
                  name={c.name}
                  email={c.email}
                  checked={selected.has(c.email)}
                  onToggle={() => toggle(c.email)}
                />
              ))}
            </ul>
            <div className="border-t border-court-border bg-court-surface-subtle/40 px-3 py-1.5 text-[10px] text-court-fg-muted">
              Or type an email and press Enter.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function findClientContactsForJob(
  jobs: PlacementContextJob[],
  jobTitle: string,
  clientName: string,
): ClientContactRef[] {
  const match = jobs.find((j) => j.jobTitle === jobTitle && j.clientName === clientName);
  return match?.clientContacts ?? [];
}

// Always-on interviewer picker. Fixes two real bugs:
//   1. Previously hidden entirely when the client had no contacts. Now
//      always shows with "Other (enter manually)" + "+ Add new contact"
//      so recruiters can proceed regardless of how stocked the client's
//      contact list is.
//   2. Free-text name/email fields were getting Chrome-autofilled with
//      the recruiter's own Google profile. Raw inputs with autoComplete
//      off, non-semantic name attrs, and data-lpignore stop that.
// Phase 5: id widened to number | string. Legacy RF-imported contacts
// keep a numeric legacyRfId; Ace-native contacts (created via
// createClientContact or /clients/new) carry a cuid. Either shape
// survives the picker + server-action round-trip.
export type InterviewerContact = { id: number | string; name: string; title: string; email: string };

export function InterviewerPicker({
  clientRfId,
  clientName,
  initialContacts,
  name,
  email,
  onChange,
}: {
  clientRfId: number;
  clientName: string;
  initialContacts: InterviewerContact[];
  name: string;
  email: string;
  onChange: (name: string, email: string) => void;
}) {
  const [mode, setMode] = useState<string>("");
  const [contacts, setContacts] = useState<InterviewerContact[]>(initialContacts);
  const [addFirstName, setAddFirstName] = useState("");
  const [addLastName, setAddLastName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);
  const [isAdding, startAdd] = useTransition();

  function setSelection(next: string) {
    setMode(next);
    setAddErr(null);
    if (next === "" || next === "custom" || next === "add") {
      onChange("", "");
      return;
    }
    const match = contacts.find((c) => String(c.id) === next);
    if (match) onChange(match.name, match.email ?? "");
  }

  function onSaveContact() {
    setAddErr(null);
    const fn = addFirstName.trim();
    if (!fn) {
      setAddErr("First name is required.");
      return;
    }
    startAdd(async () => {
      const result = await createClientContact({
        clientRfId,
        firstName: fn,
        lastName: addLastName.trim() || undefined,
        email: addEmail.trim() || undefined,
        title: addTitle.trim() || undefined,
      });
      if (!result.ok) {
        setAddErr(result.error);
        toast.error("Couldn't add contact", { description: result.error });
        return;
      }
      const created = result.value;
      setContacts((prev) => [...prev, created]);
      setAddFirstName("");
      setAddLastName("");
      setAddEmail("");
      setAddTitle("");
      setMode(String(created.id));
      onChange(created.name, created.email ?? "");
      toast.success("Contact added", {
        description: `${created.name} is now saved to ${clientName}.`,
      });
    });
  }

  const nonceRef = useRef<string>(Math.random().toString(36).slice(2, 10));
  const nonce = nonceRef.current;

  const showManualFields = mode === "custom" || (mode !== "" && mode !== "add");

  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          Interviewer (client contact)
        </span>
        <select
          value={mode}
          onChange={(e) => setSelection(e.target.value)}
          className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="">
            {contacts.length === 0 ? "No contacts on file — pick an option…" : "Select an interviewer…"}
          </option>
          {contacts.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
              {c.title ? ` · ${c.title}` : ""}
              {c.email ? ` · ${c.email}` : ""}
            </option>
          ))}
          <option value="custom">Other (enter manually)</option>
          <option value="add">+ Add new contact to {clientName || "this client"}…</option>
        </select>
      </label>

      {mode === "add" && (
        <div className="rounded-lg border border-brand/30 bg-brand-tint/30 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-brand-dark">
            New contact for {clientName}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <BareInput
              placeholder="First name *"
              value={addFirstName}
              onChange={setAddFirstName}
              name={`ace-new-contact-first-${nonce}`}
            />
            <BareInput
              placeholder="Last name"
              value={addLastName}
              onChange={setAddLastName}
              name={`ace-new-contact-last-${nonce}`}
            />
            <BareInput
              placeholder="Email"
              type="email"
              value={addEmail}
              onChange={setAddEmail}
              name={`ace-new-contact-email-${nonce}`}
            />
            <BareInput
              placeholder="Title"
              value={addTitle}
              onChange={setAddTitle}
              name={`ace-new-contact-title-${nonce}`}
            />
          </div>
          {addErr && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">{addErr}</div>
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setSelection("")}
              disabled={isAdding}
              className="rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted hover:text-court-fg disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSaveContact}
              disabled={isAdding}
              className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-60"
            >
              {isAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Save contact
            </button>
          </div>
        </div>
      )}

      {showManualFields && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <BareInput
            placeholder="Interviewer name"
            value={name}
            onChange={(v) => onChange(v, email)}
            name={`ace-interviewer-name-${nonce}`}
          />
          <BareInput
            placeholder="Interviewer email"
            type="email"
            value={email}
            onChange={(v) => onChange(name, v)}
            name={`ace-interviewer-email-${nonce}`}
          />
        </div>
      )}
    </div>
  );
}

// Raw text input with defensive anti-autofill attributes. Chrome,
// Safari, and 1Password/LastPass key on input name/type/surrounding
// context to decide whether to offer autofill. autoComplete=off +
// non-semantic name + data-lpignore + data-form-type together suppress
// all three without limiting user editability.
function BareInput({
  value,
  onChange,
  placeholder,
  type = "text",
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  name: string;
}) {
  return (
    <input
      type={type}
      value={value}
      name={name}
      placeholder={placeholder}
      autoComplete="off"
      data-lpignore="true"
      data-form-type="other"
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
    />
  );
}
