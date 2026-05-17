"use client";

import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderInput,
  Forward,
  Loader2,
  Mail as MailIcon,
  MoreVertical,
  Pencil,
  Plus,
  SquareArrowOutUpRight,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useMailContext } from "@/lib/mail-context";
import { useFloatingThread } from "@/lib/floating-thread-context";
import { useComposerManager } from "@/lib/composer-manager";
import { MessageBlock } from "@/components/mail/message-block";
import { mailToastIdForThread } from "@/components/mail-notification-toast";
import { toast } from "sonner";
import type { MailListThread, MailThreadDetail, MailThreadMessage } from "@/lib/gmail";
import type { ActiveTemplateSummary } from "@/app/email/actions";
import { MailComposer, type ComposerStateSnapshot } from "@/app/mail/mail-composer";
import { BdReplyPromptBanner } from "@/app/mail/bd-reply-prompt-banner";

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
  const [markingUnread, setMarkingUnread] = useState<string | null>(null);
  // When the loaded thread is a Gmail draft, /mail opens the Ace
  // composer pre-loaded against it instead of rendering ThreadDetail.
  // The composer launches as a non-blocking modal so the recruiter can
  // keep scanning the Drafts list while editing. We clear the selected
  // thread id after the composer opens so a re-click on the same row
  // re-loads and re-opens it (otherwise detail would be cached and the
  // open-on-detail effect wouldn't fire again).
  const composerManagerForDrafts = useComposerManager();
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

  // Search box: `searchInput` mirrors what the user is typing;
  // `searchQuery` is the debounced value the refetch effect actually
  // uses. 300ms timer per the spec.
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
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
  // Lookup the ThreadRow uses to render a chip per user label on a
  // thread. Hashing on user-label ids alone naturally drops Gmail
  // system labels (INBOX, UNREAD, CATEGORY_*, etc.) — those never
  // appear in this map so no per-row filter is needed.
  const userLabelNamesById = useMemo(() => {
    const m = new Map<string, string>();
    if (userLabels) {
      for (const l of userLabels) m.set(l.id, l.name);
    }
    return m;
  }, [userLabels]);
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
  const { unreadCount, refreshUnread, markThreadRead } = useMailContext();
  // Bump this to force the thread-list refetch effect to fire even
  // when selectedLabel + searchQuery haven't changed (Refresh button).
  const [refreshTick, setRefreshTick] = useState(0);

  // Background poll: re-fetch the active label's thread list every
  // 30s so new mail appears without a manual refresh. The existing
  // refetch effect already guards against clearing the open thread
  // when only refreshTick changes (filtersChanged === false), so a
  // tick here updates the list silently without disrupting whatever
  // the recruiter has open. Pauses while the tab is hidden so a
  // backgrounded tab doesn't keep hammering Gmail.
  useEffect(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setRefreshTick((n) => n + 1);
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

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

  // Refetch the thread list when the sidebar selection or search
  // query changes. First render is skipped — initialThreads is
  // already INBOX-scoped from the server. Aborts in-flight fetches
  // when a new keystroke arrives before the previous one resolves.
  const isFirstSidebarSelection = useRef(true);
  // Track previous filter values so a refresh-only trigger
  // (refreshTick bumped) doesn't blow away the currently-open thread.
  // Selection is cleared only when the label or search actually
  // changed — otherwise the user clicked Refresh and we should leave
  // their reading state alone.
  const prevSelectedLabelRef = useRef<typeof selectedLabel>(selectedLabel);
  const prevSearchQueryRef = useRef<string>(searchQuery);
  useEffect(() => {
    if (isFirstSidebarSelection.current) {
      isFirstSidebarSelection.current = false;
      return;
    }
    const filtersChanged =
      prevSelectedLabelRef.current !== selectedLabel ||
      prevSearchQueryRef.current !== searchQuery;
    prevSelectedLabelRef.current = selectedLabel;
    prevSearchQueryRef.current = searchQuery;

    const ac = new AbortController();
    setThreadsLoading(true);
    if (filtersChanged) {
      setSelected(null);
      setDetail(null);
    }
    void (async () => {
      try {
        const params = new URLSearchParams();
        // When searching from the default Inbox view, omit labelIds
        // entirely so Gmail searches across all mail (Sent, Archive,
        // labels, etc.) — not just the inbox. When the user has
        // selected a specific label, keep scoping the search to it.
        // When not searching, default to the active label or Inbox.
        if (searchQuery && selectedLabel === null) {
          // no labelIds — search all mail
        } else {
          params.set("labelIds", selectedLabel ? selectedLabel.id : "INBOX");
        }
        if (searchQuery) params.set("q", searchQuery);
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
  }, [selectedLabel, searchQuery, refreshTick]);

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
      // Optimistically clear the sidebar/topbar unread badge for this
      // thread. Without this the badge waits up to 30s for the next
      // /api/mail/unread poll — the recruiter clicks an email and the
      // counter visibly lags, which is what made notifications feel
      // sticky.
      markThreadRead(id);
      // Dismiss any new-mail toast for this thread now that the user
      // has opened it. Safe to call even when no toast is active —
      // sonner's dismiss is a no-op for unknown ids.
      toast.dismiss(mailToastIdForThread(id));
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
  }, [markThreadRead]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const ac = new AbortController();
    void loadThread(selected, ac.signal);
    return () => ac.abort();
  }, [selected, loadThread]);

  // Draft hand-off: when the loaded thread is a Gmail draft, pop the
  // composer pre-loaded against it instead of rendering ThreadDetail.
  // Pull the draft-flavored message out of the thread (the one whose
  // id matches detail.draftMessageId — that's the message Gmail will
  // overwrite on the next Save Draft). The thread reply chain that
  // came before stays in Gmail untouched; the composer's threadId
  // keeps the new send threaded with it on Send.
  useEffect(() => {
    if (!detail?.draftId || !detail.draftMessageId) return;
    const draftMessage =
      detail.messages.find((m) => m.id === detail.draftMessageId) ??
      detail.messages[detail.messages.length - 1];
    if (!draftMessage) return;
    composerManagerForDrafts.open({
      threadId: detail.messages.length > 1 ? detail.id : undefined,
      defaultTo: draftMessage.to ?? "",
      defaultCc: draftMessage.cc ?? "",
      defaultSubject: draftMessage.subject ?? detail.subject ?? "",
      defaultBody: draftMessage.bodyHtml ?? "",
      defaultDraftId: detail.draftId,
      templates,
      mergeContext: {
        user: {
          firstName: currentUserFirstName,
          fullName: currentUserFullName,
        },
      },
      modalTitle: "Draft",
      nonBlocking: true,
      onSent: () => {
        // Refresh the thread list so the now-sent draft drops out of
        // the Drafts label view.
        setRefreshTick((n) => n + 1);
      },
    });
    // Deselect immediately so re-clicking the same row re-loads and
    // re-opens (detail-based effect needs a fresh detail object).
    setSelected(null);
  }, [
    detail,
    composerManagerForDrafts,
    templates,
    currentUserFirstName,
    currentUserFullName,
  ]);

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

  // Create a brand-new Gmail label without applying it to a thread.
  // Used by the standalone "+ New label" entry at the bottom of the
  // labels sidebar — recruiters frequently want to set up a label
  // ahead of time (e.g. for a new client) before any matching thread
  // arrives. Pushes the created label into local state so it appears
  // in the sidebar tree + Move To dropdown without a full refetch.
  async function createLabelStandalone(name: string) {
    try {
      const res = await fetch("/api/mail/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.label?.id) {
        toast.error("Couldn't create label", {
          description: body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const newLabel = body.label as { id: string; name: string };
      setLabels((prev) =>
        prev
          ? [...prev, { id: newLabel.id, name: newLabel.name, type: "user", messagesTotal: 0 }]
          : prev,
      );
      toast.success(`Created label "${newLabel.name}"`);
    } catch (e) {
      toast.error("Couldn't create label", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    }
  }

  // "+ New label" entry's inline-input state. Mirrors the Move To
  // dropdown's pattern (creating boolean + draft string) so the two
  // create flows feel identical to the recruiter.
  const [sidebarCreating, setSidebarCreating] = useState(false);
  const [sidebarLabelDraft, setSidebarLabelDraft] = useState("");
  const sidebarLabelInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (sidebarCreating) sidebarLabelInputRef.current?.focus();
  }, [sidebarCreating]);

  // Create a brand-new Gmail label and immediately apply it to a single
  // thread. Mirrors moveThread's optimistic list-prune so the thread
  // disappears from the current view (it just left INBOX), and pushes
  // the freshly minted label into local state so the dropdown shows it
  // next time without a full refetch.
  async function createLabelAndApplyToThread(id: string, name: string) {
    setMoving(id);
    try {
      const createRes = await fetch("/api/mail/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const createBody = await createRes.json().catch(() => null);
      if (!createRes.ok || !createBody?.label?.id) {
        toast.error("Couldn't create label", {
          description: createBody?.error ?? `HTTP ${createRes.status}`,
        });
        return;
      }
      const newLabel = createBody.label as { id: string; name: string };
      const moveRes = await fetch(
        `/api/mail/threads/${encodeURIComponent(id)}/move`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labelId: newLabel.id }),
        },
      );
      const moveBody = await moveRes.json().catch(() => null);
      if (!moveRes.ok) {
        toast.error("Label created but couldn't apply it", {
          description: moveBody?.error ?? `HTTP ${moveRes.status}`,
        });
        return;
      }
      setLabels((prev) =>
        prev
          ? [...prev, { id: newLabel.id, name: newLabel.name, type: "user", messagesTotal: 0 }]
          : prev,
      );
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (selected === id) {
        setSelected(null);
        setDetail(null);
      }
      toast.success("Label created and applied.");
    } catch (e) {
      toast.error("Couldn't create label", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    } finally {
      setMoving(null);
    }
  }

  // Rename (or move-via-rename) a Gmail label. Gmail uses "/" inside
  // the label name as the visual hierarchy separator, so passing
  // "Done Deals/TSAAdvet" → "Active Clients/TSAAdvet" both renames AND
  // re-parents the label in one PATCH.
  async function renameLabel(labelId: string, nextName: string) {
    const trimmed = nextName.trim();
    if (!trimmed) {
      toast.error("Label name can't be empty");
      return;
    }
    try {
      const res = await fetch(`/api/mail/labels/${encodeURIComponent(labelId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.label?.id) {
        toast.error("Couldn't rename label", {
          description: body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const updated = body.label as { id: string; name: string };
      setLabels((prev) =>
        prev
          ? prev.map((l) => (l.id === updated.id ? { ...l, name: updated.name } : l))
          : prev,
      );
      // If the recruiter is currently viewing this label, update the
      // selectedLabel name so the page header reads correctly without
      // a refetch.
      setSelectedLabel((s) => (s && s.id === updated.id ? { ...s, name: updated.name } : s));
      toast.success(`Renamed to "${updated.name}"`);
    } catch (e) {
      toast.error("Couldn't rename label", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    }
  }

  // DELETE a Gmail label. Gmail removes the label from every message it
  // was on; messages stay, just lose the label. Bumps the local cache so
  // the sidebar updates without a full refetch.
  async function deleteLabel(labelId: string, labelName: string) {
    const ok = window.confirm(
      `Delete the label "${labelName}"? Messages with this label will lose it but won't be deleted.`,
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/mail/labels/${encodeURIComponent(labelId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error("Couldn't delete label", {
          description: body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setLabels((prev) => (prev ? prev.filter((l) => l.id !== labelId) : prev));
      // Drop selection if we just deleted what was selected.
      setSelectedLabel((s) => (s && s.id === labelId ? null : s));
      toast.success(`Deleted label "${labelName}"`);
    } catch (e) {
      toast.error("Couldn't delete label", {
        description: e instanceof Error ? e.message : "unknown error",
      });
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

  // Re-applies UNREAD to a thread the recruiter has already opened.
  // Use case: "I read it but want it to pop back to bold so I remember
  // to act on it later." Flips the row back to unread, closes the
  // detail pane, and force-refreshes the sidebar badge count so the
  // counter bumps immediately instead of lagging on the 30s poll.
  async function markThreadUnread(id: string) {
    setMarkingUnread(id);
    try {
      const res = await fetch(`/api/mail/threads/${encodeURIComponent(id)}/unread`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Couldn't mark unread", { description: body?.error ?? `HTTP ${res.status}` });
        return;
      }
      setThreads((prev) =>
        prev.map((t) => (t.id === id && !t.unread ? { ...t, unread: true } : t)),
      );
      if (selected === id) {
        setSelected(null);
        setDetail(null);
      }
      void refreshUnread();
      toast.success("Marked unread");
    } catch (e) {
      toast.error("Couldn't mark unread", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    } finally {
      setMarkingUnread(null);
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

  async function bulkMove(labelId: string, labelName: string, explicitIds?: string[]) {
    const ids = explicitIds ?? Array.from(selectedIds);
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

  // Resizable column widths for the lg+ three-pane layout. Defaults
  // mirror the previous lg:col-span-2 / col-span-3 / col-span-7 split
  // (~16% / 25% / 59%) at a typical 1440px viewport. Persisted to
  // localStorage under `ace-mail-column-widths` so the recruiter's
  // chosen widths survive navigation away from /mail and back. Below
  // the lg breakpoint the layout falls back to single-column (the
  // grid-template-columns CSS only applies at lg+ via a media query
  // baked into the inline style).
  const [sidebarWidth, setSidebarWidth] = useState<number>(220);
  const [listWidth, setListWidth] = useState<number>(360);
  const SIDEBAR_MIN = 160;
  const SIDEBAR_MAX = 480;
  const LIST_MIN = 240;
  const LIST_MAX = 720;
  const isFirstColumnLoad = useRef(true);
  useEffect(() => {
    if (isFirstColumnLoad.current) {
      isFirstColumnLoad.current = false;
      try {
        const raw = window.localStorage.getItem("ace-mail-column-widths");
        if (raw) {
          const parsed = JSON.parse(raw) as { sidebar?: number; list?: number };
          if (typeof parsed.sidebar === "number") {
            setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parsed.sidebar)));
          }
          if (typeof parsed.list === "number") {
            setListWidth(Math.max(LIST_MIN, Math.min(LIST_MAX, parsed.list)));
          }
        }
      } catch {
        // Corrupt storage — keep defaults.
      }
      return;
    }
    try {
      window.localStorage.setItem(
        "ace-mail-column-widths",
        JSON.stringify({ sidebar: sidebarWidth, list: listWidth }),
      );
    } catch {
      // Quota / private mode — non-fatal.
    }
  }, [sidebarWidth, listWidth]);

  // Active drag state. `null` when no drag is in flight; otherwise
  // the handle the user grabbed. Stored at the component level so the
  // global mousemove/mouseup listeners installed in the effect can
  // read which handle is being dragged.
  const [dragging, setDragging] = useState<null | "sidebar" | "list">(null);
  const dragStartRef = useRef<{ x: number; sidebar: number; list: number } | null>(null);
  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      if (dragging === "sidebar") {
        const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, start.sidebar + dx));
        setSidebarWidth(next);
      } else {
        const next = Math.max(LIST_MIN, Math.min(LIST_MAX, start.list + dx));
        setListWidth(next);
      }
    }
    function onUp() {
      setDragging(null);
      dragStartRef.current = null;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    // Lock the cursor + disable text selection while dragging so a
    // fast drag doesn't accidentally highlight the thread list.
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);
  const beginDrag = useCallback(
    (which: "sidebar" | "list") => (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = { x: e.clientX, sidebar: sidebarWidth, list: listWidth };
      setDragging(which);
    },
    [sidebarWidth, listWidth],
  );

  // Gmail-style collapse: when a thread is open, compress the list
  // column down to a narrow rail so the conversation gets the bulk of
  // the screen. The recruiter's drag-set width is preserved for when
  // no thread is selected; on open we just clamp it to ≤240 so the
  // conversation pane always lands at majority width.
  const effectiveListWidth = selected ? Math.min(listWidth, 240) : listWidth;

  return (
    <div
      className="ace-mail-grid grid min-h-0 flex-1 grid-cols-1 gap-4 lg:gap-0 lg:overflow-hidden lg:rounded-lg lg:border lg:border-court-border lg:bg-court-surface lg:shadow-sm"
      style={
        {
          // CSS vars consumed by the lg+ media query in the inline
          // <style> below. Setting them as inline custom props lets
          // the grid template react to drag updates without a class
          // swap. Below lg the grid-cols-1 class wins.
          ["--mail-sidebar-w"]: `${sidebarWidth}px`,
          ["--mail-list-w"]: `${effectiveListWidth}px`,
        } as React.CSSProperties
      }
    >
      <style>{`
        @media (min-width: 1024px) {
          .ace-mail-grid {
            grid-template-columns: var(--mail-sidebar-w) 6px var(--mail-list-w) 6px minmax(0, 1fr);
          }
        }
      `}</style>
      <aside className="flex flex-col overflow-hidden border border-court-border-soft bg-court-surface lg:border-0 lg:border-r lg:border-court-border-soft lg:bg-court-surface">
        <nav className="flex-1 overflow-y-auto p-2 text-sm">
          {/* Inbox entry — the visual anchor of the sidebar but
              proportioned to match the Sent / Drafts / label rows
              below it. Earlier this was a chunky border-2/py-4 card
              that dwarfed the rest of the sidebar; user feedback was
              "too thick." Now it's a normal-height nav row with a
              subtle green tint so it still reads as the default
              destination without towering over its siblings. */}
          <button
            type="button"
            onClick={() => setSelectedLabel(null)}
            className="flex h-9 w-full items-center gap-2 rounded-lg bg-court-accent-tint px-3 text-left font-semibold text-court-accent-dark transition hover:bg-court-accent-tint"
          >
            <MailIcon className="h-4 w-4 shrink-0 text-court-accent" />
            <span className="flex-1 text-sm font-semibold text-court-accent-dark">Inbox</span>
            {unreadCount > 0 && (
              <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-court-surface px-1.5 py-0.5 text-[11px] font-bold text-court-accent-dark">
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
                  "flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left transition " +
                  (selectedLabel?.id === "SENT"
                    ? "bg-court-accent-tint font-semibold text-court-accent-dark"
                    : "text-court-fg-muted hover:bg-court-accent-tint/50")
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
                  "flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left transition " +
                  (selectedLabel?.id === "DRAFT"
                    ? "bg-court-accent-tint font-semibold text-court-accent-dark"
                    : "text-court-fg-muted hover:bg-court-accent-tint/50")
                }
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">Drafts</span>
              </button>
            </li>
          </ul>

          {labelTree.length > 0 && (
            <>
              <div className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
                Labels
              </div>
              <ul className="mt-1 space-y-1">
                {labelTree.map((node) => (
                  <LabelTreeNode
                    key={node.name}
                    node={node}
                    depth={0}
                    collapsed={collapsedLabels}
                    onToggleCollapse={toggleCollapsed}
                    selectedLabel={selectedLabel}
                    onSelect={setSelectedLabel}
                    onDropThread={({ threadIds, labelId, labelName }) => {
                      if (threadIds.length === 1) {
                        void moveThread(threadIds[0], labelId, labelName);
                      } else if (threadIds.length > 1) {
                        void bulkMove(labelId, labelName, threadIds);
                      }
                    }}
                    onRenameLabel={renameLabel}
                    onDeleteLabel={deleteLabel}
                    onAddSublabel={(parentName, child) =>
                      createLabelStandalone(`${parentName}/${child}`)
                    }
                  />
                ))}
              </ul>
            </>
          )}
          {/* Standalone "+ New label" entry: creates a Gmail label
              that doesn't get applied to any thread. Recruiters need
              this to set up a client/project label ahead of time. The
              Move To dropdown's "New label…" still exists for the
              create-and-apply-immediately flow. */}
          <div className="mt-2 px-1">
            {sidebarCreating ? (
              <div className="flex items-center gap-1 px-2 py-1.5">
                <input
                  ref={sidebarLabelInputRef}
                  value={sidebarLabelDraft}
                  onChange={(e) => setSidebarLabelDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const name = sidebarLabelDraft.trim();
                      if (!name) return;
                      setSidebarCreating(false);
                      setSidebarLabelDraft("");
                      void createLabelStandalone(name);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setSidebarCreating(false);
                      setSidebarLabelDraft("");
                    }
                  }}
                  placeholder="Label name"
                  className="min-w-0 flex-1 rounded border border-court-border bg-court-surface px-2 py-1 text-xs text-court-fg outline-none focus:border-court-accent"
                />
                <button
                  type="button"
                  onClick={() => {
                    const name = sidebarLabelDraft.trim();
                    if (!name) return;
                    setSidebarCreating(false);
                    setSidebarLabelDraft("");
                    void createLabelStandalone(name);
                  }}
                  disabled={!sidebarLabelDraft.trim()}
                  className="rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSidebarCreating(true)}
                className="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-xs font-medium text-court-fg-muted transition hover:bg-slate-50 hover:text-court-fg"
              >
                <Plus className="h-3.5 w-3.5" />
                New label
              </button>
            )}
          </div>
        </nav>
      </aside>

      {/* Drag handle: sidebar ↔ thread list. Hidden below lg where
          the layout stacks vertically. The 6px wide column in the
          template plus a centered visible 1px line gives a generous
          hit-target without painting a heavy divider. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={beginDrag("sidebar")}
        className={
          "hidden cursor-col-resize select-none items-stretch justify-center lg:flex " +
          (dragging === "sidebar" ? "bg-brand/20" : "hover:bg-brand/10")
        }
      >
        <span className="my-2 w-px self-stretch bg-court-border/70" />
      </div>

      <aside className="flex flex-col overflow-hidden border border-court-border-soft bg-court-surface lg:border-0 lg:border-r lg:border-court-border-soft lg:bg-court-surface">
        <div className="shrink-0 border-b border-court-border-soft bg-court-surface px-3 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search mail (try from:foo@bar.com)"
              aria-label="Search mail"
              className="h-9 w-full rounded-md border border-court-border bg-court-surface pl-9 pr-9 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-b border-court-border-soft bg-court-surface px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
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
          <button
            type="button"
            onClick={() => {
              // Refresh both the visible thread list AND the unread
              // poll so the badge / topbar count reconcile in the
              // same click. Without the refreshUnread call the badge
              // would still wait up to 30s for the polling tick.
              setRefreshTick((n) => n + 1);
              void refreshUnread();
            }}
            disabled={threadsLoading}
            aria-label="Refresh thread list"
            className="ml-auto rounded p-1 text-court-fg-muted transition hover:bg-court-fg/5 hover:text-court-fg disabled:opacity-50"
          >
            <RefreshCw
              className={"h-4 w-4 " + (threadsLoading ? "animate-spin" : "")}
            />
          </button>
        </div>
        {selectedIds.size > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-b border-court-border bg-court-accent-tint/40 px-3 py-2">
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
          <div className="flex flex-1 items-center justify-center gap-2 px-4 py-12 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading threads…
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 overflow-y-auto px-6 py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-court-border bg-court-surface-subtle">
              <MailIcon className="h-4 w-4 text-court-fg-muted" />
            </div>
            <p className="text-sm font-medium text-court-fg">
              {searchQuery
                ? "No matches"
                : selectedLabel
                  ? "No threads here"
                  : "No inbox threads"}
            </p>
            <p className="text-xs text-court-fg-muted">
              {searchQuery
                ? `Nothing matched "${searchQuery}".`
                : selectedLabel
                  ? `Nothing in "${selectedLabel.name}" yet.`
                  : "New messages will appear here."}
            </p>
          </div>
        ) : (
          <ul className="flex-1 divide-y divide-court-border-soft overflow-y-auto">
            {threads.map((t) => (
              <li key={t.id}>
                <ThreadRow
                  thread={t}
                  selected={selected === t.id}
                  archiving={archiving === t.id}
                  checked={selectedIds.has(t.id)}
                  anySelected={selectedIds.size > 0}
                  selectedIds={selectedIds}
                  labelNamesById={userLabelNamesById}
                  onOpen={() => setSelected(t.id)}
                  onArchive={() => archiveThread(t.id)}
                  onToggle={() => toggleSelectedId(t.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Drag handle: thread list ↔ thread detail. Same pattern as
          the sidebar handle above. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize thread list"
        onMouseDown={beginDrag("list")}
        className={
          "hidden cursor-col-resize select-none items-stretch justify-center lg:flex " +
          (dragging === "list" ? "bg-brand/20" : "hover:bg-brand/10")
        }
      >
        <span className="my-2 w-px self-stretch bg-court-border/70" />
      </div>

      <section className="flex min-h-0 flex-col overflow-hidden border border-court-border-soft bg-court-surface lg:border-0 lg:bg-court-surface">
        {!selected ? (
          <EmptyRightPane />
        ) : loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-court-fg-muted">
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
            markingUnread={markingUnread === detail.id}
            labels={userLabels}
            currentUserEmail={currentUserEmail}
            currentUserFirstName={currentUserFirstName}
            currentUserFullName={currentUserFullName}
            templates={templates}
            onArchive={() => archiveThread(detail.id)}
            onMarkUnread={() => markThreadUnread(detail.id)}
            onMove={(labelId, labelName) => moveThread(detail.id, labelId, labelName)}
            onCreateAndApplyLabel={(name) => createLabelAndApplyToThread(detail.id, name)}
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
  selectedIds,
  labelNamesById,
  onOpen,
  onArchive,
  onToggle,
}: {
  thread: MailListThread;
  selected: boolean;
  archiving: boolean;
  checked: boolean;
  anySelected: boolean;
  selectedIds: Set<string>;
  labelNamesById: Map<string, string>;
  onOpen: () => void;
  onArchive: () => void;
  onToggle: () => void;
}) {
  // User labels applied to this thread (system labels naturally drop
  // out — they're not in the lookup map). Empty for unlabeled threads
  // so the chip row collapses without reserving space.
  const userLabelNames = t.labelIds
    .map((id) => labelNamesById.get(id))
    .filter((n): n is string => typeof n === "string");
  // Checkbox visibility: hidden until you hover the row, OR pinned
  // visible whenever the row is checked / any row is checked. Keeps
  // the inbox visually clean in zero-selection state but doesn't
  // hide the controls once bulk mode is "on".
  const checkboxVisible = checked || anySelected;
  const [dragging, setDragging] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        // Drag the full selection if this row is part of it; otherwise
        // just this single thread (without disturbing the existing
        // checkbox selection). Custom MIME keeps file drops and other
        // drag origins from being mistaken for a thread drag.
        const ids =
          selectedIds.has(t.id) && selectedIds.size > 0
            ? Array.from(selectedIds)
            : [t.id];
        e.dataTransfer.setData("application/x-mail-thread-ids", JSON.stringify(ids));
        e.dataTransfer.effectAllowed = "move";
        if (ids.length > 1) {
          // setDragImage needs a real DOM node; render an off-screen
          // pill with the count, then schedule its removal after the
          // browser snapshots it for the drag cursor.
          const ghost = document.createElement("div");
          ghost.textContent = `${ids.length} threads`;
          ghost.style.position = "absolute";
          ghost.style.top = "-1000px";
          ghost.style.left = "-1000px";
          ghost.style.padding = "6px 10px";
          ghost.style.borderRadius = "9999px";
          ghost.style.background = "#5A9642";
          ghost.style.color = "#ffffff";
          ghost.style.fontSize = "12px";
          ghost.style.fontWeight = "600";
          ghost.style.boxShadow = "0 4px 12px rgba(0,0,0,0.18)";
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 20, 20);
          setTimeout(() => {
            document.body.removeChild(ghost);
          }, 0);
        }
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={
        "group relative flex cursor-pointer items-stretch transition " +
        (selected ? "bg-court-accent-tint/40" : "hover:bg-court-accent-tint/50") +
        (dragging ? " opacity-50" : "")
      }
    >
      <div
        aria-hidden={!t.unread}
        className="flex w-3 shrink-0 items-center justify-center pl-1"
      >
        {t.unread ? (
          <span
            aria-label="Unread"
            className="h-2 w-2 rounded-full bg-court-accent"
          />
        ) : null}
      </div>
      <label
        onClick={(e) => e.stopPropagation()}
        className={
          "flex cursor-pointer items-center pl-1 pr-1 transition " +
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
              "truncate text-[13px] text-court-fg " +
              (t.unread ? "font-bold" : "font-normal")
            }
          >
            {t.fromName || t.fromEmail || "(unknown sender)"}
          </span>
          <span className="shrink-0 text-[11px] text-court-fg-muted">
            {formatRelative(t.timestampIso)}
          </span>
        </div>
        <div className="w-full truncate text-[12.5px] font-medium text-court-fg">
          {t.subject}
        </div>
        <div className="w-full truncate text-[11.5px] text-court-fg-muted">{t.snippet}</div>
        {userLabelNames.length > 0 ? (
          <div className="mt-1 flex w-full flex-wrap items-center gap-1">
            {userLabelNames.map((name) => (
              <span
                key={name}
                className="rounded-full bg-court-surface-subtle px-2 py-0.5 text-[10px] text-court-fg-muted"
              >
                {name}
              </span>
            ))}
          </div>
        ) : null}
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
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-court-border bg-court-surface-subtle">
        <MailIcon className="h-5 w-5 text-court-fg-muted" />
      </div>
      <p className="text-sm font-medium text-court-fg">Select a thread to read it.</p>
    </div>
  );
}

// Shared "Move To" dropdown — used by the single-thread header and the
// bulk toolbar. Click-outside closes the menu. The button itself is
// disabled until labels finish loading and there's at least one user
// label to pick from.
//
// Menu is portal-rendered to document.body with fixed coords computed
// from the button's bounding rect — escapes the threads-list column's
// overflow-hidden which used to clip the menu's left edge when long
// label names + the bulk toolbar's offset combined.
export function MoveToMenu({
  labels,
  busy,
  buttonContent,
  onPick,
  onCreateAndApply,
}: {
  labels: Array<{ id: string; name: string }> | null;
  busy: boolean;
  buttonContent: ReactNode;
  onPick: (labelId: string, labelName: string) => void;
  // When provided, renders a "New label…" entry at the bottom of the
  // dropdown that inline-prompts for a name and creates+applies it.
  // Bulk callers can omit this — bulk create-then-apply isn't a common
  // recruiting flow.
  onCreateAndApply?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Menu width in px — used both for inline visual sizing and for
  // computing how far left to anchor the portal'd menu so the right
  // edge still aligns with the button's right edge (mirrors the old
  // `right-0` visual on a relative parent).
  const MENU_WIDTH = 240;

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function reposition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Right-align the menu to the button, but clamp inside the
      // viewport with an 8px margin so labels never get clipped at
      // either edge regardless of where the bulk toolbar sits.
      const desiredLeft = rect.right - MENU_WIDTH;
      const left = Math.max(
        8,
        Math.min(desiredLeft, window.innerWidth - MENU_WIDTH - 8),
      );
      setPos({ top: rect.bottom + 4, left });
    }
    reposition();
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        !wrapRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
        setCreating(false);
        setDraft("");
      }
    }
    function closeMenu() {
      setOpen(false);
      setCreating(false);
      setDraft("");
    }
    function onScroll(e: Event) {
      // Scrolling the label list itself (overflow-y-auto inside the
      // portal) must not close the menu — the user is hunting for a
      // label. Any scroll outside the menu (page, sidebar, thread
      // list) moves the anchor button, so close to avoid a stale
      // position.
      const target = e.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      closeMenu();
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Auto-focus the inline input the moment it appears so the user can
  // start typing immediately — mirrors how Gmail's own native "New
  // label" dropdown behaves.
  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const submitNewLabel = () => {
    const name = draft.trim();
    if (!name || !onCreateAndApply) return;
    setOpen(false);
    setCreating(false);
    setDraft("");
    onCreateAndApply(name);
  };

  const hasLabels = !!labels && labels.length > 0;
  const noLabels = !labels || labels.length === 0;
  // The button is enabled whenever the user can EITHER pick an existing
  // label OR create a new one. Without onCreateAndApply (bulk case), an
  // empty label set still disables the button.
  const buttonDisabled = busy || (noLabels && !onCreateAndApply);
  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={buttonDisabled}
        title={
          !labels
            ? "Loading labels…"
            : labels.length === 0
              ? onCreateAndApply
                ? "Create a Gmail label"
                : "No user labels in Gmail"
              : "Move to a Gmail label"
        }
        className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
      >
        {buttonContent}
      </button>
      {open &&
        pos &&
        (hasLabels || onCreateAndApply) &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: MENU_WIDTH,
              zIndex: 50,
            }}
            className="overflow-hidden rounded-md border border-court-border bg-court-surface shadow-lg"
          >
            {hasLabels && (
              <div className="max-h-72 overflow-y-auto py-1">
                {labels!.map((l) => (
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
            {onCreateAndApply && (
              <div className="border-t border-court-border bg-court-bg/40">
                {creating ? (
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <input
                      ref={inputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submitNewLabel();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setCreating(false);
                          setDraft("");
                        }
                      }}
                      placeholder="Label name"
                      className="min-w-0 flex-1 rounded border border-court-border bg-court-surface px-2 py-1 text-xs text-court-fg outline-none focus:border-court-accent"
                    />
                    <button
                      type="button"
                      onClick={submitNewLabel}
                      disabled={!draft.trim()}
                      className="rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
                    >
                      Create
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-court-fg-muted hover:bg-court-accent-tint/40 hover:text-court-fg"
                  >
                    <Plus className="h-3 w-3" />
                    New label…
                  </button>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

// (ReplyTargetMenu — the "Reply to: latest" picker — was removed in
// Ace 28.0c. Per-message Reply / Reply All / Forward buttons inside
// each older MessageBlock are now the dedicated path for targeting a
// specific message in a long thread; the latest message is always
// addressed by the toolbar's plain Reply button.)

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
  markingUnread: boolean;
  labels: Array<{ id: string; name: string }> | null;
  currentUserEmail: string;
  currentUserFirstName: string;
  currentUserFullName: string;
  templates: ActiveTemplateSummary[];
  onArchive: () => void;
  onMarkUnread: () => void;
  onMove: (labelId: string, labelName: string) => void;
  // Optional: when provided, the Move To dropdown shows a "New label…"
  // option that creates the label in Gmail and applies it to this
  // thread in one click.
  onCreateAndApplyLabel?: (name: string) => void;
  // Called after a reply send completes so the parent can refetch the
  // thread to show the just-sent message.
  onSent?: () => void;
  // True when this ThreadDetail is rendered inside the floating
  // window. Hides the redundant subject/message-count header (the
  // floating window's outer header already shows the subject) and
  // hides the Pop-out button. Also drops the inline-only viewport
  // height calc so the component fills the floating frame.
  isFloating?: boolean;
  // When true (notification toast → popup), render only the latest
  // message instead of the full thread history. Reply / Reply All /
  // Forward still target the latest message; older messages just don't
  // visually clutter the preview.
  previewLatestOnly?: boolean;
  // Controlled-mode props. When provided (FloatingThreadWindow does
  // this so the Reply / Reply All / Forward buttons can live in its
  // own title bar instead of duplicating chrome), composerMode is
  // sourced from the parent and the parent renders the action
  // toolbar — ThreadDetail's own header is hidden.
  composerMode?: null | "reply" | "replyAll" | "forward";
  onComposerModeChange?: (mode: null | "reply" | "replyAll" | "forward") => void;
};

export function ThreadDetail({
  detail,
  selectedThread,
  archiving,
  moving,
  markingUnread,
  labels,
  currentUserEmail,
  currentUserFirstName,
  currentUserFullName,
  templates,
  onArchive,
  onMarkUnread,
  onMove,
  onCreateAndApplyLabel,
  onSent,
  isFloating = false,
  previewLatestOnly = false,
  composerMode: composerModeProp,
  onComposerModeChange,
}: ThreadDetailProps) {
  // Gmail layout: render messages oldest → newest by dateIso so the
  // first message is at the top, the latest sits at the bottom, and
  // the auto-scroll below drops the viewport to the latest on open.
  // Older messages render as one-line collapsed rows above; clicking
  // any expands inline. Messages without a dateIso sort to position
  // 0 so they can't accidentally claim the latest slot.
  const orderedMessages = useMemo(() => {
    return [...detail.messages].sort((a, b) => {
      const ta = a.dateIso ? new Date(a.dateIso).getTime() : 0;
      const tb = b.dateIso ? new Date(b.dateIso).getTime() : 0;
      return ta - tb;
    });
  }, [detail.messages]);
  // True latest = last item in chronological order. Used for reply
  // recipient defaults + Reply-All visibility.
  const latest =
    orderedMessages[orderedMessages.length - 1] ?? undefined;

  // BD reply prompt: the banner shows when (a) the user has a label
  // literally named "BD" applied to this thread and (b) there's at
  // least one external message in the thread (the reply we're
  // prompting about). The component itself defers the config +
  // dismissal + Apollo-enrichment lookups to the server.
  const bdLabelId = useMemo(
    () => labels?.find((l) => l.name === "BD")?.id ?? null,
    [labels],
  );
  const isBdThread =
    bdLabelId !== null && detail.labelIds.includes(bdLabelId);
  const externalReply = useMemo(() => {
    const me = currentUserEmail.trim().toLowerCase();
    for (let i = orderedMessages.length - 1; i >= 0; i--) {
      const m = orderedMessages[i];
      const from = (m.fromEmail || "").trim().toLowerCase();
      if (from && from !== me) return m;
    }
    return null;
  }, [orderedMessages, currentUserEmail]);

  // Gmail-style auto-scroll: land on the TOP of the latest message
  // so the actual reply text ("Morning Jeannie, Appreciate the
  // update here!") is what shows on open — not the signature /
  // quoted history at the BOTTOM of the message body.
  //
  // Earlier attempts used scrollTop = scrollHeight, which dropped
  // the viewport to the absolute bottom of the document = the end
  // of the latest message's body = its signature. Andrew was seeing
  // signature + quoted content and had to scroll UP to find the
  // actual new content.
  //
  // Now: compute the latest message's position relative to the
  // scroll container and set scrollTop so the message's TOP aligns
  // with the container's TOP. useLayoutEffect for synchronous
  // initial scroll, rAF loop for late-loading content shifts,
  // bails on first user scroll.
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);

  const pinLatestToTop = useCallback(() => {
    const c = messagesScrollRef.current;
    const target = document.querySelector(
      '[data-latest-message="true"]',
    ) as HTMLElement | null;
    if (!c || !target) return;
    const containerRect = c.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    c.scrollTop = c.scrollTop + (targetRect.top - containerRect.top);
  }, []);

  useLayoutEffect(() => {
    if (isFloating) return;
    pinLatestToTop();
  }, [detail.id, isFloating, pinLatestToTop]);

  useEffect(() => {
    if (isFloating) return;
    let stopped = false;
    let frame = 0;
    const start = performance.now();
    const tick = () => {
      if (stopped) return;
      pinLatestToTop();
      if (performance.now() - start < 1000) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    const onUserScroll = () => {
      stopped = true;
    };
    document.addEventListener("wheel", onUserScroll, { passive: true });
    document.addEventListener("touchmove", onUserScroll, { passive: true });
    document.addEventListener("keydown", onUserScroll);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      document.removeEventListener("wheel", onUserScroll);
      document.removeEventListener("touchmove", onUserScroll);
      document.removeEventListener("keydown", onUserScroll);
    };
  }, [detail.id, isFloating, pinLatestToTop]);

  const floatingThread = useFloatingThread();
  const composerManager = useComposerManager();
  // Composer mode tracks WHICH button opened the composer so the
  // setup (To, Cc, Subject, body, threadId, modal title) matches the
  // user's intent — Reply / Reply All / Forward each compute their
  // own initial state below. Falls into "controlled" mode when the
  // parent passes composerMode + onComposerModeChange (used by
  // FloatingThreadWindow so its title bar can drive these directly).
  const isControlled = composerModeProp !== undefined;
  const [internalComposerMode, setInternalComposerMode] = useState<
    null | "reply" | "replyAll" | "forward"
  >(null);
  const composerMode = isControlled ? composerModeProp ?? null : internalComposerMode;
  const setComposerMode = useCallback(
    (next: null | "reply" | "replyAll" | "forward") => {
      if (isControlled) {
        onComposerModeChange?.(next);
      } else {
        setInternalComposerMode(next);
      }
    },
    [isControlled, onComposerModeChange],
  );
  const composerOpen = composerMode !== null;

  // Which specific message the recruiter is replying to. Defaults to
  // the latest. Both the toolbar's "Reply to: <sender> ▾" dropdown
  // AND the per-message action buttons inside each MessageBlock
  // header write to this state — picking a target updates the
  // recipient + quoted-body computations below so the toolbar's
  // Reply / Reply All / Forward buttons act on the chosen message.
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  // Defensive reset when switching threads: composerMode + replyTargetId
  // are local component state and ThreadDetail's identity is stable
  // across thread selections (no key prop on the parent). Without this
  // effect, opening thread A → clicking Reply → switching to thread B
  // leaves composerMode stuck on "reply", which hides the per-message
  // action buttons and shows a stale composer over the new thread.
  useEffect(() => {
    setReplyTargetId(null);
    if (!isControlled) setInternalComposerMode(null);
  }, [detail.id, isControlled]);
  const replyTarget = useMemo(() => {
    if (!replyTargetId) return latest;
    return orderedMessages.find((m) => m.id === replyTargetId) ?? latest;
  }, [orderedMessages, replyTargetId, latest]);

  // Reply-recipient logic: the "other party" on the target message.
  // - If I sent the last message, reply to whoever I sent it to.
  // - If someone else sent it, reply to them.
  // Never pre-fill To with my own address. computeReplyRecipients
  // already returns CC for the Reply All case; plain Reply drops it.
  const { defaultTo, defaultCc } = computeReplyRecipients(
    replyTarget,
    selectedThread,
    currentUserEmail,
  );
  const defaultSubject = detail.subject.toLowerCase().startsWith("re:")
    ? detail.subject
    : `Re: ${detail.subject}`;
  const forwardSubject = detail.subject.toLowerCase().startsWith("fwd:")
    ? detail.subject
    : `Fwd: ${detail.subject}`;
  // Forward body: blank line on top so the user can type their note,
  // then a quoted block citing the chosen message's headers + body.
  // Forward auto-focuses the To row (not the body), so the recruiter
  // can type the recipient first.
  const forwardBody = useMemo(
    () => buildForwardQuote(replyTarget),
    [replyTarget],
  );

  // Per-message action handler — fires from the Reply / Reply All /
  // Forward buttons rendered inside each MessageBlock (inline only;
  // suppressed when the thread is floating in a popup window). Captures
  // the chosen message as the reply target before opening the
  // composer so the recipient + quoted-body computations re-run
  // against THAT message instead of the thread's latest.
  const onMessageAction = useCallback(
    (msg: MailThreadMessage, mode: "reply" | "replyAll" | "forward") => {
      setReplyTargetId(msg.id);
      setComposerMode(mode);
    },
    [],
  );

  // True when the message has at least one recipient address (To / Cc)
  // beyond the current user — i.e. Reply All would actually reach
  // someone Reply wouldn't. When false (DM-style: came from one
  // person, addressed only to me), the Reply All button is hidden so
  // the toolbar doesn't offer two visually-distinct actions that
  // produce identical sends.
  const hasMultipleRecipients = useCallback(
    (msg: MailThreadMessage | undefined): boolean => {
      if (!msg) return false;
      const me = currentUserEmail.trim().toLowerCase();
      const all = [
        ...splitAddrHeader(msg.to ?? ""),
        ...splitAddrHeader(msg.cc ?? ""),
      ];
      return all.some(
        (a) => a.email && a.email.toLowerCase() !== me,
      );
    },
    [currentUserEmail],
  );
  const showReplyAllForLatest = hasMultipleRecipients(replyTarget);

  // CC same-company picker: when the To address resolves to a Contact
  // in our CRM, fetch the other Contacts at that Contact's clientId so
  // the CC row can offer a click-to-pick dropdown. Recomputed when the
  // composer opens so a stale selection from a different thread can't
  // leak in.
  const [ccPickerOptions, setCcPickerOptions] = useState<
    Array<{ name: string; email: string }>
  >([]);
  useEffect(() => {
    if (!composerOpen) {
      setCcPickerOptions([]);
      return;
    }
    const toEmail = extractFirstEmail(defaultTo);
    if (!toEmail) {
      setCcPickerOptions([]);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/contacts/cc-suggestions?email=${encodeURIComponent(toEmail)}`,
      { cache: "no-store" },
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { contacts?: Array<{ name: string; email: string }> } | null) => {
        if (!cancelled && body?.contacts) {
          setCcPickerOptions(body.contacts);
        }
      })
      .catch(() => {
        // Silent failure — CC picker just stays empty. The recruiter
        // can still type CC addresses by hand.
      });
    return () => {
      cancelled = true;
    };
  }, [composerOpen, defaultTo]);

  // When the parent controls composerMode (FloatingThreadWindow does,
  // so the action toolbar can live in its own title bar), suppress
  // ThreadDetail's redundant chrome row entirely.
  const renderOwnHeader = !(isFloating && isControlled);

  // Composer node lifted out of JSX so the same instance can render in
  // one of two layout slots: above the messages region (Gmail-style
  // body-first reply, used by FloatingThreadWindow) or below it
  // (legacy inline /mail layout). Computing it once also keeps the
  // textarea / draft state from getting unmounted-and-remounted just
  // because we changed where it sits in the tree.
  // Replying-to hint shown above the composer's To row so the
  // recruiter sees which message they're targeting. Reply / Reply All
  // point at the replyTarget message; Forward starts a new conversation
  // so the hint is suppressed.
  const replyingToHint =
    composerMode === "reply" || composerMode === "replyAll"
      ? {
          senderName:
            replyTarget?.fromName ||
            replyTarget?.fromEmail ||
            "(unknown sender)",
          dateIso: replyTarget?.dateIso ?? null,
        }
      : undefined;
  const composerNode = composerOpen ? (
    <MailComposer
      // Forward starts a new Gmail thread; Reply / Reply All stay
      // in the existing one so Gmail keeps them threaded.
      threadId={composerMode === "forward" ? undefined : detail.id}
      defaultTo={composerMode === "forward" ? "" : defaultTo}
      defaultCc={composerMode === "replyAll" ? defaultCc : ""}
      defaultSubject={
        composerMode === "forward" ? forwardSubject : defaultSubject
      }
      defaultBody={composerMode === "forward" ? forwardBody : ""}
      autoFocusBody={composerMode !== "forward"}
      autoFocusTo={composerMode === "forward"}
      growToFill={isFloating}
      templates={templates}
      ccPickerOptions={ccPickerOptions}
      replyingTo={replyingToHint}
      mergeContext={{
        user: {
          firstName: currentUserFirstName,
          fullName: currentUserFullName,
        },
      }}
      modalTitle={
        composerMode === "forward"
          ? "Forward"
          : composerMode === "replyAll"
            ? "Reply All"
            : "Reply"
      }
      onClose={() => setComposerMode(null)}
      onSent={() => {
        setComposerMode(null);
        onSent?.();
      }}
      onPopOut={(snapshot: ComposerStateSnapshot) => {
        // Fix 4b — re-launch the same draft as a modal composer
        // via the manager. The snapshot carries every field the
        // recruiter edited (including rich-text body HTML and any
        // saved Gmail draft id) so the modal opens pre-filled with
        // exactly what was in the inline pane. We close the inline
        // pane immediately so there's only one composer on screen.
        // nonBlocking matches the thread Pop-out behavior — the
        // user must be able to keep navigating Ace (open another
        // candidate, switch to /phone, etc.) while the popped-out
        // composer floats above. Without this the manager renders
        // a black/40 backdrop that swallows every click on the
        // page underneath.
        const popOutTitle =
          composerMode === "forward"
            ? "Forward"
            : composerMode === "replyAll"
              ? "Reply All"
              : "Reply";
        composerManager.open({
          threadId:
            composerMode === "forward" ? undefined : detail.id,
          defaultTo: snapshot.to,
          defaultCc: snapshot.cc,
          defaultBcc: snapshot.bcc,
          defaultSubject: snapshot.subject,
          defaultBody: snapshot.bodyHtml,
          defaultAttachments: snapshot.attachments,
          defaultDraftId: snapshot.draftId,
          templates,
          nonBlocking: true,
          mergeContext: {
            user: {
              firstName: currentUserFirstName,
              fullName: currentUserFullName,
            },
          },
          modalTitle: popOutTitle,
          replyingTo: replyingToHint,
          onSent: () => onSent?.(),
        });
        setComposerMode(null);
      }}
    />
  ) : null;

  return (
    <div
      className={
        "flex flex-col " + (isFloating ? "h-full" : "h-full")
      }
    >
      {renderOwnHeader && (
      <div
        className={
          "border-b border-court-border px-5 py-3 " +
          (isFloating ? "flex items-center justify-end gap-2" : "flex flex-col gap-2")
        }
      >
        {!isFloating && (
          <div className="min-w-0">
            <h2 className="font-serif text-[20px] font-bold leading-tight text-court-fg break-words">
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
            "flex items-center gap-2 " +
            (isFloating ? "shrink-0" : "flex-wrap justify-end")
          }
        >
          {/* "Reply to: latest" picker removed — the per-message
              Reply / Reply All / Forward buttons rendered inside each
              MessageBlock are the dedicated path for replying to a
              specific older message in a long thread. Top-toolbar
              Reply still defaults to the most recent message. */}
          <button
            type="button"
            onClick={() => setComposerMode("reply")}
            disabled={composerOpen}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-court-border bg-court-surface px-3 text-[12px] font-medium text-court-fg-muted shadow-sm transition hover:border-court-accent/40 hover:text-court-fg disabled:opacity-60"
          >
            <Reply className="h-3 w-3" /> Reply
          </button>
          {/* Reply All only renders when the latest message has at
              least one recipient besides the current user — DMs from
              a single person to only me collapse to "Reply" since
              Reply All would send to the same single recipient and
              read as duplicated chrome. */}
          {showReplyAllForLatest && (
            <button
              type="button"
              onClick={() => setComposerMode("replyAll")}
              disabled={composerOpen}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-court-border bg-court-surface px-3 text-[12px] font-medium text-court-fg-muted shadow-sm transition hover:border-court-accent/40 hover:text-court-fg disabled:opacity-60"
            >
              <ReplyAll className="h-3 w-3" /> Reply All
            </button>
          )}
          <button
            type="button"
            onClick={() => setComposerMode("forward")}
            disabled={composerOpen}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-court-border bg-court-surface px-3 text-[12px] font-medium text-court-fg-muted shadow-sm transition hover:border-court-accent/40 hover:text-court-fg disabled:opacity-60"
          >
            <Forward className="h-3 w-3" /> Forward
          </button>
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-court-border bg-court-surface px-3 text-[12px] font-medium text-court-fg-muted shadow-sm transition hover:border-court-accent/40 hover:text-court-fg disabled:opacity-60"
          >
            {archiving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
            Archive
          </button>
          <button
            type="button"
            onClick={onMarkUnread}
            disabled={markingUnread}
            title="Mark this thread unread"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-court-border bg-court-surface px-3 text-[12px] font-medium text-court-fg-muted shadow-sm transition hover:border-court-accent/40 hover:text-court-fg disabled:opacity-60"
          >
            {markingUnread ? <Loader2 className="h-3 w-3 animate-spin" /> : <MailIcon className="h-3 w-3" />}
            Mark Unread
          </button>
          <MoveToMenu
            labels={labels}
            busy={moving}
            onPick={onMove}
            onCreateAndApply={onCreateAndApplyLabel}
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
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-court-border bg-court-surface px-3 text-[12px] font-medium text-court-fg-muted shadow-sm transition hover:border-court-accent/40 hover:text-court-fg"
            >
              <SquareArrowOutUpRight className="h-3 w-3" /> Pop out
            </button>
          )}
        </div>
      </div>
      )}
      {/* Floating window: Gmail-style body-first layout — composer on
          top, quoted history scrollable below. Inline /mail keeps the
          legacy messages-on-top, composer-on-bottom order so the
          Reply pane stays glued to the bottom of the page like
          before. The composer node is computed once and rendered in
          one of two slots depending on which mode we're in. */}
      {isFloating && composerOpen && composerNode}
      <div
        ref={messagesScrollRef}
        className={
          isFloating && composerOpen
            ? // Quoted-history pane in body-first mode: collapsed to a
              // compact 160px preview — the editor body above is the
              // focal point, recruiter scrolls this pane if they need
              // to re-read context.
              "max-h-40 shrink-0 overflow-y-auto border-t border-court-border bg-court-surface-subtle/40"
            : // min-h-0 forces this flex child to actually constrain
              // to the parent's height so overflow-y-auto kicks in;
              // without it, a long thread can grow the child past the
              // parent and the page scrolls instead, which made the
              // earlier scrollTop = scrollHeight a no-op.
              "min-h-0 flex-1 overflow-y-auto"
        }
      >
        {isBdThread && externalReply && !isFloating && !previewLatestOnly ? (
          <div className="px-4 pt-3">
            <BdReplyPromptBanner
              threadId={detail.id}
              isBd={isBdThread}
              senderName={externalReply.fromName}
              senderEmail={externalReply.fromEmail}
            />
          </div>
        ) : null}
        {(previewLatestOnly && latest ? [latest] : orderedMessages).map((m, i, arr) => {
          // Inline mode: orderedMessages is sorted oldest → newest, so
          // the latest sits at the last index. Floating mode (legacy)
          // doesn't auto-scroll and renders the same order.
          const latestIndex = arr.length - 1;
          const isLatest = i === latestIndex;
          return (
            <div
              key={m.id}
              data-latest-message={
                isLatest && !isFloating ? "true" : undefined
              }
            >
              <MessageBlock
                msg={m}
                isFirst={i === 0}
                isLatest={isLatest}
                // Per-message Reply / Reply All / Forward buttons
                // render ONLY for older messages in a multi-message
                // inline thread. Suppressed when:
                //   - rendered inside FloatingThreadWindow (isFloating) —
                //     popups opened from notifications get one toolbar only
                //   - a composer is already open
                //   - the message is the latest one — the top toolbar
                //     already handles it, so per-message buttons there
                //     are pure duplication. A single-message thread
                //     therefore renders zero per-message buttons (the
                //     only message IS the latest). Older messages in a
                //     chain keep their buttons so the recruiter can
                //     scroll down and reply to a specific earlier
                //     message in the conversation.
                onAction={
                  isFloating || composerOpen || isLatest
                    ? undefined
                    : (mode) => onMessageAction(m, mode)
                }
                // Per-message Reply All only renders when this specific
                // message had multiple recipients — DM-style messages
                // (one sender, only me on To) collapse to Reply so the
                // toolbar doesn't offer two buttons that produce
                // identical sends.
                showReplyAll={hasMultipleRecipients(m)}
              />
            </div>
          );
        })}
      </div>
      {!isFloating && composerOpen && (
        // Mobile sheet: full-screen fixed overlay so the composer
        // isn't clipped at the bottom of the thread on a phone. md+
        // collapses to display:contents so the wrapper disappears
        // from layout and the inline composer renders exactly as
        // before — one composerNode instance, two layout modes.
        <div className="fixed inset-0 z-50 flex flex-col bg-court-surface md:contents">
          {composerNode}
        </div>
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
  // Cc anyone who was on the To OR Cc lines of that inbound message,
  // minus me and minus the sender (who's already in To). Dedupe by
  // lowercased email so the same person can't appear twice if they
  // landed on both To and Cc.
  const to = fromEmail || selectedThread?.fromEmail || "";
  const fromLower = (fromEmail || "").toLowerCase();
  const seen = new Set<string>();
  const ccCombined: string[] = [];
  for (const a of [...toAddresses, ...ccAddresses]) {
    const lower = a.email.toLowerCase();
    if (!lower) continue;
    if (lower === myLower) continue;
    if (lower === fromLower) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    ccCombined.push(a.original);
  }
  return {
    // Belt-and-suspenders guard against still landing on my own email
    // (e.g. a truly self-addressed thread — rare but possible).
    defaultTo: to.toLowerCase() === myLower ? "" : to,
    defaultCc: ccCombined.join(", "),
  };
}

// Picks the first bare email out of a free-form To: string the user
// would type ("Sara Lee <sara@acme.com>, ops@acme.com"). Used to
// resolve "the contact this email is going to" when fetching the
// same-company CC picker options.
function extractFirstEmail(raw: string): string | null {
  const tokens = splitAddrHeader(raw);
  for (const t of tokens) {
    if (t.email && t.email.includes("@")) return t.email;
  }
  return null;
}

// Builds the quoted-original block we drop into the editor body when
// the user picks Forward. Mirrors Gmail's own forward layout: a
// horizontal rule, header (From / Date / Subject / To / optional Cc),
// then the original HTML body indented with a blockquote-like left
// margin. The composer focuses at the start of the document so the
// recruiter types ABOVE this block.
function buildForwardQuote(latest: MailThreadMessage | undefined): string {
  if (!latest) return "<p></p>";
  const fromLine = latest.fromName
    ? `${escapeHtml(latest.fromName)} &lt;${escapeHtml(latest.fromEmail)}&gt;`
    : escapeHtml(latest.fromEmail);
  const date = latest.dateIso ? new Date(latest.dateIso).toLocaleString() : "";
  const headerRows = [
    `<div><strong>From:</strong> ${fromLine}</div>`,
    date ? `<div><strong>Date:</strong> ${escapeHtml(date)}</div>` : "",
    `<div><strong>Subject:</strong> ${escapeHtml(latest.subject)}</div>`,
    latest.to ? `<div><strong>To:</strong> ${escapeHtml(latest.to)}</div>` : "",
    latest.cc ? `<div><strong>Cc:</strong> ${escapeHtml(latest.cc)}</div>` : "",
  ]
    .filter(Boolean)
    .join("");
  // Two leading paragraphs so the cursor (set to "start") has somewhere
  // visible to land before the divider — without this the editor jumps
  // straight into the quoted block.
  return [
    "<p></p>",
    "<p>---------- Forwarded message ----------</p>",
    headerRows,
    "<p></p>",
    `<blockquote>${latest.bodyHtml}</blockquote>`,
  ].join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// True when the message has at least one recipient (To/Cc) besides
// the signed-in user — so a "Reply All" wouldn't just duplicate Reply.
// Exported for FloatingThreadWindow which renders the action toolbar
// in its own title bar.
export function messageHasOtherRecipients(
  msg: MailThreadMessage | undefined,
  currentUserEmail: string,
): boolean {
  if (!msg) return false;
  const me = currentUserEmail.trim().toLowerCase();
  const all = [
    ...splitAddrHeader(msg.to ?? ""),
    ...splitAddrHeader(msg.cc ?? ""),
  ];
  return all.some((a) => a.email && a.email.toLowerCase() !== me);
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
  onDropThread,
  onRenameLabel,
  onDeleteLabel,
  onAddSublabel,
}: {
  node: LabelNode;
  depth: number;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  selectedLabel: { id: string; name: string } | null;
  onSelect: (next: { id: string; name: string } | null) => void;
  // Drag-and-drop sink. Called when one or more thread rows are dropped
  // onto a real (non-synthetic) label. The MIME type the dragger sets
  // is "application/x-mail-thread-ids" (JSON-encoded array of ids).
  onDropThread?: (args: { threadIds: string[]; labelId: string; labelName: string }) => void;
  // Per-label edit affordances. Hover the row → 3-dot button reveals
  // Rename / Add sublabel / Delete. All three skip when the row is a
  // synthetic parent (no node.id).
  onRenameLabel?: (labelId: string, nextName: string) => void | Promise<void>;
  onDeleteLabel?: (labelId: string, labelName: string) => void | Promise<void>;
  onAddSublabel?: (parentName: string, childShortName: string) => void | Promise<void>;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.name);
  const active = node.id !== null && selectedLabel?.id === node.id;
  const [dragOver, setDragOver] = useState(false);
  const droppable = node.id !== null && Boolean(onDropThread);

  // Per-row menu + inline editor state. Renaming uses the full Gmail
  // path (e.g. "Active Clients/Sheehan Brothers") so the recruiter can
  // also re-parent by editing the slash-separated segments.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(node.name);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState("");
  const addInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!menuWrapRef.current) return;
      if (!menuWrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  useEffect(() => {
    if (renameOpen) renameInputRef.current?.focus();
  }, [renameOpen]);
  useEffect(() => {
    if (addOpen) addInputRef.current?.focus();
  }, [addOpen]);

  const editable = node.id !== null && (Boolean(onRenameLabel) || Boolean(onDeleteLabel) || Boolean(onAddSublabel));

  return (
    <li>
      <div
        onDragOver={(e) => {
          if (!droppable) return;
          // preventDefault inside a dragover handler is what tells the
          // browser this element is a valid drop target — without it,
          // drop never fires.
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => {
          if (!droppable) return;
          setDragOver(false);
        }}
        onDrop={(e) => {
          if (!droppable || !node.id) return;
          e.preventDefault();
          setDragOver(false);
          const raw = e.dataTransfer.getData("application/x-mail-thread-ids");
          if (!raw) return;
          let threadIds: string[] = [];
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              threadIds = parsed.filter((x): x is string => typeof x === "string");
            }
          } catch {
            return;
          }
          if (threadIds.length === 0) return;
          onDropThread?.({
            threadIds,
            labelId: node.id,
            labelName: node.name,
          });
        }}
        className={
          "group/label flex min-h-9 items-center gap-0.5 rounded-lg " +
          (dragOver ? "border border-court-accent bg-court-accent-tint" : "")
        }
        style={{ paddingLeft: `${depth * 8}px` }}
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
        {renameOpen ? (
          <input
            ref={renameInputRef}
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const next = renameDraft.trim();
                if (next && next !== node.name && node.id) {
                  void onRenameLabel?.(node.id, next);
                }
                setRenameOpen(false);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setRenameOpen(false);
                setRenameDraft(node.name);
              }
            }}
            onBlur={() => setRenameOpen(false)}
            className="h-7 min-w-0 flex-1 rounded border border-court-border bg-court-surface px-2 text-[13px] text-court-fg outline-none focus:border-court-accent"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              if (node.id) onSelect({ id: node.id, name: node.name });
            }}
            disabled={node.id === null}
            className={
              "flex h-9 flex-1 items-center truncate rounded-lg pl-1 pr-1 text-left text-[13px] font-medium transition " +
              (active
                ? "bg-[#EAF4E4] font-semibold text-[#3F7030]"
                : node.id === null
                  ? // Synthetic parent (no real Gmail label at this
                    // path — exists only because a child label nests
                    // under it, e.g. "Admin/Foo" creates an "Admin"
                    // intermediate node). Keep the same text weight
                    // + color as real labels so the tree reads
                    // uniformly; just drop hover + cursor since
                    // there's no id to filter the inbox by.
                    "cursor-default text-court-fg"
                  : "text-court-fg hover:bg-slate-50")
            }
            title={node.name}
          >
            {node.shortName}
          </button>
        )}
        {editable && !renameOpen && (
          <div ref={menuWrapRef} className="relative flex-shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className="rounded-md p-1 text-court-fg-muted opacity-0 transition group-hover/label:opacity-100 hover:bg-slate-100 hover:text-court-fg focus:opacity-100"
              aria-label={`Edit label ${node.name}`}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-md border border-court-border bg-court-surface shadow-lg"
              >
                {onRenameLabel && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setRenameDraft(node.name);
                      setRenameOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-court-fg hover:bg-slate-50"
                  >
                    <Pencil className="h-3 w-3" /> Rename / move
                  </button>
                )}
                {onAddSublabel && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setAddDraft("");
                      setAddOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-court-fg hover:bg-slate-50"
                  >
                    <Plus className="h-3 w-3" /> Add sublabel
                  </button>
                )}
                {onDeleteLabel && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (node.id) void onDeleteLabel(node.id, node.name);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3 w-3" /> Delete label
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {addOpen && (
        <div
          className="mt-1 flex items-center gap-1 pl-6"
          style={{ paddingLeft: `${(depth + 1) * 8 + 18}px` }}
        >
          <input
            ref={addInputRef}
            value={addDraft}
            onChange={(e) => setAddDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const child = addDraft.trim();
                if (child && onAddSublabel) {
                  void onAddSublabel(node.name, child);
                }
                setAddOpen(false);
                setAddDraft("");
              } else if (e.key === "Escape") {
                e.preventDefault();
                setAddOpen(false);
                setAddDraft("");
              }
            }}
            placeholder="Sublabel name"
            className="h-7 min-w-0 flex-1 rounded border border-court-border bg-court-surface px-2 text-[12px] text-court-fg outline-none focus:border-court-accent"
          />
          <button
            type="button"
            onClick={() => {
              const child = addDraft.trim();
              if (child && onAddSublabel) void onAddSublabel(node.name, child);
              setAddOpen(false);
              setAddDraft("");
            }}
            disabled={!addDraft.trim()}
            className="rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
          >
            Add
          </button>
        </div>
      )}
      {hasChildren && !isCollapsed && (
        <ul className="space-y-1">
          {node.children.map((child) => (
            <LabelTreeNode
              key={child.name}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              selectedLabel={selectedLabel}
              onSelect={onSelect}
              onDropThread={onDropThread}
              onRenameLabel={onRenameLabel}
              onDeleteLabel={onDeleteLabel}
              onAddSublabel={onAddSublabel}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
