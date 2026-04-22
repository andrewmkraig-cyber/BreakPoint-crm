"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { PlainProse } from "@/components/plain-prose";
import { DocumentDropzone } from "@/components/document-dropzone";
import { toast } from "sonner";
import { deleteAgreement, summarizeAgreement } from "@/app/clients/[id]/actions";
import { uploadFileInChunks } from "@/lib/chunked-upload";
import { cn } from "@/lib/utils";

export type AgreementRow = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName: string | null;
  summary: string | null;
  summaryUpdatedAt: string | null;
};

export function AgreementsTab({ clientId, items }: { clientId: number; items: AgreementRow[] }) {
  const router = useRouter();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Chunked base64 upload to Postgres — same path as benefits files. Bypasses
  // the 4.5MB Vercel Hobby function body limit.
  async function onFiles(files: File[]) {
    setUploadError(null);
    setUploadSuccess(null);
    setIsUploading(true);
    try {
      for (const file of files) {
        const toastId = toast.loading(`Uploading ${file.name}…`);
        try {
          await uploadFileInChunks(
            file,
            "/api/uploads/agreement",
            { clientId },
            {
              onProgress: (pct) => {
                toast.loading(`Uploading ${file.name} — ${pct}%`, { id: toastId });
              },
            },
          );
          setUploadSuccess(`Uploaded ${file.name}.`);
          toast.success(`Uploaded ${file.name}`, { id: toastId });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Upload failed.";
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

  async function onDelete(id: string, name: string) {
    if (!confirm(`Delete ${name}? This can't be undone.`)) return;
    setIsUploading(true);
    try {
      const result = await deleteAgreement(id);
      if (!result.ok) {
        setUploadError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-court-border bg-court-surface shadow-sm">
        <div className="border-b border-court-border px-5 py-3">
          <h3 className="font-serif text-base font-semibold text-court-fg">Upload agreement</h3>
          <p className="text-xs text-court-fg-muted">
            PDFs or Word documents, up to 20MB. Stored privately in Ace. DocuSign auto-import will come later.
          </p>
        </div>
        <div className="p-5">
          <DocumentDropzone
            accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple={false}
            isBusy={isUploading}
            onFiles={onFiles}
            emptyHint="PDF or DOC/DOCX up to 20MB"
          />
          {uploadError && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{uploadError}</div>}
          {uploadSuccess && !uploadError && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{uploadSuccess}</div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm">
        <div className="border-b border-court-border px-5 py-3 text-sm font-semibold text-court-fg">Uploaded agreements</div>
        {items.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-court-fg-muted">No agreements uploaded yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((a) => (
              <AgreementItem key={a.id} agreement={a} onDelete={onDelete} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AgreementItem({
  agreement,
  onDelete,
}: {
  agreement: AgreementRow;
  onDelete: (id: string, name: string) => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<boolean>(Boolean(agreement.summary));
  const [summary, setSummary] = useState<string | null>(agreement.summary);
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState<string | null>(agreement.summaryUpdatedAt);
  const [error, setError] = useState<string | null>(null);
  // Plain useState (not useTransition) so the disabled + "Summarizing…"
  // state flips synchronously on click. Claude summarization can take
  // 20s+ on a multi-page PDF; without an immediate visible flip the
  // button looked frozen.
  const [isPending, setIsPending] = useState(false);

  const isPdf = agreement.mimeType === "application/pdf";

  async function onSummarize() {
    setError(null);
    setIsPending(true);
    try {
      const result = await summarizeAgreement(agreement.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.value.summary);
      setSummaryUpdatedAt(result.value.summaryUpdatedAt);
      setExpanded(true);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <Link
            href={`/api/client-agreements/${agreement.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-medium text-court-fg hover:text-brand-dark"
          >
            <FileText className="h-4 w-4 text-court-fg-muted" />
            {agreement.filename}
            <ExternalLink className="h-3 w-3 text-court-fg-muted" />
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-court-fg-muted">
            <span>{formatBytes(agreement.sizeBytes)}</span>
            <span>{new Date(agreement.uploadedAt).toLocaleString()}</span>
            {agreement.uploadedByName && <span>by {agreement.uploadedByName}</span>}
            {summary && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold text-brand-dark">
                <Sparkles className="h-2.5 w-2.5" /> Summarized
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onSummarize()}
            disabled={isPending || !isPdf}
            title={!isPdf ? "Only PDF agreements can be summarized right now." : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {isPending ? "Summarizing…" : summary ? "Re-summarize" : "Summarize Terms"}
          </button>
          {summary && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Hide" : "Show"} summary
            </button>
          )}
          <Link
            href={`/api/client-agreements/${agreement.id}?download=1`}
            className="rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
          >
            Download
          </Link>
          <button
            type="button"
            onClick={() => onDelete(agreement.id, agreement.filename)}
            className="rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 grass:hover:bg-red-900/30"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}

      {summary && expanded && (
        <div className={cn("mt-3 rounded-lg border border-court-border bg-court-surface-subtle/40 p-4")}>
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-court-fg-muted">
            <Sparkles className="h-3 w-3 text-brand-dark" /> Key terms
            {summaryUpdatedAt && <span className="normal-case tracking-normal">· updated {new Date(summaryUpdatedAt).toLocaleString()}</span>}
          </div>
          <PlainProse text={summary} />
        </div>
      )}
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
