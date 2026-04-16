"use client";

import { Component, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Save, Sparkles, X } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { DocumentDropzone } from "@/components/document-dropzone";
import { BulletedSummary } from "@/components/bulleted-summary";
import {
  deleteBenefitsFile,
  registerBenefitsFile,
  saveBenefits,
  summarizeBenefitsWithAI,
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
  return (
    <ClientErrorBoundary>
      <BenefitsTabInner clientId={clientId} initial={initial} files={files} />
    </ClientErrorBoundary>
  );
}

function BenefitsTabInner({
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
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, startSave] = useTransition();
  const [isSummarizing, startSummarize] = useTransition();

  // Sequential uploads. Parallel startTransition() calls caused a client-side
  // render error on Vercel (bulk File dispatches through server actions).
  // Direct-to-Blob client upload: browser streams bytes straight to Vercel
  // Blob, server only records metadata. Bypasses the 4.5MB serverless
  // function body limit that was crashing with "Cannot read properties of
  // undefined (reading 'ok')".
  async function onFiles(chosen: File[]) {
    setUploadError(null);
    setUploadSuccess(null);
    setIsUploading(true);
    try {
      for (const file of chosen) {
        const blob = await upload(`benefits/${clientId}/${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/blob/benefits",
          contentType: file.type || undefined,
        });
        const result = await registerBenefitsFile(clientId, {
          filename: file.name,
          mimeType: file.type,
          size: file.size,
          blobUrl: blob.url,
          blobPathname: blob.pathname,
        });
        if (!result || !result.ok) {
          setUploadError(result?.error ?? "Upload saved to storage but couldn't be registered in Ace.");
          return;
        }
        setUploadSuccess(`Uploaded ${file.name}.`);
      }
      router.refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  async function onDeleteFile(id: string) {
    setUploadError(null);
    setIsUploading(true);
    try {
      const result = await deleteBenefitsFile(id);
      if (!result.ok) {
        setUploadError(result.error);
        return;
      }
      router.refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setIsUploading(false);
    }
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
              <BulletedSummary text={saved.body} />
              {saved.updatedAt && (
                <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
                  Last updated {safeDateString(saved.updatedAt)}
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

function safeDateString(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
}

// Minimal error boundary so any unexpected client-side render error renders an
// inline message instead of Next.js's full-page "Application error" screen.
class ClientErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { message: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("BenefitsTab crashed:", error);
  }
  render() {
    if (this.state.message) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <div className="font-semibold">Something went wrong rendering the Benefits tab.</div>
          <div className="mt-1 font-mono text-xs">{this.state.message}</div>
          <button
            type="button"
            onClick={() => this.setState({ message: null })}
            className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
