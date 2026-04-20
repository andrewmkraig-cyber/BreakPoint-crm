"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Edit3, FileText, Loader2, Replace, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { DocumentDropzone } from "@/components/document-dropzone";
import { PdfCanvasViewer } from "@/components/pdf-canvas-viewer";
import { uploadFileInChunks } from "@/lib/chunked-upload";
import { deleteCandidateResume } from "@/app/candidates/[id]/actions";

const ACCEPT_RESUME_MIME =
  "application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,text/plain,.txt";

// Lazy-load the redaction editor (pdfjs + pdf-lib are ~1.5MB combined, so keep
// them out of the initial bundle). Client-only.
const ResumeRedactor = dynamic(
  () => import("@/app/candidates/[id]/resume-redactor").then((m) => m.ResumeRedactor),
  { ssr: false },
);

export type ResumeState = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName: string | null;
  redactedAt: string | null;
} | null;

export function EditableResume({
  candidateRfId,
  initial,
}: {
  candidateRfId: number;
  initial: ResumeState;
}) {
  const router = useRouter();
  const [resume, setResume] = useState<ResumeState>(initial);
  const [replacing, setReplacing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [redactorOpen, setRedactorOpen] = useState(false);
  const [showRedacted, setShowRedacted] = useState(Boolean(initial?.redactedAt));
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function onFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    setIsUploading(true);
    const toastId = toast.loading(`Uploading ${file.name}…`);
    try {
      await uploadFileInChunks(
        file,
        "/api/uploads/candidate-resume",
        { candidateRfId },
        {
          onProgress: (pct) => {
            toast.loading(`Uploading ${file.name} — ${pct}%`, { id: toastId });
          },
        },
      );
      setResume({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedByName: null,
        redactedAt: null,
      });
      setReplacing(false);
      setShowRedacted(false);
      toast.success(`Uploaded ${file.name}`, { id: toastId });
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed.";
      toast.error("Couldn't upload resume", { id: toastId, description: msg });
    } finally {
      setIsUploading(false);
    }
  }

  function onDelete() {
    if (!confirm("Delete this resume? This can't be undone.")) return;
    startTransition(async () => {
      const result = await deleteCandidateResume(candidateRfId);
      if (!result.ok) {
        toast.error("Couldn't delete resume", { description: result.error });
        return;
      }
      setResume(null);
      setReplacing(false);
      toast.success("Resume deleted");
      router.refresh();
    });
  }

  // Rendered through our own pdfjs-canvas viewer rather than an <iframe>
  // pointed at the PDF: Chrome's built-in viewer ignores #zoom= fragments
  // in practice and defaults to ~44% fit-width, which made the resume
  // unreadable without manual zooming on every open.
  const pdfUrl = `/api/candidate-resumes/${candidateRfId}${showRedacted ? "?variant=redacted" : ""}`;
  const downloadUrl = `/api/candidate-resumes/${candidateRfId}?download=1${showRedacted ? "&variant=redacted" : ""}`;
  const showDropzone = !resume || replacing;
  const hasRedacted = Boolean(resume?.redactedAt);
  const canRedact = resume?.mimeType === "application/pdf";

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="font-serif text-base font-semibold text-navy">Resume</h2>
          {resume && (
            <p className="truncate text-xs text-muted-foreground">
              {resume.filename}
              {resume.sizeBytes > 0 && ` · ${formatBytes(resume.sizeBytes)}`}
              {resume.uploadedAt && ` · uploaded ${new Date(resume.uploadedAt).toLocaleDateString()}`}
            </p>
          )}
        </div>
        {resume && !replacing && (
          <div className="flex flex-wrap items-center gap-2">
            {canRedact && (
              <button
                type="button"
                onClick={() => setRedactorOpen(true)}
                disabled={isUploading || isPending}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:border-brand/40 hover:text-navy disabled:opacity-60"
              >
                <Edit3 className="h-3 w-3" /> Edit Resume
              </button>
            )}
            {hasRedacted && (
              <button
                type="button"
                onClick={() => setShowRedacted((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:border-brand/40 hover:text-navy"
                title="Toggle between original and redacted version"
              >
                {showRedacted ? "Viewing redacted" : "Viewing original"}
              </button>
            )}
            <Link
              href={downloadUrl}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:border-brand/40 hover:text-navy"
            >
              <Download className="h-3 w-3" /> Download
            </Link>
            <button
              type="button"
              onClick={() => setReplacing(true)}
              disabled={isUploading || isPending}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:border-brand/40 hover:text-navy disabled:opacity-60"
            >
              <Replace className="h-3 w-3" /> Replace
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={isUploading || isPending}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </button>
          </div>
        )}
        {replacing && (
          <button
            type="button"
            onClick={() => setReplacing(false)}
            disabled={isUploading}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>

      {showDropzone ? (
        <div className="p-5">
          <DocumentDropzone
            multiple={false}
            isBusy={isUploading}
            accept={ACCEPT_RESUME_MIME}
            onFiles={onFiles}
            emptyHint="PDF, DOC/DOCX, or TXT up to 25MB"
          />
          <div className="mt-3 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_RESUME_MIME}
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) void onFiles(files);
                e.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Upload Resume
            </button>
            <span className="text-[11px] text-muted-foreground">or drag and drop a file above.</span>
          </div>
          {replacing && resume && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Current resume: <span className="font-medium text-navy">{resume.filename}</span>. Drop a new file
              to replace it — the existing resume will be overwritten.
            </p>
          )}
        </div>
      ) : (
        <div className="relative">
          {resume && resume.mimeType === "application/pdf" ? (
            <PdfCanvasViewer
              key={pdfUrl}
              src={pdfUrl}
              className="min-h-[900px] w-full rounded-b-xl [height:calc(100vh-200px)]"
            />
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-2 border-t border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
              <FileText className="h-6 w-6 text-muted-foreground" />
              {resume?.filename ?? "No resume on file."}
              {resume && (
                <Link href={downloadUrl} className="text-brand-dark hover:underline">
                  Download to view
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {redactorOpen && resume && canRedact && (
        <ResumeRedactor
          candidateRfId={candidateRfId}
          originalUrl={`/api/candidate-resumes/${candidateRfId}`}
          originalFilename={resume.filename}
          onClose={() => setRedactorOpen(false)}
          onSaved={() => {
            setRedactorOpen(false);
            setResume((prev) => (prev ? { ...prev, redactedAt: new Date().toISOString() } : prev));
            setShowRedacted(true);
            toast.success("Redacted version saved");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
