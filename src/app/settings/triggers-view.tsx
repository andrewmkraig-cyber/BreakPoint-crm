"use client";

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
}: {
  autoSendCandidateConfirmation: boolean;
  rules: TriggerRuleRow[];
  templateOptionsByKey: Record<string, TemplateOption[]>;
}) {
  return (
    <div className="space-y-6">
      <div className="divide-y divide-court-border-soft">
        <AutoSendCandidateConfirmationRow initial={autoSendCandidateConfirmation} />
      </div>

      <div className="space-y-2">
        <div>
          <h3 className="text-[13px] font-semibold text-court-fg">Per-trigger rules</h3>
          <p className="mt-0.5 text-[11px] text-court-fg-muted">
            Pick which template each pipeline action sends, route any of them through Gmail Drafts for approval, or pause a trigger entirely. Leaving everything default keeps the current behavior.
          </p>
        </div>
        <div className="divide-y divide-court-border-soft">
          {rules.map((rule) => (
            <TriggerRuleRowEditor
              key={rule.triggerKey}
              rule={rule}
              templates={templateOptionsByKey[rule.triggerKey] ?? []}
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
    <label className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-court-fg">
          Auto-send candidate confirmation after submittal
        </div>
        <div className="mt-0.5 text-[11px] text-court-fg-muted">
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
}: {
  rule: TriggerRuleRow;
  templates: TemplateOption[];
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

  return (
    <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 sm:flex-1">
        <div className="text-[13px] font-medium text-court-fg">{rule.label}</div>
        <div className="mt-0.5 text-[11px] text-court-fg-muted">{rule.description}</div>
      </div>

      <div className="flex flex-col gap-2 sm:w-72 sm:shrink-0">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-court-fg">Enabled</span>
          <Toggle checked={enabled} pending={pending} onToggle={onToggleEnabled} />
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-court-fg">Template</span>
          <select
            value={templateId}
            onChange={(e) => onTemplateChange(e.target.value)}
            disabled={pending || hasNoTemplates}
            className={cn(
              "h-10 w-full rounded-xl border border-court-border bg-court-surface px-3 text-[13px] text-court-fg",
              "focus:border-court-accent focus:outline-none focus:ring-2 focus:ring-court-accent/10",
              (pending || hasNoTemplates) && "opacity-60",
            )}
          >
            <option value="">System default (most recent active)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {hasNoTemplates && (
            <span className="text-[11px] text-court-fg-muted">
              No active templates assigned to this trigger yet.
            </span>
          )}
        </label>

        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-court-fg">Approve before sending</span>
          <Toggle checked={sendAsDraft} pending={pending} onToggle={onToggleDraft} />
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
        checked ? "bg-court-accent" : "bg-court-fg-muted/40",
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
