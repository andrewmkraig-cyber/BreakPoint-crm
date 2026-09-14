"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, UserX, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

// Confirmation prompt fired before rejecting a candidate-job pairing.
// Replaces the old `window.confirm()` so the recruiter can choose
// whether the templated rejection email goes out or not. The action
// itself takes a `sendRejectionEmail` flag — this dialog is just the
// UI gate.
//
// Defaults to NOT sending — the recruiter must opt in. Andrew's
// preference: rejections are often quiet (no comms) and the dialog
// shouldn't nudge a send by default.
//
// With the checkbox on, an "Edit email" button loads the rendered
// Candidate Rejected template for this placement (merge fields
// resolved) into an inline subject/body editor. Whatever is in the
// editor when Send is clicked goes out verbatim through the same
// trigger path, so the audit row still reads candidate_rejection_email.

export type RejectionEmailPreview = {
  to: string;
  subject: string;
  body: string;
  templateName: string;
};

export type RejectionEmailOutcome =
  | { status: "sent" | "drafted" }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

export type RejectConfirmOptions = {
  sendRejectionEmail: boolean;
  // Present only when the recruiter opened the editor. Sent verbatim.
  rejectionEmail?: { subject: string; body: string } | null;
};

// Toast copy derived from what the server actually did with the email,
// so "Email sent" is never claimed for a skipped or failed fire.
export function describeRejectionOutcome(
  email: RejectionEmailOutcome | null | undefined,
): { ok: boolean; title: string; description?: string } {
  if (!email) return { ok: true, title: "Rejected" };
  if (email.status === "skipped") {
    const why =
      email.reason === "no_recipient"
        ? "the candidate has no email address on file"
        : email.reason === "missing"
          ? "no Candidate Rejected template exists"
          : email.reason === "inactive"
            ? "the Candidate Rejected template is inactive"
            : email.reason === "trigger_disabled"
              ? "the trigger is disabled in Settings"
              : email.reason;
    return { ok: false, title: "Rejected, but the email was not sent", description: why };
  }
  if (email.status === "error") {
    return { ok: false, title: "Rejected, but the email failed", description: email.error };
  }
  return {
    ok: true,
    title: email.status === "drafted" ? "Rejected. Email drafted in Gmail" : "Rejected. Email sent",
  };
}

export function RejectCandidateDialog({
  candidateName,
  jobTitle,
  onClose,
  onConfirm,
  loadRejectionEmail,
}: {
  candidateName: string;
  jobTitle?: string;
  onClose: () => void;
  // Resolves once the underlying reject action completes (so the
  // dialog can show a spinner). Throwing here is treated as failure
  // — the dialog stays open and surfaces the error to the caller's
  // toast instead.
  onConfirm: (opts: RejectConfirmOptions) => Promise<void>;
  // Renders the rejection template for this placement. Omitted by the
  // bulk dialogs (many placements, no single preview) which then show
  // no Edit button.
  loadRejectionEmail?: () => Promise<
    { ok: true; value: RejectionEmailPreview } | { ok: false; error: string }
  >;
}) {
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RejectionEmailPreview | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // Esc key dismisses. Listener mounts only while the dialog is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function onOpenEditor() {
    if (!loadRejectionEmail) return;
    if (preview) {
      setEditorOpen(true);
      return;
    }
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await loadRejectionEmail();
      if (!res.ok) {
        setPreviewError(res.error);
        return;
      }
      setPreview(res.value);
      setSubject(res.value.subject);
      setBody(res.value.body);
      setEditorOpen(true);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Couldn't load the email.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function onClickConfirm() {
    setBusy(true);
    try {
      await onConfirm({
        sendRejectionEmail: sendEmail,
        rejectionEmail: sendEmail && editorOpen && preview ? { subject, body } : null,
      });
    } finally {
      setBusy(false);
    }
  }

  const title = jobTitle ? `${candidateName}: ${jobTitle}` : candidateName;
  const showEditor = Boolean(sendEmail && editorOpen && preview);

  return (
    <div
      role="dialog"
      aria-label="Reject candidate"
      // whitespace-normal: the pipeline table opens this dialog from
      // inside a `whitespace-nowrap` action cell, and the fixed overlay
      // still inherits that, which pushed the description text past the
      // box on one unbroken line.
      className="fixed inset-0 z-[1100] flex items-center justify-center whitespace-normal bg-black/40 p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={
          "w-full rounded-xl border border-court-border backdrop-blur-sm bg-court-surface/95 p-5 shadow-[0_24px_64px_rgba(0,0,0,0.25),0_4px_16px_rgba(0,0,0,0.15)] " +
          (showEditor ? "max-w-xl" : "max-w-md")
        }
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words font-serif text-base font-semibold text-court-fg">
            Reject {title}?
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 break-words text-xs text-court-fg-muted">
          Moves the placement to <span className="font-semibold">Rejected</span>{" "}
          and pulls the candidate off the active pipeline. The row stays in Ace
          for audit history.
        </p>
        <div className="rounded-md border border-court-border bg-court-surface-subtle/40 p-3 text-sm">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              disabled={busy}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand"
            />
            <span className="min-w-0 flex-1 break-words">
              <span className="block text-court-fg">
                Send rejection email to the candidate
              </span>
              <span className="block text-[11px] text-court-fg-muted">
                Sends the active <em>Candidate Rejected</em> template. Off by
                default.
              </span>
            </span>
          </label>
          {sendEmail && loadRejectionEmail && !showEditor && (
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void onOpenEditor()}
                disabled={busy || loadingPreview}
                className="h-7 gap-1 px-2 py-1 text-[11px] font-medium"
              >
                {loadingPreview ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Pencil className="h-3 w-3" />
                )}
                Preview and edit email
              </Button>
              {previewError && (
                <span className="text-[11px] text-red-600 dark:text-red-400">
                  {previewError}
                </span>
              )}
            </div>
          )}
          {showEditor && preview && (
            <div className="mt-3 space-y-2 border-t border-court-border pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-court-fg-muted">
                <span className="min-w-0 break-all">
                  To: {preview.to || "(no candidate email on file)"}
                </span>
                <span className="shrink-0">Template: {preview.templateName}</span>
              </div>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={busy}
                placeholder="Subject"
                aria-label="Rejection email subject"
                className="h-8 text-xs"
              />
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
                rows={10}
                aria-label="Rejection email body"
                className="max-h-[50vh] min-h-[10rem] resize-y text-xs leading-relaxed"
              />
              <p className="text-[11px] text-court-fg-muted">
                Your signature is added on send. This exact text goes out when you click Send.
              </p>
            </div>
          )}
        </div>
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
            disabled={busy || (sendEmail && showEditor && !subject.trim())}
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
