"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  CalendarClock,
  CalendarPlus,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  rescheduleInterview,
  scheduleInterview,
  sendInterviewInvite,
  type InterviewType,
} from "@/app/candidates/[id]/interview-actions";
import { EmailComposer, type EmailDraft } from "@/components/email-composer";
import { DateTime15Picker } from "@/components/datetime-15-picker";
import {
  CcBccPicker,
  DurationSelect,
  InterviewerPicker,
  buildCcBccOptions,
  parseEmailCsv,
  type AceTeamContact,
} from "@/app/candidates/[id]/placement-flows";
import { applyMergeFields as applyMergeFieldsClient } from "@/lib/merge-fields";
import { StageBadge } from "@/components/stage-badge";
import type { PipelineBucket } from "@/lib/rf-payload-shapes";

export type LocalInterview = {
  id: string;
  scheduledAt: string;
  durationMin: number;
  type: "phone_screen" | "video" | "in_person";
  status: "scheduled" | "completed" | "cancelled" | "rescheduled";
  source: "ace_scheduled" | "client_scheduled";
  meetLink: string | null;
  attendees: { name: string; email: string }[];
};

export type LocalJobRow = {
  placementId: string;
  jobRfId: number;
  jobTitle: string;
  jobLocation: string;
  jobDescription: string;
  jobSalaryRange: string;
  clientRfId: number;
  clientName: string;
  clientWebsite: string;
  clientLinkedIn: string;
  clientContacts: { id: number; name: string; title: string; email: string }[];
  stage: string;
  interviews: LocalInterview[];
};

type LocalInviteFlow = {
  step: "client" | "candidate";
  interviewId: string;
  scheduledAtISO: string;
  durationMin: number;
  type: InterviewType;
  meetLink: string | null;
  interviewLocation: string;
  jobTitle: string;
  jobLocation: string;
  jobDescription: string;
  jobSalaryRange: string;
  clientName: string;
  clientWebsite: string;
  clientLinkedIn: string;
  clientContacts: { id: number; name: string; title: string; email: string }[];
  clientContactName: string;
  clientContactEmail: string;
  ccEmails: string[];
  bccEmails: string[];
};

export function LocalPlacementRows({
  candidateId,
  candidateName,
  candidateEmail,
  candidatePhone,
  candidateLocation,
  candidateCurrentTitle,
  candidateCurrentEmployer,
  recruiter,
  jobs,
  aceTeam,
}: {
  candidateId: string;
  candidateName: string;
  candidateEmail: string | null;
  candidatePhone: string | null;
  candidateLocation: string | null;
  candidateCurrentTitle: string | null;
  candidateCurrentEmployer: string | null;
  recruiter: { firstName: string; fullName: string; email: string; phone: string };
  jobs: LocalJobRow[];
  aceTeam: AceTeamContact[];
}) {
  const [scheduleFor, setScheduleFor] = useState<LocalJobRow | null>(null);
  const [clientInviteFor, setClientInviteFor] = useState<LocalJobRow | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<LocalInterview | null>(null);
  const [inviteFlow, setInviteFlow] = useState<LocalInviteFlow | null>(null);

  return (
    <>
      <div className="divide-y divide-court-border rounded-xl border border-court-border bg-court-surface">
        {jobs.map((j) => (
          <LocalJobActionRow
            key={j.placementId}
            candidateId={candidateId}
            job={j}
            onSchedule={() => setScheduleFor(j)}
            onClientInvite={() => setClientInviteFor(j)}
          />
        ))}
      </div>

      {scheduleFor && (
        <ScheduleDialog
          candidateId={candidateId}
          candidateName={candidateName}
          job={scheduleFor}
          aceTeam={aceTeam}
          onClose={() => setScheduleFor(null)}
          onScheduled={(ctx) => {
            setScheduleFor(null);
            setInviteFlow({ ...ctx, step: "client" });
          }}
        />
      )}
      {clientInviteFor && (
        <ClientInviteDialog
          candidateId={candidateId}
          candidateName={candidateName}
          job={clientInviteFor}
          onClose={() => setClientInviteFor(null)}
        />
      )}
      {rescheduleFor && (
        <RescheduleDialog interview={rescheduleFor} onClose={() => setRescheduleFor(null)} />
      )}

      {inviteFlow && inviteFlow.step === "client" && (
        <LocalClientInviteComposer
          invite={inviteFlow}
          candidate={{
            firstName: candidateName.split(/\s+/)[0] ?? candidateName,
            lastName: candidateName.split(/\s+/).slice(1).join(" "),
            email: candidateEmail,
            phone: candidatePhone,
            location: candidateLocation,
            currentTitle: candidateCurrentTitle,
            currentEmployer: candidateCurrentEmployer,
          }}
          candidateName={candidateName}
          candidateEmail={candidateEmail}
          recruiter={recruiter}
          aceTeam={aceTeam}
          onDone={(meetLink) => setInviteFlow({ ...inviteFlow, step: "candidate", meetLink: meetLink ?? inviteFlow.meetLink })}
        />
      )}
      {inviteFlow && inviteFlow.step === "candidate" && (
        <LocalCandidateInviteComposer
          invite={inviteFlow}
          candidate={{
            firstName: candidateName.split(/\s+/)[0] ?? candidateName,
            lastName: candidateName.split(/\s+/).slice(1).join(" "),
            email: candidateEmail,
            phone: candidatePhone,
            location: candidateLocation,
            currentTitle: candidateCurrentTitle,
            currentEmployer: candidateCurrentEmployer,
          }}
          candidateName={candidateName}
          candidateEmail={candidateEmail}
          recruiter={recruiter}
          aceTeam={aceTeam}
          onDone={() => {
            setInviteFlow(null);
            toast.success("Interview scheduled", {
              description: "Client and candidate invites processed.",
            });
          }}
        />
      )}
    </>
  );
}

