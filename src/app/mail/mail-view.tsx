"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Loader2, Mail as MailIcon, Reply } from "lucide-react";
import { toast } from "sonner";
import type { MailListThread, MailThreadDetail, MailThreadMessage } from "@/lib/gmail";
import { MailComposer } from "@/app/mail/mail-composer";

// Two-pane Mail Tab layout. The server fetched the thread list; the
// client manages selection + loads each thread's detail on demand.
// Selection is kept in component state, not the URL — the Mail Tab
// behaves like a native mail client, not a deep-link surface.
export function MailView({
  threads: initialThreads,
  currentUserEmail,
}: {
  threads: MailListThread[];
  currentUserEmail: string;
}) {
  const [threads, setThreads] = useState<MailListThread[]>(initialThreads);
  useEffect(() => setThreads(initialThreads), [initialThreads]);
  const [selected, setSelected] = useState<string | null>(initialThreads[0]?.id ?? null);
  const [detail, setDetail] = useState<MailThreadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);

  const loadThread = useCallback(async (id: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/mail/threads/${encodeURIComponent(id)}`, { signal });
      const body = (await res.json().catch(() => null)) as
        | MailThreadDetail
        | { error: string }
        | null;
      if (!res.ok) {
        const msg = body && "error" in body ? body.error : `Thread fetch failed (${res.status})`;
        setError(msg);
        return;
      }
      setDetail(body as MailThreadDetail);
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Thread fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setComposerOpen(false);
      return;
    }
    const ac = new AbortController();
    void loadThread(selected, ac.signal);
    setComposerOpen(false);
    return () => ac.abort();
  }, [selected, loadThread]);

  async function archiveThread(id: string) {
    setArchiving(id);
    try {
      const res = await fetch(`/api/mail/threads/${encodeURIComponent(id)}/archive`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Couldn't archive", { description: body?.error ?? `HTTP ${res.status}` });
        return;
      }
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (selected === id) {
        setSelected(null);
        setDetail(null);
      }
      toast.success("Archived");
    } catch (e) {
      toast.error("Couldn't archive", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    } finally {
      setArchiving(null);
    }
  }

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selected) ?? null,
    [threads, selected],
  );

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
                <ThreadRow
                  thread={t}
                  selected={selected === t.id}
                  archiving={archiving === t.id}
                  onOpen={() => setSelected(t.id)}
                  onArchive={() => archiveThread(t.id)}
                />
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
          <ThreadDetail
            detail={detail}
            selectedThread={selectedThread}
            composerOpen={composerOpen}
            archiving={archiving === detail.id}
            currentUserEmail={currentUserEmail}
            onArchive={() => archiveThread(detail.id)}
            onReply={() => setComposerOpen(true)}
            onComposerClose={() => setComposerOpen(false)}
            onComposerSent={() => {
              setComposerOpen(false);
              if (selected) void loadThread(selected);
            }}
          />
        ) : (
          <EmptyRightPane />
        )}
      </section>
    </div>
  );
}

function ThreadRow({
  thread: t,
  selected,
  archiving,
  onOpen,
  onArchive,
}: {
  thread: MailListThread;
  selected: boolean;
  archiving: boolean;
  onOpen: () => void;
  onArchive: () => void;
}) {
  return (
    <div
      className={
        "group relative flex items-stretch transition " +
        (selected ? "bg-court-accent-tint/60" : "hover:bg-court-accent-tint/30")
      }
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-4 py-3 pr-10 text-left"
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
        <div className="w-full truncate text-[11px] text-court-fg-muted">{t.snippet}</div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onArchive();
        }}
        disabled={archiving}
        aria-label={`Archive thread: ${t.subject}`}
        className="absolute right-2 top-2 rounded-md p-1 text-court-fg-muted opacity-0 transition hover:bg-court-fg/5 hover:text-court-fg group-hover:opacity-100 disabled:opacity-50"
      >
        {archiving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
      </button>
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

function ThreadDetail({
  detail,
  selectedThread,
  composerOpen,
  archiving,
  currentUserEmail,
  onArchive,
  onReply,
  onComposerClose,
  onComposerSent,
}: {
  detail: MailThreadDetail;
  selectedThread: MailListThread | null;
  composerOpen: boolean;
  archiving: boolean;
  currentUserEmail: string;
  onArchive: () => void;
  onReply: () => void;
  onComposerClose: () => void;
  onComposerSent: () => void;
}) {
  // Newest-first: show most recent message at the top of the pane so
  // opening a long thread lands directly on "what just happened."
  const orderedMessages = useMemo(() => [...detail.messages].reverse(), [detail.messages]);
  const latest = orderedMessages[0];

  // Reply-recipient logic: the "other party" on the latest message.
  // - If I sent the last message, reply to whoever I sent it to.
  // - If someone else sent it, reply to them.
  // Never pre-fill To with my own address.
  const { defaultTo, defaultCc } = computeReplyRecipients(
    latest,
    selectedThread,
    currentUserEmail,
  );
  const defaultSubject = detail.subject.toLowerCase().startsWith("re:")
    ? detail.subject
    : `Re: ${detail.subject}`;

  return (
    <div className="flex h-[calc(100vh-240px)] flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-court-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-serif text-base font-semibold text-court-fg">
            {detail.subject}
          </h2>
          <p className="mt-0.5 text-xs text-court-fg-muted">
            {detail.messages.length}{" "}
            {detail.messages.length === 1 ? "message" : "messages"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onReply}
            disabled={composerOpen}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
          >
            <Reply className="h-3 w-3" /> Reply
          </button>
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
          >
            {archiving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
            Archive
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {orderedMessages.map((m, i) => (
          <MessageBlock key={m.id} msg={m} isFirst={i === 0} />
        ))}
      </div>
      {composerOpen && (
        <MailComposer
          threadId={detail.id}
          defaultTo={defaultTo}
          defaultCc={defaultCc}
          defaultSubject={defaultSubject}
          onClose={onComposerClose}
          onSent={onComposerSent}
        />
      )}
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

// Works out who the reply should go to.
// - If the most recent message was sent BY the current user, the "other
//   party" is whoever was on the To / Cc of that outbound message.
// - If the most recent message was sent TO the current user, the "other
//   party" is the sender (From header).
// In both cases the current user's own address is stripped out of To
// and Cc so replies never accidentally copy self.
function computeReplyRecipients(
  latest: MailThreadMessage | undefined,
  selectedThread: MailListThread | null,
  me: string,
): { defaultTo: string; defaultCc: string } {
  const myLower = me.trim().toLowerCase();
  const toAddresses = splitAddrHeader(latest?.to ?? "");
  const ccAddresses = splitAddrHeader(latest?.cc ?? "");
  const fromEmail = (latest?.fromEmail ?? "").trim();
  const fromIsMe = Boolean(fromEmail) && fromEmail.toLowerCase() === myLower;

  if (fromIsMe) {
    // I was the last sender; reply to the recipients of that send.
    const toMinusMe = toAddresses.filter((a) => a.email.toLowerCase() !== myLower);
    const ccMinusMe = ccAddresses.filter((a) => a.email.toLowerCase() !== myLower);
    return {
      defaultTo: toMinusMe.map((a) => a.original).join(", "),
      defaultCc: ccMinusMe.map((a) => a.original).join(", "),
    };
  }

  // Someone else sent the last message to me; reply to them.
  // Cc anyone who was on the Cc line of that inbound message, minus me.
  const ccMinusMe = ccAddresses
    .filter((a) => a.email.toLowerCase() !== myLower)
    .map((a) => a.original)
    .join(", ");
  const to = fromEmail || selectedThread?.fromEmail || "";
  return {
    // Belt-and-suspenders guard against still landing on my own email
    // (e.g. a truly self-addressed thread — rare but possible).
    defaultTo: to.toLowerCase() === myLower ? "" : to,
    defaultCc: ccMinusMe,
  };
}

// RFC 5322 address header splitter — handles "Name <addr>, Name2 <addr2>"
// format and returns both the email-only form (for matching) and the
// original token (for re-display).
function splitAddrHeader(header: string): Array<{ email: string; original: string }> {
  if (!header.trim()) return [];
  return header
    .split(/,(?![^<]*>)/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((token) => {
      const m = token.match(/<([^>]+)>/);
      const email = (m ? m[1] : token).trim();
      return { email, original: token };
    });
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
