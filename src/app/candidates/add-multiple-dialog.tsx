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
import { uploadFileInChunks } from "@/lib/chunked-upload";

// Bulk candidate import modal, opened from the Candidates topbar "Add
// Multiple" chip. Extracted out of the former candidates-view.tsx (the
// pre-search-rail Candidates page, deleted in the same change) so the only
// surviving, in-use piece lives in its own file instead of hiding inside
// dead code. The CSV import route and PDF match/upload pipeline it calls
// are unchanged.

function parseNameFromFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "");
  const lastUnderscore = base.lastIndexOf("_");
  return (lastUnderscore >= 0 ? base.slice(0, lastUnderscore) : base).trim();
}

// Combined cap across CSV + PDF queue. The toolbar's old split (50 PDFs +
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

type PdfQueueItem = {
  key: string;
  file: File;
  parsedName: string;
};

type CsvImportResult = {
  filename: string;
  imported: number;
  duplicates: number;
  skipped: number;
  error: string | null;
};

type ResumeUploadOutcome =
  | { status: "uploaded"; filename: string; parsedName: string; created: boolean }
  | { status: "unmatched"; filename: string; parsedName: string }
  | { status: "failed"; filename: string; parsedName: string; error: string };

function isCsvFile(f: File): boolean {
  return /\.csv$/i.test(f.name) || f.type === "text/csv";
}
function isPdfFile(f: File): boolean {
  return /\.pdf$/i.test(f.name) || f.type === "application/pdf";
}

