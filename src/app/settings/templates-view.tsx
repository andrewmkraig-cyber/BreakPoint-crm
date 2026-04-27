"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MERGE_FIELDS } from "@/lib/merge-fields";
import { TRIGGER_OPTIONS, labelForTrigger } from "@/app/settings/template-constants";
import { deleteEmailTemplate, upsertEmailTemplate, type EmailTemplateInput } from "@/app/settings/templates-actions";

export type TemplateRow = {
  id: string;
  name: string;
  subject: string;
  body: string;
  trigger: string | null;
  audience: string | null;
  category: string | null;
  isActive: boolean;
  updatedAt: string;
};

const AUDIENCE_OPTIONS = ["client", "candidate", "internal"] as const;
const CATEGORY_OPTIONS = ["interview", "submittal", "offer", "rejection", "reference"] as const;

// Shared input/select/textarea class so every form field in the template
// editor tracks the active court mode. Keeping this in one place makes it
// easy to audit and to extend later (e.g. when a fifth surface wants the
// same treatment).
const FIELD_CLASS =
  "mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-court-accent focus:outline-none focus:ring-2 focus:ring-court-accent/20";

export function TemplatesView({ initial }: { initial: TemplateRow[] }) {
  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-court-fg-muted">
          {initial.length === 0
            ? "No templates yet."
            : `${initial.length} ${initial.length === 1 ? "template" : "templates"} on file`}
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
        >
          <Plus className="h-3.5 w-3.5" /> New template
        </button>
      </div>

      <ul className="space-y-3">
        {initial.map((tpl) => (
          <TemplateCard key={tpl.id} tpl={tpl} onEdit={() => setEditing(tpl)} />
        ))}
      </ul>

      {editing !== null && (
        <TemplateEditor
          initial={editing === "new" ? newTemplate() : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function newTemplate(): TemplateRow {
  return {
    id: "",
    name: "",
    subject: "",
    body: "",
    trigger: null,
    audience: null,
    category: null,
    isActive: true,
    updatedAt: new Date().toISOString(),
  };
}

function TemplateCard({ tpl, onEdit }: { tpl: TemplateRow; onEdit: () => void }) {
  const router = useRouter();
  const [isDeleting, startDelete] = useTransition();
  const [isToggling, startToggle] = useTransition();
  const [active, setActive] = useState(tpl.isActive);

  function onDelete() {
    if (!confirm(`Delete "${tpl.name}"? This can't be undone.`)) return;
    startDelete(async () => {
      const result = await deleteEmailTemplate(tpl.id);
      if (!result.ok) {
        toast.error("Couldn't delete template", { description: result.error });
        return;
      }
      toast.success("Template deleted");
      router.refresh();
    });
  }

  function onToggleActive(next: boolean) {
    setActive(next);
    startToggle(async () => {
      const result = await upsertEmailTemplate({
        id: tpl.id,
        name: tpl.name,
        subject: tpl.subject,
        body: tpl.body,
        trigger: tpl.trigger,
        audience: tpl.audience,
        category: tpl.category,
        isActive: next,
      });
      if (!result.ok) {
        setActive(!next);
        toast.error("Couldn't update template", { description: result.error });
        return;
      }
      toast.success(next ? "Template enabled" : "Template disabled");
      router.refresh();
    });
  }

  return (
    <li className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-serif text-base font-semibold text-court-fg">{tpl.name}</h3>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                tpl.trigger
                  ? "bg-court-accent-tint text-court-accent-dark"
                  : "bg-court-surface-subtle text-court-fg-muted",
              )}
            >
              Trigger: {labelForTrigger(tpl.trigger)}
            </span>
            {tpl.audience && (
              <span className="inline-flex items-center rounded-full bg-court-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                {tpl.audience}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-court-fg-muted">{tpl.subject}</div>
          <pre className="mt-2 max-h-32 overflow-hidden whitespace-pre-wrap font-sans text-xs leading-relaxed text-court-fg-muted">
            {tpl.body}
          </pre>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <label className="inline-flex items-center gap-2 text-[11px] text-court-fg">
            <button
              type="button"
              role="switch"
              aria-checked={active}
              onClick={() => onToggleActive(!active)}
              disabled={isToggling}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
                active ? "bg-brand" : "bg-court-fg-muted/40",
                isToggling && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white shadow transition",
                  active ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
            {active ? "Active" : "Inactive"}
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-court-accent/40 hover:text-court-fg"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
            {/* Destructive action keeps red semantics in all three modes. */}
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-court-surface px-2.5 py-1 text-[11px] font-medium text-red-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
            >
              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function TemplateEditor({ initial, onClose }: { initial: TemplateRow; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [trigger, setTrigger] = useState(initial.trigger ?? "");
  const [audience, setAudience] = useState(initial.audience ?? "");
  const [category, setCategory] = useState(initial.category ?? "");
  const [isActive, setIsActive] = useState(initial.isActive);
  const [err, setErr] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [lastFocus, setLastFocus] = useState<"subject" | "body">("body");
  const [pickerOpen, setPickerOpen] = useState(false);

  function insertAtCursor(token: string) {
    if (lastFocus === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const next = el.value.slice(0, start) + token + el.value.slice(end);
      setSubject(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else if (bodyRef.current) {
      const el = bodyRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const next = el.value.slice(0, start) + token + el.value.slice(end);
      setBody(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      // No ref yet — append to body as a safe default.
      setBody((prev) => prev + token);
    }
    setPickerOpen(false);
  }

  function onSave() {
    setErr(null);
    const payload: EmailTemplateInput = {
      id: initial.id || undefined,
      name,
      subject,
      body,
      trigger: trigger || null,
      audience: audience || null,
      category: category || null,
      isActive,
    };
    startSave(async () => {
      const result = await upsertEmailTemplate(payload);
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't save template", { description: result.error });
        return;
      }
      toast.success("Template saved");
      onClose();
      router.refresh();
    });
  }

  return (
    // Modal backdrop is navy-tinted on every mode — reads as "darker than
    // whatever's behind me" regardless of theme, which is what a dialog
    // overlay wants.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-court-border px-5 py-3">
          <h2 className="font-serif text-lg font-semibold text-court-fg">
            {initial.id ? "Edit template" : "New template"}
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5 text-sm">
          {/* Inlined rather than using the shared LabeledField from
              editable-helpers, which still carries Hard-only classes and
              is used site-wide — theming it would balloon this slice. */}
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Client Submittal"
              className={FIELD_CLASS}
            />
          </label>

          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Subject</span>
            <input
              ref={subjectRef}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onFocus={() => setLastFocus("subject")}
              placeholder="Candidate Submittal - [Candidate First Name] | [Job Title]"
              className={FIELD_CLASS}
            />
          </label>

          <div className="block text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Body</span>
              <MergeFieldPicker
                open={pickerOpen}
                onToggle={() => setPickerOpen((v) => !v)}
                onPick={insertAtCursor}
                onClose={() => setPickerOpen(false)}
              />
            </div>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onFocus={() => setLastFocus("body")}
              rows={14}
              placeholder="Write the template body. Use the Insert Field picker to drop in merge fields like [Candidate First Name]."
              className={cn(FIELD_CLASS, "resize-vertical leading-relaxed")}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Trigger</span>
              <select
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                className={FIELD_CLASS}
              >
                {TRIGGER_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-court-fg-muted">
                {TRIGGER_OPTIONS.find((t) => t.value === trigger)?.description ?? ""}
              </span>
            </label>
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Audience</span>
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">—</option>
                {AUDIENCE_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">—</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-court-fg-muted">
                Groups templates in scoped dropdowns — e.g. the interview invite composers pull every template tagged &quot;interview&quot;.
              </span>
            </label>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-court-fg">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-court-border text-court-accent focus:ring-court-accent/30"
            />
            Active
          </label>
          {/* Error panel keeps red semantics — same reasoning as the
              destructive delete button above. */}
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-court-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60",
            )}
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function MergeFieldPicker({
  open,
  onToggle,
  onPick,
  onClose,
}: {
  open: boolean;
  onToggle: () => void;
  onPick: (token: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-court-accent/40 hover:text-court-fg"
      >
        Insert Field <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onClose} />
          <div className="absolute right-0 z-40 mt-1 w-64 overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg">
            <ul className="max-h-80 overflow-y-auto py-1 text-sm">
              {MERGE_FIELDS.map((f) => (
                <li key={f.token}>
                  <button
                    type="button"
                    onClick={() => onPick(f.token)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-court-fg hover:bg-court-accent-tint"
                  >
                    <span className="font-medium">{f.label}</span>
                    <span className="text-[10px] text-court-fg-muted">{f.token}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
