"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Loader2,
  Send,
  ListPlus,
  Sparkles,
  Users,
  Variable,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import {
  bulkApplyCandidatesToJob,
  bulkAddCandidatesToList,
  bulkAddCandidatesToNewList,
  bulkSendEmail,
  scheduleBulkEmail,
  getJobMergeValuesForBulk,
  getOpenJobsForBulkPicker,
  getBulkQueueStatus,
  cancelBulkQueue,
  type BulkPickerJob,
  type BulkQueueStatus,
} from "@/app/candidates/bulk-actions";
import type { CandidateListSummary } from "@/app/candidates/lists-actions";
import type { EmailDraft } from "@/components/email-composer";
import type { RichTextBodyEditorHandle } from "@/components/rich-text-body-editor";
import { EditWithClaudeMenu, EditWithClaudeCustomPanel, type EditType } from "@/components/edit-with-claude-menu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useSendLater } from "@/components/mail/send-later-popover";
import { formatScheduledTime } from "@/lib/timezone";
import { listActiveTemplates, type ActiveTemplateSummary } from "@/app/email/actions";
import { MERGE_FIELDS, htmlToReadableText, looksLikeHtml, type MergeFieldValues } from "@/lib/merge-fields";
import { cn } from "@/lib/utils";

// Lazy-load the Tiptap rich-text body editor — same component the main
// MailComposer uses (showToolbar gives Bold/Italic/Underline/lists/link).
// Pulls in ProseMirror, so keep it out of the candidates-page bundle until
// the bulk dialog actually opens.
const RichTextBodyEditor = dynamic(
  () => import("@/components/rich-text-body-editor").then((m) => m.RichTextBodyEditor),
  { ssr: false },
);

