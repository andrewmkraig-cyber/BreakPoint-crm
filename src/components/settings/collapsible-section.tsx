"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Settings card wrapper that adds a collapse/expand chevron in the
// header. State is local — preference is reset on a hard reload, on
// purpose. (Persisting expand/collapse per-section across reloads
// would be more clutter than benefit; the recruiter scrolls between
// sections rarely enough that the default-open state is the right
// place to land.)

export function CollapsibleSection({
  title,
  description,
  defaultOpen = true,
  children,
  className,
  headerExtra,
}: {
  title: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  // Slot for inline content on the right side of the header (e.g.
  // counters, action chips). Sits next to the chevron.
  headerExtra?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={cn(
        "rounded-xl border border-court-border bg-court-surface shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 rounded-t-xl px-5 py-4 text-left transition hover:bg-court-surface-subtle/40"
      >
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-lg font-semibold text-court-fg">{title}</h2>
          {description && (
            <p className="mt-1 text-xs text-court-fg-muted">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {headerExtra}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-court-fg-muted transition-transform",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
        </div>
      </button>
      {open && <div className="border-t border-court-border px-5 py-4">{children}</div>}
    </section>
  );
}
