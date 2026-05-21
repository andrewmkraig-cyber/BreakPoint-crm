"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, RotateCw, X } from "lucide-react";
import { toast } from "sonner";

// Polls for the signed-in user's failed scheduled ("Send Later") emails
// and raises a toast for each, with the subject line and a Retry button.
// Mounted once in the app shell so a failure that happens while the cron
// fires (the recruiter isn't looking at the composer) still surfaces.
//
// Dedup: we track shown rows by id + attempt count, so a failed retry
// (attempts bumps) re-surfaces, but the same failure never double-toasts
// within a session. Dismiss acks the row server-side so it doesn't come
// back after a reload.

type FailedItem = {
  id: string;
  subject: string;
  to: string[];
  lastError: string | null;
  attempts: number;
  scheduledSendAt: string;
  timezone: string;
};

const POLL_MS = 60_000;

export function ScheduledSendFailureToaster() {
  const shown = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch("/api/mail/scheduled/failed", {
          cache: "no-store",
        });
        if (!res.ok || !active) return;
        const data = (await res.json()) as { items?: FailedItem[] };
        if (!active) return;
        for (const item of data.items ?? []) {
          const key = `${item.id}:${item.attempts}`;
          if (shown.current.has(key)) continue;
          shown.current.add(key);
          renderFailureToast(item);
        }
      } catch {
        // Best-effort; the next tick retries.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return null;
}

function renderFailureToast(item: FailedItem) {
  const id = `sched-fail-${item.id}-${item.attempts}`;
  toast.custom(
    () => <FailureToast item={item} toastId={id} />,
    { id, duration: Infinity },
  );
}

function FailureToast({
  item,
  toastId,
}: {
  item: FailedItem;
  toastId: string | number;
}) {
  const subject = item.subject?.trim() || "(no subject)";

  async function onRetry() {
    toast.dismiss(toastId);
    try {
      const res = await fetch(
        `/api/mail/scheduled/${encodeURIComponent(item.id)}/retry`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (res.ok && body?.ok) {
        toast.success("Email sent", { description: truncate(subject, 80) });
      } else {
        toast.error("Retry failed", {
          description: body?.error ?? `(${res.status})`,
        });
      }
    } catch (e) {
      toast.error("Retry failed", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    }
  }

  async function onDismiss() {
    toast.dismiss(toastId);
    try {
      await fetch(`/api/mail/scheduled/${encodeURIComponent(item.id)}/ack`, {
        method: "POST",
      });
    } catch {
      // Acked best-effort; the session dedup still suppresses a repeat.
    }
  }

  return (
    <div className="relative flex w-[330px] max-w-[94vw] items-start gap-2.5 rounded-xl border border-red-300 bg-court-surface px-3 py-2.5 shadow-[0_8px_22px_rgba(0,0,0,0.08)]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 shadow-sm">
        <AlertTriangle className="h-4 w-4 text-red-600" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="pr-5 text-[12px] font-semibold leading-tight text-court-fg">
          Scheduled email failed to send
        </div>
        <div className="mt-0.5 truncate text-[11px] font-medium text-court-fg-muted">
          {truncate(subject, 80)}
        </div>
        {item.lastError ? (
          <div className="mt-0.5 truncate text-[10px] text-red-600">
            {truncate(item.lastError, 90)}
          </div>
        ) : null}
        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-lg border border-court-brand bg-court-brand-tint px-2 py-1 text-[10px] font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25"
          >
            <RotateCw className="h-2.5 w-2.5" />
            Retry
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-md border border-court-border bg-court-surface text-court-fg-muted shadow-sm transition hover:text-court-fg"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
