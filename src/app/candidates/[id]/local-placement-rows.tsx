"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  CalendarClock,
  DollarSign,
  Loader2,
  RotateCcw,
  Send,
  UserX,
  X,
} from "lucide-react";
import {
  reapplyLocalPlacement,
  recordLocalOffer,
  rejectLocalPlacement,
} from "@/app/candidates/[id]/local-placement-actions";
import { DismissPlacementButton } from "@/app/candidates/[id]/dismiss-placement-button";
import { toast } from "sonner";
import { RejectCandidateDialog } from "@/components/reject-candidate-dialog";
import { Button } from "@/components/ui/button";
import {
  cancelInterview,
  getInterviewSchedulingTemplates,
  rescheduleInterview,
  scheduleInterview,
  sendInterviewInvite,
  upsertInterviewReminder,
  type InterviewType,
  type MeetingProvider,
} from "@/app/candidates/[id]/interview-actions";
import { EmailComposer, type EmailDraft } from "@/components/email-composer";
import { DateTime15Picker } from "@/components/datetime-15-picker";
import { MeetingProviderSelect } from "@/components/meeting-provider-select";
import {
  CcBccPicker,
  DurationSelect,
  InterviewerPicker,
  buildCcBccOptions,
  extractMeetCode,
  parseEmailCsv,
  surfaceMeetSettingsLink,
  type AceTeamContact,
} from "@/app/candidates/[id]/placement-flows";
import { triggerCalendarSync } from "@/lib/calendar/trigger-sync";
import { applyMergeFields as applyMergeFieldsClient } from "@/lib/merge-fields";
import { StageBadge } from "@/components/stage-badge";
import type { PipelineBucket } from "@/lib/rf-payload-shapes";

// Fired by the Apply-to-Job modal (LocalCandidateActions) the moment a
// placement write resolves. LocalPlacementRows listens and optimistically
// prepends an "applied" row so the job pill appears immediately, the same
// way Reject flips an existing row's pill from local state without a manual
// reload. The useEffect that mirrors the `jobs` prop reconciles the
// optimistic row with server truth once router.refresh() lands.
export const LOCAL_PLACEMENT_APPLIED_EVENT = "ace:local-placement-applied";

