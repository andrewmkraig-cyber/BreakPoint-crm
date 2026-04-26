"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Wand2 } from "lucide-react";

// Edit instruction names match the API's EditType union exactly so the
// callback can pass through without translation.
export type EditType = "professional" | "friendly" | "casual" | "shorter" | "better";

const OPTIONS: { type: EditType; label: string }[] = [
  { type: "professional", label: "Make it more professional" },
  { type: "friendly", label: "Make it friendlier" },
  { type: "casual", label: "Make it more casual" },
  { type: "shorter", label: "Make it shorter" },
  { type: "better", label: "Make it better (general polish)" },
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

  const buttonClass =
    variant === "tinted"
      ? "inline-flex items-center gap-1.5 rounded-md border border-brand/30 bg-brand-tint/40 px-2 py-1 text-[11px] font-medium text-brand-dark shadow-sm transition hover:bg-brand-tint/60 disabled:opacity-60"
      : "inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-semibold text-court-fg shadow-sm transition hover:border-brand/40 hover:text-brand-dark disabled:opacity-60";

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
          <Loader2 className={variant === "tinted" ? "h-3 w-3 animate-spin" : "h-3.5 w-3.5 animate-spin"} />
        ) : (
          <Wand2 className={variant === "tinted" ? "h-3 w-3" : "h-3.5 w-3.5"} />
        )}
        Edit with Claude
        <ChevronDown className={variant === "tinted" ? "h-3 w-3" : "h-3.5 w-3.5"} />
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
                  className="block w-full px-3 py-1.5 text-left text-court-fg hover:bg-brand-tint"
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
