"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/app/candidates/[id]/editable-helpers";
import { updateCandidate } from "@/app/candidates/[id]/actions";

export type NoteRow = {
  id?: number | null;
  note: string;
  addedByName?: string | null;
  addedAt?: string | null;
};

export function EditableNotes({
  candidateId,
  initial,
}: {
  candidateId: number;
  initial: NoteRow[];
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteRow[]>(initial);
  const [newNote, setNewNote] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [isPending, startSave] = useTransition();

  function persist(next: NoteRow[]) {
    const snapshot = notes;
    setNotes(next);
    startSave(async () => {
      const result = await updateCandidate({
        id: candidateId,
        notes: next.map((n) => (n.id ? { id: n.id, note: n.note } : { note: n.note })),
      });
      if (!result.ok) {
        setNotes(snapshot);
        toast.error("Couldn't save notes", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function onAdd() {
    const trimmed = newNote.trim();
    if (!trimmed) return;
    const next = [{ note: trimmed } as NoteRow, ...notes];
    setNewNote("");
    persist(next);
    toast.success("Note added");
  }

  function startEdit(i: number) {
    setEditingIndex(i);
    setEditDraft(notes[i].note);
  }

  function saveEdit() {
    if (editingIndex == null) return;
    const next = notes.map((n, i) => (i === editingIndex ? { ...n, note: editDraft } : n));
    setEditingIndex(null);
    setEditDraft("");
    persist(next);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditDraft("");
  }

  function removeAt(i: number) {
    const target = notes[i];
    const preview = target.note.slice(0, 60);
    if (!confirm(`Delete note "${preview}${target.note.length > 60 ? "…" : ""}"?`)) return;
    persist(notes.filter((_, idx) => idx !== i));
  }

  return (
    <SectionCard
      title="Notes"
      right={
        isPending ? (
          <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />
        ) : (
          <span className="text-[11px] text-court-fg-muted">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </span>
        )
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed border-court-border bg-court-surface-subtle/40 p-3">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            rows={3}
            placeholder="Add a note…"
            className="w-full resize-vertical rounded-md border border-transparent bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-court-fg-muted">{newNote.length} chars</span>
            <button
              type="button"
              onClick={onAdd}
              disabled={!newNote.trim() || isPending}
              className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              <Plus className="h-3 w-3" /> Add note
            </button>
          </div>
        </div>

        {notes.length === 0 ? (
          <p className="text-sm text-court-fg-muted">No notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((n, i) => {
              const isEditing = editingIndex === i;
              return (
                <li key={n.id ?? `new-${i}`} className="rounded-lg border border-court-border bg-court-surface p-3 text-sm shadow-sm">
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={4}
                        className="w-full resize-vertical rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                        autoFocus
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
                        >
                          <X className="h-3 w-3" /> Cancel
                        </button>
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={!editDraft.trim()}
                          className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
                        >
                          <Save className="h-3 w-3" /> Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="whitespace-pre-wrap text-court-fg">{n.note}</div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-court-fg-muted">
                        <span>
                          {n.addedByName ?? "Unknown"}
                          {n.addedAt ? ` · ${new Date(n.addedAt).toLocaleString()}` : ""}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(i)}
                            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => removeAt(i)}
                            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 grass:hover:bg-red-900/30"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
