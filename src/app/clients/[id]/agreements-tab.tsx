"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { uploadAgreement, deleteAgreement } from "@/app/clients/[id]/actions";

export type AgreementRow = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName: string | null;
};

export function AgreementsTab({ clientId, items }: { clientId: number; items: AgreementRow[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file before uploading.");
      return;
    }
    startTransition(async () => {
      const result = await uploadAgreement(clientId, data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(`Uploaded ${file.name}.`);
      form.reset();
      setFileName("");
      router.refresh();
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(`Delete ${name}? This can't be undone.`)) return;
    startTransition(async () => {
      const result = await deleteAgreement(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-dashed border-border bg-white p-5 shadow-sm"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-navy">
          <Upload className="h-4 w-4 text-brand-dark" /> Upload agreement
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          PDFs or Word documents, up to 20MB. Stored privately in ACE. DocuSign auto-import will come later.
        </p>
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
          <label className="flex flex-1 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-navy-400 transition hover:border-brand/40 hover:text-navy">
            <span className="truncate">{fileName || "Choose a file…"}</span>
            <span className="rounded-md bg-white px-2 py-1 text-[11px] font-medium text-brand-dark">Browse</span>
            <input
              ref={fileRef}
              name="file"
              type="file"
              accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            />
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload
          </button>
        </div>
        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}
        {success && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{success}</div>}
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold text-navy">
          Uploaded agreements
        </div>
        {items.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            No agreements uploaded yet.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">File</th>
                <th className="px-5 py-3 font-medium">Size</th>
                <th className="px-5 py-3 font-medium">Uploaded</th>
                <th className="px-5 py-3 font-medium">By</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((a) => (
                <tr key={a.id} className="transition hover:bg-brand-tint/40">
                  <td className="px-5 py-3">
                    <Link
                      href={`/api/client-agreements/${a.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 font-medium text-navy hover:text-brand-dark"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {a.filename}
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-navy-400">{formatBytes(a.sizeBytes)}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {new Date(a.uploadedAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{a.uploadedByName ?? "—"}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        href={`/api/client-agreements/${a.id}?download=1`}
                        className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:text-navy"
                      >
                        Download
                      </Link>
                      <button
                        type="button"
                        onClick={() => onDelete(a.id, a.filename)}
                        className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
