"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  SectionCard,
  LabeledField,
  LabeledTextarea,
  formatMonthYear,
  parseMonthYear,
  type MonthYear,
} from "@/app/candidates/[id]/editable-helpers";
import { updateCandidate } from "@/app/candidates/[id]/actions";

export type EducationRow = {
  school: string;
  degree: string;
  description: string;
  from: MonthYear;
  to: MonthYear;
};

const EMPTY: EducationRow = {
  school: "",
  degree: "",
  description: "",
  from: [null, null],
  to: [null, null],
};

export function EditableEducation({
  candidateId,
  initial,
}: {
  candidateId: number;
  initial: EducationRow[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<EducationRow[]>(initial);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<EducationRow>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [isPending, startSave] = useTransition();

  function persist(next: EducationRow[]) {
    const snapshot = items;
    setItems(next);
    startSave(async () => {
      const result = await updateCandidate({
        id: candidateId,
        education: next.map((e, i) => ({
          school: e.school.trim(),
          degree: e.degree.trim(),
          description: e.description.trim() || null,
          from: e.from,
          to: e.to,
          rank: i + 1,
        })),
      });
      if (!result.ok) {
        setItems(snapshot);
        toast.error("Couldn't save education", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function startAdd() {
    setAdding(true);
    setEditingIndex(null);
    setDraft(EMPTY);
  }

  function startEdit(i: number) {
    setAdding(false);
    setEditingIndex(i);
    setDraft(items[i]);
  }

  function cancel() {
    setAdding(false);
    setEditingIndex(null);
    setDraft(EMPTY);
  }

  function saveDraft() {
    if (!draft.school.trim() && !draft.degree.trim()) {
      toast.error("School or degree is required");
      return;
    }
    let next: EducationRow[];
    if (adding) {
      next = [draft, ...items];
    } else if (editingIndex != null) {
      next = items.map((e, i) => (i === editingIndex ? draft : e));
    } else {
      return;
    }
    cancel();
    persist(next);
    toast.success(adding ? "Education added" : "Education saved");
  }

  function removeAt(i: number) {
    const t = items[i];
    if (!confirm(`Delete ${t.school || t.degree || "this entry"}?`)) return;
    persist(items.filter((_, idx) => idx !== i));
  }

  return (
    <SectionCard
      title="Education"
      right={
        !adding && editingIndex == null ? (
          <div className="flex items-center gap-2">
            {isPending && <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />}
            <button
              type="button"
              onClick={startAdd}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
        ) : null
      }
    >
      <div className="space-y-3">
        {(adding || editingIndex != null) && (
          <EntryForm
            draft={draft}
            onChange={setDraft}
            onSave={saveDraft}
            onCancel={cancel}
            saving={isPending}
          />
        )}
        {items.length === 0 ? (
          <p className="text-sm text-court-fg-muted">No education on file. Click Add to create one.</p>
        ) : (
          <ol className="space-y-3">
            {items.map((e, i) =>
              editingIndex === i ? null : (
                <li key={i} className="rounded-lg border border-court-border/40 bg-court-surface p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-court-fg">{e.school || "—"}</div>
                      <div className="text-xs text-court-fg-muted">
                        {e.degree || "—"}
                        {rangeLabel(e.from, e.to) ? ` · ${rangeLabel(e.from, e.to)}` : ""}
                      </div>
                      {e.description && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-court-fg-muted">{e.description}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(i)}
                        className="rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAt(i)}
                        className="rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 grass:hover:bg-red-900/30"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </li>
              ),
            )}
          </ol>
        )}
      </div>
    </SectionCard>
  );
}

function rangeLabel(from: MonthYear, to: MonthYear): string {
  const f = formatMonthYear(from);
  const t = formatMonthYear(to) || "Present";
  return f ? `${f} – ${t}` : "";
}

function EntryForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: EducationRow;
  onChange: (next: EducationRow) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="rounded-lg border border-brand/30 bg-brand-tint/20 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledField label="School" value={draft.school} onChange={(v) => onChange({ ...draft, school: v })} />
        <LabeledField label="Degree" value={draft.degree} onChange={(v) => onChange({ ...draft, degree: v })} placeholder="e.g. BS, Computer Science" />
        <LabeledField
          label="From (MM/YYYY)"
          value={formatMonthYear(draft.from)}
          onChange={(v) => onChange({ ...draft, from: parseMonthYear(v) })}
        />
        <LabeledField
          label="To (MM/YYYY)"
          value={formatMonthYear(draft.to)}
          onChange={(v) => onChange({ ...draft, to: parseMonthYear(v) })}
        />
        <div className="sm:col-span-2">
          <LabeledTextarea label="Notes" value={draft.description} onChange={(v) => onChange({ ...draft, description: v })} rows={2} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
        >
          <X className="h-3 w-3" /> Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </button>
      </div>
    </div>
  );
}
