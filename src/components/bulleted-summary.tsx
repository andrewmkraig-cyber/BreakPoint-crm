import { cn } from "@/lib/utils";

// Renders a Claude bullet-list summary where each line looks like:
//   - **Label:** value
// Falls back to rendering plain lines when the pattern doesn't match.
export function BulletedSummary({ text, className }: { text: string; className?: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  return (
    <ul className={cn("space-y-1.5 text-sm leading-relaxed text-navy", className)}>
      {lines.map((raw, i) => {
        const stripped = raw.replace(/^[-*•]\s*/, "");
        const bold = stripped.match(/^\*\*(.+?):\*\*\s*(.*)$/);
        const plain = bold ? null : stripped.match(/^(.+?):\s*(.*)$/);
        const label = bold?.[1] ?? plain?.[1] ?? null;
        const value = bold?.[2] ?? plain?.[2] ?? stripped;

        return (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="select-none pt-[2px] text-brand-dark">•</span>
            <span className="min-w-0">
              {label && (
                <span className="font-semibold text-navy">{label}:{" "}</span>
              )}
              <span className="text-navy-400">{value}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
