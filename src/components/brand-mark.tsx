import { cn } from "@/lib/utils";

// Brand wordmark for the sidebar header. Tennis-ball icon (mirrors the
// favicon) + "Ace" wordmark in dark charcoal, optional "BREAKPOINT
// TALENT" subtitle below. Hex colors are intentional per the redesign
// spec; matches favicon.svg / icon.tsx so the brand reads identically
// across the app surface and the browser tab.
export function BrandMark({
  className,
  withTag = false,
}: {
  className?: string;
  withTag?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <svg
        width="32"
        height="32"
        viewBox="0 0 64 64"
        className="shrink-0"
        aria-hidden="true"
      >
        <circle
          cx="32"
          cy="32"
          r="30"
          fill="#5A9642"
          stroke="#222222"
          strokeWidth="2.5"
        />
        <path
          d="M 8 24 Q 22 32 8 42"
          fill="none"
          stroke="white"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path
          d="M 56 24 Q 42 32 56 42"
          fill="none"
          stroke="white"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <text
          x="32"
          y="37"
          textAnchor="middle"
          fontFamily="Arial Black, Arial, sans-serif"
          fontWeight={900}
          fontSize="19"
          fill="white"
        >
          Ace
        </text>
      </svg>
      <div className="leading-tight">
        <div className="text-[16px] font-semibold text-[#111827]">Ace</div>
        {withTag && (
          <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#6B7280]">
            BreakPoint Talent
          </div>
        )}
      </div>
    </div>
  );
}
