import { cn } from "@/lib/utils";
import { canonicalStage, PIPELINE_LABELS, type PipelineBucket } from "@/lib/recruiterflow";

const BUCKET_CLASS: Record<PipelineBucket, string> = {
  applied: "bg-slate-50 text-slate-700",
  submitted: "bg-brand-tint text-brand-dark",
  interviewing: "bg-blue-50 text-blue-700",
  offer: "bg-amber-50 text-amber-700",
  pending_start: "bg-purple-50 text-purple-700",
  hired: "bg-emerald-50 text-emerald-700",
  sourced: "bg-muted text-navy-400",
  rejected: "bg-red-50 text-red-700",
  other: "bg-muted text-navy-400",
};

const BUCKET_LABEL: Record<PipelineBucket, string> = {
  applied: "Applied",
  submitted: PIPELINE_LABELS.submitted,
  interviewing: PIPELINE_LABELS.interviewing,
  offer: PIPELINE_LABELS.offer,
  pending_start: PIPELINE_LABELS.pending_start,
  hired: PIPELINE_LABELS.hired,
  sourced: "Sourced",
  rejected: "Rejected",
  other: "Other",
};

function bucketLabel(bucket: PipelineBucket, override?: string | null): string {
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
        "inline-flex min-w-24 items-center justify-center rounded-full px-3 py-1 text-center text-[11px] font-bold uppercase tracking-wide",
        BUCKET_CLASS[bucket],
        interactive && "cursor-pointer transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-brand/30",
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
        <div className="text-center text-xs font-semibold text-navy-400">{clientName}</div>
      ) : null}
      <StageBadge bucket={bucket} label={label} suffix={suffix} onClick={onClick} title={title} />
    </div>
  );
}

export { BUCKET_CLASS, BUCKET_LABEL };
