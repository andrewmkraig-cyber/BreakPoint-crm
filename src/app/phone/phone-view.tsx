"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Mic,
  MoreHorizontal,
  Phone,
  PhoneCall,
  PhoneMissed,
  RefreshCw,
  Send,
  User as UserIcon,
  Users as UsersIcon,
  Voicemail,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { usePhonePanels, type PhoneContact } from "@/lib/phone-panels-context";
import { usePhoneContext } from "@/lib/phone-context";
import { matchContactByPhone, markThreadRead, type PhoneMatch } from "@/app/phone/actions";

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
  // Bump after a send so the detail-load useEffect re-runs and the
  // newly-saved outbound row appears in the thread without a manual
  // refresh.
  const [detailRefresh, setDetailRefresh] = useState(0);
  // Phone Tab Phase 2: profile-jump pill in the thread header. Resolved
  // async after the detail loads so the thread itself isn't blocked on
  // the lookup.
  const [profileMatch, setProfileMatch] = useState<PhoneMatch | null>(null);

  // The New-Text + Call floating panels are mounted at the global
  // Providers level (GlobalPhonePanels) so the FAB works from any
  // route. We still need the context here so that after a successful
  // send the global panel can refresh this page's thread list — see
  // the setAfterSend useEffect below.
  const phonePanels = usePhonePanels();
  // Sidebar unread badge polling. Triggering refreshUnread() inside
  // loadThreads keeps the sidebar in lockstep with the threads list
  // when the user clicks Refresh.
  const phoneCtx = usePhoneContext();

  // Centralized fetch so the initial load, the Refresh button, and
  // post-send "reload threads" all flow through the same path.
  const loadThreads = useCallback(async () => {
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
      if (body?.threads) setThreads(body.threads);
      if (body?.bucketCounts) setBucketCounts(body.bucketCounts);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load threads");
    } finally {
      setListLoading(false);
    }
    // Fire the sidebar refresh in parallel — fast, idempotent, and
    // makes the badge update the moment the user clicks Refresh.
    void phoneCtx.refreshUnread();
  }, [phoneCtx]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // Register loadThreads as the global text panel's onSent hook so
  // sending a text from /phone (or anywhere while /phone is mounted)
  // refreshes this list. Cleared on unmount so off-route sends are
  // a no-op.
  useEffect(() => {
    phonePanels.setAfterSend(() => {
      void loadThreads();
    });
    return () => phonePanels.setAfterSend(null);
  }, [phonePanels, loadThreads]);

  // Listen for thread-read broadcasts (text toast quick-reply, etc.)
  // and optimistically clear the matching thread's hasUnread flag.
  // The next refetch will return the same value from the server, so
  // this just shaves off the visible delay.
  useEffect(() => {
    function onThreadRead(e: Event) {
      const detail = (e as CustomEvent<{ candidateId: string }>).detail;
      if (!detail?.candidateId) return;
      setThreads((prev) =>
        prev.map((t) =>
          t.candidateId === detail.candidateId ? { ...t, hasUnread: false } : t,
        ),
      );
    }
    window.addEventListener("ace:phone-thread-read", onThreadRead);
    return () => window.removeEventListener("ace:phone-thread-read", onThreadRead);
  }, []);

  // Per-thread fetch on selection. Aborts in-flight fetches when the
  // user clicks another row before the previous one resolves.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setProfileMatch(null);
      return;
    }
    const ac = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    setProfileMatch(null);
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
        if (body) {
          setDetail(body);
          // Async fan-out after thread render: profile lookup + mark-read.
          // Both are best-effort — failures don't surface to the user.
          if (body.contact.phoneNumber) {
            void (async () => {
              try {
                const match = await matchContactByPhone(body.contact.phoneNumber);
                if (!ac.signal.aborted) setProfileMatch(match);
              } catch {
                // Silent: pill stays hidden if lookup fails.
              }
            })();
          }
          void (async () => {
            try {
              await markThreadRead(selectedId);
              // Optimistic local clear so the row's unread badge
              // disappears immediately. The next /api/phone/threads
              // refetch will return the same hasUnread=false anyway.
              setThreads((prev) =>
                prev.map((t) =>
                  t.candidateId === selectedId ? { ...t, hasUnread: false } : t,
                ),
              );
              await phoneCtx.refreshUnread();
            } catch {
              // Silent: badge will catch up on next 30s poll.
            }
          })();
        }
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
  }, [selectedId, phoneCtx, detailRefresh]);

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
          <button
            type="button"
            onClick={() => void loadThreads()}
            disabled={listLoading}
            aria-label="Refresh thread list"
            className="ml-auto rounded p-1 text-court-fg-muted transition hover:bg-court-fg/5 hover:text-court-fg disabled:opacity-50"
          >
            <RefreshCw
              className={"h-4 w-4 " + (listLoading ? "animate-spin" : "")}
            />
          </button>
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
          <ThreadDetailPane
            detail={detail}
            profileMatch={profileMatch}
            onSent={() => {
              void loadThreads();
              setDetailRefresh((c) => c + 1);
            }}
          />
        ) : (
          <EmptyDetail />
        )}
      </section>

      {/* The NewText + Call floating panels render globally from
          src/components/phone/global-phone-panels.tsx (mounted in
          Providers) so the FAB works on every route. Sends fired
          while /phone is open trigger loadThreads via the after-send
          callback registered above. */}
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
          <span
            className={
              "truncate text-sm text-court-fg " +
              (thread.hasUnread ? "font-semibold" : "font-medium")
            }
          >
            {thread.contactName || thread.phoneNumber || "(unknown)"}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {thread.hasUnread && (
              <span
                aria-label="Unread"
                className="inline-block h-1.5 w-1.5 rounded-full bg-brand"
              />
            )}
            <span className="text-[11px] text-court-fg-muted">
              {last?.at ? formatRelative(last.at) : ""}
            </span>
          </div>
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
          <span
            className={
              "truncate text-xs " +
              (thread.hasUnread ? "font-medium text-court-fg" : "text-court-fg-muted")
            }
          >
            {preview}
          </span>
        </div>
      </div>
    </button>
  );
}