export type LocalPlacementAppliedDetail = {
  candidateId: string;
  jobRfId: number;
  jobTitle: string;
  jobLocation: string;
  clientRfId: number;
  clientName: string;
  clientContacts: { id: number; name: string; title: string; email: string }[];
};

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
  // Pre-fetched interview-scheduled templates; null per side means the
  // composer falls back to its hardcoded default. Mirrors the RF flow's
  // InviteFlowState shape so both surfaces stay in sync.
  candidateTemplate: { subject: string; body: string } | null;
  clientTemplate: { subject: string; body: string } | null;
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
  className,
  embed = false,
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
  // Extra classes merged onto the pill-strip root. The split-view embed
  // passes mt-4 so the pills row clears the chrome above it; the full
  // profile passes nothing.
  className?: string;
  // True when this strip is rendered inside the /candidates split-view
  // iframe. Per-row Submit links must carry embed=true through the deep
  // link or the iframe navigates to the non-embed candidate page and
  // stacks a second AppShell sidebar + topbar inside the right panel.
  // Mirrors the embedPrefix pattern in UnderlineTabs.
  embed?: boolean;
}) {
  const [scheduleFor, setScheduleFor] = useState<LocalJobRow | null>(null);
  const [offerFor, setOfferFor] = useState<LocalJobRow | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<LocalInterview | null>(null);
  const [inviteFlow, setInviteFlow] = useState<LocalInviteFlow | null>(null);
  const router = useRouter();

  // Mirror the jobs prop into local state so the optimistic Apply (event
  // below) and Reject (handleStageChanged) paths can flip a pill instantly.
  // The catch: the stage server actions call revalidatePath, which pushes
  // fresh `jobs` the instant the action resolves, racing the DB write and
  // read-replica lag. A naive setJobsState(jobs) would clobber the
  // optimistic pill and it would flash then disappear. pendingStages holds
  // each optimistically-set stage (keyed by jobRfId) until the server prop
  // reports the same value, then releases the hold and trusts server truth.
  const [jobsState, setJobsState] = useState<LocalJobRow[]>(jobs);
  const pendingStages = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    setJobsState((prev) => {
      // Fast path: nothing optimistic in flight, take server truth as-is.
      if (pendingStages.current.size === 0) return jobs;
      const serverIds = new Set(jobs.map((j) => j.jobRfId));
      const merged = jobs.map((j) => {
        const pending = pendingStages.current.get(j.jobRfId);
        if (pending == null) return j;
        const serverStage = (j.stage ?? "sourced").trim().toLowerCase();
        if (serverStage === pending) {
          // Server caught up, so release the optimistic hold.
          pendingStages.current.delete(j.jobRfId);
          return j;
        }
        // Server still stale, so keep the optimistic stage on the pill.
        return { ...j, stage: pending };
      });
      // Brand-new optimistic Apply rows the server prop does not list yet
      // live only in prev. Keep them until the placement surfaces.
      const heldNew = prev.filter(
        (j) => !serverIds.has(j.jobRfId) && pendingStages.current.has(j.jobRfId),
      );
      return [...merged, ...heldNew];
    });
  }, [jobs]);

  // Optimistic apply: the Apply-to-Job modal dispatches
  // LOCAL_PLACEMENT_APPLIED_EVENT the instant its write resolves. Prepend
  // an Applied row immediately so the job pill shows without waiting on the
  // RSC refetch (which races the DB commit). pendingStages holds the row
  // until the server prop surfaces the placement, so the revalidatePath
  // refresh can't drop it mid-flight. Same hold the Reject pill relies on.
  useEffect(() => {
    function onApplied(e: Event) {
      const detail = (e as CustomEvent<LocalPlacementAppliedDetail>).detail;
      if (!detail || detail.candidateId !== candidateId) return;
      pendingStages.current.set(detail.jobRfId, "applied");
      setJobsState((prev) => {
        if (prev.some((j) => j.jobRfId === detail.jobRfId)) return prev;
        const optimistic: LocalJobRow = {
          placementId: `local-applied-${detail.jobRfId}`,
          jobRfId: detail.jobRfId,
          jobTitle: detail.jobTitle,
          jobLocation: detail.jobLocation,
          jobDescription: "",
          jobSalaryRange: "",
          clientRfId: detail.clientRfId,
          clientName: detail.clientName,
          clientWebsite: "",
          clientLinkedIn: "",
          clientContacts: detail.clientContacts,
          stage: "applied",
          interviews: [],
        };
        return [...prev, optimistic];
      });
    }
    window.addEventListener(LOCAL_PLACEMENT_APPLIED_EVENT, onApplied);
    return () => window.removeEventListener(LOCAL_PLACEMENT_APPLIED_EVENT, onApplied);
  }, [candidateId]);

  // Optimistic stage flip for the per-row Reject action. The row pill reads
  // job.stage from jobsState, so mutating it here updates the pill the
  // instant the server action resolves. pendingStages (keyed by jobRfId)
  // holds the new stage so the revalidatePath refresh can't clobber it; the
  // delayed router.refresh reconciles external surfaces (applicants,
  // pipeline) and lets the hold release once server data confirms.
  function handleStageChanged(jobRfId: number, stage: string) {
    pendingStages.current.set(jobRfId, stage);
    setJobsState((prev) =>
      prev.map((j) => (j.jobRfId === jobRfId ? { ...j, stage } : j)),
    );
    setTimeout(() => router.refresh(), 500);
  }

  // Mounted even with zero placements so the apply listener above is live
  // for the candidate's first apply. Render nothing until there's a row.
  if (jobsState.length === 0) return null;

  return (
    <>
      <div
        className={`divide-y divide-court-border rounded-xl border border-court-border/40 bg-court-surface${
          className ? ` ${className}` : ""
        }`}
      >
        {jobsState.map((j) => (
          <LocalJobActionRow
            key={j.placementId}
            candidateId={candidateId}
            candidateName={candidateName}
            job={j}
            onSchedule={() => setScheduleFor(j)}
            onOffer={() => setOfferFor(j)}
            onEditInterview={(iv) => setRescheduleFor(iv)}
            onStageChange={handleStageChanged}
            embed={embed}
          />
        ))}
      </div>

      {scheduleFor && (
        // Schedule modal stays mounted while the invite composers
        // are open on top of it — that way clicking Back on the
        // candidate composer returns to the schedule modal with all
        // values still populated.
        <ScheduleDialog
          candidateId={candidateId}
          candidateName={candidateName}
          job={scheduleFor}
          aceTeam={aceTeam}
          onClose={() => setScheduleFor(null)}
          onScheduled={(ctx) => {
            setInviteFlow({ ...ctx, step: "candidate" });
          }}
        />
      )}
      {offerFor && (
        <OfferDialog
          job={offerFor}
          onClose={() => setOfferFor(null)}
          onRecorded={() => {
            handleStageChanged(offerFor.jobRfId, "offer");
            setOfferFor(null);
          }}
        />
      )}
      {rescheduleFor && (
        <RescheduleDialog interview={rescheduleFor} onClose={() => setRescheduleFor(null)} />
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
          onClose={() => {
            setInviteFlow(null);
            setScheduleFor(null);
          }}
          onBack={() => {
            const interviewId = inviteFlow.interviewId;
            setInviteFlow(null);
            void cancelInterview(interviewId).then((res) => {
              if (!res.ok) {
                toast.error("Couldn't cancel in-flight interview", { description: res.error });
              }
            });
          }}
          onSent={() => setInviteFlow({ ...inviteFlow, step: "client" })}
        />
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
          onClose={() => {
            setInviteFlow(null);
            setScheduleFor(null);
          }}
          onBack={() => setInviteFlow({ ...inviteFlow, step: "candidate" })}
          onSent={() => {
            setInviteFlow(null);
            setScheduleFor(null);
            toast.success("Interview scheduled", {
              description: "Candidate and client invites processed.",
            });
          }}
        />
      )}
    </>
  );
}

