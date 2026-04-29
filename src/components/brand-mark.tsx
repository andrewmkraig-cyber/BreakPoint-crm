import { cn } from "@/lib/utils";

// Sidebar wordmark — Serve Arc mark + "Ace · BreakPoint Talent"
// lockup. The mark colors (#111111, #7BB85B) are intentionally
// hard-coded: the brand mark is an asset, not a UI surface, so it
// reads identically across every Court Mode. Surrounding text DOES
// follow the Court Mode tokens — court-fg / court-fg-muted /
// court-accent-dark — so "BreakPoint Talent" lifts to the lifted
// green in Night and recolors per surface elsewhere without losing
// brand legibility.
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
        {/* Grass mode forces the sidebar bg to a dark green
            (#1F3A1F) regardless of the light/dark theme — see
            sidebar.tsx. The default court-fg / court-fg-muted /
            court-accent-dark tokens are dark colors in grass-LIGHT
            mode, which made the wordmark and "by BreakPoint Talent"
            line bleed into the sidebar. The grass: variants below
            lift both to readable on-dark colors that match the
            NavLink palette already in use on that surface. */}
        <div className="font-serif text-[22px] font-bold tracking-tight text-court-fg grass:text-[#E8F4E2]">
          Ace
        </div>
        {withTag && (
          <div className="mt-0.5 font-serif text-[12px] italic text-court-fg-muted grass:text-[#C8D8C0]">
            by{" "}
            <span className="font-semibold text-court-accent-dark grass:text-[#A0C898]">
              BreakPoint Talent
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
