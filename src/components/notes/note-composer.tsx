"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Building2, Paperclip, Send, User, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  createNote,
  searchAttachOptions,
  type AttachKind,
  type AttachOption,
} from "@/app/notes/actions";

type PickerKind = "candidate" | "client" | "job";

// Always-visible doc-style composer card pinned to the top of the
// /notes page. Title is optional; Body is required. Attach popover
// trails the Save button so the recruiter can save a loose note in
// one click or pick a target first.
export function NoteComposer() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attach, setAttach] = useState<{
    kind: AttachKind;
    id: string | null;
    label: string;
  }>({ kind: null, id: null, label: "" });
  const [pickerKind, setPickerKind] = useState<PickerKind | null>(null);
  const [pending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  function reset() {
    setTitle("");
    setBody("");
    setAttach({ kind: null, id: null, label: "" });
    setPickerKind(null);
  }

  function onSave() {
    if (!body.trim()) return;
    startTransition(async () => {
      const result = await createNote({
        title: title.trim() || null,
        body: body.trim(),
        attach:
          attach.kind && attach.id
            ? { kind: attach.kind, id: attach.id }
            : null,
      });
      if (result.ok) {
        reset();
        router.refresh();
      }
    });
  }

  return (
    <div className="relative rounded-2xl bg-court-surface p-5 shadow-sm">
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
        <div className="flex flex-wrap items-center gap-2">
          {attach.kind && attach.id ? (
            <AttachmentChip
              kind={attach.kind}
              label={attach.label}
              onRemove={() => setAttach({ kind: null, id: null, label: "" })}
            />
          ) : (
            <span className="text-[11px] text-court-fg-muted">
              Save to My Notes, or attach to a profile.
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <AttachButton
            label="Candidate"
            icon={<User className="h-3.5 w-3.5" />}
            active={pickerKind === "candidate"}
            onClick={() =>
              setPickerKind(pickerKind === "candidate" ? null : "candidate")
            }
          />
          <AttachButton
            label="Client"
            icon={<Building2 className="h-3.5 w-3.5" />}
            active={pickerKind === "client"}
            onClick={() =>
              setPickerKind(pickerKind === "client" ? null : "client")
            }
          />
          <AttachButton
            label="Job"
            icon={<Briefcase className="h-3.5 w-3.5" />}
            active={pickerKind === "job"}
            onClick={() => setPickerKind(pickerKind === "job" ? null : "job")}
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={pending || !body.trim()}
          >
            <Send className="h-3.5 w-3.5" />
            {pending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {pickerKind && (
        <InlineAttachPicker
          kind={pickerKind}
          currentId={attach.kind === pickerKind ? attach.id : null}
          onClose={() => setPickerKind(null)}
          onPick={(o) => {
            setAttach({ kind: pickerKind, id: o.id, label: o.label });
            setPickerKind(null);
          }}
        />
      )}
    </div>
  );
}

function AttachButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
        active
          ? "border-court-brand bg-court-brand-tint text-court-brand-dark"
          : "border-court-border bg-court-surface text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
      }`}
      title={`Attach to ${label.toLowerCase()}`}
    >
      <Paperclip className="h-3 w-3" />
      {label}
      <span className="sr-only">{icon}</span>
    </button>
  );
}

function AttachmentChip({
  kind,
  label,
  onRemove,
}: {
  kind: AttachKind;
  label: string;
  onRemove: () => void;
}) {
  const palette =
    kind === "candidate"
      ? "bg-blue-50 text-blue-700"
      : kind === "client"
        ? "bg-emerald-50 text-emerald-700"
        : "bg-court-brand-tint text-court-brand-dark";
  const Icon =
    kind === "candidate" ? User : kind === "client" ? Building2 : Briefcase;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${palette}`}
    >
      <Icon className="h-3 w-3" /> {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove attachment"
        className="ml-0.5 rounded-sm p-0.5 hover:bg-black/10"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function InlineAttachPicker({
  kind,
  currentId,
  onClose,
  onPick,
}: {
  kind: PickerKind;
  currentId: string | null;
  onClose: () => void;
  onPick: (option: AttachOption) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<AttachOption[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  // Outside-click + Escape dismiss. Mirrors AttachPicker on saved
  // cards so the two pickers behave identically.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onMouse(e: MouseEvent) {
      const node = rootRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouse);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouse);
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      void (async () => {
        const result = await searchAttachOptions(kind, query);
        if (!cancelled) {
          setOptions(result.ok ? result.options : []);
          setLoading(false);
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [kind, query]);

  return (
    <div
      ref={rootRef}
      className="absolute bottom-3 right-3 z-50 w-72 -translate-y-12 rounded-xl bg-court-surface p-3 shadow-xl ring-1 ring-court-border"
    >
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${kind}s...`}
        className="h-9 w-full rounded-md border border-court-border bg-court-surface px-2 text-sm text-court-fg outline-none focus:border-court-brand focus:ring-2 focus:ring-court-brand/20"
      />
      <div className="mt-2 max-h-56 overflow-y-auto">
        {loading && options.length === 0 ? (
          <div className="px-2 py-3 text-xs text-court-fg-muted">Searching...</div>
        ) : options.length === 0 ? (
          <div className="px-2 py-3 text-xs text-court-fg-muted">No matches.</div>
        ) : (
          <ul className="space-y-0.5">
            {options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onPick(o)}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition ${
                    currentId === o.id
                      ? "bg-court-brand-tint text-court-brand-dark"
                      : "text-court-fg hover:bg-court-surface-subtle"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{o.label}</span>
                    {o.sublabel && (
                      <span className="block truncate text-[11px] text-court-fg-muted">
                        {o.sublabel}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
