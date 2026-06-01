"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bookmark, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  keepCandidate,
  moveToApplied,
} from "@/app/candidates/[id]/placement-actions";
import {
  keepLocalCandidateForJob,
  revertLocalKeepToApplied,
} from "@/app/candidates/[id]/local-placement-actions";

// Candidate-level Keep — placement/job-aware. Source of truth for the
// button state is Placement.stage="kept" (CLAUDE.md rule 13), NOT
// Candidate.tags. The earlier tag-based toggle is gone — it never wrote
// a Placement row, so candidates marked Kept here never landed in any
// job's Kept tab on /jobs/[id]. Clicking now always opens a dialog so
// the recruiter picks which job to mark kept (or removes Kept from).

export type KeepCandidateRef =
  | { kind: "rf"; rfId: number }
  | { kind: "local"; cuid: string };

// One candidate↔job relationship. Drives both the "currently kept on"
// list (for unkeep) and the "switch the existing placement to Kept"
// list. Identity shape is dual: jobRfId for RF-imported, jobCuid for
// Ace-native. clientRfId / clientCuid mirror the same dual identity
// so keepCandidate's FK resolver can fill both columns server-side.
export type KeepPlacementSummary = {
  placementId: string;
  jobRfId: number | null;
  jobCuid: string | null;
  jobTitle: string;
  clientRfId: number | null;
  clientCuid: string | null;
  clientName: string;
  stage: string;
};

// Open job the candidate is not yet linked to. Used to seed a fresh
// Placement(stage="kept") for a candidate with no relationship to the
// chosen job yet.
export type KeepOpenJob = {
  jobRfId: number | null;
  jobCuid: string | null;
  jobTitle: string;
  clientRfId: number | null;
  clientCuid: string | null;
  clientName: string;
};