// Client-safe plain-text → HTML for the rich body editor. Legacy templates
// store plain text; the rich editor needs HTML or ProseMirror collapses the
// line breaks. HTML templates pass straight through. (plainToHtml lives in
// gmail.ts, which is server-only, so this is the client mirror.)
function templateBodyToHtml(raw: string): string {
  if (!raw) return "";
  if (looksLikeHtml(raw)) return raw;
  const esc = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

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
      toast.success(`Bulk apply complete${desc ? `: ${desc}` : ""}`);
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
      <Input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter jobs…"
        disabled={busy}
        containerClassName="mb-2"
      />
      {/* Intentionally NOT migrated to the shared <Select>: this is a
          multi-row list box (size 3-8 visible rows), not a single-line
          dropdown. The court-input-rect frame + chevron are built for
          single-line controls, so the bespoke list box stays as-is. */}
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
        <Select
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          disabled={busy}
        >
          <option value="">Pick a list…</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.memberCount})
            </option>
          ))}
        </Select>
      ) : (
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          disabled={busy}
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

// Email-specific bulk dialog. Standalone modal layout (FROM / TO chip /
// SUBJECT / AI toolbar / body / footer) rather than wrapping the shared
// EmailComposer — the bulk flow needs its own chrome (recipient chip,
// AI controls above body, ghost-pill footer) that doesn't fit the
// composer's generic shape.
//
// Recipients are resolved server-side: bulkSendEmail looks up
// Candidate.email per id at send time, so the dialog only shows the
// selected count, not editable To/Cc/Bcc fields.
const BULK_EMAIL_CONFIRM_THRESHOLD = 25;

// Job + client tokens that, when present in a picked template OR in
// the eventual send draft, require a job context to be resolved
// before send. Subset of MERGE_FIELDS — only fields that
// getJobMergeValuesForBulk actually populates today.
const JOB_MERGE_TOKENS = [
  "[Job Title]",
  "[Job Location]",
  "[Client Company Name]",
  "{{client_blurb}}",
  "[Client Company Website]",
  "[Client Company LinkedIn]",
];

function textNeedsJob(text: string): boolean {
  return JOB_MERGE_TOKENS.some((t) => text.includes(t));
}

function templateNeedsJob(template: ActiveTemplateSummary): boolean {
  return textNeedsJob(template.subject) || textNeedsJob(template.body);
}

// Resolve ONLY the job-context tokens against the picked job's merge
// values. Unlike applyMergeFields (which builds a map over every
// MERGE_FIELDS entry and blanks anything the values map didn't fill),
// this leaves candidate-recipient tokens like [Candidate First Name]
// and {{candidate.first_name}} intact so bulkSendEmail can resolve
// them per recipient at send time. Without this scope, the composer
// would render "Hi ," because the candidate token gets blanked the
// moment a job is picked.
function applyJobTokensOnly(text: string, jobValues: MergeFieldValues): string {
  const map: Record<string, string | undefined> = {
    "[Job Title]": jobValues.jobTitle,
    "[Job Location]": jobValues.jobLocation,
    "[Client Company Name]": jobValues.clientCompanyName,
    "{{client_blurb}}": jobValues.candidateBlurb,
    "[Client Company Website]": jobValues.clientCompanyWebsite,
    "[Client Company LinkedIn]": jobValues.clientCompanyLinkedIn,
  };
  let out = text;
  for (const [token, value] of Object.entries(map)) {
    if (typeof value !== "string") continue;
    out = out.split(token).join(value);
  }
  return out;
}

// Post-send summary the dialog shows in place of the composer once a
// throttled batch is queued.
type QueuedSummary = {
  queued: number;
  skipped: number;
  errors: string[];
  firstAt: string | null;
  lastAt: string | null;
  overflowCount: number;
  spacingMinutes: number;
  sender: string;
};

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
  const { data: session } = useSession();
  const fromEmail = session?.user?.email ?? "";

  // Composer state lives locally — EmailComposer is no longer mounted.
  // `body` holds the HTML the rich-text editor emits (same as the main
  // MailComposer's rich-text mode).
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const subjectRef = useRef<HTMLInputElement | null>(null);
  // Imperative handle on the Tiptap editor — lets Insert Field splice a
  // merge token at the caret and lets Edit-with-Claude swap the body with
  // an undoable transaction.
  const richTextRef = useRef<RichTextBodyEditorHandle | null>(null);
  const [lastFocus, setLastFocus] = useState<"subject" | "body">("subject");
  const subjectCaret = useRef<number | null>(null);

  // Plain-text projection of the HTML body. Used for empty-checks (an empty
  // Tiptap editor still emits "<p></p>", which would falsely read as
  // non-empty) and for the plain-text MIME part on send. Merge tokens like
  // [Candidate First Name] are bracket text, not tags, so they survive.
  const bodyText = htmlToReadableText(body);

  const [isGenerating, startGenerate] = useTransition();
  const [isEditing, startEdit] = useTransition();
  const [isSending, startSend] = useTransition();
  // After a throttled send the dialog flips to this queue-summary view
  // (instead of closing) so the recruiter sees the pacing + a cancel
  // button. null = still composing.
  const [queuedSummary, setQueuedSummary] = useState<QueuedSummary | null>(null);
  const [canceling, startCancel] = useTransition();
  // Existing pending bulk queue, loaded on open so reopening the dialog
  // surfaces what's already in flight (with a cancel affordance).
  const [existingQueue, setExistingQueue] = useState<BulkQueueStatus | null>(null);
  // Inline panel for the Edit-with-Claude "Custom…" option. Same
  // pattern as the Generate prompt strip above the toolbar.
  const [customEditOpen, setCustomEditOpen] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");

  // Local "Use Template" picker. Bulk email runs the template picker
  // inline so the two-step "pick template → pick job" flow can park
  // between steps without fighting another component's lifecycle.
  const [localTemplates, setLocalTemplates] = useState<ActiveTemplateSummary[]>([]);
  const [localTemplatesLoaded, setLocalTemplatesLoaded] = useState(false);
  const [localTemplatesError, setLocalTemplatesError] = useState<string | null>(null);
  const [openTemplate, setOpenTemplate] = useState(false);
  const templateContainerRef = useRef<HTMLDivElement | null>(null);

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

  // Surface any bulk emails already pending in the queue when the dialog
  // opens, so the recruiter can see / cancel an in-flight batch.
  useEffect(() => {
    let cancelled = false;
    getBulkQueueStatus()
      .then((s) => {
        if (!cancelled) setExistingQueue(s);
      })
      .catch(() => {
        /* status is best-effort chrome; never block the composer. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Two-step Use Template → Pick Job flow. The popover swaps content
  // when pendingJobPick is set; no separate overlay.
  const [pendingJobPick, setPendingJobPick] = useState<{
    template: ActiveTemplateSummary;
  } | null>(null);
  const [jobMergeValues, setJobMergeValues] = useState<MergeFieldValues | null>(null);
  const [jobs, setJobs] = useState<BulkPickerJob[] | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
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

  // Dismiss the Use Template popover when the recruiter clicks anywhere
  // outside the button + popover container, or hits Escape. Scoped to
  // mount time of `openTemplate` so we don't pay listener cost when the
  // popover is closed. Also resets pendingJobPick so re-opening starts
  // back at the template list instead of the job picker.
  useEffect(() => {
    if (!openTemplate) return;
    function onDocPointer(e: PointerEvent) {
      const el = templateContainerRef.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      setOpenTemplate(false);
      setPendingJobPick(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpenTemplate(false);
      setPendingJobPick(null);
    }
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [openTemplate]);

  // Resolve job tokens up front when a jobValues map is provided so the
  // recruiter reads the real role name in the subject/body instead of raw
  // placeholders. Per-recipient candidate tokens stay as tokens and resolve
  // server-side at send time.
  function applyTemplateDraft(
    template: ActiveTemplateSummary,
    jobValues?: MergeFieldValues,
  ) {
    const subj = jobValues ? applyJobTokensOnly(template.subject, jobValues) : template.subject;
    const bod = jobValues ? applyJobTokensOnly(template.body, jobValues) : template.body;
    setSubject(subj);
    // Bulk composer body is now a rich-text editor; preserve the template's
    // HTML formatting (bold, lists) and lift legacy plain-text templates to
    // HTML so ProseMirror keeps the line breaks.
    setBody(templateBodyToHtml(bod));
  }

  function onPickLocalTemplate(template: ActiveTemplateSummary) {
    if (
      !template ||
      typeof template.id !== "string" ||
      typeof template.subject !== "string" ||
      typeof template.body !== "string"
    ) {
      toast.error("Template is missing required fields.");
      return;
    }
    if (!templateNeedsJob(template)) {
      setJobMergeValues(null);
      applyTemplateDraft(template);
      setOpenTemplate(false);
      return;
    }
    // Swap the popover into "pick a job" mode; keep openTemplate true.
    setPendingJobPick({ template });
  }

  async function onPickJob(job: BulkPickerJob) {
    if (!pendingJobPick) return;
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
      applyTemplateDraft(template, values);
      setPendingJobPick(null);
      setOpenTemplate(false);
    } catch (e) {
      toast.error("Couldn't resolve job fields", {
        description: e instanceof Error ? e.message : "Server error",
      });
    } finally {
      setResolvingJob(false);
    }
  }

  function onCancelJobPick() {
    // Back to template list; keep the popover open so the recruiter can
    // pick a different template without re-clicking Use Template.
    setPendingJobPick(null);
  }

  // Insert Field popover — anchored to its trigger button, dismissed on
  // outside pointerdown or Escape (same pattern as the template popover).
  const [fieldOpen, setFieldOpen] = useState(false);
  const fieldContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!fieldOpen) return;
    function onDocPointer(e: PointerEvent) {
      const el = fieldContainerRef.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      setFieldOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFieldOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [fieldOpen]);

  function rememberCaret(el: HTMLInputElement | HTMLTextAreaElement) {
    const pos = el.selectionStart ?? 0;
    if (el === subjectRef.current) subjectCaret.current = pos;
  }

  function insertMergeToken(token: string) {
    if (lastFocus === "subject") {
      const el = subjectRef.current;
      const start = subjectCaret.current ?? el?.selectionStart ?? subject.length;
      const next = subject.slice(0, start) + token + subject.slice(start);
      setSubject(next);
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
        subjectCaret.current = pos;
      });
    } else {
      // Rich-text body: splice the token in at the ProseMirror selection so
      // surrounding formatting stays intact (same path the main composer uses).
      richTextRef.current?.insertPlainText(token);
    }
    setFieldOpen(false);
  }

  // Confirmation gate for batches > 25.
  const [confirmDraft, setConfirmDraft] = useState<EmailDraft | null>(null);
  const [confirming, setConfirming] = useState(false);

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
      toast.error("Bulk email queue failed", { description: head });
      throw new Error(head);
    }
    const q = res.queue;
    const pace =
      q && q.spacingMinutes > 0
        ? `Sending 1 every ~${q.spacingMinutes} min`
        : "Sending as fast as the queue allows";
    toast.success(
      `Queued ${res.sent} email${res.sent === 1 ? "" : "s"}`,
      { description: pace },
    );
    // Flip the dialog into the queue-status view instead of closing, so the
    // recruiter sees the pacing + a Cancel remaining button. The selection
    // is cleared (onDone) only when they close that view.
    setConfirmDraft(null);
    setQueuedSummary({
      queued: res.sent,
      skipped: res.skipped,
      errors: res.errors,
      firstAt: q?.firstAt ?? null,
      lastAt: q?.lastAt ?? null,
      overflowCount: q?.overflowCount ?? 0,
      spacingMinutes: q?.spacingMinutes ?? 0,
      sender: q?.sender ?? fromEmail,
    });
  }

  function onCancelRemaining() {
    startCancel(async () => {
      const res = await cancelBulkQueue();
      if (!res.ok) {
        toast.error("Couldn't cancel queue", { description: res.error });
        return;
      }
      toast.success(
        res.canceled > 0
          ? `Canceled ${res.canceled} pending email${res.canceled === 1 ? "" : "s"}`
          : "No pending emails to cancel",
      );
      // From the post-send view, close out (selection clears). From the
      // compose-time banner, just clear the banner and keep the draft.
      if (queuedSummary) onDone();
      else setExistingQueue(null);
    });
  }

  function onSendClick() {
    setErr(null);
    if (!subject.trim() || !bodyText.trim()) {
      setErr("Subject and body are required.");
      return;
    }
    // Block sending when the draft still carries unresolved job tokens
    // (recruiter cancelled the picker after applying a job-using
    // template, or typed tokens manually without picking a job).
    const haystack = `${subject}\n${bodyText}`;
    if (textNeedsJob(haystack) && !jobMergeValues) {
      const msg = "Pick a job for the job context fields, or remove them from the body.";
      setErr(msg);
      toast.error(msg);
      return;
    }
    // body is the editor HTML (rich part); bodyText is the plain-text MIME
    // fallback. Both get per-recipient merge resolution server-side.
    const draft: EmailDraft = { to: [], cc: [], bcc: [], subject, body: bodyText, bodyHtml: body };
    if (n > BULK_EMAIL_CONFIRM_THRESHOLD) {
      setConfirmDraft(draft);
      return;
    }
    startSend(async () => {
      try {
        await actualSend(draft);
      } catch {
        // toast already fired in actualSend
      }
    });
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

  // Send Later: same validation as onSendClick, then persist one
  // ScheduledEmail per candidate. Throws so the picker stays open on error.
  async function scheduleLater(scheduledSendAtISO: string, timezone: string) {
    setErr(null);
    if (!subject.trim() || !bodyText.trim()) {
      setErr("Subject and body are required.");
      throw new Error("Subject and body are required.");
    }
    const haystack = `${subject}\n${bodyText}`;
    if (textNeedsJob(haystack) && !jobMergeValues) {
      const msg = "Pick a job for the job context fields, or remove them from the body.";
      setErr(msg);
      throw new Error(msg);
    }
    const res = await scheduleBulkEmail({
      candidateIds,
      subject,
      body: bodyText,
      bodyHtml: body,
      jobMergeValues: jobMergeValues ?? undefined,
      scheduledSendAt: scheduledSendAtISO,
      timezone,
    });
    if (res.sent === 0) {
      const head = res.errors[0] ?? "No candidates had an email on file.";
      toast.error("Could not schedule bulk email", { description: head });
      throw new Error(head);
    }
    const tail = [
      res.skipped > 0 ? `${res.skipped} skipped` : null,
      res.errors.length > 0 ? `${res.errors.length} errors` : null,
    ]
      .filter(Boolean)
      .join(" - ");
    toast.success(
      `Scheduled for ${res.sent} candidate${res.sent === 1 ? "" : "s"} at ${formatScheduledTime(scheduledSendAtISO, timezone)}${tail ? ` - ${tail}` : ""}`,
      res.errors.length > 0
        ? { description: res.errors.slice(0, 3).join("\n") }
        : undefined,
    );
    onDone();
  }

  // Build the generation prompt from the bulk context — the selected
  // candidate count plus any resolved job/client fields — so the recruiter
  // gets a usable draft from a single click, no prompt textarea required.
  function buildBulkGeneratePrompt(): string {
    const parts: string[] = [];
    parts.push(
      `Write a concise, warm recruiting outreach email that will be sent individually to ${n} selected candidate${n === 1 ? "" : "s"} as a bulk send.`,
    );
    const jv = jobMergeValues;
    if (jv && (jv.jobTitle || jv.clientCompanyName || jv.jobLocation)) {
      if (jv.jobTitle) parts.push(`The email is about an open role: ${jv.jobTitle}.`);
      if (jv.clientCompanyName) parts.push(`Hiring company: ${jv.clientCompanyName}.`);
      if (jv.jobLocation) parts.push(`Location: ${jv.jobLocation}.`);
    } else {
      parts.push(`This is a general candidate outreach email.`);
    }
    parts.push(
      `Open with "Hi [Candidate First Name]," exactly, using that literal placeholder so each recipient's first name fills in automatically at send time. Do not invent or guess a real name.`,
    );
    parts.push(
      `Keep it to 3 to 5 short sentences, professional and friendly, ending with a clear call to action to reply or learn more. Do not write a subject line. Do not use em dashes; use hyphens or commas instead.`,
    );
    return parts.join(" ");
  }

  function onGenerateClick() {
    setErr(null);
    startGenerate(async () => {
      try {
        const res = await fetch("/api/mail/ai-compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: buildBulkGeneratePrompt(), includeSubject: false }),
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
        setBody(text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to generate.";
        setErr(msg);
        toast.error("Couldn't generate draft", { description: msg });
      }
    });
  }

  function onEditClick(editType: EditType) {
    if (editType === "custom") {
      if (!bodyText.trim()) return;
      setErr(null);
      setCustomEditOpen(true);
      return;
    }
    runEdit({ editType });
  }

  function runCustomEdit() {
    const instruction = customInstruction.trim();
    if (!instruction || !bodyText.trim()) return;
    runEdit({ editType: "custom", customInstruction: instruction });
  }

  function runEdit(opts: { editType: EditType; customInstruction?: string }) {
    if (!bodyText.trim()) return;
    setErr(null);
    startEdit(async () => {
      try {
        const res = await fetch("/api/email/edit-with-claude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            editType: opts.editType,
            format: "html",
            ...(opts.customInstruction
              ? { customInstruction: opts.customInstruction }
              : {}),
          }),
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as
          | { body?: string; error?: string }
          | null;
        if (!res.ok) {
          const msg = json?.error ?? `Edit failed (${res.status})`;
          throw new Error(msg);
        }
        const next = (json?.body ?? "").trim();
        if (!next) throw new Error("Claude returned an empty edit.");
        // Route through the Tiptap chain so the swap lands in ProseMirror's
        // history and Cmd+Z restores the recruiter's original draft.
        if (richTextRef.current) {
          richTextRef.current.replaceWithUndo(next);
        } else {
          setBody(next);
        }
        if (opts.editType === "custom") {
          setCustomEditOpen(false);
          setCustomInstruction("");
        }
        toast.success("Draft revised", { description: "Cmd+Z to restore your original." });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to edit draft.";
        setErr(msg);
        toast.error("Couldn't edit draft", { description: msg });
      }
    });
  }

  const ghostPill =
    "inline-flex h-8 items-center gap-1.5 rounded-md border border-court-border bg-transparent px-3 text-[12px] font-semibold text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-60";

  // Send Later picker, anchored to the footer's Send Later button.
  const sendLater = useSendLater(scheduleLater);

  // Post-send queue view. Replaces the composer once a throttled batch is
  // queued: shows pacing, ETA, today/tomorrow split, and a cancel button.
  if (queuedSummary) {
    const q = queuedSummary;
    const ET = "America/New_York";
    const starts = q.firstAt ? formatScheduledTime(q.firstAt, ET) : null;
    const finishes = q.lastAt ? formatScheduledTime(q.lastAt, ET) : null;
    const todayCount = Math.max(0, q.queued - q.overflowCount);
    const pace =
      q.spacingMinutes > 0
        ? `one every ~${q.spacingMinutes} min (randomized ±20%)`
        : "as fast as the queue allows";
    return (
      <div
        role="dialog"
        aria-label="Bulk email queued"
        className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      >
        {/* No backdrop-dismiss here either — closes only via Done / Cancel. */}
        <div
          className="relative flex w-full max-w-md flex-col gap-4 rounded-xl border border-court-border bg-court-surface p-6 shadow-2xl"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-court-brand-tint text-court-brand-dark">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="font-serif text-base font-semibold text-court-fg">
                Queued {q.queued} email{q.queued === 1 ? "" : "s"}
              </h2>
              <p className="mt-0.5 text-xs text-court-fg-muted">
                Sending from {q.sender}, {pace}. This keeps going even if you
                close this tab.
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-court-border bg-court-surface-subtle/40 p-3 text-xs">
            <QueueStat label="Pending today" value={String(todayCount)} />
            <QueueStat
              label="Tomorrow 8am ET"
              value={q.overflowCount > 0 ? String(q.overflowCount) : "0"}
            />
            <QueueStat label="First send" value={starts ?? "soon"} />
            <QueueStat label="Finishes by" value={finishes ?? "soon"} />
          </dl>

          {q.overflowCount > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              {q.overflowCount} email{q.overflowCount === 1 ? "" : "s"} went past
              today&apos;s daily cap and {q.overflowCount === 1 ? "is" : "are"}{" "}
              scheduled for tomorrow starting 8am ET.
            </p>
          )}
          {q.skipped > 0 && (
            <p className="text-[12px] text-court-fg-muted">
              {q.skipped} skipped (no email on file).
            </p>
          )}
          {q.errors.length > 0 && (
            <p className="text-[12px] text-red-700">
              {q.errors.length} could not be queued: {q.errors.slice(0, 2).join("; ")}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="reject"
              size="sm"
              onClick={onCancelRemaining}
              disabled={canceling}
            >
              {canceling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Cancel remaining
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onDone}
              disabled={canceling}
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={`Email ${n} candidates`}
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
    >
      {/* Intentionally NO backdrop onClick-to-close: a recruiter mid-draft can
          highlight text and drag the cursor onto the backdrop, or click/scroll
          outside the editor, without the in-progress email vanishing. The
          email only closes via the X, Cancel, or a successful send. */}
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-court-border px-5 py-3">
          <h2 className="font-serif text-base font-semibold text-court-fg">
            Email {n} candidate{n === 1 ? "" : "s"}
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

        {/* Existing-queue banner: shows when a previous batch is still
            draining so this new send appends to it rather than racing. */}
        {existingQueue && existingQueue.pending > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-court-border bg-court-surface-subtle/40 px-5 py-2 text-[12px]">
            <span className="flex items-center gap-1.5 text-court-fg-muted">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {existingQueue.pending} email{existingQueue.pending === 1 ? "" : "s"} already
              queued from {existingQueue.sender}. A new send appends after them.
            </span>
            <Button
              type="button"
              variant="reject"
              size="sm"
              onClick={onCancelRemaining}
              disabled={canceling}
              className="shrink-0"
            >
              {canceling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Cancel queued
            </Button>
          </div>
        )}

        {/* FROM / TO / SUBJECT rows */}
        <div className="space-y-2 border-b border-court-border px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
              FROM
            </span>
            <span className="min-w-0 truncate text-[13px] text-court-fg">
              {fromEmail || "—"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
              TO
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-court-accent-tint px-3 py-1 text-[11px] font-semibold text-court-brand-dark">
              <Users className="h-3 w-3" /> To: {n} selected candidate{n === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
              SUBJECT
            </span>
            <Input
              ref={subjectRef}
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onFocus={(e) => {
                setLastFocus("subject");
                rememberCaret(e.currentTarget);
              }}
              onSelect={(e) => rememberCaret(e.currentTarget)}
              onKeyUp={(e) => rememberCaret(e.currentTarget)}
              onClick={(e) => rememberCaret(e.currentTarget)}
              containerClassName="min-w-0 flex-1"
            />
          </div>
        </div>

        {/* AI toolbar above body — Generate + Edit are surface-level buttons,
            same treatment as the main MailComposer. No separate prompt
            textarea: Generate drafts straight from the job + candidate context. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-court-border px-5 py-2">
          <Button
            type="button"
            variant="ai-primary"
            size="sm"
            onClick={onGenerateClick}
            disabled={isGenerating || isSending || isEditing}
          >
            {isGenerating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Generate with Claude
          </Button>
          <EditWithClaudeMenu
            isEditing={isEditing}
            disabled={!bodyText.trim() || isGenerating || isSending}
            onPick={onEditClick}
          />
        </div>

        {customEditOpen && (
          <EditWithClaudeCustomPanel
            value={customInstruction}
            onChange={setCustomInstruction}
            onRun={runCustomEdit}
            onCancel={() => {
              setCustomEditOpen(false);
              setCustomInstruction("");
            }}
            isRunning={isEditing}
          />
        )}

        {/* Body — rich-text editor with the same formatting toolbar as the
            main MailComposer (Bold / Italic / Underline / bulleted list /
            numbered list / insert link). Emits HTML on every change. */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-5 py-3"
          onFocus={() => setLastFocus("body")}
          onClick={() => setLastFocus("body")}
        >
          <RichTextBodyEditor
            ref={richTextRef}
            initialHtml={body}
            value={body}
            onChange={(html) => setBody(html)}
            placeholder="Write your message, or click Generate with Claude above."
            showToolbar
          />
        </div>

        {err && (
          <div className="mx-5 mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {err}
          </div>
        )}

        {jobMergeValues && (
          <div className="border-t border-court-border bg-court-surface-subtle/40 px-5 py-1.5 text-[11px] text-court-fg-muted">
            Job context resolved. Recipients will receive filled job fields at send time.
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-court-border px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Use Template */}
            <div className="relative" ref={templateContainerRef}>
              <button
                type="button"
                onClick={() => {
                  const next = !openTemplate;
                  setOpenTemplate(next);
                  if (!next && pendingJobPick) onCancelJobPick();
                }}
                disabled={
                  !localTemplatesLoaded ||
                  Boolean(localTemplatesError) ||
                  localTemplates.length === 0
                }
                title="Apply a saved template to this bulk email"
                className={cn(ghostPill, "text-court-fg")}
              >
                <FileText className="h-3.5 w-3.5" /> Use Template <ChevronDown className="h-3 w-3" />
              </button>
              {openTemplate && (
                <div
                  role="menu"
                  className="absolute bottom-full left-0 z-[70] mb-1 max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-court-border bg-court-surface shadow-lg"
                >
                  {pendingJobPick ? (
                    <div>
                      <div className="flex items-center justify-between border-b border-court-border px-3 py-1.5">
                        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                          {pendingJobPick.template.name} · pick a job
                        </span>
                        <button
                          type="button"
                          onClick={onCancelJobPick}
                          disabled={resolvingJob}
                          className="text-[10px] font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
                        >
                          Back
                        </button>
                      </div>
                      {jobsLoading || jobs === null ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-court-fg-muted">
                          <Loader2 className="h-3 w-3 animate-spin" /> Loading jobs…
                        </div>
                      ) : jobs.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-court-fg-muted">
                          No open jobs found.
                        </div>
                      ) : (
                        jobs.map((j) => (
                          <button
                            key={j.key}
                            type="button"
                            disabled={resolvingJob}
                            onClick={() => void onPickJob(j)}
                            className="block w-full truncate px-3 py-1.5 text-left text-xs text-court-fg transition hover:bg-court-accent-tint/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {j.label}
                          </button>
                        ))
                      )}
                      {resolvingJob && (
                        <div className="flex items-center gap-2 border-t border-court-border px-3 py-1.5 text-[10px] text-court-fg-muted">
                          <Loader2 className="h-3 w-3 animate-spin" /> Resolving job fields…
                        </div>
                      )}
                    </div>
                  ) : !localTemplatesLoaded ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-court-fg-muted">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading templates…
                    </div>
                  ) : localTemplatesError ? (
                    <div className="px-3 py-2 text-xs text-court-fg-muted">{localTemplatesError}.</div>
                  ) : localTemplates.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-court-fg-muted">
                      No templates yet. Create one in Settings &gt; Templates.
                    </div>
                  ) : (
                    localTemplates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onPickLocalTemplate(t)}
                        className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-court-fg transition hover:bg-court-accent-tint/40"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium">{t.name}</span>
                          {t.category && (
                            <span className="shrink-0 text-[10px] uppercase tracking-wider text-court-fg-muted">
                              {t.category}
                            </span>
                          )}
                        </span>
                        <span className="truncate text-[10px] text-court-fg-muted">{t.subject}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Insert Field */}
            <div className="relative" ref={fieldContainerRef}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setFieldOpen((v) => !v)}
                disabled={isSending || isGenerating}
                title={`Insert a merge field into the ${lastFocus}`}
                className={cn(ghostPill, "text-court-fg")}
              >
                <Variable className="h-3.5 w-3.5" /> Insert Field
              </button>
              {fieldOpen && (
                <div className="absolute bottom-full left-0 z-[70] mb-1 w-80 overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg">
                  <div className="border-b border-court-border bg-court-surface-subtle/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                    Inserts into {lastFocus}
                  </div>
                  <ul className="max-h-80 overflow-y-auto py-1 text-sm">
                    {groupedMergeFields().map(({ group, items }) => (
                      <li key={group}>
                        <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                          {group}
                        </div>
                        {items.map((f) => (
                          <button
                            key={f.token}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => insertMergeToken(f.token)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-court-fg hover:bg-court-brand-tint"
                          >
                            <span>{f.label}</span>
                            <code className="rounded bg-court-surface-subtle px-1 py-0.5 text-[10px] text-court-fg-muted">
                              {f.token}
                            </code>
                          </button>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Right side: Cancel + Send Later + Send */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isSending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              ref={sendLater.triggerRef}
              onClick={() => sendLater.setOpen(true)}
              disabled={isSending || confirmDraft !== null}
            >
              <Clock className="h-3 w-3" /> Send Later
            </Button>
            {sendLater.popover}
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSendClick}
              disabled={isSending || confirmDraft !== null}
            >
              {isSending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Sending…
                </>
              ) : (
                <>
                  <Send className="h-3 w-3" /> Send to {n} candidate{n === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </div>
        </div>

        {confirmDraft && (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-court-bg/85 p-6 backdrop-blur-sm">
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

function QueueStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-xs font-medium text-court-fg">{value}</dd>
    </div>
  );
}

function groupedMergeFields(): { group: string; items: typeof MERGE_FIELDS[number][] }[] {
  const ordered: { group: string; items: typeof MERGE_FIELDS[number][] }[] = [];
  const seen = new Map<string, { group: string; items: typeof MERGE_FIELDS[number][] }>();
  for (const f of MERGE_FIELDS) {
    let entry = seen.get(f.group);
    if (!entry) {
      entry = { group: f.group, items: [] };
      seen.set(f.group, entry);
      ordered.push(entry);
    }
    entry.items.push(f);
  }
  return ordered;
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
