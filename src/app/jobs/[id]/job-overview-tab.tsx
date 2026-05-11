import {
  Briefcase,
  CheckCircle2,
  CircleDashed,
  DollarSign,
  EyeOff,
  MapPin,
  Percent,
  Users,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { JobOverviewActionButtons } from "@/app/jobs/[id]/job-overview-action-buttons";
import type { JobLifecycle } from "@/app/jobs/[id]/job-overview-actions";

// Overview tab body. Snapshot of the job's key facts plus top-of-tab
// lifecycle actions (Inactivate / Make Private / Reactivate / Delete).
// Edit-style writes still live on the right-rail EditableJobOverview
// card so the same sticky surface owns granular field saves; the
// buttons here are the one-shot lifecycle actions (move state, nuke a
// mistake import) that don't fit a per-field edit flow.

export type JobOverviewSnapshot = {
  jobId: string;
  title: string;
  clientName: string;
  locations: string[];
  lifecycle: JobLifecycle;
  employmentType: string | null;
  compensation: string;
  feePct: number | null;
  numberOfOpenings: number | null;
  lastEditedAt: string | null;
  applyLink: string | null;
};

export function JobOverviewTab({ snapshot }: { snapshot: JobOverviewSnapshot }) {
  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-end">
        <JobOverviewActionButtons jobId={snapshot.jobId} lifecycle={snapshot.lifecycle} />
      </section>

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
              snapshot.lifecycle === "active" ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : snapshot.lifecycle === "private" ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <CircleDashed className="h-3.5 w-3.5" />
              )
            }
            label="Status"
            value={
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
                  snapshot.lifecycle === "active"
                    ? "bg-brand-tint text-brand-dark"
                    : snapshot.lifecycle === "private"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-red-100 text-red-700",
                )}
              >
                {snapshot.lifecycle === "active"
                  ? "Active"
                  : snapshot.lifecycle === "private"
                    ? "Private"
                    : "Inactive"}
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
