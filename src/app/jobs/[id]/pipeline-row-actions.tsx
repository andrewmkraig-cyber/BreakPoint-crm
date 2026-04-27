"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Ban,
  Bookmark,
  CalendarClock,
  CheckCircle2,
  CornerUpLeft,
  DollarSign,
  Edit3,
  Handshake,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  applyCandidateToJob,
  keepCandidate,
  moveToApplied,
  moveToKept,
  rejectCandidateJob,
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
  // Local Placement.stage value — "sourced" | "applied" | "kept" | "submitted" |
  // "interviewing" | "offer" | "pending_start" | "hired" | "rejected" |
  // "cancelled". The switch below matches these literal strings directly, no
  // RF-derived bucket computation. If the caller has no local Placement row,
  // pass "sourced" (the unengaged default).
  stage: string;
  // Optional inline-dialog handlers. When the row is rendered on the
  // candidate profile (where dialogs already exist), passing these
  // skips the navigate-to-candidate-profile fallback and opens the
  // matching dialog in place. Job-page rows don't pass them and the
  // buttons fall through to NavButton href={profileHref}.
  onSchedule?: () => void;
  onOffer?: () => void;
  onPlacement?: () => void;
  onConfirmStart?: () => void;
  onCancelPlacement?: () => void;
  // When provided, Reject opens the caller's dedicated dialog
  // (e.g. the candidate-profile RejectDialog with reason +
  // optional rejection-email send) instead of the bare
  // window.confirm + server action that the Job page uses.
  onRejectDialog?: () => void;
};

