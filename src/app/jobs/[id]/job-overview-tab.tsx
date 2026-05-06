import {
  Briefcase,
  CheckCircle2,
  CircleDashed,
  DollarSign,
  MapPin,
  Percent,
  Users,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import type { PipelineBucket } from "@/lib/rf-payload-shapes";
import type { JobPipelineRow } from "@/app/jobs/[id]/pipeline-summary";
import { JobOverviewQuickActions } from "@/app/jobs/[id]/job-overview-quick-actions";
import type { MatchTarget } from "@/lib/find-matches-context";

// Overview tab body. Snapshot of the job's key facts, a row of stage
// count chips pulled from the same pipeline rows the strip above uses,
// the four quick-action buttons, and a "Search Health — Coming soon"
// row. Right-rail summary card (EditableJobOverview) is rendered by
// the parent so it stays sticky across tab switches.

const STAGE_ORDER: PipelineBucket[] = [
  "applied",
  "sourced",
  "kept",
  "submitted",
  "interviewing",
  "offer",
  "pending_start",
  "hired",
  "rejected",
];

const STAGE_LABELS: Record<PipelineBucket, string> = {
  applied: "Applied",
  sourced: "Sourced",
  kept: "Kept",
  submitted: "Submitted",
  interviewing: "Interviewing",
  offer: "Offer",
  pending_start: "Pending Start",
  hired: "Hired",
  rejected: "Rejected",
  cancelled: "Cancelled",
  other: "Other",
};

const STAGE_TONE: Record<PipelineBucket, string> = {
  applied: "border-court-border bg-court-surface-subtle text-court-fg-muted",
  sourced: "border-court-border bg-court-surface-subtle text-court-fg-muted",
  kept: "border-amber-200 bg-amber-50 text-amber-800",
  submitted: "border-brand/30 bg-brand-tint text-brand-dark",
  interviewing: "border-brand/40 bg-brand/25 text-brand-dark",
  offer: "border-brand bg-brand/50 text-white",
  pending_start: "border-brand-dark bg-brand text-white",
  hired: "border-brand-dark bg-brand-dark text-white",
  rejected: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-red-300 bg-red-100 text-red-800",
  other: "border-court-border bg-court-surface-subtle text-court-fg-muted",
};

export type JobOverviewSnapshot = {
  title: string;
  clientName: string;
  locations: string[];
  isOpen: boolean;
  employmentType: string | null;
  compensation: string;
  feePct: number | null;
  numberOfOpenings: number | null;
  lastEditedAt: string | null;
  applyLink: string | null;
};

export function JobOverviewTab({
  snapshot,
  pipelineRows,
  matchTarget,
}: {
  snapshot: JobOverviewSnapshot;
  pipelineRows: JobPipelineRow[];
  matchTarget: MatchTarget;
}) {
  const counts = new Map<PipelineBucket, number>();
  for (const r of pipelineRows) {
    counts.set(r.bucket, (counts.get(r.bucket) ?? 0) + 1);
  }

  return (
    <div className="space-y-5">
      {/* Snapshot facts grid. Keeps each fact paired with a small icon
          + label so the Overview reads as a quick-glance summary, not
          another edit surface — the right-rail card is the editor. */}
      <section className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SnapshotFact
            icon={<Briefcase className="h-3.5 w-3.5" />}
            label="Employment"
            value={snapshot.employmentType || "—"}
          />
          <SnapshotFact
            icon={<MapPin className="h-3.5 w-3.5" />}
            label="Location"
            value={snapshot.locations.length > 0 ? snapshot.locations.join(", ") : "—"}
          />
          <SnapshotFact
            icon={
              snapshot.isOpen ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <CircleDashed className="h-3.5 w-3.5" />
              )
            }
            label="Status"
            value={
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
                  snapshot.isOpen
                    ? "bg-brand-tint text-brand-dark"
                    : "bg-court-surface-subtle text-court-fg-muted",
                )}
              >
                {snapshot.isOpen ? "Active" : "Inactive"}
              </span>
            }
          />
          <SnapshotFact
            icon={<DollarSign className="h-3.5 w-3.5" />}
            label="Compensation"
            value={snapshot.compensation}
          />
          <SnapshotFact
            icon={<Percent className="h-3.5 w-3.5" />}
            label="Fee"
            value={snapshot.feePct != null ? `${snapshot.feePct}%` : "—"}
          />
          <SnapshotFact
            icon={<Users className="h-3.5 w-3.5" />}
            label="Openings"
            value={
              snapshot.numberOfOpenings != null
                ? String(snapshot.numberOfOpenings)
                : "—"
            }
          />
          <SnapshotFact
            label="Last Edited"
            value={formatDate(snapshot.lastEditedAt)}
          />
        </div>
      </section>

      {/* Stage-count chip row. Read-only snapshot — the interactive
          chip strip above the tabs is still the place to drill in. */}
      <section className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Pipeline
        </div>
        <div className="flex flex-wrap gap-2">
          {STAGE_ORDER.map((bucket) => {
            const count = counts.get(bucket) ?? 0;
            return (
              <div
                key={bucket}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-semibold",
                  STAGE_TONE[bucket],
                )}
              >
                <span className="uppercase tracking-wider text-[10px]">
                  {STAGE_LABELS[bucket]}
                </span>
                <span className="text-sm">{count}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick actions. Find Matches is real; the other three are
          stubs (Edit Job hands off to the right-rail edit toggle,
          Copy Public Apply Link writes to the clipboard, Generate JD
          with Claude is "Coming soon"). */}
      <section className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Quick Actions
        </div>
        <JobOverviewQuickActions
          matchTarget={matchTarget}
          applyLink={snapshot.applyLink}
        />
      </section>

      {/* Search Health placeholder. The chip is a "Coming soon" tag so
          the row is wired but visibly inert until the real signal lands. */}
      <section className="rounded-xl border border-dashed border-court-border bg-court-surface-subtle/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
              Search Health
            </div>
            <div className="mt-1 text-sm text-court-fg-muted">
              Signal on whether this job is actively producing matches and movement.
            </div>
          </div>
          <span className="inline-flex items-center rounded-full border border-court-border bg-court-surface px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
            Coming soon
          </span>
        </div>
      </section>
    </div>
  );
}

function SnapshotFact({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm text-court-fg">{value}</div>
    </div>
  );
}
