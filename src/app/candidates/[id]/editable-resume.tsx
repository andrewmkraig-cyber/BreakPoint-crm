"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Download,
  Edit3,
  FileOutput,
  FileText,
  Loader2,
  Pencil,
  Trash2,
  Upload,
  X,
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
import { generateAiResume } from "@/app/candidates/[id]/generate-resume-action";
import {
  buildTokenMarkBgMap,
  HighlightTokenChips,
} from "@/app/candidates/[id]/resume-matches-rail";
import { Sparkles } from "lucide-react";

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

// Static palette for multi-token highlighting. Tailwind JIT scans
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
  tokens = [],
}: {
  // RF-imported candidates pass their numeric rfId for the legacy
  // upload path; Ace-native candidates pass null and route by
  // candidateId. Both surfaces share the rest of the component.
  candidateRfId: number | null;
  candidateId: string;
  versions: ResumeVersion[];
  // Search-token highlights threaded in from ?highlight= on the embed
  // candidate profile. Empty when absent; chip row above the viewer
  // only renders when at least one token survives the parser.
  tokens?: string[];
}) {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [editorOpen, setEditorOpen] = useState(false);
  // Empty-state-only flag for the "Generate Resume" action. Lives next
  // to isUploading so both actions share the disable state on the
  // upload button + dropzone while either is in flight.
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Selected version key. Re-syncs to the new default whenever the
  // versions prop changes (e.g., after upload + router.refresh re-
  // renders the server-side payload).
  const defaultKey = useMemo(() => pickDefault(versions), [versions]);
  const [selectedKey, setSelectedKey] = useState<string | null>(defaultKey);
  // After a save flow that creates a new row (upload / brand / redact /
  // convert), we capture the new resumeId here so the dropdown can
  // auto-switch to it once router.refresh's payload arrives. Cleared
  // after the matching version surfaces. Without this, the dropdown
  // sticks on the previously-selected version even though the user
  // clearly wants to see what they just saved.
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingSelectId) return;
    const match = versions.find((v) => v.resumeId === pendingSelectId);
    if (match) {
      setSelectedKey(match.key);
      setPendingSelectId(null);
    }
  }, [versions, pendingSelectId]);
  useEffect(() => {
    // While a pendingSelectId is in flight, hold off on the default-
    // fallback reset — otherwise the snapback to defaultKey clobbers
    // the auto-select before the new version arrives.
    if (pendingSelectId) return;
    if (!selectedKey || !versions.some((v) => v.key === selectedKey)) {
      setSelectedKey(defaultKey);
    }
  }, [versions, selectedKey, defaultKey, pendingSelectId]);

  const selected = versions.find((v) => v.key === selectedKey) ?? null;
  // 200/70 bg variants for the in-PDF mark overlay. HighlightTokenChips
  // builds its own (solid-100) map from buildTokenColorMap internally; this
  // mark map indexes off the same TOKEN_COLORS order so each token's chip
  // hue and in-doc highlight hue stay locked together.
  const tokenMarkMap = useMemo(() => buildTokenMarkBgMap(tokens), [tokens]);

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
      const upload = await uploadFileInChunks(
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
      if (upload?.id) setPendingSelectId(upload.id);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed.";
      toast.error("Couldn't upload resume", { id: toastId, description: msg });
    } finally {
      setIsUploading(false);
    }
  }

  async function onGenerate() {
    setIsGenerating(true);
    const toastId = toast.loading("Generating resume with Claude…");
    try {
      const result = await generateAiResume({ candidateId });
      if (!result.ok) {
        toast.error("Couldn't generate resume", {
          id: toastId,
          description: result.error,
        });
        return;
      }
      toast.success("Resume generated", { id: toastId });
      setPendingSelectId(result.value.resumeId);
      router.refresh();
    } catch (err) {
      toast.error("Couldn't generate resume", {
        id: toastId,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsGenerating(false);
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
      setPendingSelectId(result.value.resumeId);
      router.refresh();
    });
  }

  // Inline rename of the selected version. Replaces the version
  // dropdown with a text input on click; Enter / Save commits via the
  // renameCandidateResume server action and router.refresh() pulls
  // the new displayName back into the dropdown label. Trailing
  // extensions are stripped server-side so the recruiter never has
  // to think about ".pdf" suffixes.
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  function startRename() {
    if (!selected) return;
    const stripped = (selected.displayName?.trim() || selected.filename).replace(
      /\.(pdf|docx?|txt)$/i,
      "",
    );
    setNameDraft(stripped);
    setRenaming(true);
  }

  function cancelRename() {
    setRenaming(false);
    setNameDraft("");
  }

  async function commitRename() {
    if (!selected) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      toast.error("Name can't be empty.");
      return;
    }
    setSavingName(true);
    try {
      const res = await renameCandidateResume({
        resumeId: selected.resumeId,
        displayName: trimmed,
      });
      if (!res.ok) {
        toast.error("Couldn't rename resume", { description: res.error });
        return;
      }
      toast.success("Resume renamed");
      setRenaming(false);
      setNameDraft("");
      router.refresh();
    } finally {
      setSavingName(false);
    }
  }

  if (versions.length === 0) {
    return (
      <div className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-court-border px-3 py-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-court-fg-muted">Resume</h2>
        </div>
        <div className="p-5">
          <DocumentDropzone
            multiple={false}
            isBusy={isUploading || isGenerating}
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
              disabled={isUploading || isGenerating}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Upload Resume
            </button>
            {/* Generate Resume — only renders in the empty-state branch
                (no resume on file). Uses Sparkles icon to match the
                Generate-with-Claude treatment elsewhere in the app
                (mail composer, JD generator, etc.). Disabled while
                an upload OR another generation is in flight so the
                two paths can't race. */}
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={isUploading || isGenerating}
              className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-semibold text-court-fg shadow-sm transition hover:border-brand/40 hover:bg-court-surface-subtle disabled:opacity-60"
            >
              {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Generate Resume
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
  const docx = isDocxResume(selected);
  // The unified editor accepts any PDF version as a base — the user may
  // be looking at a branded or redacted derivative and want to add more
  // marks on top. DOC/DOCX resumes can't be edited (pdf-lib only).
  const canEdit = !docx && selected.mimeType === "application/pdf";

  return (
    <div className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
      {/* Wrap to multiple rows when the column is narrow (resume +
          right-rail layout on candidate profiles squeezes this toolbar
          on smaller viewports, and the embed split-view further
          compresses the column). min-w-0 lets the version selector
          actually shrink; without it the dropdown's intrinsic width
          would push the row past its column. The version selector and
          the button group are siblings inside flex-wrap so the buttons
          break to a second line when the column is too narrow to fit
          them all on one row. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-court-border px-3 py-1.5">
        <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wider text-court-fg-muted">Resume</h2>
        {/* Version dropdown — Court Mode tokens. Architecture: any
            ResumeVersion entry slots in here without component changes
            (originals + redacted today; branded next prompt). Click
            the pencil to swap the dropdown for an inline rename input
            on the currently-selected version. min-w-0 + overflow-hidden
            on the container plus truncate on the inner span and select
            keeps the row from escaping its column on narrow viewports. */}
        {renaming ? (
          <div className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-[11px] text-court-fg-muted">
            <span className="shrink-0 uppercase tracking-wider">Name</span>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              disabled={savingName}
              autoFocus
              placeholder="Resume name"
              className="min-w-0 flex-1 truncate rounded-md border border-court-border bg-court-surface px-2 py-1 text-xs text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void commitRename()}
              disabled={savingName || !nameDraft.trim()}
              aria-label="Save resume name"
              title="Save"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg disabled:opacity-60"
            >
              {savingName ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={cancelRename}
              disabled={savingName}
              aria-label="Cancel rename"
              title="Cancel"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <label className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-[11px] text-court-fg-muted">
            <span className="shrink-0 truncate uppercase tracking-wider">Version</span>
            <select
              value={selectedKey ?? ""}
              onChange={(e) => setSelectedKey(e.target.value)}
              disabled={isUploading || isPending}
              className="min-w-0 max-w-full truncate rounded-md border border-court-border bg-court-surface px-2 py-1 text-xs text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
            >
              {versions.map((v) => (
                <option key={v.key} value={v.key}>
                  {dropdownLabelFor(v)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={startRename}
              disabled={isUploading || isPending}
              aria-label="Rename this version"
              title="Rename this version"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg disabled:opacity-60"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </label>
        )}
        {/* Action buttons in their own flex-wrap container so they
            can break to a second line when the column is too narrow
            to fit them on one row with the version selector. ml-auto
            pushes the group to the right edge of the toolbar. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
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

      {tokens.length > 0 && (
        <HighlightTokenChips
          tokens={tokens}
          className="border-b border-court-border px-3 py-1.5"
        />
      )}

      <div className="flex flex-col">
        <div className="relative min-w-0 flex-1">
          {selected.mimeType === "application/pdf" || selected.kind === "redacted" ? (
            <PdfCanvasViewer
              key={previewUrl}
              src={previewUrl}
              className="min-h-[900px] w-full rounded-b-xl"
              highlightTokens={tokens}
              highlightClassMap={tokenMarkMap}
            />
          ) : docx ? (
            // id="resume-document-content" scopes TextHighlighter's DOM
            // walker to the rendered DOCX body only — without it the
            // walker would mark text in the right-rail overview, skill
            // chips, activity feed, and even the highlight chips above
            // the viewer. PDF mode skips this wrapper because
            // PdfCanvasViewer paints its own colored marks on a canvas
            // overlay; the DOM walker can't (and shouldn't) reach the
            // canvas glyphs.
            <div id="resume-document-content">
              <DocxPreview
                idOrRfId={candidateRfId ?? candidateId}
                className="min-h-[900px] w-full overflow-auto rounded-b-xl"
              />
            </div>
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
      </div>

      {editorOpen && canEdit && (
        <ResumeEditor
          candidateId={candidateId}
          sourceResumeId={selected.resumeId}
          baseResumeUrl={previewUrl}
          baseResumeFilename={selected.filename}
          onClose={() => setEditorOpen(false)}
          onSaved={(newResumeId) => {
            setEditorOpen(false);
            setPendingSelectId(newResumeId);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}