function LocalJobActionRow({
  candidateId,
  candidateName,
  job,
  onSchedule,
  onOffer,
  onEditInterview,
  onStageChange,
  embed,
}: {
  candidateId: string;
  candidateName: string;
  job: LocalJobRow;
  onSchedule: () => void;
  onOffer: () => void;
  onEditInterview: (interview: LocalInterview) => void;
  onStageChange: (jobRfId: number, stage: string) => void;
  // Threaded from LocalPlacementRows so the per-row Submit href can
  // preserve embed=true in the split-view iframe and avoid the
  // double-sidebar / double-topbar re-render.
  embed: boolean;
}) {
  const router = useRouter();
  const [isRejecting, startRejecting] = useTransition();
  const [isReapplying, startReapplying] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const normalizedStage = (job.stage ?? "sourced").trim().toLowerCase();
  const canSchedule = normalizedStage !== "hired" && normalizedStage !== "cancelled" && normalizedStage !== "rejected";
  // Submit is the primary action for pre-submittal stages. Candidates
  // who are already Submitted, Interviewing, Offer, Hired, Rejected,
  // or Cancelled shouldn't resurface the submittal composer on this
  // row — the next action depends on where they are, not another
  // Submit. The deep-link href opens the existing SubmitModal in
  // LocalCandidateActions with this job pre-selected (see the
  // ?submit= handler in that component).
  //
  // In split-view embed mode the href must also carry embed=true, or
  // the iframe re-navigates to the non-embed page and stacks a second
  // AppShell sidebar + topbar inside the right panel (the modal still
  // pops, but on top of doubled chrome).
  const submitHrefPrefix = embed ? "embed=true&" : "";
  const canSubmit =
    normalizedStage === "sourced" ||
    normalizedStage === "applied" ||
    normalizedStage === "kept";

  // Reject available on the active mid-pipeline stages plus Applied
  // so the recruiter can dismiss an applicant who isn't a fit without
  // having to formally Submit them first. Hired, cancelled, sourced,
  // kept, and already-rejected rows don't show it.
  const canReject =
    normalizedStage === "applied" ||
    normalizedStage === "submitted" ||
    normalizedStage === "interviewing" ||
    normalizedStage === "offer" ||
    normalizedStage === "pending_start";

  // Extend Offer is interviewing-only: the recruiter has met the
  // client + candidate, and the offer is the next forward action.
  // Mirrors the "Offer" button in the Job-page Pipeline rows
  // (see PipelineRowActions, case "interviewing"). The "Client
  // Sending Invite" shortcut that used to live here is now folded
  // into the schedule modal as a "Client will send invite" checkbox.
  const canExtendOffer = normalizedStage === "interviewing";

  // Reapply is the inverse of Reject — visible only on already-rejected
  // rows. Moves the row back to "applied" stage so the candidate
  // appears on /applicants and the job pill stays visible on their
  // profile.
  const canReapply = normalizedStage === "rejected";

  function onReject() {
    setRejectOpen(true);
  }

  function onReapply() {
    if (
      !confirm(
        `Reapply ${candidateName} to ${job.jobTitle}? Moves the placement back to Applied so they show up on /applicants.`,
      )
    ) {
      return;
    }
    startReapplying(async () => {
      const res = await reapplyLocalPlacement({ placementId: job.placementId });
      if (!res.ok) {
        toast.error("Couldn't reapply", { description: res.error });
        return;
      }
      toast.success(`Reapplied ${candidateName}`);
      router.refresh();
    });
  }

  async function handleRejectConfirm({
    sendRejectionEmail,
  }: {
    sendRejectionEmail: boolean;
  }) {
    await new Promise<void>((resolve) => {
      startRejecting(async () => {
        const res = await rejectLocalPlacement({
          placementId: job.placementId,
          sendRejectionEmail,
        });
        if (!res.ok) {
          toast.error("Couldn't reject", { description: res.error });
          resolve();
          return;
        }
        toast.success(
          sendRejectionEmail ? "Rejected. Email sent" : "Rejected",
        );
        setRejectOpen(false);
        onStageChange(job.jobRfId, "rejected");
        resolve();
      });
    });
  }

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
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {canSubmit && (
            // Canonical Submit chip — tinted brand green, rounded-md.
            // Same signature as the candidate-profile action row, the
            // Applicants table, and the Pipeline / Search Submit
            // buttons so the affirmative submittal action reads
            // identically wherever it lands. Sized close to the stage
            // badge chip beside it (px-2 py-0.5 text-[11px]) so the
            // row reads as a compact strip instead of a stack of
            // chunky action buttons.
            <Link
              href={`/candidates/${candidateId}?${submitHrefPrefix}submit=${job.jobRfId}`}
              className={CHIP_BTN_CLS_SUBMIT}
              title="Open submittal composer"
            >
              <Send className="h-3 w-3" />
              <span className="hidden sm:inline">Submit</span>
            </Link>
          )}
          {normalizedStage === "interviewing" && nextInterview && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onEditInterview(nextInterview)}
              title="Edit the upcoming interview"
              className={CHIP_BTN_CLS}
            >
              <CalendarClock className="h-3 w-3" />
              <span className="hidden sm:inline">Edit Interview</span>
            </Button>
          )}
          {canSchedule && (
            <Button
              type="button"
              size="sm"
              variant="schedule"
              onClick={onSchedule}
              title="Schedule interview"
              className={CHIP_BTN_CLS}
            >
              <CalendarClock className="h-3 w-3" />
              <span className="hidden sm:inline">Schedule Interview</span>
            </Button>
          )}
          {canExtendOffer && (
            <Button
              type="button"
              size="sm"
              variant="offer"
              onClick={onOffer}
              title="Extend an offer to this candidate for this job"
              className={CHIP_BTN_CLS}
            >
              <DollarSign className="h-3 w-3" />
              <span className="hidden sm:inline">Offer</span>
            </Button>
          )}
          {canReject && (
            <Button
              type="button"
              size="sm"
              variant="reject"
              onClick={onReject}
              disabled={isRejecting}
              title="Reject this candidate for this job"
              className={CHIP_BTN_CLS}
            >
              {isRejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
              <span className="hidden sm:inline">Reject</span>
            </Button>
          )}
          {canReapply && (
            <Button
              type="button"
              size="sm"
              variant="reapply"
              onClick={onReapply}
              disabled={isReapplying}
              title="Reapply this candidate. Deletes the disqualified placement row"
              className={CHIP_BTN_CLS}
            >
              {isReapplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              <span className="hidden sm:inline">Reapply</span>
            </Button>
          )}
          {/* Faint X on the far right of the pill. Optimistic apply rows
              carry a synthetic placementId until router.refresh() lands a
              real one, so suppress the X there - there's nothing to delete
              yet. */}
          {!job.placementId.startsWith("local-applied-") && (
            <DismissPlacementButton placementId={job.placementId} jobTitle={job.jobTitle} />
          )}
        </div>
      </div>

      {rejectOpen && (
        <RejectCandidateDialog
          candidateName={candidateName}
          jobTitle={job.jobTitle}
          onClose={() => setRejectOpen(false)}
          onConfirm={handleRejectConfirm}
        />
      )}
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
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [type, setType] = useState<InterviewType>("video");
  // Defaults ON: matches Andrew's typical "anyone with the link can
  // join" Meet for client/candidate convenience. Off locks the Meet to
  // the invited attendees only.
  const [openMeeting, setOpenMeeting] = useState(true);
  const [meetingType, setMeetingType] = useState<MeetingProvider>("google");
  const [microsoftConnected, setMicrosoftConnected] = useState(false);
  const [interviewerName, setInterviewerName] = useState("");
  const [interviewerEmail, setInterviewerEmail] = useState("");
  const [location, setLocation] = useState("");
  const [ccCsv, setCcCsv] = useState("");
  const [bccCsv, setBccCsv] = useState("");
  const [notes, setNotes] = useState("");
  // When checked, the recruiter is logging an interview the client is
  // scheduling themselves: we still write the Interview row + sync the
  // recruiter's calendar + log the activity (so the interview credit
  // lands), but we route through source="client_scheduled" and skip the
  // candidate/client invite composers entirely — no emails go out to
  // anyone. Folds the old "Client Sending Invite" button on the row
  // into the schedule modal so there's one canonical scheduling entry.
  const [clientWillSendInvite, setClientWillSendInvite] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/microsoft/status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { connected: boolean };
        if (!cancelled) setMicrosoftConnected(Boolean(json.connected));
      } catch {
        if (!cancelled) setMicrosoftConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        // client_scheduled flips off the candidate/client email
        // composers downstream; ace_scheduled keeps the existing
        // Schedule → Candidate Invite → Client Invite chain.
        source: clientWillSendInvite ? "client_scheduled" : "ace_scheduled",
        jobTitle: job.jobTitle,
        clientName: job.clientName,
        candidateName,
        location: type === "in_person" ? location.trim() : undefined,
        // openMeeting + meetingType only matter for ace_scheduled (we
        // create the Meet on Andrew's behalf). For client_scheduled
        // the client is creating the calendar event themselves, so
        // skip both — no Meet link is generated.
        openMeeting: clientWillSendInvite ? undefined : openMeeting,
        meetingType:
          clientWillSendInvite ? undefined : type === "video" ? meetingType : undefined,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't schedule", { description: result.error });
        return;
      }
      // Same auto-sync the manual Sync button on /calendar fires, so
      // the freshly created Google event lands in the local
      // CalendarEvent mirror without the recruiter clicking Sync.
      void triggerCalendarSync(router);
      // Auto-fire the site-wide amber reminder toast an hour ahead of
      // every interview. Best-effort: reminder failures never block the
      // schedule success path.
      void upsertInterviewReminder(result.value.interviewId);

      // Client-scheduled branch: interview row + calendar + activity
      // log are already written by scheduleInterview above (the
      // recruiter gets the interview credit). Skip the invite
      // composers entirely and close the modal — no emails are sent
      // to candidate or client.
      if (clientWillSendInvite) {
        toast.success("Interview scheduled", {
          description: "Logged for tracking. No invites were sent.",
        });
        onClose();
        return;
      }
      // Same pre-fetch as the RF flow — templates seed the composers,
      // failures fall back to hardcoded defaults silently.
      let templates: { candidate: { subject: string; body: string } | null; client: { subject: string; body: string } | null } = {
        candidate: null,
        client: null,
      };
      try {
        templates = await getInterviewSchedulingTemplates();
      } catch {
        // ignore
      }
      if (type === "video" && result.value.meetLink) {
        const meetCode = extractMeetCode(result.value.meetLink);
        if (meetCode) surfaceMeetSettingsLink();
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
        candidateTemplate: templates.candidate,
        clientTemplate: templates.client,
      });
    });
  }

  return (
    <ModalShell
      title="Schedule interview"
      subtitle={`${job.jobTitle} · ${job.clientName}`}
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={onSave} saving={isPending} label="Schedule" />}
    >
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
        typeExtras={
          // Open-Meet toggle only matters on the ace_scheduled path
          // (we mint the Meet on Andrew's behalf there). The
          // client-scheduled toggle below routes scheduling to the
          // tracking-only path, which never creates a Meet link —
          // hide the open-meeting checkbox in that case so its state
          // isn't misleading.
          type === "video" && !clientWillSendInvite ? (
            <div className="space-y-2">
              <MeetingProviderSelect
                value={meetingType}
                onChange={setMeetingType}
                teamsConnected={microsoftConnected}
              />
              {meetingType === "google" && (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={openMeeting}
                    onChange={(e) => setOpenMeeting(e.target.checked)}
                    className="h-4 w-4 rounded border-court-border accent-brand-dark"
                  />
                  <span className="text-court-fg">Open meeting (anyone can join)</span>
                </label>
              )}
            </div>
          ) : null
        }
        interviewerSlot={
          <InterviewerPicker
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
          // Cc/Bcc only ride on outbound invite emails; the
          // client-scheduled path doesn't send any email at all, so
          // suppress the picker rather than collect values that
          // would silently be discarded.
          clientWillSendInvite ? null : (
            <CcBccPicker
              clientContacts={job.clientContacts}
              aceTeam={aceTeam}
              cc={ccCsv}
              bcc={bccCsv}
              onCcChange={setCcCsv}
              onBccChange={setBccCsv}
            />
          )
        }
      />
      <label
        className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-court-border/40 bg-court-surface-subtle/60 p-3 text-sm"
        title="Use this when the client is scheduling the interview themselves and sending their own invite. We'll log it on your calendar for tracking and credit, but skip the candidate/client invite emails Ace would otherwise send."
      >
        <input
          type="checkbox"
          checked={clientWillSendInvite}
          onChange={(e) => setClientWillSendInvite(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-court-border accent-brand-dark"
        />
        <span>
          <span className="font-semibold text-court-fg">Client will send invite</span>
          <span className="block text-xs text-court-fg-muted">
            Log the interview on your calendar and activity log for tracking + credit.
            Skip the candidate/client invite emails. The client is sending their own.
          </span>
        </span>
      </label>
      {err && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {err}
          {err.includes("Reconnect in Settings") && (
            <>
              {" "}
              <a href="/settings/connectors" className="font-semibold underline">
                Go to Settings &gt; Connectors
              </a>
            </>
          )}
        </div>
      )}
    </ModalShell>
  );
}

