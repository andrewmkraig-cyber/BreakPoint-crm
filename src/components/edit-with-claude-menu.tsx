"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Edit instruction names match the API's EditType union exactly so the
// callback can pass through without translation. "custom" opens a free-
// form instruction panel in the parent rather than firing the API
// directly — callers branch on this value in their onPick handler.
export type EditType =
  | "professional"
  | "friendly"
  | "casual"
  | "shorter"
  | "better"
  | "custom";

const OPTIONS: { type: EditType; label: string }[] = [
  { type: "professional", label: "Make it more professional" },
  { type: "friendly", label: "Make it friendlier" },
  { type: "casual", label: "Make it more casual" },
  { type: "shorter", label: "Make it shorter" },
  { type: "better", label: "Make it better (general polish)" },
  { type: "custom", label: "Custom…" },
];

// Renders the "Edit with Claude" button + 5-option dropdown. The actual
// Claude API call + body replacement live with the caller — this
// component handles trigger, menu, busy state, and the document-level
// outside-click dismiss.
export function EditWithClaudeMenu({
  isEditing,
  disabled,
  onPick,
  variant = "outline",
}: {
  isEditing: boolean;
  disabled: boolean;
  onPick: (editType: EditType) => void;
  // "outline" matches the EmailComposer toolbar's neutral button style;
  // "tinted" matches the brand-tinted Generate-with-Claude pill in the
  // /mail composer's add-on toolbar.
  variant?: "outline" | "tinted";
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Document-level mousedown listener so dismiss clicks reach their real
  // targets — same pattern we landed on for the contact picker after the
  // full-viewport overlay caused a click-trap bug.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const node = containerRef.current;
      if (node && node.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // Edit-with-Claude is the AI sibling to the Generate-with-Claude
  // pill. Renders as the shared ai-secondary variant - graphite outlined
  // pill that reads as a Claude surface in every Court Mode. The
  // variant prop is preserved on the type signature for backward
  // compat with existing call sites; both legacy values map to the
  // same canonical AI styling now.
  void variant;
  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface text-court-fg px-3 py-2 text-xs font-semibold shadow-sm transition hover:border-[#2A4D38] hover:bg-court-surface-subtle dark:hover:border-[#3A5944] focus:outline-none focus-visible:ring-2 focus-visible:ring-court-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-court-bg disabled:opacity-60";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || isEditing}
        title={
          disabled
            ? "Type something in the body first."
            : "Revise the current draft with Claude"
        }
        className={buttonClass}
      >
        {isEditing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Wand2 className="h-3 w-3" />
        )}
        Edit with Claude
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && !isEditing && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-[70] mb-1 w-64 overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg"
        >
          <ul className="py-1 text-sm">
            {OPTIONS.map((opt) => (
              <li key={opt.type}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onPick(opt.type);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-court-fg hover:bg-court-brand-tint"
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Inline panel shown below the toolbar when the recruiter picks the
// "Custom…" option in EditWithClaudeMenu. Mirrors the Generate-with-
// Claude prompt box pattern: small textarea + Cancel / Run buttons.
// The parent owns the state and the API call so the busy + error flow
// can match each composer's existing handler.
export function EditWithClaudeCustomPanel({
  value,
  onChange,
  onRun,
  onCancel,
  isRunning,
}: {
  value: string;
  onChange: (next: string) => void;
  onRun: () => void;
  onCancel: () => void;
  isRunning: boolean;
}) {
  return (
    <div className="space-y-2 border-b border-court-border bg-court-surface px-5 py-2">
      <label className="block text-[11px] uppercase tracking-wider text-court-fg-muted">
        How should Claude edit this draft?
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="e.g. Make this quirkier and more conversational"
        className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-sm text-court-fg placeholder:text-court-fg-muted/60 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isRunning}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
        >
          Cancel
        </button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onRun}
          disabled={isRunning || !value.trim()}
          className="rounded-md text-sm"
        >
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
          Run
        </Button>
      </div>
    </div>
  );
}
