"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// Tabbed daily briefing for the dashboard. Four topic tabs; each tab
// fetches /api/news-feed?tab=... lazily on first activation. Headlines
// are cached server-side per (org, tab, ET day), so subsequent clicks
// within the same day return instantly without spending a NewsAPI call.

type TabKey = "accounting" | "recruiting" | "ai" | "general";

// Per-tab accent color used for both the active pill background and
// the 4px left border on each story. Hardcoded by spec — these are the
// only hex values allowed in this component; everything else routes
// through Court Mode tokens.
const TAB_ACCENT: Record<TabKey, string> = {
  general: "#6B7280",
  accounting: "#5A9642",
  recruiting: "#3B82F6",
  ai: "#8B5CF6",
};

// Display order for the tab strip. Tab *keys* match the cached row's
// `tab` column and the API's per-tab endpoints — never rename them;
// only the label changes here.
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "general", label: "Front Page" },
  { key: "accounting", label: "Public Accounting" },
  { key: "recruiting", label: "Recruiting" },
  { key: "ai", label: "AI & Tech" },
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
  });
  // Tracks which tabs already kicked off a fetch. Lives outside React
  // state so the effect below depends only on `active`. Subscribing to
  // `byTab` would cancel the in-flight fetch the moment we set it to
  // "loading" — the dependency change triggers cleanup (cancelled =
  // true) before the response lands, which is why headlines used to
  // never render. On error we drop the entry so navigating away and
  // back retries.
  const initiatedRef = useRef<Set<TabKey>>(new Set());

  useEffect(() => {
    if (initiatedRef.current.has(active)) return;
    initiatedRef.current.add(active);
    setByTab((prev) => ({ ...prev, [active]: { status: "loading" } }));
    let cancelled = false;
    void (async () => {
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
          initiatedRef.current.delete(active);
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
        initiatedRef.current.delete(active);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  const current = byTab[active];
  const accent = TAB_ACCENT[active];

  return (
    <section className="rounded-2xl border border-court-border bg-court-surface shadow-sm">
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <h2
          className="font-semibold text-court-fg-muted"
          style={{
            fontSize: "11px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Today&apos;s Briefing
        </h2>
        <span
          className="text-court-fg-muted"
          style={{ fontSize: "12px" }}
        >
          {formatToday()}
        </span>
      </div>

      <div
        role="tablist"
        aria-label="News feed topics"
        className="flex flex-wrap items-center gap-1.5 px-5 pb-3"
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
                "rounded-full font-medium transition " +
                (selected
                  ? "text-white"
                  : "bg-court-surface-subtle text-court-fg-muted hover:text-court-fg")
              }
              style={{
                padding: "5px 14px",
                fontSize: "13px",
                backgroundColor: selected ? TAB_ACCENT[t.key] : undefined,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="px-5 pb-4">
        {current.status === "loading" || current.status === "idle" ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-court-fg-muted" />
          </div>
        ) : current.status === "error" ? (
          <div className="py-4 text-sm text-court-fg-muted">
            Couldn&apos;t load this briefing.{" "}
            <span className="italic">{current.error}</span>
          </div>
        ) : current.headlines.length === 0 ? (
          <div className="py-4 text-sm text-court-fg-muted">
            No headlines for this topic today.
          </div>
        ) : (
          <ul className="flex flex-col">
            {current.headlines.map((h, idx) => (
              <li
                key={`${idx}-${h.url}`}
                className="border-b border-court-border-soft last:border-b-0"
              >
                <a
                  href={h.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block py-3 pl-3 pr-2 transition-colors hover:bg-court-surface-subtle"
                  style={{ borderLeft: `4px solid ${accent}` }}
                >
                  <div
                    className="text-court-fg-muted"
                    style={{
                      fontSize: "10px",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      fontWeight: 500,
                    }}
                  >
                    {h.source}
                  </div>
                  <div
                    className="mt-1 text-court-fg group-hover:text-court-brand-dark"
                    style={{
                      fontSize: "15px",
                      fontWeight: 500,
                      lineHeight: 1.4,
                    }}
                  >
                    {h.headline}
                  </div>
                  {h.summary ? (
                    <p
                      className="mt-1 text-court-fg-muted"
                      style={{ fontSize: "13px", lineHeight: 1.5 }}
                    >
                      {h.summary}
                    </p>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
