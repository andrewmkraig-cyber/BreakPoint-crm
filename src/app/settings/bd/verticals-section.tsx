"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, ChevronDown, X, Save, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input, Select } from "@/components/ui/input";
import { formatBdDateTime } from "@/app/bd/date-format";
import { resolveSequenceDisplayName } from "@/lib/bd/apollo-sequences";
import {
  createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  createVertical,
  deleteVertical,
  type SavedSearchCriteria,
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

function coerceCriteria(
  raw: Partial<SavedSearchCriteria>,
  sequenceDefault: string,
): SavedSearchCriteria {
  // Treat the incoming Json blob as unknown — Prisma's Json type erases
  // shape, so the static "Partial<SavedSearchCriteria>" annotation is
  // optimistic. Every field below validates at runtime before reading.
  // Old saved searches with the legacy fields (targetTitles, locations,
  // companySize, keywords, freshness) are silently dropped on load.
  const r = raw as Record<string, unknown>;
  const storedSequence =
    typeof r.apolloSequenceId === "string" ? r.apolloSequenceId : sequenceDefault;
  return {
    // Map any stored handle (a former alias like "BD Outbound v1", the raw
    // Apollo id, or the current name) to the sequence's current display
    // name so renamed sequences keep showing correctly and the edit-form
    // dropdown value matches an option. Self-heals on the next save.
    apolloSequenceId: resolveSequenceDisplayName(storedSequence),
    locationOverride: typeof r.locationOverride === "string" ? r.locationOverride : "",
  };
}

export function VerticalsSection({
  verticals,
  sequences,
  globalDailyCap,
}: {
  verticals: VerticalRow[];
  sequences: string[];
  globalDailyCap: number;
}) {
  // Each vertical owns its own open/closed state, so opening one never
  // collapses the others. Default: only the first vertical expanded (the
  // one whose first saved search opens to its edit form below).
  const [openVerticalIds, setOpenVerticalIds] = useState<Set<string>>(
    () => new Set(verticals[0] ? [verticals[0].id] : []),
  );
  function toggleVertical(id: string) {
    setOpenVerticalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
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
  // Saved searches deleted this session. Filtering on this set removes a row
  // from view the instant its delete resolves, with no page reload — the
  // server query won't return it on the next load anyway.
  const [deletedSearchIds, setDeletedSearchIds] = useState<Set<string>>(() => new Set());
  function markSearchDeleted(id: string) {
    setDeletedSearchIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {verticals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-court-border bg-court-surface-subtle p-6 text-center text-sm text-court-fg-muted">
          No verticals yet. Add one to start scheduling outbound.
        </div>
      ) : (
        verticals.map((v) => {
          const isOpen = openVerticalIds.has(v.id);
          const visibleSearches = v.savedSearches.filter((s) => !deletedSearchIds.has(s.id));
          return (
            <div key={v.id} className="rounded-lg border border-court-border bg-court-surface">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggleVertical(v.id)}
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
                    {visibleSearches.length} saved search{visibleSearches.length === 1 ? "" : "es"}
                  </span>
                </div>
                <DeleteVerticalBtn id={v.id} disabled={visibleSearches.length > 0} />
              </button>
              {isOpen && (
                <div className="border-t border-court-border px-4 py-4">
                  <div className="flex flex-col gap-2">
                    {visibleSearches.map((s) => {
                      const isEditing = editingSearchId === s.id && editingForVerticalId === v.id;
                      const criteria = coerceCriteria(s.criteria, sequences[0] ?? "Tax BD Sequence");
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
                            onDeleted={markSearchDeleted}
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
                              globalDailyCap={globalDailyCap}
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
                          initialContactCap={NaN}
                          initialCriteria={{ apolloSequenceId: "", locationOverride: "" }}
                          version={0}
                          verticalId={v.id}
                          sequences={sequences}
                          globalDailyCap={globalDailyCap}
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
  onDeleted,
}: {
  row: SavedSearchRow;
  criteria: SavedSearchCriteria;
  isEditing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const summaryParts = [
    criteria.apolloSequenceId ? `→ ${criteria.apolloSequenceId}` : null,
    criteria.locationOverride.trim() ? `Location: ${criteria.locationOverride.trim()}` : "Nationwide",
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
        <DeleteSavedSearchBtn id={row.id} name={row.name} onDeleted={onDeleted} />
      </div>
    </div>
  );
}

function SavedSearchEditForm({
  mode,
  initialName,
  initialContactCap,
  initialCriteria,
  savedSearchId,
  verticalId,
  sequences,
  globalDailyCap,
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
  globalDailyCap: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [contactCap, setContactCap] = useState<number>(initialContactCap);
  const [sequence, setSequence] = useState(initialCriteria.apolloSequenceId);
  const [locationOverride, setLocationOverride] = useState(initialCriteria.locationOverride);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A per-search cap can never exceed the org's global daily limit.
  // `globalDailyCap` is the persisted value threaded down from the page;
  // editing the global cap (Daily Limits section) triggers a soft
  // refresh that re-flows the new value here, so this re-evaluates live.
  const exceedsGlobal = !Number.isNaN(contactCap) && contactCap > globalDailyCap;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (exceedsGlobal) {
      setError(`Daily contact cap cannot exceed the global daily limit of ${globalDailyCap}.`);
      return;
    }
    const input = {
      name,
      // Empty field reads as NaN while editing; persist it as 0 (the
      // floor the server already clamps to) instead of letting NaN
      // through.
      contactCap: Number.isNaN(contactCap) ? 0 : contactCap,
      criteria: {
        apolloSequenceId: sequence,
        locationOverride: locationOverride.trim(),
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
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Mapped Apollo sequence">
          <Select
            value={sequence}
            onChange={(e) => setSequence(e.target.value)}
            required
          >
            {/* Placeholder only when nothing is chosen yet (new form) — a
                required select then blocks submit until one is picked.
                Hidden once a real value is selected so edit rows never
                show it. */}
            {!sequence && (
              <option value="" disabled>
                Select a sequence…
              </option>
            )}
            {sequences.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Daily contact cap">
          <Input
            type="number"
            min={0}
            value={Number.isNaN(contactCap) ? "" : contactCap}
            onChange={(e) =>
              setContactCap(e.target.value === "" ? NaN : Number(e.target.value))
            }
            aria-invalid={exceedsGlobal}
          />
          {exceedsGlobal && (
            <span className="mt-1 block text-[11px] text-red-600 dark:text-red-300">
              Lower to meet daily limit.
            </span>
          )}
        </Field>
      </div>

      <Field label="Location override" hint="Not yet active - reserved for future per-vertical location filtering.">
        <Input
          type="text"
          value={locationOverride}
          onChange={(e) => setLocationOverride(e.target.value)}
        />
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
          disabled={pending || exceedsGlobal}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
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

function DeleteSavedSearchBtn({
  id,
  name,
  onDeleted,
}: {
  id: string;
  name: string;
  onDeleted: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const onConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    startTransition(async () => {
      try {
        await deleteSavedSearch(id);
        // Remove from the list immediately — no router.refresh / page reload.
        onDeleted(id);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Delete failed");
        setConfirming(false);
      }
    });
  };

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-court-fg-muted">
        <span>Delete this search?</span>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" />}
          Yes
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(false);
          }}
          disabled={pending}
          className="rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[11px] font-medium text-court-fg transition hover:bg-court-surface-subtle disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setConfirming(true);
      }}
      aria-label={`Delete ${name}`}
      className="rounded-md p-1.5 text-court-fg-muted transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
    >
      <Trash2 className="h-3.5 w-3.5" />
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
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <Field label="Name">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Public Accounting"
              required
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Slug" hint="URL-safe identifier; leave blank to auto-generate">
            <Input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. public-accounting"
              className="font-mono text-[12px]"
            />
          </Field>
        </div>
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
