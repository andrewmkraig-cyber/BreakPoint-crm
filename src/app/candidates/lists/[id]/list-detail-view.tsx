"use client";

import { useEffect, useState, useTransition, type ChangeEvent } from "react";
import Link from "next/link";
import { ListMinus, Loader2, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { BulkEmailDialog } from "@/app/candidates/bulk-dialogs";
import { bulkRemoveCandidatesFromList } from "@/app/candidates/bulk-actions";

export type ListRow = {
  id: string;
  name: string;
  currentTitle: string;
  employer: string;
  location: string;
  salary: string;
  lastApply: string;
  lastAction: string;
};

export function CandidateListDetailView({
  listId,
  rows,
}: {
  listId: string;
  rows: ListRow[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [emailOpen, setEmailOpen] = useState(false);
  const [isRemoving, startRemove] = useTransition();

  // Prune selection if the membership list changes underneath us (e.g.
  // server revalidation removed members). Same pattern as the global
  // candidates view's selection-vs-visible reconciliation.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map((r) => r.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [rows]);

  function toggleId(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    if (checked) setSelectedIds(new Set(rows.map((r) => r.id)));
    else setSelectedIds(new Set());
  }

  function runRemove() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    startRemove(async () => {
      const res = await bulkRemoveCandidatesFromList({ candidateIds: ids, listId });
      if (!res.ok) {
        toast.error("Couldn't remove from list", { description: res.error });
        return;
      }
      toast.success(
        `${res.removed} removed from list`,
        { description: "Candidates stay in your database; only the list membership was dropped." },
      );
      setSelectedIds(new Set());
    });
  }

  const allChecked = rows.length > 0 && selectedIds.size === rows.length;
  const someChecked = selectedIds.size > 0 && !allChecked;
  const selectedCount = selectedIds.size;

  return (
    <>
      {selectedCount > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-court-accent/40 bg-court-accent-tint px-3 py-2 shadow-sm">
          <div className="flex items-center gap-3 text-xs font-medium text-court-accent-dark">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              aria-label="Clear selection"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-court-accent-dark transition hover:bg-court-surface/50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <span>{selectedCount} selected</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEmailOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-orange-500 bg-white px-3 py-1.5 text-xs font-semibold text-orange-600 shadow-sm transition hover:bg-orange-50"
            >
              <Mail className="h-3.5 w-3.5" />
              Email
            </button>
            <button
              type="button"
              onClick={runRemove}
              disabled={isRemoving}
              className="flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 shadow-sm transition hover:bg-red-50 disabled:opacity-60"
            >
              {isRemoving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ListMinus className="h-3.5 w-3.5" />
              )}
              Remove from List
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-court-border bg-court-surface-subtle/60 text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all candidates in this list"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked;
                  }}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    toggleAll(e.target.checked)
                  }
                  className="h-3.5 w-3.5 cursor-pointer accent-brand"
                />
              </th>
              <th className="px-3 py-2">Candidate</th>
              <th className="px-3 py-2">Current Title</th>
              <th className="px-3 py-2">Employer</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2 text-right">Salary</th>
              <th className="px-3 py-2">Last Apply</th>
              <th className="px-3 py-2">Last Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-court-border-soft">
            {rows.map((r) => {
              const checked = selectedIds.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={
                    "h-12 transition " +
                    (checked
                      ? "bg-court-accent-tint/60"
                      : "hover:bg-court-accent-tint/40")
                  }
                >
                  <td className="w-10 px-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      checked={checked}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        toggleId(r.id, e.target.checked)
                      }
                      className="h-3.5 w-3.5 cursor-pointer accent-brand"
                    />
                  </td>
                  <td className="px-3 font-medium text-court-fg">
                    <Link
                      href={`/candidates/${r.id}`}
                      className="hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 text-court-fg-muted">{r.currentTitle}</td>
                  <td className="px-3 text-court-fg-muted">{r.employer}</td>
                  <td className="px-3 text-court-fg-muted">{r.location}</td>
                  <td className="px-3 text-right tabular-nums text-court-fg-muted">
                    {r.salary}
                  </td>
                  <td className="px-3 text-court-fg-muted">{r.lastApply}</td>
                  <td className="px-3 text-court-fg-muted">{r.lastAction}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {emailOpen && (
        <BulkEmailDialog
          candidateIds={Array.from(selectedIds)}
          onClose={() => setEmailOpen(false)}
          onDone={() => {
            setEmailOpen(false);
            setSelectedIds(new Set());
          }}
        />
      )}
    </>
  );
}
