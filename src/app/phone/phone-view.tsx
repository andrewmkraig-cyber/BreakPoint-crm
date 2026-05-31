"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CheckCheck,
  ChevronLeft,
  ExternalLink,
  Loader2,
  Phone,
  PhoneCall,
  PhoneMissed,
  RefreshCw,
  Send,
  User as UserIcon,
  UserPlus,
  Users as UsersIcon,
  Voicemail,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePhonePanels, type PhoneContact } from "@/lib/phone-panels-context";
import { usePhoneContext } from "@/lib/phone-context";
import { matchContactByPhone, markThreadRead, type PhoneMatch } from "@/app/phone/actions";
import {
  PHONE_SMS_SENT_EVENT,
  type PhoneSmsSentEventDetail,
} from "@/components/text-notification-toast";
import { ImageLightbox } from "@/components/image-lightbox";
import { telHref } from "@/lib/rf-payload-shapes";

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
  | "clients";

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
  // "candidate" — joined to a Candidate row.
  // "unknown"   — no Candidate match in the CRM. Surfaced so the
  //               recruiter still sees calls/texts with people not
  //               yet added (e.g. a client contact); the row offers
  //               an "Add to Ace" affordance.
  kind: "candidate" | "unknown";
  candidateId: string | null;
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
  // Quo MMS attachment URL (image, typically). Null for plain SMS.
  // Rendered as an <img> above the body inside the bubble.
  mediaUrl: string | null;
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
    kind: "candidate" | "unknown";
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
  // Tracks the last thread id auto-marked-read on open so a post-send
  // detailRefresh re-run of the detail-load effect doesn't re-fire the
  // mark-read for a thread that's already cleared. Reset implicitly by
  // selecting a different thread (id differs from the ref).
  const autoMarkedRef = useRef<string | null>(null);
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
  // Dial-pad modal state lives on the global PhonePanelsContext so
  // the topbar's "+ New Text/Call" button can trigger the same modal
  // that PhoneView used to own internally. We only read dialPadOpen
  // here for the EmptyDetail keyboard-capture behavior; the open and
  // close handlers fire from the topbar button + the modal itself.
  const dialPadOpen = phonePanels.dialPadOpen;
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
  // refreshes this list AND re-fetches the open thread detail (so the
  // new outbound bubble appears in the right pane immediately instead
  // of waiting until the recruiter re-selects the row). Cleared on
  // unmount so off-route sends are a no-op.
  useEffect(() => {
    phonePanels.setAfterSend(() => {
      void loadThreads();
      setDetailRefresh((c) => c + 1);
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

  // Belt-and-suspenders refresh: every composer (InlineSmsComposer,
  // NewTextPanel, SmsComposer, toast quick-reply) broadcasts
  // PHONE_SMS_SENT_EVENT after a /api/sms POST resolves. Subscribing
  // PhoneView directly means the detail pane re-fetches even if a
  // composer's own onSent callback chain is broken or hasn't been
  // wired. The thread list + sidebar badge also catch up in the same
  // tick. Detail-side dependency on selectedId via detailRefresh
  // covers the "open thread, send, see new bubble" loop.
  useEffect(() => {
    function onSmsSent() {
      void loadThreads();
      setDetailRefresh((c) => c + 1);
    }
    window.addEventListener(PHONE_SMS_SENT_EVENT, onSmsSent);
    return () => window.removeEventListener(PHONE_SMS_SENT_EVENT, onSmsSent);
  }, [loadThreads]);

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
          // Auto-mark-on-open: opening a thread clears its unread state
          // the same way the manual "Mark as read" button does
          // (markThreadRead → local hasUnread flip → sidebar badge
          // refresh). Guarded by autoMarkedRef so a post-send
          // detailRefresh re-run of this effect doesn't re-fire it for a
          // thread that's already been cleared on this open.
          if (autoMarkedRef.current !== selectedId) {
            autoMarkedRef.current = selectedId;
            void (async () => {
              try {
                await markThreadRead(selectedId);
                setThreads((prev) =>
                  prev.map((t) =>
                    t.id === selectedId ? { ...t, hasUnread: false } : t,
                  ),
                );
                await phoneCtx.refreshUnread();
              } catch {
                // Silent: badge will catch up on next 30s poll.
              }
            })();
          }
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
      default:
        return threads;
    }
  }, [threads, bucket]);

  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col">
    {/* Title + action button now live in the global TopBar via
        TopBarPageTitle, so PhoneView starts directly with the threads
        grid and reclaims the row of vertical space the inline header
        used to occupy. */}
    {/* Mobile-only horizontal tab strip. Replaces the LEFT SIDEBAR
        nav (which is hidden below lg). Scrolls horizontally so all
        nine buckets stay reachable on a 375px viewport. */}
    <MobileBucketTabs
      bucket={bucket}
      setBucket={setBucket}
      counts={bucketCounts}
    />
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
      {/* LEFT SIDEBAR — hidden below lg (mobile + tablet rely on
          MobileBucketTabs above). */}
      <aside className="hidden flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-2 lg:flex">
        <div className="shrink-0 border-b border-court-border bg-court-surface-subtle/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Phone
        </div>
        <nav className="flex-1 overflow-y-auto p-2 text-sm">
          <BucketSection title="Phone">
            <BucketItem
              icon={<Phone className="h-4 w-4" />}
              label="Inbox"
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
          </BucketSection>
        </nav>
      </aside>

      {/* MIDDLE: THREAD LIST. Below md the list is the single visible
          pane when no thread is selected; the detail section takes
          over when one is. md+ keeps both visible side-by-side. */}
      <aside
        className={
          (selectedId ? "hidden md:flex" : "flex") +
          " flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-3"
        }
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-court-border bg-court-surface-subtle/60 px-4 py-2 text-[11px] uppercase tracking-wider text-court-fg-muted">
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
          <div className="flex flex-1 items-center justify-center gap-2 px-4 py-12 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : listError ? (
          <div className="flex-1 overflow-y-auto px-4 py-12 text-center text-sm text-red-700">
            {listError}
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center text-sm text-court-fg-muted">
            <Phone className="h-6 w-6 text-court-fg-muted" />
            <span>No conversations yet</span>
          </div>
        ) : (
          <ul className="flex-1 divide-y divide-court-border overflow-y-auto">
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

      {/* RIGHT: DETAIL. Hidden on mobile when no thread is selected
          so the thread list owns the viewport; flips to full-bleed
          when a row is tapped. md+ unchanged. */}
      <section
        className={
          (selectedId ? "flex" : "hidden md:flex") +
          " flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-7"
        }
      >
        {!selectedId ? (
          <EmptyDetail keyboardCapture={!dialPadOpen} />
        ) : detailLoading && !detail ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading thread…
          </div>
        ) : detailError ? (
          <div className="p-5 text-sm text-red-700">{detailError}</div>
        ) : detail ? (
          <ThreadDetailPane
            detail={detail}
            profileMatch={profileMatch}
            hasUnread={threads.find((t) => t.id === selectedId)?.hasUnread ?? false}
            onMarkRead={() => {
              if (!selectedId) return;
              void (async () => {
                try {
                  await markThreadRead(selectedId);
                  setThreads((prev) =>
                    prev.map((t) =>
                      t.id === selectedId ? { ...t, hasUnread: false } : t,
                    ),
                  );
                  await phoneCtx.refreshUnread();
                } catch {
                  // Silent: badge will catch up on next 30s poll.
                }
              })();
            }}
            onBack={() => setSelectedId(null)}
            onSent={() => {
              void loadThreads();
              setDetailRefresh((c) => c + 1);
            }}
          />
        ) : (
          <EmptyDetail keyboardCapture={!dialPadOpen} />
        )}
      </section>

      {/* The NewText + Call floating panels render globally from
          src/components/phone/global-phone-panels.tsx (mounted in
          Providers) so the FAB works on every route. Sends fired
          while /phone is open trigger loadThreads via the after-send
          callback registered above. */}
    </div>
    </div>
    {/* Mobile-only FAB. Hidden when a thread is open so it doesn't
        cover the message composer at the bottom of ThreadDetailPane.
        Calls into the same DialPadModal the topbar uses — mounts
        globally via GlobalPhonePanels. */}
    {!selectedId && (
      <button
        type="button"
        onClick={phonePanels.openDialPad}
        aria-label="Open dial pad"
        className="fixed bottom-5 right-5 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-court-accent text-white shadow-lg transition hover:bg-court-accent-dark focus:outline-none focus-visible:ring-[3px] focus-visible:ring-court-accent/40 md:hidden"
      >
        <PhoneCall className="h-6 w-6" />
      </button>
    )}
    {/* DialPadModal mounts globally via GlobalPhonePanels so the
        topbar's "+ New Text/Call" button can pop the modal from any
        route, not just /phone. */}
    </>
  );
}

