"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
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
import { BulletedSummary } from "@/components/bulleted-summary";
import { DocumentDropzone } from "@/components/document-dropzone";
import { deleteAgreement, summarizeAgreement, uploadAgreement } from "@/app/clients/[id]/actions";
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

  // Sequential — parallel startTransition in a loop caused a client-side render
  // error under Next 14's server action dispatch on Vercel.
  async function onFiles(files: File[]) {
    setUploadError(null);
    setUploadSuccess(null);
    setIsUploading(true);
    try {
      for (const file of files) {
        const data = new FormData();
        data.append("file", file);
        const result = await uploadAgreement(clientId, data);
        if (!result.ok) {
          setUploadError(result.error);
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
      <div className="rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h3 className="font-serif text-base font-semibold text-navy">Upload agreement</h3>
          <p className="text-xs text-muted-foreground">
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

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold text-navy">Uploaded agreements</div>
        {items.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">No agreements uploaded yet.</div>
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
  const [isPending, startTransition] = useTransition();

  const isPdf = agreement.mimeType === "application/pdf";

  function onSummarize() {
    setError(null);
    startTransition(async () => {
      const result = await summarizeAgreement(agreement.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.value.summary);
      setSummaryUpdatedAt(result.value.summaryUpdatedAt);
      setExpanded(true);
      router.refresh();
    });
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <Link
            href={`/api/client-agreements/${agreement.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-medium text-navy hover:text-brand-dark"
          >
            <FileText className="h-4 w-4 text-muted-foreground" />
            {agreement.filename}
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
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
            onClick={onSummarize}
            disabled={isPending || !isPdf}
            title={!isPdf ? "Only PDF agreements can be summarized right now." : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-600 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {summary ? "Re-summarize" : "Summarize Terms"}
          </button>
          {summary && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:text-navy"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Hide" : "Show"} summary
            </button>
          )}
          <Link
            href={`/api/client-agreements/${agreement.id}?download=1`}
            className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:text-navy"
          >
            Download
          </Link>
          <button
            type="button"
            onClick={() => onDelete(agreement.id, agreement.filename)}
            className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}

      {summary && expanded && (
        <div className={cn("mt-3 rounded-lg border border-border bg-muted/30 p-4")}>
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3 w-3 text-brand-dark" /> Key terms
            {summaryUpdatedAt && <span className="normal-case tracking-normal">· updated {new Date(summaryUpdatedAt).toLocaleString()}</span>}
          </div>
          <BulletedSummary text={summary} />
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
