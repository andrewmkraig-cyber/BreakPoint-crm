"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";

// Daily horoscope chip in the briefing header. Hardcoded to Pisces —
// Andrew's birthday is March 11. We hit the same-origin /api/horoscope
// proxy because the upstream (horoscope-app-api → freehoroscopeapi)
// doesn't ship CORS headers, so a direct browser fetch is blocked
// silently. Chip renders eagerly with a loading state in the popover
// so it never disappears just because the network is slow.

type ApiResponse =
  | { ok: true; sign: string; date: string | null; horoscope: string }
  | { ok: false; error: string };

const SIGN_GLYPH = "♓";
const SIGN_DISPLAY = "Pisces";

type Status =
  | { phase: "loading" }
  | { phase: "ready"; date: string | null; horoscope: string }
  | { phase: "error"; message: string };

export function Horoscope() {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/horoscope?sign=pisces", {
          cache: "no-store",
        });
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          const msg =
            "ok" in json && !json.ok ? json.error : `HTTP ${res.status}`;
          setStatus({ phase: "error", message: msg });
          return;
        }
        setStatus({ phase: "ready", date: json.date, horoscope: json.horoscope });
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
        className="inline-flex items-center gap-1 rounded-full border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-medium text-court-fg-muted transition hover:border-court-accent/40 hover:text-court-fg"
      >
        {/* The unicode Pisces glyph rendered as a purple emoji on
            macOS, which clashed with the green dashboard. Sparkles
            in court-brand green keeps the chip on theme. */}
        <Sparkles
          aria-hidden="true"
          className="h-3.5 w-3.5 text-court-brand"
        />
        <span>Horoscope</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Daily horoscope"
          className="absolute bottom-full right-0 z-20 mb-2 w-80 rounded-xl border border-court-border bg-court-surface p-4 shadow-xl"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-2 top-2 rounded-md p-0.5 text-court-fg-muted opacity-40 transition hover:bg-court-surface-subtle hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
            Daily Horoscope
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="font-stat text-xl font-bold leading-tight text-court-fg">
              {SIGN_GLYPH} {SIGN_DISPLAY}
            </div>
            {status.phase === "ready" && status.date ? (
              <div className="text-[11px] italic text-court-fg-muted">
                {status.date}
              </div>
            ) : null}
          </div>
          {status.phase === "loading" ? (
            <p className="mt-2 text-sm text-court-fg-muted">
              Loading today&apos;s horoscope…
            </p>
          ) : status.phase === "error" ? (
            <p className="mt-2 text-sm text-court-fg-muted">
              Couldn&apos;t load:{" "}
              <span className="italic">{status.message}</span>
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-court-fg [text-wrap:pretty]">
              {status.horoscope}
            </p>
          )}
          <div className="mt-3 flex items-center gap-1 text-[10px] uppercase tracking-wider text-court-fg-muted">
            <Sparkles className="h-3 w-3" /> horoscope-app-api
          </div>
        </div>
      )}
    </div>
  );
}
