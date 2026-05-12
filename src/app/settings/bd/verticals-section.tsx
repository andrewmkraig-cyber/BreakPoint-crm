"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, ChevronDown, X, Save, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBdDateTime } from "@/app/bd/date-format";
import {
  createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  createVertical,
  deleteVertical,
  type SavedSearchCriteria,
  type SavedSearchLocationInput,
} from "./actions";

export type SavedSearchRow = {
  id: string;
  name: string;
  contactCap: number | null;
  criteria: Partial<SavedSearchCriteria>;
  version: number;
  lastRunIso: string | null;
};

export type VerticalRow = {
  id: string;
  name: string;
  slug: string;
  dailyCap: number | null;
  savedSearches: SavedSearchRow[];
};

const FRESHNESS_OPTIONS = [3, 7, 14, 30] as const;

function emptyCriteria(sequenceDefault: string): SavedSearchCriteria {
  return {
    apolloSequenceId: sequenceDefault,
    targetTitles: [],
    locations: [],
    companySizeMin: 10,
    companySizeMax: 500,
    keywords: "",
    minFreshnessDays: 7,
  };
}

function coerceCriteria(
  raw: Partial<SavedSearchCriteria>,
  sequenceDefault: string,
): SavedSearchCriteria {
  // Treat the incoming Json blob as unknown — Prisma's Json type erases
  // shape, so the static "Partial<SavedSearchCriteria>" annotation is
  // optimistic. Every field below validates at runtime before reading.
  const r = raw as Record<string, unknown>;
  const rawTitles = r.targetTitles;
  const rawLocations = r.locations;
  return {
    apolloSequenceId: typeof r.apolloSequenceId === "string" ? r.apolloSequenceId : sequenceDefault,
    targetTitles: Array.isArray(rawTitles)
      ? rawTitles.filter((t): t is string => typeof t === "string")
      : [],
    locations: Array.isArray(rawLocations)
      ? rawLocations
          .filter((l): l is Record<string, unknown> => l !== null && typeof l === "object")
          .map((l) => ({
            city: typeof l.city === "string" ? l.city : "",
            state: typeof l.state === "string" ? l.state : "",
            radiusMiles: typeof l.radiusMiles === "number" ? l.radiusMiles : 25,
          }))
      : [],
    companySizeMin: typeof r.companySizeMin === "number" ? r.companySizeMin : 10,
    companySizeMax: typeof r.companySizeMax === "number" ? r.companySizeMax : 500,
    keywords: typeof r.keywords === "string" ? r.keywords : "",
    minFreshnessDays: typeof r.minFreshnessDays === "number" ? r.minFreshnessDays : 7,
  };
}

