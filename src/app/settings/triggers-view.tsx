"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Link2,
  Loader2,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { setAutoSendCandidateConfirmation } from "@/app/settings/preferences-actions";
import {
  deleteTriggerRule,
  upsertTriggerRule,
} from "@/app/settings/triggers-actions";
import type {
  TriggerRuleRow,
  TemplateOption,
} from "@/app/settings/triggers-actions";

// Triggers panel — top: the legacy autoSendCandidateConfirmation
// preference (still consumed by the placement-actions submittal flow,
// pre-dates the TriggerRule model). Below: one card per built-in
// trigger with Edit / Pause / Reset-to-default actions.
//
// Design note: the trigger taxonomy is hardcoded in TRIGGER_OPTIONS
// because every fire path is a literal `trigger: "<key>"` call in the
// action layer. There's no event registry that a runtime-created
// trigger could attach to, so the UI deliberately does NOT expose an
// "Add Custom Trigger" affordance — adding a row to TriggerRule with
// an unknown key would never fire from any code path. The info banner
// at the top of the list explains this so the absence is intentional,
// not an oversight.
export function TriggersView({
  autoSendCandidateConfirmation,
  rules,
  templateOptionsByKey,
  gmailConnected,
  highlightedKey,
  onTemplateLinkClick,
}: {
  autoSendCandidateConfirmation: boolean;
  rules: TriggerRuleRow[];
  templateOptionsByKey: Record<string, TemplateOption[]>;
  gmailConnected: boolean;
  // Brief ring highlight + scrollIntoView target on the trigger card
  // whose triggerKey matches. Cleared by the parent after the pulse.
  highlightedKey?: string | null;
  // Fires when a recruiter clicks the linked template chip so the
  // parent can jump back to the Templates tab and highlight that card.
  onTemplateLinkClick?: (templateId: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <AutoSendCandidateConfirmationRow initial={autoSendCandidateConfirmation} />

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-court-fg">Pipeline triggers</h3>
          <p className="mt-1 text-xs text-court-fg-muted">
            Each card maps a built-in pipeline event to the template that fires when it happens. Edit to change the template or send behavior, Pause to stop a trigger temporarily, or Reset to drop your customization and return to defaults.
          </p>
        </div>

        <BuiltInsNote />

        <div className="space-y-2">
          {rules.map((rule) => (
            <TriggerCard
              key={rule.triggerKey}
              rule={rule}
              templates={templateOptionsByKey[rule.triggerKey] ?? []}
              gmailConnected={gmailConnected}
              highlighted={highlightedKey === rule.triggerKey}
              onTemplateLinkClick={onTemplateLinkClick}
              onEdit={() => setEditing(rule.triggerKey)}
            />
          ))}
        </div>
      </div>

      {editing && (
        <TriggerEditDialog
          rule={rules.find((r) => r.triggerKey === editing)!}
          templates={templateOptionsByKey[editing] ?? []}
          gmailConnected={gmailConnected}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// Persistent explainer card sitting above the trigger list. Lives here
// (not as floating help docs) so a recruiter looking for "Add Trigger"
// finds the answer in-place instead of filing a support question.
function BuiltInsNote() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-court-border bg-court-surface-subtle/40 px-3 py-2 text-[12px] text-court-fg-muted">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-court-fg-muted" aria-hidden />
      <div>
        <span className="font-semibold text-court-fg">Built-in triggers only.</span>{" "}
        Each trigger is bound to a fixed pipeline action in code (Apply, Submit, Schedule Interview, Record Offer, Confirm Start, Reject, Request References). You can change which template fires or pause a trigger, but custom event keys can&apos;t be added from settings because no code path would emit them.
      </div>
    </div>
  );
}

function AutoSendCandidateConfirmationRow({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();

  function onToggle(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const res = await setAutoSendCandidateConfirmation(next);
      if (!res.ok) {
        setEnabled(!next);
        toast.error("Couldn't save trigger", { description: res.error });
        return;
      }
      toast.success(next ? "Auto-send on" : "Auto-send off");
      router.refresh();
    });
  }

  return (
    <label className="flex items-start justify-between gap-4 rounded-md border border-court-border p-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-court-fg">
          Auto-send candidate confirmation after submittal
        </div>
        <div className="mt-1 text-xs text-court-fg-muted">
          When on, the &ldquo;BreakPoint Talent has reviewed&hellip;&rdquo; email is sent immediately after a successful client submittal. When off, it lands in your Gmail Drafts for review.
        </div>
      </div>
      <Toggle checked={enabled} pending={pending} onToggle={() => onToggle(!enabled)} />
    </label>
  );
}

// One card per built-in trigger. Shows status + metadata + the linked
// template, with Edit / Pause-Resume / Reset-to-default actions on the
// right. Reset uses a two-click inline confirm (not window.confirm) so
// the destructive path matches the per-row reset pattern used elsewhere
// in settings.
function TriggerCard({
  rule,
  templates,
  gmailConnected,
  highlighted,
  onTemplateLinkClick,
  onEdit,
}: {
  rule: TriggerRuleRow;
  templates: TemplateOption[];
  gmailConnected: boolean;
  highlighted?: boolean;
  onTemplateLinkClick?: (templateId: string) => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, startTransition] = useTransition();

  // Linked template chip resolves to the explicit override first, then
  // falls back to whatever the System default would pick — that
  // mirrors the runtime resolution in fireTriggerAndLog and means the
  // card always tells the recruiter which template a fire would land
  // on right now.
  const explicit = templates.find((t) => t.id === rule.templateId);
  const fallback = templates.find((t) => t.matchesTrigger);
  const effectiveTemplate = explicit ?? fallback ?? null;
  const usingDefault = !rule.templateId;

  function onPauseResume() {
    const next = !rule.enabled;
    startTransition(async () => {
      const res = await upsertTriggerRule({ triggerKey: rule.triggerKey, enabled: next });
      if (!res.ok) {
        toast.error("Couldn't save trigger", { description: res.error });
        return;
      }
      toast.success(next ? "Trigger enabled" : "Trigger paused");
      router.refresh();
    });
  }

  function onReset() {
    startTransition(async () => {
      const res = await deleteTriggerRule({ triggerKey: rule.triggerKey });
      if (!res.ok) {
        toast.error("Couldn't reset trigger", { description: res.error });
        return;
      }
      toast.success("Reset to default", {
        description: `${rule.label} now uses System default behavior.`,
      });
      setConfirmReset(false);
      router.refresh();
    });
  }

  // Diagnostic banner over each card. Mirrors the legacy inline warning
  // set but reads off rule state directly so a paused / default-only /
  // no-Gmail row surfaces the right call-to-action.
  const warnings: string[] = [];
  if (rule.enabled) {
    if (rule.templateId && !explicit) {
      warnings.push("Assigned template is missing or inactive — this trigger won't send until you reassign it.");
    } else if (!rule.templateId && !fallback) {
      warnings.push("No template is tagged for this trigger, so System default has nothing to send. Edit and pick one.");
    }
    if (rule.dispatch === "auto-send" && !gmailConnected) {
      warnings.push("Gmail isn't connected, so this trigger can't send its email. Reconnect Gmail in Settings.");
    }
  }

  return (
    <div
      data-trigger-row-key={rule.triggerKey}
      className={cn(
        "rounded-lg border border-court-border bg-court-surface p-4 transition-shadow",
        highlighted && "shadow-[inset_0_0_0_2px_var(--court-brand)]",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill enabled={rule.enabled} customized={rule.hasRule} />
            <span className="text-sm font-semibold text-court-fg">{rule.label}</span>
          </div>
          <p className="mt-1 text-xs text-court-fg-muted">{rule.description}</p>

          <dl className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
            <Meta label="Event" value={rule.eventName} />
            <Meta label="Audience" value={audienceLabel(rule.audience)} />
            <Meta label="Dispatch" value={dispatchLabel(rule.dispatch)} />
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-court-fg-muted">
              Template:
            </span>
            {effectiveTemplate ? (
              <button
                type="button"
                onClick={() => onTemplateLinkClick?.(effectiveTemplate.id)}
                className="inline-flex items-center gap-1 rounded-md border border-court-brand/40 bg-court-brand-tint px-2 py-0.5 text-[11px] font-medium text-court-brand-dark transition hover:bg-court-brand/15"
                title="Open this template"
              >
                <Link2 className="h-2.5 w-2.5" /> {effectiveTemplate.name}
              </button>
            ) : (
              <span className="text-[11px] italic text-court-fg-muted">
                None — fire will skip
              </span>
            )}
            {usingDefault && effectiveTemplate && (
              <span className="text-[11px] italic text-court-fg-muted">
                (System default)
              </span>
            )}
          </div>

          {warnings.length > 0 && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <ul className="space-y-1">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-row items-start gap-1.5 sm:flex-col sm:items-end">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onEdit}
            disabled={pending}
            title="Edit this trigger"
          >
            <Pencil className="h-3 w-3" /> Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onPauseResume}
            disabled={pending}
            title={rule.enabled ? "Pause this trigger" : "Resume this trigger"}
          >
            {rule.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {rule.enabled ? "Pause" : "Resume"}
          </Button>
          {!confirmReset ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirmReset(true)}
              disabled={pending || !rule.hasRule}
              title={
                rule.hasRule
                  ? "Drop your customization and return to System default"
                  : "Already at System default"
              }
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </Button>
          ) : (
            <div className="flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-1">
              <span className="text-[11px] font-medium text-red-800">Reset?</span>
              <button
                type="button"
                onClick={onReset}
                disabled={pending}
                className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
              >
                {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                disabled={pending}
                className="rounded px-1.5 py-0.5 text-[11px] text-red-700 hover:bg-red-100 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Edit modal — the deliberate editor surface. Exposes the per-trigger
// controls (template + enabled) plus a read-only event/audience/dispatch
// header so the recruiter sees what the trigger actually does. The
// approve-before-sending toggle was removed Ace 70.0 — triggers always
// send directly. All saves go through a single Save action — no
// per-field optimistic writes — so Cancel rolls back unsaved changes.
function TriggerEditDialog({
  rule,
  templates,
  gmailConnected,
  onClose,
}: {
  rule: TriggerRuleRow;
  templates: TemplateOption[];
  gmailConnected: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(rule.enabled);
  const [templateId, setTemplateId] = useState<string>(rule.templateId ?? "");
  const [pending, startTransition] = useTransition();

  const hasNoTemplates = templates.length === 0;
  const hasMatchingDefault = templates.some((t) => t.matchesTrigger);

  function onSave() {
    startTransition(async () => {
      const res = await upsertTriggerRule({
        triggerKey: rule.triggerKey,
        enabled,
        templateId: templateId === "" ? null : templateId,
      });
      if (!res.ok) {
        toast.error("Couldn't save trigger", { description: res.error });
        return;
      }
      toast.success("Trigger saved");
      router.refresh();
      onClose();
    });
  }

  // Warnings reflect the in-flight (un-saved) form values so the
  // recruiter sees the consequences of their picks before they commit.
  const warnings: string[] = [];
  if (enabled) {
    if (templateId && !templates.some((t) => t.id === templateId)) {
      warnings.push("Selected template is missing or inactive.");
    } else if (!templateId && hasNoTemplates) {
      warnings.push("No active templates in the library yet — publish one first or this trigger will skip.");
    } else if (!templateId && !hasMatchingDefault) {
      warnings.push("No template is tagged for this trigger, so System default would skip. Pick an explicit template above.");
    }
    if (rule.dispatch === "auto-send" && !gmailConnected) {
      warnings.push("Gmail isn't connected, so this trigger can't send its email. Reconnect Gmail in Settings.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-court-border bg-court-surface p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-court-fg">Edit trigger</h2>
            <p className="mt-0.5 text-xs text-court-fg-muted">{rule.label}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Read-only event identity card. These fields aren't editable
            because the trigger is wired to a specific code call-site —
            changing them in the DB wouldn't change what actually fires.
            Layout (2026-05-27): mobile = 1 col, tablet = 2 col, desktop
            = 4 col so the long trigger key never overlaps the Event
            value on the same row. The code <code> gets break-all so an
            extra-long key wraps instead of bleeding into the next cell. */}
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-court-border bg-court-surface-subtle/40 p-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
          <Meta
            label="Trigger key"
            value={
              <code className="block break-all text-[11px] leading-snug">
                {rule.triggerKey}
              </code>
            }
          />
          <Meta label="Event" value={rule.eventName} />
          <Meta label="Audience" value={audienceLabel(rule.audience)} />
          <Meta label="Dispatch" value={dispatchLabel(rule.dispatch)} />
        </div>

        <p className="mb-4 text-xs text-court-fg-muted">{rule.description}</p>

        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-court-fg">Enabled</div>
              <div className="text-[11px] text-court-fg-muted">
                When off, this trigger short-circuits without sending.
              </div>
            </div>
            <Toggle checked={enabled} pending={pending} onToggle={() => setEnabled((p) => !p)} />
          </label>

          <label className="block">
            <div className="text-sm font-medium text-court-fg">Template</div>
            <div className="mt-0.5 text-[11px] text-court-fg-muted">
              Pin a specific template for this org, or leave on System default to use the most-recently-updated template tagged for this trigger.
            </div>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={pending || hasNoTemplates}
              className={cn(
                "mt-2 w-full rounded-md border border-court-border bg-court-bg px-3 py-2 text-sm text-court-fg",
                "focus:outline-none focus:ring-2 focus:ring-brand/40",
                (pending || hasNoTemplates) && "opacity-60",
              )}
            >
              <option value="">System default (most recent active)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.matchesTrigger ? `${t.name} (tagged for this trigger)` : t.name}
                </option>
              ))}
            </select>
          </label>

          {warnings.length > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <ul className="space-y-1">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={onSave} disabled={pending}>
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            <span>Save</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ enabled, customized }: { enabled: boolean; customized: boolean }) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        <Pause className="h-2.5 w-2.5" /> Paused
      </span>
    );
  }
  if (customized) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-court-brand/40 bg-court-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-court-brand-dark">
        <CheckCircle2 className="h-2.5 w-2.5" /> Active · customized
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-court-border bg-court-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
      <CheckCircle2 className="h-2.5 w-2.5" /> Active · default
    </span>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {label}
      </dt>
      <dd className="mt-0.5 min-w-0 text-xs text-court-fg">{value}</dd>
    </div>
  );
}

function audienceLabel(a: TriggerRuleRow["audience"]): string {
  switch (a) {
    case "candidate":
      return "Candidate";
    case "client":
      return "Client";
    case "client+candidate":
      return "Client (cc candidate)";
    default:
      return a;
  }
}

function dispatchLabel(d: TriggerRuleRow["dispatch"]): string {
  switch (d) {
    case "auto-send":
      return "Auto-send";
    case "compose-prefill":
      return "Compose prefill";
    default:
      return d;
  }
}

function Toggle({
  checked,
  pending,
  onToggle,
}: {
  checked: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      disabled={pending}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        checked ? "bg-brand" : "bg-court-fg-muted/40",
        pending && "opacity-60",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
