"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { WordOfDayCard } from "@/components/word-of-day-card";
import { ChessPuzzle } from "@/components/chess-puzzle";
import { TabStrip } from "@/components/ui/tab-strip";

// Editorial briefing layout: header, four tabs, lead story + list,
// then a quiet 2x2 mini-grid of the daily companion items (Chess,
// Word, Fun Fact, Horoscope) at the bottom of the same card. Per-tab
// fetch wiring is unchanged — /api/news-feed?tab=... backs all four
// tabs. Collapse persists in localStorage so the recruiter's choice
// survives reload.
//
// The card uses flex-col h-full so the dashboard grid row that pairs
// it with ThisWeekWidget renders both with aligned bottom edges; the
// article list is the only flex-1 region, so a long briefing scrolls
// inside the card rather than pushing the card taller than its sibling.

const COLLAPSE_KEY = "ace.dashboard.news-feed.collapsed";

type TabKey = "general" | "accounting" | "recruiting" | "ai";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "general", label: "Front Page" },
  { key: "recruiting", label: "Recruiting" },
  { key: "accounting", label: "Public Accounting" },
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
  const [collapsed, setCollapsed] = useState(false);
  // formatToday() reads new Date(), which can resolve to slightly
  // different millisecond instants on the server vs. on hydration —
  // enough to cross a date boundary and trip React #418. Compute it
  // after mount so SSR and the first client render produce identical
  // markup (empty), then fill in.
  const [todayLabel, setTodayLabel] = useState<string>("");
  useEffect(() => {
    setTodayLabel(formatToday());
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);
  const [byTab, setByTab] = useState<Record<TabKey, TabState>>({
    general: { status: "idle" },
    accounting: { status: "idle" },
    recruiting: { status: "idle" },
    ai: { status: "idle" },
  });
  // byTab IS the per-tab cache. Once a tab transitions to `ready`, its
  // headlines stay in local state for the rest of the session and tab
  // switches render instantly from there — only the first click on a
  // tab spends a /api/news-feed round-trip. initiatedRef tracks which
  // tabs have already kicked off a fetch so the effect doesn't double-
  // fire on re-render.
  const initiatedRef = useRef<Set<TabKey>>(new Set<TabKey>());
  const [refreshing, setRefreshing] = useState(false);
  // Read state is local-only (no persistence). Keyed by
  // `${activeTab}::${headline}` so the same article in two tabs tracks
  // independently.
  const [readKeys, setReadKeys] = useState<Set<string>>(new Set());

  async function fetchTab(tab: TabKey): Promise<TabState> {
    try {
      const res = await fetch(
        `/api/news-feed?tab=${encodeURIComponent(tab)}`,
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
      if (!res.ok || !("ok" in json) || !json.ok) {
        const error =
          "ok" in json && !json.ok ? json.error : `HTTP ${res.status}`;
        return { status: "error", error };
      }
      return {
        status: "ready",
        headlines: json.headlines ?? [],
        generatedDate: json.generatedDate,
      };
    } catch (e) {
      return {
        status: "error",
        error: e instanceof Error ? e.message : "Failed to load",
      };
    }
  }

  useEffect(() => {
    if (collapsed) return;
    if (initiatedRef.current.has(active)) return;
    initiatedRef.current.add(active);
    const tabBeingFetched = active;
    setByTab((prev) => ({ ...prev, [tabBeingFetched]: { status: "loading" } }));
    // No cancellation: each fetch writes back to its OWN tab's slot in
    // byTab regardless of which tab is active when it returns. This way
    // the recruiter can click around while a slow tab loads in the
    // background, and the data lands as soon as it's ready. (The earlier
    // `cancelled` flag dropped late results, which left the tab pinned
    // on "loading" forever because initiatedRef still had it.)
    void (async () => {
      const next = await fetchTab(tabBeingFetched);
      setByTab((prev) => ({ ...prev, [tabBeingFetched]: next }));
      if (next.status === "error") initiatedRef.current.delete(tabBeingFetched);
    })();
  }, [active, collapsed]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/news-feed/cache", { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      // Server cache is empty for all 4 tabs. Wipe the client-side
      // per-tab cache too — every tab goes back to `idle`, initiatedRef
      // is cleared — so the next click on any non-active tab triggers a
      // fresh /api/news-feed call instead of rendering the stale ready
      // payload from before the refresh. Active tab is set to loading
      // and pulled immediately below so the recruiter doesn't need an
      // extra click to see the new headlines.
      initiatedRef.current.clear();
      initiatedRef.current.add(active);
      setByTab({
        general: { status: "idle" },
        accounting: { status: "idle" },
        recruiting: { status: "idle" },
        ai: { status: "idle" },
        [active]: { status: "loading" },
      });
      const next = await fetchTab(active);
      setByTab((prev) => ({ ...prev, [active]: next }));
      if (next.status === "error") {
        initiatedRef.current.delete(active);
        toast.error(`Refresh failed: ${next.error}`);
      } else {
        toast.success("News refreshed.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Refresh failed";
      toast.error(msg);
    } finally {
      setRefreshing(false);
    }
  }

  const current = byTab[active];
  const stories = current.status === "ready" ? current.headlines : [];
  const lead = stories[0];
  const list = stories.slice(1, 3);

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
    <section
      id="todays-briefing"
      className="flex h-full scroll-mt-24 flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            className="font-semibold tracking-[-0.035em] text-court-fg"
            style={{ fontSize: "18px", lineHeight: 1.15 }}
          >
            Today&apos;s Briefing
          </h2>
          <p
            className="mt-0.5 text-court-fg-muted"
            style={{ fontSize: "12px", minHeight: "14px" }}
            suppressHydrationWarning
          >
            {todayLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="today-briefing-body"
          aria-label={collapsed ? "Expand briefing" : "Minimize briefing"}
          className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </button>
      </div>

      {collapsed ? null : (
        <div id="today-briefing-body" className="flex min-h-0 flex-1 flex-col">
          {/* Shared TabStrip (controlled mode), so the briefing topics
              read as the same control language as /clients, /jobs, and
              /pipeline and inherit the proximity-hover effect for free.
              The refresh icon to its right wipes today's cached rows for
              all four tabs so the next read regenerates fresh headlines
              via Claude web_search. Per-tab fetch wiring is unchanged —
              onChange still drives setActive, which keys the fetch. */}
          <div className="mt-3 mb-3 flex items-center gap-2">
            <TabStrip<TabKey>
              ariaLabel="Briefing topics"
              activeId={active}
              onChange={setActive}
              items={TABS.map((t) => ({ id: t.key, label: t.label }))}
            />
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh news"
              title="Refresh news"
              className="rounded-md p-1.5 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-50"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Article list owns the only flex-1 region in the card, so
              when the dashboard's items-stretch row pins the briefing
              to its taller sibling, the overflow lands here and the
              list scrolls inside rather than pushing the card taller. */}
          <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pr-1">
            {current.status === "loading" || current.status === "idle" ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-court-fg-muted" />
              </div>
            ) : current.status === "error" ? (
              <div className="py-3 text-sm text-court-fg-muted">
                Couldn&apos;t load this briefing.{" "}
                <span className="italic">{current.error}</span>
              </div>
            ) : stories.length === 0 ? (
              <div className="py-3 text-sm text-court-fg-muted">
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
                    className="group mb-2 block cursor-pointer border-b border-court-border pb-3"
                  >
                    <h3
                      className={
                        "font-semibold tracking-[-0.02em] [text-wrap:pretty] group-hover:text-court-accent-dark " +
                        (isRead(lead) ? "text-court-fg-muted" : "text-court-fg")
                      }
                      style={{
                        fontSize: "16px",
                        lineHeight: 1.3,
                        maxWidth: "36ch",
                      }}
                    >
                      {lead.headline}
                    </h3>
                    {lead.summary ? (
                      <p
                        className={
                          "mt-1.5 leading-relaxed [text-wrap:pretty] " +
                          (isRead(lead) ? "text-court-fg-dim" : "text-court-fg-muted")
                        }
                        style={{ fontSize: "12px", maxWidth: "60ch" }}
                      >
                        {lead.summary}
                      </p>
                    ) : null}
                    <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-court-fg-muted">
                      {lead.source}
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
                          className="group block cursor-pointer py-2"
                        >
                          <h4
                            className={
                              "m-0 leading-snug group-hover:text-court-accent-dark " +
                              (isRead(story)
                                ? "font-medium text-court-fg-muted"
                                : "font-semibold text-court-fg")
                            }
                            style={{ fontSize: "13px" }}
                          >
                            {story.headline}
                          </h4>
                          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-court-fg-muted">
                            {story.source}
                          </div>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          {/* Daily companions: two side-by-side tiles (Chess + Word).
              Each is a full-width half-column bubble. Chess opens a
              centered fixed modal; Word opens an absolute popover above
              its tile (this wrapper doesn't clip, so it's visible). */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <ChessPuzzle />
            <WordOfDayCard />
          </div>
        </div>
      )}
    </section>
  );
}
