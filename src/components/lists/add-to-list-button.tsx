"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { ListPlus, X, Loader2, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import {
  createCandidateList,
  getCandidateListMemberships,
  listCandidateLists,
  setCandidateListMemberships,
  type CandidateListSummary,
} from "@/app/candidates/lists-actions";
import { ADD_TO_LIST_BUTTON_CLASS } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Phase 5A.4.b: candidate-profile button + modal that lets the user
// add (or remove) the candidate from any of the org's lists, or
// spin up a brand-new list. Two modes — "Existing lists" (multi-select
// checkboxes pre-checked for current memberships) and "New list"
// (text input → create + auto-add the candidate). Court Mode tokens
// throughout; portal'd to <body> like the popup composer so host page
// stacking contexts don't bleed.

export function AddToListButton({
  candidateId,
  candidateName,
  className,
}: {
  candidateId: string;
  candidateName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(ADD_TO_LIST_BUTTON_CLASS, className)}
        title="Add to List"
      >
        <ListPlus className="h-3 w-3 shrink-0" />
        {/* Label wrapped so a min-w-0 parent (e.g. a no-wrap sticky
            bar) can ellipsize "Add to List" rather than wrapping the
            button onto a second row. No-op when width isn't
            constrained. */}
        <span className="truncate">Add to List</span>
      </button>
      {open && (
        <AddToListModal
          candidateId={candidateId}
          candidateName={candidateName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type Mode = "existing" | "new";

function AddToListModal({
  candidateId,
  candidateName,
  onClose,
}: {
  candidateId: string;
  candidateName: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("existing");
  const [lists, setLists] = useState<CandidateListSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [originalSelected, setOriginalSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, startSaving] = useTransition();

  // Hydrate the current memberships + every list-in-org on mount.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listCandidateLists(), getCandidateListMemberships(candidateId)])
      .then(([all, memberships]) => {
        if (cancelled) return;
        setLists(all);
        const ms = new Set(memberships);
        setSelected(ms);
        setOriginalSelected(ms);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load lists");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  function toggle(listId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  }

  function onSaveExisting() {
    setError(null);
    const selectedIds = Array.from(selected);
    startSaving(async () => {
      const res = await setCandidateListMemberships({
        candidateId,
        listIds: selectedIds,
      });
      if (!res.ok) {
        setError(res.error);
        toast.error("Couldn't update lists", { description: res.error });
        return;
      }
      // Pretty toast text — diff against the original membership set.
      const added = selectedIds.filter((id) => !originalSelected.has(id));
      const removed = Array.from(originalSelected).filter((id) => !selected.has(id));
      if (added.length === 1) {
        const list = lists.find((l) => l.id === added[0]);
        toast.success(`Added to ${list?.name ?? "list"}`);
      } else if (added.length > 1) {
        toast.success(`Added to ${added.length} lists`);
      } else if (removed.length > 0) {
        toast.success(`Removed from ${removed.length} list${removed.length === 1 ? "" : "s"}`);
      } else {
        toast.success("Lists updated");
      }
      onClose();
    });
  }

  function onSaveNew() {
    setError(null);
    const name = newName.trim();
    if (!name) {
      setError("Enter a name for the new list.");
      return;
    }
    startSaving(async () => {
      const res = await createCandidateList({ name, candidateId });
      if (!res.ok) {
        setError(res.error);
        toast.error("Couldn't create list", { description: res.error });
        return;
      }
      toast.success(`Added to ${res.value.name}`);
      onClose();
    });
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2">
        <div className="flex max-h-[80vh] flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-court-border px-5 py-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-court-fg-muted">
                Add to list
              </div>
              <div className="mt-0.5 truncate text-sm font-medium text-court-fg">
                {candidateName}
              </div>
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

          <div className="flex border-b border-court-border bg-court-surface-subtle/40 px-5 text-xs">
            <TabButton active={mode === "existing"} onClick={() => setMode("existing")}>
              Existing lists
            </TabButton>
            <TabButton active={mode === "new"} onClick={() => setMode("new")}>
              New list
            </TabButton>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-court-fg-muted">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading lists…
              </div>
            ) : mode === "existing" ? (
              lists.length === 0 ? (
                <div className="rounded-lg border border-dashed border-court-border bg-court-surface-subtle/40 px-3 py-6 text-center text-xs text-court-fg-muted">
                  No lists yet. Switch to <span className="font-medium text-court-fg">New list</span> to create your first one.
                </div>
              ) : (
                <ul className="space-y-1">
                  {lists.map((l) => {
                    const checked = selected.has(l.id);
                    return (
                      <li key={l.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition",
                            checked
                              ? "border-brand/40 bg-court-accent-tint/40 text-court-fg"
                              : "border-court-border bg-court-surface text-court-fg hover:border-brand/30 hover:bg-court-accent-tint/20",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(l.id)}
                            className="sr-only"
                          />
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                checked
                                  ? "border-brand bg-brand text-white"
                                  : "border-court-border bg-court-surface",
                              )}
                            >
                              {checked && <Check className="h-3 w-3" />}
                            </span>
                            <span className="truncate font-medium">{l.name}</span>
                          </span>
                          <span className="shrink-0 text-[10px] uppercase tracking-wider text-court-fg-muted">
                            {l.memberCount} {l.memberCount === 1 ? "member" : "members"}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
                    List name
                  </span>
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Top Tax Candidates"
                    maxLength={80}
                    className="mt-1 w-full rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </label>
                <p className="text-[11px] text-court-fg-muted">
                  Saving creates the list and adds <span className="font-medium text-court-fg">{candidateName}</span> to it.
                </p>
              </div>
            )}

            {error && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-court-border px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
            >
              Cancel
            </button>
            {mode === "existing" ? (
              <button
                type="button"
                onClick={onSaveExisting}
                disabled={saving || loading}
                className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </button>
            ) : (
              <button
                type="button"
                onClick={onSaveNew}
                disabled={saving || !newName.trim()}
                className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Create &amp; add
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-b-2 px-3 py-2 transition",
        active
          ? "border-brand text-court-fg"
          : "border-transparent text-court-fg-muted hover:text-court-fg",
      )}
    >
      {children}
    </button>
  );
}
