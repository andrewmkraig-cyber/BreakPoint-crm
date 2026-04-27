"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FileSignature,
  Loader2,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  applyLocalCandidateToJob,
  generateLocalSubmittal,
  sendLocalSubmittalEmail,
} from "@/app/candidates/[id]/local-placement-actions";
import { InlineContactMultiInput, buildCcBccOptions } from "@/app/candidates/[id]/placement-flows";

// Contact shape the Submit modal's To/Cc pickers draw from. Same tuple
// layout placement-flows / local-placement-rows already use for the
// existing Submit and Interview composers — keeps the Ace-native path
// consistent with the RF-imported path.
export type LocalClientContact = {
  id: number;
  name: string;
  title: string;
  email: string;
};

export type LocalOpenJob = {
  // For Ace-native Jobs the shim synthesizes a negative numeric id
  // (djb2-of-cuid, negated) so this field keeps a stable numeric type
  // for React keys and picker state. The real identity lives on jobCuid
  // when set — write paths use it and leave Placement.jobRfId null.
  jobRfId: number;
  jobCuid?: string | null;
  jobTitle: string;
  clientRfId: number;
  clientCuid?: string | null;
  clientName: string;
  alreadyLinked: boolean;
  linkedStage?: string | null;
  // Client contacts for this job's client. Populated in local-profile.tsx
  // by filtering allContacts on clientRfId so the picker matches what the
  // RF-imported Submit modal shows for the same client. Optional with an
  // empty-array default so older callers that haven't been updated yet
  // still compile.
  clientContacts?: LocalClientContact[];
};

