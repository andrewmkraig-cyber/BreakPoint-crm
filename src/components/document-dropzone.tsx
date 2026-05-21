"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { ExternalLink, FileText, Loader2, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type DropzoneFile = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt?: string;
  uploadedByName?: string | null;
  downloadHref: string;
};

type Props = {
  title?: string;
  description?: string;
  accept?: string;
  multiple?: boolean;
  isBusy?: boolean;
  files?: DropzoneFile[];
  onFiles: (files: File[]) => void;
  onDelete?: (id: string, name: string) => void;
  emptyHint?: string;
  // Read-only mode: hides the upload drop area and per-file delete
  // buttons, leaving only the downloadable file list. Used when viewing
  // a record you don't own. Defaults to false so existing callers are
  // unaffected.
  readOnly?: boolean;
};

export function DocumentDropzone({
  title,
  description,
  accept = "application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,text/plain,.txt,text/markdown,.md",
  multiple = true,
  isBusy = false,
  files = [],
  onFiles,
  onDelete,
  emptyHint,
  readOnly = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputId = useId();

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.currentTarget.files;
    if (!list?.length) return;
    onFiles(Array.from(list));
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files;
    if (!dropped?.length) return;
    onFiles(Array.from(dropped));
  }

  return (
    <div className="space-y-4">
      {(title || description) && (
        <div>
          {title && <h3 className="font-serif text-base font-semibold text-court-fg">{title}</h3>}
          {description && <p className="text-xs text-court-fg-muted">{description}</p>}
        </div>
      )}

      {!readOnly && (
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
          isDragging
            ? "border-brand bg-brand-tint/40 text-court-fg"
            : "border-court-border bg-court-surface-subtle/40 text-court-fg-muted hover:border-brand/40 hover:bg-brand-tint/20",
        )}
      >
        {isBusy ? (
          <Loader2 className="h-6 w-6 animate-spin text-brand-dark" />
        ) : (
          <Upload className={cn("h-6 w-6", isDragging ? "text-brand-dark" : "text-court-fg-muted")} />
        )}
        <div className="text-sm font-semibold text-court-fg">
          {isBusy ? "Uploading…" : multiple ? "Drop files to upload" : "Drop a file to upload"}
        </div>
        <div className="text-xs text-court-fg-muted">
          or <span className="font-medium text-brand-dark">click to browse</span>
          {emptyHint ? ` — ${emptyHint}` : ""}
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple={multiple}
          accept={accept}
          onChange={onInputChange}
          className="hidden"
        />
      </label>
      )}

      {files.length > 0 && (
        <ul className="divide-y divide-court-border rounded-lg border border-court-border bg-court-surface">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <Link
                href={f.downloadHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-2 text-court-fg hover:text-brand-dark"
              >
                <FileText className="h-4 w-4 shrink-0 text-court-fg-muted" />
                <span className="truncate font-medium">{f.filename}</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-court-fg-muted" />
              </Link>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[11px] text-court-fg-muted">{formatBytes(f.sizeBytes)}</span>
                {f.uploadedAt && (
                  <span className="hidden text-[11px] text-court-fg-muted md:inline">
                    {new Date(f.uploadedAt).toLocaleDateString()}
                  </span>
                )}
                {onDelete && !readOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete ${f.filename}?`)) onDelete(f.id, f.filename);
                    }}
                    className="rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 grass:hover:bg-red-900/30"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
