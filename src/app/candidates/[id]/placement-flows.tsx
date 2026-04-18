"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  DollarSign,
  Handshake,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  UploadCloud,
  UserCheck,
  UserX,
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
  scheduleInterview,
  sendInterviewConfirmationEmail,
  sendOfferAcceptanceEmail,
  sendRejectionEmail,
  sendSubmittalEmail,
  unrejectCandidateJob,
} from "@/app/candidates/[id]/placement-actions";
import { EmailComposer, type EmailDraft } from "@/components/email-composer";
import { applyMergeFields as applyMergeFieldsClient } from "@/lib/merge-fields";
import { sendEmailAction } from "@/app/email/actions";

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
  clientRfId: number;
  clientName: string;
  clientFeePct: number | null;
  rfStageBucket: PipelineBucket;
  rfStageName: string | null;
  rfStageMovedAt: string | null;
  clientContacts: ClientContactRef[];
  placement: PlacementSnapshot | null;
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

const ACTIVE_BUCKETS: ReadonlySet<Bucket> = new Set<Bucket>([
  "submitted",
  "interviewing",
  "offer",
  "pending_start",
]);

export function PlacementActions({
  candidateRfId,
  candidateFirstName,
  candidateLastName,
  candidateEmail,
  jobs,
  openJobs,
}: {
  candidateRfId: number;
  candidateFirstName: string;
  candidateLastName: string;
  candidateEmail: string;
  jobs: PlacementContextJob[];
  openJobs: OpenJobOption[];
}) {
  const [offerFor, setOfferFor] = useState<PlacementContextJob | null>(null);
  const [placementFor, setPlacementFor] = useState<PlacementContextJob | null>(null);
  const [confirmFor, setConfirmFor] = useState<PlacementContextJob | null>(null);
  const [scheduleFor, setScheduleFor] = useState<PlacementContextJob | null>(null);
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
            onOffer={() => setOfferFor(j)}
            onPlacement={() => setPlacementFor(j)}
            onConfirm={() => setConfirmFor(j)}
            onSchedule={() => setScheduleFor(j)}
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
        />
      )}
      {scheduleFor && (
        <ScheduleInterviewDialog
          candidateRfId={candidateRfId}
          job={scheduleFor}
          onClose={() => setScheduleFor(null)}
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
  onOffer,
  onPlacement,
  onConfirm,
  onSchedule,
  onReject,
  onCancel,
}: {
  job: PlacementContextJob;
  onOffer: () => void;
  onPlacement: () => void;
  onConfirm: () => void;
  onSchedule: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const effective: Bucket = (job.placement?.stage ?? job.rfStageBucket) as Bucket;
  const isCancelled = effective === "cancelled";
  const isActive = !isCancelled && ACTIVE_BUCKETS.has(effective);
  const isInterviewing = !isCancelled && (effective === "interviewing" || effective === "submitted");
  const isOffer = !isCancelled && effective === "offer";
  const isPendingStart = !isCancelled && effective === "pending_start";
  const isHired = !isCancelled && effective === "hired";
  const isRejected = !isCancelled && effective === "rejected";

  const badgeSuffix = badgeSuffixFor(effective, job);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
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
        {isActive && !isPendingStart && (
          <button
            type="button"
            onClick={onSchedule}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-navy shadow-sm transition hover:border-brand/40 hover:text-brand-dark"
          >
            <CalendarClock className="h-3.5 w-3.5" /> Schedule Interview
          </button>
        )}
        {(isInterviewing || isOffer) && (
          <button
            type="button"
            onClick={onOffer}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-navy shadow-sm transition hover:border-brand/40 hover:text-brand-dark"
          >
            <DollarSign className="h-3.5 w-3.5" /> {job.placement?.offerSalary ? "Edit Offer" : "Offer Received"}
          </button>
        )}
        {(isOffer || isInterviewing) && (
          <button
            type="button"
            onClick={onPlacement}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
          >
            <Handshake className="h-3.5 w-3.5" /> Placement
          </button>
        )}
        {isPendingStart && (
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Start
          </button>
        )}
        {!isRejected && !isCancelled && !isHired && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onReject();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm transition hover:border-red-300 hover:bg-red-50"
          >
            <UserX className="h-3.5 w-3.5" /> Reject
          </button>
        )}
        {isHired && (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> Hired
              {job.placement?.startConfirmedAt ? ` · ${formatDate(job.placement.startConfirmedAt)}` : ""}
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm transition hover:border-red-300 hover:bg-red-50"
            >
              <Ban className="h-3.5 w-3.5" /> Cancel Placement
            </button>
          </>
        )}
        {isCancelled && job.placement && (
          <CancelledRowActions placementId={job.placement.id} />
        )}
      </div>
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
  candidateRfId,
  job,
  onClose,
}: {
  candidateRfId: number;
  job: PlacementContextJob;
  onClose: () => void;
}) {
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [interviewerId, setInterviewerId] = useState<string>("");
  const [interviewerName, setInterviewerName] = useState("");
  const [interviewerEmail, setInterviewerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onInterviewerChange(id: string) {
    setInterviewerId(id);
    if (id === "custom" || id === "") return;
    const match = job.clientContacts.find((c) => String(c.id) === id);
    if (match) {
      setInterviewerName(match.name);
      setInterviewerEmail(match.email ?? "");
    }
  }

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
    startSave(async () => {
      const result = await scheduleInterview({
        candidateRfId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        interviewerName: interviewerName.trim(),
        interviewerEmail: interviewerEmail.trim(),
        notes: notes.trim(),
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't schedule interview", { description: result.error });
        return;
      }
      const emailResult = await sendInterviewConfirmationEmail({
        candidateRfId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        jobTitle: job.jobTitle,
        clientCompanyName: job.clientName,
        scheduledAt: new Date(scheduledAt).toISOString(),
      });
      if (emailResult.ok) {
        const v = emailResult.value;
        if (v.status === "sent") {
          toast.success("Interview scheduled", { description: `Confirmation email sent to ${v.to}.` });
        } else if (v.status === "drafted") {
          toast.success("Interview scheduled", { description: "Confirmation email saved to your Gmail Drafts." });
        } else if (v.status === "skipped") {
          toast.success("Interview scheduled", {
            description:
              v.reason === "no_recipient"
                ? "No candidate email on file — email skipped."
                : v.reason === "missing"
                  ? "No Interview Confirmation template found. Set one in Settings."
                  : "Interview Confirmation template is inactive.",
          });
        } else {
          toast.success("Interview scheduled", { description: `Confirmation email failed: ${v.error}` });
        }
      } else {
        toast.success("Interview scheduled", { description: `Confirmation email failed: ${emailResult.error}` });
      }
      onClose();
      router.refresh();
    });
  }

  const hasContacts = job.clientContacts.length > 0;

  return (
    <Modal title="Schedule interview" subtitle={`${job.jobTitle} · ${job.clientName}`} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Job</div>
          <div className="mt-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-navy">
            {job.jobTitle}
          </div>
        </div>
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Date &amp; time</span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </label>
        {hasContacts && (
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Interviewer (client contact)</span>
            <select
              value={interviewerId}
              onChange={(e) => onInterviewerChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              <option value="">Select an interviewer…</option>
              {job.clientContacts.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                  {c.title ? ` · ${c.title}` : ""}
                </option>
              ))}
              <option value="custom">Other (enter manually)</option>
            </select>
          </label>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LabeledField label="Interviewer name" value={interviewerName} onChange={setInterviewerName} />
          <LabeledField label="Interviewer email" type="email" value={interviewerEmail} onChange={setInterviewerEmail} />
        </div>
        <LabeledTextarea label="Notes" value={notes} onChange={setNotes} rows={3} />
      </div>
      <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Calendar invite delivery lands with the calendar integration on Day 4. For now we log the interview to activity.
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel="Schedule" />
    </Modal>
  );
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}
