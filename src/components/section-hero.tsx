import type { ReactNode } from "react";

// Unified hero header for the four Clubhouse dashboard tabs
// (This Week, Scoreboard, Placements, Financial Performance).
// The hero title is intentionally lighter and tighter than the
// top-bar app H1 so it visually sits BELOW that heading in the
// hierarchy — i.e. tabs read as section openers, not page titles.
//
// Court Mode tokens only; no hardcoded colors. The `trailing` slot
// hosts each tab's right-side affordance (date widget, period
// pill, period TabStrip) without baking those concerns into this
// component.
export function SectionHero({
  eyebrow,
  title,
  description,
  metadata,
  trailing,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  metadata?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      <div className="min-w-0">
        <p
          className="text-[11px] font-semibold uppercase text-court-brand"
          style={{ letterSpacing: "0.22em" }}
        >
          {eyebrow}
        </p>
        <h2
          className="mt-3 font-serif font-bold text-court-fg"
          style={{
            fontSize: "clamp(44px, 4vw, 60px)",
            letterSpacing: "-0.035em",
            lineHeight: 1.04,
          }}
        >
          {title}
        </h2>
        {description ? (
          <p
            className="mt-3 max-w-[900px] text-base text-court-fg-muted"
            style={{ lineHeight: 1.45 }}
          >
            {description}
          </p>
        ) : null}
        {metadata ? <div className="mt-3">{metadata}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
