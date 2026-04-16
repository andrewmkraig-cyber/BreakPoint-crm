"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Loader2, Pencil, Save, Sparkles, Trash2, Upload, X } from "lucide-react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<boolean>(!initial.body);
  const [draft, setDraft] = useState<string>(initial.body);
  const [saved, setSaved] = useState<BenefitsState>(initial);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, startUpload] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [isSummarizing, startSummarize] = useTransition();

  function doUpload(file: File) {
    setUploadError(null);
    setUploadSuccess(null);
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

  function onFileInputChange(e: FormEvent<HTMLInputElement>) {
    const list = (e.currentTarget as HTMLInputElement).files;
    if (!list?.length) return;
    Array.from(list).forEach((f) => doUpload(f));
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files;
    if (!dropped?.length) return;
    Array.from(dropped).forEach((f) => doUpload(f));
  }

  function onDeleteFile(id: string, name: string) {
    if (!confirm(`Delete ${name}?`)) return;
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
              Drop PDFs, Word docs, or plain-text carrier packets here. Files are private to ACE.
            </p>
          </div>
        </div>
        <div className="p-5">
          <label
            htmlFor={`benefits-upload-${clientId}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
              isDragging ? "border-brand bg-brand-tint/40 text-navy" : "border-border bg-muted/30 text-muted-foreground hover:border-brand/40 hover:bg-brand-tint/20",
            )}
          >
            <Upload className={cn("h-6 w-6", isDragging ? "text-brand-dark" : "text-muted-foreground")} />
            <div className="text-sm font-semibold text-navy">
              {isUploading ? "Uploading…" : "Drop files to upload"}
            </div>
            <div className="text-xs text-muted-foreground">
              or <span className="font-medium text-brand-dark">click to browse</span> — PDF, DOC/DOCX, TXT up to 20MB
            </div>
            <input
              ref={inputRef}
              id={`benefits-upload-${clientId}`}
              type="file"
              multiple
              accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,text/plain,.txt,text/markdown,.md"
              onChange={onFileInputChange}
              className="hidden"
            />
          </label>

          {uploadError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{uploadError}</div>
          )}
          {uploadSuccess && !uploadError && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{uploadSuccess}</div>
          )}

          {files.length > 0 && (
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
              {files.map((f) => (
                <li key={f.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <Link
                    href={`/api/client-benefits-files/${f.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-2 text-navy hover:text-brand-dark"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{f.filename}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-muted-foreground">{formatBytes(f.sizeBytes)}</span>
                    <span className="hidden text-[11px] text-muted-foreground md:inline">
                      {new Date(f.uploadedAt).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteFile(f.id, f.filename)}
                      className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
