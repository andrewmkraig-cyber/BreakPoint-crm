"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Edit3,
  FileOutput,
  FileText,
  Loader2,
  Trash2,
  Upload,
  Pencil,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { DocumentDropzone } from "@/components/document-dropzone";
import { DocxPreview } from "@/components/docx-preview";
import { PdfCanvasViewer } from "@/components/pdf-canvas-viewer";
import { uploadFileInChunks } from "@/lib/chunked-upload";
import {
  convertDocxResumeToPdf,
  deleteCandidateResume,
  renameCandidateResume,
} from "@/app/candidates/[id]/actions";

const ACCEPT_RESUME_MIME =
  "application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,text/plain,.txt";

// Lazy-load the tabbed editor (pdfjs + pdf-lib are ~1.5MB combined).
// Bundles both Redact and Brand tabs; the user picks which one to use
// once the modal opens.
const ResumeEditor = dynamic(
  () => import("@/app/candidates/[id]/resume-editor").then((m) => m.ResumeEditor),
  { ssr: false },
);

// Phase 5A.5.a — multi-version resume management.
// The candidate profile passes an array of every uploaded version's
// view (originals + their redacted variants), newest-first. The
// component renders a Version dropdown that selects which one to
// preview / download. The dropdown's architecture is built so
// branded variants (5A.5.b) and additional kinds slot in by adding
// new entries to the array — no component changes required.
//
// Inline rename of the displayed filename writes to
// CandidateResume.displayName via renameCandidateResume(); the column
// falls back to the raw upload filename when blank, so a careless
// empty save never shows a blank name in the UI.

