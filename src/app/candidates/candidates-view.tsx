"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { Search, Loader2, Settings, X, ListPlus, Send, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination/pagination";
import type { CandidateListSummary } from "@/app/candidates/lists-actions";
import {
  bulkApplyCandidatesToJob,
  bulkAddCandidatesToList,
  bulkAddCandidatesToNewList,
  type BulkPickerJob,
} from "@/app/candidates/bulk-actions";
import { setCandidateNavList } from "@/lib/candidate-nav";
import { DataTableHead, DataTableHeaderCell } from "@/components/ui/data-table";

type Candidate = {
  id: string;
  name: string;
  title: string;
  employer: string;
  location: string;
  updatedAt: string | null;
};

// Phase 5A.3: URL-driven candidates list. Search query AND page number
// both live in the URL (?q=…&page=…) so refresh / back / direct-link
// behavior is correct. The component pushes URL changes through
// router.replace inside startTransition so React shows the existing
// rows while the new page renders server-side. No flicker, no
// debounced server action.
//
// Bulk multi-select: per-row checkbox + select-all checkbox in the
// header. When 1+ are selected a sticky toolbar surfaces with bulk
// Apply-to-Job and Add-to-List buttons. Selection is page-scoped —
// switching pages clears it because the unseen rows would otherwise
// silently leak into the action.
const DEBOUNCE_MS = 300;

