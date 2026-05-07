"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleSlash, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  closeJob,
  deleteJob,
} from "@/app/jobs/[id]/job-overview-actions";

// Close Job + Delete Job affordances on the Overview tab. The Close
// button is a no-op once isOpen is already false — the disabled state
// telegraphs "this job's already closed" without the user having to
// chase the Status chip. Delete is destructive: a single click flips
// the button into a red Confirm Delete state, second click commits.
// onBlur resets so an accidental tab-out doesn't leave a primed
// destructive button sitting on the page.
export function JobOverviewActionButtons({
  jobId,
  isOpen,
}: {
  jobId: string;
  isOpen: boolean;
}) {
  const router = useRouter();
  const [closing, startClose] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function onClose() {
    if (closing || !isOpen) return;
    startClose(async () => {
      const res = await closeJob({ jobId });
      if (!res.ok) {
        toast.error("Couldn't close job", { description: res.error });
        return;
      }
      toast.success("Job closed.");
      router.refresh();
    });
  }

  function onDelete() {
    if (deleting) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    startDelete(async () => {
      const res = await deleteJob({ jobId });
      if (!res.ok) {
        toast.error("Couldn't delete job", { description: res.error });
        setConfirmingDelete(false);
        return;
      }
      toast.success("Job deleted.");
      router.push("/jobs");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClose}
        disabled={closing || !isOpen}
        className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-semibold text-court-fg shadow-sm transition hover:bg-court-surface-subtle disabled:cursor-not-allowed disabled:opacity-60"
      >
        {closing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CircleSlash className="h-3.5 w-3.5" />
        )}
        {isOpen ? "Close Job" : "Closed"}
      </button>

      <button
        type="button"
        onClick={onDelete}
        onBlur={() => setConfirmingDelete(false)}
        disabled={deleting}
        className={
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm transition disabled:opacity-60 " +
          (confirmingDelete
            ? "bg-red-600 text-white hover:bg-red-700"
            : "border border-red-300 bg-court-surface text-red-600 hover:bg-red-50")
        }
      >
        {deleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
        {confirmingDelete ? "Confirm Delete" : "Delete Job"}
      </button>

      {confirmingDelete && !deleting && (
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
