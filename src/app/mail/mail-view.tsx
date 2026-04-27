"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderInput,
  Loader2,
  Mail as MailIcon,
  Maximize2,
  Reply,
  Send,
  X,
} from "lucide-react";
import { useMailContext } from "@/lib/mail-context";
import { useFloatingThread } from "@/lib/floating-thread-context";
import { MessageBlock } from "@/components/mail/message-block";
import { toast } from "sonner";
import type { MailListThread, MailThreadDetail, MailThreadMessage } from "@/lib/gmail";
import type { ActiveTemplateSummary } from "@/app/email/actions";
import { MailComposer } from "@/app/mail/mail-composer";

// Two-pane Mail Tab layout. The server fetched the thread list; the
// client manages selection + loads each thread's detail on demand.
// Selection is kept in component state, not the URL — the Mail Tab
// behaves like a native mail client, not a deep-link surface.
export function MailView({
  threads: initialThreads,
  currentUserEmail,
  templates,
  currentUserFirstName,
  currentUserFullName,
}: {
  threads: MailListThread[];
  currentUserEmail: string;
  templates: ActiveTemplateSummary[];
  currentUserFirstName: string;
  currentUserFullName: string;
}) {
  const [threads, setThreads] = useState<MailListThread[]>(initialThreads);
  useEffect(() => setThreads(initialThreads), [initialThreads]);
  const [selected, setSelected] = useState<string | null>(initialThreads[0]?.id ?? null);
  const [detail, setDetail] = useState<MailThreadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // composerOpen state used to live here. Phase 8 refactor: moved
  // INSIDE ThreadDetail so the same component can host its own
  // reply composer whether rendered inline in /mail or inside the
  // popped-out FloatingThreadWindow.
  const [archiving, setArchiving] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  // Bulk-selection set: thread IDs the user has checkbox-ticked.
  // Stays a Set so add/remove is cheap and Set identity changes
  // trigger re-renders only when the contents actually change.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // If a server refresh swaps the threads list, drop any selected IDs
  // that are no longer visible — otherwise the toolbar would claim
  // "3 selected" with phantom IDs.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(threads.map((t) => t.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [threads]);

  const toggleSelectedId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelectedIds = useCallback(() => setSelectedIds(new Set()), []);
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === threads.length && threads.length > 0
        ? new Set()
        : new Set(threads.map((t) => t.id)),
    );
  }, [threads]);
  const allSelected = threads.length > 0 && selectedIds.size === threads.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < threads.length;
  // Session-cached Gmail labels (system + user) for the Move To
  // dropdown AND the sidebar tree. null = not yet loaded; [] = loaded
  // and empty. Fetched once on mount and never refetched — labels
  // rarely change mid-session and both consumers tolerate eventual
  // consistency.
  const [labels, setLabels] = useState<
    Array<{ id: string; name: string; type?: string; messagesTotal?: number }> | null
  >(null);

  // Currently selected sidebar item. null = Inbox (default). Setting
  // this to a user label triggers a refetch of the thread list scoped
  // to that label.
  const [selectedLabel, setSelectedLabel] = useState<{ id: string; name: string } | null>(null);
  const [threadsLoading, setThreadsLoading] = useState(false);
  // Set of user-label full-path names (e.g. "Done Deals") whose child
  // tree the user has collapsed. Default empty = all parents expanded.
  // Persisted to localStorage so the recruiter's preferred collapsed
  // state survives navigation away from /mail and back.
  const [collapsedLabels, setCollapsedLabels] = useState<Set<string>>(() => new Set());
  const isFirstCollapsedLoad = useRef(true);
  useEffect(() => {
    // First commit: hydrate from localStorage and bail without writing.
    // The hydrate's setCollapsedLabels triggers a re-render that re-runs
    // this effect with isFirstCollapsedLoad already false, which then
    // performs the no-op write of the same value back to storage. Doing
    // both jobs in one effect avoids the two-effect race where a
    // separate persist effect would clobber the saved state with the
    // initial empty Set before the hydrate's queued update lands.
    if (isFirstCollapsedLoad.current) {
      isFirstCollapsedLoad.current = false;
      try {
        const raw = window.localStorage.getItem("ace-mail-collapsed-labels");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setCollapsedLabels(
              new Set(parsed.filter((s): s is string => typeof s === "string")),
            );
          }
        }
      } catch {
        // Corrupt or unreadable storage — leave the Set empty.
      }
      return;
    }
    try {
      window.localStorage.setItem(
        "ace-mail-collapsed-labels",
        JSON.stringify(Array.from(collapsedLabels)),
      );
    } catch {
      // Quota / private-mode errors are non-fatal here.
    }
  }, [collapsedLabels]);

  // Move To dropdown only wants user labels — system labels (INBOX,
  // CATEGORY_*, etc.) have no business as move targets. Sidebar feeds
  // off the same source but builds a tree internally.
  const userLabels = useMemo(
    () =>
      labels === null
        ? null
        : labels
            .filter((l) => l.type === undefined || l.type === "user")
            .map((l) => ({ id: l.id, name: l.name })),
    [labels],
  );
  const labelTree = useMemo(() => (labels ? buildLabelTree(labels) : []), [labels]);
  // Flat list of every parent (has-children) node path, for the
  // Collapse all / Expand all toggle below the Inbox card.
  const parentLabelPaths = useMemo(() => {
    const out: string[] = [];
    const walk = (n: LabelNode) => {
      if (n.children.length > 0) out.push(n.name);
      n.children.forEach(walk);
    };
    labelTree.forEach(walk);
    return out;
  }, [labelTree]);
  const allLabelsCollapsed =
    parentLabelPaths.length > 0 && parentLabelPaths.every((p) => collapsedLabels.has(p));

  // Unread inbox count drives the white pill on the premium Inbox card.
  // Same source as the main sidebar's Mail badge — kept in lockstep via
  // the shared MailContext provider in AppShell.
  const { unreadCount } = useMailContext();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/mail/labels", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as
          | { labels?: Array<{ id: string; name: string; type?: string; messagesTotal?: number }> }
          | null;
        if (!cancelled && body?.labels) setLabels(body.labels);
      } catch {
        // Silent: Move To button stays disabled if labels never load.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsedLabels((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Refetch the thread list when the sidebar selection changes. First
  // render is skipped — initialThreads is already INBOX-scoped from the
  // server. Aborts in-flight fetches when the user clicks again before
  // the previous one resolves.
  const isFirstSidebarSelection = useRef(true);
  useEffect(() => {
    if (isFirstSidebarSelection.current) {
      isFirstSidebarSelection.current = false;
      return;
    }
    const ac = new AbortController();
    setThreadsLoading(true);
    setSelected(null);
    setDetail(null);
    void (async () => {
      try {
        const params = new URLSearchParams();
        params.set("labelIds", selectedLabel ? selectedLabel.id : "INBOX");
        const res = await fetch(`/api/mail/threads?${params.toString()}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (!res.ok) {
          toast.error("Couldn't load threads", {
            description: `HTTP ${res.status}`,
          });
          return;
        }
        const body = (await res.json().catch(() => null)) as
          | { threads?: MailListThread[] }
          | null;
        if (body?.threads) setThreads(body.threads);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        toast.error("Couldn't load threads", {
          description: e instanceof Error ? e.message : "unknown error",
        });
      } finally {
        setThreadsLoading(false);
      }
    })();
    return () => ac.abort();
  }, [selectedLabel]);

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
      // Ace 22.0: mirror the in-Ace open event back to Gmail by
      // dropping the UNREAD label. Fire-and-forget — a failure here
      // must NOT block thread rendering or surface to the user. The
      // local list flip (unread → false) is independent of the
      // network call so the bold-row UI clears immediately.
      setThreads((prev) =>
        prev.map((t) => (t.id === id && t.unread ? { ...t, unread: false } : t)),
      );
      void fetch(`/api/mail/threads/${encodeURIComponent(id)}/read`, {
        method: "POST",
        signal,
      }).catch((err: unknown) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        // eslint-disable-next-line no-console
        console.warn("[mail] markThreadRead failed", err);
      });
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
      return;
    }
    const ac = new AbortController();
    void loadThread(selected, ac.signal);
    return () => ac.abort();
  }, [selected, loadThread]);

  async function moveThread(id: string, labelId: string, labelName: string) {
    setMoving(id);
    try {
      const res = await fetch(`/api/mail/threads/${encodeURIComponent(id)}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Failed to move thread", {
          description: body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (selected === id) {
        setSelected(null);
        setDetail(null);
      }
      toast.success(`Moved to ${labelName}`);
    } catch (e) {
      toast.error("Failed to move thread", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    } finally {
      setMoving(null);
    }
  }

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

  // Bulk versions of archive / move. Sequential with a 150ms gap
  // between Gmail calls — large bulk runs (8+ threads) were silently
  // dropping under the previous tight loop, almost certainly tripping
  // Gmail's per-user rate limit on threads.modify. The pause keeps us
  // comfortably under the per-second quota without making small bulks
  // feel sluggish.
  //
  // List + selection are pruned per success (not batched at the end)
  // so threads visibly disappear one-by-one as they land — gives the
  // user immediate feedback on which ids made it through if a later
  // call fails.
  async function bulkArchive() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const result = await runBulk(ids, async (id) => {
      const res = await fetch(`/api/mail/threads/${encodeURIComponent(id)}/archive`, {
        method: "POST",
      });
      return res.ok;
    });
    summarizeBulkResult(result, "Archived");
    setBulkBusy(false);
  }

  async function bulkMove(labelId: string, labelName: string) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const result = await runBulk(ids, async (id) => {
      const res = await fetch(`/api/mail/threads/${encodeURIComponent(id)}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelId }),
      });
      return res.ok;
    });
    summarizeBulkResult(result, "Moved", labelName);
    setBulkBusy(false);
  }

  async function runBulk(
    ids: string[],
    callOne: (id: string) => Promise<boolean>,
  ): Promise<{ succeeded: string[]; failed: string[] }> {
    const succeeded: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      let ok = false;
      try {
        ok = await callOne(id);
      } catch {
        ok = false;
      }
      if (ok) {
        succeeded.push(id);
        // Per-success pruning so the list visibly shrinks as the bulk
        // run progresses. If selected thread was in the bulk, drop
        // the right-pane state too.
        setThreads((prev) => prev.filter((t) => t.id !== id));
        setSelectedIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        if (selected === id) {
          setSelected(null);
          setDetail(null);
        }
      } else {
        failed.push(id);
      }
      // Don't sleep after the final call — the user already has the
      // toast in flight at that point.
      if (i < ids.length - 1) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    return { succeeded, failed };
  }

  function summarizeBulkResult(
    result: { succeeded: string[]; failed: string[] },
    verb: "Archived" | "Moved",
    labelName?: string,
  ) {
    const { succeeded, failed } = result;
    const noun = (n: number) => `${n} ${n === 1 ? "thread" : "threads"}`;
    const total = succeeded.length + failed.length;
    const target = labelName ? ` to ${labelName}` : "";
    if (failed.length === 0) {
      toast.success(`${verb} ${noun(succeeded.length)}${target}`);
    } else if (succeeded.length === 0) {
      toast.error(`Couldn't ${verb.toLowerCase().replace(/d$/, "")} ${noun(failed.length)}`);
    } else {
      toast.error(`${verb} ${succeeded.length} of ${total}${target}`, {
        description: `${failed.length} failed`,
      });
    }
  }

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selected) ?? null,
    [threads, selected],
  );

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
      <aside className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-2">
        <nav className="p-2 text-sm">
          {/* Premium Inbox card — the visual anchor of the sidebar.
              Uses literal hex colors per the redesign spec; matches the
              brand-tint / brand / brand-dark token palette but is locked
              to the Hard Court palette in all three Court Modes. */}
          <button
            type="button"
            onClick={() => setSelectedLabel(null)}
            className="group flex w-full items-center gap-3 rounded-2xl border-2 border-[#5A9642] bg-[#EAF4E4] px-5 py-4 text-left shadow-sm transition hover:border-[#3F7030]"
          >
            <MailIcon className="h-6 w-6 shrink-0 text-[#5A9642]" />
            <span className="flex-1 font-bold text-[#3F7030]">Inbox</span>
            {unreadCount > 0 && (
              <span className="inline-flex min-w-[28px] items-center justify-center rounded-full bg-white px-2 py-0.5 text-xs font-bold text-[#3F7030]">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          {parentLabelPaths.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setCollapsedLabels(allLabelsCollapsed ? new Set() : new Set(parentLabelPaths))
              }
              className="mt-2 inline-flex items-center gap-1 rounded-md px-3 py-1 text-[11px] font-medium text-court-fg-muted transition hover:bg-slate-50 hover:text-court-fg"
            >
              {allLabelsCollapsed ? (
                <ChevronRight className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {allLabelsCollapsed ? "Expand all" : "Collapse all"}
            </button>
          )}

          {/* Sent + Drafts shortcuts to Gmail's system labels. Same
              selection plumbing as user labels — Gmail accepts "SENT"
              and "DRAFT" as labelIds. */}
          <ul className="mt-2 space-y-0.5">
            <li>
              <button
                type="button"
                onClick={() => setSelectedLabel({ id: "SENT", name: "Sent" })}
                className={
                  "flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition " +
                  (selectedLabel?.id === "SENT"
                    ? "bg-[#EAF4E4] text-[#3F7030]"
                    : "text-court-fg hover:bg-slate-50")
                }
              >
                <Send className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">Sent</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => setSelectedLabel({ id: "DRAFT", name: "Drafts" })}
                className={
                  "flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition " +
                  (selectedLabel?.id === "DRAFT"
                    ? "bg-[#EAF4E4] text-[#3F7030]"
                    : "text-court-fg hover:bg-slate-50")
                }
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">Drafts</span>
              </button>
            </li>
          </ul>

          {labelTree.length > 0 && (
            <>
              <div className="my-3 border-t border-court-border" />
              <div className="px-3 text-[11px] uppercase tracking-wider text-court-fg-muted">
                Labels
              </div>
              <ul className="mt-1 space-y-0.5">
                {labelTree.map((node) => (
                  <LabelTreeNode
                    key={node.name}
                    node={node}
                    depth={0}
                    collapsed={collapsedLabels}
                    onToggleCollapse={toggleCollapsed}
                    selectedLabel={selectedLabel}
                    onSelect={setSelectedLabel}
                  />
                ))}
              </ul>
            </>
          )}
        </nav>
      </aside>

      <aside className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-3">
        <div className="flex items-center gap-2 border-b border-court-border bg-court-surface-subtle/60 px-4 py-2 text-[11px] uppercase tracking-wider text-court-fg-muted">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={toggleSelectAll}
            disabled={threads.length === 0}
            aria-label="Select all threads"
            className="h-3.5 w-3.5 cursor-pointer rounded border-court-border accent-brand-dark disabled:cursor-not-allowed"
          />
          <span>
            {threads.length} {threads.length === 1 ? "thread" : "threads"}
          </span>
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 border-b border-court-border bg-court-accent-tint/40 px-3 py-2">
            <span className="text-[11px] font-medium text-court-fg">
              {selectedIds.size} selected
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <MoveToMenu
                labels={userLabels}
                busy={bulkBusy}
                onPick={(labelId, labelName) => bulkMove(labelId, labelName)}
                buttonContent={
                  <>
                    {bulkBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <FolderInput className="h-3 w-3" />
                    )}
                    Move To
                  </>
                }
              />
              <button
                type="button"
                onClick={bulkArchive}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
              >
                {bulkBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Archive className="h-3 w-3" />
                )}
                Archive
              </button>
              <button
                type="button"
                onClick={clearSelectedIds}
                disabled={bulkBusy}
                aria-label="Clear selection"
                className="inline-flex items-center rounded-md border border-court-border bg-court-surface p-1 text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
        {threadsLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading threads…
          </div>
        ) : threads.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-court-fg-muted">
            {selectedLabel ? `No threads in "${selectedLabel.name}".` : "Inbox is empty."}
          </div>
        ) : (
          <ul className="max-h-[calc(100vh-240px)] divide-y divide-court-border overflow-y-auto">
            {threads.map((t) => (
              <li key={t.id}>
                <ThreadRow
                  thread={t}
                  selected={selected === t.id}
                  archiving={archiving === t.id}
                  checked={selectedIds.has(t.id)}
                  anySelected={selectedIds.size > 0}
                  onOpen={() => setSelected(t.id)}
                  onArchive={() => archiveThread(t.id)}
                  onToggle={() => toggleSelectedId(t.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-7">
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
            archiving={archiving === detail.id}
            moving={moving === detail.id}
            labels={userLabels}
            currentUserEmail={currentUserEmail}
            currentUserFirstName={currentUserFirstName}
            currentUserFullName={currentUserFullName}
            templates={templates}
            onArchive={() => archiveThread(detail.id)}
            onMove={(labelId, labelName) => moveThread(detail.id, labelId, labelName)}
            onSent={() => {
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
  checked,
  anySelected,
  onOpen,
  onArchive,
  onToggle,
}: {
  thread: MailListThread;
  selected: boolean;
  archiving: boolean;
  checked: boolean;
  anySelected: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onToggle: () => void;
}) {
  // Checkbox visibility: hidden until you hover the row, OR pinned
  // visible whenever the row is checked / any row is checked. Keeps
  // the inbox visually clean in zero-selection state but doesn't
  // hide the controls once bulk mode is "on".
  const checkboxVisible = checked || anySelected;
  return (
    <div
      className={
        "group relative flex items-stretch transition " +
        (selected ? "bg-court-accent-tint/60" : "hover:bg-court-accent-tint/30")
      }
    >
      <label
        onClick={(e) => e.stopPropagation()}
        className={
          "flex cursor-pointer items-center pl-3 pr-1 transition " +
          (checkboxVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100")
        }
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select thread: ${t.subject}`}
          className="h-3.5 w-3.5 cursor-pointer rounded border-court-border accent-brand-dark"
        />
      </label>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-3 pl-1 pr-10 text-left"
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

// Shared "Move To" dropdown — used by the single-thread header and the
// bulk toolbar. Click-outside closes the menu. The button itself is
// disabled until labels finish loading and there's at least one user
// label to pick from.
function MoveToMenu({
  labels,
  busy,
  buttonContent,
  onPick,
}: {
  labels: Array<{ id: string; name: string }> | null;
  busy: boolean;
  buttonContent: ReactNode;
  onPick: (labelId: string, labelName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const noLabels = !labels || labels.length === 0;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy || noLabels}
        title={
          !labels
            ? "Loading labels…"
            : labels.length === 0
              ? "No user labels in Gmail"
              : "Move to a Gmail label"
        }
        className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
      >
        {buttonContent}
      </button>
      {open && labels && labels.length > 0 && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-court-border bg-court-surface py-1 shadow-lg">
          {labels.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(l.id, l.name);
              }}
              className="block w-full truncate px-3 py-1.5 text-left text-xs text-court-fg hover:bg-court-accent-tint/40"
            >
              {l.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Shared interface so ThreadDetail can be rendered both inline in
// MailView and inside the popped-out FloatingThreadWindow with the
// same props. composerOpen / onReply / onComposerClose /
// onComposerSent used to live here too — they were folded into
// internal state so each render owns its own composer lifecycle.
export type ThreadDetailProps = {
  detail: MailThreadDetail;
  selectedThread: MailListThread | null;
  archiving: boolean;
  moving: boolean;
  labels: Array<{ id: string; name: string }> | null;
  currentUserEmail: string;
  currentUserFirstName: string;
  currentUserFullName: string;
  templates: ActiveTemplateSummary[];
  onArchive: () => void;
  onMove: (labelId: string, labelName: string) => void;
  // Called after a reply send completes so the parent can refetch the
  // thread to show the just-sent message.
  onSent?: () => void;
  // True when this ThreadDetail is rendered inside the floating
  // window. Hides the redundant subject/message-count header (the
  // floating window's outer header already shows the subject) and
  // hides the Pop-out button. Also drops the inline-only viewport
  // height calc so the component fills the floating frame.
  isFloating?: boolean;
};

export function ThreadDetail({
  detail,
  selectedThread,
  archiving,
  moving,
  labels,
  currentUserEmail,
  currentUserFirstName,
  currentUserFullName,
  templates,
  onArchive,
  onMove,
  onSent,
  isFloating = false,
}: ThreadDetailProps) {
  // Newest-first: show most recent message at the top of the pane so
  // opening a long thread lands directly on "what just happened."
  const orderedMessages = useMemo(() => [...detail.messages].reverse(), [detail.messages]);
  const latest = orderedMessages[0];
  const floatingThread = useFloatingThread();
  const [composerOpen, setComposerOpen] = useState(false);

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
    <div
      className={
        "flex flex-col " + (isFloating ? "h-full" : "h-[calc(100vh-240px)]")
      }
    >
      <div className="flex items-start justify-between gap-3 border-b border-court-border px-5 py-3">
        {!isFloating && (
          <div className="min-w-0">
            <h2 className="truncate font-serif text-base font-semibold text-court-fg">
              {detail.subject}
            </h2>
            <p className="mt-0.5 text-xs text-court-fg-muted">
              {detail.messages.length}{" "}
              {detail.messages.length === 1 ? "message" : "messages"}
            </p>
          </div>
        )}
        <div
          className={
            "flex shrink-0 items-center gap-2 " + (isFloating ? "ml-auto" : "")
          }
        >
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
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
          <MoveToMenu
            labels={labels}
            busy={moving}
            onPick={onMove}
            buttonContent={
              <>
                {moving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <FolderInput className="h-3 w-3" />
                )}
                Move To
              </>
            }
          />
          {!isFloating && (
            <button
              type="button"
              onClick={() =>
                floatingThread.open(detail.id, {
                  labels,
                  templates,
                  currentUserEmail,
                  currentUserFirstName,
                  currentUserFullName,
                })
              }
              aria-label="Pop out thread into a floating window"
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
            >
              <Maximize2 className="h-3 w-3" /> Pop out
            </button>
          )}
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
          templates={templates}
          mergeContext={{
            user: {
              firstName: currentUserFirstName,
              fullName: currentUserFullName,
            },
          }}
          onClose={() => setComposerOpen(false)}
          onSent={() => {
            setComposerOpen(false);
            onSent?.();
          }}
        />
      )}
    </div>
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

// ---- Label hierarchy ----
// Gmail represents nested labels as flat strings joined by "/" — a
// label literally named "Done Deals/TSAAdvet" is shown in the Gmail UI
// as "TSAAdvet" nested under "Done Deals". We build a real tree from
// that flat list and render it with indentation + chevron toggles.
//
// Notes:
//  - System labels (INBOX, CATEGORY_*, etc.) are filtered out — they
//    never use the "/" separator and don't belong in the user-facing
//    "Labels" section.
//  - Gmail's UI normally creates a real label for every parent path
//    segment, but a user can manually delete an intermediate parent
//    while keeping its children. We surface those orphaned parents as
//    synthetic, non-clickable nodes so the tree stays connected.

type LabelNode = {
  // null for synthetic parents (path segment exists in a child's name
  // but isn't itself a real Gmail label). Real labels carry their cuid.
  id: string | null;
  // Full Gmail path, e.g. "Done Deals/TSAAdvet". Stable key for the
  // collapsed-set + React list keys.
  name: string;
  // Last "/"-separated segment for display, e.g. "TSAAdvet".
  shortName: string;
  children: LabelNode[];
};

function buildLabelTree(
  labels: Array<{ id: string; name: string; type?: string }>,
): LabelNode[] {
  const userLabels = labels.filter((l) => l.type === undefined || l.type === "user");
  const nodes = new Map<string, LabelNode>();

  for (const l of userLabels) {
    const segments = l.name.split("/");
    for (let i = 0; i < segments.length; i++) {
      const path = segments.slice(0, i + 1).join("/");
      let node = nodes.get(path);
      if (!node) {
        node = { id: null, name: path, shortName: segments[i], children: [] };
        nodes.set(path, node);
      }
      if (i === segments.length - 1) node.id = l.id;
    }
  }

  nodes.forEach((node, path) => {
    const slash = path.lastIndexOf("/");
    if (slash < 0) return;
    const parent = nodes.get(path.slice(0, slash));
    if (parent) parent.children.push(node);
  });

  const sortRecursive = (list: LabelNode[]) => {
    list.sort((a, b) => a.shortName.localeCompare(b.shortName));
    list.forEach((n) => sortRecursive(n.children));
  };

  const roots: LabelNode[] = [];
  nodes.forEach((node, path) => {
    if (!path.includes("/")) roots.push(node);
  });
  sortRecursive(roots);
  return roots;
}

function LabelTreeNode({
  node,
  depth,
  collapsed,
  onToggleCollapse,
  selectedLabel,
  onSelect,
}: {
  node: LabelNode;
  depth: number;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  selectedLabel: { id: string; name: string } | null;
  onSelect: (next: { id: string; name: string } | null) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.name);
  const active = node.id !== null && selectedLabel?.id === node.id;
  return (
    <li>
      <div
        className="flex min-h-9 items-center gap-0.5"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleCollapse(node.name)}
            className="flex-shrink-0 rounded p-0.5 text-court-fg-muted transition hover:bg-slate-50 hover:text-court-fg"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="inline-block w-[18px] flex-shrink-0" />
        )}
        <button
          type="button"
          onClick={() => {
            if (node.id) onSelect({ id: node.id, name: node.name });
          }}
          disabled={node.id === null}
          className={
            "flex h-9 flex-1 items-center truncate rounded-lg px-3 text-left transition " +
            (active
              ? "bg-[#EAF4E4] text-[#3F7030]"
              : node.id === null
                ? "cursor-default text-court-fg-muted"
                : "text-court-fg hover:bg-slate-50")
          }
          title={node.name}
        >
          {node.shortName}
        </button>
      </div>
      {hasChildren && !isCollapsed && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <LabelTreeNode
              key={child.name}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              selectedLabel={selectedLabel}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
