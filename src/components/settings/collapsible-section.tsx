"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Settings card wrapper that adds a collapse/expand chevron in the
// header. Persists open/closed state per-card in localStorage so a
// recruiter who minimizes Notification Preferences (or any other
// section) and navigates away comes back to the same minimized state.
// Falls back to defaultOpen when there's no stored value.

const LS_PREFIX = "ace-settings-collapsed:";

function persistKeyFor(title: ReactNode): string | null {
  // Stable string keys only — falling back to JSON.stringify for
  // ReactNode titles risks an unstable hash (e.g. function children),
  // so non-string titles opt out of persistence and the section
  // behaves the way it always did.
  if (typeof title === "string") return LS_PREFIX + title;
  if (typeof title === "number") return LS_PREFIX + String(title);
  return null;
}

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
  // Hydrate from localStorage on mount. Initial render uses defaultOpen
  // so SSR + the very first client paint match — flip to the stored
  // value in an effect to avoid hydration mismatch.
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const key = persistKeyFor(title);
    if (!key) return;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "open") setOpen(true);
      else if (stored === "closed") setOpen(false);
    } catch {
      // localStorage can throw in strict-privacy modes — fall through
      // to the defaultOpen state.
    }
  }, [title]);

  // Persist every flip. Skipped when the title isn't a string-able
  // value (no stable key).
  useEffect(() => {
    const key = persistKeyFor(title);
    if (!key) return;
    try {
      window.localStorage.setItem(key, open ? "open" : "closed");
    } catch {
      // Same swallow as above.
    }
  }, [title, open]);
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
