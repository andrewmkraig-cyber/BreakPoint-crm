"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export function BrandResumeButton({
  candidateId,
  disabled,
}: {
  candidateId: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    const toastId = toast.loading("Branding resume…");
    try {
      const res = await fetch("/api/redact-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ candidateId }),
      });
      if (!res.ok) {
        let detail = `Server returned ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) detail = body.error;
        } catch {
          // Non-JSON error payload — keep the status code message.
        }
        throw new Error(detail);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="?([^"]+)"?/i.exec(disposition);
      const downloadName = match ? decodeURIComponent(match[1]) : "branded-resume";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const redactions = res.headers.get("x-redactions") ?? "?";
      toast.success("Branded resume ready", {
        id: toastId,
        description: `${redactions} contact item${redactions === "1" ? "" : "s"} removed.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      toast.error("Couldn't brand resume", { id: toastId, description: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="h-3 w-3" />
      )}
      {busy ? "Branding…" : "Brand Resume"}
    </button>
  );
}
