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

export type ExperienceRow = {
  designation: string;
  organization: string;
  description: string;
  from: MonthYear;
  to: MonthYear;
};

const EMPTY: ExperienceRow = {
  designation: "",
  organization: "",
  description: "",
  from: [null, null],
  to: [null, null],
};

export function EditableExperience({
  candidateId,
  initial,
}: {
  candidateId: number;
  initial: ExperienceRow[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<ExperienceRow[]>(initial);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<ExperienceRow>(EMPTY);
  const [isPending, startSave] = useTransition();
  const [adding, setAdding] = useState(false);

  function persist(next: ExperienceRow[]) {
    const snapshot = items;
    setItems(next);
    startSave(async () => {
      const result = await updateCandidate({
        id: candidateId,
        experience: next.map((e, i) => ({
          designation: e.designation.trim(),
          organization: e.organization.trim(),
          description: e.description.trim() || null,
          from: e.from,
          to: e.to,
          rank: i + 1,
        })),
      });
      if (!result.ok) {
        setItems(snapshot);
        toast.error("Couldn't save experience", { description: result.error });
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
    if (!draft.designation.trim() && !draft.organization.trim()) {
      toast.error("Title or employer is required");
      return;
    }
    let next: ExperienceRow[];
    if (adding) {
      next = [draft, ...items];
    } else if (editingIndex != null) {
      next = items.map((e, i) => (i === editingIndex ? draft : e));
    } else {
      return;
    }
    cancel();
    persist(next);
    toast.success(adding ? "Experience added" : "Experience saved");
  }

  function removeAt(i: number) {
    const t = items[i];
    if (!confirm(`Delete ${t.designation || "this experience"}?`)) return;
    persist(items.filter((_, idx) => idx !== i));
  }

  return (
    <SectionCard
      title="Experience"
      right={
        !adding && editingIndex == null ? (
          <div className="flex items-center gap-2">
            {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            <button
              type="button"
              onClick={startAdd}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:border-brand/40 hover:text-navy"
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
          <p className="text-sm text-muted-foreground">No experience on file. Click Add to create one.</p>
        ) : (
          <ol className="space-y-3">
            {items.map((e, i) =>
              editingIndex === i ? null : (
                <li key={i} className="rounded-lg border border-border bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-navy">{e.designation || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.organization || "—"}
                        {rangeLabel(e.from, e.to) ? ` · ${rangeLabel(e.from, e.to)}` : ""}
                      </div>
                      {e.description && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{e.description}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(i)}
                        className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:text-navy"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAt(i)}
                        className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50"
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
  draft: ExperienceRow;
  onChange: (next: ExperienceRow) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="rounded-lg border border-brand/30 bg-brand-tint/20 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledField
          label="Title"
          value={draft.designation}
          onChange={(v) => onChange({ ...draft, designation: v })}
        />
        <LabeledField
          label="Employer"
          value={draft.organization}
          onChange={(v) => onChange({ ...draft, organization: v })}
        />
        <LabeledField
          label="From (MM/YYYY)"
          value={formatMonthYear(draft.from)}
          onChange={(v) => onChange({ ...draft, from: parseMonthYear(v) })}
          placeholder="03/2020"
        />
        <LabeledField
          label="To (MM/YYYY, blank = current)"
          value={formatMonthYear(draft.to)}
          onChange={(v) => onChange({ ...draft, to: parseMonthYear(v) })}
          placeholder="leave blank for present"
        />
        <div className="sm:col-span-2">
          <LabeledTextarea
            label="Description"
            value={draft.description}
            onChange={(v) => onChange({ ...draft, description: v })}
            rows={3}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:text-navy"
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
