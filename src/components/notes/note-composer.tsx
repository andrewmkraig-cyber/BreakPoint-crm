"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Save } from "lucide-react";

import { createNote } from "@/app/notes/actions";
import type { Attachments } from "@/lib/notes/action-types";
import { MultiAttachPicker } from "@/components/notes/multi-attach-picker";

const EMPTY: Attachments = { candidateIds: [], clientIds: [], jobIds: [] };

// Always-visible doc-style composer card pinned to /notes. Title is
// optional; Body is required. Attach button reveals an inline multi-
// select picker below the buttons row (no popover — the previous
// absolute-positioned popover overflowed the viewport on narrow
// surfaces). Recruiter can attach any combination of candidates,
// clients, and jobs to one note.
export function NoteComposer() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attach, setAttach] = useState<Attachments>(EMPTY);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  function reset() {
    setTitle("");
    setBody("");
    setAttach(EMPTY);
    setPickerOpen(false);
  }

  function onSave() {
    if (!body.trim()) return;
    startTransition(async () => {
      const result = await createNote({
        title: title.trim() || null,
        body: body.trim(),
        attach,
      });
      if (result.ok) {
        reset();
        router.refresh();
      }
    });
  }

  const attachCount =
    attach.candidateIds.length + attach.clientIds.length + attach.jobIds.length;

  return (
    <div className="rounded-2xl bg-court-surface p-5 shadow-sm">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="mb-2 w-full bg-transparent text-base font-semibold text-court-fg placeholder:text-court-fg-muted/60 outline-none"
      />
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave();
          }
        }}
        rows={4}
        placeholder="Write a note. Cmd-Enter to save."
        className="w-full resize-y bg-transparent text-sm text-court-fg placeholder:text-court-fg-muted/60 outline-none"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-court-border pt-3">
        <span className="text-[11px] text-court-fg-muted">
          {attachCount === 0
            ? "Save to My Notes, or attach to one or more profiles."
            : `${attachCount} attachment${attachCount === 1 ? "" : "s"}`}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              pickerOpen
                ? "border-court-brand bg-court-brand-tint text-court-brand-dark"
                : "border-court-border bg-court-surface text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
            }`}
          >
            <Paperclip className="h-3.5 w-3.5" />
            {attachCount > 0 ? `Attached (${attachCount})` : "Attach"}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !body.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border-2 border-court-brand bg-court-brand-tint/15 px-3.5 py-2 text-xs font-semibold text-court-brand ring-2 ring-court-brand/35 ring-offset-2 ring-offset-court-surface transition hover:bg-court-brand-tint/30 disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" />
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {pickerOpen && (
        <div className="mt-3">
          <MultiAttachPicker
            value={attach}
            onChange={setAttach}
            variant="card"
          />
        </div>
      )}
    </div>
  );
}