function LocalJobActionRow({
  candidateId,
  job,
  onSchedule,
  onClientInvite,
}: {
  candidateId: string;
  job: LocalJobRow;
  onSchedule: () => void;
  onClientInvite: () => void;
}) {
  const normalizedStage = (job.stage ?? "sourced").trim().toLowerCase();
  const canSchedule = normalizedStage !== "hired" && normalizedStage !== "cancelled" && normalizedStage !== "rejected";
  // Submit is the primary action for pre-submittal stages. Candidates
  // who are already Submitted, Interviewing, Offer, Hired, Rejected,
  // or Cancelled shouldn't resurface the submittal composer on this
  // row — the next action depends on where they are, not another
  // Submit. The deep-link href opens the existing SubmitModal in
  // LocalCandidateActions with this job pre-selected (see the
  // ?submit= handler in that component).
  const canSubmit =
    normalizedStage === "sourced" ||
    normalizedStage === "applied" ||
    normalizedStage === "kept";

  // Inline next-upcoming interview only. Past scheduled rows hide
  // entirely — the stage chip carries the status signal.
  const nextInterview = job.interviews
    .filter((iv) => iv.status === "scheduled" && new Date(iv.scheduledAt).getTime() > Date.now())
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Briefcase className="h-3 w-3 shrink-0 text-court-fg-muted" />
          <span className="truncate text-sm font-medium text-court-fg">{job.jobTitle}</span>
          {job.clientName && (
            <span className="truncate text-xs text-court-fg-muted">· {job.clientName}</span>
          )}
          <StageBadge bucket={normalizedStage as PipelineBucket} />
          {nextInterview && (
            <span className="truncate text-xs text-court-fg-muted">{formatNextInterviewLocal(nextInterview)}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canSubmit && (
            <Link
              href={`/candidates/${candidateId}?submit=${job.jobRfId}`}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
              title="Open submittal composer"
            >
              <Send className="h-3 w-3" /> Submit
            </Link>
          )}
          {canSchedule && (
            <>
              <Button
                type="button"
                size="sm"
                variant="schedule"
                onClick={onSchedule}
              >
                <CalendarClock className="h-3 w-3" /> Schedule
              </Button>
              <button
                type="button"
                onClick={onClientInvite}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-3 py-1 text-xs font-semibold text-court-fg-muted shadow-sm transition hover:text-court-fg"
                title="Log an interview the client is scheduling themselves — adds to your calendar only"
              >
                <CalendarPlus className="h-3 w-3" /> Client Invite
              </button>
            </>
          )}
        </div>
      </div>

    </div>
  );
}

