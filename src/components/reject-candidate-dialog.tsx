"use client";

import { useEffect, useState } from "react";
import { Loader2, UserX, X } from "lucide-react";

import { Button } from "@/components/ui/button";

// Confirmation prompt fired before rejecting a candidate-job pairing.
// Replaces the old `window.confirm()` so the recruiter can choose
// whether the templated rejection email goes out or not. The action
// itself takes a `sendRejectionEmail` flag — this dialog is just the
// UI gate.
//
// Defaults to NOT sending — the recruiter must opt in. Andrew's
// preference: rejections are often quiet (no comms) and the dialog
// shouldn't nudge a send by default.

export function RejectCandidateDialog({
  candidateName,
  jobTitle,
  onClose,
  onConfirm,
}: {
  candidateName: string;
  jobTitle?: string;
  onClose: () => void;
  // Resolves once the underlying reject action completes (so the
  // dialog can show a spinner). Throwing here is treated as failure
  // — the dialog stays open and surfaces the error to the caller's
  // toast instead.
  onConfirm: (opts: { sendRejectionEmail: boolean }) => Promise<void>;
}) {
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  // Esc key dismisses. Listener mounts only while the dialog is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function onClickConfirm() {
    setBusy(true);
    try {
      await onConfirm({ sendRejectionEmail: sendEmail });
    } finally {
      setBusy(false);
    }
  }

  const subject = jobTitle ? `${candidateName} — ${jobTitle}` : candidateName;

  return (
    <div
      role="dialog"
      aria-label="Reject candidate"
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-court-border backdrop-blur-sm bg-court-surface/95 p-5 shadow-[0_24px_64px_rgba(0,0,0,0.25),0_4px_16px_rgba(0,0,0,0.15)]"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-serif text-base font-semibold text-court-fg">
            Reject {subject}?
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-xs text-court-fg-muted">
          This moves the placement to <span className="font-semibold">Rejected</span>{" "}
          and removes the candidate from the active pipeline for this job. The
          row stays in Ace for audit history — it just stops showing in the
          live counts.
        </p>
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-court-border bg-court-surface-subtle/40 p-3 text-sm">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-brand"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-court-fg">
              Send rejection email to the candidate
            </span>
            <span className="block text-[11px] text-court-fg-muted">
              Fires the active <em>Candidate Rejected</em> template from
              Settings → Email Templates. Off by default.
            </span>
          </span>
        </label>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
          >
            Cancel
          </button>
          <Button
            type="button"
            variant="reject"
            size="sm"
            onClick={onClickConfirm}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <UserX className="h-3 w-3" />
            )}
            {sendEmail ? "Send Rejection Email" : "Reject"}
          </Button>
        </div>
      </div>
    </div>
  );
}
