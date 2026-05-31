"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Link2, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  MERGE_FIELDS,
  templateBodyToEditorHtml,
  htmlToReadableText,
} from "@/lib/merge-fields";
import {
  RichTextBodyEditor,
  type RichTextBodyEditorHandle,
} from "@/components/rich-text-body-editor";
import { TRIGGER_OPTIONS, labelForTrigger } from "@/app/settings/template-constants";
import {
  deleteEmailTemplate,
  reorderEmailTemplate,
  upsertEmailTemplate,
  type EmailTemplateInput,
} from "@/app/settings/templates-actions";

// Reverse-index entry surfaced from the unified Templates + Triggers
// page so each template card can show which trigger(s) point at it.
// Empty array renders as a muted "Unused" pill.
export type TemplateUsage = { triggerKey: string; label: string };

export type TemplateRow = {
  id: string;
  name: string;
  subject: string;
  body: string;
  trigger: string | null;
  audience: string | null;
  category: string | null;
  isActive: boolean;
  sendAsDraft: boolean;
  sortOrder: number;
  updatedAt: string;
  usedBy: TemplateUsage[];
};

type TabId = "active" | "inactive";

const AUDIENCE_OPTIONS = ["client", "candidate", "internal"] as const;
const CATEGORY_OPTIONS = ["outreach", "interview", "submittal", "offer", "rejection", "reference"] as const;

// Shared input/select/textarea class so every form field in the template
// editor tracks the active court mode. Keeping this in one place makes it
// easy to audit and to extend later (e.g. when a fifth surface wants the
// same treatment).
const FIELD_CLASS =
  "mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-court-accent focus:outline-none focus:ring-2 focus:ring-court-accent/20";

export function TemplatesView({
  initial,
  highlightedId,
  onUsedByClick,
}: {
  initial: TemplateRow[];
  // Brief ring highlight + scrollIntoView target. Cleared by the
  // parent after the highlight pulse finishes.
  highlightedId?: string | null;
  // Fires when a recruiter clicks a "Used by: <trigger>" badge so the
  // parent can switch to the Triggers tab and scroll to that rule.
  onUsedByClick?: (triggerKey: string) => void;
}) {
  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);
  const [tab, setTab] = useState<TabId>("active");

  const { active, inactive } = useMemo(() => {
    const a: TemplateRow[] = [];
    const i: TemplateRow[] = [];
    for (const t of initial) (t.isActive ? a : i).push(t);
    return { active: a, inactive: i };
  }, [initial]);

  const visible = tab === "active" ? active : inactive;

  return (
    <div className="space-y-4">
      {/* Sub-tab strip — Active / Inactive. Counts integrated per
          ACE_DESIGN.md segmented-control rules. */}
      <div className="inline-flex rounded-md border border-court-border bg-court-surface-subtle p-1 text-sm">
        <TabButton active={tab === "active"} onClick={() => setTab("active")}>
          Active ({active.length})
        </TabButton>
        <TabButton active={tab === "inactive"} onClick={() => setTab("inactive")}>
          Inactive ({inactive.length})
        </TabButton>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-court-fg-muted">
          {visible.length === 0
            ? tab === "active"
              ? "No active templates."
              : "No inactive templates."
            : `${visible.length} ${visible.length === 1 ? "template" : "templates"}`}
        </div>
        {tab === "active" && (
          <Button type="button" size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-3.5 w-3.5" /> New template
          </Button>
        )}
      </div>

      <ul className="space-y-3">
        {visible.map((tpl, i) => (
          <TemplateCard
            key={tpl.id}
            tpl={tpl}
            isFirst={i === 0}
            isLast={i === visible.length - 1}
            onEdit={() => setEditing(tpl)}
            highlighted={highlightedId === tpl.id}
            onUsedByClick={onUsedByClick}
          />
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 font-medium transition",
        active
          ? "bg-court-surface text-court-fg shadow-sm"
          : "text-court-fg-muted hover:text-court-fg",
      )}
    >
      {children}
    </button>
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
    sendAsDraft: false,
    sortOrder: 0,
    updatedAt: new Date().toISOString(),
    usedBy: [],
  };
}

