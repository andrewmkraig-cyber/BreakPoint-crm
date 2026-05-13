import type { ReactNode } from "react";

// Compact page-header for the four Clubhouse dashboard tabs
// (This Week, Scoreboard, Placements, Financial Performance).
// Sized to read as an executive-SaaS section opener — NOT a
// marketing landing hero — so the actual KPI cards sit close
// underneath. The top-bar app H1 ("Clubhouse") remains the
// dominant heading on the page.
//
// Court Mode tokens only; no hardcoded colors. The `trailing`
// slot hosts each tab's right-side affordance (date widget,
// period pill, period TabStrip).
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
    <div className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          {eyebrow}
        </p>
        <h2 className="mt-2 font-serif text-3xl font-semibold leading-tight text-court-fg sm:text-4xl">
          {title}
        </h2>
        {description ? (
          <p className="mt-2 max-w-[820px] text-base leading-[1.45] text-court-fg-muted">
            {description}
          </p>
        ) : null}
        {metadata ? <div className="mt-3">{metadata}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