// One modal, mixed CSV + PDF queue. Replaces the old split "CSV Import"
// and "Upload Resumes" toolbar buttons. CSVs run through the existing
// /api/candidates/import-csv route (one fetch per file, in parallel) and
// PDFs run through the existing match-by-name → resume-upload pipeline
// (single match call + N=5 worker pool). Both paths fire concurrently
// from a single Import click and produce one combined toast.
export function AddMultipleDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [csvFiles, setCsvFiles] = useState<CsvQueueItem[]>([]);
  const [pdfFiles, setPdfFiles] = useState<PdfQueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const totalCount = csvFiles.length + pdfFiles.length;

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
    const pdfs = list.filter(isPdfFile);
    const skipped = list.length - csvs.length - pdfs.length;
    setError(null);

    // Pre-compute the next queue state from the current snapshot. The
    // 50-file cap spans CSVs + PDFs combined, so we decide which files
    // fit here and apply both setStates with concrete arrays — no
    // nested updaters, no stale closures.
    const seen = new Set([
      ...csvFiles.map((p) => `${p.file.name}|${p.file.size}`),
      ...pdfFiles.map((p) => `${p.file.name}|${p.file.size}`),
    ]);
    const newCsvItems: CsvQueueItem[] = [];
    const newPdfItems: PdfQueueItem[] = [];
    let droppedForCap = false;

    const fits = () =>
      csvFiles.length +
        pdfFiles.length +
        newCsvItems.length +
        newPdfItems.length <
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
    for (const f of pdfs) {
      if (!fits()) {
        droppedForCap = true;
        break;
      }
      const dedupeKey = `${f.name}|${f.size}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      newPdfItems.push({
        key: `${dedupeKey}|${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        parsedName: parseNameFromFilename(f.name),
      });
    }

    if (newCsvItems.length > 0) {
      setCsvFiles((prev) => [...prev, ...newCsvItems]);
    }
    if (newPdfItems.length > 0) {
      setPdfFiles((prev) => [...prev, ...newPdfItems]);
    }

    if (droppedForCap) {
      setError(`Capped at ${MAX_QUEUE_FILES} files. Extra files were dropped.`);
    } else if (skipped > 0) {
      setError(
        `Skipped ${skipped} unsupported file${skipped === 1 ? "" : "s"} (only .csv and .pdf are accepted).`,
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
  function removePdf(key: string) {
    setPdfFiles((prev) => prev.filter((p) => p.key !== key));
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
        | { imported: number; skipped: number; duplicates: number }
        | { error: string };
      if (!res.ok || "error" in json) {
        return {
          filename: file.name,
          imported: 0,
          duplicates: 0,
          skipped: 0,
          error: "error" in json ? json.error : `HTTP ${res.status}`,
        };
      }
      return {
        filename: file.name,
        imported: json.imported ?? 0,
        duplicates: json.duplicates ?? 0,
        skipped: json.skipped ?? 0,
        error: null,
      };
    } catch (err) {
      return {
        filename: file.name,
        imported: 0,
        duplicates: 0,
        skipped: 0,
        error: err instanceof Error ? err.message : "Network error",
      };
    }
  }

  // Run the existing PDF match + upload pipeline against the queued PDFs.
  // Returns aggregate counts for the toast; the worker pool size and
  // match-by-name semantics are unchanged from the standalone dialog.
  async function processPdfBatch(
    pdfs: PdfQueueItem[],
    bumpProgress: () => void,
  ): Promise<{
    attached: number;
    created: number;
    unmatched: Array<{ filename: string }>;
    failed: Array<{ filename: string; error: string }>;
  }> {
    if (pdfs.length === 0) {
      return { attached: 0, created: 0, unmatched: [], failed: [] };
    }
    const matchRes = await fetch("/api/candidates/match-by-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        names: pdfs.map((f) => ({ name: f.parsedName })),
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
    const outcomes: ResumeUploadOutcome[] = new Array(pdfs.length);

    let cursor = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= pdfs.length) return;
        const f = pdfs[i];
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
      { length: Math.min(RESUME_UPLOAD_BATCH_SIZE, pdfs.length) },
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
    // PDF upload. CSVs run as one fetch per file; PDFs report N upload
    // completions. Match-by-name itself isn't tracked separately.
    const totalUnits = csvFiles.length + pdfFiles.length;
    let done = 0;
    setProgress({ done: 0, total: totalUnits });
    const bumpProgress = () => {
      done += 1;
      setProgress({ done, total: totalUnits });
    };

    try {
      const csvSnapshot = csvFiles.map((c) => c.file);
      const pdfSnapshot = [...pdfFiles];

      // CSVs and PDFs fan out concurrently. Each CSV resolves to a
      // CsvImportResult; the PDF batch resolves to aggregate counts.
      const csvJobs = csvSnapshot.map(async (file) => {
        const result = await importCsvOne(file);
        bumpProgress();
        return result;
      });
      const pdfJob = processPdfBatch(pdfSnapshot, bumpProgress);

      const [csvResults, pdfResults] = await Promise.all([
        Promise.all(csvJobs),
        pdfJob,
      ]);

      const csvImported = csvResults.reduce((acc, r) => acc + r.imported, 0);
      const csvDuplicates = csvResults.reduce((acc, r) => acc + r.duplicates, 0);
      const csvSkipped = csvResults.reduce((acc, r) => acc + r.skipped, 0);
      const csvErrored = csvResults.filter((r) => r.error);

      const summary = [
        csvSnapshot.length > 0
          ? `Imported ${csvImported} candidate${csvImported === 1 ? "" : "s"} from CSV`
          : null,
        pdfSnapshot.length > 0
          ? `attached ${pdfResults.attached} resume${pdfResults.attached === 1 ? "" : "s"}`
          : null,
        pdfResults.created > 0
          ? `${pdfResults.created} new candidate${pdfResults.created === 1 ? "" : "s"} created from PDF`
          : null,
      ]
        .filter(Boolean)
        .join(", ");

      const descParts: string[] = [];
      if (csvDuplicates > 0) {
        descParts.push(
          `${csvDuplicates} CSV duplicate${csvDuplicates === 1 ? "" : "s"} skipped`,
        );
      }
      if (csvSkipped > 0) {
        descParts.push(
          `${csvSkipped} CSV row${csvSkipped === 1 ? "" : "s"} skipped`,
        );
      }
      if (csvErrored.length > 0) {
        descParts.push(
          `CSV errors: ${csvErrored.map((r) => `${r.filename} (${r.error})`).join("; ")}`,
        );
      }
      if (pdfResults.unmatched.length > 0) {
        descParts.push(
          `Unparseable PDFs: ${pdfResults.unmatched.map((u) => u.filename).join(", ")}`,
        );
      }
      if (pdfResults.failed.length > 0) {
        descParts.push(
          `PDF failures: ${pdfResults.failed.map((u) => `${u.filename} (${u.error})`).join("; ")}`,
        );
      }
      const description = descParts.join(" · ");

      const anySuccess =
        csvImported > 0 || pdfResults.attached + pdfResults.created > 0;
      const anyHardFailure =
        csvErrored.length > 0 || pdfResults.failed.length > 0;

      const finalSummary = summary || "Nothing imported";
      if (anySuccess && !anyHardFailure) {
        toast.success(finalSummary, description ? { description } : undefined);
      } else if (anySuccess) {
        toast.success(finalSummary, { description });
      } else {
        toast.error(finalSummary, description ? { description } : undefined);
      }
      onDone();
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
      <p className="mb-3 text-xs text-court-fg-muted">
        Drop a Pin CSV export and/or resume PDFs in any combination. CSV
        rows import as new candidates; PDFs match existing candidates by
        first + last name and create a record on miss. Up to {MAX_QUEUE_FILES} files at a time.
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
            ? "Drop CSV or PDFs to queue"
            : totalCount === 0
              ? "Drop CSV or PDF resumes here, or click to browse"
              : `${totalCount} queued · ${remaining} more allowed`}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,.pdf,application/pdf"
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

      {pdfFiles.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
            PDF resumes ({pdfFiles.length})
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
                {pdfFiles.map((f) => (
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
                        onClick={() => removePdf(f.key)}
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
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={busy || totalCount === 0}
          className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {busy ? "Importing…" : `Import ${totalCount || ""}`.trim()}
        </button>
      </div>
    </BulkModal>
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
