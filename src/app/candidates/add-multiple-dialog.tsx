"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadFileInChunks } from "@/lib/chunked-upload";

// Bulk candidate import modal, opened from the Candidates topbar "Add
// Multiple" chip. Extracted out of the former candidates-view.tsx (the
// pre-search-rail Candidates page, deleted in the same change) so the only
// surviving, in-use piece lives in its own file instead of hiding inside
// dead code. The CSV import route and resume match/upload pipeline it calls
// are unchanged.

function parseNameFromFilename(filename: string): string {
  const base = filename.replace(/\.(pdf|docx?)$/i, "");
  const lastUnderscore = base.lastIndexOf("_");
  return (lastUnderscore >= 0 ? base.slice(0, lastUnderscore) : base).trim();
}

// Combined cap across CSV + resume queue. The toolbar's old split (50 resumes +
// 1 CSV) collapses into a single 50-file dropzone; CSVs are still
// effectively unlimited in practice because recruiters drop one Pin
// export at a time.
const MAX_QUEUE_FILES = 50;
const RESUME_UPLOAD_BATCH_SIZE = 5;

type CsvQueueItem = {
  key: string;
  file: File;
  rowCount: number | null; // null while parsing; -1 on parse error
  parseError: string | null;
};

type ResumeQueueItem = {
  key: string;
  file: File;
  parsedName: string;
};

type CsvImportResult = {
  filename: string;
  imported: number;
  duplicates: number;
  skipped: number;
  skippedNoName: number;
  skippedError: number;
  importedNoEmail: number;
  total: number;
  format: string | null;
  error: string | null;
};

type ResumeUploadOutcome =
  | { status: "uploaded"; filename: string; parsedName: string; created: boolean }
  | { status: "unmatched"; filename: string; parsedName: string }
  | { status: "failed"; filename: string; parsedName: string; error: string };

