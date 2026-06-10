"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Building2, Loader2, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { updateLocalCandidate } from "@/app/candidates/[id]/local-candidate-update";
import { Input } from "@/components/ui/input";

// Mirror of the RF profile's EditableEmployment but writes to local
// Postgres instead of RF. Lets the recruiter override what the resume
// parser missed (or didn't find) without re-uploading the whole resume.

export function LocalEmployment({
  candidateId,
  initialDesignation,
  initialOrganization,
}: {
  candidateId: string;
  initialDesignation: string | null;
  initialOrganization: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [savedDesignation, setSavedDesignation] = useState(initialDesignation ?? "");
  const [savedOrganization, setSavedOrganization] = useState(initialOrganization ?? "");
  const [draftDesignation, setDraftDesignation] = useState(initialDesignation ?? "");
  const [draftOrganization, setDraftOrganization] = useState(initialOrganization ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  function onCancel() {
    setDraftDesignation(savedDesignation);
    setDraftOrganization(savedOrganization);
    setErr(null);
    setEditing(false);
  }

  function onSave() {
    setErr(null);
    startSave(async () => {
      const result = await updateLocalCandidate({
        id: candidateId,
        currentDesignation: draftDesignation,
        currentOrganization: draftOrganization,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't save employment", { description: result.error });
        return;
      }
      setSavedDesignation(draftDesignation);
      setSavedOrganization(draftOrganization);
      setEditing(false);
      toast.success("Employment saved");
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-court-border/40 bg-court-surface p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-base font-semibold text-court-fg">Employment</h2>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
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
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm hover:text-court-fg disabled:opacity-60"
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
        <div className="mt-3 space-y-3">
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Current title</span>
            <Input
              type="text"
              value={draftDesignation}
              onChange={(e) => setDraftDesignation(e.target.value)}
              frameClassName="mt-1"
            />
          </label>
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Current employer</span>
            <Input
              type="text"
              value={draftOrganization}
              onChange={(e) => setDraftOrganization(e.target.value)}
              frameClassName="mt-1"
            />
          </label>
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>
          )}
        </div>
      ) : (
        <dl className="mt-3 space-y-3 text-sm">
          <Row label="Current title" icon={<Briefcase className="h-3 w-3" />}>
            {savedDesignation || <span className="text-court-fg-muted">—</span>}
          </Row>
          <Row label="Current employer" icon={<Building2 className="h-3 w-3" />}>
            {savedOrganization || <span className="text-court-fg-muted">—</span>}
          </Row>
        </dl>
      )}
    </section>
  );
}

function Row({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</dt>
      <dd className="mt-0.5 inline-flex items-center gap-1 text-court-fg">
        {icon}
        {children}
      </dd>
    </div>
  );
}
