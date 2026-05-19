"use client";

import { useEffect, useState, useTransition, type ChangeEvent } from "react";
import Link from "next/link";
import { Loader2, Mail, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { BulkEmailDialog } from "@/app/candidates/bulk-dialogs";
import { bulkRejectCandidatesFromList } from "@/app/candidates/bulk-actions";

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
  // Confirmation dialog state for the Reject All flow.
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  // Optimistic dim of rows that were just rejected this session. The
  // server revalidates /candidates/lists/[id] so the next read returns
  // fresh data; this keeps the dimming visible during the in-flight
  // revalidation so the recruiter gets immediate feedback. Matches the
  // opacity-50 convention placement-flows.tsx uses for rejected rows.
  const [justRejectedIds, setJustRejectedIds] = useState<Set<string>>(() => new Set());
  const [isRejecting, startReject] = useTransition();

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

  function runRejectAll() {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    startReject(async () => {
      const res = await bulkRejectCandidatesFromList({ candidateIds: ids, listId });
      if (res.rejected === 0 && res.candidatesWithoutActivePlacements === 0) {
        const msg = res.errors[0] ?? "No candidates rejected.";
        toast.error("Couldn't reject", { description: msg });
        setRejectConfirmOpen(false);
        return;
      }
      // Dim every candidate we attempted, including ones with no active
      // placements — from the recruiter's perspective they were all
      // "rejected from the list" in one pass.
      setJustRejectedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      const tail = [
        res.rejected > 0 ? `${res.rejected} rejected` : null,
        res.candidatesWithoutActivePlacements > 0
          ? `${res.candidatesWithoutActivePlacements} had no active placements`
          : null,
        res.errors.length > 0 ? `${res.errors.length} errors` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(tail || `${ids.length} candidates rejected`);
      setRejectConfirmOpen(false);
    });
  }

  const allChecked = rows.length > 0 && selectedIds.size === rows.length;
  const someChecked = selectedIds.size > 0 && !allChecked;
  const selectedCount = selectedIds.size;
  const totalCount = rows.length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setRejectConfirmOpen(true)}
          disabled={totalCount === 0 || isRejecting}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 shadow-sm transition hover:bg-red-100 disabled:opacity-50"
        >
          <UserX className="h-3.5 w-3.5" />
          Reject All
        </button>
      </div>

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
              const dimmed = justRejectedIds.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={
                    "h-12 transition " +
                    (dimmed ? "opacity-50 " : "") +
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

      {rejectConfirmOpen && (
        <div
          role="dialog"
          aria-label="Confirm bulk reject"
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!isRejecting) setRejectConfirmOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-court-border bg-court-surface p-5 shadow-2xl"
          >
            <h3 className="font-serif text-base font-semibold text-court-fg">
              Confirm bulk reject
            </h3>
            <p className="mt-2 text-sm text-court-fg-muted">
              Reject all{" "}
              <span className="font-semibold text-court-fg">{totalCount}</span>{" "}
              candidate{totalCount === 1 ? "" : "s"} on this list? This cannot
              be undone.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectConfirmOpen(false)}
                disabled={isRejecting}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runRejectAll}
                disabled={isRejecting}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-800 shadow-sm transition hover:bg-red-200 disabled:opacity-60"
              >
                {isRejecting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <UserX className="h-3 w-3" />
                )}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
