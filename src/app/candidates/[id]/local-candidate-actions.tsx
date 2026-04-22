"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  FileSignature,
  Loader2,
  Sparkles,
  Target,
  UserCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  applyLocalCandidateToJob,
  generateLocalSubmittal,
  sendLocalReferenceRequest,
  sendLocalSubmittalEmail,
} from "@/app/candidates/[id]/local-placement-actions";

export type LocalOpenJob = {
  jobRfId: number;
  jobTitle: string;
  clientRfId: number;
  clientName: string;
  alreadyLinked: boolean;
  linkedStage?: string | null;
};

export function LocalCandidateActions(props: {
  candidateId: string;
  candidateName: string;
  candidateFirstName: string;
  candidateEmail: string | null;
  openJobs: LocalOpenJob[];
}) {
  const [modal, setModal] = useState<"apply" | "submit" | "reference" | null>(null);

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
        <button
          type="button"
          onClick={() => setModal("reference")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-semibold text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
        >
          <UserCheck className="h-3 w-3" /> Request References
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
          onClose={() => setModal(null)}
        />
      )}
      {modal === "reference" && (
        <ReferenceModal
          candidateId={props.candidateId}
          candidateName={props.candidateName}
          candidateFirstName={props.candidateFirstName}
          candidateEmail={props.candidateEmail}
          onClose={() => setModal(null)}
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
      const res = await applyLocalCandidateToJob({
        candidateId: props.candidateId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
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
        Creates a local Applied placement row — no RecruiterFlow push.
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
  onClose: () => void;
}) {
  const router = useRouter();
  const [jobRfId, setJobRfId] = useState<number | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isGenerating, startGenerate] = useTransition();
  const [isSending, startSend] = useTransition();

  const selectedJob = useMemo(
    () => (jobRfId ? props.openJobs.find((j) => j.jobRfId === jobRfId) : null),
    [jobRfId, props.openJobs],
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
      const res = await generateLocalSubmittal({ candidateId: props.candidateId, jobRfId });
      if (!res.ok) {
        toast.error("Draft failed", { id: toastId, description: res.error });
        return;
      }
      setBody(res.value.writeup);
      toast.success("Draft ready — review and edit before sending.", { id: toastId });
    });
  }

  function onSend() {
    if (!jobRfId || !selectedJob) return;
    const toList = to.split(",").map((s) => s.trim()).filter(Boolean);
    const ccList = cc.split(",").map((s) => s.trim()).filter(Boolean);
    if (toList.length === 0) {
      toast.error("At least one recipient is required.");
      return;
    }
    const toastId = toast.loading("Sending submittal…");
    startSend(async () => {
      const res = await sendLocalSubmittalEmail({
        candidateId: props.candidateId,
        jobRfId: selectedJob.jobRfId,
        clientRfId: selectedJob.clientRfId,
        to: toList,
        cc: ccList,
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

      <Field label="To" value={to} onChange={setTo} placeholder="client.contact@example.com" />
      <Field label="CC" value={cc} onChange={setCc} placeholder="optional, comma-separated" />
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

// ---- Reference modal ----

function ReferenceModal(props: {
  candidateId: string;
  candidateName: string;
  candidateFirstName: string;
  candidateEmail: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [to, setTo] = useState(props.candidateEmail ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Reference request for ${props.candidateName}`);
  const [body, setBody] = useState(
    `Hi ${props.candidateFirstName || "there"},\n\n` +
      `As we move forward, could you please send over 2–3 professional references — ideally a mix of recent managers and peers? ` +
      `A name, email, phone, and your working relationship for each is perfect.\n\n` +
      `Thanks!`,
  );
  const [isSending, startSend] = useTransition();

  function onSend() {
    const toList = to.split(",").map((s) => s.trim()).filter(Boolean);
    const ccList = cc.split(",").map((s) => s.trim()).filter(Boolean);
    if (toList.length === 0) {
      toast.error("At least one recipient is required.");
      return;
    }
    const toastId = toast.loading("Sending reference request…");
    startSend(async () => {
      const res = await sendLocalReferenceRequest({
        candidateId: props.candidateId,
        to: toList,
        cc: ccList,
        subject: subject.trim(),
        bodyText: body.trim(),
      });
      if (!res.ok) {
        toast.error("Send failed", { id: toastId, description: res.error });
        return;
      }
      toast.success("Reference request sent", { id: toastId });
      router.refresh();
      props.onClose();
    });
  }

  return (
    <ModalShell title="Request References" onClose={props.onClose}>
      <Field label="To" value={to} onChange={setTo} placeholder="candidate@example.com" />
      <Field label="CC" value={cc} onChange={setCc} placeholder="optional, comma-separated" />
      <Field label="Subject" value={subject} onChange={setSubject} />
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Body</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          className="mt-1 w-full resize-vertical rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm leading-relaxed text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
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
          disabled={isSending || !to.trim() || !body.trim() || !subject.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50"
        >
          {isSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
          Send Reference Request
        </button>
      </div>
    </ModalShell>
  );
}

// ---- Shared UI ----

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4">
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
        <p className="mt-1 text-[11px] text-court-fg-muted">No open jobs in RecruiterFlow.</p>
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
