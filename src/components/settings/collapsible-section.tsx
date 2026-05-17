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
  variant = "default",
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
   * "default" — the original chrome (rounded-xl card, accent rail,
   * serif title, used by every non-BD settings page).
   * "bd" — opt-in BD-Settings spec: rounded-2xl, no border, shadow-sm
   * shell with an uppercase brand-dark eyebrow above an 18px Playfair
   * title. Other settings pages keep the default look.
   */
  variant?: "default" | "bd";
  /** Small uppercase label rendered above the title in the bd variant. */
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

  const isBd = variant === "bd";

  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 bg-court-surface shadow-sm",
        isBd ? "rounded-2xl" : "rounded-xl border border-court-border",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-start justify-between gap-3 text-left transition hover:bg-court-surface-subtle/40",
          isBd ? "rounded-t-2xl px-6 pt-6 pb-4" : "rounded-t-xl px-6 py-5",
        )}
      >
        <div className={cn("flex min-w-0 flex-1 items-start gap-3", isBd && "gap-0")}>
          {!isBd && (
            <span aria-hidden="true" className="mt-2 h-4 w-1 shrink-0 rounded-full bg-court-accent" />
          )}
          <div className="min-w-0 flex-1">
            {isBd && eyebrow && (
              <p className="mb-1 text-[10px] font-semibold uppercase leading-none tracking-[0.18em] text-court-brand-dark">
                {eyebrow}
              </p>
            )}
            <h2
              className={cn(
                "font-serif leading-tight text-court-fg",
                isBd ? "mb-1 text-[18px] font-bold" : "text-xl font-semibold",
              )}
            >
              {title}
            </h2>
            {description && (
              <p
                className={cn(
                  "leading-relaxed text-court-fg-muted",
                  isBd ? "text-[12px]" : "mt-1.5 text-[13px]",
                )}
              >
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
      {open && (
        <div
          className={cn(
            isBd ? "px-6 pb-6" : "border-t border-court-border px-6 py-5",
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}
