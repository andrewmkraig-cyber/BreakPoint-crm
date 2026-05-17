"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Send,
  ListPlus,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  bulkApplyCandidatesToJob,
  bulkAddCandidatesToList,
  bulkAddCandidatesToNewList,
  bulkSendEmail,
  getCandidateContactsForBulk,
  getJobMergeValuesForBulk,
  getOpenJobsForBulkPicker,
  type BulkPickerJob,
  type BulkRecipient,
} from "@/app/candidates/bulk-actions";
import type { CandidateListSummary } from "@/app/candidates/lists-actions";
import { EmailComposer, type EmailDraft } from "@/components/email-composer";
import { listActiveTemplates, type ActiveTemplateSummary } from "@/app/email/actions";
import type { MergeFieldValues } from "@/lib/merge-fields";

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

// Job + client tokens that, when present in a picked template OR in
// the eventual send draft, require a job context to be resolved
// before send. Subset of MERGE_FIELDS — only fields that
// getJobMergeValuesForBulk actually populates today.
const JOB_MERGE_TOKENS = [
  "[Job Title]",
  "[Job Location]",
  "[Client Company Name]",
  "[Client Company Website]",
  "[Client Company LinkedIn]",
];

function textNeedsJob(text: string): boolean {
  return JOB_MERGE_TOKENS.some((t) => text.includes(t));
}

