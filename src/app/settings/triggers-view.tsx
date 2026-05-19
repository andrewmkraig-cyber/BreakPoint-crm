"use client";

import { AlertTriangle, Link2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { setAutoSendCandidateConfirmation } from "@/app/settings/preferences-actions";
import { upsertTriggerRule } from "@/app/settings/triggers-actions";
import type {
  TriggerRuleRow,
  TemplateOption,
} from "@/app/settings/triggers-actions";

// Triggers panel — top: the legacy autoSendCandidateConfirmation
// preference (wired separately, still consumed by placement-actions).
// Below: one row per auto-fire trigger key, each with enable / template
// override / approve-before-send controls backed by TriggerRule.
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
  // Brief ring highlight + scrollIntoView target on the trigger row
  // whose triggerKey matches. Cleared by the parent after the pulse.
  highlightedKey?: string | null;
  // Fires when a recruiter clicks the linked template chip so the
  // parent can jump back to the Templates tab and highlight that card.
  onTemplateLinkClick?: (templateId: string) => void;
}) {
  return (
    <div className="space-y-6">
      <AutoSendCandidateConfirmationRow initial={autoSendCandidateConfirmation} />

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-court-fg">Per-trigger rules</h3>
          <p className="mt-1 text-xs text-court-fg-muted">
            Pick which template each pipeline action sends, route any of them through Gmail Drafts for approval, or pause a trigger entirely. Leaving everything default keeps the current behavior.
          </p>
        </div>
        <div className="divide-y divide-court-border rounded-md border border-court-border">
          {rules.map((rule) => (
            <TriggerRuleRowEditor
              key={rule.triggerKey}
              rule={rule}
              templates={templateOptionsByKey[rule.triggerKey] ?? []}
              gmailConnected={gmailConnected}
              highlighted={highlightedKey === rule.triggerKey}
              onTemplateLinkClick={onTemplateLinkClick}
            />
          ))}
        </div>
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

function TriggerRuleRowEditor({
  rule,
  templates,
  gmailConnected,
  highlighted,
  onTemplateLinkClick,
}: {
  rule: TriggerRuleRow;
  templates: TemplateOption[];
  gmailConnected: boolean;
  highlighted?: boolean;
  onTemplateLinkClick?: (templateId: string) => void;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(rule.enabled);
  const [sendAsDraft, setSendAsDraft] = useState(rule.sendAsDraft);
  const [templateId, setTemplateId] = useState<string | "">(rule.templateId ?? "");
  const [pending, startTransition] = useTransition();

  function save(patch: {
    enabled?: boolean;
    sendAsDraft?: boolean;
    templateId?: string | null;
  }, successMsg: string) {
    startTransition(async () => {
      const res = await upsertTriggerRule({ triggerKey: rule.triggerKey, ...patch });
      if (!res.ok) {
        // Revert local state on failure.
        setEnabled(rule.enabled);
        setSendAsDraft(rule.sendAsDraft);
        setTemplateId(rule.templateId ?? "");
        toast.error("Couldn't save trigger", { description: res.error });
        return;
      }
      toast.success(successMsg);
      router.refresh();
    });
  }

  function onToggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    save({ enabled: next }, next ? "Trigger enabled" : "Trigger paused");
  }

  function onToggleDraft() {
    const next = !sendAsDraft;
    setSendAsDraft(next);
    save(
      { sendAsDraft: next },
      next ? "Now sending to Drafts" : "Sending live",
    );
  }

  function onTemplateChange(value: string) {
    setTemplateId(value);
    save(
      { templateId: value === "" ? null : value },
      value === "" ? "Reverted to default template" : "Template assigned",
    );
  }

  const hasNoTemplates = templates.length === 0;
  // System Default fallback resolves to the most-recently-updated
  // active template whose `trigger` column matches this row's key.
  // The dropdown now surfaces every active template so the recruiter
  // can always pick an override, but the warning still fires when
  // the System Default has nothing to land on so they know why the
  // row would silently no-op.
  const hasMatchingDefault = templates.some((t) => t.matchesTrigger);

  // Warnings reflect *current* (optimistic) row state, not the saved
  // rule, so toggling enabled/draft immediately shows or hides the
  // banner the user is reasoning about.
  const warnings: string[] = [];
  if (enabled) {
    if (templateId && !templates.some((t) => t.id === templateId)) {
      warnings.push("Assigned template is missing or inactive - this trigger won't send until you reassign it.");
    } else if (!templateId && hasNoTemplates) {
      warnings.push("No active templates in the library - nothing will send until one is published.");
    } else if (!templateId && !hasMatchingDefault) {
      warnings.push("No template is tagged for this trigger, so System default won't fire. Pick an explicit template above.");
    }
  }
  if (sendAsDraft && !gmailConnected) {
    warnings.push("Approve-before-sending is on but Gmail isn't connected - drafts can't be created.");
  }

  // Linked template chip resolves the currently saved templateId
  // (override) first, falling back to the rule's snapshot for the
  // "system default" case. Clicking jumps back to the Templates tab.
  const linkedTemplate = templates.find((t) => t.id === templateId)
    ?? (rule.templateId && rule.templateName
      ? { id: rule.templateId, name: rule.templateName }
      : null);

  return (
    <div
      data-trigger-row-key={rule.triggerKey}
      className={cn(
        "flex flex-col gap-3 p-3 transition-shadow",
        highlighted && "shadow-[inset_0_0_0_2px_var(--court-brand)]",
      )}
    >
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <div className="text-sm font-semibold text-court-fg">{rule.label}</div>
          <div className="mt-1 text-xs text-court-fg-muted">{rule.description}</div>
          {linkedTemplate && (
            <button
              type="button"
              onClick={() => onTemplateLinkClick?.(linkedTemplate.id)}
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-court-brand/40 bg-court-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-court-brand-dark transition hover:bg-court-brand/15"
            >
              <Link2 className="h-2.5 w-2.5" /> Template: {linkedTemplate.name}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:w-72 sm:shrink-0">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-court-fg">Enabled</span>
            <Toggle checked={enabled} pending={pending} onToggle={onToggleEnabled} />
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-court-fg">Template</span>
            <select
              value={templateId}
              onChange={(e) => onTemplateChange(e.target.value)}
              disabled={pending || hasNoTemplates}
              className={cn(
                "w-full rounded-md border border-court-border bg-court-bg px-2 py-1 text-xs text-court-fg",
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
            {hasNoTemplates ? (
              <span className="text-[11px] text-court-fg-muted">
                No active templates in your library yet.
              </span>
            ) : !hasMatchingDefault ? (
              <span className="text-[11px] text-court-fg-muted">
                No template is tagged for this trigger. Pick one above to use it as the override.
              </span>
            ) : null}
          </label>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-court-fg">Approve before sending</span>
            <Toggle checked={sendAsDraft} pending={pending} onToggle={onToggleDraft} />
          </div>
        </div>
      </div>
    </div>
  );
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
