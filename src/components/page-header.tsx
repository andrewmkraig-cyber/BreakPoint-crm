import type { ReactNode } from "react";

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
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && (
          <div className="text-[11px] uppercase tracking-[0.2em] text-brand-dark">{eyebrow}</div>
        )}
        {/* Hard keeps text-ink (#111111 — the existing color, no regression).
            Clay + Grass lift to the mode-aware court-fg token so the title
            reads at high contrast against the dark body. Using explicit
            dark:/grass: modifiers rather than swapping to text-court-fg
            alone because the spec called out the belt-and-suspenders form
            and because it keeps the Hard color guaranteed-literal even if
            the court-fg token's Hard value ever drifts. */}
        <h1 className="mt-1 font-serif text-3xl font-semibold text-court-fg">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-court-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