// ---- Right-pane detail ----

// Dial pad shown when no thread is selected. Replaces the previous
// "Coming in Phase 2" stub. Recruiter can:
//   - click 0-9 / * / # buttons with the mouse
//   - type the same characters on the keyboard while the pad is
//     focused (or anywhere on the page when no input is focused)
//   - press Backspace to drop the last digit
//   - hit Call or Text to dispatch through usePhonePanels with
//     candidateId=null so the existing new-conversation flow takes
//     over against the typed number.
function EmptyDetail() {
  const phonePanels = usePhonePanels();
  const [number, setNumber] = useState("");

  const formatted = useMemo(() => formatDialPadNumber(number), [number]);

  const append = useCallback((ch: string) => {
    setNumber((prev) => (prev.length >= 16 ? prev : prev + ch));
  }, []);
  const backspace = useCallback(() => {
    setNumber((prev) => prev.slice(0, -1));
  }, []);

  // Keyboard input — listens at the document level so the recruiter
  // doesn't have to click the pad first. Skips when an input /
  // textarea / contenteditable is focused so we don't steal keys
  // from the search box, composer, etc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9*#]$/.test(e.key)) {
        e.preventDefault();
        append(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      } else if (e.key === "+") {
        e.preventDefault();
        append("+");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [append, backspace]);

  function dispatch(action: "call" | "text") {
    const trimmed = number.trim();
    if (!trimmed) return;
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < 7) {
      toast.error("Enter at least 7 digits");
      return;
    }
    const contact: PhoneContact = {
      candidateId: null,
      name: trimmed,
      phoneNumber: trimmed,
      tag: null,
    };
    if (action === "call") phonePanels.openCall(contact);
    else phonePanels.openText(contact);
  }

  const KEYS: Array<{ digit: string; letters: string }> = [
    { digit: "1", letters: "" },
    { digit: "2", letters: "ABC" },
    { digit: "3", letters: "DEF" },
    { digit: "4", letters: "GHI" },
    { digit: "5", letters: "JKL" },
    { digit: "6", letters: "MNO" },
    { digit: "7", letters: "PQRS" },
    { digit: "8", letters: "TUV" },
    { digit: "9", letters: "WXYZ" },
    { digit: "*", letters: "" },
    { digit: "0", letters: "+" },
    { digit: "#", letters: "" },
  ];

  return (
    <div className="flex h-[calc(100vh-240px)] flex-col items-center justify-center gap-4 px-6">
      <div className="text-[11px] uppercase tracking-wider text-court-fg-muted">
        Start a new conversation
      </div>
      <div className="flex w-full max-w-[280px] items-center gap-2">
        <div className="flex-1 rounded-lg border border-court-border bg-court-surface-subtle px-3 py-3 text-center font-mono text-xl tracking-wider text-court-fg">
          {formatted || (
            <span className="text-court-fg-muted">Enter number</span>
          )}
        </div>
        {number && (
          <button
            type="button"
            onClick={backspace}
            aria-label="Delete last digit"
            className="rounded-md border border-court-border bg-court-surface px-2 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="grid w-full max-w-[280px] grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k.digit}
            type="button"
            onClick={() => append(k.digit)}
            className="flex h-14 flex-col items-center justify-center rounded-lg border border-court-border bg-court-surface text-court-fg shadow-sm transition hover:bg-court-surface-subtle active:bg-[#EAF4E4]"
          >
            <span className="text-xl font-semibold leading-none">{k.digit}</span>
            {k.letters && (
              <span className="mt-0.5 text-[9px] uppercase tracking-widest text-court-fg-muted">
                {k.letters}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex w-full max-w-[280px] gap-2">
        <button
          type="button"
          onClick={() => dispatch("text")}
          disabled={!number.trim()}
          className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-court-border bg-court-surface text-sm font-semibold text-court-fg shadow-sm transition hover:bg-court-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          Text
        </button>
        <button
          type="button"
          onClick={() => dispatch("call")}
          disabled={!number.trim()}
          className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md bg-[#5A9642] text-sm font-semibold text-white shadow-sm transition hover:bg-[#3F7030] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PhoneCall className="h-4 w-4" />
          Call
        </button>
      </div>
      <p className="max-w-[280px] text-center text-[11px] text-court-fg-muted">
        Or pick a saved conversation from the list. Type on your
        keyboard to enter digits without clicking each key.
      </p>
    </div>
  );
}

// US-style formatter: groups 10-digit numbers as (xxx) xxx-xxxx and
// 11-digit numbers (with a leading 1) as 1 (xxx) xxx-xxxx. For
// anything shorter / longer / containing * # +, just echo the raw
// string — the recruiter is mid-typing or entering a special code.
function formatDialPadNumber(raw: string): string {
  if (!/^[0-9]+$/.test(raw)) return raw;
  const d = raw;
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  if (d.length <= 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) {
    return `1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return d;
}

function ThreadDetailPane({
  detail,
  profileMatch,
  onSent,
}: {
  detail: ThreadDetail;
  profileMatch: PhoneMatch | null;
  onSent: () => void;
}) {
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
          {/* Text button removed — the inline composer at the bottom of
              this pane is the same surface, so a separate header
              button would just be a redundant entry point. Outbound
              calling still ships in Phase 3, so Call stays a
              placeholder for now. */}
          <ActionPlaceholder label="Call" icon={<PhoneCall className="h-3 w-3" />} />
          <OpenInQuoButton phoneNumber={detail.contact.phoneNumber} />
          <OpenProfileButton match={profileMatch} />
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
      {/* Inline composer — POSTs directly to /api/sms (same path the
          NewTextPanel and the candidate-sidebar SMS composer use), so
          replies land via Quo and get the same write-side auto-tagging.
          The parent's onSent re-fetches both the threads list and this
          pane's detail so the new outbound bubble appears without a
          manual refresh. */}
      <InlineSmsComposer
        candidateId={detail.contact.id}
        phoneNumber={detail.contact.phoneNumber}
        onSent={onSent}
      />
    </div>
  );
}

const INLINE_SMS_BODY_MAX = 1000;

function InlineSmsComposer({
  candidateId,
  phoneNumber,
  onSent,
}: {
  candidateId: string;
  phoneNumber: string;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const trimmed = body.trim();
  const sendDisabled = sending || trimmed.length === 0 || !phoneNumber;

  async function send() {
    if (sendDisabled) return;
    setSending(true);
    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          toNumber: phoneNumber,
          body: trimmed,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { status?: string }
        | null;
      if (!res.ok) {
        toast.error(`Send failed (${res.status})`);
        return;
      }
      if (json?.status === "failed") {
        toast.error("Saved, but Quo reported send failed.");
        return;
      }
      setBody("");
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline. Standard messaging
    // UX — matches iMessage, Slack, etc.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-court-border bg-court-surface-subtle/40 px-3 py-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, INLINE_SMS_BODY_MAX))}
        onKeyDown={onKeyDown}
        placeholder="Type a message..."
        rows={1}
        className="max-h-32 min-h-9 flex-1 resize-none rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <button
        type="button"
        onClick={() => void send()}
        disabled={sendDisabled}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-[#5A9642] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#3F7030] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Send className="h-3.5 w-3.5" />
        )}
        Send
      </button>
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

// Renders nothing until matchContactByPhone finds a Candidate or
// Client for the thread's number. Matched → green pill linking to the
// resolved profile. Lookup miss / lookup pending → no chrome at all,
// keeping the header tight when there's no profile to jump to.
function OpenProfileButton({ match }: { match: PhoneMatch | null }) {
  if (!match || match.type === null) return null;
  const href = match.type === "candidate" ? `/candidates/${match.id}` : `/clients/${match.id}`;
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md bg-[#5A9642] px-2 py-1 text-[11px] font-medium text-white shadow-sm transition hover:bg-[#3F7030]"
    >
      <UserIcon className="h-3 w-3" />
      Open Profile
    </Link>
  );
}

// Resolves the Quo conversation deep-link via /api/quo/conversation,
// then opens it in a new tab. Falls back to the inbox URL if the
// lookup misses — the API route handles that branch silently.
function OpenInQuoButton({ phoneNumber }: { phoneNumber: string }) {
  const [loading, setLoading] = useState(false);
  const disabled = !phoneNumber || loading;

  async function onClick() {
    if (disabled) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/quo/conversation?phoneNumber=${encodeURIComponent(phoneNumber)}`,
      );
      const json = (await res.json().catch(() => null)) as { url?: string } | null;
      if (json?.url) window.open(json.url, "_blank", "noopener,noreferrer");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-court-accent hover:text-court-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
      title="Open this conversation in Quo"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
      Open in Quo
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

// ---- New Text panel ----
//
// Bottom-right floating panel anchored at the same corner as the FAB
// but sitting just above it. POSTs to the existing /api/sms endpoint
// (used by the candidate-sidebar SMS composer too) so the outbound
// row + Quo dispatch follow the same path.
//
// Exported so GlobalPhonePanels (mounted in Providers) can render the
// same panel from any route — the FAB lives globally and so must the
// surface it opens.

const TEXT_BODY_MAX = 1000;

// Inline recipient input shown after the user clears the To pill.
// Accepts a phone number; on Enter / blur it runs matchContactByPhone
// so a saved candidate gets picked by name (not just digits) and the
// SMS lands against their candidateId. If no candidate matches, falls
// through to an ad-hoc entry — the panel's Send stays disabled in
// that case because /api/sms requires a candidateId, but the user
// still gets visible feedback that the number didn't match.
function NewTextRecipientInput({
  onPick,
}: {
  onPick: (contact: PhoneContact) => void;
}) {
  const [value, setValue] = useState("");
  const [resolving, setResolving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  async function commit() {
    const raw = value.trim();
    if (!raw) return;
    const digits = raw.replace(/\D/g, "");
    setHint(null);
    if (digits.length >= 7) {
      setResolving(true);
      try {
        const match = await matchContactByPhone(raw);
        if (match.type === "candidate") {
          onPick({
            candidateId: match.id,
            name: match.name,
            phoneNumber: raw,
            tag: "Candidate",
          });
          return;
        }
        // No candidate match — fall through to ad-hoc. Send button
        // remains disabled (candidateId required for /api/sms).
        setHint("No saved candidate for this number. Add the candidate in Ace first to text them.");
        onPick({
          candidateId: null,
          name: raw,
          phoneNumber: raw,
          tag: null,
        });
      } finally {
        setResolving(false);
      }
    } else {
      // Too few digits to attempt a phone match — most likely a name
      // search, which the FAB picker handles. Nudge the user there.
      setHint("Type a phone number, or use the + button (top right) to search by name.");
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    }
  }

  return (
    <div className="space-y-1">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void commit()}
        placeholder="Phone number (then Enter)"
        autoFocus
        className="h-9 w-full rounded-md border border-court-border bg-court-surface px-3 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {resolving && (
        <div className="px-1 text-[11px] text-court-fg-muted">
          Looking up contact…
        </div>
      )}
      {hint && !resolving && (
        <div className="px-1 text-[11px] text-court-fg-muted">{hint}</div>
      )}
    </div>
  );
}

export function NewTextPanel({
  contact,
  onClose,
  onSwitchToCall,
  onSent,
}: {
  contact: PhoneContact | null;
  onClose: () => void;
  onSwitchToCall: () => void;
  onSent: () => void;
}) {
  const [recipient, setRecipient] = useState<PhoneContact | null>(contact);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync incoming contact prop on open / contact change.
  useEffect(() => {
    setRecipient(contact);
  }, [contact]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Autofocus the body textarea once a recipient is locked in.
  useEffect(() => {
    if (recipient) {
      const t = setTimeout(() => bodyRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [recipient]);

  const sendDisabled =
    sending ||
    success ||
    !recipient ||
    !recipient.candidateId ||
    !recipient.phoneNumber ||
    body.trim().length === 0;

  async function onSend() {
    if (sendDisabled || !recipient || !recipient.candidateId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: recipient.candidateId,
          toNumber: recipient.phoneNumber,
          body: body.trim(),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(`Send failed (${res.status})`);
        return;
      }
      if (json?.status === "failed") {
        setError("Saved, but Quo reported send failed.");
        return;
      }
      setSuccess(true);
      onSent();
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="New text"
      className="fixed right-6 bottom-24 z-[1001] flex w-96 flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-court-border px-4 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
          New text
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wider text-court-fg-muted">
            To
          </div>
          {recipient ? (
            (() => {
              // Dedupe display when the "name" is just the phone number
              // (ad-hoc fresh number flow). Comparing the digit-only
              // forms catches "(216) 870-4655" === "2168704655" too.
              const nameDigits = recipient.name.replace(/\D/g, "");
              const phoneDigits = recipient.phoneNumber.replace(/\D/g, "");
              const showPhoneSubline =
                recipient.name !== recipient.phoneNumber &&
                !(nameDigits && nameDigits === phoneDigits);
              return (
                <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-court-border bg-court-surface-subtle px-2 py-1">
                  <span className="truncate text-sm text-court-fg">
                    {recipient.name}
                  </span>
                  {showPhoneSubline && (
                    <span className="truncate text-[11px] text-court-fg-muted">
                      {recipient.phoneNumber}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setRecipient(null)}
                    aria-label="Clear recipient"
                    className="rounded-full p-0.5 text-court-fg-muted transition hover:bg-court-fg/10 hover:text-court-fg"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })()
          ) : (
            <NewTextRecipientInput onPick={setRecipient} />
          )}
        </div>

        <div className="relative">
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) =>
              setBody(e.target.value.slice(0, TEXT_BODY_MAX))
            }
            placeholder="Type a message..."
            rows={5}
            className="w-full resize-none rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <div className="absolute right-2 bottom-2 text-[10px] text-court-fg-muted">
            {body.length}/{TEXT_BODY_MAX}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-800">
            Sent
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-court-border px-4 py-2">
        <button
          type="button"
          onClick={onSwitchToCall}
          className="text-[11px] font-medium text-court-fg-muted underline-offset-2 transition hover:text-court-fg hover:underline"
        >
          Call instead
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={sendDisabled}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#5A9642] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#3F7030] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Send text
        </button>
      </div>
    </div>
  );
}

// ---- Call panel ----
//
// Smaller floating panel; click "Call now" toasts a Phase-2 message
// because there's no /api/krispcall/call outbound endpoint yet.
// Exported for the same reason as NewTextPanel — GlobalPhonePanels
// renders this from Providers so the FAB works on every route.

export function CallPanel({
  contact,
  onClose,
  onSwitchToText,
}: {
  contact: PhoneContact | null;
  onClose: () => void;
  onSwitchToText: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const initials = (contact?.name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");

  // TODO: Phase 2 — POST /api/krispcall/call with { to: phoneNumber }
  // and reflect the call status in the UI. The Quo outbound API is
  // not wired up yet; click-to-call from candidate profiles
  // currently goes through Quo's hosted dialer. Replace this toast
  // when the outbound API arrives.
  function placeCall() {
    toast.info("Call feature coming soon");
  }

  return (
    <div
      role="dialog"
      aria-label="Call"
      className="fixed right-6 bottom-24 z-[1001] flex w-72 flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-court-border px-4 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Call
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 px-4 py-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-court-surface-subtle text-sm font-semibold text-court-fg-muted">
          {initials || <UserIcon className="h-5 w-5" />}
        </div>
        <div>
          <div className="text-sm font-medium text-court-fg">
            {contact?.name ?? "(no contact)"}
          </div>
          {contact?.phoneNumber && (
            <div className="text-[11px] text-court-fg-muted">
              {contact.phoneNumber}
            </div>
          )}
          {contact?.tag && (
            <div className="mt-1 inline-block rounded-sm bg-court-surface-subtle px-1 py-0.5 text-[10px] uppercase tracking-wider text-court-fg-muted">
              {contact.tag}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={placeCall}
          disabled={!contact}
          className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-[#5A9642] text-sm font-semibold text-white shadow-sm transition hover:bg-[#3F7030] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PhoneCall className="h-4 w-4" />
          Call now
        </button>
        <div className="flex items-center justify-between text-[11px]">
          <button
            type="button"
            onClick={onSwitchToText}
            className="font-medium text-court-fg-muted underline-offset-2 transition hover:text-court-fg hover:underline"
          >
            Text instead
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-court-fg-muted transition hover:text-court-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
