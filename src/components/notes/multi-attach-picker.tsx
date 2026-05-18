"use client";

import { useEffect, useState } from "react";
import { Briefcase, Building2, Check, Search, User, X } from "lucide-react";

import { TabStrip } from "@/components/ui/tab-strip";
import {
  searchAttachOptions,
  type Attachments,
  type AttachOption,
} from "@/app/notes/actions";

type Kind = "candidate" | "client" | "job";

const TABS: ReadonlyArray<{ id: Kind; label: string }> = [
  { id: "candidate", label: "Candidate" },
  { id: "client", label: "Client" },
  { id: "job", label: "Job" },
];

// Inline (not absolute-positioned) multi-select picker for note
// attachments. Recruiter can toggle any number of candidates, clients,
// and jobs in one note — the same note shows on every attached
// profile. Used by both /notes composer + saved-card edit and the
// global ComposeFAB New Note popup. Layout-flow means it can never
// overflow the parent the way the previous popover could.
export function MultiAttachPicker({
  value,
  onChange,
  variant = "card",
  showClose,
  onClose,
}: {
  value: Attachments;
  onChange: (next: Attachments) => void;
  // "card" — wider layout for the /notes page composer.
  // "compact" — tighter padding for the FAB popup.
  variant?: "card" | "compact";
  showClose?: boolean;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<Kind>("candidate");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<AttachOption[]>([]);
  const [loading, setLoading] = useState(false);

  // Cache the labels for already-picked ids so the chip row keeps
  // showing names even after the user types a search that filters
  // them out of the results list. Keyed per kind so re-tabbing
  // doesn't lose state.
  const [labelCache, setLabelCache] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      void (async () => {
        const result = await searchAttachOptions(tab, query);
        if (!cancelled) {
          const opts = result.ok ? result.options : [];
          setOptions(opts);
          setLoading(false);
          // Fold any new labels into the cache so subsequent renders
          // can resolve ids the user has already toggled.
          if (opts.length > 0) {
            setLabelCache((prev) => {
              const next = { ...prev };
              for (const o of opts) next[o.id] = o.label;
              return next;
            });
          }
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [tab, query]);

  const padding = variant === "compact" ? "p-2" : "p-3";

  function toggle(kind: Kind, option: AttachOption) {
    setLabelCache((prev) => ({ ...prev, [option.id]: option.label }));
    const list =
      kind === "candidate"
        ? value.candidateIds
        : kind === "client"
          ? value.clientIds
          : value.jobIds;
    const has = list.includes(option.id);
    const next = has ? list.filter((id) => id !== option.id) : [...list, option.id];
    onChange({
      ...value,
      candidateIds: kind === "candidate" ? next : value.candidateIds,
      clientIds: kind === "client" ? next : value.clientIds,
      jobIds: kind === "job" ? next : value.jobIds,
    });
  }

  function removeChip(kind: Kind, id: string) {
    onChange({
      ...value,
      candidateIds:
        kind === "candidate" ? value.candidateIds.filter((x) => x !== id) : value.candidateIds,
      clientIds:
        kind === "client" ? value.clientIds.filter((x) => x !== id) : value.clientIds,
      jobIds: kind === "job" ? value.jobIds.filter((x) => x !== id) : value.jobIds,
    });
  }

  const selectedCount =
    value.candidateIds.length + value.clientIds.length + value.jobIds.length;
  const currentList =
    tab === "candidate"
      ? value.candidateIds
      : tab === "client"
        ? value.clientIds
        : value.jobIds;

  return (
    <div className={`rounded-xl bg-court-surface-subtle ${padding}`}>
      {(showClose || selectedCount > 0) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {value.candidateIds.map((id) => (
            <AttachmentChip
              key={`cand-${id}`}
              kind="candidate"
              label={labelCache[id] ?? "Candidate"}
              onRemove={() => removeChip("candidate", id)}
            />
          ))}
          {value.clientIds.map((id) => (
            <AttachmentChip
              key={`cli-${id}`}
              kind="client"
              label={labelCache[id] ?? "Client"}
              onRemove={() => removeChip("client", id)}
            />
          ))}
          {value.jobIds.map((id) => (
            <AttachmentChip
              key={`job-${id}`}
              kind="job"
              label={labelCache[id] ?? "Job"}
              onRemove={() => removeChip("job", id)}
            />
          ))}
          {showClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close picker"
              className="ml-auto rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <TabStrip<Kind>
          items={TABS}
          activeId={tab}
          onChange={(id) => {
            setTab(id);
            setQuery("");
          }}
        />
      </div>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${tab}s...`}
          className="h-9 w-full rounded-md border border-court-border bg-court-surface pl-8 pr-2 text-sm text-court-fg outline-none focus:border-court-brand focus:ring-2 focus:ring-court-brand/20"
        />
      </div>
      <div className="mt-2 max-h-56 overflow-y-auto">
        {loading && options.length === 0 ? (
          <div className="px-2 py-3 text-xs text-court-fg-muted">Searching...</div>
        ) : options.length === 0 ? (
          <div className="px-2 py-3 text-xs text-court-fg-muted">No matches.</div>
        ) : (
          <ul className="space-y-0.5">
            {options.map((o) => {
              const selected = currentList.includes(o.id);
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => toggle(tab, o)}
                    aria-pressed={selected}
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition ${
                      selected
                        ? "bg-court-brand-tint text-court-brand-dark"
                        : "text-court-fg hover:bg-court-surface"
                    }`}
                  >
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-court-border bg-court-surface">
                      {selected && (
                        <Check className="h-3 w-3 text-court-brand-dark" />
                      )}
                    </span>
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
    </div>
  );
}

function AttachmentChip({
  kind,
  label,
  onRemove,
}: {
  kind: Kind;
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
        aria-label={`Remove ${label}`}
        className="ml-0.5 rounded-sm p-0.5 hover:bg-black/10"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
