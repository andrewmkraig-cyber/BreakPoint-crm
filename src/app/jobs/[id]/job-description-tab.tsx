"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button, CLAUDE_PILL_CLASS } from "@/components/ui/button";
import { FindMatchesButton } from "@/components/game-plan/find-matches-button";
import type { MatchTarget } from "@/lib/find-matches-context";
import { EditableJobDescription } from "@/app/jobs/[id]/editable-job-description";
import {
  saveJobRawDescription,
  saveJobSourceUrl,
} from "@/app/jobs/[id]/job-overview-actions";

// Job Description tab body. Replaces the bare EditableJobDescription
// render with a header strip of three actions (Edit Job stub, real
// Find Matches, Generate JD with Claude stub), then the Source Job
// Link input + Save URL / Parse Link buttons, then the raw paste
// textarea, then the existing EditableJobDescription. The two new
// inputs persist via tenant-scoped server actions on Job
// (sourceJobUrl + rawJobDescription).
export function JobDescriptionTab({
  jobId,
  jobRfId,
  jobCuid,
  rfDescription,
  initialOverride,
  initialSourceJobUrl,
  initialRawJobDescription,
  matchTarget,
}: {
  jobId: string;
  jobRfId: number | null;
  jobCuid: string | null;
  rfDescription: string | null;
  initialOverride: string | null;
  initialSourceJobUrl: string | null;
  initialRawJobDescription: string | null;
  matchTarget: MatchTarget;
}) {

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            toast.message("Edit job", {
              description: "Use the Edit toggle in the right-rail Overview card.",
            })
          }
        >
          <Pencil className="h-3.5 w-3.5" /> Edit Job
        </Button>
        <FindMatchesButton target={matchTarget} />
        <button
          type="button"
          onClick={() =>
            toast.message("Generate Job Description with Claude", {
              description: "Coming soon.",
            })
          }
          className={CLAUDE_PILL_CLASS}
        >
          <Sparkles className="h-3 w-3" /> Generate Job Description with Claude
        </button>
      </div>

      <SourceJobLinkRow jobId={jobId} initial={initialSourceJobUrl} />

      <RawJobDescriptionRow jobId={jobId} initial={initialRawJobDescription} />

      <EditableJobDescription
        jobRfId={jobRfId}
        jobCuid={jobCuid}
        rfDescription={rfDescription}
        initialOverride={initialOverride}
      />
    </div>
  );
}

function SourceJobLinkRow({
  jobId,
  initial,
}: {
  jobId: string;
  initial: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(initial ?? "");
  const [pending, startSave] = useTransition();

  function onSave() {
    startSave(async () => {
      const res = await saveJobSourceUrl({ jobId, url: value });
      if (!res.ok) {
        toast.error("Couldn't save URL", { description: res.error });
        return;
      }
      toast.success("Source URL saved");
      router.refresh();
    });
  }

  function onParse() {
    if (!value.trim()) {
      toast.message("Paste a URL first.");
      return;
    }
    toast.message("Parse Link", { description: "Coming soon." });
  }

  return (
    <div className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        Source Job Link
      </label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://…"
          className={cn(
            "flex-1 rounded-md border border-court-border bg-court-bg px-3 py-2 text-sm text-court-fg shadow-sm",
            "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
          )}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onSave}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save URL
          </Button>
          <button
            type="button"
            onClick={onParse}
            className={CLAUDE_PILL_CLASS}
          >
            <Sparkles className="h-3 w-3" /> Parse Link
          </button>
        </div>
      </div>
    </div>
  );
}

function RawJobDescriptionRow({
  jobId,
  initial,
}: {
  jobId: string;
  initial: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(initial ?? "");
  const [pending, startSave] = useTransition();
  const dirty = value !== (initial ?? "");

  function onSave() {
    startSave(async () => {
      const res = await saveJobRawDescription({ jobId, rawDescription: value });
      if (!res.ok) {
        toast.error("Couldn't save raw description", { description: res.error });
        return;
      }
      toast.success("Raw description saved");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Paste raw job description here
        </label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onSave}
          disabled={pending || !dirty}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save Raw
        </Button>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={8}
        placeholder="Paste the unedited copy from a job board, client email, or LinkedIn here…"
        className={cn(
          "mt-1.5 w-full resize-y rounded-md border border-court-border bg-court-bg px-3 py-2 text-sm text-court-fg shadow-sm",
          "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
        )}
      />
    </div>
  );
}