export function VerticalsSection({
  verticals,
  sequences,
}: {
  verticals: VerticalRow[];
  sequences: string[];
}) {
  const [openVerticalId, setOpenVerticalId] = useState<string | null>(
    verticals[0]?.id ?? null,
  );
  // First search in first vertical opens to its edit form by default
  // so the user immediately sees what edit/create looks like.
  const [editingSearchId, setEditingSearchId] = useState<string | "new" | null>(() => {
    const first = verticals[0]?.savedSearches[0];
    return first?.id ?? null;
  });
  const [editingForVerticalId, setEditingForVerticalId] = useState<string | null>(() => {
    const first = verticals[0];
    return first?.savedSearches[0] ? first.id : null;
  });
  const [newVerticalOpen, setNewVerticalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {verticals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-court-border bg-court-surface-subtle p-6 text-center text-sm text-court-fg-muted">
          No verticals yet. Add one to start scheduling outbound.
        </div>
      ) : (
        verticals.map((v) => {
          const isOpen = openVerticalId === v.id;
          return (
            <div key={v.id} className="rounded-lg border border-court-border bg-court-surface">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenVerticalId(isOpen ? null : v.id)}
                className="flex w-full items-center justify-between gap-3 rounded-t-lg px-4 py-3 text-left transition hover:bg-court-surface-subtle"
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-court-fg-muted transition-transform",
                      isOpen ? "rotate-0" : "-rotate-90",
                    )}
                  />
                  <span className="text-sm font-semibold text-court-fg">{v.name}</span>
                  <span className="rounded-md bg-court-surface-subtle px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted">
                    {v.savedSearches.length} saved search{v.savedSearches.length === 1 ? "" : "es"}
                  </span>
                </div>
                <DeleteVerticalBtn id={v.id} disabled={v.savedSearches.length > 0} />
              </button>
              {isOpen && (
                <div className="border-t border-court-border px-4 py-4">
                  <div className="flex flex-col gap-2">
                    {v.savedSearches.map((s) => {
                      const isEditing = editingSearchId === s.id && editingForVerticalId === v.id;
                      const criteria = coerceCriteria(s.criteria, sequences[0] ?? "BD Outbound v1");
                      return (
                        <div
                          key={s.id}
                          className={cn(
                            "rounded-md border bg-court-surface",
                            isEditing ? "border-court-brand" : "border-court-border",
                          )}
                        >
                          <SavedSearchRowHeader
                            row={s}
                            criteria={criteria}
                            isEditing={isEditing}
                            onEdit={() => {
                              setEditingForVerticalId(v.id);
                              setEditingSearchId(s.id);
                            }}
                            onClose={() => setEditingSearchId(null)}
                          />
                          {isEditing && (
                            <SavedSearchEditForm
                              mode="edit"
                              initialName={s.name}
                              initialContactCap={s.contactCap ?? 80}
                              initialCriteria={criteria}
                              version={s.version}
                              savedSearchId={s.id}
                              sequences={sequences}
                              onDone={() => setEditingSearchId(null)}
                            />
                          )}
                        </div>
                      );
                    })}

                    {editingSearchId === "new" && editingForVerticalId === v.id ? (
                      <div className="rounded-md border border-court-brand bg-court-surface">
                        <div className="flex items-center justify-between px-4 py-2 border-b border-court-border">
                          <span className="text-xs font-semibold uppercase tracking-wide text-court-brand-dark">
                            New saved search
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingSearchId(null)}
                            className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
                            aria-label="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <SavedSearchEditForm
                          mode="create"
                          initialName=""
                          initialContactCap={80}
                          initialCriteria={emptyCriteria(sequences[0] ?? "BD Outbound v1")}
                          version={0}
                          verticalId={v.id}
                          sequences={sequences}
                          onDone={() => setEditingSearchId(null)}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingForVerticalId(v.id);
                          setEditingSearchId("new");
                        }}
                        className="inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:border-court-brand/40 hover:text-court-fg"
                      >
                        <Plus className="h-3.5 w-3.5" /> New saved search
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      {newVerticalOpen ? (
        <NewVerticalForm onClose={() => setNewVerticalOpen(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setNewVerticalOpen(true)}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
        >
          <Plus className="h-3.5 w-3.5" /> New vertical
        </button>
      )}
    </div>
  );
}

function SavedSearchRowHeader({
  row,
  criteria,
  isEditing,
  onEdit,
  onClose,
}: {
  row: SavedSearchRow;
  criteria: SavedSearchCriteria;
  isEditing: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const summaryParts = [
    criteria.targetTitles.length > 0
      ? `${criteria.targetTitles.slice(0, 3).join(", ")}${criteria.targetTitles.length > 3 ? "…" : ""}`
      : null,
    criteria.locations.length > 0
      ? criteria.locations
          .slice(0, 2)
          .map((l) => `${l.city}, ${l.state}`)
          .join(" · ")
      : null,
    `${criteria.companySizeMin}-${criteria.companySizeMax} ppl`,
  ].filter(Boolean);

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-court-fg">{row.name}</p>
        <p className="mt-0.5 truncate text-xs text-court-fg-muted">{summaryParts.join(" · ")}</p>
        <p className="mt-0.5 text-[11px] text-court-fg-dim">
          {row.lastRunIso ? `Last run ${formatBdDateTime(new Date(row.lastRunIso))}` : "Never run"}
          {" · "}
          {row.version > 0 ? `v${row.version}` : "no history"}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {isEditing ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit"
            className="rounded-md p-1.5 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit saved search"
            className="rounded-md p-1.5 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <DeleteSavedSearchBtn id={row.id} name={row.name} />
      </div>
    </div>
  );
}

function SavedSearchEditForm({
  mode,
  initialName,
  initialContactCap,
  initialCriteria,
  version,
  savedSearchId,
  verticalId,
  sequences,
  onDone,
}: {
  mode: "edit" | "create";
  initialName: string;
  initialContactCap: number;
  initialCriteria: SavedSearchCriteria;
  version: number;
  savedSearchId?: string;
  verticalId?: string;
  sequences: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [contactCap, setContactCap] = useState<number>(initialContactCap);
  const [sequence, setSequence] = useState(initialCriteria.apolloSequenceId);
  const [titles, setTitles] = useState<string[]>(initialCriteria.targetTitles);
  const [titlesDraft, setTitlesDraft] = useState("");
  const [locations, setLocations] = useState<SavedSearchLocationInput[]>(initialCriteria.locations);
  const [sizeMin, setSizeMin] = useState(initialCriteria.companySizeMin);
  const [sizeMax, setSizeMax] = useState(initialCriteria.companySizeMax);
  const [keywords, setKeywords] = useState(initialCriteria.keywords);
  const [freshness, setFreshness] = useState(initialCriteria.minFreshnessDays);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const nextVersion = mode === "edit" ? version + 1 : 1;

  function commitTitleDraft() {
    const tokens = titlesDraft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;
    setTitles((existing) => Array.from(new Set([...existing, ...tokens])));
    setTitlesDraft("");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (titlesDraft.trim()) commitTitleDraft();
    const input = {
      name,
      contactCap,
      criteria: {
        apolloSequenceId: sequence,
        targetTitles: titles,
        locations,
        companySizeMin: sizeMin,
        companySizeMax: sizeMax,
        keywords,
        minFreshnessDays: freshness,
      } satisfies SavedSearchCriteria,
    };
    setError(null);
    startTransition(async () => {
      try {
        if (mode === "edit" && savedSearchId) {
          await updateSavedSearch(savedSearchId, input);
        } else if (mode === "create" && verticalId) {
          await createSavedSearch(verticalId, input);
        }
        router.refresh();
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 px-4 py-4">
      <Field label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Mapped Apollo sequence">
          <select
            value={sequence}
            onChange={(e) => setSequence(e.target.value)}
            className="block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
          >
            {sequences.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Daily contact cap">
          <input
            type="number"
            min={0}
            value={contactCap}
            onChange={(e) => setContactCap(Number(e.target.value))}
            className="block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
          />
        </Field>
      </div>

      <Field label="Target titles" hint="Type a title and press Enter or comma to add">
        <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2 py-1.5">
          {titles.map((t, i) => (
            <span
              key={`${t}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-court-brand-tint px-2 py-0.5 text-[11px] font-medium text-court-brand-dark"
            >
              {t}
              <button
                type="button"
                onClick={() => setTitles((titles) => titles.filter((x) => x !== t))}
                aria-label={`Remove ${t}`}
                className="text-court-brand-dark/70 hover:text-court-brand-dark"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={titlesDraft}
            onChange={(e) => setTitlesDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "," || e.key === "Enter") {
                e.preventDefault();
                commitTitleDraft();
              } else if (e.key === "Backspace" && !titlesDraft && titles.length > 0) {
                setTitles((titles) => titles.slice(0, -1));
              }
            }}
            onBlur={commitTitleDraft}
            placeholder={titles.length === 0 ? "e.g. Tax Manager, Audit Partner" : ""}
            className="flex-1 min-w-[120px] bg-transparent text-sm text-court-fg placeholder:text-court-fg-dim focus:outline-none"
          />
        </div>
      </Field>

      <Field label="Locations" hint="City + State + radius (miles)">
        <div className="flex flex-col gap-2">
          {locations.map((loc, idx) => (
            <div key={idx} className="grid grid-cols-[2fr_1fr_1fr_auto] items-center gap-2">
              <input
                type="text"
                value={loc.city}
                placeholder="City"
                onChange={(e) =>
                  setLocations((rows) =>
                    rows.map((r, i) => (i === idx ? { ...r, city: e.target.value } : r)),
                  )
                }
                className="rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
              />
              <input
                type="text"
                value={loc.state}
                placeholder="State"
                maxLength={2}
                onChange={(e) =>
                  setLocations((rows) =>
                    rows.map((r, i) => (i === idx ? { ...r, state: e.target.value.toUpperCase() } : r)),
                  )
                }
                className="rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
              />
              <input
                type="number"
                min={1}
                value={loc.radiusMiles}
                onChange={(e) =>
                  setLocations((rows) =>
                    rows.map((r, i) =>
                      i === idx ? { ...r, radiusMiles: Number(e.target.value) || 0 } : r,
                    ),
                  )
                }
                className="rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
              />
              <button
                type="button"
                onClick={() => setLocations((rows) => rows.filter((_, i) => i !== idx))}
                aria-label="Remove location"
                className="rounded-md p-1.5 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLocations((rows) => [...rows, { city: "", state: "", radiusMiles: 25 }])}
            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed border-court-border bg-court-surface px-2.5 py-1 text-xs font-medium text-court-fg-muted transition hover:border-court-brand/40 hover:text-court-fg"
          >
            <Plus className="h-3 w-3" /> Add location
          </button>
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Company size — min">
          <input
            type="number"
            min={0}
            value={sizeMin}
            onChange={(e) => setSizeMin(Number(e.target.value))}
            className="block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
          />
        </Field>
        <Field label="Company size — max">
          <input
            type="number"
            min={0}
            value={sizeMax}
            onChange={(e) => setSizeMax(Number(e.target.value))}
            className="block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
          />
        </Field>
      </div>

      <Field label="Boolean keywords" hint="e.g. tax AND (manager OR partner)">
        <textarea
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          rows={2}
          className="block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 font-mono text-[12px] text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
        />
      </Field>

      <Field label="Min posting freshness">
        <select
          value={freshness}
          onChange={(e) => setFreshness(Number(e.target.value))}
          className="block w-full max-w-[12rem] rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
        >
          {FRESHNESS_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </Field>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="inline-flex items-center rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save · creates v{nextVersion}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
        {label}
      </span>
      {hint && <span className="mt-0.5 block text-[11px] text-court-fg-dim">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function DeleteSavedSearchBtn({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete saved search "${name}"? Version history will be lost.`)) return;
    startTransition(async () => {
      try {
        await deleteSavedSearch(id);
        router.refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Delete failed");
      }
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={`Delete ${name}`}
      className="rounded-md p-1.5 text-court-fg-muted transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300 disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}

function DeleteVerticalBtn({ id, disabled }: { id: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    if (!window.confirm("Delete this vertical?")) return;
    startTransition(async () => {
      try {
        await deleteVertical(id);
        router.refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Delete failed");
      }
    });
  };
  return (
    <span
      role="button"
      onClick={onClick}
      title={disabled ? "Delete the vertical's saved searches first" : "Delete vertical"}
      className={cn(
        "rounded-md p-1.5 text-court-fg-muted transition",
        disabled
          ? "cursor-not-allowed opacity-40"
          : "cursor-pointer hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300",
      )}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </span>
  );
}

function NewVerticalForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await createVertical({ name, slug: slug || name.toLowerCase().replace(/\s+/g, "-") });
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-md border border-court-brand bg-court-surface p-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-court-brand-dark">
          New vertical
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel"
          className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Public Accounting"
            required
            className="block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
          />
        </Field>
        <Field label="Slug" hint="URL-safe identifier; leave blank to auto-generate">
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="e.g. public-accounting"
            className="block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 font-mono text-[12px] text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
          />
        </Field>
      </div>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-300">{error}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="inline-flex items-center rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Create
        </button>
      </div>
    </form>
  );
}
