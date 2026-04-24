import { cn } from "@/lib/utils";
import { canonicalStage, PIPELINE_LABELS, type PipelineBucket } from "@/lib/rf-payload-shapes";

// Active pipeline stages share one green shade so side-by-side rows read
// consistently. Inactive buckets (applied/sourced/other) stay muted; rejected
// stays red.
const BUCKET_CLASS: Record<PipelineBucket, string> = {
  applied: "bg-court-surface-subtle text-court-fg-muted ring-1 ring-inset ring-court-border",
  sourced: "bg-court-surface-subtle text-court-fg-muted ring-1 ring-inset ring-court-border",
  // Kept renders amber so it pops out of the muted-pile-of-applicants
  // background — recruiter wants to spot pulled-back candidates fast.
  kept: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
  submitted: "bg-brand-tint text-brand-dark ring-1 ring-inset ring-brand/40",
  interviewing: "bg-brand-tint text-brand-dark ring-1 ring-inset ring-brand/40",
  offer: "bg-brand-tint text-brand-dark ring-1 ring-inset ring-brand/40",
  pending_start: "bg-brand-tint text-brand-dark ring-1 ring-inset ring-brand/40",
  hired: "bg-brand-tint text-brand-dark ring-1 ring-inset ring-brand/40",
  rejected: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
  cancelled: "bg-red-100 text-red-800 ring-1 ring-inset ring-red-300",
  other: "bg-court-surface-subtle text-court-fg-muted ring-1 ring-inset ring-court-border",
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
        "inline-flex h-6 min-w-[6.5rem] items-center justify-center whitespace-nowrap rounded-full px-3 text-center text-[11px] font-bold uppercase leading-none tracking-wide",
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
