"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Mic,
  MoreHorizontal,
  Phone,
  PhoneCall,
  PhoneMissed,
  Send,
  User as UserIcon,
  Users as UsersIcon,
  Voicemail,
} from "lucide-react";
import { toast } from "sonner";

// Phase 1 Phone Tab. Layout mirrors /mail exactly:
//   sidebar (col-span-2) · thread list (col-span-3) · detail (col-span-7)
//
// Buckets across the sidebar drive a client-side filter over the
// already-fetched threads list. Only the thread detail (right pane)
// needs a per-thread fetch.

type PhoneBucket =
  | "all"
  | "texts"
  | "calls"
  | "missed"
  | "voicemails"
  | "candidates"
  | "clients"
  | "unknown"
  | "needsReply";

type ThreadEntryLast =
  | { kind: "sms"; at: string; body: string; direction: string }
  | {
      kind: "call";
      at: string;
      direction: string;
      duration: number | null;
      status: string;
    };

type PhoneThread = {
  id: string;
  kind: "candidate";
  candidateId: string;
  contactName: string;
  phoneNumber: string;
  lastActivity: ThreadEntryLast | null;
  counts: { sms: number; calls: number; missedCalls: number };
  hasUnread: boolean;
};

type BucketCounts = Record<PhoneBucket, number>;

type SmsEntry = {
  kind: "sms";
  id: string;
  direction: string;
  body: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  createdAt: string;
};
type CallEntry = {
  kind: "call";
  id: string;
  direction: string;
  fromNumber: string;
  toNumber: string;
  duration: number | null;
  status: string;
  recordingUrl: string | null;
  createdAt: string;
};
type ThreadEntry = SmsEntry | CallEntry;

type ThreadDetail = {
  contact: {
    kind: "candidate";
    id: string;
    name: string;
    phoneNumber: string;
  };
  entries: ThreadEntry[];
};

