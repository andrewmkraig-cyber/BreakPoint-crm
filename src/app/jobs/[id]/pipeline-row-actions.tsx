"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Bookmark,
  CalendarClock,
  CheckCircle2,
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
  deletePlacement,
  keepCandidate,
  rejectCandidateJob,
  unrejectCandidateJob,
} from "@/app/candidates/[id]/placement-actions";

// Inline action-button bank for a single row in the Job-detail
// Pipeline section. Stage-keyed so the recruiter only ever sees
// buttons that make sense for where the candidate is right now.
//
// Two flavors:
//  - "lightweight" actions (Apply / Submit / Keep / Reject /
//    Reapply) call the existing server actions directly with a
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
  // Next-upcoming scheduled interview for this candidate/job. When
  // present and stage === "interviewing", the row renders an
  // Edit Interview button. Profile-side callers also pass
  // onEditInterview to open EditInterviewDialog inline; the
  // job-page caller omits it and the button navigates via deep link
  // (?edit=interview&interviewId=...) to the candidate profile,
  // matching the /pipeline page's existing Edit Interview affordance.
  nextInterview?: { id: string; scheduledAt: string; type: string } | null;
  onEditInterview?: () => void;
  // Local Placement row id. Used by the "disqualified" branch of the
  // switch: older RF-imported placements carry stage="disqualified"
  // (rather than the canonical "rejected") and the Reapply path for
  // those rows deletes the row entirely so the candidate falls back
  // to a clean "no relationship" state for the job.
  placementId?: string | null;
  // Optimistic-removal hook for the disqualified-Reapply branch. When
  // provided, the parent (candidate-profile JobActionRow) filters the
  // placement out of its local jobs state immediately so the row
  // disappears even when the underlying RF candidate.jobs[] payload
  // still references the job. Without this, deleting the Placement
  // row only resets it to the "sourced" fallback — the row stayed
  // visible after Reapply, which read as "click did nothing".
  onPlacementRemoved?: (placementId: string) => void;
  // Optimistic stage flip for the lightweight actions (Apply / Keep) when
  // this row renders on the candidate profile. When provided, runLight
  // hands the new stage to the parent the instant the server action
  // resolves so the job pill updates without waiting on router.refresh()
  // (which races the write + read-replica lag and leaves the pill on its
  // old stage until a manual reload). The parent owns the follow-up
  // refresh; when this is omitted (Job page) runLight falls back to
  // router.refresh() exactly as before.
  onStageChange?: (jobRfId: number, stage: string) => void;
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

  function runLight(
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
    optimisticStage?: string,
  ) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(`Couldn't ${label.toLowerCase()}`, { description: result.error });
        return;
      }
      toast.success(label);
      if (optimisticStage != null && props.onStageChange) {
        // Profile path: flip the pill instantly via the parent's local
        // state. The parent schedules its own reconciling refresh, so we
        // skip router.refresh() here to avoid a refresh racing the write.
        props.onStageChange(props.jobRfId, optimisticStage);
      } else {
        router.refresh();
      }
    });
  }

  function onApply() {
    runLight(
      `Applied ${props.candidateName}`,
      () =>
        applyCandidateToJob({
          candidateRfId: props.candidateRfId,
          jobRfId: props.jobRfId,
          clientRfId: props.clientRfId,
          jobTitle: props.jobTitle,
          clientName: props.clientName,
        }),
      "applied",
    );
  }


  function onKeep() {
    runLight(
      `Kept ${props.candidateName}`,
      () =>
        keepCandidate({
          candidateRfId: props.candidateRfId,
          jobRfId: props.jobRfId,
          clientRfId: props.clientRfId,
        }),
      "kept",
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
    if (
      !confirm(
        `Reapply ${props.candidateName}? They will be restored to the candidate pool for this job with a clean slate.`,
      )
    )
      return;
    runLight(`Reapplied ${props.candidateName}`, () =>
      unrejectCandidateJob({
        candidateRfId: props.candidateRfId,
        jobRfId: props.jobRfId,
        clientRfId: props.clientRfId,
        targetStage: "submitted",
      }),
    );
  }

  // Reapply for the legacy "disqualified" stage value (older RF-imported
  // placements). unrejectCandidateJob only knows how to flip a "rejected"
  // row to "submitted" — these older rows skip that path entirely, so we
  // delete the Placement outright. We deliberately bypass runLight here:
  // its router.refresh() fallback re-renders the row with the same RF
  // candidate.jobs[] backing (stage falls to "sourced") which made
  // Reapply read as a no-op. When the parent supplies
  // onPlacementRemoved, we filter the row out of local state instead.
  function onUnrejectViaDelete() {
    if (!props.placementId) {
      toast.error("Can't reapply", {
        description: "No local placement id. Refresh and try again.",
      });
      return;
    }
    if (
      !confirm(
        `Reapply ${props.candidateName}? This deletes the disqualified placement row so the candidate gets a clean slate for this job.`,
      )
    )
      return;
    const placementId = props.placementId;
    startTransition(async () => {
      const result = await deletePlacement(placementId);
      if (!result.ok) {
        toast.error("Couldn't reapply", { description: result.error });
        return;
      }
      toast.success(`Reapplied ${props.candidateName}`);
      if (props.onPlacementRemoved) {
        props.onPlacementRemoved(placementId);
      } else {
        router.refresh();
      }
    });
  }

  switch (stage) {
    case "sourced":
      // Sourced is the unengaged default. Apply to Job tracks the
      // application and Keep saves the candidate for later. Heavier
      // actions (Submit, Reject) only surface once the candidate is
      // actually moving through the pipeline.
      return (
        <ActionRow disabled={isPending}>
          <ActionButton icon={Plus} label="Apply to Job" tone="apply" onClick={onApply} />
          <ActionButton icon={Bookmark} label="Keep" tone="keep" onClick={onKeep} />
        </ActionRow>
      );
    case "applied":
      // Submit hands off to the candidate profile's submittal composer
      // via the same ?compose=submittal&jobId=N deep link the Applicants
      // page uses. The actual stage move to "submitted" only happens
      // when the recruiter hits Send in the composer; the inline-action
      // path here used to write the move directly without showing the
      // email, which was the bug the deep-link fix is correcting.
      // Keep saves the candidate for later without advancing; Reject
      // drops them. Interview scheduling waits until Submitted.
      return (
        <ActionRow disabled={isPending}>
          <NavButton
            icon={Send}
            label="Submit"
            tone="primary"
            href={`${profileHref}?compose=submittal&jobId=${props.jobRfId}`}
            title="Open submittal composer"
          />
          <ActionButton icon={Bookmark} label="Keep" tone="keep" onClick={onKeep} />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "kept":
      // Submit (deep-link composer) / Reject. Submit is the promotion
      // path out of Kept; Reject drops the candidate.
      return (
        <ActionRow disabled={isPending}>
          <NavButton
            icon={Send}
            label="Submit"
            tone="primary"
            href={`${profileHref}?compose=submittal&jobId=${props.jobRfId}`}
            title="Open submittal composer"
          />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "submitted":
      // Schedule Interview / Reject. The candidate is in front of the
      // client now; the recruiter either books the call or drops them.
      return (
        <ActionRow disabled={isPending}>
          <DialogOrNav
            icon={CalendarClock}
            label="Schedule Interview"
            title="Schedule Interview"
            tone="schedule"
            onClick={props.onSchedule}
            href={profileHref}
          />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "interviewing": {
      // Schedule Interview (next round) / Offer / Reject.
      return (
        <ActionRow disabled={isPending}>
          <DialogOrNav
            icon={CalendarClock}
            label="Schedule Interview"
            title="Schedule another interview"
            tone="schedule"
            onClick={props.onSchedule}
            href={profileHref}
          />
          <DialogOrNav
            icon={DollarSign}
            label="Offer"
            tone="offer"
            title="Offer Received"
            onClick={props.onOffer}
            href={profileHref}
          />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    }
    case "offer":
      return (
        <ActionRow disabled={isPending}>
          <DialogOrNav
            icon={Edit3}
            label="Edit Offer"
            title="Edit offered salary, title, or start date"
            tone="default"
            onClick={props.onOffer}
            href={profileHref}
          />
          <DialogOrNav
            icon={Handshake}
            label="Make Placement"
            title="Record placement"
            tone="primary"
            onClick={props.onPlacement}
            href={profileHref}
          />
          <ActionButton icon={UserX} label="Reject" tone="danger" onClick={onReject} />
        </ActionRow>
      );
    case "pending_start":
      // Cancel + Reject intentionally omitted here. Pending Start is a
      // narrow window between Offer Accepted and Day 1; the only
      // recruiter intents are "they started" (Confirm) or "open the
      // placement to make edits" (Edit Placement). Cancellation lives
      // inside the Edit Placement modal (it has the cancel-reason
      // picker the row-level button never had), and Reject doesn't
      // apply to a candidate who's already been placed.
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
            label="Confirm Start"
            title="Confirm start"
            tone="primary"
            onClick={props.onConfirmStart}
            href={profileHref}
          />
        </ActionRow>
      );
    case "hired":
      // Placed and started. The only row action is Edit Placement so
      // the recruiter can correct fee, dates, or billing contacts after
      // the fact; it opens the same dialog Pending Start uses.
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
        </ActionRow>
      );
    case "rejected":
      return (
        <ActionRow disabled={isPending}>
          <ActionButton icon={RotateCcw} label="Reapply" tone="danger" onClick={onUnreject} />
        </ActionRow>
      );
    // Older RF-imported placements landed with stage="disqualified"
    // rather than the canonical "rejected", so the case "rejected"
    // branch above didn't render Reapply for them. Match the
    // disqualified literal explicitly and route through the delete-
    // based reapply so the row clears out entirely (vs. flipping
    // back to "submitted", which would leave the candidate stuck on
    // an interview-ready stage they were never actually at).
    case "disqualified":
      return (
        <ActionRow disabled={isPending}>
          <ActionButton icon={RotateCcw} label="Reapply" tone="danger" onClick={onUnrejectViaDelete} />
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

type Tone =
  | "default"
  | "primary"
  | "danger"
  | "schedule"
  | "apply"
  | "keep"
  | "offer"
  | "unreject";

// keep   = teal — calm "save for later"
// offer  = purple — matches OFFER stage chip + /pipeline page Offer button
// unreject = indigo — distinct restore action, neither red (Reject) nor green (Submit)
//
// Each tone carries a dark variant that drops the saturated bg-X-50
// tile down to bg-X-950/40 with a softer text color, so on dark mode
// the action chips don't pop bright off the page. Mirrors the dark
// treatment on the shared Button primitive.
const TONE_CLASS: Record<Tone, string> = {
  // Border bumped from slate-200 → slate-400 so the default-tone chip
  // (Edit Placement, Edit Offer, View) outlines at the same visual
  // weight as the colored siblings — Andrew 2026-05-26: Edit
  // Placement was reading borderless next to Confirm Start on both
  // the candidate profile context bar and the /pipeline pending-start
  // row.
  default:
    "border-slate-400 bg-slate-100 text-slate-600 hover:bg-slate-200 dark:border-slate-500 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800",
  primary:
    "border-court-brand bg-court-brand-tint text-court-brand-dark hover:bg-court-brand/25",
  danger:
    "border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60",
  schedule:
    "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60",
  apply:
    "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60",
  // Keep / Move to Kept renders as cyan to match the shared Button
  // "keep" variant (src/components/ui/button.tsx) — when that variant
  // migrated off the soft-blue wash onto cyan to disambiguate from the
  // INTERVIEWING stage badge, this row's tone was left behind on the
  // old blue ramp. That left Keep reading as text-blue-700 inside
  // PipelineRowActions but text-cyan-700 on the candidate-profile
  // action toolbar's KeepCandidateButton — two visually different Keep
  // buttons could appear on a single screen (sourced placement row +
  // candidate-profile chip). Re-aligned to cyan so every Keep across
  // Ace reads as the same hue.
  keep:
    "border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200 dark:hover:bg-cyan-950/60",
  offer:
    "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-200 dark:hover:bg-purple-950/60",
  unreject:
    "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-950/60",
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
