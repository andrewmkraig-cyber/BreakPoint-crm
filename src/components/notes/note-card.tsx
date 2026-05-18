"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Briefcase,
  Check,
  Edit3,
  Paperclip,
  Pin,
  Trash2,
  User,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  deleteNote,
  setPinned,
  updateNote,
  type AttachKind,
} from "@/app/notes/actions";
import type { NoteRow } from "@/lib/notes/queries";

import { AttachPicker } from "./attach-picker";

// Saved-note row. Idle state is read-only with a hover toolbar
// (pin / attach / edit / delete). Edit state swaps body + title into
// inline inputs that save on Enter (body via shift-enter for newline).
export function NoteCard({ note }: { note: NoteRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? "");
  const [body, setBody] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function onTogglePin() {
    setBusy(true);
    await setPinned(note.id, !note.pinned);
    setBusy(false);
    router.refresh();
  }

  async function onSaveEdit() {
    if (!body.trim()) return;
    setBusy(true);
    const result = await updateNote({
      id: note.id,
      title: title.trim() || null,
      body: body.trim(),
    });
    setBusy(false);
    if (result.ok) {
      setEditing(false);
      router.refresh();
    }
  }

  async function onDelete() {
    if (!confirm("Delete this note?")) return;
    setBusy(true);
    await deleteNote(note.id);
    setBusy(false);
    router.refresh();
  }

  const chip = renderAttachmentChip(note);

  return (
    <div className="group relative rounded-2xl bg-court-surface p-5 shadow-sm">
      {note.pinned && (
        <span className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-court-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-court-brand-dark">
          <Pin className="h-3 w-3" /> Pinned
        </span>
      )}

      {editing ? (
        <div className="space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full rounded-md bg-transparent text-base font-semibold text-court-fg placeholder:text-court-fg-muted/60 outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-court-border bg-court-surface-subtle px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 outline-none focus:border-court-brand focus:ring-2 focus:ring-court-brand/20"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setTitle(note.title ?? "");
                setBody(note.body);
                setEditing(false);
              }}
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSaveEdit}
              disabled={busy || !body.trim()}
            >
              <Check className="h-3.5 w-3.5" /> Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          {note.title && (
            <div className="mb-1 pr-20 text-base font-semibold text-court-fg">
              {note.title}
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm text-court-fg/90">
            {note.body}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-court-fg-muted">
            <time dateTime={note.updatedAt.toISOString()}>
              {formatStamp(note.updatedAt)}
            </time>
            {chip}
          </div>
        </>
      )}

      {!editing && (
        <div className="absolute right-3 top-3 hidden items-center gap-1 rounded-md bg-court-surface/95 p-1 shadow-sm ring-1 ring-court-border group-hover:flex">
          <IconBtn
            label={note.pinned ? "Unpin" : "Pin"}
            onClick={onTogglePin}
            disabled={busy}
          >
            <Pin
              className={`h-3.5 w-3.5 ${note.pinned ? "text-court-brand-dark" : ""}`}
            />
          </IconBtn>
          <div className="relative">
            <IconBtn
              label="Attach"
              onClick={() => setPickerOpen((v) => !v)}
              disabled={busy}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </IconBtn>
            {pickerOpen && (
              <AttachPicker
                noteId={note.id}
                currentAttachment={currentAttachment(note)}
                onClose={() => setPickerOpen(false)}
                onChanged={() => {
                  setPickerOpen(false);
                  router.refresh();
                }}
              />
            )}
          </div>
          <IconBtn
            label="Edit"
            onClick={() => setEditing(true)}
            disabled={busy}
          >
            <Edit3 className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn label="Delete" onClick={onDelete} disabled={busy} danger>
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition disabled:opacity-50 ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
          : "text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
      }`}
    >
      {children}
    </button>
  );
}

function currentAttachment(note: NoteRow): { kind: AttachKind; id: string | null } {
  if (note.candidateId) return { kind: "candidate", id: note.candidateId };
  if (note.clientId) return { kind: "client", id: note.clientId };
  if (note.jobId) return { kind: "job", id: note.jobId };
  return { kind: null, id: null };
}

function renderAttachmentChip(note: NoteRow) {
  if (note.candidate) {
    const name = [note.candidate.firstName, note.candidate.lastName]
      .filter(Boolean)
      .join(" ");
    return (
      <Link
        href={`/candidates/${note.candidate.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:underline"
      >
        <User className="h-3 w-3" /> {name || "Candidate"}
      </Link>
    );
  }
  if (note.client) {
    return (
      <Link
        href={`/clients/${note.client.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:underline"
      >
        <Building2 className="h-3 w-3" /> {note.client.name}
      </Link>
    );
  }
  if (note.job) {
    return (
      <Link
        href={`/jobs/${note.job.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-court-brand-tint px-2 py-0.5 text-[11px] font-medium text-court-brand-dark hover:underline"
      >
        <Briefcase className="h-3 w-3" /> {note.job.title}
      </Link>
    );
  }
  return null;
}

function formatStamp(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
