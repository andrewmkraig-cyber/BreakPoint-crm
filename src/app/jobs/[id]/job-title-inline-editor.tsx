"use client";

import { Loader2, Pencil, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { updateJobOverview } from "@/app/jobs/[id]/job-overview-actions";

export function JobTitleInlineEditor({
  initialTitle,
  jobRfId,
  jobCuid,
}: {
  initialTitle: string;
  jobRfId: number | null;
  jobCuid: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  function startEdit() {
    setDraft(title);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(title);
    setError(null);
    setEditing(false);
  }

  function saveTitle() {
    const next = draft.trim();
    if (!next) {
      setError("Job title is required.");
      return;
    }
    if (next === title) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const res = await updateJobOverview({
        jobRfId,
        jobCuid,
        patch: { title: next },
      });
      if (!res.ok) {
        setError(res.error);
        toast.error("Couldn't save title", { description: res.error });
        return;
      }
      setTitle(next);
      setEditing(false);
      toast.success("Job title saved");
      router.refresh();
    });
  }

  if (editing) {
    return (
      <div className="max-w-3xl">
        <div
          className={cn(
            "flex min-h-[42px] items-center gap-2 rounded-md border bg-court-surface px-2 shadow-sm",
            error ? "border-red-300 bg-red-50" : "border-court-border focus-within:border-brand/50",
          )}
        >
          <input
            autoFocus
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveTitle();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEdit();
              }
            }}
            className="min-w-0 flex-1 bg-transparent font-serif text-2xl font-bold text-court-fg outline-none"
            aria-label="Job title"
            disabled={isPending}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={saveTitle}
            disabled={isPending}
            className="h-8 w-8 gap-0 p-0"
            aria-label="Save job title"
            title="Save job title"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancelEdit}
            disabled={isPending}
            className="h-8 w-8 gap-0 p-0"
            aria-label="Cancel title edit"
            title="Cancel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {error && <div className="mt-1 text-xs font-medium text-red-700">{error}</div>}
      </div>
    );
  }

  return (
    <div className="group flex min-w-0 items-center gap-2">
      <h1 className="min-w-0 break-words font-serif text-2xl font-bold text-court-fg">{title}</h1>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={startEdit}
        className="h-7 w-7 shrink-0 gap-0 p-0 opacity-80 group-hover:opacity-100"
        aria-label="Edit job title"
        title="Edit job title"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
