"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setAutoSendCandidateConfirmation } from "@/app/settings/preferences-actions";

// Standalone Triggers panel. One toggle today (auto-send candidate
// confirmation after submittal) — designed to grow as more event-
// driven sends move out of hardcoded server actions.
export function TriggersView({
  autoSendCandidateConfirmation,
}: {
  autoSendCandidateConfirmation: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(autoSendCandidateConfirmation);
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
    <div className="space-y-3">
      <label className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-court-fg">
            Auto-send candidate confirmation after submittal
          </div>
          <div className="mt-1 text-xs text-court-fg-muted">
            When on, the &ldquo;BreakPoint Talent has reviewed&hellip;&rdquo; email is sent immediately after a successful client submittal. When off, it lands in your Gmail Drafts for review.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onToggle(!enabled)}
          disabled={pending}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
            enabled ? "bg-brand" : "bg-court-fg-muted/40",
            pending && "opacity-60",
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
              enabled ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </button>
      </label>
    </div>
  );
}
