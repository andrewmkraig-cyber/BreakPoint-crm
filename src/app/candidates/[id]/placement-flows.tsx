"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  MapPin,
  PhoneCall,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  UploadCloud,
  UserCheck,
  UserX,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { PIPELINE_LABELS, type PipelineBucket } from "@/lib/recruiterflow";
import { StageBadge } from "@/components/stage-badge";
import { LabeledField, LabeledTextarea } from "@/app/candidates/[id]/editable-helpers";
import {
  applyCandidateToJob,
  cancelPlacement,
  confirmStart,
  deliverCandidateConfirmation,
  generateSubmittal,
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
} from "@/app/candidates/[id]/placement-actions";
import {
  cancelInterview,
  rescheduleInterview,
  scheduleInterview,
  sendInterviewInvite,
  type InterviewType,
} from "@/app/candidates/[id]/interview-actions";
import { createClientContact } from "@/app/candidates/[id]/contact-actions";
import { EmailComposer, type EmailDraft } from "@/components/email-composer";
import { DateTime15Picker } from "@/components/datetime-15-picker";
import { applyMergeFields as applyMergeFieldsClient } from "@/lib/merge-fields";
import { sendEmailAction } from "@/app/email/actions";
import { PipelineRowActions } from "@/app/jobs/[id]/pipeline-row-actions";

export type ClientContactRef = {
  id: number;
  name: string;
  title: string;
  email: string;
};

export type OpenJobOption = {
  jobRfId: number;
  jobTitle: string;
  clientRfId: number;
  clientName: string;
  alreadyLinked: boolean;
  clientContacts: ClientContactRef[];
};

export type PlacementContextJob = {
  jobRfId: number;
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
  rfStageName: string | null;
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
  const [applyOpen, setApplyOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);

  function onRequestReferences() {
    if (!candidateEmail) {
      toast.error("No candidate email on file", {
        description: "Add an email to the candidate profile first.",
      });
      return;
    }
    setReferenceOpen(true);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Jobs ({jobs.length})
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRequestReferences}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-navy shadow-sm transition hover:border-brand/40 hover:text-brand-dark disabled:opacity-60"
          >
            <UserCheck className="h-3.5 w-3.5" />
            Request References
          </button>
          <button
            type="button"
            onClick={() => setApplyOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-navy shadow-sm transition hover:border-brand/40 hover:text-brand-dark"
          >
            <Plus className="h-3.5 w-3.5" /> Apply to Job
          </button>
          <button
            type="button"
            onClick={() => setSubmitOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
          >
            <Plus className="h-3.5 w-3.5" /> Submit to Job
          </button>
        </div>
      </div>

      {jobs.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-5 py-4 text-xs text-muted-foreground">
          No jobs linked to this candidate yet — click <span className="font-semibold">Submit to Job</span> to add one.
        </div>
      )}

      <div className="space-y-2">
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
            onReschedule={(iv) => setRescheduleFor(iv)}
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
          onDone={() => setInviteFlow({ ...inviteFlow, step: "candidate" })}
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
          onClose={() => setSubmitOpen(false)}
        />
      )}
      {applyOpen && (
        <ApplyToJobDialog
          candidateRfId={candidateRfId}
          openJobs={openJobs}
          onClose={() => setApplyOpen(false)}
        />
      )}
      {referenceOpen && (
        <ReferenceCheckCompose
          candidateFirstName={candidateFirstName}
          candidateLastName={candidateLastName}
          candidateEmail={candidateEmail}
          onClose={() => setReferenceOpen(false)}
        />
      )}
    </>
  );
}

