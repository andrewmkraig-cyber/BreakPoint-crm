"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

// Renders a .docx resume as HTML inline in the profile preview area.
// Fetches /api/candidate-resume-html/[id] which runs mammoth server-side.
// Accepts either a Candidate cuid or a legacy numeric rfId (route resolves
// both). If the server returns 415/non-docx, callers should render the
// "Preview not available" fallback instead of mounting this component.
export function DocxPreview({
  idOrRfId,
  className,
}: {
  idOrRfId: string | number;
  className?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);
    fetch(`/api/candidate-resume-html/${idOrRfId}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? `Preview failed (${res.status})`);
          return;
        }
        setHtml(body?.html ?? "");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Preview failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [idOrRfId]);

  if (loading) {
    return (
      <div className={className}>
        <div className="flex h-64 items-center justify-center gap-2 text-sm text-court-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Rendering resume…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-court-fg-muted">
          <FileText className="h-6 w-6" />
          Preview failed — {error}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        className="prose prose-sm max-w-none bg-court-surface px-6 py-5 text-court-fg prose-headings:text-court-fg prose-strong:text-court-fg prose-a:text-brand-dark"
        // mammoth produces sanitized HTML from the docx content — no
        // embedded scripts or style attributes. Safe to inject.
        dangerouslySetInnerHTML={{ __html: html ?? "" }}
      />
    </div>
  );
}
