"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleSlash, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  inactivateJob,
  makeJobPrivate,
  reactivateJob,
  type JobLifecycle,
} from "@/app/jobs/[id]/job-overview-actions";

// Lifecycle action row at the top of the Job Overview tab. Color
// coding follows the shared Button variant taxonomy:
//   Reactivate    → primary  (green — affirmative, "bring this back")
//   Make Private  → apply    (amber — gate-pass / hold style, matches
//                              how /candidates uses Apply)
//   Inactivate    → reject   (red — destructive intent, mirror of the
//                              candidate Reject button)
// Delete lives separately as a small ghost-style button at the very
// bottom of the page (DeleteJobButton), matching DeleteCandidateButton
// + DeleteClientButton. The set of buttons rendered varies by current
// state so the recruiter never sees the action that's a no-op for
// where the job already is.
export function JobOverviewActionButtons({
  jobId,
  lifecycle,
}: {
  jobId: string;
  lifecycle: JobLifecycle;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successLabel: string,
  ) {
    if (pending) return;
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(`Couldn't ${successLabel.toLowerCase()}`, {
          description: res.error,
        });
        return;
      }
      toast.success(`Job ${successLabel}.`);
      router.refresh();
    });
  }

  const isActive = lifecycle === "active";
  const isPrivate = lifecycle === "private";
  const isInactive = lifecycle === "inactive";
  const showReactivate = isPrivate || isInactive;
  const showMakePrivate = isActive || isInactive;
  const showInactivate = isActive || isPrivate;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {showReactivate && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => run(() => reactivateJob({ jobId }), "reactivated")}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Reactivate
        </Button>
      )}

      {showMakePrivate && (
        <Button
          type="button"
          variant="apply"
          size="sm"
          onClick={() => run(() => makeJobPrivate({ jobId }), "moved to private")}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
          Make Private
        </Button>
      )}

      {showInactivate && (
        <Button
          type="button"
          variant="reject"
          size="sm"
          onClick={() => run(() => inactivateJob({ jobId }), "inactivated")}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CircleSlash className="h-3.5 w-3.5" />
          )}
          Inactivate
        </Button>
      )}
    </div>
  );
}
