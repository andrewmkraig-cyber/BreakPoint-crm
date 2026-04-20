"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Ban,
  Bookmark,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  DollarSign,
  Handshake,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { PipelineBucket } from "@/lib/recruiterflow";
import {
  applyCandidateToJob,
  keepCandidate,
  rejectCandidateJob,
  submitCandidateToJob,
  unrejectCandidateJob,
} from "@/app/candidates/[id]/placement-actions";

// Inline action-button bank for a single row in the Job-detail
// Pipeline section. Stage-keyed so the recruiter only ever sees
// buttons that make sense for where the candidate is right now.
//
// Two flavors:
//  - "lightweight" actions (Apply / Submit / Keep / Reject /
//    Un-reject) call the existing server actions directly with a
//    confirmation prompt where destructive. Toast + router.refresh
//    on success so the row hops to its new column without a full
//    reload.
//  - "heavyweight" actions (Schedule Interview / Client Sending
//    Invite / Offer Received / Placement / Confirm Start / Cancel
//    Placement) need rich dialogs that already live on the
//    candidate profile (date pickers, screenshot upload, fee
//    calculators, multi-step composers). Those buttons NAVIGATE
//    to the candidate profile so the existing UX is reused —
//    one extra click but zero duplicated dialog code.

export type PipelineRowActionsProps = {
  candidateRfId: number;
  candidateName: string;
  jobRfId: number;
  clientRfId: number;
  jobTitle: string;
  clientName: string;
  bucket: PipelineBucket;
};

export function PipelineRowActions(props: PipelineRowActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const profileHref = `/candidates/${props.candidateRfId}`;

  function runLight(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(`Couldn't ${label.toLowerCase()}`, { description: result.error });
        return;
      }
      toast.success(label);
      router.refresh();
    });
  }

  function onApply() {
    runLight(`Applied ${props.candidateName}`, () =>
      applyCandidateToJob({
        candidateRfId: props.candidateRfId,
        jobRfId: props.jobRfId,
        clientRfId: props.clientRfId,
        jobTitle: props.jobTitle,
        clientName: props.clientName,
      }),
    );
  }

  function onSubmit() {
    runLight(`Submitted ${props.candidateName}`, () =>
      submitCandidateToJob({
        candidateRfId: props.candidateRfId,
        jobRfId: props.jobRfId,
        clientRfId: props.clientRfId,
        jobTitle: props.jobTitle,
        clientName: props.clientName,
      }),
    );
  }

  function onKeep() {
    runLight(`Kept ${props.candidateName}`, () =>
      keepCandidate({
        candidateRfId: props.candidateRfId,
        jobRfId: props.jobRfId,
        clientRfId: props.clientRfId,
      }),
    );
  }

  function onReject() {
    if (!confirm(`Reject ${props.candidateName} for ${props.jobTitle}?`)) return;
    runLight(`Rejected ${props.candidateName}`, () =>
      rejectCandidateJob({
        candidateRfId: props.candidateRfId,
        jobRfId: props.jobRfId,
        clientRfId: props.clientRfId,
        previousStage: null,
        reason: "",
      }),
    );
  }

  function onUnreject() {
    if (!confirm(`Reactivate ${props.candidateName}? They will move back into Submitted.`)) return;
    runLight(`Reactivated ${props.candidateName}`, () =>
      unrejectCandidateJob({
        candidateRfId: props.candidateRfId,
        jobRfId: props.jobRfId,
        clientRfId: props.clientRfId,
        targetStage: "submitted",
      }),
    );
  }

  switch (props.bucket) {
    case "sourced":
      return (
        <ActionRow disabled={isPending}>
          <ActionButton icon={Plus} label="Apply" onClick={onApply} />
          <ActionButton icon={Send} label="Submit" tone="primary" onClick={onSubmit} />
          <ActionButton icon={Bookmark} label="Keep" onClick={onKeep} />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "applied":
      return (
        <ActionRow disabled={isPending}>
          <ActionButton icon={Send} label="Submit" tone="primary" onClick={onSubmit} />
          <ActionButton icon={Bookmark} label="Keep" onClick={onKeep} />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "submitted":
      return (
        <ActionRow disabled={isPending}>
          <NavButton icon={CalendarClock} label="Schedule" href={profileHref} title="Schedule Interview" />
          <NavButton icon={CalendarPlus} label="Client Invite" href={profileHref} title="Client Sending Invite" />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "interviewing":
      return (
        <ActionRow disabled={isPending}>
          <NavButton icon={CalendarClock} label="Next round" href={profileHref} title="Schedule another interview" />
          <NavButton icon={DollarSign} label="Offer" href={profileHref} title="Offer Received" />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "offer":
      return (
        <ActionRow disabled={isPending}>
          <NavButton icon={Handshake} label="Placement" href={profileHref} title="Record placement" tone="primary" />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "pending_start":
      return (
        <ActionRow disabled={isPending}>
          <NavButton icon={CheckCircle2} label="Confirm" href={profileHref} title="Confirm start" tone="primary" />
          <NavButton icon={Ban} label="Cancel" href={profileHref} title="Cancel placement" tone="danger" />
        </ActionRow>
      );
    case "hired":
      return (
        <ActionRow disabled={false}>
          <NavButton icon={CheckCircle2} label="View" href={profileHref} title="Open candidate profile" />
        </ActionRow>
      );
    case "rejected":
      return (
        <ActionRow disabled={isPending}>
          <ActionButton icon={RotateCcw} label="Un-reject" onClick={onUnreject} />
        </ActionRow>
      );
    case "cancelled":
    case "other":
    default:
      return (
        <ActionRow disabled={false}>
          <NavButton icon={CheckCircle2} label="View" href={profileHref} title="Open candidate profile" />
        </ActionRow>
      );
  }
}

function ActionRow({ children, disabled }: { children: React.ReactNode; disabled: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-1.5",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      {disabled && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {children}
    </div>
  );
}

type Tone = "default" | "primary" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  default: "border-border bg-white text-navy-400 hover:border-brand/40 hover:text-navy",
  primary: "border-brand bg-brand text-white hover:bg-brand-dark",
  danger: "border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-50",
};

function ActionButton({
  icon: Icon,
  label,
  onClick,
  tone = "default",
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  tone?: Tone;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold shadow-sm transition",
        TONE_CLASS[tone],
      )}
    >
      <Icon className="h-3 w-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function NavButton({
  icon: Icon,
  label,
  href,
  tone = "default",
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  tone?: Tone;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title ?? label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold shadow-sm transition",
        TONE_CLASS[tone],
      )}
    >
      <Icon className="h-3 w-3" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
