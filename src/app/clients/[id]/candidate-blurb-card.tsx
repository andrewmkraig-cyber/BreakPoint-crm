"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { generateClientBlurb, updateClientBlurb } from "@/app/clients/[id]/actions";

// Candidate-Facing Blurb card on the client Overview tab. Holds the
// anonymous descriptor that feeds the {{client_blurb}} merge field, e.g.
// "a growing CPA firm in Northeast Ohio", so candidate outreach reads
// "My client, ____, is looking to add a [title]." without naming the
// client. Mirrors the EditableCompany edit/save pattern: a pencil opens
// an inline editor with a shared Input, a Generate-with-Claude pill, and
// Save / Cancel. Read-only (no Edit affordance) when the recruiter does
// not own the client.
export function CandidateBlurbCard({
  clientCuid,
  initialBlurb,
  canWrite = true,
}: {
  clientCuid: string;
  initialBlurb: string;
  canWrite?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  // Committed value shown when not editing.
  const [saved, setSaved] = useState(initialBlurb);
  const [draft, setDraft] = useState(initialBlurb);
  const [err, setErr] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();
  const [isGenerating, startGenerate] = useTransition();

  function onEdit() {
    setDraft(saved);
    setErr(null);
    setEditing(true);
  }

  function onCancel() {
    setDraft(saved);
    setErr(null);
    setEditing(false);
  }

  function onGenerate() {
    setErr(null);
    startGenerate(async () => {
      const result = await generateClientBlurb(clientCuid);
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't generate blurb", { description: result.error });
        return;
      }
      // Generation persists server-side, so treat it as a commit: fill the
      // draft and advance the saved value too.
      setDraft(result.value.blurb);
      setSaved(result.value.blurb);
      toast.success("Blurb generated");
    });
  }

  function onSave() {
    setErr(null);
    startSave(async () => {
      const result = await updateClientBlurb(clientCuid, draft);
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't save blurb", { description: result.error });
        return;
      }
      setSaved(result.value.blurb);
      setDraft(result.value.blurb);
      setEditing(false);
      router.refresh();
    });
  }

  const busy = isSaving || isGenerating;

  return (
    <div className="rounded-xl border border-court-border/40 bg-court-surface p-4 shadow-sm lg:col-span-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-base font-semibold text-court-fg">
          Candidate-Facing Blurb
        </h2>
        {!editing && canWrite && (
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-court-fg-muted">
        Anonymous descriptor for candidate outreach. Reads as &ldquo;My client,{" "}
        <span className="italic">{saved || "____"}</span>, is looking to add a [title].&rdquo;
      </p>

      {editing ? (
        <div className="mt-3 space-y-3 text-sm">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="a growing CPA firm in Northeast Ohio"
            disabled={busy}
          />
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {err}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-court-border pt-3">
            <Button variant="ai-primary" size="sm" onClick={onGenerate} disabled={busy}>
              {isGenerating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Generate with Claude
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
                <X className="h-3 w-3" /> Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={onSave} disabled={busy}>
                {isSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-sm">
          {saved ? (
            <p className="text-court-fg">{saved}</p>
          ) : (
            <p className="text-court-fg-muted">
              Not set yet. {canWrite ? "Edit to generate or write one." : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
