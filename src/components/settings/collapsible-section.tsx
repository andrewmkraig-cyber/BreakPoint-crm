"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const LS_PREFIX = "ace-settings-collapsed:";
export const SETTINGS_EXPAND_EVENT = "settings:expand";

function persistKeyFor(title: ReactNode): string | null {
  if (typeof title === "string") return LS_PREFIX + title;
  if (typeof title === "number") return LS_PREFIX + String(title);
  return null;
}

export function CollapsibleSection({
  id,
  title,
  description,
  defaultOpen = true,
  children,
  className,
  headerExtra,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  variant: _variant = "default",
  eyebrow,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  headerExtra?: ReactNode;
  /**
   * Retained as a prop for backwards compatibility with existing call
   * sites. All variants now render the unified settings spec
   * (rounded-2xl, border-0, eyebrow + 18px serif title + 12px muted
   * description). The `_variant` rename signals it is intentionally
   * ignored.
   */
  variant?: "default" | "bd";
  /** Small uppercase label rendered above the title. Falls back to the title text when it is a string. */
  eyebrow?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const key = persistKeyFor(title);
    if (!key) return;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "open") setOpen(true);
      else if (stored === "closed") setOpen(false);
    } catch {}
  }, [title]);
  useEffect(() => {
    const key = persistKeyFor(title);
    if (!key) return;
    try {
      window.localStorage.setItem(key, open ? "open" : "closed");
    } catch {}
  }, [title, open]);

  useEffect(() => {
    if (!id) return;
    const expandIfMatch = (target: string) => {
      if (target === id) setOpen(true);
    };
    if (typeof window !== "undefined") {
      const initial = window.location.hash.replace(/^#/, "");
      if (initial) expandIfMatch(initial);
    }
    function onHashChange() {
      expandIfMatch(window.location.hash.replace(/^#/, ""));
    }
    function onSettingsExpand(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string") expandIfMatch(detail);
    }
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener(SETTINGS_EXPAND_EVENT, onSettingsExpand as EventListener);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener(
        SETTINGS_EXPAND_EVENT,
        onSettingsExpand as EventListener,
      );
    };
  }, [id]);

  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 mb-4 rounded-2xl border-0 bg-court-surface p-6 shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-mx-2 -mt-2 mb-1 flex w-[calc(100%+1rem)] items-start justify-between gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-court-surface-subtle/60"
      >
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="mb-1 text-[10px] font-semibold uppercase leading-none tracking-[0.18em] text-court-brand-dark">
              {eyebrow}
            </p>
          )}
          <h2 className="mb-1 font-serif text-[18px] font-bold leading-tight text-court-fg">
            {title}
          </h2>
          {description && (
            <p className="text-[12px] leading-relaxed text-court-fg-muted">
              {description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          {headerExtra}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-court-fg-muted transition-transform",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
        </div>
      </button>
      {open && <div className="mt-5">{children}</div>}
    </section>
  );
}