export function PipelineRowActions(props: PipelineRowActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const profileHref = `/candidates/${props.candidateRfId}`;

  // Defensive normalization. The switch below relies on exact string
  // equality against canonical lowercase stage values — any stray
  // whitespace or casing in the Placement.stage column (hand-authored
  // SQL, future import paths, etc.) would silently fall through to
  // the default case and lose the stage-appropriate action buttons.
  // Normalizing here means that risk can't cost us the Submit button
  // again.
  const stage = props.stage.trim().toLowerCase();

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
    // Hand off to the caller's dialog when they provided one
    // (candidate profile uses a dedicated RejectDialog with reason
    // + optional rejection email). Otherwise fall back to the
    // inline confirm + server action used on the Job page.
    if (props.onRejectDialog) {
      props.onRejectDialog();
      return;
    }
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

  // Stage reversions: pull a Submitted candidate back to Kept, or
  // promote a Kept candidate to Applied. Both are local-only; the
  // server action stamps an ActionLog entry with the from/to so the
  // activity feed can present "Reverted from Submitted to Kept by
  // {user} at {when}" without inventing the metadata client-side.
  function onMoveToKept() {
    runLight("Moved back to Kept", () =>
      moveToKept({
        candidateRfId: props.candidateRfId,
        jobRfId: props.jobRfId,
        clientRfId: props.clientRfId,
        // Server action signature accepts a PipelineBucket today; cast the
        // local stage string at the boundary so this component stays free
        // of the RF-derived bucket type. The server writes an ActionLog
        // row with the raw string either way.
        previousStage: props.stage as Parameters<typeof moveToKept>[0]["previousStage"],
      }),
    );
  }
  function onMoveToApplied() {
    runLight("Moved back to Applied", () =>
      moveToApplied({
        candidateRfId: props.candidateRfId,
        jobRfId: props.jobRfId,
        clientRfId: props.clientRfId,
        previousStage: props.stage as Parameters<typeof moveToApplied>[0]["previousStage"],
      }),
    );
  }

  switch (stage) {
    case "sourced":
      // Submit is now also the primary action on Sourced so recruiters
      // can skip straight to the submittal composer without going
      // through Apply first. Apply stays as a secondary action for
      // when they just want to track the application without sending
      // a submittal yet.
      return (
        <ActionRow disabled={isPending}>
          <NavButton
            icon={Send}
            label="Submit"
            tone="primary"
            href={`${profileHref}?compose=submittal&jobId=${props.jobRfId}`}
            title="Open submittal composer"
          />
          <ActionButton icon={Plus} label="Apply" tone="apply" onClick={onApply} />
          <ActionButton icon={Bookmark} label="Keep" onClick={onKeep} />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "applied":
      // Submit hands off to the candidate profile's submittal composer
      // via the same ?compose=submittal&jobId=N deep link the Applicants
      // page uses. The actual stage move to "submitted" only happens
      // when the recruiter hits Send in the composer; the inline-action
      // path here used to write the move directly without showing the
      // email, which was the bug the deep-link fix is correcting.
      return (
        <ActionRow disabled={isPending}>
          <NavButton
            icon={Send}
            label="Submit"
            tone="primary"
            href={`${profileHref}?compose=submittal&jobId=${props.jobRfId}`}
            title="Open submittal composer"
          />
          <ActionButton icon={Bookmark} label="Keep" onClick={onKeep} />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "kept":
      // Submit (deep-link composer) / Move to Applied (revert) / Reject.
      // Move to Applied is the canonical promotion path out of Kept —
      // recruiter wants to re-engage the candidate without surfacing
      // the submittal composer yet.
      return (
        <ActionRow disabled={isPending}>
          <NavButton
            icon={Send}
            label="Submit"
            tone="primary"
            href={`${profileHref}?compose=submittal&jobId=${props.jobRfId}`}
            title="Open submittal composer"
          />
          <ActionButton
            icon={CornerUpLeft}
            label="Move to Applied"
            title="Revert this Kept candidate back to Applied"
            onClick={onMoveToApplied}
          />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "submitted":
      // Schedule / Move to Kept / Reject. Move to Kept lets the
      // recruiter pull a candidate back out of Submitted (e.g. before
      // the client sees the submittal, or after silence to re-nurture
      // for a different role) without rejecting them.
      return (
        <ActionRow disabled={isPending}>
          <DialogOrNav
            icon={CalendarClock}
            label="Schedule"
            title="Schedule Interview"
            tone="schedule"
            onClick={props.onSchedule}
            href={profileHref}
          />
          <ActionButton
            icon={CornerUpLeft}
            label="Move to Kept"
            title="Pull this candidate back to Kept"
            onClick={onMoveToKept}
          />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "interviewing":
      // Schedule (next round) / Offer / Reject.
      return (
        <ActionRow disabled={isPending}>
          <DialogOrNav
            icon={CalendarClock}
            label="Schedule"
            title="Schedule another interview"
            tone="schedule"
            onClick={props.onSchedule}
            href={profileHref}
          />
          <DialogOrNav
            icon={DollarSign}
            label="Offer"
            title="Offer Received"
            onClick={props.onOffer}
            href={profileHref}
          />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "offer":
      return (
        <ActionRow disabled={isPending}>
          <DialogOrNav
            icon={Handshake}
            label="Placement"
            title="Record placement"
            tone="primary"
            onClick={props.onPlacement}
            href={profileHref}
          />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "pending_start":
      return (
        <ActionRow disabled={isPending}>
          <DialogOrNav
            icon={Edit3}
            label="Edit Placement"
            title="Edit placement details"
            tone="default"
            onClick={props.onPlacement}
            href={profileHref}
          />
          <DialogOrNav
            icon={CheckCircle2}
            label="Confirm"
            title="Confirm start"
            tone="primary"
            onClick={props.onConfirmStart}
            href={profileHref}
          />
          <DialogOrNav
            icon={Ban}
            label="Cancel"
            title="Cancel placement"
            tone="danger"
            onClick={props.onCancelPlacement}
            href={profileHref}
          />
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
      {disabled && <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />}
      {children}
    </div>
  );
}

type Tone = "default" | "primary" | "danger" | "schedule" | "apply";

const TONE_CLASS: Record<Tone, string> = {
  default: "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200",
  primary: "border-brand bg-brand text-white hover:bg-brand-dark",
  danger: "border-red-200 bg-red-50 text-red-600 hover:bg-red-100",
  schedule: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
  apply: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
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

// When `onClick` is provided we render an inline-action button (used
// on the candidate profile where the dialog already lives in the
// same React tree). Otherwise we fall back to a NavButton that takes
// the recruiter to the candidate profile so the dialog can open
// there. Same pixels either way; the only difference is which side
// of the navigation the dialog mounts on.
function DialogOrNav({
  icon,
  label,
  title,
  tone,
  onClick,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title?: string;
  tone?: Tone;
  onClick?: () => void;
  href: string;
}) {
  if (onClick) {
    return <ActionButton icon={icon} label={label} title={title} tone={tone} onClick={onClick} />;
  }
  return <NavButton icon={icon} label={label} title={title} tone={tone} href={href} />;
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
