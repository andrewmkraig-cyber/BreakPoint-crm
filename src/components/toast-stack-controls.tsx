"use client";

import { useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  getActiveToastCount,
  subscribeActiveToastCount,
  type ToastStackDir,
} from "@/lib/toast-prefs";

// Floating "Dismiss all" pill. Renders only when two or more in-app
// notification toasts are on screen at once (count tracked by the
// register/release calls in each toast). Anchors to the same corner the
// stack uses and sits just past the front toast so it reads as the
// stack's control: above the stack for the standard (bottom-right)
// layout, and at the top for the stack-up (top-right) layout.
export function ToastStackControls({ stackDir }: { stackDir: ToastStackDir }) {
  const count = useSyncExternalStore(
    subscribeActiveToastCount,
    getActiveToastCount,
    () => 0,
  );

  if (count < 2) return null;

  // 96px clears the 24px Toaster offset plus one ~64px toast. zIndex sits
  // above sonner's own (very high) so the pill stays clickable.
  const style: CSSProperties = {
    position: "fixed",
    right: 24,
    zIndex: 1_000_000_000,
    ...(stackDir === "up" ? { top: 96 } : { bottom: 96 }),
  };

  return (
    <button
      type="button"
      onClick={() => toast.dismiss()}
      style={style}
      className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[10px] font-semibold text-court-fg shadow-md transition hover:bg-court-surface-subtle"
    >
      <X className="h-2.5 w-2.5" />
      Dismiss all ({count})
    </button>
  );
}
