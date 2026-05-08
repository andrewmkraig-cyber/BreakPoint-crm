import { cn } from "@/lib/utils";
import { canonicalStage, PIPELINE_LABELS, type PipelineBucket } from "@/lib/rf-payload-shapes";

// Stage colors. Uniform pill treatment across every row regardless of
// where it renders — the candidate-profile pipeline, the Pipeline page,
// and any future surface read this map. Court tokens for neutral
// stages so the palette tracks Hard/Clay/Grass mode; Tailwind palette
// tokens for the typed stages (red/blue/amber/emerald/purple) so the
// semantic meaning is unambiguous regardless of theme.
//
// Each typed stage carries a dark variant — bg-X-950/40 + text-X-200 +
// border-X-900 — so on Hard/Clay/Grass dark and Night the chips
// don't pop bright off the page. Mirrors the row-action chip
// treatment so the whole pipeline reads consistently in dark mode.
const BUCKET_CLASS: Record<PipelineBucket, string> = {
  sourced:
    "bg-court-surface-subtle text-court-fg-muted border border-court-border",
  applied:
    "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
  kept:
    "bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800",
  submitted:
    "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900",
  interviewing:
    "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
  offer:
    "bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-900",
  pending_start:
    "bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-900",
  hired:
    "bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800",
  rejected:
    "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900",
  cancelled:
    "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900",
  other:
    "bg-court-surface-subtle text-court-fg-muted border border-court-border",
};

const BUCKET_LABEL: Record<PipelineBucket, string> = {
  applied: "Applied",
  kept: "Kept",
  submitted: PIPELINE_LABELS.submitted,
  interviewing: PIPELINE_LABELS.interviewing,
  offer: PIPELINE_LABELS.offer,
  pending_start: PIPELINE_LABELS.pending_start,
  hired: PIPELINE_LABELS.hired,
  sourced: "Sourced",
  rejected: "Disqualified",
  cancelled: "Placement Cancelled",
  other: "Other",
};

// Buckets where the bucket label must win even when an RF stage_name is
// available — used for terminal Ace-local states that shouldn't leak RF's
// last known stage ("Client Submission" etc.) into the visible badge.
const TERMINAL_BUCKETS: ReadonlySet<PipelineBucket> = new Set<PipelineBucket>(["cancelled", "rejected"]);

function bucketLabel(bucket: PipelineBucket, override?: string | null): string {
  // Terminal Ace-local buckets (cancelled) always render the bucket's own
  // label regardless of any RF stage_name override.
  if (TERMINAL_BUCKETS.has(bucket)) return BUCKET_LABEL[bucket];
  if (override && override.trim()) return override.trim();
  return BUCKET_LABEL[bucket];
}

export function StageBadge({
  bucket,
  label,
  suffix,
  className,
  onClick,
  title,
}: {
  bucket: PipelineBucket;
  label?: string | null;
  suffix?: string | null;
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  const text = bucketLabel(bucket, label);
  const full = suffix ? `${text} · ${suffix}` : text;
  const interactive = Boolean(onClick);
  const Tag = interactive ? "button" : "span";
  return (
    <Tag
      type={interactive ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide",
        BUCKET_CLASS[bucket],
        interactive && "cursor-pointer transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand/40",
        className,
      )}
    >
      {full}
    </Tag>
  );
}

export function StageBadgeFromName({
  stageName,
  suffix,
  className,
  onClick,
  title,
}: {
  stageName: string | null | undefined;
  suffix?: string | null;
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  const bucket = canonicalStage(stageName ?? "");
  return (
    <StageBadge
      bucket={bucket}
      label={bucket === "other" ? stageName ?? null : null}
      suffix={suffix}
      className={className}
      onClick={onClick}
      title={title}
    />
  );
}

export function StageBadgeStack({
  clientName,
  bucket,
  label,
  suffix,
  onClick,
  title,
  className,
}: {
  clientName?: string | null;
  bucket: PipelineBucket;
  label?: string | null;
  suffix?: string | null;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      {clientName ? (
        <div className="text-center text-xs font-semibold text-court-fg-muted">{clientName}</div>
      ) : null}
      <StageBadge bucket={bucket} label={label} suffix={suffix} onClick={onClick} title={title} />
    </div>
  );
}

export { BUCKET_CLASS, BUCKET_LABEL };
