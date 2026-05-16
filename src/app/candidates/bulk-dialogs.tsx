"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Send, ListPlus, X } from "lucide-react";
import { toast } from "sonner";
import {
  bulkApplyCandidatesToJob,
  bulkAddCandidatesToList,
  bulkAddCandidatesToNewList,
  bulkSendEmail,
  type BulkPickerJob,
} from "@/app/candidates/bulk-actions";
import type { CandidateListSummary } from "@/app/candidates/lists-actions";
import { EmailComposer, type EmailDraft } from "@/components/email-composer";

// Shared bulk-action modals used by both the /candidates global page
// and the job Matches tab. Extracted out of candidates-view.tsx so the
// two surfaces share a single picker/dialog implementation.

export function BulkApplyDialog({
  candidateIds,
  jobs,
  onClose,
  onDone,
}: {
  candidateIds: string[];
  jobs: BulkPickerJob[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [pickKey, setPickKey] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const picked = jobs.find((j) => j.key === pickKey) ?? null;
  const filtered = filter.trim()
    ? jobs.filter((j) => j.label.toLowerCase().includes(filter.trim().toLowerCase()))
    : jobs;

  async function onApply() {
    if (!picked) return;
    setBusy(true);
    try {
      const res = await bulkApplyCandidatesToJob({
        candidateIds,
        jobCuid: picked.jobCuid,
        jobRfId: picked.jobRfId,
        clientCuid: picked.clientCuid,
        clientRfId: picked.clientRfId,
      });
      if (!res.ok && res.applied === 0) {
        toast.error("Couldn't apply candidates", {
          description: res.errors[0] ?? "Unknown error",
        });
        return;
      }
      const desc = [
        res.applied > 0 ? `${res.applied} applied` : null,
        res.skipped > 0 ? `${res.skipped} already linked` : null,
        res.errors.length > 0 ? `${res.errors.length} errors` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(`Bulk apply complete${desc ? ` — ${desc}` : ""}`);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BulkModal
      title={`Apply ${candidateIds.length} candidate${candidateIds.length === 1 ? "" : "s"} to a job`}
      onClose={onClose}
    >
      <p className="mb-2 text-xs text-court-fg-muted">
        Already-linked candidates are skipped automatically.
      </p>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter jobs…"
        disabled={busy}
        className="mb-2 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
      />
      <select
        value={pickKey}
        onChange={(e) => setPickKey(e.target.value)}
        disabled={busy}
        size={Math.min(8, Math.max(3, filtered.length))}
        className="w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
      >
        {filtered.length === 0 && (
          <option value="" disabled>
            No matching jobs
          </option>
        )}
        {filtered.map((j) => (
          <option key={j.key} value={j.key}>
            {j.label}
          </option>
        ))}
      </select>
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
          onClick={onApply}
          disabled={busy || !picked}
          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm transition hover:bg-amber-200 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Apply
        </button>
      </div>
    </BulkModal>
  );
}

export function BulkAddToListDialog({
  candidateIds,
  lists,
  onClose,
  onDone,
}: {
  candidateIds: string[];
  lists: CandidateListSummary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(
    lists.length > 0 ? "existing" : "new",
  );
  const [listId, setListId] = useState<string>(lists[0]?.id ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setBusy(true);
    try {
      if (mode === "existing") {
        if (!listId) {
          toast.error("Pick a list");
          return;
        }
        const res = await bulkAddCandidatesToList({ candidateIds, listId });
        if (!res.ok) {
          toast.error("Couldn't add to list", { description: res.error });
          return;
        }
        toast.success(`Added ${res.added} to list`);
      } else {
        const res = await bulkAddCandidatesToNewList({ candidateIds, name });
        if (!res.ok) {
          toast.error("Couldn't create list", { description: res.error });
          return;
        }
        toast.success(`Created list and added ${res.added} candidates`);
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BulkModal
      title={`Add ${candidateIds.length} candidate${candidateIds.length === 1 ? "" : "s"} to a list`}
      onClose={onClose}
    >
      <div className="mb-3 flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode("existing")}
          disabled={lists.length === 0}
          className={
            "rounded-md border px-2 py-1 font-medium transition " +
            (mode === "existing"
              ? "border-court-accent bg-court-accent-tint text-court-accent-dark"
              : "border-court-border text-court-fg-muted hover:text-court-fg")
          }
        >
          Existing list
        </button>
        <button
          type="button"
          onClick={() => setMode("new")}
          className={
            "rounded-md border px-2 py-1 font-medium transition " +
            (mode === "new"
              ? "border-court-accent bg-court-accent-tint text-court-accent-dark"
              : "border-court-border text-court-fg-muted hover:text-court-fg")
          }
        >
          New list
        </button>
      </div>
      {mode === "existing" ? (
        <select
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          disabled={busy}
          className="w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
        >
          <option value="">— pick a list —</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.memberCount})
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New list name"
          maxLength={80}
          disabled={busy}
          className="w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
        />
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
          onClick={onSave}
          disabled={busy || (mode === "existing" ? !listId : name.trim().length === 0)}
          className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListPlus className="h-3 w-3" />}
          {mode === "existing" ? "Add" : "Create + add"}
        </button>
      </div>
    </BulkModal>
  );
}

// Email-specific bulk dialog. Wraps EmailComposer (which does not
// render its own modal shell) in a wider backdrop than BulkModal —
// the composer needs room for the body editor + template picker.
//
// Recipients are NOT taken from the composer's To/Cc/Bcc fields;
// bulkSendEmail resolves Candidate.email per id server-side. The
// notice above the composer makes this explicit so the recruiter
// doesn't waste keystrokes filling in those fields.
const BULK_EMAIL_CONFIRM_THRESHOLD = 25;

export function BulkEmailDialog({
  candidateIds,
  onClose,
  onDone,
}: {
  candidateIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const n = candidateIds.length;
  // When set, the recruiter clicked Send on a batch larger than
  // BULK_EMAIL_CONFIRM_THRESHOLD. The draft is parked here and an
  // overlay covers the composer until they Cancel (clear this state)
  // or confirm Yes (call actualSend with the parked draft).
  const [confirmDraft, setConfirmDraft] = useState<EmailDraft | null>(null);
  const [confirming, setConfirming] = useState(false);

  const initial: EmailDraft = {
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    body: "",
  };

  async function actualSend(draft: EmailDraft): Promise<void> {
    const res = await bulkSendEmail({
      candidateIds,
      subject: draft.subject,
      body: draft.body,
      bodyHtml: draft.bodyHtml,
    });
    if (res.sent === 0) {
      const head = res.errors[0] ?? "No candidates had an email on file.";
      toast.error("Bulk email send failed", { description: head });
      throw new Error(head);
    }
    const tail = [
      res.skipped > 0 ? `${res.skipped} skipped` : null,
      res.errors.length > 0 ? `${res.errors.length} errors` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    toast.success(
      `Sent to ${res.sent} candidate${res.sent === 1 ? "" : "s"}${tail ? ` — ${tail}` : ""}`,
      res.errors.length > 0
        ? { description: res.errors.slice(0, 3).join("\n") }
        : undefined,
    );
    onDone();
  }

  async function onSend(draft: EmailDraft): Promise<void> {
    if (n > BULK_EMAIL_CONFIRM_THRESHOLD) {
      // Park the draft and let the composer transition out of its
      // sending state — the overlay below covers it and gates the
      // real send on the recruiter's explicit Yes.
      setConfirmDraft(draft);
      return;
    }
    await actualSend(draft);
  }

  async function onConfirmYes() {
    if (!confirmDraft) return;
    setConfirming(true);
    try {
      await actualSend(confirmDraft);
      // actualSend resolves on success → onDone fires → parent
      // unmounts this dialog, so we don't need to clear confirmDraft.
    } catch {
      // actualSend already toasted the error. Drop the overlay so the
      // recruiter is back in the composer to edit / retry.
      setConfirmDraft(null);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label={`Email ${n} candidates`}
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-court-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-serif text-base font-semibold text-court-fg">
              Email {n} candidate{n === 1 ? "" : "s"}
            </h2>
            <p className="mt-0.5 text-xs text-court-fg-muted">
              One Gmail send per recipient. Recipients are resolved
              automatically from each candidate&apos;s email on file.
            </p>
            <p className="mt-1 text-[11px] text-court-fg-muted">
              Merge fields: <code>[Candidate First Name]</code>,{" "}
              <code>[Candidate Last Name]</code>,{" "}
              <code>[Candidate Current Title]</code>,{" "}
              <code>[Candidate Current Company]</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <EmailComposer
            title={`Bulk email — ${n} recipient${n === 1 ? "" : "s"}`}
            initial={initial}
            onClose={onClose}
            onSend={onSend}
            showTemplatePicker
            hideRecipientFields
            sendLabel={`Send to ${n} candidate${n === 1 ? "" : "s"}`}
            sendingLabel="Sending…"
            sendDisabled={confirmDraft !== null}
          />
        </div>

        {confirmDraft && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-court-bg/85 p-6 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-xl border border-court-border bg-court-surface p-5 shadow-xl">
              <h3 className="font-serif text-base font-semibold text-court-fg">
                Confirm bulk send
              </h3>
              <p className="mt-2 text-sm text-court-fg-muted">
                You&apos;re about to email <span className="font-semibold text-court-fg">{n}</span> candidate{n === 1 ? "" : "s"}. Are you sure?
              </p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDraft(null)}
                  disabled={confirming}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void onConfirmYes()}
                  disabled={confirming}
                  className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
                >
                  {confirming ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Yes, send to {n}
                </button>
              </div>
            </div>
          </div>
        )}
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
