import { cn } from "@/lib/utils";
import { canonicalStage, PIPELINE_LABELS, type PipelineBucket } from "@/lib/rf-payload-shapes";

// Stage colors mapped to the same semantic palette as the row action
// buttons so a candidate's stage chip and the buttons that move them
// to the next stage share visual language. Rendered with `border` for
// pixel parity with the button system; the bucket-specific tint goes
// on bg + text + border edge.
const BUCKET_CLASS: Record<PipelineBucket, string> = {
  sourced: "bg-slate-100 text-slate-600 border border-slate-200",
  applied: "bg-amber-50 text-amber-700 border border-amber-200",
  kept: "bg-slate-100 text-slate-600 border border-slate-200",
  submitted: "bg-brand-tint text-brand-dark border border-brand/20",
  interviewing: "bg-blue-50 text-blue-700 border border-blue-200",
  offer: "bg-purple-50 text-purple-700 border border-purple-200",
  // pending_start sits between offer and hired — keep brand-tint so
  // it reads as a positive interim stage.
  pending_start: "bg-brand-tint text-brand-dark border border-brand/20",
  hired: "bg-green-100 text-green-800 border border-green-300",
  rejected: "bg-red-50 text-red-600 border border-red-200",
  // cancelled is a darker, more terminal red so it doesn't read as
  // "just rejected" — the placement actually started and stopped.
  cancelled: "bg-red-100 text-red-800 border border-red-300",
  other: "bg-slate-100 text-slate-600 border border-slate-200",
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
