"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleSlash, EyeOff, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteJob,
  inactivateJob,
  makeJobPrivate,
  reactivateJob,
  type JobLifecycle,
} from "@/app/jobs/[id]/job-overview-actions";

// Lifecycle-aware action row on the Job Overview tab. The set of
// affordances varies by current state:
//   active   → Make Private, Inactivate, Delete
//   private  → Reactivate, Inactivate, Delete
//   inactive → Reactivate, Make Private, Delete
// Delete is always destructive (two-click confirm) and lives at the
// far right so the recruiter can't fat-finger it from a state-change
// flow. onBlur on the destructive button resets the confirm so a
// stray tab-out doesn't leave a primed action sitting on the page.
export function JobOverviewActionButtons({
  jobId,
  lifecycle,
}: {
  jobId: string;
  lifecycle: JobLifecycle;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionLabel, setActionLabel] = useState<string | null>(null);

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successLabel: string,
    activeLabel: string,
  ) {
    if (pending) return;
    setActionLabel(activeLabel);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(`Couldn't ${successLabel.toLowerCase()}`, {
          description: res.error,
        });
        setActionLabel(null);
        return;
      }
      toast.success(`Job ${successLabel}.`);
      setActionLabel(null);
      router.refresh();
    });
  }

  function onDelete() {
    if (pending) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setActionLabel("Deleting");
    startTransition(async () => {
      const res = await deleteJob({ jobId });
      if (!res.ok) {
        toast.error("Couldn't delete job", { description: res.error });
        setConfirmingDelete(false);
        setActionLabel(null);
        return;
      }
      toast.success("Job deleted.");
      router.push("/jobs");
      router.refresh();
    });
  }

  const isActive = lifecycle === "active";
  const isPrivate = lifecycle === "private";
  const isInactive = lifecycle === "inactive";
  const showReactivate = isPrivate || isInactive;
  const showMakePrivate = isActive || isInactive;
  const showInactivate = isActive || isPrivate;

  const secondary =
    "inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-semibold text-court-fg shadow-sm transition hover:bg-court-surface-subtle disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {showReactivate && (
        <button
          type="button"
          onClick={() =>
            run(
              () => reactivateJob({ jobId }),
              "reactivated",
              "Reactivating",
            )
          }
          disabled={pending}
          className={secondary}
        >
          {pending && actionLabel === "Reactivating" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Reactivate
        </button>
      )}

      {showMakePrivate && (
        <button
          type="button"
          onClick={() =>
            run(
              () => makeJobPrivate({ jobId }),
              "moved to private",
              "Making private",
            )
          }
          disabled={pending}
          className={secondary}
        >
          {pending && actionLabel === "Making private" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
          Make Private
        </button>
      )}

      {showInactivate && (
        <button
          type="button"
          onClick={() =>
            run(
              () => inactivateJob({ jobId }),
              "inactivated",
              "Inactivating",
            )
          }
          disabled={pending}
          className={secondary}
        >
          {pending && actionLabel === "Inactivating" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CircleSlash className="h-3.5 w-3.5" />
          )}
          Inactivate
        </button>
      )}

      <button
        type="button"
        onClick={onDelete}
        onBlur={() => setConfirmingDelete(false)}
        disabled={pending}
        className={
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm transition disabled:opacity-60 " +
          (confirmingDelete
            ? "bg-red-600 text-white hover:bg-red-700"
            : "border border-red-300 bg-court-surface text-red-600 hover:bg-red-50")
        }
      >
        {pending && actionLabel === "Deleting" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
        {confirmingDelete ? "Confirm Delete" : "Delete Job"}
      </button>

      {confirmingDelete && !pending && (
        <button
          type="button"
          onClick={() => setConfirmingDelete(false)}
          className="rounded-md border border-court-border bg-court-surface-subtle px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg"
        >
          Cancel
        </button>
      )}

      {confirmingDelete && (
        <span className="text-xs text-red-600">
          Delete this job permanently?
        </span>
      )}
    </div>
  );
}
