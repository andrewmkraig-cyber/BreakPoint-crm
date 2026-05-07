import type { ReactNode } from "react";

// Compact page header used across every primary surface (Jobs,
// Clients, Candidates, Applicants, Phone, Pipeline, Dashboard,
// Settings). Matches the inline header on /mail so the whole app
// reads with one consistent header rhythm:
//   - small negative top margin so the title sits close to the TopBar
//   - serif xl heading (was 4xl) — Mail-sized
//   - xs description (was sm)
//   - tight bottom margin (was mb-6)
//
// `eyebrow` is still accepted for surfaces where the section context
// is genuinely useful (Admin / Client). Pages that previously rendered
// redundant eyebrows ("Requisitions" → "Jobs", "Pool" → "Candidates",
// etc.) have been updated to omit it.
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="-mt-2 mb-3 flex flex-col gap-1 md:-mt-4 md:flex-row md:items-center md:justify-between md:gap-3">
      <div>
        {eyebrow && (
          <div className="text-[10px] font-semibold uppercase tracking-widest text-court-accent">
            {eyebrow}
          </div>
        )}
        <h1 className="font-serif text-xl font-semibold text-court-fg">{title}</h1>
        {description && (
          <p className="text-xs text-court-fg-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