export type ResumeVersion = {
  // Stable React key. Original = resumeId; redacted = "{resumeId}:redacted";
  // branded = the branded row's resumeId (its own row).
  key: string;
  // The CandidateResume row id. The "redacted" variant shares the row
  // with its original (stored in the same row's redacted* columns).
  // "original" and "branded" each map to their own distinct row.
  resumeId: string;
  // 5A.5.b: branded versions are stored as new CandidateResume rows
  // with variant="branded" so the dropdown can list multiple of them.
  // "converted" surfaces DOCX → PDF conversions as their own entry.
  kind: "original" | "redacted" | "branded" | "converted";
  filename: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName: string | null;
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LEGACY_DOC_MIME = "application/msword";

function isDocxResume(v: ResumeVersion): boolean {
  return (
    v.mimeType === DOCX_MIME ||
    v.mimeType === LEGACY_DOC_MIME ||
    /\.(docx?|DOCX?)$/.test(v.filename)
  );
}

function previewUrlFor(v: ResumeVersion): string {
  const base = `/api/candidate-resumes/by-id/${v.resumeId}`;
  // Branded rows are stored on their own CandidateResume row so the
  // by-id route serves the branded bytes from `data` without any
  // variant query param. Only "redacted" lives on the original row's
  // redactedData column and needs the variant flag.
  return v.kind === "redacted" ? `${base}?variant=redacted` : base;
}

function downloadUrlFor(v: ResumeVersion): string {
  const base = `/api/candidate-resumes/by-id/${v.resumeId}?download=1`;
  return v.kind === "redacted" ? `${base}&variant=redacted` : base;
}

function extensionFor(v: ResumeVersion): string {
  if (v.mimeType === "application/pdf") return ".pdf";
  if (v.mimeType === DOCX_MIME) return ".docx";
  if (v.mimeType === LEGACY_DOC_MIME) return ".doc";
  if (v.mimeType === "text/plain") return ".txt";
  const m = v.filename.match(/\.(pdf|docx?|txt)$/i);
  return m ? m[0].toLowerCase() : ".pdf";
}

function displayNameFor(v: ResumeVersion): string {
  const stripped = (v.displayName?.trim() || v.filename).replace(/\.(pdf|docx?|txt)$/i, "");
  return stripped + extensionFor(v);
}

function dropdownLabelFor(v: ResumeVersion): string {
  const date = new Date(v.uploadedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const stripped = (v.displayName?.trim() || v.filename).replace(/\.(pdf|docx?|txt)$/i, "");
  return `${stripped} (${date})`;
}

// Default selection: most recent redacted if any version is redacted,
// else the most recent original. Matches the prior single-resume
// behavior of defaulting to the redacted view when one existed.
function pickDefault(versions: ResumeVersion[]): string | null {
  if (versions.length === 0) return null;
  const firstRedacted = versions.find((v) => v.kind === "redacted");
  return (firstRedacted ?? versions[0]).key;
}

export function EditableResume({
  candidateRfId,
  candidateId,
  versions,
}: {
  // RF-imported candidates pass their numeric rfId for the legacy
  // upload path; Ace-native candidates pass null and route by
  // candidateId. Both surfaces share the rest of the component.
  candidateRfId: number | null;
  candidateId: string;
  versions: ResumeVersion[];
}) {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [editorOpen, setEditorOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Selected version key. Re-syncs to the new default whenever the
  // versions prop changes (e.g., after upload + router.refresh re-
  // renders the server-side payload).
  const defaultKey = useMemo(() => pickDefault(versions), [versions]);
  const [selectedKey, setSelectedKey] = useState<string | null>(defaultKey);
  useEffect(() => {
    // If our previously-selected version disappeared (deleted, etc.)
    // or we never had one, snap back to the default.
    if (!selectedKey || !versions.some((v) => v.key === selectedKey)) {
      setSelectedKey(defaultKey);
    }
  }, [versions, selectedKey, defaultKey]);

  const selected = versions.find((v) => v.key === selectedKey) ?? null;

  // Rename state — bound to the currently-selected version. Switching
  // versions resets the rename UI.
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  useEffect(() => {
    setRenaming(false);
    if (selected) {
      const stripped = (selected.displayName?.trim() ?? selected.filename).replace(
        /\.(pdf|docx?|txt)$/i,
        "",
      );
      setRenameDraft(stripped);
    }
  }, [selectedKey, selected]);

  async function onFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    setIsUploading(true);
    const toastId = toast.loading(`Uploading ${file.name}…`);
    try {
      // Phase 5A.5.b: route by candidateId when there's no RF id (Ace-
      // native). The endpoint accepts either; sending the cuid keeps
      // the row's candidateRfId column clean of negative placeholders.
      const uploadExtra =
        candidateRfId != null
          ? ({ candidateRfId } as const)
          : ({ candidateId } as const);
      await uploadFileInChunks(
        file,
        "/api/uploads/candidate-resume",
        uploadExtra,
        {
          onProgress: (pct) => {
            toast.loading(`Uploading ${file.name} — ${pct}%`, { id: toastId });
          },
        },
      );
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
    if (!selected) return;
    if (!confirm("Delete this resume version? This can't be undone.")) return;
    startTransition(async () => {
      // Phase 5A.5.b (Ace 20.0): per-version delete. Earlier code wiped
      // ALL versions for the candidate; we now scope to a single row.
      const result = await deleteCandidateResume(selected.resumeId);
      if (!result.ok) {
        toast.error("Couldn't delete resume", { description: result.error });
        return;
      }
      toast.success("Resume deleted");
      router.refresh();
    });
  }

  function onConvertDocx() {
    if (!selected) return;
    const toastId = toast.loading("Converting to PDF…");
    startTransition(async () => {
      const result = await convertDocxResumeToPdf({ resumeId: selected.resumeId });
      if (!result.ok) {
        toast.error("Couldn't convert to PDF", { id: toastId, description: result.error });
        return;
      }
      toast.success("Converted to PDF — you can now brand this version", { id: toastId });
      router.refresh();
    });
  }

  function commitRename() {
    if (!selected) return;
    const trimmed = renameDraft.trim();
    setRenaming(false);
    // No-op when unchanged from the current display name (or fallback).
    const currentDisplay = selected.displayName?.trim() ?? "";
    if (trimmed === currentDisplay) return;
    startTransition(async () => {
      const res = await renameCandidateResume({
        resumeId: selected.resumeId,
        displayName: trimmed,
      });
      if (!res.ok) {
        toast.error("Couldn't rename", { description: res.error });
        return;
      }
      toast.success("Renamed");
      router.refresh();
    });
  }

  if (versions.length === 0) {
    return (
      <div className="rounded-xl border border-court-border bg-court-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-court-border px-5 py-3">
          <h2 className="font-serif text-base font-semibold text-court-fg">Resume</h2>
        </div>
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
            <span className="text-[11px] text-court-fg-muted">or drag and drop a file above.</span>
          </div>
        </div>
      </div>
    );
  }

  if (!selected) return null;
  const previewUrl = previewUrlFor(selected);
  const downloadUrl = downloadUrlFor(selected);
  const fileBaseLabel = displayNameFor(selected);
  const docx = isDocxResume(selected);
  // The unified editor accepts any PDF version as a base — the user may
  // be looking at a branded or redacted derivative and want to add more
  // marks on top. DOC/DOCX resumes can't be edited (pdf-lib only).
  const canEdit = !docx && selected.mimeType === "application/pdf";

  return (
    <div className="rounded-xl border border-court-border bg-court-surface shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-court-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-base font-semibold text-court-fg">Resume</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-court-fg-muted">
            {/* Inline rename — click filename to edit, Enter saves,
                Escape cancels. The .pdf extension is preserved by the
                server action; the input shows the stem only. */}
            {renaming ? (
              <span className="inline-flex items-center gap-1">
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") {
                      setRenameDraft(
                        (selected.displayName?.trim() ?? selected.filename).replace(/\.(pdf|docx?|txt)$/i, ""),
                      );
                      setRenaming(false);
                    }
                  }}
                  maxLength={200}
                  className="min-w-[260px] rounded-md border border-court-border bg-court-surface px-2 py-1 text-xs text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
                <span className="text-court-fg-muted">.pdf</span>
                <Check className="h-3 w-3 text-court-fg-muted" />
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="group inline-flex max-w-[420px] items-center gap-1 truncate text-left transition hover:text-court-fg"
                title="Click to rename"
              >
                <span className="truncate font-medium text-court-fg">{fileBaseLabel}</span>
                <Pencil className="h-3 w-3 shrink-0 text-court-fg-muted opacity-0 group-hover:opacity-100" />
              </button>
            )}
            {selected.sizeBytes > 0 && <span>· {formatBytes(selected.sizeBytes)}</span>}
            <span>· uploaded {new Date(selected.uploadedAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Version dropdown — Court Mode tokens. Architecture: any
              ResumeVersion entry slots in here without component
              changes (originals + redacted today; branded next prompt). */}
          <label className="inline-flex items-center gap-1 text-[11px] text-court-fg-muted">
            <span className="uppercase tracking-wider">Version</span>
            <select
              value={selectedKey ?? ""}
              onChange={(e) => setSelectedKey(e.target.value)}
              disabled={isUploading || isPending}
              className="rounded-md border border-court-border bg-court-surface px-2 py-1 text-xs text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
            >
              {versions.map((v) => (
                <option key={v.key} value={v.key}>
                  {dropdownLabelFor(v)}
                </option>
              ))}
            </select>
          </label>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              disabled={isUploading || isPending}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg disabled:opacity-60"
            >
              <Edit3 className="h-3 w-3" /> Edit Resume
            </button>
          )}
          {docx && (
            <button
              type="button"
              onClick={onConvertDocx}
              disabled={isUploading || isPending}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileOutput className="h-3 w-3" />}
              Convert to PDF
            </button>
          )}
          <Link
            href={downloadUrl}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
          >
            <Download className="h-3 w-3" /> Download
          </Link>
          {/* Phase 5A.5.a: replaces the old "Replace" button. New uploads
              create a new version row instead of overwriting; this button
              is the entry point. */}
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
            disabled={isUploading || isPending}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg disabled:opacity-60"
          >
            {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Upload new version
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isUploading || isPending}
            aria-label="Delete resume"
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 grass:hover:bg-red-900/30 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </button>
        </div>
      </div>

      <div className="relative">
        {selected.mimeType === "application/pdf" || selected.kind === "redacted" ? (
          <PdfCanvasViewer
            key={previewUrl}
            src={previewUrl}
            className="min-h-[900px] w-full rounded-b-xl [height:calc(100vh-200px)]"
          />
        ) : docx ? (
          <DocxPreview
            idOrRfId={candidateRfId ?? candidateId}
            className="min-h-[900px] w-full overflow-auto rounded-b-xl [height:calc(100vh-200px)]"
          />
        ) : (
          <div className="flex h-64 flex-col items-center justify-center gap-2 border-t border-dashed border-court-border bg-court-surface-subtle/40 text-sm text-court-fg-muted">
            <FileText className="h-6 w-6 text-court-fg-muted" />
            Preview not available for this file type.
            <Link href={downloadUrl} className="text-brand-dark hover:underline">
              Download to view
            </Link>
          </div>
        )}
      </div>

      {editorOpen && canEdit && (
        <ResumeEditor
          candidateId={candidateId}
          sourceResumeId={selected.resumeId}
          baseResumeUrl={previewUrl}
          baseResumeFilename={selected.filename}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
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