function templateNeedsJob(template: ActiveTemplateSummary): boolean {
  return textNeedsJob(template.subject) || textNeedsJob(template.body);
}

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

  // Recruiter-typed prompt for Generate-with-Claude. Lives outside
  // EmailComposer because the composer's onGenerate callback has no
  // prompt arg — we read this state inside our onGenerate handler.
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  // Local "Use Template" picker. Bulk email bypasses EmailComposer's
  // built-in showTemplatePicker because the two-step job-tokens flow
  // required parking a Promise inside the composer's onPickTemplate
  // transition, which left the picker stuck whenever the parent re-
  // rendered. Driving the composer's draft from outside via
  // applyDraftRef makes this a normal local UI flow.
  const [localTemplates, setLocalTemplates] = useState<ActiveTemplateSummary[]>([]);
  const [localTemplatesLoaded, setLocalTemplatesLoaded] = useState(false);
  const [localTemplatesError, setLocalTemplatesError] = useState<string | null>(null);
  // Native select on purpose: the bulk modal has its own stacking/overlay
  // context that kept breaking custom popovers. Individual composer keeps
  // its popover.
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const applyDraftRef = useRef<((d: { subject: string; body: string }) => void) | null>(null);

  // Load active templates once when the bulk dialog mounts so the
  // picker dropdown opens instantly with the full list.
  useEffect(() => {
    let cancelled = false;
    listActiveTemplates()
      .then((list) => {
        if (cancelled) return;
        setLocalTemplates(list);
        setLocalTemplatesError(null);
        setLocalTemplatesLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLocalTemplatesError("Couldn't load templates");
        setLocalTemplatesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Two-step Use Template → Pick Job overlay. Now just tracks which
  // template is awaiting a job pick; no parked Promise.
  const [pendingJobPick, setPendingJobPick] = useState<{
    template: ActiveTemplateSummary;
  } | null>(null);
  const [jobMergeValues, setJobMergeValues] = useState<MergeFieldValues | null>(null);
  const [jobs, setJobs] = useState<BulkPickerJob[] | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [pickedJobKey, setPickedJobKey] = useState("");
  const [resolvingJob, setResolvingJob] = useState(false);

  // Lazy-load the org's open jobs the first time the picker opens.
  // Cached for the dialog's lifetime so subsequent template picks
  // reuse the list.
  useEffect(() => {
    if (!pendingJobPick) return;
    if (jobs !== null || jobsLoading) return;
    setJobsLoading(true);
    void (async () => {
      try {
        const rows = await getOpenJobsForBulkPicker();
        setJobs(rows);
      } catch {
        toast.error("Couldn't load jobs for picker");
        setJobs([]);
      } finally {
        setJobsLoading(false);
      }
    })();
  }, [pendingJobPick, jobs, jobsLoading]);

  function applyTemplateDraft(template: ActiveTemplateSummary) {
    applyDraftRef.current?.({ subject: template.subject, body: template.body });
  }

  function onPickLocalTemplate(template: ActiveTemplateSummary) {
    console.log("onPickLocalTemplate called", template?.name);
    try {
      if (
        !template ||
        typeof template.id !== "string" ||
        typeof template.subject !== "string" ||
        typeof template.body !== "string"
      ) {
        console.log("onPickLocalTemplate: missing required fields", {
          hasTemplate: !!template,
          idType: typeof template?.id,
          subjectType: typeof template?.subject,
          bodyType: typeof template?.body,
        });
        toast.error("Template is missing required fields.");
        setSelectedTemplateId("");
        return;
      }
      const needsJob = templateNeedsJob(template);
      console.log("onPickLocalTemplate: needsJob?", needsJob);
      if (!needsJob) {
        setJobMergeValues(null);
        applyTemplateDraft(template);
        setSelectedTemplateId("");
        console.log("onPickLocalTemplate: applied draft (no job tokens)");
        return;
      }
      setPendingJobPick({ template });
      console.log("onPickLocalTemplate: opened job picker");
    } catch (err) {
      console.error("onPickLocalTemplate threw", err);
      toast.error("Couldn't apply template", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onConfirmJobPick() {
    if (!pendingJobPick) return;
    if (!pickedJobKey) return;
    const job = jobs?.find((j) => j.key === pickedJobKey);
    if (!job) {
      toast.error("Couldn't find that job in the loaded list.");
      return;
    }
    const template = pendingJobPick.template;
    setResolvingJob(true);
    try {
      const values = await getJobMergeValuesForBulk({
        jobCuid: job.jobCuid,
        jobRfId: job.jobRfId,
        clientCuid: job.clientCuid,
        clientRfId: job.clientRfId,
      });
      setJobMergeValues(values);
      applyTemplateDraft(template);
      setPendingJobPick(null);
      setPickedJobKey("");
      setSelectedTemplateId("");
    } catch (e) {
      toast.error("Couldn't resolve job fields", {
        description: e instanceof Error ? e.message : "Server error",
      });
    } finally {
      setResolvingJob(false);
    }
  }

  function onCancelJobPick() {
    setPendingJobPick(null);
    setPickedJobKey("");
    setSelectedTemplateId("");
  }

  // Recipients panel state — lazy-fetched on first toggle expand so a
  // dialog the recruiter never opens the panel on doesn't pay the
  // round-trip.
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [recipients, setRecipients] = useState<BulkRecipient[] | null>(null);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  useEffect(() => {
    if (!recipientsOpen) return;
    if (recipients !== null || recipientsLoading) return;
    setRecipientsLoading(true);
    void (async () => {
      try {
        const rows = await getCandidateContactsForBulk(candidateIds);
        setRecipients(rows);
      } catch {
        toast.error("Couldn't load recipient list");
        setRecipients([]);
      } finally {
        setRecipientsLoading(false);
      }
    })();
  }, [recipientsOpen, recipients, recipientsLoading, candidateIds]);

  // Confirmation gate for batches > 25.
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
      jobMergeValues: jobMergeValues ?? undefined,
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
    // Block sending when the draft still contains job tokens but no
    // job has been picked. Catches the case where the recruiter
    // cancelled the picker after applying a job-using template, or
    // typed tokens manually without picking a job.
    const haystack = `${draft.subject}\n${draft.body}`;
    if (textNeedsJob(haystack) && !jobMergeValues) {
      toast.error("Pick a job for the job context fields, or remove them from the body.");
      throw new Error("job_context_required");
    }
    if (n > BULK_EMAIL_CONFIRM_THRESHOLD) {
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
    } catch {
      setConfirmDraft(null);
    } finally {
      setConfirming(false);
    }
  }

  // Claude generator — reads aiPrompt from local state, POSTs to the
  // same /api/mail/ai-compose endpoint the mail-tab composer uses, and
  // returns the body string. EmailComposer replaces its body content
  // with the returned text. Throws on missing prompt / empty response
  // so the composer surfaces the error to the recruiter.
  async function onGenerateBody(): Promise<string> {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      setAiPanelOpen(true);
      throw new Error("Type a prompt in the AI panel above first.");
    }
    const res = await fetch("/api/mail/ai-compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, includeSubject: false }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.error ?? `Generation failed (${res.status})`;
      throw new Error(msg);
    }
    const text =
      typeof json?.body === "string" && json.body
        ? json.body
        : typeof json?.bodyHtml === "string"
          ? json.bodyHtml
          : "";
    if (!text) throw new Error("Claude returned an empty draft.");
    return text;
  }

  const noEmailCount = recipients
    ? recipients.filter((r) => !r.email).length
    : 0;

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
              One Gmail send per recipient. Recipients are resolved automatically from each candidate&apos;s email on file.
            </p>
            <p className="mt-1 text-[11px] text-court-fg-muted">
              Merge fields: <code>[Candidate First Name]</code>,{" "}
              <code>[Candidate Last Name]</code>,{" "}
              <code>[Candidate Current Title]</code>,{" "}
              <code>[Candidate Current Company]</code>,{" "}
              <code>[Job Title]</code>, <code>[Job Location]</code>,{" "}
              <code>[Client Company Name]</code>
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

        <div className="border-b border-court-border bg-court-surface-subtle/40">
          <button
            type="button"
            onClick={() => setRecipientsOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-5 py-2 text-left transition hover:bg-court-surface-subtle/70"
          >
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-court-fg">
              {recipientsOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <Users className="h-3.5 w-3.5" />
              {recipientsOpen ? "Hide" : "View"} {n} recipient{n === 1 ? "" : "s"}
            </span>
            {!recipientsOpen && recipients && noEmailCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700">
                {noEmailCount} no email
              </span>
            )}
          </button>
          {recipientsOpen && (
            <div>
              {recipientsLoading && (
                <div className="px-5 pb-3 pt-1 text-[11px] text-court-fg-muted">
                  Loading recipient list…
                </div>
              )}
              {!recipientsLoading && recipients && (
                <>
                  {noEmailCount > 0 && (
                    <div className="border-t border-court-border bg-red-50 px-5 py-1.5 text-[11px] font-semibold text-red-700">
                      {noEmailCount} of {recipients.length} recipient{recipients.length === 1 ? "" : "s"} {noEmailCount === 1 ? "has" : "have"} no email on file and will be skipped.
                    </div>
                  )}
                  <ul className="max-h-56 overflow-y-auto divide-y divide-court-border/60 border-t border-court-border bg-court-surface text-xs">
                    {recipients.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-3 px-5 py-1.5"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-court-fg">
                          {r.name}
                        </span>
                        {r.email ? (
                          <span className="shrink-0 truncate text-court-fg-muted">
                            {r.email}
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700">
                            No email
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        <div className="border-b border-court-border bg-court-surface-subtle/40">
          <button
            type="button"
            onClick={() => setAiPanelOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 px-5 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-court-fg-muted transition hover:text-court-fg"
          >
            {aiPanelOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Sparkles className="h-3 w-3" />
            AI prompt
            {aiPrompt.trim().length > 0 && !aiPanelOpen && (
              <span className="ml-1 normal-case tracking-normal text-court-fg">
                — &ldquo;{aiPrompt.trim().slice(0, 60)}
                {aiPrompt.trim().length > 60 ? "…" : ""}&rdquo;
              </span>
            )}
          </button>
          {aiPanelOpen && (
            <div className="px-5 pb-3">
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Describe the email Claude should draft — e.g. 'Friendly outreach about a senior backend role at our fintech client, ask if they're open to a 15-min intro call.'"
                rows={3}
                className="w-full rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              <p className="mt-1 text-[11px] text-court-fg-muted">
                Then click <span className="font-medium">Generate with Claude</span> in the composer toolbar to draft the body. Edit with Claude refines the body in place.
              </p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <EmailComposer
            title={`Bulk email — ${n} recipient${n === 1 ? "" : "s"}`}
            initial={initial}
            onClose={onClose}
            onSend={onSend}
            hideRecipientFields
            enableEditWithClaude
            onGenerate={onGenerateBody}
            applyDraftRef={applyDraftRef}
            sendLabel={`Send to ${n} candidate${n === 1 ? "" : "s"}`}
            sendingLabel="Sending…"
            sendDisabled={confirmDraft !== null}
            footerExtras={
              <div className="relative inline-flex">
                <FileText className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-court-fg" />
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-court-fg" />
                <select
                  value={selectedTemplateId}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const t = localTemplates.find((x) => x.id === id);
                    if (!t) return;
                    setSelectedTemplateId(id);
                    onPickLocalTemplate(t);
                  }}
                  disabled={
                    !localTemplatesLoaded ||
                    Boolean(localTemplatesError) ||
                    localTemplates.length === 0
                  }
                  title="Apply a saved template to this bulk email"
                  className="appearance-none rounded-md border border-court-border bg-court-surface pl-8 pr-7 py-2 text-xs font-semibold text-court-fg shadow-sm transition hover:border-brand/40 hover:text-brand-dark focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
                >
                  <option value="">
                    {!localTemplatesLoaded
                      ? "Loading templates..."
                      : localTemplatesError
                        ? "Couldn't load templates"
                        : localTemplates.length === 0
                          ? "No active templates"
                          : "Use Template"}
                  </option>
                  {localTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            }
          />
          {jobMergeValues && (
            <div className="border-t border-court-border bg-court-surface-subtle/40 px-5 py-1.5 text-[11px] text-court-fg-muted">
              Job context resolved. Recipients will receive filled job fields at send time.
            </div>
          )}
        </div>

        {pendingJobPick && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-court-bg/85 p-6 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-xl border border-court-border bg-court-surface p-5 shadow-xl">
              <h3 className="font-serif text-base font-semibold text-court-fg">
                Pick a job for &ldquo;{pendingJobPick.template.name}&rdquo;
              </h3>
              <p className="mt-1 text-xs text-court-fg-muted">
                Job context fields (<code>[Job Title]</code>, <code>[Client Company Name]</code>, etc.) will be filled the same way for every recipient at send time.
              </p>
              {jobsLoading || jobs === null ? (
                <div className="mt-3 inline-flex items-center gap-2 text-xs text-court-fg-muted">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading jobs…
                </div>
              ) : jobs.length === 0 ? (
                <div className="mt-3 rounded-md border border-dashed border-court-border bg-court-surface-subtle/40 px-3 py-3 text-center text-xs text-court-fg-muted">
                  No open jobs found for this org.
                </div>
              ) : (
                <select
                  value={pickedJobKey}
                  onChange={(e) => setPickedJobKey(e.target.value)}
                  disabled={resolvingJob}
                  size={Math.min(6, Math.max(3, jobs.length))}
                  className="mt-3 w-full rounded-md border border-court-border bg-court-surface px-2 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
                >
                  {jobs.map((j) => (
                    <option key={j.key} value={j.key}>
                      {j.label}
                    </option>
                  ))}
                </select>
              )}
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancelJobPick}
                  disabled={resolvingJob}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void onConfirmJobPick()}
                  disabled={!pickedJobKey || resolvingJob || jobsLoading || jobs === null}
                  className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
                >
                  {resolvingJob ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Use this job
                </button>
              </div>
            </div>
          </div>
        )}

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