export function CandidatesView({
  initialQuery,
  candidates,
  total,
  page,
  pageSize,
  error,
  lists,
  selectedListId,
  bulkJobs,
}: {
  initialQuery: string;
  candidates: Candidate[];
  total: number;
  page: number;
  pageSize: number;
  error: string | null;
  lists: CandidateListSummary[];
  selectedListId: string;
  bulkJobs: BulkPickerJob[];
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedQuery = useRef(initialQuery);

  // Bulk-select state. Uses a Set so add/remove is O(1) and identity
  // changes only when the contents change. Clears whenever the
  // visible candidates set shifts — searching, paging, or list-filter
  // changes all reset the toolbar so the recruiter never acts on
  // selections from a different list.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(candidates.map((c) => c.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [candidates]);

  function toggleId(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleAll(checked: boolean) {
    if (checked) setSelectedIds(new Set(candidates.map((c) => c.id)));
    else setSelectedIds(new Set());
  }

  const allChecked =
    candidates.length > 0 && selectedIds.size === candidates.length;
  const someChecked = selectedIds.size > 0 && !allChecked;
  const selectedCount = selectedIds.size;
  const selectedCandidateIds = useMemo(
    () => Array.from(selectedIds),
    [selectedIds],
  );

  // Stash the ordered candidate-id list every time the visible page
  // shifts so the candidate profile's Prev/Next nav picks up the
  // current filter + page slice. Reads are session-local and cleared
  // when the recruiter closes the tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (selectedListId) params.set("list", selectedListId);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    setCandidateNavList({
      source: "candidates",
      backHref: qs ? `/candidates?${qs}` : "/candidates",
      ids: candidates.map((c) => c.id),
    });
  }, [candidates, q, selectedListId, page]);

  const [bulkOpen, setBulkOpen] = useState<null | "apply" | "list" | "delete">(null);
  const [importOpen, setImportOpen] = useState(false);

  // Build a URL with ?q=, ?list=, ?page= as appropriate. Page param
  // is dropped when 1 (default) so the URL stays clean. Used by
  // search-debounce push, list-filter change, and pagination.
  function buildUrl(opts: { q: string; listId: string; page: number }): string {
    const params = new URLSearchParams();
    if (opts.q.trim()) params.set("q", opts.q.trim());
    if (opts.listId) params.set("list", opts.listId);
    if (opts.page > 1) params.set("page", String(opts.page));
    const qs = params.toString();
    return qs ? `/candidates?${qs}` : "/candidates";
  }

  // When the user types, push the new query to the URL after the
  // debounce. Always reset to page 1 on a search change — keeping the
  // user on page 5 of the old result set after they typed a new query
  // would land them on a confusing slice. Preserves the active list
  // filter so search composes with list selection.
  useEffect(() => {
    if (q === lastPushedQuery.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      lastPushedQuery.current = q;
      const url = buildUrl({ q, listId: selectedListId, page: 1 });
      startTransition(() => router.replace(url));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, router, selectedListId]);

  // Also push the URL if initialQuery changes (e.g., user hit back/
  // forward and the server prop updated). Sync local q to the new
  // initial so we don't immediately re-push.
  useEffect(() => {
    if (initialQuery !== lastPushedQuery.current) {
      lastPushedQuery.current = initialQuery;
      setQ(initialQuery);
    }
  }, [initialQuery]);

  function goToPage(target: number) {
    const url = buildUrl({ q, listId: selectedListId, page: target });
    startTransition(() => {
      router.push(url);
      // Bring the table into view on page change so the user sees the
      // new rows without scrolling back up.
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  function goToList(nextListId: string) {
    // Reset to page 1 on list change — same logic as search.
    const url = buildUrl({ q, listId: nextListId, page: 1 });
    startTransition(() => router.push(url));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border border-court-border bg-court-surface p-3 shadow-sm md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, employer, or title"
            aria-label="Search candidates"
            className="w-full rounded-lg border border-transparent bg-court-surface-subtle py-2 pl-10 pr-10 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:bg-court-surface focus:outline-none"
          />
          {isPending && (
            <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-court-fg-muted" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedListId}
            onChange={(e) => goToList(e.target.value)}
            disabled={isPending}
            aria-label="Filter by list"
            className="rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg outline-none focus:border-court-accent focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
          >
            <option value="">All candidates</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.memberCount})
              </option>
            ))}
          </select>
          <Link
            href="/candidates/lists"
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-[11px] font-medium text-court-fg-muted transition hover:border-brand/40 hover:text-court-fg"
          >
            <Settings className="h-3 w-3" /> Manage lists
          </Link>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-[11px] font-medium text-court-fg-muted transition hover:border-brand/40 hover:text-court-fg"
          >
            <Upload className="h-3 w-3" /> CSV Import
          </button>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-court-accent/40 bg-court-accent-tint px-3 py-2 shadow-sm">
          <div className="flex items-center gap-3 text-xs font-medium text-court-accent-dark">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              aria-label="Clear selection"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-court-accent-dark transition hover:bg-court-surface/50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <span>
              {selectedCount} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBulkOpen("apply")}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm transition hover:bg-amber-200"
            >
              <Send className="h-3 w-3" /> Apply to Job
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen("list")}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
            >
              <ListPlus className="h-3 w-3" /> Add to List
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen("delete")}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
            >
              <Trash2 className="h-3 w-3" /> Delete Selected
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load candidates.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <div
        className={
          "overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm transition " +
          (isPending ? "opacity-60" : "")
        }
      >
        <table className="w-full text-left text-sm">
          <DataTableHead>
            <tr>
              <DataTableHeaderCell className="w-10 px-3">
                <input
                  type="checkbox"
                  aria-label="Select all candidates on this page"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked;
                  }}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    toggleAll(e.target.checked)
                  }
                  className="h-4 w-4 cursor-pointer accent-brand"
                />
              </DataTableHeaderCell>
              <DataTableHeaderCell>Name</DataTableHeaderCell>
              <DataTableHeaderCell>Current Title</DataTableHeaderCell>
              <DataTableHeaderCell>Employer</DataTableHeaderCell>
              <DataTableHeaderCell>Location</DataTableHeaderCell>
              <DataTableHeaderCell align="center">Last Updated</DataTableHeaderCell>
            </tr>
          </DataTableHead>
          <tbody className="divide-y divide-court-border-soft">
            {candidates.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-sm text-court-fg-muted">
                  {q ? "No candidates match your search" : "No candidates"}
                </td>
              </tr>
            )}
            {candidates.map((c) => {
              const checked = selectedIds.has(c.id);
              return (
                <tr
                  key={c.id}
                  className={
                    "cursor-pointer transition " +
                    (checked
                      ? "bg-court-accent-tint/60"
                      : "hover:bg-court-accent-tint/40")
                  }
                  onClick={() => router.push(`/candidates/${c.id}`)}
                >
                  <td
                    className="w-10 px-3 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.name}`}
                      checked={checked}
                      onChange={(e) => toggleId(c.id, e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-brand"
                    />
                  </td>
                  <td className="px-5 py-3 font-medium text-court-fg">
                    <Link
                      href={`/candidates/${c.id}`}
                      className="hover:text-court-accent-dark"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-court-fg-muted">{c.title || "—"}</td>
                  <td className="px-5 py-3 text-court-fg-muted">{c.employer || "—"}</td>
                  <td className="px-5 py-3 text-court-fg-muted">{c.location || "—"}</td>
                  <td className="px-5 py-3 text-center text-court-fg-muted">
                    {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={goToPage}
          isLoading={isPending}
          itemLabel="candidates"
        />
      )}

      {bulkOpen === "apply" && (
        <BulkApplyDialog
          candidateIds={selectedCandidateIds}
          jobs={bulkJobs}
          onClose={() => setBulkOpen(null)}
          onDone={() => {
            setBulkOpen(null);
            setSelectedIds(new Set());
            router.refresh();
          }}
        />
      )}
      {bulkOpen === "list" && (
        <BulkAddToListDialog
          candidateIds={selectedCandidateIds}
          lists={lists}
          onClose={() => setBulkOpen(null)}
          onDone={() => {
            setBulkOpen(null);
            setSelectedIds(new Set());
            router.refresh();
          }}
        />
      )}
      {bulkOpen === "delete" && (
        <BulkDeleteDialog
          candidateIds={selectedCandidateIds}
          onClose={() => setBulkOpen(null)}
          onDone={() => {
            setBulkOpen(null);
            setSelectedIds(new Set());
            router.refresh();
          }}
        />
      )}
      {importOpen && (
        <ImportCsvDialog
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function BulkApplyDialog({
  candidateIds,
  jobs,
  onClose,
  onDone,
}: {
  candidateIds: string[];
  jobs: BulkPickerJob[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [pickKey, setPickKey] = useState("");
  const [busy, setBusy] = useState(false);
  const picked = jobs.find((j) => j.key === pickKey) ?? null;

  async function onApply() {
    if (!picked) return;
    setBusy(true);
    try {
      const res = await bulkApplyCandidatesToJob({
        candidateIds,
        jobCuid: picked.jobCuid,
        jobRfId: picked.jobRfId,
        clientCuid: picked.clientCuid,
        clientRfId: picked.clientRfId,
      });
      if (!res.ok && res.applied === 0) {
        toast.error("Couldn't apply candidates", {
          description: res.errors[0] ?? "Unknown error",
        });
        return;
      }
      const desc = [
        res.applied > 0 ? `${res.applied} applied` : null,
        res.skipped > 0 ? `${res.skipped} already linked` : null,
        res.errors.length > 0 ? `${res.errors.length} errors` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(`Bulk apply complete${desc ? ` — ${desc}` : ""}`);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BulkModal title={`Apply ${candidateIds.length} candidate${candidateIds.length === 1 ? "" : "s"} to a job`} onClose={onClose}>
      <p className="mb-2 text-xs text-court-fg-muted">
        Already-linked candidates are skipped automatically.
      </p>
      <select
        value={pickKey}
        onChange={(e) => setPickKey(e.target.value)}
        disabled={busy}
        className="w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
      >
        <option value="">— pick a job —</option>
        {jobs.map((j) => (
          <option key={j.key} value={j.key}>
            {j.label}
          </option>
        ))}
      </select>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={busy || !picked}
          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm transition hover:bg-amber-200 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Apply
        </button>
      </div>
    </BulkModal>
  );
}

function BulkAddToListDialog({
  candidateIds,
  lists,
  onClose,
  onDone,
}: {
  candidateIds: string[];
  lists: CandidateListSummary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(
    lists.length > 0 ? "existing" : "new",
  );
  const [listId, setListId] = useState<string>(lists[0]?.id ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setBusy(true);
    try {
      if (mode === "existing") {
        if (!listId) {
          toast.error("Pick a list");
          return;
        }
        const res = await bulkAddCandidatesToList({ candidateIds, listId });
        if (!res.ok) {
          toast.error("Couldn't add to list", { description: res.error });
          return;
        }
        toast.success(`Added ${res.added} to list`);
      } else {
        const res = await bulkAddCandidatesToNewList({ candidateIds, name });
        if (!res.ok) {
          toast.error("Couldn't create list", { description: res.error });
          return;
        }
        toast.success(`Created list and added ${res.added} candidates`);
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BulkModal title={`Add ${candidateIds.length} candidate${candidateIds.length === 1 ? "" : "s"} to a list`} onClose={onClose}>
      <div className="mb-3 flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode("existing")}
          disabled={lists.length === 0}
          className={
            "rounded-md border px-2 py-1 font-medium transition " +
            (mode === "existing"
              ? "border-court-accent bg-court-accent-tint text-court-accent-dark"
              : "border-court-border text-court-fg-muted hover:text-court-fg")
          }
        >
          Existing list
        </button>
        <button
          type="button"
          onClick={() => setMode("new")}
          className={
            "rounded-md border px-2 py-1 font-medium transition " +
            (mode === "new"
              ? "border-court-accent bg-court-accent-tint text-court-accent-dark"
              : "border-court-border text-court-fg-muted hover:text-court-fg")
          }
        >
          New list
        </button>
      </div>
      {mode === "existing" ? (
        <select
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          disabled={busy}
          className="w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
        >
          <option value="">— pick a list —</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.memberCount})
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New list name"
          maxLength={80}
          disabled={busy}
          className="w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
        />
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={
            busy ||
            (mode === "existing" ? !listId : name.trim().length === 0)
          }
          className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListPlus className="h-3 w-3" />}
          {mode === "existing" ? "Add" : "Create + add"}
        </button>
      </div>
    </BulkModal>
  );
}

function BulkDeleteDialog({
  candidateIds,
  onClose,
  onDone,
}: {
  candidateIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const count = candidateIds.length;

  async function onConfirm() {
    setBusy(true);
    try {
      const res = await fetch("/api/candidates/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: candidateIds }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        deleted?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error("Couldn't delete candidates", { description: data.error ?? `HTTP ${res.status}` });
        return;
      }
      toast.success(`Deleted ${data.deleted ?? count} candidate${(data.deleted ?? count) === 1 ? "" : "s"}`);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BulkModal title={`Delete ${count} candidate${count === 1 ? "" : "s"}?`} onClose={onClose}>
      <p className="text-sm text-court-fg">
        Delete {count} candidate{count === 1 ? "" : "s"}? This cannot be undone.
      </p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || count === 0}
          className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Delete
        </button>
      </div>
    </BulkModal>
  );
}

function BulkModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-court-border bg-court-surface p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-serif text-base font-semibold text-court-fg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const PIN_PREVIEW_COLUMNS: Array<{ header: string; label: string }> = [
  { header: "candidate.firstName", label: "First" },
  { header: "candidate.lastName", label: "Last" },
  { header: "candidate.emails.0", label: "Email" },
  { header: "candidate.experiences.0.title", label: "Title" },
  { header: "candidate.experiences.0.company", label: "Employer" },
  { header: "candidate.location", label: "Location" },
];

function ImportCsvDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function loadFile(f: File | null) {
    setFile(f);
    setPreviewRows([]);
    setPreviewError(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      setPreviewError("File must be a .csv");
      setFile(null);
      return;
    }
    try {
      const text = await f.text();
      const Papa = (await import("papaparse")).default;
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        preview: 3,
        transformHeader: (h: string) => h.trim(),
      });
      setPreviewRows(parsed.data ?? []);
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : "Couldn't read CSV file.",
      );
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    void loadFile(e.target.files?.[0] ?? null);
  }

  // dragenter/dragleave fire for every nested element, so the depth
  // counter is what keeps the highlight steady while dragging over
  // the inner table preview.
  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }
  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }
  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (busy) return;
    const f = e.dataTransfer.files?.[0] ?? null;
    if (inputRef.current) inputRef.current.value = "";
    void loadFile(f);
  }

  async function onImport() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/candidates/import-csv", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as
        | { imported: number; skipped: number; duplicates: number }
        | { error: string };
      if (!res.ok || "error" in json) {
        toast.error("Import failed", {
          description: "error" in json ? json.error : `HTTP ${res.status}`,
        });
        return;
      }
      const parts = [
        `Imported ${json.imported} candidate${json.imported === 1 ? "" : "s"}`,
        json.duplicates > 0
          ? `${json.duplicates} duplicate${json.duplicates === 1 ? "" : "s"} skipped`
          : null,
        json.skipped > 0
          ? `${json.skipped} row${json.skipped === 1 ? "" : "s"} skipped`
          : null,
      ].filter(Boolean);
      toast.success(parts.join(", "));
      onDone();
    } catch (err) {
      toast.error("Import failed", {
        description: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BulkModal title="Import candidates from CSV" onClose={onClose}>
      <p className="mb-3 text-xs text-court-fg-muted">
        Pin export format. Duplicates (matched by email) are skipped automatically.
      </p>
      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={
          "rounded-lg border-2 border-dashed p-4 transition " +
          (dragOver
            ? "border-court-accent bg-court-accent-tint"
            : "border-court-border bg-court-surface-subtle")
        }
      >
        <p className="mb-2 text-center text-xs text-court-fg-muted">
          {file
            ? <span className="text-court-fg">{file.name}</span>
            : dragOver
              ? "Drop CSV to load preview"
              : "Drag a .csv here, or pick a file"}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onPick}
          disabled={busy}
          className="block w-full text-xs text-court-fg file:mr-3 file:rounded-md file:border file:border-court-border file:bg-court-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-court-fg hover:file:bg-court-accent-tint"
        />
      </div>
      {previewError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {previewError}
        </div>
      )}
      {previewRows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-court-border">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-court-surface-subtle text-court-fg-muted">
              <tr>
                {PIN_PREVIEW_COLUMNS.map((c) => (
                  <th key={c.header} className="px-2 py-1 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-court-border-soft">
              {previewRows.map((r, i) => (
                <tr key={i}>
                  {PIN_PREVIEW_COLUMNS.map((c) => (
                    <td key={c.header} className="px-2 py-1 text-court-fg">
                      {r[c.header] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={busy || !file}
          className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          Import
        </button>
      </div>
    </BulkModal>
  );
}
