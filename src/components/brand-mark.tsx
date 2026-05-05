import { cn } from "@/lib/utils";

// Sidebar wordmark — Serve Arc mark + "Ace · BreakPoint Talent"
// lockup. The mark SVG colors (#111111, #7BB85B) are intentionally
// hard-coded: the mark is an asset, not a UI surface, so it reads
// identically across every Court Mode. The text uses the
// court-sidebar-* token family when rendered inside the sidebar
// (a [data-in-sidebar] ancestor) and the regular court-fg family
// otherwise — so a future use of this lockup in a non-sidebar
// surface (login splash, etc.) still inherits sensible defaults.
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
        width="36"
        height="36"
        viewBox="0 0 60 60"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <circle cx="30" cy="30" r="28" fill="#111111" />
        <path
          d="M 14 38 Q 30 18 46 30"
          stroke="#7BB85B"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="46" cy="30" r="4.5" fill="#7BB85B" />
      </svg>
      <div className="leading-tight">
        <div className="font-serif text-[22px] font-bold tracking-tight text-court-fg [[data-in-sidebar]_&]:text-court-sidebar-fg">
          Ace
        </div>
        {withTag && (
          <div className="mt-0.5 font-serif text-[12px] italic text-court-fg-muted [[data-in-sidebar]_&]:text-court-sidebar-fg-muted">
            by{" "}
            <span className="font-semibold text-court-accent-dark [[data-in-sidebar]_&]:text-court-sidebar-fg">
              BreakPoint Talent
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
