"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";

// Daily horoscope chip in the briefing header. Sign is derived from
// the signed-in user's UserProfile.birthday by /api/horoscope; the
// route falls back to Pisces when no birthday is set. We hit the
// same-origin /api/horoscope proxy because the upstream
// (horoscope-app-api → freehoroscopeapi) doesn't ship CORS headers,
// so a direct browser fetch is blocked silently. Chip renders eagerly
// with a loading state in the popover so it never disappears just
// because the network is slow.

type ApiResponse =
  | {
      ok: true;
      sign: string;
      displayName: string;
      glyph: string;
      date: string | null;
      horoscope: string;
    }
  | { ok: false; error: string };

type Status =
  | { phase: "loading" }
  | {
      phase: "ready";
      displayName: string;
      glyph: string;
      date: string | null;
      horoscope: string;
    }
  | { phase: "error"; message: string };

export function Horoscope() {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // popoverRef drives an on-open scrollIntoView so the popover never
  // clips above the viewport when the recruiter's already scrolled.
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/horoscope", { cache: "no-store" });
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          const msg =
            "ok" in json && !json.ok ? json.error : `HTTP ${res.status}`;
          setStatus({ phase: "error", message: msg });
          return;
        }
        setStatus({
          phase: "ready",
          displayName: json.displayName,
          glyph: json.glyph,
          date: json.date,
          horoscope: json.horoscope,
        });
      } catch (e) {
        if (cancelled) return;
        setStatus({
          phase: "error",
          message: e instanceof Error ? e.message : "Failed to load",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const rafId = window.requestAnimationFrame(() => {
      popoverRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
    function onDown(e: MouseEvent) {
      const node = containerRef.current;
      if (!node) return;
      if (!node.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-xs font-medium text-violet-800 transition hover:bg-violet-100 hover:text-violet-900 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-950/60"
      >
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Daily Horoscope</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Daily horoscope"
          className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-xl border border-court-border bg-court-surface p-3 shadow-xl"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-1.5 top-1.5 rounded-md p-0.5 text-court-fg-muted opacity-40 transition hover:bg-court-surface-subtle hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
            Daily Horoscope
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <div className="font-stat text-base font-bold leading-tight text-court-fg">
              {status.phase === "ready"
                ? `${status.glyph} ${status.displayName}`
                : "…"}
            </div>
            {status.phase === "ready" && status.date ? (
              <div className="text-[10px] italic text-court-fg-muted">
                {status.date}
              </div>
            ) : null}
          </div>
          {status.phase === "loading" ? (
            <p className="mt-1.5 text-xs text-court-fg-muted">
              Loading today&apos;s horoscope…
            </p>
          ) : status.phase === "error" ? (
            <p className="mt-1.5 text-xs text-court-fg-muted">
              Couldn&apos;t load:{" "}
              <span className="italic">{status.message}</span>
            </p>
          ) : (
            <p className="mt-1.5 text-xs leading-relaxed text-court-fg [text-wrap:pretty]">
              {status.horoscope}
            </p>
          )}
          <div className="mt-2 flex items-center gap-1 text-[9px] uppercase tracking-wider text-court-fg-muted">
            <Sparkles className="h-2.5 w-2.5" /> horoscope-app-api
          </div>
        </div>
      )}
    </div>
  );
}
