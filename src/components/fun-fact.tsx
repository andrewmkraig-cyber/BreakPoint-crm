"use client";

import { useEffect, useRef, useState } from "react";
import { Lightbulb, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { fetchWithRetry } from "@/lib/retry-fetch";

// Fun fact chip in the briefing header. One Claude-generated fact per
// (org, ET day) — see /api/fun-fact for the generation + caching
// logic. The thumbs buttons POST to /api/fun-fact/feedback; the next
// day's generator weights topic selection by the user's recent votes
// so liked topics show up more often and disliked topics fade.

type Topic = "history" | "technology" | "science" | "geography" | "trivia";

type Fact = {
  id: string;
  topic: Topic;
  year: number | null;
  text: string;
};

type ApiResponse = {
  ok: boolean;
  id?: string;
  topic?: Topic;
  year?: number | null;
  text?: string;
  myVote?: 1 | -1 | null;
  error?: string;
};

type Status =
  | { phase: "loading" }
  | { phase: "ready"; fact: Fact }
  | { phase: "error"; message: string };

const TOPIC_LABEL: Record<Topic, string> = {
  history: "History",
  technology: "Technology",
  science: "Science",
  geography: "Geography",
  trivia: "Trivia",
};

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

export function FunFact() {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  const [vote, setVote] = useState<1 | -1 | null>(null);
  const [voting, setVoting] = useState(false);
  const [dateLabel, setDateLabel] = useState<string>("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDateLabel(todayLabel());
    void (async () => {
      try {
        const res = await fetchWithRetry("/api/fun-fact", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!json.ok || !json.id || !json.topic || !json.text) {
          setStatus({
            phase: "error",
            message: json.error ?? "No fact for today",
          });
          return;
        }
        setStatus({
          phase: "ready",
          fact: {
            id: json.id,
            topic: json.topic,
            year: json.year ?? null,
            text: json.text,
          },
        });
        setVote(json.myVote ?? null);
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

  async function submitVote(next: 1 | -1) {
    if (status.phase !== "ready" || voting) return;
    const factId = status.fact.id;
    const isToggleOff = vote === next;
    const prior = vote;
    setVote(isToggleOff ? null : next);
    setVoting(true);
    try {
      if (isToggleOff) {
        const res = await fetch(
          `/api/fun-fact/feedback?factId=${encodeURIComponent(factId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        const res = await fetch("/api/fun-fact/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ factId, vote: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      setVote(prior);
    } finally {
      setVoting(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-100 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 transition hover:bg-amber-100 hover:text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
      >
        <Lightbulb aria-hidden="true" className="h-3 w-3 shrink-0" />
        <span className="truncate">Daily Fact</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Fun fact of the day"
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
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
              Fun Fact
            </div>
            {status.phase === "ready" ? (
              <span className="rounded-full bg-court-accent-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-court-accent-dark">
                {TOPIC_LABEL[status.fact.topic]}
              </span>
            ) : null}
          </div>
          {status.phase === "ready" ? (
            <>
              {status.fact.year !== null ? (
                <div className="mt-1 font-stat text-xl font-bold leading-tight text-court-fg tabular-nums">
                  {status.fact.year}
                </div>
              ) : null}
              <p className="mt-2 text-sm leading-relaxed text-court-fg [text-wrap:pretty]">
                {status.fact.text}
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-court-border/60 pt-3">
                <div className="text-[10px] uppercase tracking-wider text-court-fg-muted">
                  {dateLabel}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => submitVote(1)}
                    disabled={voting}
                    aria-label="I like this fact"
                    aria-pressed={vote === 1}
                    className={
                      "inline-flex h-7 w-7 items-center justify-center rounded-md border transition disabled:opacity-50 " +
                      (vote === 1
                        ? "border-court-accent bg-court-accent-tint text-court-accent-dark"
                        : "border-court-border text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg")
                    }
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => submitVote(-1)}
                    disabled={voting}
                    aria-label="I don't like this fact"
                    aria-pressed={vote === -1}
                    className={
                      "inline-flex h-7 w-7 items-center justify-center rounded-md border transition disabled:opacity-50 " +
                      (vote === -1
                        ? "border-court-fg bg-court-fg text-white"
                        : "border-court-border text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg")
                    }
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </>
          ) : status.phase === "loading" ? (
            <p className="mt-2 text-sm text-court-fg-muted">
              Loading today&apos;s fun fact…
            </p>
          ) : (
            <p className="mt-2 text-sm text-court-fg-muted">
              Couldn&apos;t load:{" "}
              <span className="italic">{status.message}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
