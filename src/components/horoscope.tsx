"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

// Daily horoscope chip in the briefing header. Hardcoded to Pisces —
// Andrew's birthday is March 11. The horoscope-app-api endpoint is
// public, returns a fresh blurb daily, and follows a 308 redirect on
// the first request which fetch() handles transparently.

type ApiResponse = {
  data?: {
    date?: string;
    period?: string;
    sign?: string;
    horoscope?: string;
  };
};

const SIGN = "pisces";
const SIGN_GLYPH = "♓";
const SIGN_DISPLAY = "Pisces";

export function Horoscope() {
  const [text, setText] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${SIGN}&day=TODAY`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        const blurb = json.data?.horoscope?.trim();
        if (!blurb) throw new Error("Empty horoscope");
        setText(blurb);
        setDate(json.data?.date ?? null);
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

  if (!text) {
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
        className="inline-flex items-center gap-1 rounded-full border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-medium text-court-fg-muted transition hover:border-court-accent/40 hover:text-court-fg"
      >
        <span aria-hidden="true">{SIGN_GLYPH}</span>
        <span>Horoscope</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Daily horoscope"
          className="absolute bottom-full right-0 z-20 mb-2 w-80 rounded-xl border border-court-border bg-court-surface p-4 shadow-xl"
        >
          <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
            Daily Horoscope
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="font-stat text-xl font-bold leading-tight text-court-fg">
              {SIGN_GLYPH} {SIGN_DISPLAY}
            </div>
            {date ? (
              <div className="text-[11px] italic text-court-fg-muted">
                {date}
              </div>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-court-fg [text-wrap:pretty]">
            {text}
          </p>
          <div className="mt-3 flex items-center gap-1 text-[10px] uppercase tracking-wider text-court-fg-muted">
            <Sparkles className="h-3 w-3" /> horoscope-app-api
          </div>
        </div>
      )}
    </div>
  );
}
