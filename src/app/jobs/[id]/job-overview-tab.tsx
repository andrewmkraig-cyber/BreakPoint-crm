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

// Overview tab body. Snapshot of the job's key facts plus a Search
// Health placeholder. Action buttons live on the Job Description tab —
// Overview is read-only context. Right-rail summary card
// (EditableJobOverview) is rendered by the parent so it stays sticky
// across tab switches.

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

export function JobOverviewTab({ snapshot }: { snapshot: JobOverviewSnapshot }) {
  return (
    <div className="space-y-5">
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
