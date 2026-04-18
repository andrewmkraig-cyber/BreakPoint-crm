"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Replace, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DocumentDropzone } from "@/components/document-dropzone";
import { uploadFileInChunks } from "@/lib/chunked-upload";
import { deleteCandidateResume } from "@/app/candidates/[id]/actions";

export type ResumeState = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName: string | null;
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
      });
      setReplacing(false);
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

  const pdfUrl = `/api/candidate-resumes/${candidateRfId}`;
  const downloadUrl = `${pdfUrl}?download=1`;
  const showDropzone = !resume || replacing;

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h2 className="font-serif text-base font-semibold text-navy">Resume</h2>
          {resume && (
            <p className="text-xs text-muted-foreground">
              {resume.filename}
              {resume.sizeBytes > 0 && ` · ${formatBytes(resume.sizeBytes)}`}
              {resume.uploadedAt && ` · uploaded ${new Date(resume.uploadedAt).toLocaleDateString()}`}
            </p>
          )}
        </div>
        {resume && !replacing && (
          <div className="flex items-center gap-2">
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
            accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,text/plain,.txt"
            onFiles={onFiles}
            emptyHint="PDF, DOC/DOCX, or TXT up to 25MB"
          />
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
            <iframe
              title={`Resume — ${resume.filename}`}
              src={pdfUrl}
              className="h-[700px] w-full rounded-b-xl border-0"
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
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