function formatNextInterviewLocal(iv: LocalInterview): string {
  const d = new Date(iv.scheduledAt);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const type = iv.type === "phone_screen" ? "Phone" : iv.type === "video" ? "Video" : "In-Person";
  return `· ${date} · ${time} · ${type}`;
}

// InterviewRow removed — past interviews no longer render under the
// row; `formatNextInterviewLocal` carries the next-upcoming interview
// inline on the row title line.

function ScheduleDialog({
  candidateId,
  candidateName,
  job,
  aceTeam,
  onClose,
  onScheduled,
}: {
  candidateId: string;
  candidateName: string;
  job: LocalJobRow;
  aceTeam: AceTeamContact[];
  onClose: () => void;
  onScheduled: (ctx: Omit<LocalInviteFlow, "step">) => void;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [type, setType] = useState<InterviewType>("video");
  const [interviewerName, setInterviewerName] = useState("");
  const [interviewerEmail, setInterviewerEmail] = useState("");
  const [location, setLocation] = useState("");
  const [ccCsv, setCcCsv] = useState("");
  const [bccCsv, setBccCsv] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setErr(null);
    if (!scheduledAt) return setErr("Pick a date and time.");
    if (type === "in_person" && !location.trim()) {
      return setErr("Address required for in-person interviews.");
    }
    startSave(async () => {
      const snapped = snapTo15Minutes(scheduledAt);
      const attendees = interviewerName.trim()
        ? [{ name: interviewerName.trim(), email: interviewerEmail.trim() }]
        : [];
      const result = await scheduleInterview({
        candidateId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        scheduledAt: snapped.toISOString(),
        durationMin,
        type,
        attendees,
        notes: notes.trim(),
        source: "ace_scheduled",
        jobTitle: job.jobTitle,
        clientName: job.clientName,
        candidateName,
        location: type === "in_person" ? location.trim() : undefined,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't schedule", { description: result.error });
        return;
      }
      onScheduled({
        interviewId: result.value.interviewId,
        scheduledAtISO: snapped.toISOString(),
        durationMin,
        type,
        meetLink: result.value.meetLink,
        interviewLocation: type === "in_person" ? location.trim() : "",
        jobTitle: job.jobTitle,
        jobLocation: job.jobLocation,
        jobDescription: job.jobDescription,
        jobSalaryRange: job.jobSalaryRange,
        clientName: job.clientName,
        clientWebsite: job.clientWebsite,
        clientLinkedIn: job.clientLinkedIn,
        clientContacts: job.clientContacts,
        clientContactName: interviewerName.trim(),
        clientContactEmail: interviewerEmail.trim(),
        ccEmails: parseEmailCsv(ccCsv),
        bccEmails: parseEmailCsv(bccCsv),
      });
    });
  }

  return (
    <ModalShell title="Schedule interview" subtitle={`${job.jobTitle} · ${job.clientName}`} onClose={onClose}>
      <ScheduleFields
        scheduledAt={scheduledAt}
        setScheduledAt={setScheduledAt}
        durationMin={durationMin}
        setDurationMin={setDurationMin}
        type={type}
        setType={setType}
        location={location}
        setLocation={setLocation}
        notes={notes}
        setNotes={setNotes}
        interviewerSlot={
          <InterviewerPicker
            clientRfId={job.clientRfId}
            clientName={job.clientName}
            initialContacts={job.clientContacts}
            name={interviewerName}
            email={interviewerEmail}
            onChange={(n, e) => {
              setInterviewerName(n);
              setInterviewerEmail(e);
            }}
          />
        }
        ccBccSlot={
          <CcBccPicker
            clientContacts={job.clientContacts}
            aceTeam={aceTeam}
            cc={ccCsv}
            bcc={bccCsv}
            onCcChange={setCcCsv}
            onBccChange={setBccCsv}
          />
        }
      />
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <Footer onCancel={onClose} onSave={onSave} saving={isPending} label="Schedule" />
    </ModalShell>
  );
}

function ClientInviteDialog({
  candidateId,
  candidateName,
  job,
  onClose,
}: {
  candidateId: string;
  candidateName: string;
  job: LocalJobRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [type, setType] = useState<InterviewType>("video");
  const [interviewerName, setInterviewerName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setErr(null);
    if (!scheduledAt) return setErr("Pick a date and time.");
    if (type === "in_person" && !location.trim()) {
      return setErr("Address required for in-person interviews.");
    }
    startSave(async () => {
      const attendees = interviewerName.trim() ? [{ name: interviewerName.trim(), email: "" }] : [];
      const result = await scheduleInterview({
        candidateId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        scheduledAt: snapTo15Minutes(scheduledAt).toISOString(),
        durationMin,
        type,
        attendees,
        notes: notes.trim(),
        source: "client_scheduled",
        jobTitle: job.jobTitle,
        clientName: job.clientName,
        candidateName,
        location: type === "in_person" ? location.trim() : undefined,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't record interview", { description: result.error });
        return;
      }
      toast.success("Logged client-scheduled interview", {
        description: "Added to your calendar for tracking. No invites were sent.",
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <ModalShell title="Client sending invite" subtitle={`${job.jobTitle} · ${job.clientName}`} onClose={onClose}>
      <p className="mb-3 text-xs text-court-fg-muted">
        Use this when the client is scheduling the interview themselves and will send the invite. We&apos;ll
        log it for tracking and drop it on your calendar — no invite is sent to candidate or client.
      </p>
      <ScheduleFields
        scheduledAt={scheduledAt}
        setScheduledAt={setScheduledAt}
        durationMin={durationMin}
        setDurationMin={setDurationMin}
        type={type}
        setType={setType}
        location={location}
        setLocation={setLocation}
        notes={notes}
        setNotes={setNotes}
        interviewerSlot={
          <InterviewerPicker
            clientRfId={job.clientRfId}
            clientName={job.clientName}
            initialContacts={job.clientContacts}
            name={interviewerName}
            email=""
            onChange={(n) => setInterviewerName(n)}
          />
        }
      />
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <Footer onCancel={onClose} onSave={onSave} saving={isPending} label="Log interview" />
    </ModalShell>
  );
}

function RescheduleDialog({ interview, onClose }: { interview: LocalInterview; onClose: () => void }) {
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState(toDatetimeLocalValue(interview.scheduledAt));
  const [durationMin, setDurationMin] = useState(interview.durationMin);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setErr(null);
    if (!scheduledAt) return setErr("Pick a date and time.");
    startSave(async () => {
      const result = await rescheduleInterview({
        interviewId: interview.id,
        scheduledAt: snapTo15Minutes(scheduledAt).toISOString(),
        durationMin,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't reschedule", { description: result.error });
        return;
      }
      toast.success("Interview rescheduled");
      onClose();
      router.refresh();
    });
  }

  return (
    <ModalShell title="Reschedule interview" onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Date &amp; time</span>
          <DateTime15Picker
            value={scheduledAt}
            onChange={setScheduledAt}
            className="mt-1"
          />
        </label>
        <DurationSelect value={durationMin} onChange={setDurationMin} />
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <Footer onCancel={onClose} onSave={onSave} saving={isPending} label="Reschedule" />
    </ModalShell>
  );
}

// ---- Shared dialog primitives ----

// Date/time/type/notes — interviewer is its own picker now (rendered by
// the caller so it can pass client context for the contact dropdown).
function ScheduleFields(props: {
  scheduledAt: string;
  setScheduledAt: (v: string) => void;
  durationMin: number;
  setDurationMin: (n: number) => void;
  type: InterviewType;
  setType: (t: InterviewType) => void;
  location: string;
  setLocation: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  interviewerSlot?: React.ReactNode;
  ccBccSlot?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Date &amp; time</span>
          <DateTime15Picker
            value={props.scheduledAt}
            onChange={props.setScheduledAt}
            className="mt-1"
          />
        </label>
        <DurationSelect value={props.durationMin} onChange={props.setDurationMin} />
      </div>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Type</span>
        <select
          value={props.type}
          onChange={(e) => props.setType(e.target.value as InterviewType)}
          className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="phone_screen">Phone Screen</option>
          <option value="video">Video (Google Meet)</option>
          <option value="in_person">In-Person</option>
        </select>
      </label>
      {props.type === "in_person" && (
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Address</span>
          <input
            type="text"
            value={props.location}
            onChange={(e) => props.setLocation(e.target.value)}
            placeholder="e.g. 500 Main St, Suite 300, Columbus OH 43215"
            className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <span className="mt-1 block text-[11px] text-court-fg-muted">
            Appears in the calendar invite with a Map link.
          </span>
        </label>
      )}
      {props.interviewerSlot}
      {props.ccBccSlot}
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Notes</span>
        <textarea
          value={props.notes}
          onChange={(e) => props.setNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full resize-vertical rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </label>
    </div>
  );
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-court-border px-5 py-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-court-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-court-fg-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function Footer({
  onCancel,
  onSave,
  saving,
  label,
}: {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  label: string;
}) {
  return (
    <div className="mt-5 flex items-center justify-end gap-2 border-t border-court-border pt-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
      >
        <X className="h-3 w-3" /> Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarClock className="h-3 w-3" />}
        {label}
      </button>
    </div>
  );
}

// ---- small helpers ----

function formatType(t: InterviewType): string {
  if (t === "phone_screen") return "Phone Screen";
  if (t === "video") return "Video";
  return "In-Person";
}

function formatWhen(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function surfaceMeetWarning(warning: { reason: string; message: string }): void {
  if (warning.reason === "scope_missing") {
    toast.warning("Meet locked to TRUSTED access", {
      description:
        "Google hasn't granted the Meet settings permission yet. Revoke Ace at myaccount.google.com/permissions, sign in again, and new interviews will default to Anyone-can-join.",
      duration: 12_000,
    });
  } else {
    toast.warning("Meet access stayed TRUSTED", {
      description: warning.message,
      duration: 12_000,
    });
  }
}

function snapTo15Minutes(datetimeLocal: string): Date {
  const d = new Date(datetimeLocal);
  const ms = 15 * 60 * 1000;
  return new Date(Math.round(d.getTime() / ms) * ms);
}

// ---- invite composers ----

function buildValues(args: {
  invite: LocalInviteFlow;
  candidate: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    location: string | null;
    currentTitle: string | null;
    currentEmployer: string | null;
  };
  recruiter: { firstName: string; fullName: string; email: string; phone: string };
}) {
  const candidateFullName = [args.candidate.firstName, args.candidate.lastName].filter(Boolean).join(" ");
  const when = new Date(args.invite.scheduledAtISO);
  return {
    // Candidate
    candidateFirstName: args.candidate.firstName,
    candidateLastName: args.candidate.lastName,
    candidateFullName,
    candidateEmail: args.candidate.email ?? "",
    candidatePhone: args.candidate.phone ?? "",
    candidateLocation: args.candidate.location ?? "",
    candidateCurrentTitle: args.candidate.currentTitle ?? "",
    candidateCurrentEmployer: args.candidate.currentEmployer ?? "",
    // Client
    clientCompanyName: args.invite.clientName,
    clientCompanyWebsite: args.invite.clientWebsite,
    clientCompanyLinkedIn: args.invite.clientLinkedIn,
    clientContactFirstName: args.invite.clientContactName.split(/\s+/)[0] ?? "",
    clientContactFullName: args.invite.clientContactName,
    clientContactEmail: args.invite.clientContactEmail,
    // Job
    jobTitle: args.invite.jobTitle,
    jobLocation: args.invite.jobLocation,
    jobDescription: args.invite.jobDescription,
    jobSalaryRange: args.invite.jobSalaryRange,
    // Interview
    interviewDate: when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
    interviewTime: when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    interviewDateTime: formatWhen(when),
    interviewDuration: `${args.invite.durationMin} min`,
    interviewType: formatType(args.invite.type),
    interviewLocation: args.invite.interviewLocation,
    interviewMeetLink: args.invite.meetLink ?? "",
    interviewerName: args.invite.clientContactName,
    interviewerEmail: args.invite.clientContactEmail,
    // Recruiter
    recruiterFirstName: args.recruiter.firstName,
    recruiterFullName: args.recruiter.fullName,
    recruiterName: args.recruiter.fullName,
    recruiterEmail: args.recruiter.email,
    recruiterPhone: args.recruiter.phone,
  };
}

function LocalClientInviteComposer({
  invite,
  candidate,
  candidateName,
  candidateEmail,
  recruiter,
  aceTeam,
  onDone,
}: {
  invite: LocalInviteFlow;
  candidate: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    location: string | null;
    currentTitle: string | null;
    currentEmployer: string | null;
  };
  candidateName: string;
  candidateEmail: string | null;
  recruiter: { firstName: string; fullName: string; email: string; phone: string };
  aceTeam: AceTeamContact[];
  // Returns the Meet link the server ended up using so the parent can
  // thread it into the candidate composer — without it, the candidate's
  // email body won't show the join URL.
  onDone: (meetLink: string | null) => void;
}) {
  void candidateEmail;
  const values = buildValues({ invite, candidate, recruiter });
  const addrLine = invite.type === "in_person" && invite.interviewLocation
    ? `\n• Location: ${invite.interviewLocation}`
    : "";
  // Only spells out the Meet join URL on the body when this is a video
  // interview AND the Meet link is known. For the client invite (first
  // party), invite.meetLink is still null when the body renders — the
  // Meet is created by the server during send. Not a regression: the
  // client gets the native calendar-invite Join button anyway, and the
  // reason we care about this line is specifically to make sure the
  // candidate (second party) sees the link explicitly.
  const meetLine = invite.type === "video" && invite.meetLink
    ? `\n• Join on Google Meet: [Interview Meet Link]`
    : "";
  const subject = applyMergeFieldsClient(
    `Interview Confirmed - ${candidateName || "Candidate"} for ${invite.jobTitle}`,
    values,
  );
  const body = applyMergeFieldsClient(
    `Hi [Client Contact First Name],\n\nConfirming the interview with [Candidate Full Name] for the [Job Title] role. ` +
      `The calendar invite is on its way.\n\n` +
      `• When: [Interview Date Time]\n• Duration: [Interview Duration]\n• Format: [Interview Type]${addrLine}${meetLine}\n\n` +
      `Reply to this email if anything needs to change.`,
    values,
  );
  const ccPickerOptions = buildCcBccOptions(invite.clientContacts);
  const bccPickerOptions = aceTeam.map((m) => ({ id: m.id, name: m.name, email: m.email }));
  return (
    <EmailComposer
      title="Send client calendar invite"
      subtitle={`${invite.jobTitle} · ${invite.clientName}`}
      draftKey={`interview-invite-${invite.interviewId}-client`}
      initial={{
        to: invite.clientContactEmail ? [invite.clientContactEmail] : [],
        cc: invite.ccEmails,
        bcc: invite.bccEmails,
        subject,
        body,
      }}
      showTemplatePicker
      templateFilter={(t) => t.category === "interview"}
      resolveTemplate={(t) => ({
        subject: applyMergeFieldsClient(t.subject, values),
        body: applyMergeFieldsClient(t.body, values),
      })}
      ccOptions={ccPickerOptions}
      bccOptions={bccPickerOptions}
      mergeValues={values}
      sendLabel="Send Invite"
      onClose={() => onDone(null)}
      onSend={async (draft: EmailDraft) => {
        if (draft.to.length === 0) {
          toast.error("Add a client contact email");
          throw new Error("No recipient");
        }
        const result = await sendInterviewInvite({
          interviewId: invite.interviewId,
          party: "client",
          attendeeEmail: draft.to[0],
          attendeeName: invite.clientContactName || undefined,
          ccEmails: draft.cc,
          bccEmails: draft.bcc,
          subject: draft.subject,
          bodyText: draft.body,
        });
        if (!result.ok) {
          toast.error("Client invite failed", { description: result.error });
          throw new Error(result.error);
        }
        toast.success("Client calendar invite sent", {
          description: "They'll see Accept / Maybe / Decline in their inbox.",
        });
        if (result.value.meetAccessWarning) surfaceMeetWarning(result.value.meetAccessWarning);
        onDone(result.value.meetLink);
      }}
    />
  );
}

function LocalCandidateInviteComposer({
  invite,
  candidate,
  candidateName,
  candidateEmail,
  recruiter,
  aceTeam,
  onDone,
}: {
  invite: LocalInviteFlow;
  candidate: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    location: string | null;
    currentTitle: string | null;
    currentEmployer: string | null;
  };
  candidateName: string;
  candidateEmail: string | null;
  recruiter: { firstName: string; fullName: string; email: string; phone: string };
  aceTeam: AceTeamContact[];
  onDone: () => void;
}) {
  void candidateName;
  const values = buildValues({ invite, candidate, recruiter });
  const addrLine = invite.type === "in_person" && invite.interviewLocation
    ? `\n• Location: ${invite.interviewLocation}`
    : "";
  // By this composer the client invite has already been sent and
  // invite.meetLink is populated (threaded back via LocalClientInvite's
  // onDone). Spell out the Meet URL so the candidate sees it inline in
  // the email body, not just on the native Calendar invite's Join
  // button that Gmail renders above the description.
  const meetLine = invite.type === "video" && invite.meetLink
    ? `\n• Join on Google Meet: [Interview Meet Link]`
    : "";
  const subject = applyMergeFieldsClient(
    `You're confirmed - ${invite.jobTitle} with ${invite.clientName}`,
    values,
  );
  const body = applyMergeFieldsClient(
    `Hi [Candidate First Name],\n\nYou are confirmed for your [Interview Type] interview with [Client Company Name] ` +
      `for the [Job Title] role. The calendar invite is on its way.\n\n` +
      `• When: [Interview Date Time]\n• Duration: [Interview Duration]\n• Format: [Interview Type]${addrLine}${meetLine}\n\n` +
      `Good luck!`,
    values,
  );
  const ccPickerOptions = buildCcBccOptions(invite.clientContacts);
  const bccPickerOptions = aceTeam.map((m) => ({ id: m.id, name: m.name, email: m.email }));
  return (
    <EmailComposer
      title="Send candidate calendar invite"
      subtitle={`${invite.jobTitle} · ${invite.clientName}`}
      draftKey={`interview-invite-${invite.interviewId}-candidate`}
      initial={{
        to: candidateEmail ? [candidateEmail] : [],
        cc: invite.ccEmails,
        bcc: invite.bccEmails,
        subject,
        body,
      }}
      showTemplatePicker
      templateFilter={(t) => t.category === "interview"}
      resolveTemplate={(t) => ({
        subject: applyMergeFieldsClient(t.subject, values),
        body: applyMergeFieldsClient(t.body, values),
      })}
      ccOptions={ccPickerOptions}
      bccOptions={bccPickerOptions}
      mergeValues={values}
      sendLabel="Send Invite"
      onClose={onDone}
      onSend={async (draft: EmailDraft) => {
        if (draft.to.length === 0) {
          toast.error("No candidate email on file");
          throw new Error("No recipient");
        }
        const result = await sendInterviewInvite({
          interviewId: invite.interviewId,
          party: "candidate",
          attendeeEmail: draft.to[0],
          attendeeName: candidateName || undefined,
          ccEmails: draft.cc,
          bccEmails: draft.bcc,
          subject: draft.subject,
          bodyText: draft.body,
        });
        if (!result.ok) {
          toast.error("Candidate invite failed", { description: result.error });
          throw new Error(result.error);
        }
        toast.success("Candidate calendar invite sent", {
          description: "They'll see Accept / Maybe / Decline in their inbox.",
        });
        if (result.value.meetAccessWarning) surfaceMeetWarning(result.value.meetAccessWarning);
        onDone();
      }}
    />
  );
}
