"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const LS_PREFIX = "ace-settings-collapsed:";
// Custom event that the Settings TOC fires when the user clicks a TOC
// link. Lets a collapsed section auto-expand even when the URL hash
// already pointed at it (which would otherwise produce no hashchange).
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
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  headerExtra?: ReactNode;
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

  // Auto-expand when the URL hash matches this section. Covers three
  // entry paths: (1) initial mount with a hash already in the URL,
  // (2) the browser firing hashchange when the recruiter clicks a TOC
  // anchor that updates the hash, (3) the TOC's custom event that
  // fires even when the hash didn't change (clicking the same link
  // twice). All three converge on a single setOpen(true) so a
  // collapsed section never blocks scroll-to.
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
        "scroll-mt-24 rounded-xl border border-court-border bg-court-surface shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 rounded-t-xl px-6 py-5 text-left transition hover:bg-court-surface-subtle/40"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span aria-hidden="true" className="mt-2 h-4 w-1 shrink-0 rounded-full bg-court-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-xl font-semibold leading-tight text-court-fg">
              {title}
            </h2>
            {description && (
              <p className="mt-1.5 text-[13px] leading-relaxed text-court-fg-muted">
                {description}
              </p>
            )}
          </div>
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
      {open && <div className="border-t border-court-border px-6 py-5">{children}</div>}
    </section>
  );
}
