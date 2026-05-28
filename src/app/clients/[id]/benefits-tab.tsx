"use client";

import { Component, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { DocumentDropzone } from "@/components/document-dropzone";
import { MarkdownProse } from "@/components/markdown-prose";
import {
  deleteBenefitsFile,
  saveBenefits,
  summarizeBenefitsWithAI,
} from "@/app/clients/[id]/actions";
import { uploadFileInChunks } from "@/lib/chunked-upload";
import { cn } from "@/lib/utils";
import { Button, CLAUDE_PILL_CLASS } from "@/components/ui/button";

const UPLOAD_TIMEOUT_MS = 30_000;

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
  canWrite = true,
}: {
  // null = Ace-native client with no legacyRfId. clientBenefits +
  // clientBenefitsFile are still keyed by clientRfId, so uploads / saves
  // have nothing to write against; the inner component degrades to a
  // read-only "no benefits yet" surface in that case.
  clientId: number | null;
  initial: BenefitsState;
  files: BenefitsFile[];
  // When false (client you don't own) uploads, deletes, the Generate
  // Summary / Edit buttons, and the textarea are suppressed. The summary
  // body and existing files stay readable / downloadable.
  canWrite?: boolean;
}) {
  return (
    <ClientErrorBoundary>
      <BenefitsTabInner clientId={clientId} initial={initial} files={files} canWrite={canWrite} />
    </ClientErrorBoundary>
  );
}

