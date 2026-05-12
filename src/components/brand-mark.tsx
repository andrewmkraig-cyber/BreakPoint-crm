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
        width="40"
        height="40"
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
        <div
          className="font-serif text-[24px] font-black leading-none text-court-fg [[data-in-sidebar]_&]:text-court-sidebar-fg-muted"
          style={{ letterSpacing: "-0.03em" }}
        >
          Ace
        </div>
        {withTag && (
          // "by" stays a separate word so it can wrap to its own line
          // when the sidebar is squished, but "BreakPoint Talent" gets
          // whitespace-nowrap so the brand name never splits mid-words
          // — at the default 60w (240px) sidebar there's plenty of room
          // to render "by BreakPoint Talent" on a single line.
          <div className="mt-1 font-serif text-[12px] font-medium text-court-fg-muted [[data-in-sidebar]_&]:text-court-sidebar-fg-muted">
            by{" "}
            <span className="whitespace-nowrap font-bold text-court-accent-dark [[data-in-sidebar]_&]:text-court-sidebar-fg-muted">
              BreakPoint Talent
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
