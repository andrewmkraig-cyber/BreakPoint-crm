"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Save, Sparkles, X } from "lucide-react";
import { DocumentDropzone } from "@/components/document-dropzone";
import {
  deleteBenefitsFile,
  saveBenefits,
  summarizeBenefitsWithAI,
  uploadBenefitsFile,
} from "@/app/clients/[id]/actions";
import { cn } from "@/lib/utils";

export type BenefitsFile = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName: string | null;
};

export type BenefitsState = {
  body: string;
  updatedAt: string | null;
  updatedByName: string | null;
};

export function BenefitsTab({
  clientId,
  initial,
  files,
}: {
  clientId: number;
  initial: BenefitsState;
  files: BenefitsFile[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<boolean>(!initial.body);
  const [draft, setDraft] = useState<string>(initial.body);
  const [saved, setSaved] = useState<BenefitsState>(initial);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isUploading, startUpload] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [isSummarizing, startSummarize] = useTransition();

  function onFiles(chosen: File[]) {
    setUploadError(null);
    setUploadSuccess(null);
    for (const file of chosen) {
      const data = new FormData();
      data.append("file", file);
      startUpload(async () => {
        const result = await uploadBenefitsFile(clientId, data);
        if (!result.ok) {
          setUploadError(result.error);
          return;
        }
        setUploadSuccess(`Uploaded ${file.name}.`);
        router.refresh();
      });
    }
  }

  function onDeleteFile(id: string) {
    startUpload(async () => {
      const result = await deleteBenefitsFile(id);
      if (!result.ok) {
        setUploadError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function onSave() {
    setSaveError(null);
    startSave(async () => {
      const result = await saveBenefits(clientId, draft);
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setSaved({ body: draft, updatedAt: result.value.updatedAt, updatedByName: saved.updatedByName });
      setEditing(false);
      router.refresh();
    });
  }

  function onCancel() {
    setDraft(saved.body);
    setEditing(false);
    setSaveError(null);
  }

  function onSummarize() {
    setSummaryError(null);
    if (files.length === 0 && !draft.trim()) {
      setSummaryError("Upload a file or paste some notes first.");
      return;
    }
    startSummarize(async () => {
      const result = await summarizeBenefitsWithAI(clientId, draft);
      if (!result.ok) {
        setSummaryError(result.error);
        return;
      }
      setDraft(result.value.summary);
      setEditing(true);
    });
  }

  return (
    <div className="space-y-6">
      {/* File upload */}
      <div className="rounded-xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-navy">Benefits documents</h2>
            <p className="text-xs text-muted-foreground">
              Drop PDFs, Word docs, or plain-text carrier packets here. Files are private to Ace.
            </p>
          </div>
        </div>
        <div className="p-5">
          <DocumentDropzone
            isBusy={isUploading}
            onFiles={onFiles}
            onDelete={onDeleteFile}
            emptyHint="PDF, DOC/DOCX, or TXT up to 20MB"
            files={files.map((f) => ({
              id: f.id,
              filename: f.filename,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
              uploadedAt: f.uploadedAt,
              uploadedByName: f.uploadedByName,
              downloadHref: `/api/client-benefits-files/${f.id}`,
            }))}
          />
          {uploadError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{uploadError}</div>
          )}
          {uploadSuccess && !uploadError && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{uploadSuccess}</div>
          )}
        </div>
      </div>

      {/* Text / summary */}
      <div className="rounded-xl border border-border bg-white shadow-sm">
        <div className="flex flex-col items-start justify-between gap-3 border-b border-border px-5 py-3 md:flex-row md:items-center">
          <div>
            <h2 className="font-serif text-lg font-semibold text-navy">Benefits summary</h2>
            <p className="text-xs text-muted-foreground">
              Paste raw notes or generate a clean summary with Claude from uploaded docs + pasted text.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onSummarize}
              disabled={isSummarizing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-600 disabled:opacity-60"
            >
              {isSummarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Summarize with Claude
            </button>
            {!editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-navy-400 shadow-sm transition hover:border-brand/40 hover:text-navy"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
            )}
          </div>
        </div>

        <div className="p-5">
          {summaryError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{summaryError}</div>
          )}

          {editing ? (
            <div className="space-y-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={18}
                placeholder="Paste benefits info here, or click Summarize with Claude to generate from uploaded docs…"
                className={cn(
                  "w-full resize-vertical rounded-lg border border-border bg-white px-3 py-2 font-sans text-sm leading-relaxed text-navy",
                  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
                )}
              />
              {saveError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{saveError}</div>
              )}
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">{draft.length.toLocaleString()} characters</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-60"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
                  >
                    {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : saved.body.trim() ? (
            <>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-navy">{saved.body}</div>
              {saved.updatedAt && (
                <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
                  Last updated {new Date(saved.updatedAt).toLocaleString()}
                  {saved.updatedByName ? ` by ${saved.updatedByName}` : ""}
                </div>
              )}
            </>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No benefits summary yet. Upload a PDF and click Summarize with Claude, or edit to paste your own notes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