// Shared chip-size className used by every action button on the job pill.
// Stage badges next door sit at px-2 py-0.5 text-[10px]; matching them
// (with text bumped one step for legibility) makes the strip read as a
// compact row of chips rather than a stack of full-size action buttons.
// twMerge in our cn() picks the later padding/text utilities, so passing
// this as `className` on a size="sm" Button cleanly overrides the
// "px-3 py-1.5 text-xs gap-1.5" defaults from button.tsx.
const CHIP_BTN_CLS = "px-2 py-0.5 text-[11px] gap-1";
// Submit is a raw <Link>, not a <Button>, so it carries the full chip
// class set (matching the brand-green Submit treatment everywhere else
// but at chip size). Keep visually identical to the size="sm" chip Buttons
// so the row stays uniform.
const CHIP_BTN_CLS_SUBMIT =
  "inline-flex items-center justify-center gap-1 rounded-md border border-court-brand bg-court-brand-tint px-2 py-0.5 text-[11px] font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25";

// Extend Offer modal. Mirrors the Job-page pipeline-board OfferDialog
// for Ace-native placements: collects salary/title/start-date/notes plus
// the fee math the Scoreboard's Pipeline Value KPI sums across offer +
// pending_start rows. Wired to recordLocalOffer (keyed on placementId)
// rather than the RF recordOffer because Ace-native rows carry
// candidateRfId: null.
function OfferDialog({
  job,
  onClose,
  onRecorded,
}: {
  job: LocalJobRow;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const router = useRouter();
  const [salary, setSalary] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [title, setTitle] = useState(job.jobTitle);
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");
  const [feePct, setFeePct] = useState("");
  const [minFee, setMinFee] = useState("");
  const [feeAmountOverride, setFeeAmountOverride] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  const salaryNum = parseAmount(salary);
  const pctNum = parseFloat(feePct) || 0;
  const minFeeNum = parseAmount(minFee);
  const overrideNum = parseAmount(feeAmountOverride);
  const rawFee = salaryNum && pctNum ? Math.round(salaryNum * (pctNum / 100)) : 0;
  // Fee resolution priority matches the RF OfferDialog: override > min-vs-calc > calc.
  const calcFee = minFeeNum && rawFee < minFeeNum ? minFeeNum : rawFee;
  const feeTotal = overrideNum != null ? overrideNum : calcFee;
  const usedMinFee = overrideNum == null && minFeeNum != null && rawFee < minFeeNum;
  const usedOverride = overrideNum != null;

  function onSave() {
    setErr(null);
    if (salaryNum != null && salaryNum < 0) return setErr("Salary can't be negative.");
    if (overrideNum != null && overrideNum < 0) return setErr("Fee amount can't be negative.");
    if (minFeeNum != null && minFeeNum < 0) return setErr("Minimum fee can't be negative.");
    if (pctNum < 0) return setErr("Fee percentage can't be negative.");
    if (feeTotal <= 0) {
      return setErr("Fee amount is required at this stage — enter salary + fee %, or a flat amount.");
    }
    startSave(async () => {
      const result = await recordLocalOffer({
        placementId: job.placementId,
        salary: salaryNum,
        currency: currency.toUpperCase().slice(0, 3),
        title: title.trim(),
        startDate: startDate || null,
        notes: notes.trim(),
        feePercentage: pctNum > 0 ? pctNum : null,
        feeTotal,
        minFee: minFeeNum,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't record offer", { description: result.error });
        return;
      }
      toast.success("Offer recorded");
      onRecorded();
      router.refresh();
    });
  }

  return (
    <ModalShell
      title="Offer"
      subtitle={`${job.jobTitle} · ${job.clientName}`}
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={onSave} saving={isPending} label="Record offer" />}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OfferField label="Offered salary" value={salary} onChange={setSalary} placeholder="e.g. 120000 or 120k" />
        <OfferField label="Currency" value={currency} onChange={setCurrency} />
        <div className="sm:col-span-2">
          <OfferField label="Offered title" value={title} onChange={setTitle} />
        </div>
        <OfferField label="Proposed start date" type="date" value={startDate} onChange={setStartDate} />
        <OfferField label="Fee %" value={feePct} onChange={setFeePct} placeholder="25" />
        <OfferField label="Min fee" value={minFee} onChange={setMinFee} placeholder="20000 (optional)" />
        <OfferField
          label="Fee amount (flat, overrides calc)"
          value={feeAmountOverride}
          onChange={setFeeAmountOverride}
          placeholder="7500 (wins over salary × fee %)"
        />
        <label className="block text-sm sm:col-span-2">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full resize-vertical rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </label>
      </div>
      <div className="mt-3 rounded-lg border border-court-border/40 bg-court-surface-subtle/40 p-3">
        <div className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          {usedOverride ? "Fee (flat override)" : "Calculated fee"}
        </div>
        <div className="mt-1 font-serif text-2xl font-semibold text-court-fg">
          {formatMoney(feeTotal, currency)}
          {usedMinFee && <span className="ml-2 text-xs text-amber-700">(min fee applied)</span>}
          {usedOverride && <span className="ml-2 text-xs text-brand-dark">(flat override)</span>}
        </div>
        {usedOverride ? (
          <div className="mt-1 text-xs text-court-fg-muted">
            Flat-fee amount; salary × fee % calc is ignored while this is set.
          </div>
        ) : salaryNum && pctNum ? (
          <div className="mt-1 text-xs text-court-fg-muted">
            {formatMoney(salaryNum, currency)} × {pctNum}% = {formatMoney(rawFee, currency)}
          </div>
        ) : (
          <div className="mt-1 text-xs text-court-fg-muted">
            Enter salary + fee % to calculate, or type a flat fee amount above.
          </div>
        )}
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
    </ModalShell>
  );
}

function OfferField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "date";
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}