// Mobile-only horizontal tab strip. Mirrors the lg+ left sidebar's
// bucket nav but lays out as a scrollable pill row so all nine
// buckets stay reachable on a 375px viewport. Hidden at lg+ where
// the sidebar takes over.
function MobileBucketTabs({
  bucket,
  setBucket,
  counts,
}: {
  bucket: PhoneBucket;
  setBucket: (k: PhoneBucket) => void;
  counts: BucketCounts;
}) {
  const pills: Array<{
    key: PhoneBucket;
    icon: React.ReactNode;
    label: string;
    count: number;
  }> = [
    { key: "all", icon: <Phone className="h-3.5 w-3.5" />, label: "All", count: counts.all },
    { key: "texts", icon: <Send className="h-3.5 w-3.5" />, label: "Texts", count: counts.texts },
    { key: "calls", icon: <PhoneCall className="h-3.5 w-3.5" />, label: "Calls", count: counts.calls },
    { key: "missed", icon: <PhoneMissed className="h-3.5 w-3.5" />, label: "Missed", count: counts.missed },
    { key: "voicemails", icon: <Voicemail className="h-3.5 w-3.5" />, label: "Voicemails", count: counts.voicemails },
    { key: "candidates", icon: <UserIcon className="h-3.5 w-3.5" />, label: "Candidates", count: counts.candidates },
    { key: "clients", icon: <UsersIcon className="h-3.5 w-3.5" />, label: "Clients", count: counts.clients },
  ];
  return (
    <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden">
      {pills.map((p) => {
        const active = bucket === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => setBucket(p.key)}
            className={
              "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition " +
              (active
                ? "border-court-accent bg-court-accent-tint text-court-accent-dark"
                : "border-court-border bg-court-surface text-court-fg-muted hover:bg-court-surface-subtle")
            }
          >
            {p.icon}
            <span>{p.label}</span>
            {p.count > 0 && (
              <span className="rounded-full bg-court-fg/10 px-1.5 text-[10px] tabular-nums text-court-fg-muted">
                {p.count}
              </span>
            )}
          </button>
        );
      })}
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
          "flex min-h-9 w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left transition " +
          (active
            ? "border-court-brand bg-transparent font-semibold text-court-brand"
            : "border-transparent font-medium text-court-fg hover:bg-court-surface-subtle")
        }
      >
        <span className="shrink-0">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        {count > 0 && (
          <span
            className={
              "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold " +
              (active
                ? "bg-court-brand-tint text-court-brand-dark"
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
        "flex w-full items-start gap-3 px-3 py-2.5 text-left transition " +
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
          {thread.kind === "candidate" ? (
            <span className="rounded-sm bg-court-surface-subtle px-1 py-0.5 text-[10px] uppercase tracking-wider">
              Candidate
            </span>
          ) : (
            <span className="rounded-sm bg-court-surface-subtle px-1 py-0.5 text-[10px] uppercase tracking-wider text-court-fg-muted">
              Unknown
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

// Dial pad shown when no thread is selected. Wraps the shared
// DialPad component with the empty-state copy + container.
//
// keyboardCapture is gated by the parent: when the New Text/Call
// modal is open the modal version owns the doc-level keystrokes, so
// this inline copy bails to avoid double-typing.
function EmptyDetail({ keyboardCapture }: { keyboardCapture: boolean }) {
  // h-full + overflow-y-auto: the parent <section> is sized via the
  // viewport-bounded flex layout in PhoneView, so the dialer fills
  // exactly the available height. overflow-y-auto lets the pad
  // scroll internally on viewports too short for the full pad +
  // helper text without clipping.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8">
      <div className="text-[11px] uppercase tracking-wider text-court-fg-muted">
        Start a new conversation
      </div>
      <DialPad keyboardCapture={keyboardCapture} />
      <p className="max-w-[280px] text-center text-[11px] text-court-fg-muted">
        Or pick a saved conversation from the list. Type on your
        keyboard to enter digits without clicking each key.
      </p>
    </div>
  );
}

// Reusable dial pad. Used by the empty-state right pane AND by the
// "New Text/Call" header button's modal.
//
// Recruiter can:
//   - click 0-9 / * / # buttons with the mouse
//   - type the same characters on the keyboard while the pad is
//     mounted with keyboardCapture=true (no input focused)
//   - press Backspace to drop the last digit
//   - hit Call or Text to dispatch through usePhonePanels with
//     candidateId=null so the existing new-conversation flow takes
//     over against the typed number.
function DialPad({
  keyboardCapture,
  onSubmit,
}: {
  keyboardCapture: boolean;
  onSubmit?: () => void;
}) {
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
  // from the search box, composer, etc. The keyboardCapture flag
  // lets a parent disable this listener when another DialPad
  // instance owns the keystrokes (e.g. the modal version).
  useEffect(() => {
    if (!keyboardCapture) return;
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
  }, [append, backspace, keyboardCapture]);

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
    onSubmit?.();
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
    <div className="flex flex-col items-center gap-4">
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
            className="flex h-14 flex-col items-center justify-center rounded-lg border border-court-border bg-court-surface text-court-fg shadow-sm transition hover:bg-court-surface-subtle active:bg-court-brand-tint"
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
        <Button
          type="button"
          variant="primary"
          onClick={() => dispatch("call")}
          disabled={!number.trim()}
          className="h-10 flex-1 rounded-md bg-court-brand text-white hover:bg-court-brand-dark"
        >
          <PhoneCall className="h-4 w-4" />
          Call
        </Button>
      </div>
    </div>
  );
}

// Modal wrapper around DialPad. Triggered by the page-header
// "New Text/Call" button so a dial pad is reachable even when a
// thread is open in the right pane.
export function DialPadModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex bg-ink/40 md:items-center md:justify-center md:p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full flex-col bg-court-surface p-6 shadow-xl md:max-w-sm md:rounded-xl md:border md:border-court-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider text-court-fg-muted">
            New text or call
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dial pad"
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <DialPad keyboardCapture={true} onSubmit={onClose} />
        <p className="mt-4 text-center text-[11px] text-court-fg-muted">
          Type on your keyboard to enter digits without clicking each key.
        </p>
      </div>
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
  onBack,
  hasUnread,
  onMarkRead,
}: {
  detail: ThreadDetail;
  profileMatch: PhoneMatch | null;
  onSent: () => void;
  // Mobile-only — the desktop split view already has the list visible
  // alongside, so the back affordance only renders below md.
  onBack?: () => void;
  // Quo sends no read-receipt webhook, so the unread state lives in
  // Ace's DB. Auto-mark-on-open clears it for the common case; this
  // button is the manual fallback when the auto-mark errored or the
  // user wants to clear without scrolling.
  hasUnread?: boolean;
  onMarkRead?: () => void;
}) {
  // Land the message list at the newest entry whenever the open thread
  // changes or a new message arrives. Keyed on the thread identity
  // (contact.id) so selecting a thread opens scrolled to the bottom, and
  // on the entry count so a freshly sent reply scrolls into view.
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [detail.contact.id, detail.entries.length]);

  // Tapped MMS attachment, opened in the full-screen viewer. Null = closed.
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-court-border px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to thread list"
              className="-ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg md:hidden"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-court-fg">
            {detail.contact.name}
          </h2>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-court-fg-muted">
            <span
              className={
                "rounded-sm px-1 py-0.5 text-[10px] uppercase tracking-wider " +
                (detail.contact.kind === "unknown"
                  ? "bg-court-surface-subtle text-court-fg-muted"
                  : "bg-court-surface-subtle")
              }
            >
              {detail.contact.kind}
            </span>
            {detail.contact.phoneNumber && (
              <span>{detail.contact.phoneNumber}</span>
            )}
          </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Text button removed — the inline composer at the bottom of
              this pane is the same surface, so a separate header
              button would just be a redundant entry point. Call hands
              off to the Quo Desktop app via tel: (matches click-to-
              call from candidate / client profiles) since OpenPhone's
              public API has no outbound-call endpoint. */}
          <CallInQuoButton phoneNumber={detail.contact.phoneNumber} />
          <OpenInQuoButton phoneNumber={detail.contact.phoneNumber} />
          {detail.contact.kind === "unknown" ? (
            <AddToAceButton phoneNumber={detail.contact.phoneNumber} />
          ) : (
            <OpenProfileButton match={profileMatch} />
          )}
          {onMarkRead ? (
            <button
              type="button"
              onClick={onMarkRead}
              disabled={!hasUnread}
              title={hasUnread ? "Mark as read" : "Already read"}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:bg-court-surface-subtle hover:text-court-fg disabled:cursor-default disabled:opacity-50 disabled:hover:bg-court-surface disabled:hover:text-court-fg-muted"
            >
              <CheckCheck className="h-3 w-3" />
              <span className="hidden sm:inline">Mark as read</span>
            </button>
          ) : null}
        </div>
      </div>
      {/* Thread body */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {detail.entries.length === 0 ? (
          <div className="py-12 text-center text-sm text-court-fg-muted">
            No history yet.
          </div>
        ) : (
          <ul className="flex flex-col">
            {detail.entries.flatMap((e, i) => {
              const prev = i > 0 ? detail.entries[i - 1] : null;
              const sameDay = prev ? isSameDay(prev.createdAt, e.createdAt) : false;
              const sameSenderAsPrev =
                !!prev &&
                prev.kind === "sms" &&
                e.kind === "sms" &&
                prev.direction === e.direction;
              const showDateSep = !sameDay;
              const compact = sameDay && sameSenderAsPrev;
              const itemMargin = showDateSep
                ? "mt-3"
                : i === 0
                  ? ""
                  : compact
                    ? "mt-1"
                    : "mt-3";

              const nodes: React.ReactNode[] = [];

              if (showDateSep) {
                nodes.push(
                  <li
                    key={`sep-${e.id}`}
                    className={"flex justify-center " + (i > 0 ? "mt-3" : "")}
                  >
                    <span className="rounded-full bg-court-surface-subtle px-3 py-1 text-xs font-semibold text-court-fg-muted">
                      {formatDateSeparator(e.createdAt)}
                    </span>
                  </li>,
                );
              }

              if (e.kind === "sms") {
                nodes.push(
                  <li
                    key={e.id}
                    className={
                      "flex flex-col " +
                      itemMargin +
                      " " +
                      (e.direction === "outbound" ? "items-end" : "items-start")
                    }
                  >
                    <div
                      className={
                        // font-sans pins the bubble to Inter even when
                        // next/font's CSS var hasn't applied yet on
                        // iOS Safari first paint (otherwise falls back
                        // to system-ui and reads as a different font).
                        "max-w-[75%] rounded-2xl px-4 py-2.5 font-sans text-sm shadow-sm " +
                        (e.direction === "outbound"
                          ? "rounded-br-sm bg-court-brand text-white"
                          : "rounded-bl-sm bg-court-fg/10 text-court-fg")
                      }
                    >
                      {e.mediaUrl && (
                        <button
                          type="button"
                          onClick={() => setLightboxSrc(e.mediaUrl)}
                          className="mb-1 block cursor-zoom-in"
                          title="View image"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={e.mediaUrl}
                            alt="MMS attachment"
                            className="max-h-72 max-w-full rounded-lg object-contain"
                          />
                        </button>
                      )}
                      {e.body && (
                        <div className="whitespace-pre-wrap break-words">{e.body}</div>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-court-fg-muted">
                      {e.direction === "outbound" ? "Sent" : "Received"} ·{" "}
                      {formatTimeOfDay(e.createdAt)}
                    </div>
                  </li>,
                );
              } else {
                nodes.push(
                  <li key={e.id} className={"flex justify-center " + itemMargin}>
                    <div className="inline-flex items-center gap-2 rounded-full border border-court-border bg-court-surface-subtle px-3 py-1.5 text-xs text-court-fg-muted">
                      {callIcon(e)}
                      <span>{formatCallSummary(e)}</span>
                      <span className="text-[10px]">
                        · {new Date(e.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </li>,
                );
              }

              return nodes;
            })}
          </ul>
        )}
        {/* Bottom anchor: the scroll-to-bottom effect targets this so the
            newest message is in view on open and after each send. */}
        <div ref={bottomRef} />
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
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
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
        window.dispatchEvent(
          new CustomEvent<PhoneSmsSentEventDetail>(PHONE_SMS_SENT_EVENT, {
            detail: { candidateId },
          }),
        );
        return;
      }
      setBody("");
      window.dispatchEvent(
        new CustomEvent<PhoneSmsSentEventDetail>(PHONE_SMS_SENT_EVENT, {
          detail: { candidateId },
        }),
      );
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
      <Button
        type="button"
        size="sm"
        onClick={() => void send()}
        disabled={sendDisabled}
        className="shrink-0"
      >
        {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        Send
      </Button>
    </div>
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
      title="Open Profile"
      className="inline-flex items-center gap-1 rounded-md border border-court-brand bg-transparent px-2 py-1 text-[11px] font-medium text-court-brand transition hover:bg-court-brand-tint"
    >
      <UserIcon className="h-3 w-3" />
      <span className="hidden sm:inline">Open Profile</span>
    </Link>
  );
}

// Resolves the Quo conversation deep-link via /api/quo/conversation,
// then opens it in a new tab. Falls back to the inbox URL if the
// lookup misses — the API route handles that branch silently.
// Click-to-call hands off to the Quo Desktop app via tel:. macOS /
// Windows route the URL to whichever app the user has set as the
// default phone handler (Quo Desktop, when installed) — same path
// that already works from candidate / client profile phone links.
function CallInQuoButton({ phoneNumber }: { phoneNumber: string }) {
  const href = telHref(phoneNumber);
  const disabled = !href;
  return (
    <a
      href={href || "#"}
      onClick={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        toast.info("Opening Quo to place call...");
      }}
      aria-disabled={disabled}
      className={
        // Yellow-outlined transparent — every Quo affordance across the
        // app shares this skin so Quo reads as a single brand pill
        // wherever it appears (sidebar SMS composer, /phone thread
        // header, etc.). Sized to match the Send / action-row chips
        // beside it.
        "inline-flex items-center gap-1.5 rounded-md border border-yellow-400 bg-transparent px-3 py-1.5 text-xs font-semibold text-yellow-600 shadow-sm transition hover:bg-yellow-50 dark:border-yellow-500 dark:text-yellow-400 dark:hover:bg-yellow-900/20" +
        (disabled ? " pointer-events-none opacity-50" : "")
      }
      title="Place call from Quo Desktop"
    >
      <PhoneCall className="h-3 w-3" />
      <span className="hidden sm:inline">Call in Quo</span>
    </a>
  );
}

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
      // Same yellow-outlined transparent skin as CallInQuoButton + the
      // sidebar SMS composer's Quo button. One Quo style across every
      // surface.
      className="inline-flex items-center gap-1.5 rounded-md border border-yellow-400 bg-transparent px-3 py-1.5 text-xs font-semibold text-yellow-600 shadow-sm transition hover:bg-yellow-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-yellow-500 dark:text-yellow-400 dark:hover:bg-yellow-900/20"
      title="Open this conversation in Quo"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
      <span className="hidden sm:inline">Open in Quo</span>
    </button>
  );
}

// "Add to Ace" pop-up shown on unknown-number threads. Two paths only,
// keeping the menu shallow: jump to /candidates/new pre-filled with
// the phone, or jump to /clients to pick the company that owns the
// contact (the client profile already has its own Add Contact form).
// Closing on outside-click + escape is handled by the global click
// handler below — no custom dropdown framework needed.
function AddToAceButton({ phoneNumber }: { phoneNumber: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (e.target instanceof Node && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const phoneParam = encodeURIComponent(phoneNumber || "");
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // Mirrors the Quo button skin (rounded-md, px-3 py-1.5,
        // text-xs, transparent bg, outlined) but in brand green so the
        // thread-header action row reads as a sized + styled set of
        // chips. Add to Ace is the "promote this number" affordance,
        // hence green; Quo stays yellow.
        className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-transparent px-3 py-1.5 text-xs font-semibold text-court-brand shadow-sm transition hover:bg-court-brand/10"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add this number to Ace"
      >
        <UserPlus className="h-3 w-3" />
        <span className="hidden sm:inline">Add to Ace</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-md border border-court-border bg-court-surface shadow-lg"
        >
          <Link
            href={`/candidates/new?phone=${phoneParam}`}
            className="flex items-center gap-2 px-3 py-2 text-xs text-court-fg transition hover:bg-court-accent-tint/40"
            onClick={() => setOpen(false)}
            role="menuitem"
          >
            <UserIcon className="h-3.5 w-3.5 text-court-fg-muted" />
            Add as candidate
          </Link>
          <Link
            href={`/clients?addContactPhone=${phoneParam}`}
            className="flex items-center gap-2 border-t border-court-border px-3 py-2 text-xs text-court-fg transition hover:bg-court-accent-tint/40"
            onClick={() => setOpen(false)}
            role="menuitem"
          >
            <Building2 className="h-3.5 w-3.5 text-court-fg-muted" />
            Add as client contact
          </Link>
        </div>
      )}
    </div>
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

function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function formatDateSeparator(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
}

function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
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
type PeopleSearchHit = {
  key: string;
  name: string;
  phoneNumber: string;
  type: "candidate" | "contact";
  candidateId: string | null;
  tag: string;
};

function NewTextRecipientInput({
  onPick,
}: {
  onPick: (contact: PhoneContact) => void;
}) {
  const [value, setValue] = useState("");
  const [results, setResults] = useState<PeopleSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  // Debounced people-search. Fires on every keystroke ≥1 char so the
  // recruiter can type "lesley" and pick the candidate without ever
  // typing the number. Searches both Candidate + Contact by
  // name / phone / email.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 1) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/phone/people-search?q=${encodeURIComponent(q)}`,
            { cache: "no-store" },
          );
          if (!res.ok) return;
          const body = (await res.json().catch(() => null)) as
            | { people?: PeopleSearchHit[] }
            | null;
          if (!cancelled) setResults(body?.people ?? []);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [value]);

  function pickHit(hit: PeopleSearchHit) {
    setHint(null);
    onPick({
      candidateId: hit.candidateId,
      name: hit.name,
      phoneNumber: hit.phoneNumber,
      // PhoneContact.tag is the narrow chip set ("Candidate" | "Client"
      // | null); map the rich people-search label down to one of those.
      tag: hit.type === "candidate" ? "Candidate" : "Client",
    });
  }

  async function commitRaw() {
    const raw = value.trim();
    if (!raw) return;
    const digits = raw.replace(/\D/g, "");
    setHint(null);
    if (digits.length < 7) {
      setHint("Type a name or phone number to find someone.");
      return;
    }
    // Free-typed phone number that didn't match a candidate-by-name
    // search above: resolve against the Candidate phone column and
    // fall through to ad-hoc when nothing matches. /api/sms accepts
    // null candidateId, so the recruiter can still text the number.
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
      setHint("Texting a number not yet in Ace. That's fine, the message still sends.");
      onPick({
        candidateId: null,
        name: raw,
        phoneNumber: raw,
        tag: null,
      });
    } finally {
      setResolving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter picks the first result if present; otherwise it falls
      // through to the raw-phone commit path so a fully-typed number
      // still sends without ceremony.
      if (results.length > 0) {
        pickHit(results[0]);
      } else {
        void commitRaw();
      }
    }
  }

  return (
    <div className="space-y-1">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search by name or phone…"
        autoFocus
        className="h-9 w-full rounded-md border border-court-border bg-court-surface px-3 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {results.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded-md border border-court-border bg-court-surface shadow-sm">
          {results.map((hit) => (
            <li key={hit.key}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickHit(hit)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-court-fg hover:bg-court-brand-tint"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{hit.name}</span>
                  <span className="block truncate text-[11px] text-court-fg-muted">
                    {hit.phoneNumber}
                  </span>
                </span>
                <span className="shrink-0 rounded-sm bg-court-surface-subtle px-1 py-0.5 text-[10px] uppercase tracking-wider text-court-fg-muted">
                  {hit.tag}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(searching || resolving) && (
        <div className="px-1 text-[11px] text-court-fg-muted">
          {resolving ? "Looking up contact…" : "Searching…"}
        </div>
      )}
      {hint && !searching && !resolving && (
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

  // Allow sending to unknown numbers — the recipient may be a brand-
  // new lead the recruiter hasn't added to Ace yet. /api/sms accepts
  // null candidateId; the row is still saved + the Quo dispatch still
  // fires. (Earlier the disabled check required a candidateId, which
  // was the bug behind "send doesn't fire" from the dialer's new-
  // conversation flow.)
  const sendDisabled =
    sending ||
    success ||
    !recipient ||
    !recipient.phoneNumber ||
    body.trim().length === 0;

  async function onSend() {
    if (sendDisabled || !recipient) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: recipient.candidateId ?? null,
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
        const detail = json?.providerError ? `: ${json.providerError}` : "";
        setError(`Saved, but Quo reported send failed${detail}`);
        // Still broadcast — the failed row landed in Neon and any open
        // thread for this candidate should surface it (red bubble +
        // "failed" footer) so the recruiter sees what tried to go out.
        window.dispatchEvent(
          new CustomEvent<PhoneSmsSentEventDetail>(PHONE_SMS_SENT_EVENT, {
            detail: { candidateId: recipient.candidateId ?? null },
          }),
        );
        return;
      }
      setSuccess(true);
      window.dispatchEvent(
        new CustomEvent<PhoneSmsSentEventDetail>(PHONE_SMS_SENT_EVENT, {
          detail: { candidateId: recipient.candidateId ?? null },
        }),
      );
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
        <Button
          type="button"
          size="sm"
          onClick={onSend}
          disabled={sendDisabled}
        >
          {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Send text
        </Button>
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

  // OpenPhone's public API doesn't expose outbound call initiation —
  // POST /v1/calls returns 404 because there is no such endpoint. We
  // hand off to the Quo Desktop app via the tel: URL scheme, which
  // macOS / Windows route to whichever app the user has set as their
  // default phone handler (Quo Desktop, when installed). That mirrors
  // the click-to-call path on candidate / client profiles, where
  // dialing from a tel: link opens the Quo app pre-filled with the
  // number — no browser tab in between.
  function placeCall() {
    if (!contact?.phoneNumber) return;
    const href = telHref(contact.phoneNumber);
    if (!href) return;
    toast.info("Opening Quo to place call...");
    window.location.href = href;
    onClose();
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
        <Button
          type="button"
          variant="primary"
          onClick={placeCall}
          disabled={!contact}
          className="h-10 w-auto rounded-md bg-court-brand text-white hover:bg-court-brand-dark"
        >
          <PhoneCall className="h-4 w-4" />
          Call in Quo
        </Button>
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
