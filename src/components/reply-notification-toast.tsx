"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, HelpCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getStoredToastDurationMs, registerToast } from "@/lib/toast-prefs";

// In-app toast for a new genuine Instantly reply.
//
// Uses sonner's toast.custom, the same notification system the mail and
// text toasts already use, so duration, stacking, and the Dismiss All
// counter all behave identically. No new notification mechanism.
//
// Confirmed auto-replies NEVER reach this component - they are filtered
// out server-side by notifiableWhere() before the poller ever sees them.
// The one thing that can arrive unresolved is a reply whose auto-reply
// check exhausted its retries; that renders with an explicit "unverified"
// line so the distinction is visible rather than implied.

export type NewReplyEvent = {
  /** Ace's row id - used to mark read. */
  id: string;
  /** Instantly's email id - what the Replies list is keyed by. */
  emailId: string;
  threadId: string | null;
  campaignName: string | null;
  fromEmail: string | null;
  subject: string;
  snippet: string;
  receivedAtIso: string;
  /** Auto-reply check never completed. Shown, not hidden. */
  unverified: boolean;
};

export function renderNewReplyToast(event: NewReplyEvent) {
  toast.custom((id) => <ReplyToast event={event} toastId={id} />, {
    duration: getStoredToastDurationMs(),
  });
}

function ReplyToast({
  event,
  toastId,
}: {
  event: NewReplyEvent;
  toastId: string | number;
}) {
  const router = useRouter();
  useEffect(() => registerToast(), []);

  function open() {
    // Deep-link into the Replies pane focused on this reply. Opening it
    // marks it read (in Ace only - never in Instantly).
    router.push(`/campaigns?tab=replies&reply=${encodeURIComponent(event.emailId)}`);
    toast.dismiss(toastId);
  }

  return (
    <div className="w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-court-border bg-court-surface p-3 shadow-lg">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-court-brand-tint text-court-brand-dark"
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-court-fg">
              {event.fromEmail ?? "New reply"}
            </span>
            {event.unverified && (
              <span
                title="The auto-reply check could not be completed for this message."
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400"
              >
                <HelpCircle className="h-2.5 w-2.5" />
                Unverified
              </span>
            )}
          </div>

          <div className="mt-0.5 truncate text-xs text-court-fg">
            {event.subject || "(no subject)"}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-court-fg-muted">
            {event.snippet}
          </div>
          {event.campaignName && (
            <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-court-fg-muted">
              {event.campaignName}
            </div>
          )}
          {event.unverified && (
            <div className="mt-1 text-[10px] leading-snug text-amber-700 dark:text-amber-400">
              Auto-reply check did not complete - this may be an out-of-office.
            </div>
          )}

          <div className="mt-2">
            <Button type="button" variant="secondary" size="sm" onClick={open}>
              Open reply
            </Button>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Dismiss"
          onClick={() => toast.dismiss(toastId)}
          className="!px-1 !py-0 shadow-none"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
