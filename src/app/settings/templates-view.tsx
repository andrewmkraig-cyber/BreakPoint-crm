"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LabeledField } from "@/app/candidates/[id]/editable-helpers";
import { MERGE_FIELDS } from "@/lib/merge-fields";
import { deleteEmailTemplate, upsertEmailTemplate, type EmailTemplateInput } from "@/app/settings/templates-actions";

export type TemplateRow = {
  id: string;
  name: string;
  subject: string;
  body: string;
  trigger: string | null;
  audience: string | null;
  isActive: boolean;
  updatedAt: string;
};

const AUDIENCE_OPTIONS = ["client", "candidate", "internal"] as const;

export function TemplatesView({ initial }: { initial: TemplateRow[] }) {
  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
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
    isActive: true,
    updatedAt: new Date().toISOString(),
  };
}

function TemplateCard({ tpl, onEdit }: { tpl: TemplateRow; onEdit: () => void }) {
  const router = useRouter();
  const [isDeleting, startDelete] = useTransition();

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

  return (
    <li className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-base font-semibold text-navy">{tpl.name}</h3>
            {tpl.trigger && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy-400">
                {tpl.trigger}
              </span>
            )}
            {tpl.audience && (
              <span className="inline-flex items-center rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-dark">
                {tpl.audience}
              </span>
            )}
            {!tpl.isActive && (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                Inactive
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-navy-400">{tpl.subject}</div>
          <pre className="mt-2 max-h-32 overflow-hidden whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">
            {tpl.body}
          </pre>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:border-brand/40 hover:text-navy"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
          >
            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-3">
          <h2 className="font-serif text-lg font-semibold text-navy">
            {initial.id ? "Edit template" : "New template"}
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5 text-sm">
          <LabeledField label="Name" value={name} onChange={setName} placeholder="e.g. Client Submittal" />

          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Subject</span>
            <input
              ref={subjectRef}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onFocus={() => setLastFocus("subject")}
              placeholder="Candidate Submittal - [Candidate First Name] | [Job Title]"
              className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>

          <div className="block text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Body</span>
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
              className="mt-1 w-full resize-vertical rounded-lg border border-border bg-white px-3 py-2 text-sm leading-relaxed text-navy placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledField label="Trigger (optional)" value={trigger} onChange={setTrigger} placeholder="e.g. client_submittal" />
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Audience</span>
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              >
                <option value="">—</option>
                {AUDIENCE_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-navy">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand/30"
            />
            Active
          </label>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-60"
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
        className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:border-brand/40 hover:text-navy"
      >
        Insert Field <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onClose} />
          <div className="absolute right-0 z-40 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-white shadow-lg">
            <ul className="max-h-80 overflow-y-auto py-1 text-sm">
              {MERGE_FIELDS.map((f) => (
                <li key={f.token}>
                  <button
                    type="button"
                    onClick={() => onPick(f.token)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-navy hover:bg-brand-tint"
                  >
                    <span className="font-medium">{f.label}</span>
                    <span className="text-[10px] text-muted-foreground">{f.token}</span>
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