export function LocalCandidateActions(props: {
  candidateId: string;
  candidateName: string;
  candidateFirstName: string;
  candidateEmail: string | null;
  openJobs: LocalOpenJob[];
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [modal, setModal] = useState<"apply" | "submit" | null>(null);
  // Pre-seed value for SubmitModal when the user arrives via a deep
  // link. Two URL shapes are accepted so every Submit entry point lands
  // on the same modal:
  //   ?submit=<jobRfId>                          — LocalPlacementRows per-row Submit
  //   ?compose=submittal&jobId=<jobRfId>         — /applicants row Submit button
  // Both strip the params on read so back-nav / refresh doesn't re-open
  // the modal unexpectedly.
  const [submitInitialJobRfId, setSubmitInitialJobRfId] = useState<number | null>(null);

  useEffect(() => {
    const submitParam = searchParams?.get("submit");
    const composeParam = searchParams?.get("compose");
    const jobIdParam = searchParams?.get("jobId");
    let jobId: number | null = null;
    const paramsToStrip: string[] = [];
    if (submitParam) {
      const n = Number(submitParam);
      if (Number.isFinite(n)) jobId = n;
      paramsToStrip.push("submit");
    } else if (composeParam === "submittal" && jobIdParam) {
      const n = Number(jobIdParam);
      if (Number.isFinite(n)) jobId = n;
      paramsToStrip.push("compose", "jobId");
    }
    if (jobId == null) return;
    setSubmitInitialJobRfId(jobId);
    setModal("submit");
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    for (const key of paramsToStrip) next.delete(key);
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchParams, pathname, router]);

  return (
    <div className="rounded-xl border border-court-border bg-court-surface px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setModal("submit")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
        >
          <FileSignature className="h-3 w-3" /> Submit to Job
        </button>
        <button
          type="button"
          onClick={() => setModal("apply")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-semibold text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
        >
          <Target className="h-3 w-3" /> Apply to Job
        </button>
      </div>

      {modal === "apply" && (
        <ApplyModal
          candidateId={props.candidateId}
          candidateName={props.candidateName}
          openJobs={props.openJobs}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "submit" && (
        <SubmitModal
          candidateId={props.candidateId}
          candidateName={props.candidateName}
          openJobs={props.openJobs}
          initialJobRfId={submitInitialJobRfId}
          onClose={() => {
            setModal(null);
            setSubmitInitialJobRfId(null);
          }}
        />
      )}
    </div>
  );
}

// ---- Apply modal ----

function ApplyModal(props: {
  candidateId: string;
  candidateName: string;
  openJobs: LocalOpenJob[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [jobRfId, setJobRfId] = useState<number | null>(null);
  const [isSubmitting, startSubmit] = useTransition();
  const selectable = props.openJobs.filter((j) => !j.alreadyLinked);

  function onSubmit() {
    if (!jobRfId) {
      toast.error("Pick a job first.");
      return;
    }
    const job = props.openJobs.find((j) => j.jobRfId === jobRfId);
    if (!job) return;
    const toastId = toast.loading("Applying…");
    startSubmit(async () => {
      // Ace-native Jobs carry a synthetic negative jobRfId on LocalOpenJob
      // — the real identity is jobCuid / clientCuid. Route the write by
      // presence of the cuid fields so Placement.jobId is set and
      // Placement.jobRfId stays null.
      const res = await applyLocalCandidateToJob({
        candidateId: props.candidateId,
        jobRfId: job.jobCuid ? null : job.jobRfId,
        jobId: job.jobCuid ?? null,
        clientRfId: job.clientCuid ? null : job.clientRfId,
        clientId: job.clientCuid ?? null,
      });
      if (!res.ok) {
        toast.error("Couldn't apply", { id: toastId, description: res.error });
        return;
      }
      toast.success(`Applied ${props.candidateName} to ${job.jobTitle}`, { id: toastId });
      router.refresh();
      props.onClose();
    });
  }

  return (
    <ModalShell title="Apply to Job" onClose={props.onClose}>
      <p className="text-xs text-court-fg-muted">
        Creates an Applied placement row in Ace.
      </p>
      <JobPicker openJobs={props.openJobs} value={jobRfId} onChange={setJobRfId} />
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={props.onClose}
          className="rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted hover:text-court-fg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitting || !jobRfId || selectable.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50"
        >
          {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />}
          Apply
        </button>
      </div>
    </ModalShell>
  );
}

// ---- Submit modal ----

function SubmitModal(props: {
  candidateId: string;
  candidateName: string;
  openJobs: LocalOpenJob[];
  // Pre-selection from per-row Submit button deep-link. When set, the
  // modal mounts with this job already selected so the recruiter skips
  // the job-picker step.
  initialJobRfId?: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [jobRfId, setJobRfId] = useState<number | null>(props.initialJobRfId ?? null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isGenerating, startGenerate] = useTransition();
  const [isSending, startSend] = useTransition();

  const selectedJob = useMemo(
    () => (jobRfId ? props.openJobs.find((j) => j.jobRfId === jobRfId) : null),
    [jobRfId, props.openJobs],
  );

  // Picker options rebuild when the selected job changes so the To/Cc
  // dropdowns show that job's client contacts. Empty list when no job
  // is selected yet (picker falls through to free-text entry).
  const pickerOptions = useMemo(
    () => buildCcBccOptions(selectedJob?.clientContacts ?? []),
    [selectedJob],
  );

  useEffect(() => {
    if (selectedJob && !subject) {
      setSubject(`${props.candidateName} — ${selectedJob.jobTitle}`);
    }
  }, [selectedJob, props.candidateName, subject]);

  function onGenerate() {
    if (!jobRfId) {
      toast.error("Pick a job first.");
      return;
    }
    const toastId = toast.loading("Drafting with Claude…");
    startGenerate(async () => {
      const job = props.openJobs.find((j) => j.jobRfId === jobRfId);
      const res = await generateLocalSubmittal({
        candidateId: props.candidateId,
        jobRfId: job?.jobCuid ? null : jobRfId,
        jobId: job?.jobCuid ?? null,
      });
      if (!res.ok) {
        toast.error("Draft failed", { id: toastId, description: res.error });
        return;
      }
      setBody(res.value.writeup);
      toast.success("Draft ready — review and edit before sending.", { id: toastId });
    });
  }

  function parseList(raw: string): string[] {
    return raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  }

  function onSend() {
    if (!jobRfId || !selectedJob) return;
    const toList = parseList(to);
    const ccList = parseList(cc);
    const bccList = parseList(bcc);
    if (toList.length === 0) {
      toast.error("At least one recipient is required.");
      return;
    }
    const toastId = toast.loading("Sending submittal…");
    startSend(async () => {
      const res = await sendLocalSubmittalEmail({
        candidateId: props.candidateId,
        jobRfId: selectedJob.jobCuid ? null : selectedJob.jobRfId,
        jobId: selectedJob.jobCuid ?? null,
        clientRfId: selectedJob.clientCuid ? null : selectedJob.clientRfId,
        clientId: selectedJob.clientCuid ?? null,
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject: subject.trim(),
        bodyText: body.trim(),
      });
      if (!res.ok) {
        toast.error("Send failed", { id: toastId, description: res.error });
        return;
      }
      toast.success(`Submitted ${props.candidateName} to ${selectedJob.jobTitle}`, { id: toastId });
      router.refresh();
      props.onClose();
    });
  }

  return (
    <ModalShell title="Submit to Job" onClose={props.onClose}>
      <JobPicker openJobs={props.openJobs} value={jobRfId} onChange={setJobRfId} />
      <button
        type="button"
        onClick={onGenerate}
        disabled={!jobRfId || isGenerating}
        className="inline-flex items-center gap-1.5 rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-semibold text-court-fg shadow-sm transition hover:bg-court-surface-subtle disabled:opacity-50"
      >
        {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Generate with Claude
      </button>

      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          To · client contacts
        </span>
        <InlineContactMultiInput
          value={to}
          onChange={setTo}
          options={pickerOptions}
          placeholder={
            selectedJob
              ? "Pick a client contact or type email…"
              : "Pick a job first to see client contacts"
          }
        />
      </label>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          Cc (optional) · client contacts
        </span>
        <InlineContactMultiInput
          value={cc}
          onChange={setCc}
          options={pickerOptions}
          placeholder="Pick a client contact or type email…"
        />
      </label>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          Bcc (optional)
        </span>
        <InlineContactMultiInput
          value={bcc}
          onChange={setBcc}
          options={pickerOptions}
          placeholder="Pick a contact or type email…"
        />
      </label>
      <Field label="Subject" value={subject} onChange={setSubject} />
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Body</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          className="mt-1 w-full resize-vertical rounded-lg border border-court-border bg-court-surface px-3 py-2 font-mono text-xs leading-relaxed text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={props.onClose}
          className="rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted hover:text-court-fg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={isSending || !jobRfId || !body.trim() || !subject.trim() || !to.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50"
        >
          {isSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSignature className="h-3 w-3" />}
          Send Submittal
        </button>
      </div>
    </ModalShell>
  );
}

// ---- Shared UI ----

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-2xl space-y-3 rounded-xl border border-court-border bg-court-surface p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg font-semibold text-court-fg">{title}</h3>
          <button type="button" onClick={onClose} className="text-court-fg-muted hover:text-court-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function JobPicker({
  openJobs,
  value,
  onChange,
}: {
  openJobs: LocalOpenJob[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Open jobs</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      >
        <option value="">— pick a job —</option>
        {openJobs.map((j) => (
          <option key={j.jobRfId} value={j.jobRfId} disabled={j.alreadyLinked}>
            {j.clientName ? `${j.clientName} — ` : ""}{j.jobTitle}
            {j.alreadyLinked ? ` (already ${j.linkedStage ?? "linked"})` : ""}
          </option>
        ))}
      </select>
      {openJobs.length === 0 && (
        <p className="mt-1 text-[11px] text-court-fg-muted">No open jobs found.</p>
      )}
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60",
          "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
        )}
      />
    </label>
  );
}
