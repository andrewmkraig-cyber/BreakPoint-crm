"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  CalendarClock,
  CalendarPlus,
  Clock,
  Loader2,
  MapPin,
  PhoneCall,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  cancelInterview,
  rescheduleInterview,
  scheduleInterview,
  type InterviewType,
} from "@/app/candidates/[id]/interview-actions";

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
  clientRfId: number;
  clientName: string;
  stage: string;
  interviews: LocalInterview[];
};

export function LocalPlacementRows({
  candidateId,
  candidateName,
  jobs,
}: {
  candidateId: string;
  candidateName: string;
  jobs: LocalJobRow[];
}) {
  const [scheduleFor, setScheduleFor] = useState<LocalJobRow | null>(null);
  const [clientInviteFor, setClientInviteFor] = useState<LocalJobRow | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<LocalInterview | null>(null);

  return (
    <div className="rounded-xl border border-border bg-white px-5 py-4 shadow-sm">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Linked jobs ({jobs.length})
      </div>
      <div className="space-y-2">
        {jobs.map((j) => (
          <LocalJobActionRow
            key={j.placementId}
            job={j}
            onSchedule={() => setScheduleFor(j)}
            onClientInvite={() => setClientInviteFor(j)}
            onReschedule={(iv) => setRescheduleFor(iv)}
          />
        ))}
      </div>

      {scheduleFor && (
        <ScheduleDialog
          candidateId={candidateId}
          candidateName={candidateName}
          job={scheduleFor}
          onClose={() => setScheduleFor(null)}
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
    </div>
  );
}

function LocalJobActionRow({
  job,
  onSchedule,
  onClientInvite,
  onReschedule,
}: {
  job: LocalJobRow;
  onSchedule: () => void;
  onClientInvite: () => void;
  onReschedule: (iv: LocalInterview) => void;
}) {
  const canSchedule = job.stage !== "hired" && job.stage !== "cancelled" && job.stage !== "rejected";

  return (
    <div className="space-y-2 rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-navy">
              <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{job.jobTitle}</span>
            </div>
            {job.clientName && (
              <div className="mt-0.5 pl-[1.375rem] text-xs text-muted-foreground">{job.clientName}</div>
            )}
          </div>
          <div className="shrink-0 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">
            {job.stage}
          </div>
        </div>
        {canSchedule && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onSchedule}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-navy shadow-sm transition hover:border-brand/40 hover:text-brand-dark"
            >
              <CalendarClock className="h-3.5 w-3.5" /> Schedule Interview
            </button>
            <button
              type="button"
              onClick={onClientInvite}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-navy shadow-sm transition hover:border-brand/40 hover:text-brand-dark"
              title="Log an interview the client is scheduling themselves — adds to your calendar only"
            >
              <CalendarPlus className="h-3.5 w-3.5" /> Client Sending Invite
            </button>
          </div>
        )}
      </div>

      {job.interviews.length > 0 && (
        <div className="mt-1 space-y-1.5 border-t border-border pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Interviews ({job.interviews.length})
          </div>
          <ul className="space-y-1.5">
            {[...job.interviews]
              .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
              .map((iv) => (
                <InterviewRow key={iv.id} iv={iv} onReschedule={onReschedule} />
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function InterviewRow({ iv, onReschedule }: { iv: LocalInterview; onReschedule: (iv: LocalInterview) => void }) {
  const router = useRouter();
  const [isCancelling, startCancel] = useTransition();
  const when = new Date(iv.scheduledAt);
  const isPast = when.getTime() < Date.now();
  const isCancelled = iv.status === "cancelled";
  const Icon = iv.type === "phone_screen" ? PhoneCall : iv.type === "video" ? Video : MapPin;

  function onCancel() {
    if (!confirm("Cancel this interview? The calendar event will be removed.")) return;
    startCancel(async () => {
      const result = await cancelInterview(iv.id);
      if (!result.ok) {
        toast.error("Couldn't cancel", { description: result.error });
        return;
      }
      toast.success("Interview cancelled");
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs",
        isCancelled
          ? "border-border bg-muted/30 text-muted-foreground line-through"
          : isPast
            ? "border-border bg-muted/30 text-muted-foreground"
            : "border-border bg-muted/10 text-navy",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate font-medium">
            {formatWhen(when)} · {iv.durationMin}m · {formatType(iv.type)}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {iv.source === "client_scheduled" ? "Client-scheduled" : "Ace-scheduled"}
            {iv.attendees.length > 0 ? ` · with ${iv.attendees.map((a) => a.name).join(", ")}` : ""}
            {iv.meetLink ? ` · Meet` : ""}
          </div>
        </div>
      </div>
      {!isCancelled && !isPast && (
        <div className="flex items-center gap-1">
          {iv.meetLink && (
            <a
              href={iv.meetLink}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-border bg-white px-2 py-1 font-semibold text-navy hover:border-brand/40 hover:text-brand-dark"
            >
              Open Meet
            </a>
          )}
          <button
            type="button"
            onClick={() => onReschedule(iv)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 font-semibold text-navy hover:border-brand/40 hover:text-brand-dark"
          >
            <Clock className="h-3 w-3" /> Reschedule
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isCancelling}
            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 font-semibold text-red-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
          >
            {isCancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

function ScheduleDialog({
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
  const [interviewerEmail, setInterviewerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setErr(null);
    if (!scheduledAt) return setErr("Pick a date and time.");
    startSave(async () => {
      const attendees = interviewerName.trim()
        ? [{ name: interviewerName.trim(), email: interviewerEmail.trim() }]
        : [];
      const result = await scheduleInterview({
        candidateId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMin,
        type,
        attendees,
        notes: notes.trim(),
        source: "ace_scheduled",
        jobTitle: job.jobTitle,
        clientName: job.clientName,
        candidateName,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't schedule", { description: result.error });
        return;
      }
      toast.success("Interview scheduled", {
        description: result.value.meetLink ? "Added to your calendar. Meet link created." : "Added to your calendar.",
      });
      onClose();
      router.refresh();
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
        interviewerName={interviewerName}
        setInterviewerName={setInterviewerName}
        interviewerEmail={interviewerEmail}
        setInterviewerEmail={setInterviewerEmail}
        notes={notes}
        setNotes={setNotes}
        includeEmail
      />
      <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Event is added to your Google Calendar for tracking. Candidate and client invite delivery with attendees lands in the next batch.
      </div>
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
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setErr(null);
    if (!scheduledAt) return setErr("Pick a date and time.");
    startSave(async () => {
      const attendees = interviewerName.trim() ? [{ name: interviewerName.trim(), email: "" }] : [];
      const result = await scheduleInterview({
        candidateId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMin,
        type,
        attendees,
        notes: notes.trim(),
        source: "client_scheduled",
        jobTitle: job.jobTitle,
        clientName: job.clientName,
        candidateName,
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
      <p className="mb-3 text-xs text-muted-foreground">
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
        interviewerName={interviewerName}
        setInterviewerName={setInterviewerName}
        notes={notes}
        setNotes={setNotes}
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
        scheduledAt: new Date(scheduledAt).toISOString(),
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
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Date &amp; time</span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Duration (min)</span>
          <input
            type="number"
            min={5}
            step={5}
            value={durationMin}
            onChange={(e) => setDurationMin(Math.max(5, Number(e.target.value) || 30))}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </label>
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <Footer onCancel={onClose} onSave={onSave} saving={isPending} label="Reschedule" />
    </ModalShell>
  );
}

// ---- Shared dialog primitives ----

function ScheduleFields(props: {
  scheduledAt: string;
  setScheduledAt: (v: string) => void;
  durationMin: number;
  setDurationMin: (n: number) => void;
  type: InterviewType;
  setType: (t: InterviewType) => void;
  interviewerName: string;
  setInterviewerName: (v: string) => void;
  interviewerEmail?: string;
  setInterviewerEmail?: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  includeEmail?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Date &amp; time</span>
          <input
            type="datetime-local"
            value={props.scheduledAt}
            onChange={(e) => props.setScheduledAt(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Duration (min)</span>
          <input
            type="number"
            min={5}
            step={5}
            value={props.durationMin}
            onChange={(e) => props.setDurationMin(Math.max(5, Number(e.target.value) || 30))}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Type</span>
        <select
          value={props.type}
          onChange={(e) => props.setType(e.target.value as InterviewType)}
          className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="phone_screen">Phone Screen</option>
          <option value="video">Video (Google Meet)</option>
          <option value="in_person">In-Person</option>
        </select>
      </label>
      <div className={cn("grid grid-cols-1 gap-3", props.includeEmail ? "sm:grid-cols-2" : "")}>
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Interviewer name</span>
          <input
            type="text"
            value={props.interviewerName}
            onChange={(e) => props.setInterviewerName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </label>
        {props.includeEmail && props.setInterviewerEmail && (
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Interviewer email</span>
            <input
              type="email"
              value={props.interviewerEmail ?? ""}
              onChange={(e) => props.setInterviewerEmail!(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
        )}
      </div>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Notes</span>
        <textarea
          value={props.notes}
          onChange={(e) => props.setNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full resize-vertical rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-navy">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
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
    <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-60"
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