function BenefitsTabInner({
  clientId,
  initial,
  files,
  canWrite,
}: {
  clientId: number | null;
  initial: BenefitsState;
  files: BenefitsFile[];
  canWrite: boolean;
}) {
  const router = useRouter();
  // Write-affordances need both a writeable client AND a legacyRfId to
  // key the clientRfId-scoped rows. canWrite alone gates owner-vs-viewer;
  // canMutate also gates Ace-native-with-no-legacyRfId.
  const canMutate = canWrite && clientId != null;
  // Read-only viewers (and Ace-native clients pending clientRfId support)
  // never auto-enter edit mode, even on an empty body — the editable
  // textarea would otherwise dangle with a save button that can't fire.
  const [editing, setEditing] = useState<boolean>(canMutate ? !initial.body : false);
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
  // Chunked base64 upload to Postgres (2MB raw slices → ~2.8MB JSON POSTs,
  // under Vercel Hobby's 4.5MB function body limit). Bypasses Vercel Blob
  // entirely. Each chunk appends to the ClientBenefitsFile.data column;
  // the final chunk flips uploadComplete to true.
  async function onFiles(chosen: File[]) {
    setUploadError(null);
    setUploadSuccess(null);
    setIsUploading(true);
    try {
      for (const file of chosen) {
        const toastId = toast.loading(`Uploading ${file.name}…`);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
        const t0 = performance.now();
        try {
          await uploadFileInChunks(
            file,
            "/api/uploads/benefits-file",
            { clientId },
            {
              signal: controller.signal,
              onProgress: (pct) => {
                toast.loading(`Uploading ${file.name}: ${pct}%`, { id: toastId });
              },
            },
          );
          clearTimeout(timer);

          const seconds = Math.round((performance.now() - t0) / 100) / 10;
          setUploadSuccess(`Uploaded ${file.name}.`);
          toast.success(`Uploaded ${file.name}`, {
            id: toastId,
            description: `Stored in ${seconds}s. Click Generate Summary to summarize.`,
          });
        } catch (err) {
          clearTimeout(timer);
          const wasAbort =
            controller.signal.aborted ||
            (err instanceof DOMException && err.name === "AbortError");
          const msg = wasAbort
            ? `Upload of ${file.name} timed out after ${UPLOAD_TIMEOUT_MS / 1000}s. Try again or check your connection.`
            : err instanceof Error
              ? err.message
              : "Upload failed.";
          setUploadError(msg);
          toast.error(`Couldn't upload ${file.name}`, { id: toastId, description: msg });
          return;
        }
      }
      router.refresh();
    } finally {
      setIsUploading(false);
    }
  }

  async function onDeleteFile(id: string) {
    setUploadError(null);
    setIsUploading(true);
    const toastId = toast.loading("Removing file…");
    try {
      const result = await deleteBenefitsFile(id);
      if (!result || !result.ok) {
        const msg = result?.error ?? "Delete failed.";
        setUploadError(msg);
        toast.error("Couldn't remove file", { id: toastId, description: msg });
        return;
      }
      toast.success("File removed", { id: toastId });
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed.";
      setUploadError(msg);
      toast.error("Couldn't remove file", { id: toastId, description: msg });
    } finally {
      setIsUploading(false);
    }
  }

  function onSave() {
    setSaveError(null);
    if (clientId == null) {
      // Defensive: the Save button is gated on canMutate, so this should
      // be unreachable. Surfacing the error rather than swallowing makes
      // any future regression visible instead of silently no-op'ing.
      setSaveError("Benefits can't be saved for this client yet.");
      return;
    }
    const cid = clientId;
    startSave(async () => {
      const result = await saveBenefits(cid, draft);
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
    if (clientId == null) {
      setSummaryError("Benefits summary isn't available for this client yet.");
      return;
    }
    if (files.length === 0 && !draft.trim()) {
      setSummaryError("Upload a file or paste some notes first.");
      toast.error("Nothing to summarize", { description: "Upload a file or paste notes first." });
      return;
    }
    const cid = clientId;
    const toastId = toast.loading("Summarizing benefits with Claude…");
    startSummarize(async () => {
      const result = await summarizeBenefitsWithAI(cid, draft);
      if (!result || !result.ok) {
        const msg = result?.error ?? "Claude call failed.";
        setSummaryError(msg);
        toast.error("Summary failed", { id: toastId, description: msg });
        return;
      }
      setDraft(result.value.summary);
      setEditing(true);
      toast.success("Benefits summarized", {
        id: toastId,
        description: "Review and click Save to persist.",
      });
    });
  }

  return (
    <div className="space-y-6">
      {(canMutate || files.length > 0) && (
        <div className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-court-border px-5 py-3">
            <div>
              <h2 className="font-serif text-lg font-semibold text-court-fg">Benefits documents</h2>
              <p className="text-xs text-court-fg-muted">
                {canMutate
                  ? "Drop PDFs, Word docs, or plain-text carrier packets here. Files are private to Ace."
                  : "Uploaded carrier packets. View only."}
              </p>
            </div>
          </div>
          <div className="p-5">
            <DocumentDropzone
              isBusy={isUploading}
              readOnly={!canMutate}
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
            {canMutate && uploadError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{uploadError}</div>
            )}
            {canMutate && uploadSuccess && !uploadError && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{uploadSuccess}</div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
        <div className="flex flex-col items-start justify-between gap-3 border-b border-court-border px-5 py-3 md:flex-row md:items-center">
          <div>
            <h2 className="font-serif text-lg font-semibold text-court-fg">Benefits summary</h2>
            <p className="text-xs text-court-fg-muted">
              Paste raw notes or generate a clean summary with Claude from uploaded docs + pasted text.
            </p>
          </div>
          {canMutate && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onSummarize}
                disabled={isSummarizing}
                className={CLAUDE_PILL_CLASS}
              >
                {isSummarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Generate Summary
              </button>
              {!editing && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-semibold text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              )}
            </div>
          )}
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
                  "w-full resize-vertical rounded-lg border border-court-border bg-court-surface px-3 py-2 font-sans text-sm leading-relaxed text-court-fg",
                  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
                )}
              />
              {saveError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{saveError}</div>
              )}
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-court-fg-muted">{draft.length.toLocaleString()} characters</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={onSave}
                    disabled={isSaving}
                  >
                    {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    Save
                  </Button>
                </div>
              </div>
            </div>
          ) : saved.body.trim() ? (
            <>
              <MarkdownProse content={saved.body} />
              {saved.updatedAt && (
                <div className="mt-4 border-t border-court-border pt-3 text-[11px] text-court-fg-muted">
                  Last updated {safeDateString(saved.updatedAt)}
                  {saved.updatedByName ? ` by ${saved.updatedByName}` : ""}
                </div>
              )}
            </>
          ) : (
            <div className="py-8 text-center text-sm text-court-fg-muted">
              {canWrite
                ? "No benefits summary yet. Upload a PDF and click Summarize with Claude, or edit to paste your own notes."
                : "No benefits summary yet."}
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
            className="mt-3 rounded-md border border-red-300 bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