// Local parser so the offer dialog doesn't have to import the RF flow's
// parseCompensation. Accepts "120000", "120,000", "120k", "$120,000".
function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[$,\s]/g, "").toLowerCase();
  const kMatch = cleaned.match(/^(\d+(?:\.\d+)?)k$/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.round(num);
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase().slice(0, 3) || "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toLocaleString()}`;
  }
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
      void triggerCalendarSync(router);
      void upsertInterviewReminder(interview.id);
    });
  }

  return (
    <ModalShell
      title="Reschedule interview"
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={onSave} saving={isPending} label="Reschedule" />}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Date &amp; time</span>
          <DateTime15Picker
            value={scheduledAt}
            onChange={setScheduledAt}
            className="mt-1"
            blockPast
          />
        </label>
        <DurationSelect value={durationMin} onChange={setDurationMin} />
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
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
  // Renders directly under the Type select. Used by the schedule flow
  // to surface the "Open meeting (anyone can join)" checkbox only when
  // type === "video"; the client-scheduled tracking flow leaves it
  // empty since no Meet is created on its behalf.
  typeExtras?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Date &amp; time</span>
          {/* blockPast keeps past dates out of the picker — past
              interviews are scheduled via Reschedule from the activity
              panel, never from a fresh Schedule click. */}
          <DateTime15Picker
            value={props.scheduledAt}
            onChange={props.setScheduledAt}
            className="mt-1"
            blockPast
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
          <option value="video">Video</option>
          <option value="in_person">In-Person</option>
        </select>
      </label>
      {props.typeExtras}
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
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // Portal to document.body. ModalShell is mounted inside LocalProfile's
  // sticky pipeline wrapper, which uses `backdrop-blur` →
  // `backdrop-filter: blur(...)`. Per spec, an element with
  // `backdrop-filter !== none` (also transform / filter / perspective /
  // will-change / contain) becomes the containing block for any
  // `position: fixed` descendant — so without the portal, the overlay's
  // `inset-0` resolved against that short sticky box instead of the
  // viewport and the modal header sat above the screen top. Mirrors the
  // pattern used by the shared Modal in placement-flows.tsx. SSR-safe.
  if (typeof document === "undefined") return null;
  return createPortal(
    // Two-layer overlay: outer fixed container handles the dim backdrop
    // and provides a scroll fallback if the panel ever does exceed the
    // viewport; inner min-h-full flex wrapper centers the panel inside
    // the available space without single-layer flex pushing the top
    // off-screen. p-4 sm:p-6 + responsive max-h give a guaranteed
    // breathing margin from the viewport edge at both breakpoints.
    <div
      className="fixed inset-0 z-[200] overflow-y-auto bg-ink/40 p-4 sm:p-6"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center">
        {/* Flex-column shell capped at viewport height so header +
            scrollable body + footer together can never exceed the
            screen. Header and footer are flex-none so the title and
            action buttons stay pinned; the body gets flex-1 + min-h-0
            so it shrinks and scrolls internally. */}
        <div
          className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-xl max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-none items-start justify-between border-b border-court-border px-5 py-3">
            <div>
              <h2 className="font-serif text-lg font-semibold text-court-fg">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-court-fg-muted">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
          {footer && (
            <div className="flex flex-none items-center justify-end gap-2 border-t border-court-border bg-court-surface px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
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
  // Returns just the two buttons — the parent ModalShell's footer slot
  // provides the wrapper (border-t, padding, justify-end, gap). Keeping
  // this as a Fragment lets the slot pin the buttons as flex-none below
  // the scrollable body, so action buttons stay visible regardless of
  // how far the body has scrolled.
  return (
    <>
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
        className="inline-flex items-center gap-1 rounded-md border border-court-brand bg-court-brand-tint px-4 py-2 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarClock className="h-3 w-3" />}
        {label}
      </button>
    </>
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
  onClose,
  onBack,
  onSent,
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
  onClose: () => void;
  onBack?: () => void;
  onSent: () => void;
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
  // Active client-side template wins when seeded; otherwise the
  // hardcoded composer default kicks in. Merge fields resolve against
  // the same values map either way so [Job Title] / [Candidate Full
  // Name] populate consistently.
  const fallbackSubject =
    `${formatType(invite.type)} Interview - ${candidateName || "Candidate"} - ${invite.jobTitle}`;
  const fallbackBody =
    `Hi [Client Contact First Name],\n\nConfirming the interview with [Candidate Full Name] for the [Job Title] role. ` +
    `The calendar invite is on its way.\n\n` +
    `• When: [Interview Date Time]\n• Duration: [Interview Duration]\n• Format: [Interview Type]${addrLine}${meetLine}\n\n` +
    `Reply to this email if anything needs to change.`;
  const subject = applyMergeFieldsClient(invite.clientTemplate?.subject ?? fallbackSubject, values);
  const body = applyMergeFieldsClient(invite.clientTemplate?.body ?? fallbackBody, values);
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
      onClose={onClose}
      onBack={onBack}
      backLabel="Back to candidate"
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
        onSent();
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
  onClose,
  onBack,
  onSent,
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
  onClose: () => void;
  onBack?: () => void;
  onSent: () => void;
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
  // Active candidate-prep template wins when seeded; otherwise the
  // generic hardcoded default applies (keeps client's name off the
  // candidate's shared calendar).
  const fallbackSubject = `${formatType(invite.type)} Interview - BreakPoint Talent`;
  const fallbackBody =
    `Hi [Candidate First Name],\n\nYou are confirmed for your [Interview Type] interview with [Client Company Name] ` +
    `for the [Job Title] role. The calendar invite is on its way.\n\n` +
    `• When: [Interview Date Time]\n• Duration: [Interview Duration]\n• Format: [Interview Type]${addrLine}${meetLine}\n\n` +
    `Good luck!`;
  const subject = applyMergeFieldsClient(invite.candidateTemplate?.subject ?? fallbackSubject, values);
  const body = applyMergeFieldsClient(invite.candidateTemplate?.body ?? fallbackBody, values);
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
      onClose={onClose}
      onBack={onBack}
      backLabel="Back to schedule"
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
        onSent();
      }}
    />
  );
}
