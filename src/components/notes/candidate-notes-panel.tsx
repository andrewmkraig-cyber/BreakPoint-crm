"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Briefcase,
  Building2,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/app/candidates/[id]/editable-helpers";
import {
  createNoteAttachedTo,
  deleteNote,
  updateNote,
} from "@/app/notes/actions";
import type { NoteRow } from "@/lib/notes/queries";

// Single Notes panel for the candidate profile Notes tab. Replaces the
// old per-candidate raw.notes editor with the unified Note system used
// by /notes — same composer feel (textarea + Add note button), same
// card chrome, but writes route through createNoteAttachedTo so the
// note also appears on /notes and any other surface that lists the
// recruiter's notes. Edit / delete go through updateNote / deleteNote
// against the canonical Note.id.
export function CandidateNotesPanel({
  candidateId,
  initialNotes,
}: {
  candidateId: string;
  initialNotes: NoteRow[];
}) {
  const router = useRouter();
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pending, startTransition] = useTransition();

  function onAdd() {
    const trimmed = newNote.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createNoteAttachedTo(
        { kind: "candidate", id: candidateId },
        trimmed,
      );
      if (!result.ok) {
        toast.error("Couldn't add note", { description: result.error });
        return;
      }
      setNewNote("");
      toast.success("Note added");
      router.refresh();
    });
  }

  function startEdit(note: NoteRow) {
    setEditingId(note.id);
    setEditDraft(note.body);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  function saveEdit() {
    if (!editingId || !editDraft.trim()) return;
    const id = editingId;
    const body = editDraft.trim();
    startTransition(async () => {
      const result = await updateNote({ id, body });
      if (!result.ok) {
        toast.error("Couldn't save note", { description: result.error });
        return;
      }
      setEditingId(null);
      setEditDraft("");
      router.refresh();
    });
  }

  function onDelete(note: NoteRow) {
    const preview = note.body.slice(0, 60);
    if (!confirm(`Delete note "${preview}${note.body.length > 60 ? "…" : ""}"?`)) {
      return;
    }
    startTransition(async () => {
      const result = await deleteNote(note.id);
      if (!result.ok) {
        toast.error("Couldn't delete note", { description: result.error });
        return;
      }
      toast.success("Note deleted");
      router.refresh();
    });
  }

  return (
    <SectionCard
      title="Notes"
      right={
        pending ? (
          <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />
        ) : undefined
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
          <div className="mt-2 flex items-center justify-end">
            <button
              type="button"
              onClick={onAdd}
              disabled={!newNote.trim() || pending}
              className="inline-flex items-center gap-1 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-[11px] font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
            >
              <Plus className="h-3 w-3" /> Add note
            </button>
          </div>
        </div>

        {initialNotes.length > 0 && (
          <ul className="space-y-3">
            {initialNotes.map((n) => {
              const isEditing = editingId === n.id;
              return (
                <li
                  key={n.id}
                  className="rounded-lg border border-court-border/40 bg-court-surface p-3 text-sm shadow-sm"
                >
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
                          disabled={!editDraft.trim() || pending}
                          className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
                        >
                          <Save className="h-3 w-3" /> Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {n.title && (
                        <div className="mb-1 font-semibold text-court-fg">
                          {n.title}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap text-court-fg">
                        {n.body}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-court-fg-muted">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            {new Date(n.updatedAt).toLocaleString()}
                          </span>
                          {renderOtherAttachments(n, candidateId)}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(n)}
                            disabled={pending}
                            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(n)}
                            disabled={pending}
                            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-900/30 grass:hover:bg-red-900/30"
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

function renderOtherAttachments(n: NoteRow, currentCandidateId: string) {
  const chips: React.ReactNode[] = [];
  for (const c of n.candidates) {
    if (c.id === currentCandidateId) continue;
    const name =
      [c.firstName, c.lastName].filter(Boolean).join(" ") || "Candidate";
    chips.push(
      <Link
        key={`cand-${c.id}`}
        href={`/candidates/${c.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 hover:underline"
      >
        <User className="h-3 w-3" /> {name}
      </Link>,
    );
  }
  for (const c of n.clients) {
    chips.push(
      <Link
        key={`cli-${c.id}`}
        href={`/clients/${c.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 hover:underline"
      >
        <Building2 className="h-3 w-3" /> {c.name}
      </Link>,
    );
  }
  for (const j of n.jobs) {
    chips.push(
      <Link
        key={`job-${j.id}`}
        href={`/jobs/${j.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-court-brand-tint px-2 py-0.5 text-[10px] font-medium text-court-brand-dark hover:underline"
      >
        <Briefcase className="h-3 w-3" /> {j.title}
      </Link>,
    );
  }
  return chips;
}