export function KeepCandidateButton({
  candidate,
  placements,
  openJobs,
  className,
}: {
  candidate: KeepCandidateRef;
  placements: KeepPlacementSummary[];
  openJobs: KeepOpenJob[];
  // Optional class merge so callers (candidate-profile action row) can
  // override the base "keep" variant. Existing call sites pass the
  // tab-chip sizing utilities; matches-tab etc. omit this prop and get
  // the default sizing.
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // isKept derives from Placement.stage on this candidate's placements.
  // Any one placement at stage="kept" flips the button into Kept state.
  // This naturally clears when a kept placement transitions to applied/
  // submitted/etc. (via the per-job pill actions on the profile, the
  // job-page Pipeline row actions, or the kept→applied fix in
  // applyCandidateToJob), so the button no longer lingers on Kept after
  // the recruiter moves the candidate forward.
  const keptPlacements = placements.filter((p) => p.stage.trim().toLowerCase() === "kept");
  const isKept = keptPlacements.length > 0;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="keep"
        onClick={() => setOpen(true)}
        aria-pressed={isKept}
        title={isKept ? "Manage Kept" : "Mark as Kept on a job"}
        className={className ?? "text-sm"}
      >
        <Bookmark className={cn("h-3 w-3 shrink-0", isKept && "fill-current")} />
        {/* Label wrapped so a min-w-0 parent (e.g. a no-wrap sticky bar)
            can ellipsize "Keep"/"Kept" instead of forcing the button to
            push its siblings to a second row. */}
        <span className="truncate">{isKept ? "Kept" : "Keep"}</span>
      </Button>
      {open && (
        <KeepDialog
          candidate={candidate}
          placements={placements}
          keptPlacements={keptPlacements}
          openJobs={openJobs}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Picker dialog rendered when the recruiter clicks Keep on the profile.
// Two sections so both keep and unkeep flow through the same UI:
//   - "Currently kept on" — placements at stage=kept, with a Remove
//     button that flips the row back to Applied (the natural revert).
//   - "Mark Kept on" — every other linkable target. Existing placements
//     at non-terminal earlier stages (sourced/applied/submitted) appear
//     here so the recruiter can flip one to Kept, plus the open-jobs
//     dropdown for jobs the candidate isn't yet attached to.
function KeepDialog({
  candidate,
  placements,
  keptPlacements,
  openJobs,
  onClose,
}: {
  candidate: KeepCandidateRef;
  placements: KeepPlacementSummary[];
  keptPlacements: KeepPlacementSummary[];
  openJobs: KeepOpenJob[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [selectedOpenJobKey, setSelectedOpenJobKey] = useState<string>("");

  // Placements not currently kept are valid targets for "Mark Kept" too.
  // We exclude terminal stages (hired/rejected/cancelled) — Keep on a
  // hired or rejected row doesn't make sense and the per-job row already
  // exposes Reapply / Cancel for those cases.
  const TERMINAL = new Set(["hired", "rejected", "cancelled", "disqualified"]);
  const nonKeptPlacements = placements.filter(
    (p) => p.stage.trim().toLowerCase() !== "kept" && !TERMINAL.has(p.stage.trim().toLowerCase()),
  );

  // openJobs is already filtered server-side to "open" jobs but may
  // include rows that ARE already linked (alreadyLinked=true on the
  // PlacementContextJob/LocalOpenJob upstream). For the picker here we
  // only want jobs the candidate has NO placement on yet — anything
  // they're already linked to lives in nonKeptPlacements above so the
  // recruiter sees the existing relationship + its current stage.
  const linkedJobKeys = new Set(
    placements.map((p) => jobKey({ jobRfId: p.jobRfId, jobCuid: p.jobCuid })),
  );
  const availableOpenJobs = openJobs.filter(
    (j) => !linkedJobKeys.has(jobKey({ jobRfId: j.jobRfId, jobCuid: j.jobCuid })),
  );

  const pickedOpenJob = availableOpenJobs.find(
    (j) => jobKey({ jobRfId: j.jobRfId, jobCuid: j.jobCuid }) === selectedOpenJobKey,
  ) ?? null;

  function runKeep(target: KeepOpenJob | KeepPlacementSummary) {
    setErr(null);
    startTransition(async () => {
      const res = await callKeep(candidate, target);
      if (!res.ok) {
        setErr(res.error);
        toast.error("Couldn't mark as Kept", { description: res.error });
        return;
      }
      toast.success("Kept", {
        description: `${target.jobTitle}${target.clientName ? ` · ${target.clientName}` : ""} → Kept stage.`,
      });
      router.refresh();
      onClose();
    });
  }

  function runUnkeep(p: KeepPlacementSummary) {
    setErr(null);
    startTransition(async () => {
      const res = await callUnkeep(candidate, p);
      if (!res.ok) {
        setErr(res.error);
        toast.error("Couldn't remove from Kept", { description: res.error });
        return;
      }
      toast.success("Removed from Kept", {
        description: `${p.jobTitle}${p.clientName ? ` · ${p.clientName}` : ""} → Applied.`,
      });
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal title="Keep candidate" subtitle="Keep is per-job. Pick which job's Kept tab this candidate should land in." onClose={onClose}>
      {keptPlacements.length > 0 && (
        <section className="mb-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
            Currently kept on
          </h3>
          <ul className="mt-2 space-y-1.5">
            {keptPlacements.map((p) => (
              <li key={p.placementId} className="flex items-center justify-between gap-2 rounded-lg border border-court-border/40 bg-court-surface-subtle/40 px-3 py-2 text-sm">
                <div className="min-w-0 truncate">
                  <span className="font-medium text-court-fg">{p.jobTitle}</span>
                  {p.clientName && (
                    <span className="ml-1 text-court-fg-muted">· {p.clientName}</span>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => runUnkeep(p)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {nonKeptPlacements.length > 0 && (
        <section className="mb-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
            Switch existing job to Kept
          </h3>
          <ul className="mt-2 space-y-1.5">
            {nonKeptPlacements.map((p) => (
              <li key={p.placementId} className="flex items-center justify-between gap-2 rounded-lg border border-court-border/40 bg-court-surface px-3 py-2 text-sm">
                <div className="min-w-0 truncate">
                  <span className="font-medium text-court-fg">{p.jobTitle}</span>
                  {p.clientName && (
                    <span className="ml-1 text-court-fg-muted">· {p.clientName}</span>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="keep"
                  disabled={isPending}
                  onClick={() => runKeep(p)}
                >
                  Keep
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Or add a new job at Kept
        </h3>
        <label className="mt-2 block text-sm">
          <select
            value={selectedOpenJobKey}
            onChange={(e) => setSelectedOpenJobKey(e.target.value)}
            className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            <option value="">Select an open job…</option>
            {availableOpenJobs.map((j) => {
              const key = jobKey({ jobRfId: j.jobRfId, jobCuid: j.jobCuid });
              return (
                <option key={key} value={key}>
                  {j.clientName ? `${j.clientName}: ${j.jobTitle}` : j.jobTitle}
                </option>
              );
            })}
          </select>
        </label>
        {availableOpenJobs.length === 0 && nonKeptPlacements.length === 0 && keptPlacements.length === 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            No open jobs available to Keep this candidate on.
          </div>
        )}
      </section>

      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="keep"
          size="sm"
          disabled={isPending || !pickedOpenJob}
          onClick={() => pickedOpenJob && runKeep(pickedOpenJob)}
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bookmark className="h-3 w-3" />}
          <span>Keep</span>
        </Button>
      </div>
    </Modal>
  );
}

// Stable string key for a job spanning both identity shapes. RF-imported
// jobs key on jobRfId; Ace-native jobs key on jobCuid. Used to dedupe
// the open-jobs picker against existing placements without joining the
// two keyspaces server-side.
function jobKey(j: { jobRfId: number | null; jobCuid: string | null }): string {
  if (j.jobCuid) return `ace:${j.jobCuid}`;
  if (j.jobRfId != null) return `rf:${j.jobRfId}`;
  return "";
}

type ServerResult = { ok: true } | { ok: false; error: string };

async function callKeep(
  candidate: KeepCandidateRef,
  target: KeepOpenJob | KeepPlacementSummary,
): Promise<ServerResult> {
  // RF candidate ↔ keepCandidate. Requires candidateRfId, jobRfId, and
  // clientRfId on the input; jobCuid/clientCuid are optional companion
  // pointers the resolver writes when present. Ace-native jobs surface
  // through the picker with synthetic-negative jobRfId + a real jobCuid,
  // so we forward both — keepCandidate's resolveCuidFks handles the
  // case where the numeric id is synthetic.
  if (candidate.kind === "rf") {
    return keepCandidate({
      candidateRfId: candidate.rfId,
      jobRfId: target.jobRfId ?? 0,
      clientRfId: target.clientRfId ?? 0,
      jobCuid: target.jobCuid,
      clientCuid: target.clientCuid,
    });
  }
  // Ace-native candidate ↔ keepLocalCandidateForJob. The action accepts
  // either {jobId} (Ace-native job) or {jobRfId} (RF-imported job) so the
  // recruiter can keep an Ace candidate on either job-identity flavor.
  return keepLocalCandidateForJob({
    candidateId: candidate.cuid,
    jobRfId: target.jobRfId,
    jobId: target.jobCuid,
    clientRfId: target.clientRfId,
    clientId: target.clientCuid,
  });
}

async function callUnkeep(
  candidate: KeepCandidateRef,
  placement: KeepPlacementSummary,
): Promise<ServerResult> {
  // Unkeep = flip the kept Placement back to "applied". moveToApplied
  // (RF) writes through the candidateRfId+jobRfId unique index;
  // revertLocalKeepToApplied (local) scopes by placementId so it covers
  // both Ace-native and RF-imported job identities without a second
  // identity branch here.
  if (candidate.kind === "rf") {
    return moveToApplied({
      candidateRfId: candidate.rfId,
      jobRfId: placement.jobRfId ?? 0,
      clientRfId: placement.clientRfId ?? 0,
      jobCuid: placement.jobCuid,
      clientCuid: placement.clientCuid,
      previousStage: "kept",
    });
  }
  return revertLocalKeepToApplied({
    candidateId: candidate.cuid,
    placementId: placement.placementId,
  });
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Portal to document.body so the overlay escapes the candidate-profile
  // tree. The profile's sticky pipeline bundle uses `backdrop-blur`, which
  // creates a containing block for `fixed` descendants — without the portal
  // `fixed inset-0` was being clamped to that sticky box instead of the
  // viewport, so the dialog clipped off the top of the screen (the max-height
  // fix couldn't help because the box itself was the wrong size/position).
  // Guard SSR where document is undefined.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // Click-outside dismisses, matching the Apply/Submit dialogs in
        // placement-flows.tsx. Inner clicks bubble up through the panel
        // so they don't accidentally close.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Capped to the viewport (backdrop has 1rem padding each side) and
          laid out as a pinned header + scrollable body so a tall dialog
          (both Kept sections + the job dropdown + footer buttons) can never
          clip off the TOP of the screen — the body scrolls instead. Mirrors
          the EmailComposer panel structure. */}
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 p-5 pb-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-court-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-court-fg-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
