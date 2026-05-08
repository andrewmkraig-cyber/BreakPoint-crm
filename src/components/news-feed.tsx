"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// Editorial briefing layout: header, four tabs, one lead story, three
// list rows. Per-tab fetch wiring is unchanged — /api/news-feed?tab=...
// backs all four tabs.

type TabKey = "general" | "accounting" | "recruiting" | "ai";

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
  const [byTab, setByTab] = useState<Record<TabKey, TabState>>({
    general: { status: "idle" },
    accounting: { status: "idle" },
    recruiting: { status: "idle" },
    ai: { status: "idle" },
  });
  // initiatedRef lives outside React state so the fetch effect depends
  // only on `active`.
  const initiatedRef = useRef<Set<TabKey>>(new Set<TabKey>());
  // Read state is local-only (no persistence). Keyed by
  // `${activeTab}::${headline}` so the same article in two tabs tracks
  // independently.
  const [readKeys, setReadKeys] = useState<Set<string>>(new Set());

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
  const stories = current.status === "ready" ? current.headlines : [];
  const lead = stories[0];
  const list = stories.slice(1, 4);

  const readKey = (story: Headline) => `${active}::${story.headline}`;
  const isRead = (story: Headline) => readKeys.has(readKey(story));
  const markRead = (story: Headline) => {
    setReadKeys((prev) => {
      const next = new Set(prev);
      next.add(readKey(story));
      return next;
    });
  };

  return (
    <section className="rounded-[32px] bg-court-surface p-10 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_16px_40px_rgba(16,36,24,0.04)]">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2
            className="font-semibold tracking-[-0.04em] text-court-fg"
            style={{ fontSize: "28px", lineHeight: 1.1 }}
          >
            Today&apos;s Briefing
          </h2>
          <p
            className="mt-1 text-court-fg-muted"
            style={{ fontSize: "14px" }}
          >
            Curated daily, 6:00 AM ET
          </p>
        </div>
        <span
          className="text-court-fg-muted"
          style={{ fontSize: "12px" }}
        >
          {formatToday()}
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Briefing topics"
        className="mt-6 mb-6 flex gap-1 border-b border-court-border"
      >
        {TABS.map((t) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(t.key)}
              className={
                "relative top-px border-b-2 px-3.5 pt-2.5 pb-3 text-sm font-semibold transition-colors " +
                (selected
                  ? "border-court-accent text-court-fg"
                  : "border-transparent text-court-fg-muted hover:text-court-fg")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {current.status === "loading" || current.status === "idle" ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-court-fg-muted" />
          </div>
        ) : current.status === "error" ? (
          <div className="py-4 text-sm text-court-fg-muted">
            Couldn&apos;t load this briefing.{" "}
            <span className="italic">{current.error}</span>
          </div>
        ) : stories.length === 0 ? (
          <div className="py-4 text-sm text-court-fg-muted">
            No headlines for this section today.
          </div>
        ) : (
          <>
            {lead ? (
              <a
                href={lead.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => markRead(lead)}
                className="group mb-2 block cursor-pointer border-b border-court-border pb-5"
              >
                <h3
                  className={
                    "font-semibold tracking-[-0.02em] [text-wrap:pretty] group-hover:text-court-accent-dark " +
                    (isRead(lead) ? "text-court-fg-muted" : "text-court-fg")
                  }
                  style={{
                    fontSize: "22px",
                    lineHeight: 1.2,
                    maxWidth: "36ch",
                  }}
                >
                  {lead.headline}
                </h3>
                {lead.summary ? (
                  <p
                    className={
                      "mt-2.5 leading-relaxed [text-wrap:pretty] " +
                      (isRead(lead) ? "text-court-fg-dim" : "text-court-fg-muted")
                    }
                    style={{ fontSize: "14px", maxWidth: "60ch" }}
                  >
                    {lead.summary}
                  </p>
                ) : null}
                <div className="mt-3 flex items-center gap-2 text-xs text-court-fg-muted">
                  <span>{lead.source}</span>
                  <span aria-hidden>·</span>
                  <span>Today</span>
                </div>
              </a>
            ) : null}

            {list.length > 0 ? (
              <ul>
                {list.map((story, idx) => (
                  <li
                    key={`${idx}-${story.url}`}
                    className="border-b border-court-border last:border-b-0"
                  >
                    <a
                      href={story.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => markRead(story)}
                      className="group block cursor-pointer py-3"
                    >
                      <h4
                        className={
                          "m-0 text-sm leading-snug group-hover:text-court-accent-dark " +
                          (isRead(story)
                            ? "font-medium text-court-fg-muted"
                            : "font-semibold text-court-fg")
                        }
                      >
                        {story.headline}
                      </h4>
                      <div className="mt-1 flex items-center gap-2 text-xs text-court-fg-muted">
                        <span>{story.source}</span>
                        <span aria-hidden>·</span>
                        <span>Today</span>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
