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
          <div className="text-xs font-semibold uppercase tracking-widest text-court-accent">
            {eyebrow}
          </div>
        )}
        <h1 className="mt-1 font-serif text-4xl font-bold text-court-fg">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-court-fg-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
