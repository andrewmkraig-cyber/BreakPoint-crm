"use client";

import type React from "react";
import { X } from "lucide-react";
import type { ToastThemeSpec } from "@/lib/toast-theme";

// Shared chrome for the in-app email + text/call toasts. Both surfaces
// use the same chip styling so the visual language stays consistent;
// keeping the helpers here means a tweak to chip padding or radio
// shape only has to land in one place.

export function ActionChip({
  theme,
  onClick,
  label,
  icon,
  primary,
  accent,
}: {
  theme: ToastThemeSpec;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  primary?: boolean;
  // accent renders the shared Submit-button look — light green tint
  // background, green border, green text — using the exact Court brand
  // tokens the `primary` variant in src/components/ui/button.tsx uses.
  // Colors live on the className so inline `style` only owns layout
  // (inline bg/color/border would otherwise beat the Tailwind classes).
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        accent
          ? "border border-court-brand bg-court-brand-tint text-court-brand-dark transition hover:bg-court-brand/25"
          : undefined
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 28,
        padding: "6px 10px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "Inter, sans-serif",
        cursor: "pointer",
        ...(accent
          ? {}
          : {
              // Primary keeps a 1px transparent border so the layout stays
              // identical when toggling primary on/off — no width shift.
              border: `1px solid ${primary ? "transparent" : theme.actionBorder}`,
              background: primary ? theme.primaryBg : theme.actionBg,
              color: primary ? theme.primaryFg : theme.actionFg,
            }),
      }}
    >
      {icon}
      {label}
    </button>
  );
}

export function DismissBtn({
  theme,
  onClick,
}: {
  theme: ToastThemeSpec;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dismiss"
      // opacity-75 baseline → hover:opacity-100 per spec. Inline
      // `style` would beat the Tailwind `:hover` selector, so the
      // baseline opacity rides the utility class instead.
      className="opacity-75 transition-opacity hover:opacity-100"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 8,
        border: `1px solid ${theme.actionBorder}`,
        background: theme.actionBg,
        color: theme.actionFg,
        cursor: "pointer",
      }}
    >
      <X size={12} />
    </button>
  );
}
