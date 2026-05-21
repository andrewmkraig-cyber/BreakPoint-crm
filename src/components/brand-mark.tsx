import { cn } from "@/lib/utils";

// Sidebar wordmark — Serve Arc mark + "Ace" lockup. The mark is an
// asset, not a UI surface, so the green arc + dot keep their fixed hex
// (#7BB85B) and read identically across every Court Mode. The dark disc
// now lives on the wrapper (a charcoal radial gradient + green ring +
// soft green glow + inner shadow) so the mark feels dimensional and pops
// off the dark sidebar. The glow green is the brand token
// (rgb(var(--court-brand))) — not a hardcoded hex — so it tracks each
// theme's brand green per rule 12; the dark gradient + black/white
// inner shadows are theme-neutral. The "Ace" text uses the
// court-sidebar-* family inside the sidebar (a [data-in-sidebar]
// ancestor) and the regular court-fg family otherwise.
export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        aria-hidden="true"
        className="ace-brand-disc relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--court-brand)/0.35)] bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.06),rgba(10,12,10,0.95)_45%,rgba(3,5,4,1)_100%)] shadow-[0_0_0_1px_rgb(var(--court-brand)/0.18),0_0_22px_rgb(var(--court-brand)/0.22),0_12px_28px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.05),inset_0_-10px_20px_rgba(0,0,0,0.25)]"
      >
        <svg
          width="34"
          height="34"
          viewBox="0 0 60 60"
          fill="none"
          className="shrink-0"
        >
          <path
            d="M 14 38 Q 30 18 46 30"
            stroke="#7BB85B"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="46" cy="30" r="4.5" fill="#7BB85B" />
        </svg>
      </span>
      <div className="leading-tight">
        <div
          className="font-serif text-[24px] font-black leading-none text-court-fg [[data-in-sidebar]_&]:text-court-sidebar-fg-muted"
          style={{ letterSpacing: "-0.03em" }}
        >
          Ace
        </div>
      </div>
    </div>
  );
}