function ReferenceCheckCompose({
  candidateFirstName,
  candidateLastName,
  candidateEmail,
  onClose,
}: {
  candidateFirstName: string;
  candidateLastName: string;
  candidateEmail: string;
  onClose: () => void;
}) {
  const fullName = [candidateFirstName, candidateLastName].filter(Boolean).join(" ");
  return (
    <EmailComposer
      title="Reference check request"
      subtitle={fullName ? `${fullName} · ${candidateEmail}` : candidateEmail}
      initial={{
        to: candidateEmail ? [candidateEmail] : [],
        cc: [],
        bcc: [],
        subject: "",
        body: "",
      }}
      showTemplatePicker
      templateFilter={(t) => t.trigger === "reference_check_request" || t.audience === "candidate"}
      resolveTemplate={(t) => {
        const values = {
          candidateFirstName,
          candidateLastName,
          candidateFullName: fullName,
          candidateEmail,
        };
        return {
          subject: applyMergeFieldsClient(t.subject, values),
          body: applyMergeFieldsClient(t.body, values),
        };
      }}
      onClose={onClose}
      sendLabel="Send Reference Request"
      sendingLabel="Sending…"
      helperText="Pick the Reference Check Request template from Use Template (or any candidate-facing template)."
      onSend={async (draft: EmailDraft) => {
        const result = await sendEmailAction({
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          bodyText: draft.body,
        });
        if (!result.ok) throw new Error(result.error);
        toast.success("Reference request sent", { description: `Sent to ${draft.to.join(", ")}.` });
        onClose();
      }}
    />
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
  onReschedule,
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
  onReschedule: (iv: InterviewSummary) => void;
}) {
  const effective: Bucket = (job.placement?.stage ?? job.rfStageBucket) as Bucket;
  const isCancelled = effective === "cancelled";
  const isHired = !isCancelled && effective === "hired";
  const isRejected = !isCancelled && effective === "rejected";

  const badgeSuffix = badgeSuffixFor(effective, job);

  return (
    <div className="space-y-2 rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-navy">
              <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{job.jobTitle}</span>
            </div>
            {job.clientName && (
              <div className="mt-0.5 pl-[1.375rem] text-xs text-muted-foreground">{job.clientName}</div>
            )}
            {isCancelled && job.placement?.cancellationReason && (
              <div className="mt-0.5 pl-[1.375rem] text-[11px] text-red-700">
                Reason: {CANCEL_REASON_LABELS[job.placement.cancellationReason] ?? job.placement.cancellationReason}
                {job.placement.cancellationDetail ? ` — ${job.placement.cancellationDetail}` : ""}
              </div>
            )}
          </div>
          <div className="shrink-0">
            <StageBadge
              bucket={effective}
              label={isCancelled || isRejected ? null : job.rfStageName ?? null}
              suffix={badgeSuffix}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Action set parity with the Job-page Pipeline rows. The
              dialog-heavy actions (Schedule / Offer / Placement /
              Confirm / Cancel) hand back to the existing profile-side
              dialog state via the inline callbacks; the lighter ones
              (Apply / Submit / Keep / Reject / Un-reject) call the
              same server actions PipelineRowActions uses on the Job
              page. Hired and Cancelled keep their bespoke chrome
              underneath since the Pipeline component doesn't model
              the post-Hired flow yet. */}
          <PipelineRowActions
            candidateRfId={candidateRfId}
            candidateName={candidateName}
            jobRfId={job.jobRfId}
            clientRfId={job.clientRfId}
            jobTitle={job.jobTitle}
            clientName={job.clientName}
            bucket={effective}
            onSchedule={onSchedule}
            onOffer={onOffer}
            onPlacement={onPlacement}
            onConfirmStart={onConfirm}
            onCancelPlacement={onCancel}
            onRejectDialog={onReject}
          />
          {isHired && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> Hired
              {job.placement?.startConfirmedAt ? ` · ${formatDate(job.placement.startConfirmedAt)}` : ""}
            </span>
          )}
          {isCancelled && job.placement && (
            <CancelledRowActions placementId={job.placement.id} />
          )}
        </div>
      </div>

      {job.interviews.length > 0 && (
        <InterviewList
          interviews={job.interviews}
          candidateName={candidateName}
          jobTitle={job.jobTitle}
          onReschedule={onReschedule}
        />
      )}
    </div>
  );
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
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-navy shadow-sm transition hover:border-brand/40 hover:text-brand-dark disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Actions
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-white shadow-lg">
            <ul className="py-1 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() =>
                    run("Moved to Submitted", () =>
                      reapplyCancelledPlacement({ placementId }),
                    )
                  }
                  className="block w-full px-3 py-2 text-left text-navy hover:bg-brand-tint"
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
                  className="block w-full px-3 py-2 text-left text-navy hover:bg-brand-tint"
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
                  className="block w-full px-3 py-2 text-left text-navy hover:bg-brand-tint"
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
                  className="block w-full border-t border-border px-3 py-2 text-left text-red-700 hover:bg-red-50"
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

