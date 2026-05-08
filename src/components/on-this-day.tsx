"use client";

import { useEffect, useRef, useState } from "react";

// On-this-day chip in the briefing header. Pulls from Wikipedia's
// public REST endpoint — no auth, no caching layer needed since
// Wikipedia returns the same set of historic events for a given
// MM/DD every year. We pick a single notable event (preferring older
// over newer so the fact lands as something Andrew is unlikely to
// have lived through) and surface it in the popover.

type WikiEvent = {
  year?: number;
  text?: string;
  pages?: Array<{ titles?: { normalized?: string }; thumbnail?: unknown }>;
};

type WikiResponse = {
  events?: WikiEvent[];
};

type Pick = {
  year: number;
  text: string;
  dateLabel: string;
};

function todayMMDD(): { mm: string; dd: string; label: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
  });
  const label = fmt.format(new Date());
  const mmFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
  });
  const [mm, dd] = mmFmt.format(new Date()).split("-");
  return { mm, dd, label };
}

// Prefer older events with a substantive blurb. Wikipedia returns
// recency-sorted events; flipping that and filtering super-short
// entries keeps the result feeling like a "fun fact" instead of a
// terror-attack ticker.
function pickEvent(events: WikiEvent[]): Pick | null {
  const candidates = events
    .filter((e) => typeof e.year === "number" && (e.text ?? "").length > 30)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  if (candidates.length === 0) return null;
  // Bias toward something pre-1950 if any exist, else fall back to the
  // oldest available.
  const old = candidates.filter((e) => (e.year ?? 0) < 1950);
  const pool = old.length > 0 ? old : candidates;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return {
    year: pick.year ?? 0,
    text: pick.text ?? "",
    dateLabel: "",
  };
}

export function OnThisDay() {
  const [data, setData] = useState<Pick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dateLabelRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { mm, dd, label } = todayMMDD();
        dateLabelRef.current = label;
        const res = await fetch(
          `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as WikiResponse;
        if (cancelled) return;
        const pick = pickEvent(json.events ?? []);
        if (!pick) {
          setError("No events");
          return;
        }
        setData({ ...pick, dateLabel: label });
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

  if (!data) {
    if (error) return null;
    return null;
  }

  const yearsAgo = new Date().getFullYear() - data.year;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1 rounded-full border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-medium text-court-fg-muted transition hover:border-court-accent/40 hover:text-court-fg"
      >
        <span aria-hidden="true">📜</span>
        <span>On This Day</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="On this day in history"
          className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-xl border border-court-border bg-court-surface p-4 shadow-xl"
        >
          <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
            On This Day
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="font-stat text-xl font-bold leading-tight text-court-fg tabular-nums">
              {data.year}
            </div>
            <div className="text-[11px] italic text-court-fg-muted">
              {yearsAgo} year{yearsAgo === 1 ? "" : "s"} ago today
            </div>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-court-fg [text-wrap:pretty]">
            {data.text}
          </p>
          <div className="mt-3 text-[10px] uppercase tracking-wider text-court-fg-muted">
            {data.dateLabel} in history
          </div>
        </div>
      )}
    </div>
  );
}
