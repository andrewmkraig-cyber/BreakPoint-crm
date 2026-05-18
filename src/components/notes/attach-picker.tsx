"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";

import { TabStrip } from "@/components/ui/tab-strip";
import {
  attachNote,
  searchAttachOptions,
  type AttachKind,
  type AttachOption,
} from "@/app/notes/actions";

type PickerKind = "candidate" | "client" | "job";

const TABS: ReadonlyArray<{ id: PickerKind; label: string }> = [
  { id: "candidate", label: "Candidate" },
  { id: "client", label: "Client" },
  { id: "job", label: "Job" },
];

// Popover that lets the recruiter (re)attach a saved note to a
// Candidate / Client / Job. Closes on outside click + Escape. The
// detach button at the bottom clears every foreign key — the note
// becomes loose again and disappears from the Attached tab.
export function AttachPicker({
  noteId,
  currentAttachment,
  onClose,
  onChanged,
  align = "right",
}: {
  noteId: string;
  currentAttachment: { kind: AttachKind; id: string | null };
  onClose: () => void;
  onChanged: () => void;
  align?: "left" | "right";
}) {
  const [tab, setTab] = useState<PickerKind>(
    currentAttachment.kind === "client"
      ? "client"
      : currentAttachment.kind === "job"
        ? "job"
        : "candidate",
  );
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<AttachOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

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
        const result = await searchAttachOptions(tab, query);
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
  }, [tab, query]);

  function pick(option: AttachOption) {
    startTransition(async () => {
      const result = await attachNote({
        id: noteId,
        attach: { kind: tab, id: option.id },
      });
      if (result.ok) onChanged();
    });
  }

  function detach() {
    startTransition(async () => {
      const result = await attachNote({
        id: noteId,
        attach: { kind: null, id: null },
      });
      if (result.ok) onChanged();
    });
  }

  return (
    <div
      ref={rootRef}
      className={`absolute top-full z-50 mt-2 w-72 rounded-xl bg-court-surface p-3 shadow-xl ring-1 ring-court-border ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      <div className="flex items-center justify-between pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Attach to
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <TabStrip<PickerKind>
        items={TABS}
        activeId={tab}
        onChange={(id) => {
          setTab(id);
          setQuery("");
        }}
        fullWidth
      />
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${tab === "candidate" ? "candidates" : tab === "client" ? "clients" : "jobs"}...`}
          className="h-9 w-full rounded-md border border-court-border bg-court-surface pl-8 pr-2 text-sm text-court-fg outline-none focus:border-court-brand focus:ring-2 focus:ring-court-brand/20"
        />
      </div>
      <div className="mt-2 max-h-56 overflow-y-auto">
        {loading && options.length === 0 ? (
          <div className="px-2 py-3 text-xs text-court-fg-muted">Searching...</div>
        ) : options.length === 0 ? (
          <div className="px-2 py-3 text-xs text-court-fg-muted">
            No matches.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {options.map((o) => {
              const active =
                currentAttachment.kind === tab && currentAttachment.id === o.id;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => pick(o)}
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition ${
                      active
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
              );
            })}
          </ul>
        )}
      </div>
      {currentAttachment.kind && (
        <div className="mt-3 flex items-center justify-between border-t border-court-border pt-2">
          <span className="text-[11px] text-court-fg-muted">
            Currently attached
          </span>
          <button
            type="button"
            onClick={detach}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          >
            Detach
          </button>
        </div>
      )}
    </div>
  );
}