function badgeSuffixFor(effective: Bucket, job: PlacementContextJob): string | null {
  if (effective === "cancelled") {
    const d = job.placement?.cancelledAt ?? null;
    return d ? formatDate(d) : null;
  }
  if (effective === "rejected") {
    const d = job.placement?.rejectedAt ?? job.rfStageMovedAt ?? null;
    return d ? formatDate(d) : null;
  }
  if (effective === "pending_start") {
    const d = job.placement?.expectedStartDate ?? null;
    return d ? formatDate(d) : null;
  }
  if (effective === "hired") {
    const d = job.placement?.startConfirmedAt ?? null;
    return d ? formatDate(d) : null;
  }
  return null;
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
      <label className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand/30"
        />
        <span>
          <span className="font-semibold text-navy">Candidate accepted this offer</span>
          <span className="block text-muted-foreground">
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
  const seedSalary = job.placement?.acceptedSalary ?? job.placement?.offerSalary ?? null;
  const seedFeePct = job.placement?.feePercentage ?? job.clientFeePct ?? null;
  const [acceptedSalary, setAcceptedSalary] = useState(seedSalary ? String(seedSalary) : "");
  const [acceptedCurrency, setAcceptedCurrency] = useState(
    job.placement?.acceptedCurrency ?? job.placement?.offerCurrency ?? "USD",
  );
  const [feePct, setFeePct] = useState(seedFeePct != null ? String(seedFeePct) : "");
  const [minFee, setMinFee] = useState(job.placement?.minFee ? String(job.placement.minFee) : "");
  const [guarantee, setGuarantee] = useState(
    job.placement?.guaranteePeriodDays ? String(job.placement.guaranteePeriodDays) : "",
  );
  const [billingContactId, setBillingContactId] = useState<string>(
    seedBillingContactId(job.clientContacts, job.placement),
  );
  const [billingName, setBillingName] = useState(job.placement?.billingContactName ?? "");
  const [billingEmail, setBillingEmail] = useState(job.placement?.billingContactEmail ?? "");
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
  const guaranteeNum = guarantee ? Number(guarantee) : null;
  const rawFee = salaryNum && pctNum ? Math.round(salaryNum * (pctNum / 100)) : 0;
  const feeTotal = minFeeNum && rawFee < minFeeNum ? minFeeNum : rawFee;
  const usedMinFee = minFeeNum != null && rawFee < minFeeNum;

  function onBillingContactChange(id: string) {
    setBillingContactId(id);
    if (id === "custom" || id === "") {
      return;
    }
    const match = job.clientContacts.find((c) => String(c.id) === id);
    if (match) {
      setBillingName(match.name);
      setBillingEmail(match.email ?? "");
    }
  }

  function validate(): string | null {
    if (salaryNum == null) return "Accepted salary required.";
    if (salaryNum < 0) return "Salary can't be negative.";
    if (!pctNum) return "Fee percentage required.";
    if (pctNum < 0) return "Fee percentage can't be negative.";
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

    startSave(async () => {
      const result = await recordPlacement({
        candidateRfId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        acceptedSalary: salaryNum!,
        acceptedCurrency: acceptedCurrency.toUpperCase().slice(0, 3),
        feePercentage: pctNum,
        feeTotal,
        minFee: minFeeNum,
        guaranteePeriodDays: guaranteeNum,
        billingContactName: billingName.trim(),
        billingContactEmail: billingEmail.trim(),
        hiringManagerName: hiringName.trim(),
        hiringManagerEmail: hiringEmail.trim(),
        expectedStartDate: startDate,
        notes: notes.trim(),
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't save placement", { description: result.error });
        return;
      }
      toast.success("Placement recorded", { description: "Candidate moved to Pending Start." });
      onClose();
      router.refresh();
    });
  }

  const selectedContact = useMemo(
    () => job.clientContacts.find((c) => String(c.id) === billingContactId) ?? null,
    [billingContactId, job.clientContacts],
  );

  return (
    <Modal title="Placement" subtitle={`${job.jobTitle} · ${job.clientName}`} onClose={onClose} wide>
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
          label="Guarantee period (days)"
          value={guarantee}
          onChange={setGuarantee}
          placeholder="90"
          min={0}
          step="1"
        />
        <LabeledField label="Expected start date" type="date" value={startDate} onChange={setStartDate} />
      </div>

      <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Calculated fee</div>
        <div className="mt-1 font-serif text-2xl font-semibold text-navy">
          {formatMoney(feeTotal, acceptedCurrency)}
          {usedMinFee && <span className="ml-2 text-xs text-amber-700">(min fee applied)</span>}
        </div>
        {salaryNum && pctNum ? (
          <div className="mt-1 text-xs text-muted-foreground">
            {formatMoney(salaryNum, acceptedCurrency)} × {pctNum}% = {formatMoney(rawFee, acceptedCurrency)}
          </div>
        ) : (
          <div className="mt-1 text-xs text-muted-foreground">Enter salary + fee % to calculate.</div>
        )}
      </div>

      <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Billing contact</h3>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Contact</span>
          <select
            value={billingContactId}
            onChange={(e) => onBillingContactChange(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            <option value="">Select a contact…</option>
            {job.clientContacts.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
                {c.title ? ` · ${c.title}` : ""}
              </option>
            ))}
            <option value="custom">Other (enter manually)</option>
          </select>
        </label>
        {billingContactId === "custom" || billingContactId === "" ? (
          <LabeledField label="Name" value={billingName} onChange={setBillingName} />
        ) : (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Email</div>
            <div className="mt-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-navy">
              {selectedContact?.email || <span className="text-muted-foreground">No email on file</span>}
            </div>
          </div>
        )}
        {(billingContactId === "custom" || billingContactId === "") && (
          <LabeledField label="Email" type="email" value={billingEmail} onChange={setBillingEmail} />
        )}
      </div>
      <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Hiring manager</h3>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledField label="Name" value={hiringName} onChange={setHiringName} />
        <LabeledField label="Email" type="email" value={hiringEmail} onChange={setHiringEmail} />
      </div>

      <div className="mt-5">
        <LabeledTextarea label="Placement notes" value={notes} onChange={setNotes} rows={3} />
      </div>

      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel="Record placement" />
    </Modal>
  );
}

function seedBillingContactId(
  contacts: ClientContactRef[],
  placement: PlacementSnapshot | null,
): string {
  if (!placement?.billingContactEmail && !placement?.billingContactName) return "";
  const byEmail = contacts.find(
    (c) => c.email && placement.billingContactEmail && c.email.toLowerCase() === placement.billingContactEmail.toLowerCase(),
  );
  if (byEmail) return String(byEmail.id);
  const byName = contacts.find(
    (c) => placement.billingContactName && c.name.toLowerCase() === placement.billingContactName.toLowerCase(),
  );
  if (byName) return String(byName.id);
  return "custom";
}

// ---------------- Confirm Start dialog ----------------

function ConfirmStartDialog({
  placementId,
  jobTitle,
  onClose,
}: {
  placementId: string;
  jobTitle: string;
  onClose: () => void;
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
      <p className="text-sm text-muted-foreground">
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
          "mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-8 text-center transition hover:border-brand/40 hover:bg-brand-tint/20",
          (file || dragActive) && "border-brand/40 bg-brand-tint/20",
        )}
      >
        <UploadCloud className="h-5 w-5 text-muted-foreground" />
        <div className="text-sm font-semibold text-navy">
          {file ? file.name : dragActive ? "Drop screenshot here" : "Click or drag a screenshot here"}
        </div>
        <div className="text-xs text-muted-foreground">PNG / JPG up to 4MB</div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onPick}
        />
      </div>
      {previewUrl && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Start confirmation preview" className="max-h-64 w-full object-contain" />
        </div>
      )}
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel="Confirm start" />
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
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Date &amp; time</span>
            <DateTime15Picker
              value={scheduledAt}
              onChange={setScheduledAt}
              className="mt-1"
            />
          </label>
          <DurationSelect value={durationMin} onChange={setDurationMin} />
        </div>
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as InterviewType)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            <option value="phone_screen">Phone Screen</option>
            <option value="video">Video (Google Meet)</option>
            <option value="in_person">In-Person</option>
          </select>
        </label>
        {type === "in_person" && (
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Address</span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. 500 Main St, Suite 300, Columbus OH 43215"
              className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
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
      <p className="mb-3 text-xs text-muted-foreground">
        Use this when the client is scheduling the interview themselves and will send the invite. We&apos;ll
        log it for tracking and drop it on your calendar — no invite is sent to the candidate or client.
      </p>
      <div className="grid grid-cols-1 gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm sm:col-span-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Date &amp; time</span>
            <DateTime15Picker value={scheduledAt} onChange={setScheduledAt} className="mt-1" />
          </label>
          <DurationSelect value={durationMin} onChange={setDurationMin} />
        </div>
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as InterviewType)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            <option value="phone_screen">Phone Screen</option>
            <option value="video">Video</option>
            <option value="in_person">In-Person</option>
          </select>
        </label>
        {type === "in_person" && (
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Address</span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. 500 Main St, Suite 300, Columbus OH 43215"
              className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
        )}
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Interviewer name (optional)</span>
          <input
            type="text"
            value={interviewerName}
            name={`ace-interviewer-name-${job.jobRfId}`}
            autoComplete="off"
            data-lpignore="true"
            data-form-type="other"
            onChange={(e) => setInterviewerName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
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
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Date &amp; time</span>
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

function InterviewList({
  interviews,
  candidateName,
  jobTitle,
  onReschedule,
}: {
  interviews: InterviewSummary[];
  candidateName: string;
  jobTitle: string;
  onReschedule: (iv: InterviewSummary) => void;
}) {
  // Show only ACTIVE interviews on the linked-job row. Anything cancelled,
  // completed, or marked rescheduled is visual noise here — it's surfaced
  // in the Activity panel below the resume instead. If nothing's active,
  // suppress the header + container entirely (no "Interviews (0)" text).
  const active = interviews.filter((iv) => iv.status === "scheduled");
  if (active.length === 0) return null;
  const sorted = [...active].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  return (
    <div className="mt-2 space-y-1.5 border-t border-border pt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Interviews ({sorted.length})
      </div>
      <ul className="space-y-1.5">
        {sorted.map((iv) => (
          <InterviewRow key={iv.id} iv={iv} candidateName={candidateName} jobTitle={jobTitle} onReschedule={onReschedule} />
        ))}
      </ul>
    </div>
  );
}

function InterviewRow({
  iv,
  onReschedule,
}: {
  iv: InterviewSummary;
  candidateName: string;
  jobTitle: string;
  onReschedule: (iv: InterviewSummary) => void;
}) {
  const router = useRouter();
  const [isCancelling, startCancel] = useTransition();
  const when = new Date(iv.scheduledAt);
  const isPast = when.getTime() < Date.now();
  const isCancelled = iv.status === "cancelled";
  const kindIcon =
    iv.type === "phone_screen" ? PhoneCall : iv.type === "video" ? Video : MapPin;
  const Icon = kindIcon;

  function onCancel() {
    if (!confirm("Cancel this interview? The calendar event will be removed.")) return;
    startCancel(async () => {
      const result = await cancelInterview(iv.id);
      if (!result.ok) {
        toast.error("Couldn't cancel", { description: result.error });
        return;
      }
      toast.success("Interview cancelled");
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs",
        isCancelled
          ? "border-border bg-muted/30 text-muted-foreground line-through"
          : isPast
            ? "border-border bg-muted/30 text-muted-foreground"
            : "border-border bg-muted/10 text-navy",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate font-medium">
            {formatInterviewWhen(when)} · {iv.durationMin}m · {formatInterviewType(iv.type)}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {iv.source === "client_scheduled" ? "Client-scheduled" : "Ace-scheduled"}
            {iv.attendees.length > 0 ? ` · with ${iv.attendees.map((a) => a.name).join(", ")}` : ""}
            {iv.meetLink ? ` · Meet` : ""}
          </div>
        </div>
      </div>
      {!isCancelled && !isPast && (
        <div className="flex items-center gap-1">
          {iv.meetLink && (
            <a
              href={iv.meetLink}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-border bg-white px-2 py-1 font-semibold text-navy hover:border-brand/40 hover:text-brand-dark"
            >
              Open Meet
            </a>
          )}
          <button
            type="button"
            onClick={() => onReschedule(iv)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 font-semibold text-navy hover:border-brand/40 hover:text-brand-dark"
          >
            <Clock className="h-3 w-3" /> Reschedule
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isCancelling}
            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 font-semibold text-red-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
          >
            {isCancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

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
      <p className="text-sm text-navy">
        <span className="font-semibold">Reject {nameLabel} for {job.jobTitle}?</span>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Pick one: <span className="font-semibold text-navy">Reject &amp; Send Email</span> runs your Candidate Rejection
        template to the candidate. <span className="font-semibold text-navy">Reject Only</span> updates the stage with no
        email sent. Either way the stage moves to Rejected.
      </p>
      <div className="mt-3">
        <LabeledTextarea label="Internal reason (optional — not sent)" value={reason} onChange={setReason} rows={3} />
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => run(false)}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
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
      <p className="text-sm text-muted-foreground">
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
      <p className="text-sm text-muted-foreground">
        This moves the candidate out of Hired and logs the cancellation. Invoicing flag is cleared; the placement
        record is kept for audit.
      </p>

      <label className="mt-4 block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Reason</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as CancelReasonValue)}
          className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
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
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Open job</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
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
  onClose,
}: {
  candidateRfId: number;
  candidateFirstName: string;
  candidateLastName: string;
  candidateEmail: string;
  openJobs: OpenJobOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const picked = openJobs.find((o) => String(o.jobRfId) === selectedId) ?? null;
  const hasAvailable = openJobs.some((j) => !j.alreadyLinked);

  function onPickJob() {
    setErr(null);
    if (!picked) {
      setErr("Pick an open job to submit to.");
      return;
    }
    if (picked.alreadyLinked) {
      setErr("Candidate is already linked to this job.");
      return;
    }
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
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Open job</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="">Select a job…</option>
          {openJobs.map((j) => (
            <option key={j.jobRfId} value={String(j.jobRfId)} disabled={j.alreadyLinked}>
              {j.clientName ? `${j.clientName} — ${j.jobTitle}` : j.jobTitle}
              {j.alreadyLinked ? " (already submitted)" : ""}
            </option>
          ))}
        </select>
      </label>
      {!hasAvailable && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          This candidate is already linked to every open job.
        </div>
      )}
      {picked && (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-xs text-navy">
          <div className="font-semibold">{picked.jobTitle}</div>
          <div className="text-muted-foreground">{picked.clientName || "—"}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
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
      helperText="Pick a client contact for To and any Cc recipients. Then Use Template or Generate with Claude."
      showTemplatePicker
      templateFilter={(t) => t.audience !== "candidate"}
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
        const result = await generateSubmittal({
          candidateRfId,
          jobRfId: job.jobRfId,
          jobTitle: job.jobTitle,
          clientName: job.clientName,
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
          jobTitle: job.jobTitle,
          clientName: job.clientName,
          to: draft.to,
          cc: draft.cc,
          subject: draft.subject,
          body: draft.body,
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

        if (candidateEmail) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4" onClick={onClose}>
      <div
        className={cn(
          "w-full overflow-hidden rounded-xl border border-border bg-white shadow-xl",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-navy">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
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
  return (
    <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-60"
      >
        <X className="h-3 w-3" /> Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <SaveIcon className="h-3 w-3" />}
        {saveLabel}
      </button>
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
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
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
        className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
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
  if (who === "client") {
    const first = invite.clientContactName.split(/\s+/)[0] || "there";
    return (
      `Hi ${first},\n\nConfirming the interview with ${candidateFull || "the candidate"} for the ${invite.jobTitle} role. ` +
      `The calendar invite is on its way.\n\n` +
      `• When: ${when}\n• Duration: ${invite.durationMin} min\n• Format: ${type}${addr}\n\n` +
      `Reply to this email if anything needs to change.`
    );
  }
  return (
    `Hi ${candidateFull.split(/\s+/)[0] || "there"},\n\n` +
    `You are confirmed for your ${type} interview with ${invite.clientName} for the ${invite.jobTitle} role. ` +
    `The calendar invite is on its way.\n\n` +
    `• When: ${when}\n• Duration: ${invite.durationMin} min\n• Format: ${type}${addr}\n\n` +
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
  onDone: () => void;
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
      onClose={onDone}
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
        onDone();
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
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
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
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
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
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
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

// Smaller sibling of the composer's ContactComboMulti that lives outside
// a modal. Intentionally duplicated (not imported from email-composer.tsx)
// to keep the composer module's client dependency tree focused on email
// concerns.
function InlineContactMultiInput({
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

  function setAll(next: Set<string>) {
    onChange(Array.from(next).join(", "));
  }
  function toggle(email: string) {
    if (!email) return;
    const next = new Set(selected);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    setAll(next);
  }
  function addTyped() {
    const next = new Set(selected);
    for (const p of parseEmailCsv(typed)) next.add(p);
    setAll(next);
    setTyped("");
  }
  function remove(email: string) {
    const next = new Set(selected);
    next.delete(email);
    setAll(next);
  }

  return (
    <div className="relative mt-1">
      <div
        className="flex min-h-[34px] w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20"
        onClick={() => setOpen(true)}
      >
        {Array.from(selected).map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-navy"
          >
            {email}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(email);
              }}
              aria-label={`Remove ${email}`}
              className="text-muted-foreground hover:text-navy"
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
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 w-full overflow-hidden rounded-lg border border-border bg-white shadow-lg">
            <ul className="max-h-56 overflow-y-auto py-1">
              {pinnedList.length > 0 && (
                <>
                  <li className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Quick pick
                  </li>
                  {pinnedList.map((c) => (
                    <li key={`pinned-${c.id}`}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-navy hover:bg-brand-tint">
                        <input
                          type="checkbox"
                          checked={selected.has(c.email)}
                          onChange={() => toggle(c.email)}
                          className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand/30"
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{c.name}</span>
                          <span className="truncate text-[11px] text-muted-foreground">{c.email}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                  <li className="mx-2 my-1 border-t border-border" />
                </>
              )}
              {rest.length === 0 && pinnedList.length === 0 && (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  No contacts on file. Type an email + Enter to add.
                </li>
              )}
              {rest.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-navy hover:bg-brand-tint">
                    <input
                      type="checkbox"
                      checked={selected.has(c.email)}
                      onChange={() => toggle(c.email)}
                      disabled={!c.email}
                      className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand/30"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{c.name}</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {c.email || "No email on file"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
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
export type InterviewerContact = { id: number; name: string; title: string; email: string };

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
        description: `${created.name} is now saved to ${clientName} in RecruiterFlow.`,
      });
    });
  }

  const nonceRef = useRef<string>(Math.random().toString(36).slice(2, 10));
  const nonce = nonceRef.current;

  const showManualFields = mode === "custom" || (mode !== "" && mode !== "add");

  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Interviewer (client contact)
        </span>
        <select
          value={mode}
          onChange={(e) => setSelection(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
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
              className="rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-navy-400 hover:text-navy disabled:opacity-60"
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
      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
    />
  );
}
