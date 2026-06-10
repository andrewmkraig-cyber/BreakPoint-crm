"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { fetchWithRetry } from "@/lib/retry-fetch";

// Compact "Word of the Day" pill that lives at the bottom-right of the
// dashboard column. Renders a single-line chip ("Word of the Day:
// suborn →"); clicking expands a popover above the pill with the part
// of speech, definition, and example sentence. Outside-click closes
// the popover.
//
// The /api/word-of-day route caches one row per (org, ET day), so this
// component fetches once on mount and reuses the cached payload on
// subsequent loads — only the first call of the ET day costs a Claude
// roundtrip.

type WordPayload = {
  word: string;
  partOfSpeech: string;
  definition: string;
  exampleSentence: string;
};

type ApiResponse =
  | (WordPayload & { ok: true; cached?: boolean })
  | { ok: false; error: string };

export function WordOfDayCard() {
  const [data, setData] = useState<WordPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // popoverRef drives an on-open scrollIntoView so the popover never
  // clips above the viewport when the recruiter's already scrolled.
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithRetry("/api/word-of-day", {
          cache: "no-store",
        });
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError("ok" in json && !json.ok ? json.error : `HTTP ${res.status}`);
          return;
        }
        setData({
          word: json.word,
          partOfSpeech: json.partOfSpeech,
          definition: json.definition,
          exampleSentence: json.exampleSentence,
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Outside-click + Escape close the popover. mousedown (rather than
  // click) so a press-and-drag away still dismisses cleanly.
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

  // Nothing to show until the API resolves; we deliberately render
  // nothing rather than a skeleton because the pill lives in the
  // dashboard's empty corner and a flickering skeleton there is more
  // distracting than a brief blank.
  if (!data) {
    if (error) return null;
    return null;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        // Outlined button with the light brand-green border the other
        // dashboard boxes use (matches the KpiTile live `border-court-brand/35`),
        // muted text, transparent fill. Keeps the full-width half-column
        // footprint; height slimmed to the standard button line. Tokens stay
        // theme-aware across light + dark Court modes.
        className="flex w-full items-center justify-center gap-2 rounded-md border border-court-brand/35 bg-transparent px-3 py-1.5 text-sm font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
      >
        <span aria-hidden="true" className="text-[15px] leading-none">📖</span>
        <span className="truncate">Word of the Day</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Word of the Day"
          className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-xl border border-court-border bg-court-surface p-4 shadow-[0_8px_40px_rgba(0,0,0,0.35),0_2px_12px_rgba(0,0,0,0.25)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.55),0_2px_12px_rgba(0,0,0,0.35)]"
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
            Word of the Day
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="font-stat text-xl font-bold leading-tight text-court-fg">
              {data.word}
            </div>
            <div className="text-xs italic text-court-fg-muted">
              {data.partOfSpeech}
            </div>
          </div>
          <div className="mt-2 text-sm text-court-fg">{data.definition}</div>
          <div className="mt-2 text-xs italic leading-relaxed text-court-fg-muted">
            &ldquo;{data.exampleSentence}&rdquo;
          </div>
          <div className="mt-3 flex items-center gap-1 text-[10px] uppercase tracking-wider text-court-fg-muted">
            <Sparkles className="h-3 w-3" /> Generated by Ace
          </div>
        </div>
      )}
    </div>
  );
}
