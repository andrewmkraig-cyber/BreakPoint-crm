"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail as MailIcon } from "lucide-react";
import type { MailListThread, MailThreadDetail, MailThreadMessage } from "@/lib/gmail";

// Two-pane Mail Tab layout. The server fetched the thread list; the
// client manages selection + loads each thread's detail on demand.
// Selection is kept in component state, not the URL — the Mail Tab
// behaves like a native mail client, not a deep-link surface.
export function MailView({ threads }: { threads: MailListThread[] }) {
  const [selected, setSelected] = useState<string | null>(threads[0]?.id ?? null);
  const [detail, setDetail] = useState<MailThreadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    fetch(`/api/mail/threads/${encodeURIComponent(selected)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | MailThreadDetail
          | { error: string }
          | null;
        if (cancelled) return;
        if (!res.ok) {
          const msg =
            body && "error" in body ? body.error : `Thread fetch failed (${res.status})`;
          setError(msg);
          return;
        }
        setDetail(body as MailThreadDetail);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Thread fetch failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
      <aside className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-4">
        <div className="border-b border-court-border bg-court-surface-subtle/60 px-4 py-2 text-[11px] uppercase tracking-wider text-court-fg-muted">
          {threads.length} {threads.length === 1 ? "thread" : "threads"}
        </div>
        {threads.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-court-fg-muted">
            Inbox is empty.
          </div>
        ) : (
          <ul className="max-h-[calc(100vh-240px)] divide-y divide-court-border overflow-y-auto">
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelected(t.id)}
                  className={
                    "flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition " +
                    (selected === t.id
                      ? "bg-court-accent-tint/60"
                      : "hover:bg-court-accent-tint/30")
                  }
                >
                  <div className="flex w-full items-baseline justify-between gap-3">
                    <span
                      className={
                        "truncate text-sm " +
                        (t.unread ? "font-semibold text-court-fg" : "text-court-fg")
                      }
                    >
                      {t.fromName || t.fromEmail || "(unknown sender)"}
                    </span>
                    <span className="shrink-0 text-[11px] text-court-fg-muted">
                      {formatRelative(t.timestampIso)}
                    </span>
                  </div>
                  <div
                    className={
                      "w-full truncate text-xs " +
                      (t.unread ? "font-medium text-court-fg" : "text-court-fg-muted")
                    }
                  >
                    {t.subject}
                  </div>
                  <div className="w-full truncate text-[11px] text-court-fg-muted">
                    {t.snippet}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-8">
        {!selected ? (
          <EmptyRightPane />
        ) : loading ? (
          <div className="flex h-[400px] items-center justify-center gap-2 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading thread…
          </div>
        ) : error ? (
          <div className="p-5 text-sm text-red-700">
            <p className="font-medium">Couldn&rsquo;t load this thread.</p>
            <p className="mt-1 text-xs">{error}</p>
          </div>
        ) : detail ? (
          <ThreadDetail detail={detail} />
        ) : (
          <EmptyRightPane />
        )}
      </section>
    </div>
  );
}

function EmptyRightPane() {
  return (
    <div className="flex h-[400px] flex-col items-center justify-center gap-2 text-sm text-court-fg-muted">
      <MailIcon className="h-6 w-6" />
      Select a thread on the left to read it.
    </div>
  );
}

function ThreadDetail({ detail }: { detail: MailThreadDetail }) {
  return (
    <div className="flex h-[calc(100vh-240px)] flex-col">
      <div className="border-b border-court-border px-5 py-3">
        <h2 className="font-serif text-base font-semibold text-court-fg">{detail.subject}</h2>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          {detail.messages.length}{" "}
          {detail.messages.length === 1 ? "message" : "messages"}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {detail.messages.map((m, i) => (
          <MessageBlock key={m.id} msg={m} isFirst={i === 0} />
        ))}
      </div>
    </div>
  );
}

function MessageBlock({ msg, isFirst }: { msg: MailThreadMessage; isFirst: boolean }) {
  return (
    <article
      className={
        "px-5 py-4 " + (isFirst ? "" : "border-t border-court-border")
      }
    >
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-court-fg">
            {msg.fromName || msg.fromEmail || "(unknown sender)"}
          </div>
          {msg.to && (
            <div className="text-[11px] text-court-fg-muted">
              to {msg.to}
              {msg.cc ? ` · cc ${msg.cc}` : ""}
            </div>
          )}
        </div>
        <div className="text-[11px] text-court-fg-muted">
          {msg.dateIso ? new Date(msg.dateIso).toLocaleString() : ""}
        </div>
      </header>
      <div
        className="prose prose-sm max-w-none text-court-fg prose-a:text-brand-dark"
        dangerouslySetInnerHTML={{ __html: msg.bodyHtml }}
      />
    </article>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return date.toLocaleDateString();
}
