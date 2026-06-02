"use client";

import { useEffect, useRef, useState } from "react";

import { TabStrip } from "@/components/ui/tab-strip";
import { TemplatesView, type TemplateRow } from "@/app/settings/templates-view";
import { TriggersView } from "@/app/settings/triggers-view";
import type {
  TemplateOption,
  TriggerRuleRow,
} from "@/app/settings/triggers-actions";

type TabId = "templates" | "triggers";

const HIGHLIGHT_CLEAR_MS = 1600;

// Wrapper that fuses the two old standalone pages into one. Uses the
// canonical TabStrip per UI Consistency Rules (Ace 43.0). Cross-link
// state (highlightedTemplateId / highlightedTriggerKey) is local so a
// click on a "Used by" badge or a "Template:" chip switches tab and
// pulses the matching row without a full navigation. Tab also syncs to
// the URL hash so /settings/templates#triggers lands on the right pane
// and survives the old /settings/triggers redirect.
export function TemplatesTriggersView({
  templates,
  rules,
  templateOptionsByKey,
  autoSendCandidateConfirmation,
  gmailConnected,
}: {
  templates: TemplateRow[];
  rules: TriggerRuleRow[];
  templateOptionsByKey: Record<string, TemplateOption[]>;
  autoSendCandidateConfirmation: boolean;
  gmailConnected: boolean;
}) {
  const [tab, setTab] = useState<TabId>("templates");
  const [highlightedTemplateId, setHighlightedTemplateId] = useState<string | null>(null);
  const [highlightedTriggerKey, setHighlightedTriggerKey] = useState<string | null>(null);

  // One-shot read of the initial URL hash so a deep link or redirect
  // from /settings/triggers lands on the right tab. We also listen for
  // hashchange so back/forward navigation keeps the tab in sync.
  useEffect(() => {
    function syncFromHash() {
      const hash = (typeof window !== "undefined" ? window.location.hash : "").replace(/^#/, "");
      if (hash === "triggers") setTab("triggers");
      else if (hash === "templates") setTab("templates");
    }
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  function changeTab(next: TabId) {
    setTab(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = next;
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }

  // Scroll the highlighted card/row into view after the tab swap renders
  // it, then clear the highlight after the pulse so the ring doesn't
  // linger on subsequent interactions.
  const clearTemplateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!highlightedTemplateId) return;
    const id = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-template-card-id="${highlightedTemplateId}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    if (clearTemplateTimer.current) clearTimeout(clearTemplateTimer.current);
    clearTemplateTimer.current = setTimeout(() => setHighlightedTemplateId(null), HIGHLIGHT_CLEAR_MS);
    return () => {
      cancelAnimationFrame(id);
      if (clearTemplateTimer.current) clearTimeout(clearTemplateTimer.current);
    };
  }, [highlightedTemplateId, tab]);

  const clearTriggerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!highlightedTriggerKey) return;
    const id = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-trigger-row-key="${highlightedTriggerKey}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    if (clearTriggerTimer.current) clearTimeout(clearTriggerTimer.current);
    clearTriggerTimer.current = setTimeout(() => setHighlightedTriggerKey(null), HIGHLIGHT_CLEAR_MS);
    return () => {
      cancelAnimationFrame(id);
      if (clearTriggerTimer.current) clearTimeout(clearTriggerTimer.current);
    };
  }, [highlightedTriggerKey, tab]);

  function onTemplateLinkClick(templateId: string) {
    setHighlightedTemplateId(templateId);
    changeTab("templates");
  }

  return (
    <div className="space-y-4">
      <TabStrip<TabId>
        ariaLabel="Templates and Triggers"
        items={[
          { id: "templates", label: "Templates", count: templates.length },
          { id: "triggers", label: "Triggers", count: rules.length },
        ]}
        activeId={tab}
        onChange={changeTab}
      />

      {tab === "templates" ? (
        <TemplatesView
          initial={templates}
          highlightedId={highlightedTemplateId}
        />
      ) : (
        <TriggersView
          autoSendCandidateConfirmation={autoSendCandidateConfirmation}
          rules={rules}
          templateOptionsByKey={templateOptionsByKey}
          gmailConnected={gmailConnected}
          highlightedKey={highlightedTriggerKey}
          onTemplateLinkClick={onTemplateLinkClick}
        />
      )}
    </div>
  );
}
