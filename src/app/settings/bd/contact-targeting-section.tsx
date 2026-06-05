"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Save, Loader2, GripVertical } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { saveContactTargeting } from "./actions";

export type ContactTargetingRow = {
  verticalId: string;
  verticalName: string;
  primaryTitles: string[];
  smallFirmFallbackTitles: string[];
  practiceSpecificTitles: string[];
  maxPerFirm: number;
};

export function ContactTargetingSection({ rows }: { rows: ContactTargetingRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-court-border bg-court-surface-subtle p-6 text-center text-sm text-court-fg-muted">
        Add a vertical first to configure contact targeting.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {rows.map((row) => (
        <VerticalTargetingCard key={row.verticalId} row={row} />
      ))}
    </div>
  );
}

function VerticalTargetingCard({ row }: { row: ContactTargetingRow }) {
  const router = useRouter();
  const [primary, setPrimary] = useState(row.primaryTitles);
  const [smallFirm, setSmallFirm] = useState(row.smallFirmFallbackTitles);
  const [practice, setPractice] = useState(row.practiceSpecificTitles);
  const [maxPerFirm, setMaxPerFirm] = useState(row.maxPerFirm);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function persist(nextPrimary: string[]) {
    setError(null);
    startTransition(async () => {
      try {
        await saveContactTargeting({
          verticalId: row.verticalId,
          primaryTitles: nextPrimary,
          smallFirmFallbackTitles: smallFirm,
          practiceSpecificTitles: practice,
          // Empty field reads as NaN while editing; persist it as 1 (the
          // floor the server already clamps to) instead of NaN.
          maxPerFirm: Number.isNaN(maxPerFirm) ? 1 : maxPerFirm,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function onSave() {
    persist(primary);
  }

  // Drag-to-reorder commits the new priority order to the DB immediately
  // (no Save click needed) so the enroll path reads the latest sequence.
  function onReorderPrimary(next: string[]) {
    setPrimary(next);
    persist(next);
  }

  return (
    <div className="rounded-lg border border-court-border bg-court-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-court-brand-dark">
        {row.verticalName}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <TitleTierField
          label="Primary titles"
          hint="Decision-makers Ace prefers first. Drag to reorder priority — order saves immediately. Always considered; up to the per-firm cap."
          titles={primary}
          onChange={setPrimary}
          sortable
          onReorder={onReorderPrimary}
          reordering={pending}
        />
        <TitleTierField
          label="Small-firm fallback"
          hint="Only used when no primary contact is returned for a firm."
          titles={smallFirm}
          onChange={setSmallFirm}
        />
        <TitleTierField
          label="Practice-specific"
          hint="Max 1 per firm; only fills remaining slots after primary / small-firm."
          titles={practice}
          onChange={setPractice}
        />
        <label className="block max-w-[14rem]">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
            Max contacts per firm
          </span>
          <input
            type="number"
            min={1}
            max={20}
            value={Number.isNaN(maxPerFirm) ? "" : maxPerFirm}
            onChange={(e) =>
              setMaxPerFirm(e.target.value === "" ? NaN : Number(e.target.value))
            }
            className="mt-1 block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
          />
        </label>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function TitleTierField({
  label,
  hint,
  titles,
  onChange,
  sortable = false,
  onReorder,
  reordering = false,
}: {
  label: string;
  hint: string;
  titles: string[];
  onChange: (titles: string[]) => void;
  // When set, chips become drag-to-reorder handles and onReorder fires
  // with the new order (which the parent persists immediately).
  sortable?: boolean;
  onReorder?: (titles: string[]) => void;
  reordering?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Distance constraint so a click on the chip (or its remove button)
  // doesn't start a drag — only an actual drag past 5px activates.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function commitDraft() {
    const tokens = draft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;
    onChange(Array.from(new Set([...titles, ...tokens])));
    setDraft("");
  }

  function removeTag(idx: number) {
    onChange(titles.filter((_, i) => i !== idx));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = titles.indexOf(String(active.id));
    const newIndex = titles.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder?.(arrayMove(titles, oldIndex, newIndex));
  }

  // Whitespace clicks on the chip row should focus the input, not
  // bubble into the chip's remove button. The remove button stops
  // propagation so this handler only runs on actual whitespace.
  function focusInputOnRowClick() {
    inputRef.current?.focus();
  }

  const chipRow = (
    <>
      {titles.map((t, i) =>
        sortable ? (
          <SortableChip key={t} title={t} onRemove={() => removeTag(i)} />
        ) : (
          <span
            key={`${t}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-court-brand-tint px-2 py-0.5 text-[11px] font-medium text-court-brand-dark"
          >
            {t}
            <button
              type="button"
              // Stop the parent row click from also firing (which would
              // re-focus the input, harmless but the deletion is the
              // intent here). Use onMouseDown preventDefault so the
              // input never loses focus during the click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                removeTag(i);
              }}
              aria-label={`Remove ${t}`}
              className="text-court-brand-dark/70 hover:text-court-brand-dark"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ),
      )}
    </>
  );

  return (
    <div className="block">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
        {label}
        {reordering && <Loader2 className="h-3 w-3 animate-spin text-court-fg-dim" />}
      </span>
      <span className="mt-0.5 block text-[11px] text-court-fg-dim">{hint}</span>
      <div
        onClick={focusInputOnRowClick}
        className={cn(
          "mt-1 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2 py-1.5",
        )}
      >
        {sortable ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={titles} strategy={horizontalListSortingStrategy}>
              {chipRow}
            </SortableContext>
          </DndContext>
        ) : (
          chipRow
        )}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "," || e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            }
          }}
          className="flex-1 min-w-[160px] bg-transparent text-sm text-court-fg placeholder:text-court-fg-dim focus:outline-none"
        />
      </div>
    </div>
  );
}

// A single drag-to-reorder primary-title chip. The whole chip is the
// drag handle (grip icon is an affordance). The remove button stops
// pointer/click propagation so deleting never starts a drag.
function SortableChip({ title, onRemove }: { title: string; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: title });

  return (
    <span
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cn(
        "inline-flex cursor-grab touch-none items-center gap-1 rounded-full bg-court-brand-tint px-2 py-0.5 text-[11px] font-medium text-court-brand-dark active:cursor-grabbing",
        isDragging && "opacity-60 shadow-sm",
      )}
    >
      <GripVertical className="h-3 w-3 text-court-brand-dark/50" />
      {title}
      <button
        type="button"
        // Keep the remove click from being swallowed by the drag listeners.
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${title}`}
        className="text-court-brand-dark/70 hover:text-court-brand-dark"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
