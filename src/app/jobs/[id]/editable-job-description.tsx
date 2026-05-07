"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { updateJobOverrideDescription } from "@/app/jobs/[id]/job-override-actions";

// Edit-in-place job description backed by the local JobOverride table.
// `rfDescription` is the (read-only) text RF sends back; `localOverride`
// is the recruiter-authored override layered on top via JobOverride.
// Whichever is present (override preferred when both) is what the merge
// field [Job Description] resolves to.
export function EditableJobDescription({
  jobRfId,
  jobCuid,
  rfDescription,
  initialOverride,
}: {
  // Pre-Phase-2 callers pass jobRfId; Ace-native callers pass jobCuid.
  // At least one must be set — the server action branches on whichever
  // identifies an Ace-native vs RF-imported Job row.
  jobRfId: number | null;
  jobCuid: string | null;
  rfDescription: string | null;
  initialOverride: string | null;
}) {
  const router = useRouter();
  const [savedOverride, setSavedOverride] = useState<string | null>(initialOverride);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(initialOverride ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  const effective = savedOverride ?? rfDescription ?? "";
  const usingOverride = Boolean(savedOverride && savedOverride.trim().length > 0);

  function onCancel() {
    setDraft(savedOverride ?? "");
    setErr(null);
    setEditing(false);
  }

  function onStartEditing() {
    setDraft(savedOverride ?? rfDescription ?? "");
    setEditing(true);
  }

  function onSave() {
    setErr(null);
    // eslint-disable-next-line no-console
    console.log("[EditableJobDescription] save click", {
      jobRfId,
      draftLength: draft.length,
      draftPreview: draft.slice(0, 200),
    });
    startSave(async () => {
      const result = await updateJobOverrideDescription({ jobRfId, jobCuid, description: draft });
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.error("[EditableJobDescription] save failed", { jobRfId, error: result.error });
        setErr(result.error);
        toast.error("Couldn't save description", { description: result.error });
        return;
      }
      // eslint-disable-next-line no-console
      console.log("[EditableJobDescription] save OK", { jobRfId, savedLength: draft.trim().length });
      setSavedOverride(draft.trim() || null);
      setEditing(false);
      toast.success("Description saved");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-serif text-lg font-semibold text-court-fg">Description</h2>
          <p className="text-[11px] text-court-fg-muted">
            {usingOverride
              ? "Local Ace override · merge fields use this text"
              : rfDescription
                ? "Imported source · click Edit to author an Ace override"
                : "Empty · add a description so [Job Description] resolves"}
          </p>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={onStartEditing}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted hover:text-court-fg disabled:opacity-60"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            placeholder="Describe the role — responsibilities, requirements, anything the candidate or client needs to see in [Job Description] merge fields."
            className="w-full resize-vertical rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm leading-relaxed text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>
          )}
          {rfDescription && draft.trim() === "" && (
            <p className="text-[11px] text-court-fg-muted">
              Saving an empty description clears the local override and reverts to the imported text below.
            </p>
          )}
          {rfDescription && (
            <details className="text-[11px] text-court-fg-muted">
              <summary className="cursor-pointer">Show imported source description</summary>
              <div
                className="prose prose-sm mt-2 max-w-none text-court-fg"
                dangerouslySetInnerHTML={{ __html: rfDescription }}
              />
            </details>
          )}
        </div>
      ) : effective.trim().length > 0 ? (
        usingOverride ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-court-fg">{effective}</p>
        ) : (
          <div
            className="prose prose-sm mt-3 max-w-none text-court-fg"
            dangerouslySetInnerHTML={{ __html: effective }}
          />
        )
      ) : (
        <p className="mt-3 text-xs text-court-fg-muted">
          No description on this job yet. Click Edit to add one.
        </p>
      )}
    </div>
  );
}