function isCsvFile(f: File): boolean {
  return /\.csv$/i.test(f.name) || f.type === "text/csv";
}
function isResumeFile(f: File): boolean {
  return (
    /\.(pdf|docx?)$/i.test(f.name) ||
    f.type === "application/pdf" ||
    f.type === "application/msword" ||
    f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

// One modal, mixed CSV + resume queue. Replaces the old split "CSV Import"
// and "Upload Resumes" toolbar buttons. CSVs run through the existing
// /api/candidates/import-csv route (one fetch per file, in parallel) and
// resumes run through the existing match-by-name → resume-upload pipeline
// (single match call + N=5 worker pool). Both paths fire concurrently
// from a single Import click and produce one combined toast.
// Friendly label for the format the server detected from the header row.
const FORMAT_LABEL: Record<string, string> = {
  pin: "Pin export",
  zoominfo: "ZoomInfo export",
  generic: "Generic (best-effort)",
};

// Post-import breakdown rendered in-dialog so a partial or zero import
// explains itself instead of vanishing behind a toast.
type ImportReport = {
  csvFiles: number;
  csvTotalRows: number;
  csvImported: number;
  csvImportedNoEmail: number;
  csvDuplicates: number;
  csvSkippedNoName: number;
  csvSkippedError: number;
  csvFormats: string[];
  csvFileErrors: { filename: string; error: string }[];
  resumeFiles: number;
  resumeAttached: number;
  resumeCreated: number;
  resumeUnmatched: string[];
  resumeFailed: { filename: string; error: string }[];
};

export function AddMultipleDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  // Called whenever the import changed the database (imported > 0) so the
  // caller can refresh the list behind the modal. Distinct from onClose:
  // a partial/zero import keeps the dialog open AND may still have
  // imported some rows worth refreshing for.
  onImported?: () => void;
}) {
  const [csvFiles, setCsvFiles] = useState<CsvQueueItem[]>([]);
  const [resumeFiles, setResumeFiles] = useState<ResumeQueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Post-import breakdown. When set, the dialog shows the results panel
  // instead of the dropzone and stays open so the recruiter can read it.
  const [report, setReport] = useState<ImportReport | null>(null);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const totalCount = csvFiles.length + resumeFiles.length;

  function parseCsvRowCount(file: File, key: string) {
    // Async row-count probe. Updates the queue item in place as soon as
    // Papa finishes; surfaces parse errors as a per-row note.
    void (async () => {
      try {
        const text = await file.text();
        const Papa = (await import("papaparse")).default;
        const parsed = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h: string) => h.trim(),
        });
        setCsvFiles((prev) =>
          prev.map((c) =>
            c.key === key
              ? { ...c, rowCount: parsed.data?.length ?? 0, parseError: null }
              : c,
          ),
        );
      } catch (err) {
        setCsvFiles((prev) =>
          prev.map((c) =>
            c.key === key
              ? {
                  ...c,
                  rowCount: -1,
                  parseError:
                    err instanceof Error ? err.message : "Couldn't read CSV.",
                }
              : c,
          ),
        );
      }
    })();
  }

  function addFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming);
    const csvs = list.filter(isCsvFile);
    const resumes = list.filter(isResumeFile);
    const skipped = list.length - csvs.length - resumes.length;
    setError(null);

    // Pre-compute the next queue state from the current snapshot. The
    // 50-file cap spans CSVs + resumes combined, so we decide which files
    // fit here and apply both setStates with concrete arrays — no
    // nested updaters, no stale closures.
    const seen = new Set([
      ...csvFiles.map((p) => `${p.file.name}|${p.file.size}`),
      ...resumeFiles.map((p) => `${p.file.name}|${p.file.size}`),
    ]);
    const newCsvItems: CsvQueueItem[] = [];
    const newResumeItems: ResumeQueueItem[] = [];
    let droppedForCap = false;

    const fits = () =>
      csvFiles.length +
        resumeFiles.length +
        newCsvItems.length +
        newResumeItems.length <
      MAX_QUEUE_FILES;

    for (const f of csvs) {
      if (!fits()) {
        droppedForCap = true;
        break;
      }
      const dedupeKey = `${f.name}|${f.size}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const rowKey = `${dedupeKey}|${Math.random().toString(36).slice(2, 8)}`;
      newCsvItems.push({ key: rowKey, file: f, rowCount: null, parseError: null });
      parseCsvRowCount(f, rowKey);
    }
    for (const f of resumes) {
      if (!fits()) {
        droppedForCap = true;
        break;
      }
      const dedupeKey = `${f.name}|${f.size}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      newResumeItems.push({
        key: `${dedupeKey}|${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        parsedName: parseNameFromFilename(f.name),
      });
    }

    if (newCsvItems.length > 0) {
      setCsvFiles((prev) => [...prev, ...newCsvItems]);
    }
    if (newResumeItems.length > 0) {
      setResumeFiles((prev) => [...prev, ...newResumeItems]);
    }

    if (droppedForCap) {
      setError(`Capped at ${MAX_QUEUE_FILES} files. Extra files were dropped.`);
    } else if (skipped > 0) {
      setError(
        `Skipped ${skipped} unsupported file${skipped === 1 ? "" : "s"} (only .csv, .pdf, .doc, and .docx are accepted).`,
      );
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }
  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }
  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (busy) return;
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  function removeCsv(key: string) {
    setCsvFiles((prev) => prev.filter((p) => p.key !== key));
  }
  function removeResume(key: string) {
    setResumeFiles((prev) => prev.filter((p) => p.key !== key));
  }

  // Clear the report and the queue so the recruiter can run another
  // import without reopening the dialog.
  function resetForAnother() {
    setReport(null);
    setCsvFiles([]);
    setResumeFiles([]);
    setError(null);
    setProgress(null);
  }

  async function importCsvOne(file: File): Promise<CsvImportResult> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/candidates/import-csv", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as
        | {
            imported: number;
            skipped: number;
            duplicates: number;
            skippedNoName?: number;
            skippedError?: number;
            importedNoEmail?: number;
            total?: number;
            format?: string;
          }
        | { error: string };
      if (!res.ok || "error" in json) {
        return {
          filename: file.name,
          imported: 0,
          duplicates: 0,
          skipped: 0,
          skippedNoName: 0,
          skippedError: 0,
          importedNoEmail: 0,
          total: 0,
          format: null,
          error: "error" in json ? json.error : `HTTP ${res.status}`,
        };
      }
      return {
        filename: file.name,
        imported: json.imported ?? 0,
        duplicates: json.duplicates ?? 0,
        skipped: json.skipped ?? 0,
        skippedNoName: json.skippedNoName ?? 0,
        skippedError: json.skippedError ?? 0,
        importedNoEmail: json.importedNoEmail ?? 0,
        total: json.total ?? 0,
        format: json.format ?? null,
        error: null,
      };
    } catch (err) {
      return {
        filename: file.name,
        imported: 0,
        duplicates: 0,
        skipped: 0,
        skippedNoName: 0,
        skippedError: 0,
        importedNoEmail: 0,
        total: 0,
        format: null,
        error: err instanceof Error ? err.message : "Network error",
      };
    }
  }

  // Run the existing resume match + upload pipeline against the queued files.
  // Returns aggregate counts for the toast; the worker pool size and
  // match-by-name semantics are unchanged from the standalone dialog.
  async function processResumeBatch(
    resumes: ResumeQueueItem[],
    bumpProgress: () => void,
  ): Promise<{
    attached: number;
    created: number;
    unmatched: Array<{ filename: string }>;
    failed: Array<{ filename: string; error: string }>;
  }> {
    if (resumes.length === 0) {
      return { attached: 0, created: 0, unmatched: [], failed: [] };
    }
    const matchRes = await fetch("/api/candidates/match-by-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        names: resumes.map((f) => ({ name: f.parsedName })),
        createIfMissing: true,
      }),
    });
    const matchJson = (await matchRes.json().catch(() => ({}))) as {
      ok?: boolean;
      matches?: Array<{ name: string; candidateId: string | null; created?: boolean }>;
      error?: string;
    };
    if (!matchRes.ok || !matchJson.ok || !Array.isArray(matchJson.matches)) {
      throw new Error(matchJson.error ?? `Match failed (HTTP ${matchRes.status})`);
    }
    const matchByIndex = matchJson.matches;
    const outcomes: ResumeUploadOutcome[] = new Array(resumes.length);

    let cursor = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= resumes.length) return;
        const f = resumes[i];
        const matchRow = matchByIndex[i];
        const matched = matchRow?.candidateId ?? null;
        const wasCreated = matchRow?.created === true;
        if (!matched) {
          outcomes[i] = {
            status: "unmatched",
            filename: f.file.name,
            parsedName: f.parsedName,
          };
        } else {
          try {
            await uploadFileInChunks(
              f.file,
              "/api/uploads/candidate-resume",
              { candidateId: matched },
            );
            outcomes[i] = {
              status: "uploaded",
              filename: f.file.name,
              parsedName: f.parsedName,
              created: wasCreated,
            };
          } catch (err) {
            outcomes[i] = {
              status: "failed",
              filename: f.file.name,
              parsedName: f.parsedName,
              error: err instanceof Error ? err.message : "Upload failed.",
            };
          }
        }
        bumpProgress();
      }
    };
    const workers = Array.from(
      { length: Math.min(RESUME_UPLOAD_BATCH_SIZE, resumes.length) },
      () => worker(),
    );
    await Promise.all(workers);

    const uploaded = outcomes.filter(
      (o): o is Extract<ResumeUploadOutcome, { status: "uploaded" }> =>
        o.status === "uploaded",
    );
    return {
      attached: uploaded.filter((o) => !o.created).length,
      created: uploaded.filter((o) => o.created).length,
      unmatched: outcomes
        .filter(
          (o): o is Extract<ResumeUploadOutcome, { status: "unmatched" }> =>
            o.status === "unmatched",
        )
        .map((o) => ({ filename: o.filename })),
      failed: outcomes
        .filter(
          (o): o is Extract<ResumeUploadOutcome, { status: "failed" }> =>
            o.status === "failed",
        )
        .map((o) => ({ filename: o.filename, error: o.error })),
    };
  }

  async function onImport() {
    if (totalCount === 0 || busy) return;
    setBusy(true);
    setError(null);
    // Progress total = each CSV counts as one unit of work plus each
    // resume upload. CSVs run as one fetch per file; resumes report N upload
    // completions. Match-by-name itself isn't tracked separately.
    const totalUnits = csvFiles.length + resumeFiles.length;
    let done = 0;
    setProgress({ done: 0, total: totalUnits });
    const bumpProgress = () => {
      done += 1;
      setProgress({ done, total: totalUnits });
    };

    try {
      const csvSnapshot = csvFiles.map((c) => c.file);
      const resumeSnapshot = [...resumeFiles];

      // CSVs and resumes fan out concurrently. Each CSV resolves to a
      // CsvImportResult; the resume batch resolves to aggregate counts.
      const csvJobs = csvSnapshot.map(async (file) => {
        const result = await importCsvOne(file);
        bumpProgress();
        return result;
      });
      const resumeJob = processResumeBatch(resumeSnapshot, bumpProgress);

      const [csvResults, resumeResults] = await Promise.all([
        Promise.all(csvJobs),
        resumeJob,
      ]);

      const csvImported = csvResults.reduce((a, r) => a + r.imported, 0);
      const csvDuplicates = csvResults.reduce((a, r) => a + r.duplicates, 0);
      const csvSkippedNoName = csvResults.reduce((a, r) => a + r.skippedNoName, 0);
      const csvSkippedError = csvResults.reduce((a, r) => a + r.skippedError, 0);
      const csvImportedNoEmail = csvResults.reduce((a, r) => a + r.importedNoEmail, 0);
      const csvTotalRows = csvResults.reduce((a, r) => a + r.total, 0);
      const csvFormats = Array.from(
        new Set(csvResults.map((r) => r.format).filter((f): f is string => !!f)),
      );
      const csvFileErrors = csvResults
        .filter((r) => r.error)
        .map((r) => ({ filename: r.filename, error: r.error as string }));

      const nextReport: ImportReport = {
        csvFiles: csvSnapshot.length,
        csvTotalRows,
        csvImported,
        csvImportedNoEmail,
        csvDuplicates,
        csvSkippedNoName,
        csvSkippedError,
        csvFormats,
        csvFileErrors,
        resumeFiles: resumeSnapshot.length,
        resumeAttached: resumeResults.attached,
        resumeCreated: resumeResults.created,
        resumeUnmatched: resumeResults.unmatched.map((u) => u.filename),
        resumeFailed: resumeResults.failed.map((u) => ({
          filename: u.filename,
          error: u.error,
        })),
      };

      const importedTotal = csvImported + resumeResults.attached + resumeResults.created;
      const problems =
        csvSkippedNoName +
        csvSkippedError +
        csvDuplicates +
        csvFileErrors.length +
        resumeResults.unmatched.length +
        resumeResults.failed.length;

      // Anything imported means the list behind the modal changed.
      if (importedTotal > 0) onImported?.();

      if (importedTotal > 0 && problems === 0) {
        // Clean run: brief success toast and dismiss.
        toast.success(
          `Imported ${importedTotal} candidate${importedTotal === 1 ? "" : "s"}.`,
        );
        onClose();
      } else {
        // Partial or zero import: keep the dialog open and show why. A
        // zero-import on a real file reads as an error, not a success.
        setReport(nextReport);
        if (importedTotal > 0) {
          toast.success(
            `Imported ${importedTotal}, ${problems} need attention.`,
          );
        } else {
          toast.error("Imported 0 candidates. See details in the dialog.");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed.";
      setError(msg);
      toast.error("Import failed", { description: msg });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const remaining = MAX_QUEUE_FILES - totalCount;

  return (
    <BulkModal title="Add multiple candidates" onClose={onClose}>
      {report ? (
        <ImportReportView
          report={report}
          onImportAnother={resetForAnother}
          onClose={onClose}
        />
      ) : (
      <>
      <p className="mb-3 text-xs text-court-fg-muted">
        Drop a Pin or ZoomInfo CSV export and/or resume files in any
        combination. CSV rows import as new candidates; resumes match existing
        candidates by first + last name and create a record on miss. Up to {MAX_QUEUE_FILES} files at a time.
      </p>
      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={
          "rounded-lg border-2 border-dashed p-4 transition " +
          (dragOver
            ? "border-court-accent bg-court-accent-tint"
            : "border-court-border bg-court-surface-subtle")
        }
      >
        <p className="mb-2 text-center text-xs text-court-fg-muted">
          {dragOver
            ? "Drop CSV or resumes to queue"
            : totalCount === 0
              ? "Drop CSV, PDF, DOC, or DOCX resumes here, or click to browse"
              : `${totalCount} queued · ${remaining} more allowed`}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,.pdf,application/pdf,.doc,application/msword,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          onChange={onPick}
          disabled={busy || remaining <= 0}
          className="block w-full text-xs text-court-fg file:mr-3 file:rounded-md file:border file:border-court-border file:bg-court-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-court-fg hover:file:bg-court-accent-tint"
        />
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {error}
        </div>
      )}

      {csvFiles.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
            CSV files ({csvFiles.length})
          </div>
          <div className="max-h-40 overflow-y-auto rounded-md border border-court-border">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-court-surface-subtle text-court-fg-muted">
                <tr>
                  <th className="px-2 py-1 font-medium">Filename</th>
                  <th className="px-2 py-1 font-medium">Rows</th>
                  <th className="w-8 px-2 py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-court-border-soft">
                {csvFiles.map((f) => (
                  <tr key={f.key}>
                    <td className="truncate px-2 py-1 font-mono text-court-fg">{f.file.name}</td>
                    <td className="px-2 py-1 text-court-fg">
                      {f.parseError ? (
                        <span className="italic text-amber-700 dark:text-amber-300">
                          parse error
                        </span>
                      ) : f.rowCount === null ? (
                        <span className="italic text-court-fg-muted">…</span>
                      ) : (
                        `${f.rowCount} row${f.rowCount === 1 ? "" : "s"}`
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => removeCsv(f.key)}
                        disabled={busy}
                        aria-label={`Remove ${f.file.name}`}
                        className="rounded p-0.5 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-40"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {resumeFiles.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
            Resume files ({resumeFiles.length})
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border border-court-border">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-court-surface-subtle text-court-fg-muted">
                <tr>
                  <th className="px-2 py-1 font-medium">Filename</th>
                  <th className="px-2 py-1 font-medium">Parsed name</th>
                  <th className="w-8 px-2 py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-court-border-soft">
                {resumeFiles.map((f) => (
                  <tr key={f.key}>
                    <td className="truncate px-2 py-1 font-mono text-court-fg">{f.file.name}</td>
                    <td className="px-2 py-1 text-court-fg">
                      {f.parsedName || (
                        <span className="italic text-court-fg-muted">(unparseable)</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => removeResume(f.key)}
                        disabled={busy}
                        aria-label={`Remove ${f.file.name}`}
                        className="rounded p-0.5 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-40"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {progress && (
        <p className="mt-3 text-center text-[11px] text-court-fg-muted">
          Importing {progress.done} / {progress.total}…
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onImport}
          disabled={busy || totalCount === 0}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {busy ? "Importing…" : `Import ${totalCount || ""}`.trim()}
        </Button>
      </div>
      </>
      )}
    </BulkModal>
  );
}

// Post-import results panel. Shown in place of the dropzone after an
// import so a partial or zero result explains itself and the dialog
// stays open. Rendered inside the existing BulkModal shell.
function ImportReportView({
  report,
  onImportAnother,
  onClose,
}: {
  report: ImportReport;
  onImportAnother: () => void;
  onClose: () => void;
}) {
  const importedTotal =
    report.csvImported + report.resumeAttached + report.resumeCreated;
  const zero = importedTotal === 0;
  const formatLabel = report.csvFormats
    .map((f) => FORMAT_LABEL[f] ?? f)
    .join(", ");
  // Unrecognized = the generic mapper couldn't find a name in any row,
  // so the whole file was skipped. Distinct from "a few rows had no name".
  const unrecognized =
    report.csvFiles > 0 &&
    report.csvImported === 0 &&
    report.csvSkippedNoName > 0 &&
    report.csvFormats.every((f) => f === "generic");

  type Line = { tone: "good" | "warn" | "bad"; text: string };
  const lines: Line[] = [];
  if (report.csvImported > 0) {
    lines.push({
      tone: "good",
      text:
        `${report.csvImported} candidate${report.csvImported === 1 ? "" : "s"} imported from CSV` +
        (report.csvImportedNoEmail > 0
          ? ` (${report.csvImportedNoEmail} without an email)`
          : ""),
    });
  }
  if (report.resumeAttached > 0) {
    lines.push({
      tone: "good",
      text: `${report.resumeAttached} resume${report.resumeAttached === 1 ? "" : "s"} attached`,
    });
  }
  if (report.resumeCreated > 0) {
    lines.push({
      tone: "good",
      text: `${report.resumeCreated} new candidate${report.resumeCreated === 1 ? "" : "s"} created from resume`,
    });
  }
  if (report.csvDuplicates > 0) {
    lines.push({
      tone: "warn",
      text: `${report.csvDuplicates} duplicate${report.csvDuplicates === 1 ? "" : "s"} skipped (already in your candidates)`,
    });
  }
  if (report.csvSkippedNoName > 0) {
    lines.push({
      tone: unrecognized ? "bad" : "warn",
      text: unrecognized
        ? `${report.csvSkippedNoName} row${report.csvSkippedNoName === 1 ? "" : "s"} skipped: no name column recognized`
        : `${report.csvSkippedNoName} row${report.csvSkippedNoName === 1 ? "" : "s"} skipped (no name)`,
    });
  }
  if (report.csvSkippedError > 0) {
    lines.push({
      tone: "bad",
      text: `${report.csvSkippedError} row${report.csvSkippedError === 1 ? "" : "s"} failed to import`,
    });
  }
  for (const fe of report.csvFileErrors) {
    lines.push({ tone: "bad", text: `CSV ${fe.filename}: ${fe.error}` });
  }
  if (report.resumeUnmatched.length > 0) {
    lines.push({
      tone: "warn",
      text: `${report.resumeUnmatched.length} resume${report.resumeUnmatched.length === 1 ? "" : "s"} could not be matched`,
    });
  }
  for (const pf of report.resumeFailed) {
    lines.push({ tone: "bad", text: `Resume ${pf.filename}: ${pf.error}` });
  }

  const toneClass: Record<Line["tone"], string> = {
    good: "text-court-fg",
    warn: "text-amber-700 dark:text-amber-300",
    bad: "text-red-600 dark:text-red-400",
  };

  return (
    <div>
      <div
        className={
          "mb-3 rounded-md border p-3 " +
          (zero
            ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
            : "border-court-border bg-court-surface-subtle")
        }
      >
        <p className="text-sm font-semibold text-court-fg">
          {zero
            ? "Nothing imported"
            : `Imported ${importedTotal} candidate${importedTotal === 1 ? "" : "s"}`}
        </p>
        {report.csvFiles > 0 && (
          <p className="mt-0.5 text-[11px] text-court-fg-muted">
            {report.csvTotalRows} CSV row{report.csvTotalRows === 1 ? "" : "s"} read
            {formatLabel ? ` · detected ${formatLabel}` : ""}
          </p>
        )}
      </div>

      {unrecognized && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Couldn&apos;t recognize the columns in this file. Expected a Pin or
          ZoomInfo export, or common headers like First Name / Last Name /
          Email. Check the file&apos;s header row and try again.
        </div>
      )}

      <ul className="space-y-1 text-xs">
        {lines.map((l, i) => (
          <li
            key={i}
            className={"flex items-start gap-1.5 " + toneClass[l.tone]}
          >
            <span
              aria-hidden
              className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current"
            />
            <span>{l.text}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onImportAnother}
        >
          Import another file
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function BulkModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-court-border bg-court-surface p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-serif text-base font-semibold text-court-fg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