export function PhoneView() {
  const [threads, setThreads] = useState<PhoneThread[]>([]);
  const [bucketCounts, setBucketCounts] = useState<BucketCounts>({
    all: 0,
    texts: 0,
    calls: 0,
    missed: 0,
    voicemails: 0,
    candidates: 0,
    clients: 0,
    unknown: 0,
    needsReply: 0,
  });
  const [bucket, setBucket] = useState<PhoneBucket>("all");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Initial load + manual refresh hook (Phase 2 will add a refresh
  // button mirroring the mail tab).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setListLoading(true);
      setListError(null);
      try {
        const res = await fetch("/api/phone/threads", { cache: "no-store" });
        if (!res.ok) {
          setListError(`Couldn’t load threads (HTTP ${res.status})`);
          return;
        }
        const body = (await res.json().catch(() => null)) as
          | { threads?: PhoneThread[]; bucketCounts?: BucketCounts }
          | null;
        if (cancelled) return;
        if (body?.threads) setThreads(body.threads);
        if (body?.bucketCounts) setBucketCounts(body.bucketCounts);
      } catch (e) {
        if (cancelled) return;
        setListError(e instanceof Error ? e.message : "Failed to load threads");
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Per-thread fetch on selection. Aborts in-flight fetches when the
  // user clicks another row before the previous one resolves.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const ac = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/phone/thread/${encodeURIComponent(selectedId)}`,
          { cache: "no-store", signal: ac.signal },
        );
        if (!res.ok) {
          setDetailError(`Couldn’t load thread (HTTP ${res.status})`);
          return;
        }
        const body = (await res.json().catch(() => null)) as ThreadDetail | null;
        if (body) setDetail(body);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        setDetailError(
          e instanceof Error ? e.message : "Failed to load thread",
        );
      } finally {
        setDetailLoading(false);
      }
    })();
    return () => ac.abort();
  }, [selectedId]);

  // Client-side bucket filtering over the already-loaded threads.
  const filteredThreads = useMemo(() => {
    switch (bucket) {
      case "all":
        return threads;
      case "texts":
        return threads.filter((t) => t.counts.sms > 0);
      case "calls":
        return threads.filter((t) => t.counts.calls > 0);
      case "missed":
        return threads.filter((t) => t.counts.missedCalls > 0);
      case "voicemails":
        // No voicemail data path yet — bucket renders empty state.
        return [];
      case "candidates":
        return threads.filter((t) => t.kind === "candidate");
      case "clients":
        return [];
      case "unknown":
        return [];
      case "needsReply":
        return threads.filter(
          (t) =>
            t.lastActivity?.kind === "sms" &&
            t.lastActivity.direction === "inbound",
        );
      default:
        return threads;
    }
  }, [threads, bucket]);

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* LEFT SIDEBAR */}
      <aside className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-2">
        <div className="border-b border-court-border bg-court-surface-subtle/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Phone
        </div>
        <nav className="p-2 text-sm">
          <BucketSection title="Phone">
            <BucketItem
              icon={<Phone className="h-4 w-4" />}
              label="All"
              active={bucket === "all"}
              count={bucketCounts.all}
              onClick={() => setBucket("all")}
            />
            <BucketItem
              icon={<Send className="h-4 w-4" />}
              label="Texts"
              active={bucket === "texts"}
              count={bucketCounts.texts}
              onClick={() => setBucket("texts")}
            />
            <BucketItem
              icon={<PhoneCall className="h-4 w-4" />}
              label="Calls"
              active={bucket === "calls"}
              count={bucketCounts.calls}
              onClick={() => setBucket("calls")}
            />
            <BucketItem
              icon={<PhoneMissed className="h-4 w-4" />}
              label="Missed"
              active={bucket === "missed"}
              count={bucketCounts.missed}
              onClick={() => setBucket("missed")}
            />
            <BucketItem
              icon={<Voicemail className="h-4 w-4" />}
              label="Voicemails"
              active={bucket === "voicemails"}
              count={bucketCounts.voicemails}
              onClick={() => setBucket("voicemails")}
            />
          </BucketSection>

          <div className="my-3 border-t border-court-border" />

          <BucketSection title="Saved Views">
            <BucketItem
              icon={<UserIcon className="h-4 w-4" />}
              label="Candidates"
              active={bucket === "candidates"}
              count={bucketCounts.candidates}
              onClick={() => setBucket("candidates")}
            />
            <BucketItem
              icon={<UsersIcon className="h-4 w-4" />}
              label="Clients"
              active={bucket === "clients"}
              count={bucketCounts.clients}
              onClick={() => setBucket("clients")}
            />
            <BucketItem
              icon={<AlertCircle className="h-4 w-4" />}
              label="Unknown Numbers"
              active={bucket === "unknown"}
              count={bucketCounts.unknown}
              onClick={() => setBucket("unknown")}
            />
            <BucketItem
              icon={<Mic className="h-4 w-4" />}
              label="Needs Reply"
              active={bucket === "needsReply"}
              count={bucketCounts.needsReply}
              onClick={() => setBucket("needsReply")}
            />
          </BucketSection>
        </nav>
      </aside>

      {/* MIDDLE: THREAD LIST */}
      <aside className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-3">
        <div className="flex items-center gap-2 border-b border-court-border bg-court-surface-subtle/60 px-4 py-2 text-[11px] uppercase tracking-wider text-court-fg-muted">
          <span>
            {filteredThreads.length}{" "}
            {filteredThreads.length === 1 ? "thread" : "threads"}
          </span>
        </div>
        {listLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : listError ? (
          <div className="px-4 py-12 text-center text-sm text-red-700">
            {listError}
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-court-fg-muted">
            <Phone className="h-6 w-6 text-court-fg-muted" />
            <span>No conversations yet</span>
          </div>
        ) : (
          <ul className="max-h-[calc(100vh-240px)] divide-y divide-court-border overflow-y-auto">
            {filteredThreads.map((t) => (
              <li key={t.id}>
                <ThreadRow
                  thread={t}
                  selected={selectedId === t.id}
                  onClick={() => setSelectedId(t.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* RIGHT: DETAIL */}
      <section className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-7">
        {!selectedId ? (
          <EmptyDetail />
        ) : detailLoading && !detail ? (
          <div className="flex h-[calc(100vh-240px)] items-center justify-center gap-2 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading thread…
          </div>
        ) : detailError ? (
          <div className="p-5 text-sm text-red-700">{detailError}</div>
        ) : detail ? (
          <ThreadDetailPane detail={detail} />
        ) : (
          <EmptyDetail />
        )}
      </section>
    </div>
  );
}

// ---- Sidebar pieces ----

function BucketSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="px-3 pb-1 text-[11px] uppercase tracking-wider text-court-fg-muted">
        {title}
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </>
  );
}

function BucketItem({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={
          "flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left transition " +
          (active
            ? "bg-[#EAF4E4] text-[#3F7030]"
            : "text-court-fg hover:bg-slate-50")
        }
      >
        <span className="shrink-0 text-court-fg-muted">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        {count > 0 && (
          <span
            className={
              "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold " +
              (active
                ? "bg-white text-[#3F7030]"
                : "bg-court-surface-subtle text-court-fg-muted")
            }
          >
            {count}
          </span>
        )}
      </button>
    </li>
  );
}

// ---- Thread list row ----

function ThreadRow({
  thread,
  selected,
  onClick,
}: {
  thread: PhoneThread;
  selected: boolean;
  onClick: () => void;
}) {
  const initials = thread.contactName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
  const hasMissed = thread.counts.missedCalls > 0;
  const last = thread.lastActivity;
  const preview =
    last?.kind === "sms"
      ? last.body
      : last?.kind === "call"
        ? formatCallSummary(last)
        : "(no activity)";
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-start gap-3 px-3 py-3 text-left transition " +
        (selected ? "bg-court-accent-tint/60" : "hover:bg-court-accent-tint/30")
      }
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-court-surface-subtle text-[11px] font-semibold uppercase text-court-fg-muted">
        {initials || <UserIcon className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-court-fg">
            {thread.contactName || thread.phoneNumber || "(unknown)"}
          </span>
          <span className="shrink-0 text-[11px] text-court-fg-muted">
            {last?.at ? formatRelative(last.at) : ""}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-court-fg-muted">
          {thread.kind === "candidate" && (
            <span className="rounded-sm bg-court-surface-subtle px-1 py-0.5 text-[10px] uppercase tracking-wider">
              Candidate
            </span>
          )}
          {thread.phoneNumber && (
            <span className="truncate">{thread.phoneNumber}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {hasMissed && (
            <PhoneMissed className="h-3 w-3 shrink-0 text-red-600" />
          )}
          <span className="truncate text-xs text-court-fg-muted">{preview}</span>
          {thread.hasUnread && (
            <span className="ml-auto inline-block h-2 w-2 shrink-0 rounded-full bg-[#5A9642]" />
          )}
        </div>
      </div>
    </button>
  );
}

// ---- Right-pane detail ----

function EmptyDetail() {
  return (
    <div className="flex h-[calc(100vh-240px)] flex-col items-center justify-center gap-3 px-6 text-center">
      <Phone className="h-10 w-10 text-court-fg-muted" />
      <p className="text-sm text-court-fg-muted">
        Select a conversation to view texts and calls.
      </p>
      <button
        type="button"
        onClick={() => toast.info("New conversation flow ships in Phase 2")}
        className="rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
      >
        Or start a new conversation.
      </button>
    </div>
  );
}

function ThreadDetailPane({ detail }: { detail: ThreadDetail }) {
  return (
    <div className="flex h-[calc(100vh-240px)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-court-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-court-fg">
            {detail.contact.name}
          </h2>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-court-fg-muted">
            <span className="rounded-sm bg-court-surface-subtle px-1 py-0.5 text-[10px] uppercase tracking-wider">
              {detail.contact.kind}
            </span>
            {detail.contact.phoneNumber && (
              <span>{detail.contact.phoneNumber}</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ActionPlaceholder label="Call" icon={<PhoneCall className="h-3 w-3" />} />
          <ActionPlaceholder label="Text" icon={<Send className="h-3 w-3" />} />
          <ActionPlaceholder label="Open Profile" icon={<UserIcon className="h-3 w-3" />} />
          <ActionPlaceholder label="More" icon={<MoreHorizontal className="h-3 w-3" />} />
        </div>
      </div>
      {/* Thread body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {detail.entries.length === 0 ? (
          <div className="py-12 text-center text-sm text-court-fg-muted">
            No history yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {detail.entries.map((e) =>
              e.kind === "sms" ? (
                <li key={e.id} className={
                  "flex " +
                  (e.direction === "outbound" ? "justify-end" : "justify-start")
                }>
                  <div
                    className={
                      "max-w-[75%] rounded-2xl px-3 py-2 text-sm " +
                      (e.direction === "outbound"
                        ? "bg-[#5A9642] text-white"
                        : "bg-court-surface-subtle text-court-fg")
                    }
                  >
                    <div className="whitespace-pre-wrap break-words">{e.body}</div>
                    <div
                      className={
                        "mt-1 text-[10px] " +
                        (e.direction === "outbound"
                          ? "text-white/70"
                          : "text-court-fg-muted")
                      }
                    >
                      {new Date(e.createdAt).toLocaleString()}
                    </div>
                  </div>
                </li>
              ) : (
                <li key={e.id} className="flex justify-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-court-border bg-court-surface-subtle px-3 py-1.5 text-xs text-court-fg-muted">
                    {callIcon(e)}
                    <span>{formatCallSummary(e)}</span>
                    <span className="text-[10px]">
                      · {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
      {/* Bottom composer placeholder — Phase 2 wires this through Quo. */}
      {/* TODO: Phase 2: wire send via Quo API */}
      <div className="flex items-center gap-2 border-t border-court-border bg-court-surface-subtle/40 px-3 py-2">
        <input
          type="text"
          disabled
          placeholder="Type a message..."
          className="h-9 flex-1 rounded-md border border-court-border bg-court-surface px-3 text-sm text-court-fg-muted disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          disabled
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-3 text-xs font-medium text-court-fg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Send className="h-3.5 w-3.5" />
          Send
        </button>
      </div>
    </div>
  );
}

function ActionPlaceholder({
  label,
  icon,
}: {
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => toast.info(`${label}: ships in Phase 2`)}
      className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
    >
      {icon}
      {label}
    </button>
  );
}

// ---- Formatters ----

function formatCallSummary(e: {
  kind: "call";
  direction: string;
  duration: number | null;
  status: string;
}): string {
  if (e.status === "missed" || e.status === "no-answer") return "Missed call";
  if (e.duration && e.duration > 0) {
    const m = Math.floor(e.duration / 60);
    const s = e.duration % 60;
    const ms = m > 0 ? `${m}m ` : "";
    return `${e.direction === "inbound" ? "Incoming call" : "Outgoing call"} (${ms}${s}s)`;
  }
  return e.direction === "inbound" ? "Incoming call" : "Outgoing call";
}

function callIcon(e: { kind: "call"; status: string; direction: string }) {
  if (e.status === "missed" || e.status === "no-answer") {
    return <PhoneMissed className="h-3 w-3 text-red-600" />;
  }
  return <PhoneCall className="h-3 w-3 text-court-fg-muted" />;
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
