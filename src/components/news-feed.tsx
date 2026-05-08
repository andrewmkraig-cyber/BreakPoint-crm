"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

// Tabbed daily briefing for the dashboard. Five topic tabs; each tab
// fetches /api/news-feed?tab=... lazily on first activation. Headlines
// are cached server-side per (org, tab, ET day), so subsequent clicks
// within the same day return instantly without spending a Claude call.

type TabKey = "accounting" | "recruiting" | "ai" | "general" | "cleveland";

// Display order for the tab strip. Tab *keys* match the cached row's
// `tab` column and the API's per-tab search prompts — never rename
// them; only the label changes here. Keys: general → "Front Page",
// cleveland → "Local News".
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "general", label: "Front Page" },
  { key: "accounting", label: "Public Accounting" },
  { key: "recruiting", label: "Recruiting" },
  { key: "ai", label: "AI & Tech" },
  { key: "cleveland", label: "Local News" },
];

type Headline = {
  headline: string;
  source: string;
  url: string;
  summary: string;
};

type TabState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; headlines: Headline[]; generatedDate: string }
  | { status: "error"; error: string };

function formatToday(): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(new Date());
}

export function NewsFeed() {
  const [active, setActive] = useState<TabKey>("general");
  // Per-tab state map so switching tabs doesn't clobber an already-
  // loaded panel. First activation triggers a fetch; subsequent clicks
  // surface the cached state instantly.
  const [byTab, setByTab] = useState<Record<TabKey, TabState>>({
    accounting: { status: "idle" },
    recruiting: { status: "idle" },
    ai: { status: "idle" },
    general: { status: "idle" },
    cleveland: { status: "idle" },
  });

  useEffect(() => {
    const current = byTab[active];
    if (current.status !== "idle") return;
    setByTab((prev) => ({ ...prev, [active]: { status: "loading" } }));
    let cancelled = false;
    void (async () => {
      console.log("[news-feed] fetching tab:", active);
      try {
        const res = await fetch(
          `/api/news-feed?tab=${encodeURIComponent(active)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as
          | {
              ok: true;
              tab: TabKey;
              generatedDate: string;
              headlines: Headline[];
            }
          | { ok: false; error: string };
        if (cancelled) return;
        if (!res.ok || !("ok" in json) || !json.ok) {
          const error =
            "ok" in json && !json.ok ? json.error : `HTTP ${res.status}`;
          setByTab((prev) => ({
            ...prev,
            [active]: { status: "error", error },
          }));
          return;
        }
        setByTab((prev) => ({
          ...prev,
          [active]: {
            status: "ready",
            headlines: json.headlines ?? [],
            generatedDate: json.generatedDate,
          },
        }));
      } catch (e) {
        if (cancelled) return;
        setByTab((prev) => ({
          ...prev,
          [active]: {
            status: "error",
            error: e instanceof Error ? e.message : "Failed to load",
          },
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, byTab]);

  const current = byTab[active];

  return (
    <section className="rounded-2xl border border-court-border bg-court-surface shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-court-border px-5 py-3">
        <h2 className="font-serif text-lg font-semibold text-court-fg">
          Today&apos;s Briefing
        </h2>
        <span className="text-xs text-court-fg-muted">{formatToday()}</span>
      </div>

      <div
        role="tablist"
        aria-label="News feed topics"
        className="flex flex-wrap items-center gap-1 border-b border-court-border px-3 py-2"
      >
        {TABS.map((t) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={selected}
              type="button"
              onClick={() => setActive(t.key)}
              className={
                "rounded-md px-3 py-1.5 text-xs font-medium transition " +
                (selected
                  ? "bg-court-brand text-white shadow-sm"
                  : "text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="px-5 py-4">
        {current.status === "loading" || current.status === "idle" ? (
          <SkeletonList />
        ) : current.status === "error" ? (
          <div className="text-sm text-court-fg-muted">
            Couldn&apos;t load this briefing.{" "}
            <span className="italic">{current.error}</span>
          </div>
        ) : current.headlines.length === 0 ? (
          <div className="text-sm text-court-fg-muted">
            No headlines for this topic today.
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-court-border">
            {current.headlines.map((h, idx) => (
              <li key={`${idx}-${h.url}`} className="py-3 first:pt-0 last:pb-0">
                <a
                  href={h.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold leading-snug text-court-fg group-hover:text-court-brand-dark">
                      {h.headline}
                    </span>
                    <ExternalLink
                      aria-hidden="true"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-court-fg-muted opacity-0 transition group-hover:opacity-100"
                    />
                  </div>
                  <div className="mt-1 text-xs italic text-court-fg-muted">
                    {h.source}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-court-fg">
                    {h.summary}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm text-court-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading briefing…
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-4 w-3/4 animate-pulse rounded bg-court-surface-subtle" />
          <div className="h-3 w-24 animate-pulse rounded bg-court-surface-subtle" />
          <div className="h-3 w-full animate-pulse rounded bg-court-surface-subtle" />
        </div>
      ))}
    </div>
  );
}
