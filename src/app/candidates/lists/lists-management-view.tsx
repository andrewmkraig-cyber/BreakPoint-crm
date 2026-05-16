"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import {
  deleteCandidateList,
  renameCandidateList,
  type CandidateListSummary,
} from "@/app/candidates/lists-actions";
import { cn } from "@/lib/utils";

// Phase 5A.4.b management page. Click a name to edit inline; Enter
// commits, Escape cancels. Trash icon opens a confirmation modal that
// spells out the delete-cascade behavior. After mutations, the parent
// route re-renders via router.refresh() so the table reflects the
// new state without a full reload.

export function ListsManagementView({ initial }: { initial: CandidateListSummary[] }) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState<CandidateListSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function onRename(list: CandidateListSummary, name: string) {
    if (name === list.name) return;
    setBusyId(list.id);
    try {
      const res = await renameCandidateList({ listId: list.id, name });
      if (!res.ok) {
        toast.error("Couldn't rename list", { description: res.error });
        return;
      }
      toast.success("List renamed");
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function onConfirmDelete(list: CandidateListSummary) {
    setBusyId(list.id);
    try {
      const res = await deleteCandidateList(list.id);
      if (!res.ok) {
        toast.error("Couldn't delete list", { description: res.error });
        return;
      }
      toast.success(`Deleted "${list.name}"`);
      setConfirmingDelete(null);
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (initial.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-court-border bg-court-surface-subtle/40 px-6 py-12 text-center text-sm text-court-fg-muted">
        No lists yet. Add a candidate to a list from any candidate profile to get started.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-court-border bg-court-surface-subtle/60 text-[11px] uppercase tracking-wider text-court-fg-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Members</th>
              <th className="px-5 py-3 font-medium">Created by</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className={cn("divide-y divide-court-border", pending && "opacity-60")}>
            {initial.map((l) => (
              <ListRow
                key={l.id}
                list={l}
                busy={busyId === l.id}
                onRename={(n) => onRename(l, n)}
                onAskDelete={() => setConfirmingDelete(l)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {confirmingDelete && (
        <DeleteConfirm
          list={confirmingDelete}
          busy={busyId === confirmingDelete.id}
          onCancel={() => setConfirmingDelete(null)}
          onConfirm={() => onConfirmDelete(confirmingDelete)}
        />
      )}
    </>
  );
}

function ListRow({
  list,
  busy,
  onRename,
  onAskDelete,
}: {
  list: CandidateListSummary;
  busy: boolean;
  onRename: (name: string) => void;
  onAskDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(list.name);

  function commit() {
    const name = draft.trim();
    setEditing(false);
    if (name && name !== list.name) onRename(name);
  }

  return (
    <tr>
      <td className="px-5 py-3 font-medium text-court-fg">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(list.name);
                  setEditing(false);
                }
              }}
              maxLength={80}
              className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <Check className="h-3 w-3 text-court-fg-muted" />
          </div>
        ) : (
          // Name is the primary affordance — clicking it opens the
          // list detail page. Inline rename moves to a small pencil
          // icon that surfaces on row hover so the link target is
          // unambiguous (clicking the name shouldn't put it in edit
          // mode anymore now that the list opens to its own page).
          <div className="group inline-flex items-center gap-1.5">
            <Link
              href={`/candidates/lists/${list.id}`}
              className="text-court-fg transition hover:text-brand-dark hover:underline"
            >
              {list.name}
            </Link>
            <button
              type="button"
              onClick={() => {
                setDraft(list.name);
                setEditing(true);
              }}
              aria-label={`Rename ${list.name}`}
              className="rounded-sm p-0.5 text-court-fg-muted opacity-0 transition hover:text-court-fg group-hover:opacity-100"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        )}
      </td>
      <td className="px-5 py-3 text-court-fg-muted">{list.memberCount}</td>
      <td className="px-5 py-3 text-court-fg-muted">{list.createdByName || "—"}</td>
      <td className="px-5 py-3 text-court-fg-muted">{new Date(list.createdAt).toLocaleDateString()}</td>
      <td className="px-5 py-3 text-right">
        <button
          type="button"
          onClick={onAskDelete}
          disabled={busy}
          aria-label={`Delete list ${list.name}`}
          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:border-red-300 hover:text-red-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Delete
        </button>
      </td>
    </tr>
  );
}

function DeleteConfirm({
  list,
  busy,
  onCancel,
  onConfirm,
}: {
  list: CandidateListSummary;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} aria-hidden="true" />
      <div className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-court-border bg-court-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-court-border px-5 py-3">
          <div className="text-sm font-semibold text-court-fg">Delete list?</div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-court-fg">
          <p>
            Delete list <span className="font-semibold">&ldquo;{list.name}&rdquo;</span>? This removes the
            list and its <span className="font-medium">{list.memberCount}</span> membership
            {list.memberCount === 1 ? "" : "s"}.{" "}
            <span className="text-court-fg-muted">Candidates are NOT deleted.</span>
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-court-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