function TemplateCard({
  tpl,
  isFirst,
  isLast,
  onEdit,
  highlighted,
  onUsedByClick,
}: {
  tpl: TemplateRow;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  highlighted?: boolean;
  onUsedByClick?: (triggerKey: string) => void;
}) {
  const router = useRouter();
  const [isDeleting, startDelete] = useTransition();
  const [isToggling, startToggle] = useTransition();
  const [isReordering, startReorder] = useTransition();
  const [active, setActive] = useState(tpl.isActive);

  function onMove(direction: "up" | "down") {
    startReorder(async () => {
      const result = await reorderEmailTemplate(tpl.id, direction);
      if (!result.ok) {
        toast.error("Couldn't reorder template", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

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
    <li
      data-template-card-id={tpl.id || undefined}
      className={cn(
        "rounded-xl border bg-court-surface p-4 shadow-sm transition-shadow",
        highlighted
          ? "border-court-brand shadow-[0_0_0_2px_var(--court-brand)]"
          : "border-court-border",
      )}
    >
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
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {tpl.usedBy.length === 0 ? (
              <span className="inline-flex items-center rounded-full bg-court-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                Unused
              </span>
            ) : (
              tpl.usedBy.map((u) => (
                <button
                  key={u.triggerKey}
                  type="button"
                  onClick={() => onUsedByClick?.(u.triggerKey)}
                  className="inline-flex items-center gap-1 rounded-md border border-court-brand/40 bg-court-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-court-brand-dark transition hover:bg-court-brand/15"
                >
                  <Link2 className="h-2.5 w-2.5" /> Used by: {u.label}
                </button>
              ))
            )}
          </div>
          <div className="mt-1 text-sm text-court-fg-muted">{tpl.subject}</div>
          <pre className="mt-2 max-h-32 overflow-hidden whitespace-pre-wrap font-sans text-xs leading-relaxed text-court-fg-muted">
            {htmlToReadableText(tpl.body)}
          </pre>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {/* Up/down chevrons drive the manual order picked up by the
                mail composer's Use Template dropdown. Disabled at the
                top/bottom of the visible (active or inactive) list. */}
            <div className="inline-flex overflow-hidden rounded-md border border-court-border bg-court-surface shadow-sm">
              <button
                type="button"
                onClick={() => onMove("up")}
                disabled={isFirst || isReordering}
                aria-label="Move template up"
                className="inline-flex items-center justify-center px-1.5 py-1 text-court-fg-muted transition hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onMove("down")}
                disabled={isLast || isReordering}
                aria-label="Move template down"
                className="inline-flex items-center justify-center border-l border-court-border px-1.5 py-1 text-court-fg-muted transition hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
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
          </div>
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
              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-court-surface px-2.5 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
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
  // Body is a TipTap rich-text editor now (bold + bold merge fields).
  // Token inserts route through its imperative handle so they land at the
  // caret without disturbing existing formatting.
  const bodyEditorRef = useRef<RichTextBodyEditorHandle>(null);
  const [lastFocus, setLastFocus] = useState<"subject" | "body">("body");
  const [pickerOpen, setPickerOpen] = useState(false);

  // X-only dismissal. A half-written template is easy to lose to a stray
  // backdrop click or a reflexive Escape, so this modal closes only on the
  // X (or the explicit Cancel button) — never on overlay click, drag-off,
  // or Escape. Mirrors the dismissOnOverlay=false ModalShell pattern in
  // local-placement-rows.tsx: the overlay swallows clicks, and Escape is
  // blocked in the capture phase so it can't bubble up to a parent.
  useEffect(() => {
    function block(e: KeyboardEvent) {
      if (e.key === "Escape") e.stopPropagation();
    }
    window.addEventListener("keydown", block, { capture: true });
    return () => window.removeEventListener("keydown", block, { capture: true });
  }, []);

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
    } else {
      // Body — drop the token at the editor caret. The recruiter can then
      // select it and hit Cmd/Ctrl+B to render the inserted field bold.
      bodyEditorRef.current?.insertPlainText(token);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      // Backdrop swallows clicks instead of closing — X (or Cancel) only.
      onClick={(e) => e.stopPropagation()}
    >
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
            {/* Rich-text body (TipTap). Cmd/Ctrl+B bolds the selection,
                including an inserted merge field; getHTML() output is
                stored as the template body and rendered bold in the sent
                email by the composer + server send paths. */}
            <div className="mt-1" onFocus={() => setLastFocus("body")}>
              <RichTextBodyEditor
                ref={bodyEditorRef}
                initialHtml={templateBodyToEditorHtml(initial.body)}
                onChange={setBody}
                placeholder="Write the template body. Bold with Cmd/Ctrl+B. Use Insert Field to drop in merge fields like [Candidate First Name]."
              />
            </div>
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
                Groups templates in scoped dropdowns. E.g. the interview invite composers pull every template tagged &quot;interview&quot;.
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
          {/* Matches the "Save branding" / "Save to Ace" CTA exactly:
              transparent green-tint fill, green border + green text,
              rounded-md, with the disk icon (NOT the solid-filled green
              shared Button primary variant). */}
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
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
