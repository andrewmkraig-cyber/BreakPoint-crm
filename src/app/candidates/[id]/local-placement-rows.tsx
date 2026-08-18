"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  DollarSign,
  Edit3,
  Handshake,
  Image as ImageIcon,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  UserX,
  X,
} from "lucide-react";
import {
  reapplyLocalPlacement,
  recordLocalOffer,
  recordLocalPlacement,
  rejectLocalPlacement,
} from "@/app/candidates/[id]/local-placement-actions";
// cancelPlacement still lives on the legacy placement-actions module (it
// was hardened in place — added org-scope lookup + revalidatePlacementSurfaces
// — rather than duplicated onto the Ace-native module). The Cancel button
// in LocalPlacementDialog imports from here.
import { cancelPlacement } from "@/app/candidates/[id]/placement-actions";
import { DismissPlacementButton } from "@/app/candidates/[id]/dismiss-placement-button";
import { toast } from "sonner";
import { RejectCandidateDialog } from "@/components/reject-candidate-dialog";
import { Button } from "@/components/ui/button";
import {
  getInterviewSchedulingTemplates,
  scheduleInterview,
  updateInterview,
  sendInterviewInvite,
  cancelInterview,
  upsertInterviewReminder,
  type InterviewType,
  type MeetingProvider,
} from "@/app/candidates/[id]/interview-actions";
import { MaskedCurrencyInput } from "@/components/ui/masked-currency-input";
import { DateTime15Picker } from "@/components/datetime-15-picker";
import { MeetingProviderSelect } from "@/components/meeting-provider-select";
import {
  CcBccPicker,
  ConfirmStartDialog,
  DurationSelect,
  InlineContactMultiInput,
  parseEmailCsv,
} from "@/components/placements/placement-shared";
import { triggerCalendarSync } from "@/lib/calendar/trigger-sync";
import {
  applyMergeFields as applyMergeFieldsClient,
  buildSmartGreeting,
  htmlToReadableText,
  MERGE_FIELDS,
  type MergeFieldValues,
} from "@/lib/merge-fields";
// Canonical Lead Source options — shared with the RF PlacementDialog,
// the /pipeline placement-edit-drawer, and the Financial Performance
// By Source widget so all four surfaces agree on the bucket set. Added
// to LocalPlacementDialog 2026-05-27 (Ace 67.17) — the 67.12 dropdown
// shipped to the wrong file (placement-flows.tsx PlacementDialog, RF
// flow); this file is the modal the recruiter actually uses.
import { LEAD_SOURCES } from "@/lib/lead-sources";
import {
  INTERVIEW_TIMEZONES,
  DEFAULT_INTERVIEW_TIMEZONE,
  abbrForTimeZone,
  wallClockInZoneToUTC,
  utcToWallClockInZone,
} from "@/lib/timezones";
import {
  formatInterviewDate,
  formatInterviewTime,
  formatInterviewWhen,
} from "@/lib/interview-format";
import { StageBadge } from "@/components/stage-badge";
import type { PipelineBucket } from "@/lib/rf-payload-shapes";
import { cn } from "@/lib/utils";
import {
  HOURS_PER_YEAR_FOR_HOURLY_PLACEMENT,
  formatPlacementCompensation,
  normalizePlacementCompensationType,
  placementFeeBasisAmount,
  type PlacementCompensationType,
} from "@/lib/placement-compensation";
import {
  useDraggableResizable,
  MODAL_MIN_W,
  MODAL_MIN_H,
} from "@/lib/use-draggable-resizable";

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
  // In-person street address (Interview.location), so edit mode can re-seed it.
  location: string | null;
  // 2b-ii: the stored "what the recipient saw" sent copies (D1), threaded so
  // the edit scheduler pre-fills each party's subject/body with what actually
  // went out. The *Invited booleans (derived from the sent*At delivery flags)
  // tell edit mode which party editors to render. Bodies may be HTML — the
  // editor cleans them through htmlToReadableText on seed.
  sentClientSubject: string | null;
  sentClientBody: string | null;
  sentCandidateSubject: string | null;
  sentCandidateBody: string | null;
  clientInvited: boolean;
  candidateInvited: boolean;
};

// Slim snapshot of the placement row's seed values used by the
// late-pipeline dialogs (Edit Offer / Make Placement / Edit Placement).
// Optional + nullable across the board because most fields are only
// populated once the candidate has actually moved past the early
// stages — early-stage rows (sourced / applied / kept / submitted)
// carry no offer or placement data yet.
export type LocalPlacementSnapshot = {
  offerSalary: number | null;
  offerCompensationType: PlacementCompensationType | null;
  offerCurrency: string | null;
  offerTitle: string | null;
  offerStartDate: string | null;
  offerNotes: string | null;
  acceptedSalary: number | null;
  acceptedCompensationType: PlacementCompensationType | null;
  acceptedCurrency: string | null;
  feePercentage: number | null;
  feeTotal: number | null;
  minFee: number | null;
  guaranteePeriodDays: number | null;
  billingContactName: string | null;
  billingContactEmail: string | null;
  hiringManagerName: string | null;
  hiringManagerEmail: string | null;
  // Full multi-contact lists. Preferred seed source for the placement
  // dialog's billing / hiring pickers; the legacy single columns above are
  // the fallback for rows saved before the list was restored.
  billingContacts?: { name: string; email: string }[] | null;
  hiringContacts?: { name: string; email: string }[] | null;
  expectedStartDate: string | null;
  placementNotes: string | null;
  candidateSource: string | null;
  // Custom Payment Agreement (mirrors the /pipeline placement-edit drawer).
  // Lets the candidate-profile Edit Placement dialog re-seed + edit the
  // same custom-installment terms instead of opening a stripped version.
  // customGuaranteeDate is an ISO string (date portion sliced for the
  // <input type="date">), matching expectedStartDate's serialization.
  useCustomTerms?: boolean | null;
  installmentCount?: number | null;
  inst1Amount?: number | null;
  inst1DaysAfterStart?: number | null;
  inst2Amount?: number | null;
  inst2DaysAfterStart?: number | null;
  inst3Amount?: number | null;
  inst3DaysAfterStart?: number | null;
  customGuaranteeDate?: string | null;
};

export type LocalJobRow = {
  placementId: string;
  jobRfId: number;
  jobCuid?: string | null;
  jobTitle: string;
  jobLocation: string;
  // "(X.X mi)" candidate→job distance, computed server-side in
  // local-profile.tsx (Item 1B). null when the candidate has no lat/lng
  // or the job location can't be geocoded — the pill shows no distance.
  distance?: string | null;
  jobDescription: string;
  jobSalaryRange: string;
  clientRfId: number;
  clientCuid?: string | null;
  clientName: string;
  clientWebsite: string;
  clientLinkedIn: string;
  clientContacts: { id: number; name: string; title: string; email: string }[];
  // Client fee % (annual base × %). Seed source for OfferDialog +
  // LocalPlacementDialog. Null when no fee % is on file for the
  // client; the dialogs fall back to an empty input.
  clientFeePct: number | null;
  stage: string;
  interviews: LocalInterview[];
  // Populated once the placement has been through offer / placement
  // edits so the late-stage dialogs can seed their form fields. null
  // for early-stage rows (sourced / applied / kept / submitted) where
  // none of these columns have been written yet.
  placement?: LocalPlacementSnapshot | null;
  // True when this placement has a sealed start-confirmation screenshot
  // (Placement.startConfirmationFile != null). Lightweight boolean only —
  // the bytes never ship into the page payload; the image loads on demand
  // from /api/placement-screenshot/<placementId> when the recruiter clicks
  // "View start confirmation".
  hasStartConfirmation: boolean;
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
  // IANA timezone the recruiter picked on the schedule dialog.
  // Threaded into the invite composers so candidate-facing copy can
  // tag every time with the picked zone's abbreviation (ET/CT/MT/PT).
  timeZone: string;
  // Pre-fetched interview-scheduled templates; null per side means the
  // composer falls back to its hardcoded default. Mirrors the RF flow's
  // InviteFlowState shape so both surfaces stay in sync.
  candidateTemplate: { subject: string; body: string } | null;
  clientTemplate: { subject: string; body: string } | null;
};

type CelebrationOrigin = {
  left: number;
  top: number;
  width: number;
  height: number;
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
  // Make Placement modal (offer → pending_start) + Confirm Start
  // (pending_start → hired). Both keyed by the LocalJobRow so the
  // dialog can seed from job.placement and revalidatePath knows
  // which candidate URL to refresh.
  const [placementFor, setPlacementFor] = useState<LocalJobRow | null>(null);
  const [confirmFor, setConfirmFor] = useState<LocalJobRow | null>(null);
  // 2b-ii: edit an existing interview through the one-screen scheduler. Holds
  // both the interview and its owning job row (the scheduler needs the job for
  // client contacts + header). Replaces the retired RescheduleDialog.
  const [editInterview, setEditInterview] = useState<{
    interview: LocalInterview;
    job: LocalJobRow;
  } | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
          // Optimistic stub for the freshly-applied pill — the
          // OfferDialog isn't reachable from this row state (Applied
          // stage hasn't moved past Submitted), so leaving feePct null
          // is safe; the 500ms router.refresh in local-candidate-actions
          // replaces this row with the server-side shape that carries
          // the real value.
          clientFeePct: null,
          clientContacts: detail.clientContacts,
          stage: "applied",
          interviews: [],
          // Freshly-applied stub — no placement sealed yet, so never a
          // start-confirmation screenshot. The router.refresh swap lands
          // the real flag.
          hasStartConfirmation: false,
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

  // Deep-link handlers for the /pipeline page's per-row Make Placement
  // and Confirm Start buttons. Format mirrors the RF candidate-profile
  // flow:
  //   ?edit=placement&jobId=<rfId-or-zero>
  //   ?confirmStart=1&jobId=<rfId-or-zero>
  // We match jobs by jobRfId so the RF + Ace-native deep links share
  // one handler. If the recruiter lands on a candidate whose row isn't
  // at the expected stage (e.g. the page cache is stale), the dialog
  // still opens — recordLocalPlacement / confirmStart validate stage
  // server-side and surface a clean toast on mismatch.
  useEffect(() => {
    const edit = searchParams?.get("edit");
    const jobIdRaw = searchParams?.get("jobId");
    if (edit !== "placement" || !jobIdRaw) return;
    const jobId = Number(jobIdRaw);
    if (!Number.isFinite(jobId)) return;
    const target = jobsState.find((j) => j.jobRfId === jobId);
    if (!target) return;
    setPlacementFor(target);
    // Strip the params so a back-nav / refresh doesn't re-fire the
    // modal — same scrub pattern the RF flow uses.
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("edit");
    next.delete("jobId");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchParams, pathname, router, jobsState]);

  useEffect(() => {
    const flag = searchParams?.get("confirmStart");
    const jobIdRaw = searchParams?.get("jobId");
    if (flag !== "1" || !jobIdRaw) return;
    const jobId = Number(jobIdRaw);
    if (!Number.isFinite(jobId)) return;
    const target = jobsState.find((j) => j.jobRfId === jobId);
    if (!target) return;
    setConfirmFor(target);
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("confirmStart");
    next.delete("jobId");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchParams, pathname, router, jobsState]);

  // Deep-link for the Pipeline page's Edit Offer button (Ace fix 2026-05-27).
  // Format is ?edit=offer&jobId=NN — mirrors the ?edit=placement handler above
  // so Ace-native rows in the offer stage can be edited from /pipeline. The
  // OfferDialog seeds every field off job.placement?.* when present, so the
  // recruiter sees the saved offer values without re-typing.
  useEffect(() => {
    const edit = searchParams?.get("edit");
    const jobIdRaw = searchParams?.get("jobId");
    if (edit !== "offer" || !jobIdRaw) return;
    const jobId = Number(jobIdRaw);
    if (!Number.isFinite(jobId)) return;
    const target = jobsState.find((j) => j.jobRfId === jobId);
    if (!target) return;
    setOfferFor(target);
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("edit");
    next.delete("jobId");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchParams, pathname, router, jobsState]);

  // Deep-link for the Pipeline page's per-row Schedule chip (Ace 68.0).
  // Format is ?schedule=interview&jobId=NN — mirrors the ?edit=placement
  // handler above so the Submitted + Interviewing tabs can pop the
  // schedule modal directly from /pipeline without an extra click on
  // the candidate profile.
  useEffect(() => {
    const flag = searchParams?.get("schedule");
    const jobIdRaw = searchParams?.get("jobId");
    if (flag !== "interview" || !jobIdRaw) return;
    const jobId = Number(jobIdRaw);
    if (!Number.isFinite(jobId)) return;
    const target = jobsState.find((j) => j.jobRfId === jobId);
    if (!target) return;
    setScheduleFor(target);
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("schedule");
    next.delete("jobId");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchParams, pathname, router, jobsState]);

  // D2: deep-link for the calendar event Edit button + the This Week widget
  // click. Both route here via ?edit=interview&interviewId=<cuid> so the
  // single edit scheduler opens in place, pre-filled for that interview —
  // replacing D1's plain navigate-to-profile. Find the matching interview
  // across every job pill's interviews[].
  useEffect(() => {
    const edit = searchParams?.get("edit");
    const interviewId = searchParams?.get("interviewId");
    if (edit !== "interview" || !interviewId) return;
    let target: { interview: LocalInterview; job: LocalJobRow } | null = null;
    for (const j of jobsState) {
      const iv = j.interviews.find((x) => x.id === interviewId);
      if (iv) {
        target = { interview: iv, job: j };
        break;
      }
    }
    if (!target) return;
    setEditInterview(target);
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("edit");
    next.delete("interviewId");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchParams, pathname, router, jobsState]);

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
            onPlacement={() => setPlacementFor(j)}
            onConfirmStart={() => setConfirmFor(j)}
            onEditInterview={(iv) => setEditInterview({ interview: iv, job: j })}
            onStageChange={handleStageChanged}
            embed={embed}
          />
        ))}
      </div>

      {scheduleFor && (
        // Ace E: ONE scrolling screen replaces the old Schedule modal +
        // the two stacked invite composers + the inviteFlow step machine.
        // It schedules and fires whichever invite toggles are on in a
        // single Send, reusing scheduleInterview + sendInterviewInvite.
        <ScheduleInterviewScreen
          candidateId={candidateId}
          candidateName={candidateName}
          candidate={{
            firstName: candidateName.split(/\s+/)[0] ?? candidateName,
            lastName: candidateName.split(/\s+/).slice(1).join(" "),
            email: candidateEmail,
            phone: candidatePhone,
            location: candidateLocation,
            currentTitle: candidateCurrentTitle,
            currentEmployer: candidateCurrentEmployer,
          }}
          candidateEmail={candidateEmail}
          recruiter={recruiter}
          job={scheduleFor}
          onClose={() => setScheduleFor(null)}
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
      {placementFor && (
        <LocalPlacementDialog
          job={placementFor}
          onClose={() => setPlacementFor(null)}
          onSaved={() => {
            handleStageChanged(placementFor.jobRfId, "pending_start");
            setPlacementFor(null);
          }}
          onCancelled={() => {
            // Cancel stamps the optimistic stage as "cancelled" (NOT the
            // save path's "pending_start"), so the pill flips straight to
            // "Placement Cancelled" with the cancelled button set and the
            // soft router.refresh() reconciles cleanly — the held
            // "cancelled" matches the server "cancelled" cancelPlacement
            // writes, so the pendingStages hold releases without a hard
            // reload (see handleStageChanged + the jobs-mirror effect).
            handleStageChanged(placementFor.jobRfId, "cancelled");
            setPlacementFor(null);
          }}
        />
      )}
      {confirmFor && (
        // ConfirmStartDialog is shared with the RF flow — it operates
        // on placementId, so it Just Works for Ace-native rows too.
        // onEditPlacement chains into our local PlacementDialog (the
        // RF-side dialog won't open Ace-native placements correctly).
        <ConfirmStartDialog
          placementId={confirmFor.placementId}
          jobTitle={confirmFor.jobTitle}
          onClose={() => setConfirmFor(null)}
          onEditPlacement={() => {
            const job = confirmFor;
            setConfirmFor(null);
            setPlacementFor(job);
          }}
        />
      )}
      {editInterview && (
        // 2b-ii: edit runs through the SAME one-screen scheduler, pre-filled.
        <ScheduleInterviewScreen
          candidateId={candidateId}
          candidateName={candidateName}
          candidate={{
            firstName: candidateName.split(/\s+/)[0] ?? candidateName,
            lastName: candidateName.split(/\s+/).slice(1).join(" "),
            email: candidateEmail,
            phone: candidatePhone,
            location: candidateLocation,
            currentTitle: candidateCurrentTitle,
            currentEmployer: candidateCurrentEmployer,
          }}
          candidateEmail={candidateEmail}
          recruiter={recruiter}
          job={editInterview.job}
          existingInterview={editInterview.interview}
          onClose={() => setEditInterview(null)}
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
  onPlacement,
  onConfirmStart,
  onEditInterview,
  onStageChange,
  embed,
}: {
  candidateId: string;
  candidateName: string;
  job: LocalJobRow;
  onSchedule: () => void;
  onOffer: () => void;
  // Opens LocalPlacementDialog. Used by:
  //   - Make Placement on a stage="offer" row (recruiter is recording
  //     the offer acceptance → moves to pending_start).
  //   - Edit Placement on a stage="pending_start" or "hired" row
  //     (recruiter is amending fee / start date / billing contacts).
  onPlacement: () => void;
  // Opens ConfirmStartDialog (the screenshot dropzone). Used by Confirm
  // Start on stage="pending_start" rows.
  onConfirmStart: () => void;
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
  // Schedule disappears once the candidate is past the interviewing
  // window — offer / pending_start / hired rows surface their own
  // forward-action buttons (Make Placement / Confirm Start / Edit
  // Placement) and re-scheduling from those stages is unusual. Earlier
  // stages (sourced / applied / kept / submitted / interviewing) keep
  // Schedule as the natural next action.
  const canSchedule =
    normalizedStage === "sourced" ||
    normalizedStage === "applied" ||
    normalizedStage === "kept" ||
    normalizedStage === "submitted" ||
    normalizedStage === "interviewing";
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
  // kept, and already-rejected rows don't show it. Pending Start
  // intentionally drops Reject too — rejecting a placed candidate
  // happens via the Cancel-Placement flow, not a stage flip.
  const canReject =
    normalizedStage === "applied" ||
    normalizedStage === "submitted" ||
    normalizedStage === "interviewing" ||
    normalizedStage === "offer";

  // Extend Offer is interviewing-only: the recruiter has met the
  // client + candidate, and the offer is the next forward action.
  // Mirrors the "Offer" button in the Job-page Pipeline rows
  // (see PipelineRowActions, case "interviewing"). The "Client
  // Sending Invite" shortcut that used to live here is now folded
  // into the schedule modal as a "Client will send invite" checkbox.
  const canExtendOffer = normalizedStage === "interviewing";

  // Late-pipeline forward-action buttons. Mirrors PipelineRowActions
  // cases "offer" / "pending_start" / "hired" so the pill on the
  // candidate profile matches what /jobs/[id] and /pipeline render
  // for the same stage. Without these the Ace-native pill silently
  // dead-ended at "Schedule Interview / Reject" once the candidate
  // hit the offer stage — the user couldn't record a placement at
  // all.
  const canEditOffer = normalizedStage === "offer";
  const canMakePlacement = normalizedStage === "offer";
  const canEditPlacement =
    normalizedStage === "pending_start" || normalizedStage === "hired";
  const canConfirmStart = normalizedStage === "pending_start";

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
  // The Edit Interview button only targets an UPCOMING interview. Once an
  // interview's scheduled time has passed (it has taken place) there is nothing
  // left to reschedule, so the button disappears until another interview is
  // booked — at which point nextInterview is set again and Edit returns.
  const editableInterview = nextInterview;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Briefcase className="h-3 w-3 shrink-0 text-court-fg-muted" />
          <span className="truncate text-sm font-medium text-court-fg">{job.jobTitle}</span>
          {job.clientName && (
            <span className="truncate text-xs text-court-fg-muted">· {job.clientName}</span>
          )}
          {job.distance && (
            <span className="shrink-0 text-xs text-court-fg-muted">{job.distance}</span>
          )}
          <StageBadge bucket={normalizedStage as PipelineBucket} />
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
              <span className="hidden sm:inline">Schedule</span>
            </Button>
          )}
          {editableInterview && (
            // Sits between Schedule and Offer. Mirrors the Edit Offer chip
            // (secondary outline + Edit3 pencil = edit semantic, Icon Color
            // rule) so all "Edit X" pill actions read alike. Opens the
            // one-screen scheduler in edit mode (existingInterview path),
            // pre-filled for this interview — not the retired reschedule
            // dialog. Schedule stays for booking an additional interview.
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onEditInterview(editableInterview)}
              title="Edit this interview"
              className={CHIP_BTN_CLS}
            >
              <Edit3 className="h-3 w-3" />
              <span className="hidden sm:inline">Edit Interview</span>
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
          {canEditOffer && (
            // Edit Offer surfaces on stage=offer so the recruiter can
            // amend salary / fee / start date before recording the
            // placement. Reuses the OfferDialog (same upsert path) so
            // there's no second editor to maintain.
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onOffer}
              title="Edit offered compensation, title, or start date"
              className={CHIP_BTN_CLS}
            >
              <Edit3 className="h-3 w-3" />
              <span className="hidden sm:inline">Edit Offer</span>
            </Button>
          )}
          {canMakePlacement && (
            // Make Placement = offer accepted → stage=pending_start.
            // Opens LocalPlacementDialog which captures the accepted
            // salary + fee + start date + billing/hiring contacts that
            // the invoicing pipeline downstream needs. The user can't
            // proceed past offer without this button — every later
            // stage (Confirm Start, Hired, invoice generation) reads
            // off the fields this dialog writes.
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={onPlacement}
              title="Record this candidate as placed"
              className={CHIP_BTN_CLS}
            >
              <Handshake className="h-3 w-3" />
              <span className="hidden sm:inline">Placement</span>
            </Button>
          )}
          {canEditPlacement && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onPlacement}
              title="Edit placement details"
              className={CHIP_BTN_CLS}
            >
              <Edit3 className="h-3 w-3" />
              <span className="hidden sm:inline">Edit Placement</span>
            </Button>
          )}
          {canConfirmStart && (
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={onConfirmStart}
              title="Upload a Day-1 screenshot to confirm the candidate started"
              className={CHIP_BTN_CLS}
            >
              <CheckCircle2 className="h-3 w-3" />
              <span className="hidden sm:inline">Confirm Start</span>
            </Button>
          )}
          {job.hasStartConfirmation && (
            // Read-only: surfaces the proof-of-start screenshot the
            // recruiter uploaded when sealing the placement. Opens the
            // already-existing org-scoped retrieval route in a new tab so
            // the bytes stream on demand (never in the page payload).
            // Outlined secondary chip to match the Button Standard.
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                window.open(
                  `/api/placement-screenshot/${job.placementId}`,
                  "_blank",
                  "noopener,noreferrer",
                )
              }
              title="View the start-confirmation screenshot on file"
              className={CHIP_BTN_CLS}
            >
              <ImageIcon className="h-3 w-3" />
              <span className="hidden sm:inline">View start confirmation</span>
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

// Interview date/time no longer renders on the job pill — the next-upcoming
// interview is still tracked (see `nextInterview` in LocalJobActionRow) only
// to gate the Edit Interview button; the date/time itself lives in the
// schedule/edit modal and on /calendar, not on the pill title line.

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
  // Seed from placement snapshot so Edit Offer (Ace fix 2026-05-27: now
  // surfaced as a chip on /pipeline) reopens with the saved values instead
  // of a blank form. Fresh-offer flow still gets "" / job.jobTitle defaults
  // because pre-offer rows carry placement=null. Mirrors how the RF
  // OfferDialog (placement-flows.tsx) seeds its state.
  const snap = job.placement ?? null;
  const [salary, setSalary] = useState(
    snap?.offerSalary != null ? String(snap.offerSalary) : "",
  );
  const [compensationType, setCompensationType] = useState<PlacementCompensationType>(
    normalizePlacementCompensationType(snap?.offerCompensationType),
  );
  // USD is the only allowed currency on offer rows (Ace fix 2026-05-27).
  // The dropdown was removed but offerCurrency / acceptedCurrency are still
  // written to the DB on save — held as a const here so the save payload and
  // formatMoney calls keep their "USD" arg without an unused setter.
  const currency = "USD";
  const [title, setTitle] = useState(snap?.offerTitle ?? job.jobTitle);
  const [startDate, setStartDate] = useState(
    snap?.offerStartDate ? snap.offerStartDate.slice(0, 10) : "",
  );
  const [notes, setNotes] = useState(snap?.offerNotes ?? "");
  // Three-way feePct seed mirrors the RF OfferDialog at
  // placement-flows.tsx:1197 — placement snapshot takes precedence
  // (Edit Offer / Make Placement re-open scenarios) so the recruiter
  // never sees a fresh-typed override blown away by the client default.
  // Client default fills in for the fresh-offer path. Empty string
  // when neither source carries a value.
  const seedFeePct = snap?.feePercentage ?? job.clientFeePct ?? null;
  const [feePct, setFeePct] = useState(seedFeePct != null ? String(seedFeePct) : "");
  const [minFee, setMinFee] = useState(
    snap?.minFee != null ? String(snap.minFee) : "",
  );
  const [feeAmountOverride, setFeeAmountOverride] = useState(
    seedFlatFeeOverrideFromSnapshot({
      amount: snap?.offerSalary ?? null,
      compensationType,
      feePercentage: seedFeePct,
      feeTotal: snap?.feeTotal ?? null,
    }),
  );
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  const salaryNum = parseCompensationAmount(salary);
  const pctNum = parseFloat(feePct) || 0;
  const minFeeNum = parseAmount(minFee);
  const overrideNum = parseAmount(feeAmountOverride);
  const feeBasisAmount = placementFeeBasisAmount(salaryNum, compensationType);
  const rawFee = feeBasisAmount && pctNum ? Math.round(feeBasisAmount * (pctNum / 100)) : 0;
  // Fee resolution priority matches the RF OfferDialog: override > min-vs-calc > calc.
  const calcFee = minFeeNum && rawFee < minFeeNum ? minFeeNum : rawFee;
  const feeTotal = overrideNum != null ? overrideNum : calcFee;
  const usedMinFee = overrideNum == null && minFeeNum != null && rawFee < minFeeNum;
  const usedOverride = overrideNum != null;

  function onSave() {
    setErr(null);
    if (salaryNum != null && salaryNum < 0) return setErr("Compensation can't be negative.");
    if (overrideNum != null && overrideNum < 0) return setErr("Fee amount can't be negative.");
    if (minFeeNum != null && minFeeNum < 0) return setErr("Minimum fee can't be negative.");
    if (pctNum < 0) return setErr("Fee percentage can't be negative.");
    if (feeTotal <= 0) {
      return setErr("Fee amount is required at this stage — enter compensation + fee %, or a flat amount.");
    }
    startSave(async () => {
      const result = await recordLocalOffer({
        placementId: job.placementId,
        salary: salaryNum,
        compensationType,
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
      footer={<Footer onCancel={onClose} onSave={onSave} saving={isPending} label="Record Offer" />}
      // Lock to X / Cancel close. Stray backdrop click or Escape press
      // shouldn't be able to throw away half-filled offer fields.
      dismissOnOverlay={false}
      // Ace 67.11: draggable header + bottom-right corner resize so the
      // recruiter can move the offer popup off the candidate row
      // underneath and widen the panel past the default 32rem cap.
      // Matches the RF OfferDialog in placement-flows.tsx so both code
      // paths feel identical.
      draggable
      resizable
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* USD is the only allowed currency on offer rows (Ace fix 2026-05-27).
            The `currency` state still defaults to "USD" and is written to
            Placement.offerCurrency / acceptedCurrency on save — the dropdown
            is gone but the DB column stays populated. The salary + fee $
            Fee % stays a plain field (it takes decimals, not dollars).
            A fresh Make Offer renders all fields blank. */}
        <CompensationField
          label="Offered compensation"
          value={salary}
          onChange={setSalary}
          type={compensationType}
          onTypeChange={setCompensationType}
        />
        <div className="sm:col-span-2">
          <OfferField label="Offered title" value={title} onChange={setTitle} />
        </div>
        <OfferField label="Proposed start date" type="date" value={startDate} onChange={setStartDate} />
        <OfferField
          label="Fee %"
          value={feePct}
          onChange={(v) => setFeePct(v.replace(/-/g, ""))}
        />
        <OfferField label="Min fee" value={minFee} onChange={setMinFee} currency />
        <OfferField
          label="Fee amount (flat, overrides calc)"
          value={feeAmountOverride}
          onChange={setFeeAmountOverride}
          currency
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
            Flat-fee amount; compensation × fee % calc is ignored while this is set.
          </div>
        ) : salaryNum && feeBasisAmount && pctNum ? (
          <div className="mt-1 text-xs text-court-fg-muted">
            {formatFeeBasisForDialog(salaryNum, compensationType, currency)} × {pctNum}% ={" "}
            {formatMoney(rawFee, currency)}
          </div>
        ) : (
          <div className="mt-1 text-xs text-court-fg-muted">
            Enter compensation + fee % to calculate, or type a flat fee amount above.
          </div>
        )}
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
    </ModalShell>
  );
}

// Make Placement / Edit Placement modal for Ace-native rows. Drives the
// offer → pending_start transition (and later edits while in pending_
// start or hired). Slimmer than the RF PlacementDialog — single
// billing contact, single hiring manager, no custom-payment-terms
// drawer. The recruiter can still edit those advanced fields via the
// /pipeline row's full edit drawer once needed.
function LocalPlacementDialog({
  job,
  onClose,
  onSaved,
  onCancelled,
}: {
  job: LocalJobRow;
  onClose: () => void;
  // Fired after recordLocalPlacement resolves so the parent can flip the
  // pill's optimistic stage to "pending_start" without waiting on the
  // revalidatePath round trip.
  onSaved: () => void;
  // Fired after cancelPlacement resolves. Kept separate from onSaved so the
  // cancel path stamps the optimistic stage as "cancelled" instead of the
  // save path's "pending_start" — otherwise the held "pending_start" never
  // matches the server's "cancelled" and the pill is stuck on the wrong
  // stage until a hard reload.
  onCancelled: () => void;
}) {
  const router = useRouter();
  const snap = job.placement ?? null;
  // Seed every field off the placement snapshot when present — the
  // offer dialog wrote most of these at offer time, so the recruiter
  // shouldn't have to re-type them. Fall back to job-level defaults
  // (offerTitle / jobTitle / "USD") only for fresh rows.
  const [acceptedSalary, setAcceptedSalary] = useState(
    snap?.acceptedSalary != null
      ? String(snap.acceptedSalary)
      : snap?.offerSalary != null
        ? String(snap.offerSalary)
        : "",
  );
  const [acceptedCompensationType, setAcceptedCompensationType] =
    useState<PlacementCompensationType>(
      normalizePlacementCompensationType(
        snap?.acceptedCompensationType ?? snap?.offerCompensationType,
      ),
    );
  // USD is the only allowed currency on placement rows (Ace fix 2026-06-09).
  // Mirrors the Offer row above: the free-text Currency field was removed but
  // acceptedCurrency is still written to the DB on save — held as a const here
  // so the save payload and formatMoney calls keep their "USD" arg without an
  // unused setter.
  const currency = "USD";
  // Same three-way seed as the OfferDialog above — snapshot first
  // (Edit Placement re-open), then the client default, then blank.
  // Matches the RF LocalPlacementDialog at placement-flows.tsx:1460.
  const seedFeePct = snap?.feePercentage ?? job.clientFeePct ?? null;
  const [feePct, setFeePct] = useState(seedFeePct != null ? String(seedFeePct) : "");
  const [minFee, setMinFee] = useState(
    snap?.minFee != null ? String(snap.minFee) : "",
  );
  const [feeAmountOverride, setFeeAmountOverride] = useState(
    seedFlatFeeOverrideFromSnapshot({
      amount:
        snap?.acceptedSalary != null
          ? snap.acceptedSalary
          : snap?.offerSalary != null
            ? snap.offerSalary
            : null,
      compensationType: acceptedCompensationType,
      feePercentage: seedFeePct,
      feeTotal: snap?.feeTotal ?? null,
    }),
  );
  const [guaranteeDays, setGuaranteeDays] = useState(
    snap?.guaranteePeriodDays != null ? String(snap.guaranteePeriodDays) : "",
  );
  // expectedStartDate seeds from the existing placement snapshot first,
  // then falls back to the offerStartDate the OfferDialog stamped — so
  // the recruiter sees the date they originally proposed without
  // re-typing it. ISO comes in as a full timestamp; slice the date
  // portion for the <input type="date"> value.
  const [startDate, setStartDate] = useState(() => {
    const iso = snap?.expectedStartDate ?? snap?.offerStartDate ?? null;
    return iso ? iso.slice(0, 10) : "";
  });
  // Multi-contact billing + hiring lists (restored Ace fix 2026-06-01). Seed
  // priority: saved JSON list -> legacy single column -> one blank row so the
  // section always has a slot. Each row carries a stable local key so Add /
  // Remove doesn't lose input focus on re-render.
  const [billingContacts, setBillingContacts] = useState<ContactRow[]>(() => {
    const seeded = seedContactList(
      snap?.billingContacts ?? null,
      snap?.billingContactName ?? null,
      snap?.billingContactEmail ?? null,
    );
    return seeded.length > 0 ? seeded : [{ key: makeLocalKey(), name: "", email: "" }];
  });
  const [hiringContacts, setHiringContacts] = useState<ContactRow[]>(() => {
    const seeded = seedContactList(
      snap?.hiringContacts ?? null,
      snap?.hiringManagerName ?? null,
      snap?.hiringManagerEmail ?? null,
    );
    return seeded.length > 0 ? seeded : [{ key: makeLocalKey(), name: "", email: "" }];
  });
  const [notes, setNotes] = useState(snap?.placementNotes ?? snap?.offerNotes ?? "");
  const [source, setSource] = useState(snap?.candidateSource ?? "");
  // Custom Payment Agreement — full parity with the /pipeline Hired drawer
  // (Ace fix 2026-06-01). Seeded from the placement snapshot so re-opening
  // Edit Placement shows the saved installment schedule + custom guarantee
  // date instead of a stripped version.
  const [useCustomTerms, setUseCustomTerms] = useState<boolean>(
    snap?.useCustomTerms ?? false,
  );
  const [installmentCount, setInstallmentCount] = useState<1 | 2 | 3>(
    snap?.installmentCount === 2 || snap?.installmentCount === 3
      ? snap.installmentCount
      : 1,
  );
  const [inst1Amount, setInst1Amount] = useState(
    snap?.inst1Amount != null ? String(snap.inst1Amount) : "",
  );
  const [inst1Days, setInst1Days] = useState(
    snap?.inst1DaysAfterStart != null ? String(snap.inst1DaysAfterStart) : "",
  );
  const [inst2Amount, setInst2Amount] = useState(
    snap?.inst2Amount != null ? String(snap.inst2Amount) : "",
  );
  const [inst2Days, setInst2Days] = useState(
    snap?.inst2DaysAfterStart != null ? String(snap.inst2DaysAfterStart) : "",
  );
  const [inst3Amount, setInst3Amount] = useState(
    snap?.inst3Amount != null ? String(snap.inst3Amount) : "",
  );
  const [inst3Days, setInst3Days] = useState(
    snap?.inst3DaysAfterStart != null ? String(snap.inst3DaysAfterStart) : "",
  );
  const [customGuaranteeDate, setCustomGuaranteeDate] = useState(
    snap?.customGuaranteeDate ? snap.customGuaranteeDate.slice(0, 10) : "",
  );
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();
  // Cancel-placement state. Independent of `isPending` (Save) so the user
  // can't fire both. Pending lights the spinner on the destructive button
  // while the cancelPlacement server action runs.
  const [cancelPending, startCancel] = useTransition();

  const salaryNum = parseCompensationAmount(acceptedSalary);
  const pctNum = parseFloat(feePct) || 0;
  const minFeeNum = parseAmount(minFee);
  const overrideNum = parseAmount(feeAmountOverride);
  const feeBasisAmount = placementFeeBasisAmount(salaryNum, acceptedCompensationType);
  const rawFee = feeBasisAmount && pctNum ? Math.round(feeBasisAmount * (pctNum / 100)) : 0;
  const calcFee = minFeeNum && rawFee < minFeeNum ? minFeeNum : rawFee;
  const feeTotal = overrideNum != null ? overrideNum : calcFee;
  const guaranteeDaysNum = parseAmount(guaranteeDays);
  const usedMinFee = overrideNum == null && minFeeNum != null && rawFee < minFeeNum;
  const usedOverride = overrideNum != null;
  const editing = job.stage === "pending_start" || job.stage === "hired";

  function onSave(origin?: CelebrationOrigin) {
    setErr(null);
    if (salaryNum == null || salaryNum <= 0) {
      return setErr("Accepted compensation is required.");
    }
    if (!startDate) {
      return setErr("Expected start date is required.");
    }
    if (feeTotal <= 0) {
      return setErr("Fee amount is required — enter compensation + fee %, or a flat fee.");
    }
    // Lead Source required (Ace 67.17) so the Financial Performance
    // By Source widget never has to bucket placements as "Unknown".
    // Mirrors the same check the RF PlacementDialog got in 67.12.
    if (!source.trim()) {
      return setErr("Lead Source is required.");
    }
    // Strip empty rows before send (the server filters defensively too).
    // A name-only contact (blank email) is kept on purpose. The first entry
    // mirrors into the legacy billingContactName/Email + hiringManagerName/
    // Email columns server-side; the full lists persist on Placement.
    // billingContacts / hiringContacts so Confirm Start auto-populate gets
    // every recipient.
    const cleanedBilling = billingContacts
      .map((c) => ({ name: c.name.trim(), email: c.email.trim() }))
      .filter((c) => c.name || c.email);
    const primaryBilling = cleanedBilling[0] ?? { name: "", email: "" };
    const cleanedHiring = hiringContacts
      .map((c) => ({ name: c.name.trim(), email: c.email.trim() }))
      .filter((c) => c.name || c.email);
    const primaryHiring = cleanedHiring[0] ?? { name: "", email: "" };
    startSave(async () => {
      const result = await recordLocalPlacement({
        placementId: job.placementId,
        acceptedSalary: salaryNum,
        acceptedCompensationType,
        acceptedCurrency: currency.toUpperCase().slice(0, 3),
        feePercentage: pctNum > 0 ? pctNum : null,
        feeTotal,
        minFee: minFeeNum,
        guaranteePeriodDays: guaranteeDaysNum,
        billingContactName: primaryBilling.name,
        billingContactEmail: primaryBilling.email,
        billingContacts: cleanedBilling,
        hiringManagerName: primaryHiring.name,
        hiringManagerEmail: primaryHiring.email,
        hiringContacts: cleanedHiring,
        expectedStartDate: startDate,
        notes,
        candidateSource: source.trim() || null,
        // Custom Payment Agreement. Always sent (useCustomTerms defined) so
        // the section round-trips; the action gates inst2/3 on the count and
        // clears every term column when the toggle is off. Days map to Int
        // columns, so truncate. Amounts/days reuse parseAmount.
        useCustomTerms,
        installmentCount,
        inst1Amount: parseAmount(inst1Amount),
        inst1DaysAfterStart: truncOrNull(parseAmount(inst1Days)),
        inst2Amount: parseAmount(inst2Amount),
        inst2DaysAfterStart: truncOrNull(parseAmount(inst2Days)),
        inst3Amount: parseAmount(inst3Amount),
        inst3DaysAfterStart: truncOrNull(parseAmount(inst3Days)),
        customGuaranteeDate: customGuaranteeDate || null,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't record placement", { description: result.error });
        return;
      }
      toast.success("Placement recorded", {
        description: "Candidate moved to Pending Start. Confirm Start when they begin.",
      });
      if (!editing) {
        launchPlacementConfetti(origin);
      }
      onSaved();
      router.refresh();
    });
  }

  // The Cancel button is only meaningful once the placement exists in the
  // DB. Fresh "Make Placement" opens carry job.placementId starting with
  // "local-applied-" (a synthetic id used before the row is saved); we
  // gate on that so cancellation can only target a real cuid. This
  // mirrors the same guard the DismissPlacementButton uses elsewhere in
  // this file (~line 885).
  const canCancel = editing && !job.placementId.startsWith("local-applied-");

  function onCancelPlacement() {
    // Plain window.confirm satisfies the spec ("Cancel this placement?
    // This cannot be undone."). Keeps the path simple — no extra modal,
    // no reason picker. The server action accepts reason="other" with
    // empty detail and logs the cancellation either way.
    if (typeof window === "undefined") return;
    const ok = window.confirm("Cancel this placement? This cannot be undone.");
    if (!ok) return;
    setErr(null);
    startCancel(async () => {
      const result = await cancelPlacement({
        placementId: job.placementId,
        reason: "other",
        detail: "",
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't cancel placement", { description: result.error });
        return;
      }
      toast.success("Placement cancelled", {
        description: "Hidden from dashboards, map, and pipeline. Toggle Show Cancelled in /pipeline to re-find it.",
      });
      onCancelled();
      onClose();
      router.refresh();
    });
  }

  return (
    <ModalShell
      title={editing ? "Edit placement" : "Make placement"}
      subtitle={`${job.jobTitle} · ${job.clientName}`}
      onClose={onClose}
      // Ace 67.17: lock to X-only close + draggable header + bottom-right
      // resize corner, matching the OfferDialog precedent from 67.10/67.11.
      // The modal collects accepted compensation, fee math, billing/hiring, and
      // required Lead Source — a stray backdrop click or reflexive Escape
      // press can't throw that work away. Drag/resize means the recruiter
      // can move the panel off the pipeline row underneath or widen it past
      // the default ~512px cap when typing longer notes. These props were
      // shipped on the RF PlacementDialog in 67.12 but the wrong file got
      // edited; this is the corrected version on the Ace-native dialog.
      dismissOnOverlay={false}
      draggable
      resizable
      footer={
        <Footer
          onCancel={onClose}
          onSave={onSave}
          saving={isPending}
          label={editing ? "Save" : "Make Placement"}
        />
      }
    >
      {/* 7-field core grid + Lead Source in the same 2-col layout.
          Lead Source is a <select> sourced from LEAD_SOURCES (Ace 67.17);
          previously a free-text input that the recruiter could leave
          blank, so the Financial Performance By Source widget couldn't
          bucket the placement cleanly. Required on save (see onSave). */}
      <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
        <CompensationField
          label="Accepted compensation"
          value={acceptedSalary}
          onChange={setAcceptedSalary}
          type={acceptedCompensationType}
          onTypeChange={setAcceptedCompensationType}
        />
        <OfferField label="Fee %" value={feePct} onChange={setFeePct} />
        <OfferField label="Min fee" value={minFee} onChange={setMinFee} currency />
        <OfferField
          label="Fee amount (flat, overrides calc)"
          value={feeAmountOverride}
          onChange={setFeeAmountOverride}
          currency
        />
        <OfferField
          label="Guarantee period (days)"
          value={guaranteeDays}
          onChange={setGuaranteeDays}
        />
        <OfferField
          label="Expected start date"
          type="date"
          value={startDate}
          onChange={setStartDate}
        />
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
            Lead Source *
          </span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            required
            aria-required="true"
            className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            {/* Disabled placeholder so the browser can't auto-fall-through
                to the first real option on an unselected state. */}
            <option value="" disabled>
              Select a source…
            </option>
            {LEAD_SOURCES.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
            {/* Preserve any legacy free-text value (e.g. "Pin", "Apollo BD",
                "Cold Outreach") so an existing placement reopens with its
                saved source still selected instead of silently reverting
                to the placeholder. */}
            {source &&
              !LEAD_SOURCES.some(
                (o) => o.toLowerCase() === source.toLowerCase(),
              ) && <option value={source}>{source}</option>}
          </select>
        </label>
      </div>

      {/* Fee summary card hoisted ABOVE billing/hiring (Ace 67.17) so the
          fee total is visible on first open without scrolling. Single
          horizontal row: label + breakdown left, big total right. */}
      <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-court-border/40 bg-court-surface-subtle/40 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-court-fg-muted">
            {usedOverride ? "Fee (flat override)" : "Calculated fee"}
          </div>
          <div className="truncate text-[11px] text-court-fg-muted">
            {usedOverride
              ? "Flat-fee amount; compensation × fee % ignored."
              : salaryNum && feeBasisAmount && pctNum
                ? `${formatFeeBasisForDialog(salaryNum, acceptedCompensationType, currency)} × ${pctNum}% = ${formatMoney(rawFee, currency)}`
                : "Enter compensation + fee % to calculate, or type a flat fee above."}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-serif text-xl font-semibold leading-none text-court-fg">
            {formatMoney(feeTotal, currency)}
          </div>
          {(usedMinFee || usedOverride) && (
            <div className="mt-1 text-[10px]">
              {usedMinFee && <span className="text-amber-700">(min fee applied)</span>}
              {usedOverride && <span className="text-brand-dark">(flat override)</span>}
            </div>
          )}
        </div>
      </div>

      {/* Billing + Hiring placed side-by-side (Ace 67.17) instead of
          stacked full-width. Was sm:col-span-2 on each card (~280px
          combined); now sm:grid-cols-2 (~140px). Falls back to single
          column on narrow screens. */}
      {/* Grid default align-items: stretch already equalizes the two card
          box heights; flex-col + mt-auto on the inputs block bottom-anchors
          Name/Email so they line up across both cards even when the two
          helper paragraphs wrap to different line counts (Ace 70.0 fix —
          the descriptions differ in length, which previously left the
          shorter card's inputs floating higher than the taller card's). */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-stretch">
        <ContactPickerCard
          title="Billing contact"
          helper="To: on the auto-drafted invoice when you Confirm Start. Pick the AP / finance contact."
          rows={billingContacts}
          setRows={setBillingContacts}
          clientContacts={job.clientContacts}
        />
        <ContactPickerCard
          title="Hiring manager"
          helper="Invoice notes + hired-welcome email so both sides know the manager."
          rows={hiringContacts}
          setRows={setHiringContacts}
          clientContacts={job.clientContacts}
        />
      </div>

      <label className="mt-3 block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 w-full resize-vertical rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </label>

      {/* Custom Payment Agreement — full parity with the /pipeline Hired
          edit drawer (Ace fix 2026-06-01). Previously the candidate-profile
          dialog dropped these, so the custom-installment schedule could only
          be edited from /pipeline. Same columns, same write semantics. */}
      <div className="mt-4 border-t border-court-border/40 pt-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
            Custom Payment Agreement
          </span>
          <input
            type="checkbox"
            checked={useCustomTerms}
            onChange={(e) => setUseCustomTerms(e.target.checked)}
            aria-label="Use custom payment terms"
            className="h-4 w-4 accent-court-brand"
          />
        </label>
        {useCustomTerms && (
          <div className="mt-3 space-y-2">
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
                Number of installments
              </span>
              <select
                value={installmentCount}
                onChange={(e) =>
                  setInstallmentCount(Number(e.target.value) as 1 | 2 | 3)
                }
                className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
            {[
              { n: 1, amount: inst1Amount, setAmount: setInst1Amount, days: inst1Days, setDays: setInst1Days },
              { n: 2, amount: inst2Amount, setAmount: setInst2Amount, days: inst2Days, setDays: setInst2Days },
              { n: 3, amount: inst3Amount, setAmount: setInst3Amount, days: inst3Days, setDays: setInst3Days },
            ]
              .slice(0, installmentCount)
              .map((f) => (
                <div key={f.n}>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-court-fg">
                    {`Installment ${f.n}`}
                  </div>
                  <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                    <OfferField label="Amount ($)" value={f.amount} onChange={f.setAmount} />
                    <OfferField label="Days after start" value={f.days} onChange={f.setDays} />
                  </div>
                </div>
              ))}
            <OfferField
              label="Guarantee end date (custom)"
              type="date"
              value={customGuaranteeDate}
              onChange={setCustomGuaranteeDate}
            />
            <p className="text-[11px] text-court-fg-muted">
              Overrides the guarantee period (days) field above when set.
            </p>
          </div>
        )}
      </div>

      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      {/* Cancel Placement — destructive action sits at the bottom of the
          body so the Footer's primary Save action stays unambiguous.
          Visible only after the placement row exists (canCancel). Red
          outlined rounded-md per spec; explicitly NOT rounded-full so the
          shape reads "danger button" not "pill". */}
      {canCancel && (
        <div className="mt-4 border-t border-court-border/40 pt-3">
          <button
            type="button"
            onClick={onCancelPlacement}
            disabled={cancelPending || isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50/50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
          >
            {cancelPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <AlertTriangle className="h-3 w-3" />
            )}
            Cancel
          </button>
          <p className="mt-1 text-[11px] text-court-fg-muted">
            Hides this row from dashboards, the placement map, the guarantee period table, and the client hired count. Reversible only by toggling Show Cancelled on /pipeline.
          </p>
        </div>
      )}
    </ModalShell>
  );
}

// One editable billing / hiring contact row in the placement dialog. The
// local `key` is stable across re-renders so Add / Remove never steals focus.
type ContactRow = { key: string; name: string; email: string };

function makeLocalKey(): string {
  return `c_${Math.random().toString(36).slice(2, 10)}`;
}

// Seed a contact list: prefer the saved JSON array, fall back to the legacy
// single name/email columns, else return [] so the caller seeds one blank row.
function seedContactList(
  jsonList: { name: string; email: string }[] | null | undefined,
  legacyName: string | null,
  legacyEmail: string | null,
): ContactRow[] {
  if (jsonList && jsonList.length > 0) {
    return jsonList.map((c) => ({ key: makeLocalKey(), name: c.name, email: c.email }));
  }
  if ((legacyName ?? "") || (legacyEmail ?? "")) {
    return [{ key: makeLocalKey(), name: legacyName ?? "", email: legacyEmail ?? "" }];
  }
  return [];
}

// Restored billing / hiring contact picker (Ace fix 2026-06-01). Keeps the
// current compressed side-by-side Court Mode card chrome and adds back: an
// inline Add for extra name+email rows (a name-only row is allowed — blank
// email is fine), a per-row Remove, and one-click chips that fill a row from
// the client's saved contacts (job.clientContacts).
function ContactPickerCard({
  title,
  helper,
  rows,
  setRows,
  clientContacts,
}: {
  title: string;
  helper: string;
  rows: ContactRow[];
  setRows: React.Dispatch<React.SetStateAction<ContactRow[]>>;
  clientContacts: { id: number; name: string; title: string; email: string }[];
}) {
  const update = (key: string, field: "name" | "email", value: string) =>
    setRows((prev) => prev.map((c) => (c.key === key ? { ...c, [field]: value } : c)));
  const add = () =>
    setRows((prev) => [...prev, { key: makeLocalKey(), name: "", email: "" }]);
  const remove = (key: string) =>
    setRows((prev) => {
      const next = prev.filter((c) => c.key !== key);
      // Keep at least one row so the section never collapses to nothing.
      return next.length > 0 ? next : [{ key: makeLocalKey(), name: "", email: "" }];
    });
  const pick = (key: string, c: { name: string; email: string }) =>
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, name: c.name, email: c.email ?? "" } : r)),
    );

  return (
    <div className="flex flex-col rounded-lg border border-court-border/40 bg-court-surface-subtle/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
          {title}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={add}
          className="gap-1 bg-court-surface px-2 py-0.5 text-[11px] text-court-fg-muted hover:border-brand/40 hover:text-court-fg"
        >
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      <p className="mt-0.5 text-[11px] text-court-fg-muted">{helper}</p>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row.key}
            className="rounded-md border border-court-border/40 bg-court-surface/60 p-1.5"
          >
            {/* Name STACKED over Email, never side-by-side. The two picker
                cards sit in a 2-up grid inside the placement modal, so the
                old 1fr/1fr split left each field roughly 90px wide and
                truncated the email to "scotty(" — and the email is the one
                value that has to be readable, since it's the To: on the
                auto-drafted invoice. Stacked, each field gets the card's
                full width. mt-6 on the remove button clears the Name
                label (20px line + 4px mt-1) so the X sits level with the
                Name input. */}
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <OfferField
                  label="Name"
                  value={row.name}
                  onChange={(v) => update(row.key, "name", v)}
                />
                <OfferField
                  label="Email"
                  value={row.email}
                  onChange={(v) => update(row.key, "email", v)}
                />
              </div>
              <button
                type="button"
                onClick={() => remove(row.key)}
                className="mt-6 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-court-border bg-court-surface text-court-fg-muted transition hover:border-red-300 hover:text-red-600"
                title="Remove this contact"
                aria-label="Remove contact"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {clientContacts.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {clientContacts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pick(row.key, c)}
                    className="rounded-full border border-court-border bg-court-surface px-2 py-0.5 text-[10px] text-court-fg-muted transition hover:border-brand/40 hover:text-court-fg"
                    title={`Fill from ${c.name}${c.email ? ` (${c.email})` : ""}`}
                  >
                    {c.name.split(/\s+/)[0]}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OfferField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  suffix,
  currency,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "date";
  // When true the inner input is the shared MaskedCurrencyInput: blank at
  // rest, leading "$" + thousands commas as digits are typed, onChange
  // emits clean digits only. Drops the USD suffix (mutually exclusive
  // with `suffix`). Omit to keep the plain input byte-identical.
  currency?: boolean;
  // Static chrome rendered after the input (e.g. "USD" on the salary
  // field). pointer-events-none + select-none + aria-hidden + cursor-
  // default make it visually look like a unit indicator but actually
  // inert — clicking USD focuses NOTHING (not the input, not the
  // suffix). The suffix branch swaps the wrapping <label> for a
  // <div> + sibling <label htmlFor={id}> so a click on the suffix
  // doesn't bubble into the native label-forwarding that would
  // otherwise focus the input. Undefined keeps every existing call
  // site byte-identical.
  suffix?: ReactNode;
}) {
  // useId is always called (rules of hooks) but only consumed in the
  // suffix branch.
  const inputId = useId();
  if (suffix !== undefined) {
    return (
      <div className="block text-sm">
        <label
          htmlFor={inputId}
          className="text-[11px] uppercase tracking-wider text-court-fg-muted"
        >
          {label}
        </label>
        <div className="mt-1 flex w-full items-center rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus-within:border-brand focus-within:outline-none focus-within:ring-2 focus-within:ring-brand/20">
          <input
            id={inputId}
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent outline-none placeholder:text-court-fg-muted/60"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none ml-2 shrink-0 cursor-default select-none text-xs font-medium uppercase tracking-wider text-court-fg-muted"
          >
            {suffix}
          </span>
        </div>
      </div>
    );
  }
  const inputClass =
    "mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      {currency ? (
        <MaskedCurrencyInput
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className={inputClass}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputClass}
        />
      )}
    </label>
  );
}

function CompensationField({
  label,
  value,
  onChange,
  type,
  onTypeChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: PlacementCompensationType;
  onTypeChange: (v: PlacementCompensationType) => void;
}) {
  const inputId = useId();
  const selectId = useId();
  return (
    <div className="block text-sm">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="text-[11px] uppercase tracking-wider text-court-fg-muted"
        >
          {label}
        </label>
        <label htmlFor={selectId} className="sr-only">
          Compensation type
        </label>
      </div>
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_7.25rem] gap-2">
        <div className="flex h-10 items-center rounded-lg border border-court-border bg-court-surface px-3 text-sm text-court-fg focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
          <span className="mr-1 text-court-fg-muted">$</span>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/-/g, ""))}
            placeholder={type === "hourly" ? "19.50" : "120000"}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-court-fg-muted/60"
          />
          {type === "hourly" ? (
            <span className="ml-2 shrink-0 text-xs font-medium text-court-fg-muted">
              /hr
            </span>
          ) : null}
        </div>
        <select
          id={selectId}
          value={type}
          onChange={(e) =>
            onTypeChange(
              normalizePlacementCompensationType(e.target.value),
            )
          }
          className="h-10 rounded-lg border border-court-border bg-court-surface px-3 text-sm font-medium text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="salary">Salary</option>
          <option value="hourly">Hourly</option>
        </select>
      </div>
    </div>
  );
}

// Days-after-start columns are Int?, so coerce a parsed amount to a whole
// number (or null). Keeps Prisma from rejecting a Float on an Int column.
function truncOrNull(n: number | null): number | null {
  return n == null ? null : Math.trunc(n);
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

function parseCompensationAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[$,\s]/g, "").toLowerCase();
  const kMatch = cleaned.match(/^(\d+(?:\.\d+)?)k$/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return num;
}

function seedFlatFeeOverrideFromSnapshot({
  amount,
  compensationType,
  feePercentage,
  feeTotal,
}: {
  amount: number | null;
  compensationType: PlacementCompensationType;
  feePercentage: number | null;
  feeTotal: number | null;
}): string {
  if (feeTotal == null || feeTotal <= 0) return "";

  // `feeTotal` is the saved forecast/final fee for dashboards and invoices; it
  // is not proof that the recruiter typed a flat override. When the row has a
  // valid salary + fee %, let the dialog recalculate from the current amount.
  const basisAmount = placementFeeBasisAmount(amount, compensationType);
  if (basisAmount != null && feePercentage != null && feePercentage > 0) {
    return "";
  }

  return String(feeTotal);
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

function formatFeeBasisForDialog(
  amount: number,
  type: PlacementCompensationType,
  currency: string,
): string {
  if (type === "hourly") {
    return `${formatPlacementCompensation(amount, currency, "hourly")} × ${HOURS_PER_YEAR_FOR_HOURLY_PLACEMENT.toLocaleString()} hrs`;
  }
  return formatPlacementCompensation(amount, currency, "salary");
}

// ---- Shared dialog primitives ----

// Date/time/type — interviewer is its own picker now (rendered by
// the caller so it can pass client context for the contact dropdown).
function ScheduleFields(props: {
  scheduledAt: string;
  setScheduledAt: (v: string) => void;
  durationMin: number;
  setDurationMin: (n: number) => void;
  // IANA timezone state lives in the parent so the save path can pass
  // it to scheduleInterview AND the wall-clock-to-UTC converter.
  // Required (not optional) because every scheduling surface now
  // honors a recruiter-picked zone — the prior browser-zone default
  // caused the "EST event lands 4 hours earlier" bug.
  timeZone: string;
  setTimeZone: (v: string) => void;
  type: InterviewType;
  setType: (t: InterviewType) => void;
  location: string;
  setLocation: (v: string) => void;
  interviewerSlot?: React.ReactNode;
  ccBccSlot?: React.ReactNode;
  // Renders directly under the Type select. Used by the schedule flow
  // to surface the meeting-provider picker only when type === "video"
  // AND the client-scheduled tracking flow is off.
  typeExtras?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:gap-3">
      {/* Single-row layout — date+time | timezone | duration | type — so
          all four scheduling controls live on one line. Duration's
          previous w-full layout on a 3-col grid produced ~50%
          whitespace next to "30 min"; compact mode shrinks it to the
          natural option width. Type joined this row in Ace 67.20 (was
          on its own full-width line below); w-36 fits the longest
          option ("Phone Screen") with the dropdown arrow and a touch
          of right whitespace, without the prior w-full padding bloat. */}
      <div className="flex flex-wrap items-end gap-2 sm:gap-3">
        <label className="block min-w-[13rem] flex-1 text-sm sm:min-w-[16rem]">
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
        <label className="block w-24 text-sm sm:w-32">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Time zone</span>
          <select
            value={props.timeZone}
            onChange={(e) => props.setTimeZone(e.target.value)}
            className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:px-3 sm:py-2"
          >
            {INTERVIEW_TIMEZONES.map((z) => (
              <option key={z.iana} value={z.iana}>
                {z.abbr}
              </option>
            ))}
          </select>
        </label>
        <DurationSelect value={props.durationMin} onChange={props.setDurationMin} compact />
        <label className="block w-32 text-sm sm:w-36">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Type</span>
          <select
            value={props.type}
            onChange={(e) => props.setType(e.target.value as InterviewType)}
            className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:px-3 sm:py-2"
          >
            <option value="phone_screen">Phone Screen</option>
            <option value="video">Video</option>
            <option value="in_person">In-Person</option>
          </select>
        </label>
      </div>
      {props.typeExtras}
      {props.type === "in_person" && (
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Address</span>
          <input
            type="text"
            value={props.location}
            onChange={(e) => props.setLocation(e.target.value)}
            className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:px-3 sm:py-2"
          />
          <span className="mt-0.5 block text-[11px] text-court-fg-muted">
            Appears in the calendar invite with a Map link.
          </span>
        </label>
      )}
      {props.interviewerSlot}
      {props.ccBccSlot}
    </div>
  );
}

// Narrow-viewport flag for the mobile compaction pass. matchMedia rather than
// a Tailwind-only fix because ModalShell's drag/resize sizing is written as an
// INLINE style — an `sm:` class can never override an inline width/height, and
// that inline sizing (512px initial width + a 90dvh max) is what pinned the
// scheduler to nearly the whole phone screen. Starts false so SSR and the
// first client paint agree on the desktop layout, then flips on mount.
// 639px = one below Tailwind's `sm` breakpoint, so JS and classes switch
// together.
function useIsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
  dismissOnOverlay = true,
  draggable = false,
  resizable = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  // Default true preserves existing "click outside to close" behavior
  // for every consumer (Confirm Start, Extend Offer, Make Placement,
  // …). Offer dialog passes false so half-filled offer fields can't
  // be discarded by a stray backdrop click. Matches the same prop on
  // the RF-side <Modal> in placement-flows.tsx.
  dismissOnOverlay?: boolean;
  // Opt-in drag (header) + resize (bottom-right corner). Ace 67.11 — the
  // Ace-native OfferDialog passes both true so it behaves the same as the
  // RF OfferDialog. Every other ModalShell consumer (Extend Offer, Local
  // Placement, Local Confirm Start) leaves these false and renders
  // identically to pre-67.11.
  draggable?: boolean;
  resizable?: boolean;
}) {
  // Defensive Escape guard. Today's ModalShell has no Escape handler,
  // so Escape already does nothing — but if this modal is ever nested
  // inside a Radix Dialog ancestor in the future, Escape would close
  // the ancestor and unmount us. Swallow Escape in the capture phase
  // while dismissOnOverlay is off so the "Escape inert" guarantee
  // survives that change.
  useEffect(() => {
    if (dismissOnOverlay) return;
    function block(e: KeyboardEvent) {
      if (e.key === "Escape") e.stopPropagation();
    }
    window.addEventListener("keydown", block, { capture: true });
    return () => window.removeEventListener("keydown", block, { capture: true });
  }, [dismissOnOverlay]);

  // Drag + resize are pointer-precision DESKTOP gestures. On a phone they do
  // nothing useful, and their inline sizing (512px initial width, 90dvh max
  // height, MODAL_MIN_W/H floors of 480x400) forced the panel to swallow
  // almost the whole screen. Below `sm` we drop both and fall back to the
  // plain content-sized panel with a capped height.
  const narrow = useIsNarrowViewport();
  const canDrag = draggable && !narrow;
  const canResize = resizable && !narrow;

  // Drag + resize (Ace 67.11). Same hook the RF <Modal> uses so both
  // OfferDialog implementations get the same gesture behavior. Initial
  // width matches the prior max-w-lg cap (32rem = 512px) so the first
  // paint is visually identical to pre-67.11. State resets on unmount.
  const { position, size, isDragging, isResizing, headerHandlers, resizeHandlers } =
    useDraggableResizable({
      enableDrag: canDrag,
      enableResize: canResize,
      initialWidth: canResize ? 512 : null,
    });

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
      // dismissOnOverlay=false: backdrop swallows clicks so the
      // panel doesn't double-fire on the propagated event, but never
      // calls onClose. Only the X (or Cancel footer button) closes.
      onClick={dismissOnOverlay ? onClose : (e) => e.stopPropagation()}
    >
      <div className="flex min-h-full items-center justify-center">
        {/* Flex-column shell capped at viewport height so header +
            scrollable body + footer together can never exceed the
            screen. Header and footer are flex-none so the title and
            action buttons stay pinned; the body gets flex-1 + min-h-0
            so it shrinks and scrolls internally.

            When resizable, the max-w-lg / max-h-... Tailwind caps come
            off and we govern the panel size via inline width/height +
            inline 90vw/90vh maxes so the corner handle can drag past
            the old 32rem ceiling. relative anchors the corner handle. */}
        <div
          className={cn(
            "flex w-full flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-xl",
            // 85dvh on phones (was effectively 100dvh-2rem / an inline 90dvh)
            // so the sheet reads as a panel with visible page behind it
            // instead of a full-screen takeover. Content still scrolls inside.
            !canResize && "max-w-lg max-h-[85dvh] sm:max-h-[calc(100dvh-3rem)]",
            (canDrag || canResize) && "relative",
            (isDragging || isResizing) && "select-none",
          )}
          style={
            canDrag || canResize
              ? {
                  width: size.w ?? undefined,
                  height: size.h ?? undefined,
                  minWidth: canResize ? MODAL_MIN_W : undefined,
                  minHeight: canResize ? MODAL_MIN_H : undefined,
                  maxWidth: canResize ? "90vw" : undefined,
                  // dvh (dynamic viewport) not vh: on mobile/iOS a static
                  // 90vh exceeds the visible area under the browser chrome,
                  // pushing the pinned footer (Send/Save) below the fold.
                  maxHeight: canResize ? "90dvh" : undefined,
                  transform:
                    canDrag && (position.x !== 0 || position.y !== 0)
                      ? `translate3d(${position.x}px, ${position.y}px, 0)`
                      : undefined,
                }
              : undefined
          }
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={cn(
              "flex flex-none items-start justify-between border-b border-court-border px-4 py-2.5 sm:px-5 sm:py-3",
              canDrag && "cursor-move touch-none",
            )}
            {...headerHandlers}
          >
            <div className="min-w-0">
              <h2 className="font-serif text-base font-semibold text-court-fg sm:text-lg">{title}</h2>
              {subtitle && <p className="mt-0.5 text-[11px] text-court-fg-muted sm:text-xs">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
          {footer && (
            <div className="flex flex-none items-center justify-end gap-2 border-t border-court-border bg-court-surface px-4 py-2.5 sm:px-5 sm:py-3">
              {footer}
            </div>
          )}
          {canResize && (
            // Corner resize handle (Ace 67.11). cursor-nwse-resize gives
            // the OS-standard SE-corner cursor; touch-none disables the
            // browser's default touch-scroll on this hit area so the
            // resize gesture starts cleanly on tablets.
            <div
              {...resizeHandlers}
              aria-hidden
              className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize touch-none"
            >
              <svg viewBox="0 0 16 16" className="h-full w-full text-court-fg-muted/70">
                <path
                  d="M13 7v6h-6M13 11v2h-2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
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
  onSave: (origin?: CelebrationOrigin) => void;
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
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onSave({
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          });
        }}
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

function launchPlacementConfetti(origin?: CelebrationOrigin) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.overflow = "hidden";
  overlay.style.zIndex = "9999";
  document.body.appendChild(overlay);

  const colors = ["#16a34a", "#22c55e", "#f59e0b", "#facc15", "#38bdf8", "#f43f5e", "#ffffff"];
  const startX = origin ? origin.left + origin.width / 2 : window.innerWidth / 2;
  const startY = origin ? origin.top + origin.height / 2 : window.innerHeight - 96;
  const count = 92;

  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("span");
    const size = 5 + Math.random() * 7;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const velocity = 220 + Math.random() * 430;
    const drift = (Math.random() - 0.5) * 120;
    const x = Math.cos(angle) * velocity + drift;
    const y = Math.sin(angle) * velocity - Math.random() * 80;
    const fall = 300 + Math.random() * 220;
    const rotate = (Math.random() > 0.5 ? 1 : -1) * (420 + Math.random() * 720);
    const duration = 1400 + Math.random() * 1100;
    const delay = Math.random() * 120;

    piece.style.position = "absolute";
    piece.style.left = `${startX}px`;
    piece.style.top = `${startY}px`;
    piece.style.width = `${size}px`;
    piece.style.height = `${size * (0.45 + Math.random() * 0.8)}px`;
    piece.style.borderRadius = Math.random() > 0.55 ? "999px" : "2px";
    piece.style.background = colors[i % colors.length];
    piece.style.boxShadow = "0 0 0 1px rgba(255,255,255,0.2)";
    piece.style.transform = "translate(-50%, -50%)";
    overlay.appendChild(piece);

    piece.animate(
      [
        { opacity: 1, transform: "translate(-50%, -50%) scale(1) rotate(0deg)" },
        {
          opacity: 1,
          offset: 0.55,
          transform: `translate(calc(-50% + ${x * 0.65}px), calc(-50% + ${y}px)) scale(1) rotate(${rotate * 0.45}deg)`,
        },
        {
          opacity: 0,
          transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y + fall}px)) scale(0.9) rotate(${rotate}deg)`,
        },
      ],
      {
        delay,
        duration,
        easing: "cubic-bezier(.16,.8,.34,1)",
        fill: "forwards",
      },
    );
  }

  window.setTimeout(() => overlay.remove(), 2700);
}

function formatType(t: InterviewType): string {
  if (t === "phone_screen") return "Phone Screen";
  if (t === "video") return "Video";
  return "In-Person";
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
  // Render every interview time in the picked zone with the
  // ET/CT/MT/PT abbreviation appended so the candidate's email body
  // never has an ambiguous "3:00 PM" — the prior toLocaleString path
  // formatted in the recruiter's browser zone, which differed from
  // the picked zone every time a recruiter scheduled outside their
  // home timezone.
  const tz = args.invite.timeZone || undefined;
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
    interviewDate: formatInterviewDate(when, tz),
    interviewTime: formatInterviewTime(when, tz),
    interviewDateTime: formatInterviewWhen(when, tz),
    interviewTimeZone: abbrForTimeZone(args.invite.timeZone),
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

// ---- one-screen interview scheduler (Ace E) ----
//
// ONE scrolling screen replaces the old ScheduleDialog + the two stacked
// invite composers + the inviteFlow step machine. The recruiter fills the
// logistics, flips the two "Send …" toggles, edits each party's subject +
// body inline, and clicks ONE Send. Send calls scheduleInterview once, then
// sendInterviewInvite once per enabled toggle - the exact same engine the
// retired composers used, so the SENT subject/body/Meet/Bcc behavior is
// byte-for-byte unchanged. The default copy below is lifted verbatim from
// the retired composers; merge tokens resolve via applyMergeFieldsClient
// against the same buildValues map. The Meet link is the one token left for
// send-time: scheduleInterview mints the Meet, so the URL isn't known while
// the recruiter is still composing.
const MEET_LINK_TOKEN = "[Interview Meet Link]";

function defaultClientSubject(type: InterviewType, candidateName: string, jobTitle: string): string {
  return `${formatType(type)} Interview - ${candidateName || "Candidate"} - ${jobTitle}`;
}
function defaultClientBody(type: InterviewType, location: string): string {
  const addrLine = type === "in_person" && location ? `\n• Location: ${location}` : "";
  const meetLine = type === "video" ? `\n• Join on Google Meet: ${MEET_LINK_TOKEN}` : "";
  return (
    `Hi [Client Contact First Name],\n\nConfirming the interview with [Candidate Full Name] for the [Job Title] role. ` +
    `The calendar invite is on its way.\n\n` +
    `• When: [Interview Date Time]\n• Duration: [Interview Duration]\n• Format: [Interview Type]${addrLine}${meetLine}\n\n` +
    `Reply to this email if anything needs to change.`
  );
}
function defaultInPersonClientBody(interviewerLabel: string): string {
  return (
    `[Greeting]\n\n` +
    `[Candidate Full Name] is confirmed for an in-person interview with ${interviewerLabel} for the [Job Title] role.\n\n` +
    `Date/Time: [Interview Date Time]\n` +
    `Address: [Interview Location]\n\n` +
    `Reply here if anything changes.`
  );
}
function defaultCandidateSubject(type: InterviewType): string {
  return `${formatType(type)} Interview - BreakPoint Talent`;
}
function defaultCandidateBody(type: InterviewType, location: string): string {
  const addrLine = type === "in_person" && location ? `\n• Location: ${location}` : "";
  const meetLine = type === "video" ? `\n• Join on Google Meet: ${MEET_LINK_TOKEN}` : "";
  return (
    `Hi [Candidate First Name],\n\nYou are confirmed for your [Interview Type] interview with [Client Company Name] ` +
    `for the [Job Title] role. The calendar invite is on its way.\n\n` +
    `• When: [Interview Date Time]\n• Duration: [Interview Duration]\n• Format: [Interview Type]${addrLine}${meetLine}\n\n` +
    `Good luck!`
  );
}
function defaultInPersonCandidateBody(interviewerLabel: string): string {
  return (
    `Hi [Candidate First Name],\n\n` +
    `You are confirmed for an in-person interview with ${interviewerLabel} at [Client Company Name] for the [Job Title] role.\n\n` +
    `Date/Time: [Interview Date Time]\n` +
    `Address: [Interview Location]\n\n` +
    `Good luck!`
  );
}

function formatHumanList(items: string[]): string {
  const unique = Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function formatRecipientHint(emails: string[], fallback: string): string {
  const recipients = formatHumanList(emails);
  return recipients ? `To: ${recipients}` : fallback;
}

// Per-party subject/body draft. The source copy is always the saved
// scheduling template for that party (client → "Client Interview
// Confirmation", candidate → interview-prep), passed in as the default.
// While the recruiter hasn't touched a field it stays a live preview that
// re-resolves from that template as the schedule values change; the first
// manual edit (or token insert) freezes the field so later date/type
// changes never clobber the recruiter's wording.
function useInviteDraft(defaultSubject: string, defaultBody: string, values: MergeFieldValues) {
  const [subject, setSubjectState] = useState("");
  const [body, setBodyState] = useState("");
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [bodyTouched, setBodyTouched] = useState(false);
  useEffect(() => {
    if (!subjectTouched) setSubjectState(applyMergeFieldsClient(defaultSubject, values));
  }, [defaultSubject, values, subjectTouched]);
  useEffect(() => {
    if (!bodyTouched) setBodyState(applyMergeFieldsClient(defaultBody, values));
  }, [defaultBody, values, bodyTouched]);
  return {
    subject,
    body,
    setSubject: (v: string) => {
      setSubjectState(v);
      setSubjectTouched(true);
    },
    setBody: (v: string) => {
      setBodyState(v);
      setBodyTouched(true);
    },
  };
}

// Inline subject + body editor for one party, with a merge-field inserter.
// The body auto-fills from the saved scheduling template for this party and
// stays inline-editable. Plain-text body (it becomes the Google event
// description) so no rich editor is needed.
function InlineInviteEditor({
  subject,
  body,
  onSubjectChange,
  onBodyChange,
}: {
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
}) {
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const lastField = useRef<"subject" | "body">("body");

  function insertToken(token: string) {
    const target = lastField.current === "subject" ? subjectRef.current : bodyRef.current;
    const current = lastField.current === "subject" ? subject : body;
    const apply = lastField.current === "subject" ? onSubjectChange : onBodyChange;
    if (!target) {
      apply(current + token);
      return;
    }
    const start = target.selectionStart ?? current.length;
    const end = target.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    apply(next);
    requestAnimationFrame(() => {
      target.focus();
      const caret = start + token.length;
      try {
        target.setSelectionRange(caret, caret);
      } catch {
        // some controls reject programmatic selection; harmless
      }
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-court-border/60 bg-court-surface-subtle/40 p-2.5 sm:p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-court-fg-muted">
          <span className="uppercase tracking-wider">Insert field</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) insertToken(e.target.value);
              e.target.selectedIndex = 0;
            }}
            className="rounded-md border border-court-border bg-court-surface px-2 py-1 text-xs text-court-fg focus:border-brand focus:outline-none"
          >
            <option value="">Insert field…</option>
            {MERGE_FIELDS.map((f) => (
              <option key={f.token} value={f.token}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Subject</span>
        <input
          ref={subjectRef}
          type="text"
          value={subject}
          onFocus={() => (lastField.current = "subject")}
          onChange={(e) => onSubjectChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:px-3 sm:py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Body</span>
        {/* h-28 wins over rows={8} on phones (a fixed height beats the rows
            attribute) so the body box is ~112px instead of ~200px; sm:h-auto
            hands height back to rows={8} on desktop, unchanged. Still
            resize-vertical, so a longer edit can be dragged open. */}
        <textarea
          ref={bodyRef}
          value={body}
          onFocus={() => (lastField.current = "body")}
          onChange={(e) => onBodyChange(e.target.value)}
          rows={8}
          className="mt-1 h-28 w-full resize-vertical rounded-lg border border-court-border bg-court-surface px-2.5 py-1.5 text-sm leading-relaxed text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:h-auto sm:px-3 sm:py-2"
        />
      </label>
    </div>
  );
}

type ScheduleCandidate = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentTitle: string | null;
  currentEmployer: string | null;
};

function ScheduleInterviewScreen({
  candidateId,
  candidateName,
  candidate,
  candidateEmail,
  recruiter,
  job,
  existingInterview,
  onClose,
}: {
  candidateId: string;
  candidateName: string;
  candidate: ScheduleCandidate;
  candidateEmail: string | null;
  recruiter: { firstName: string; fullName: string; email: string; phone: string };
  job: LocalJobRow;
  // 2b-ii: when present, the SAME screen runs in edit mode — pre-filled from
  // this interview, ONE Save with a three-way notify choice driving
  // updateInterview, no scheduleInterview call. Absent → new-interview mode,
  // exactly as 2b-i (byte-for-byte unchanged).
  existingInterview?: LocalInterview;
  onClose: () => void;
}) {
  const router = useRouter();
  const isEdit = !!existingInterview;
  // New mode starts empty so the recruiter makes a deliberate pick; edit mode
  // pre-fills from the existing interview. timeZone defaults to ET in both (it
  // isn't persisted), so the stored UTC time is shown as its ET wall-clock.
  const [scheduledAt, setScheduledAt] = useState(() =>
    existingInterview
      ? utcToWallClockInZone(new Date(existingInterview.scheduledAt), DEFAULT_INTERVIEW_TIMEZONE)
      : "",
  );
  const [durationMin, setDurationMin] = useState(existingInterview?.durationMin ?? 30);
  const [timeZone, setTimeZone] = useState<string>(DEFAULT_INTERVIEW_TIMEZONE);
  const [type, setType] = useState<InterviewType>(existingInterview?.type ?? "video");
  const [meetingType, setMeetingType] = useState<MeetingProvider>("google");
  const [microsoftConnected, setMicrosoftConnected] = useState(false);
  // Multi-interviewer: a comma-string of interviewer emails (the same chip
  // model Cc/Bcc use), seeded in edit mode from ALL of the interview's stored
  // client attendees so the original interviewer(s) carry in and Andrew can add
  // more. Each interviewer attaches as a guest on the CLIENT invite event only.
  const [interviewersCsv, setInterviewersCsv] = useState(
    existingInterview
      ? existingInterview.attendees.map((a) => a.email).filter(Boolean).join(", ")
      : "",
  );
  const [location, setLocation] = useState(existingInterview?.location ?? "");
  const [ccCsv, setCcCsv] = useState("");
  const [bccCsv, setBccCsv] = useState("");
  // Edit mode: ONE Save opens the three-way update-choice modal (Item #9).
  const [askNotify, setAskNotify] = useState(false);
  // Item #15: whole-interview Cancel (edit mode only). cancelChoiceOpen reveals
  // the two-way notify-guests choice; cancelPending tracks the in-flight delete.
  const [cancelChoiceOpen, setCancelChoiceOpen] = useState(false);
  const [cancelPending, startCancelInterview] = useTransition();
  // "Client will send invite": log the interview for tracking + credit, send
  // nothing. Same source="client_scheduled" path the old modal used. (New mode
  // only — an existing interview is already logged.)
  const [clientWillSendInvite, setClientWillSendInvite] = useState(false);
  // Both editors default ON in every mode (new + edit) so the subject/body
  // editors are open without reopening. In edit mode an ON party that was never
  // invited gets a fresh invite on Save via the same send path new-schedule
  // uses (gated by the notify choice — "don't send updates" suppresses it).
  const [sendClientEmail, setSendClientEmail] = useState(true);
  const [sendCandidateEmail, setSendCandidateEmail] = useState(true);
  // Active interview-scheduling templates seed the per-party defaults (same
  // as the retired composers: clientTemplate?.subject ?? hardcoded fallback).
  const [schedTemplates, setSchedTemplates] = useState<
    Awaited<ReturnType<typeof getInterviewSchedulingTemplates>>
  >({ candidate: null, client: null });
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSend] = useTransition();
  // Survives a partial failure: once scheduled we don't re-schedule on a
  // retry Send, and we don't re-fire a party invite that already went out.
  const scheduledRef = useRef<{ interviewId: string; meetLink: string | null } | null>(null);
  const sentRef = useRef<{ client: boolean; candidate: boolean }>({ client: false, candidate: false });

  // Interviewer chip model. Options come from the job's client contacts (picked
  // chips drop out of the list inside InlineContactMultiInput); a typed email is
  // accepted too. Each selected email resolves to a name (client contact first,
  // then the stored attendee name) so calendar guests carry display names. The
  // FIRST interviewer is the primary client attendee that drives the invite's
  // To + the [Interviewer] merge field; every interviewer is a guest on the
  // client event. interviewerName/interviewerEmail keep their old names as the
  // primary scalars so the rest of the send/merge code is unchanged.
  const interviewerOptions = useMemo(
    () =>
      job.clientContacts
        .map((c) => ({ id: String(c.id), name: c.name, email: c.email }))
        .filter((c) => c.email),
    [job.clientContacts],
  );
  const interviewerEmails = parseEmailCsv(interviewersCsv);
  const resolveInterviewerName = (email: string): string => {
    const lc = email.toLowerCase();
    const fromContacts = job.clientContacts.find((c) => (c.email ?? "").toLowerCase() === lc);
    if (fromContacts?.name) return fromContacts.name;
    const fromExisting = existingInterview?.attendees.find((a) => a.email.toLowerCase() === lc);
    return fromExisting?.name ?? "";
  };
  const interviewerList = interviewerEmails.map((email) => ({
    name: resolveInterviewerName(email),
    email,
  }));
  const primaryInterviewer = interviewerList[0] ?? null;
  const interviewerName = primaryInterviewer?.name ?? "";
  const interviewerEmail = primaryInterviewer?.email ?? "";
  const interviewerLabel = formatHumanList(
    interviewerList.map((interviewer) => interviewer.name || interviewer.email),
  ) || "the client team";
  const clientGreeting = buildSmartGreeting(interviewerList);
  const clientRecipientHint = formatRecipientHint(interviewerEmails, "Pick an interviewer above");

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

  // Seed the per-party defaults from the active scheduling templates. In-person
  // interviews use a tighter body so the invite does not read like a video/phone
  // confirmation.
  useEffect(() => {
    let cancelled = false;
    void getInterviewSchedulingTemplates()
      .then((t) => {
        if (!cancelled) setSchedTemplates(t);
      })
      .catch(() => {
        // Keep the hardcoded fallbacks on failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Merge values for the live preview. Built from buildValues (verbatim) so
  // the resolved copy matches the old composers exactly; the Meet link stays
  // a token here and is spliced in at send once scheduleInterview mints it.
  const values = useMemo<MergeFieldValues>(() => {
    const whenISO = scheduledAt
      ? wallClockInZoneToUTC(scheduledAt, timeZone).toISOString()
      : new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const syntheticInvite: LocalInviteFlow = {
      step: "candidate",
      interviewId: "",
      scheduledAtISO: whenISO,
      durationMin,
      type,
      meetLink: null,
      interviewLocation: type === "in_person" ? location : "",
      jobTitle: job.jobTitle,
      jobLocation: job.jobLocation,
      jobDescription: job.jobDescription,
      jobSalaryRange: job.jobSalaryRange,
      clientName: job.clientName,
      clientWebsite: job.clientWebsite,
      clientLinkedIn: job.clientLinkedIn,
      clientContacts: job.clientContacts,
      clientContactName: interviewerName,
      clientContactEmail: interviewerEmail,
      ccEmails: parseEmailCsv(ccCsv),
      bccEmails: parseEmailCsv(bccCsv),
      timeZone,
      candidateTemplate: null,
      clientTemplate: null,
    };
    return {
      ...buildValues({ invite: syntheticInvite, candidate, recruiter }),
      greeting: clientGreeting,
      // Keep the Meet token unresolved in the editor; resolve at send.
      interviewMeetLink: MEET_LINK_TOKEN,
    };
  }, [
    scheduledAt,
    timeZone,
    durationMin,
    type,
    location,
    interviewerName,
    interviewerEmail,
    clientGreeting,
    ccCsv,
    bccCsv,
    job,
    candidate,
    recruiter,
  ]);

  // Saved-template bodies can be stored as HTML (the rich-text Settings
  // editor); the candidate-prep body happens to be plain text, the client
  // confirmation body is HTML. htmlToReadableText converts <p>/<br>/entities
  // to clean text (and no-ops on plain text) so the body reads clean in the
  // editor, in the calendar event, in the stored sent-copy, and in the Bcc
  // Gmail copy alike — matching what Google Calendar already renders.
  // Edit mode seeds each party editor from the STORED sent copy (what the
  // recipient actually saw), cleaned through htmlToReadableText. New mode seeds
  // from the saved scheduling template, except in-person interviews use the
  // address-forward body above.
  const clientDefaultSubject = useMemo(
    () =>
      existingInterview?.sentClientSubject
        ? htmlToReadableText(existingInterview.sentClientSubject)
        : schedTemplates.client?.subject
          ? htmlToReadableText(schedTemplates.client.subject)
          : defaultClientSubject(type, candidateName, job.jobTitle),
    [existingInterview, schedTemplates, type, candidateName, job.jobTitle],
  );
  const clientDefaultBody = useMemo(
    () =>
      existingInterview?.sentClientBody
        ? htmlToReadableText(existingInterview.sentClientBody)
        : type === "in_person"
          ? defaultInPersonClientBody(interviewerLabel)
        : schedTemplates.client?.body
          ? htmlToReadableText(schedTemplates.client.body)
          : defaultClientBody(type, location),
    [existingInterview, schedTemplates, type, location, interviewerLabel],
  );
  const candidateDefaultSubject = useMemo(
    () =>
      existingInterview?.sentCandidateSubject
        ? htmlToReadableText(existingInterview.sentCandidateSubject)
        : schedTemplates.candidate?.subject
          ? htmlToReadableText(schedTemplates.candidate.subject)
          : defaultCandidateSubject(type),
    [existingInterview, schedTemplates, type],
  );
  const candidateDefaultBody = useMemo(
    () =>
      existingInterview?.sentCandidateBody
        ? htmlToReadableText(existingInterview.sentCandidateBody)
        : type === "in_person"
          ? defaultInPersonCandidateBody(interviewerLabel)
        : schedTemplates.candidate?.body
          ? htmlToReadableText(schedTemplates.candidate.body)
          : defaultCandidateBody(type, location),
    [existingInterview, schedTemplates, type, location, interviewerLabel],
  );

  const clientDraft = useInviteDraft(clientDefaultSubject, clientDefaultBody, values);
  const candidateDraft = useInviteDraft(candidateDefaultSubject, candidateDefaultBody, values);

  function resolveForSend(text: string, meetLink: string | null): string {
    return text.split(MEET_LINK_TOKEN).join(meetLink ?? "");
  }

  function onSend() {
    setErr(null);
    if (!scheduledAt) return setErr("Pick a date and time.");
    if (type === "in_person" && !location.trim()) {
      return setErr("Address required for in-person interviews.");
    }
    if (!clientWillSendInvite) {
      if (sendClientEmail && interviewerEmails.length === 0) {
        return setErr("Pick an interviewer (client contact) or turn off the client email.");
      }
      if (sendCandidateEmail && !candidateEmail) {
        return setErr("No candidate email on file. Turn off the candidate email to continue.");
      }
    }
    startSend(async () => {
      // Schedule once. On a retry after a partial send failure we reuse the
      // interview that already exists rather than minting a duplicate.
      if (!scheduledRef.current) {
        const snapped = wallClockInZoneToUTC(scheduledAt, timeZone);
        // Every interviewer is a guest on the client event.
        const attendees = interviewerList;
        const result = await scheduleInterview({
          candidateId,
          placementId: job.placementId,
          jobRfId: job.jobRfId,
          clientRfId: job.clientRfId,
          scheduledAt: snapped.toISOString(),
          durationMin,
          type,
          attendees,
          notes: "",
          source: clientWillSendInvite ? "client_scheduled" : "ace_scheduled",
          jobTitle: job.jobTitle,
          clientName: job.clientName,
          candidateName,
          location: type === "in_person" ? location.trim() : undefined,
          timeZone,
          meetingType: clientWillSendInvite ? undefined : type === "video" ? meetingType : undefined,
        });
        if (!result.ok) {
          setErr(result.error);
          toast.error("Couldn't schedule", { description: result.error });
          return;
        }
        scheduledRef.current = { interviewId: result.value.interviewId, meetLink: result.value.meetLink };
        void triggerCalendarSync(router);
        void upsertInterviewReminder(result.value.interviewId);
      }
      // scheduleInterview returns on failure above, so this is always set
      // here; the guard satisfies the type-narrowing without a non-null `!`.
      const sched = scheduledRef.current;
      if (!sched) return;
      const interviewId = sched.interviewId;

      // Client-scheduled: no emails. The row + calendar + activity log are
      // already written by scheduleInterview above (recruiter keeps credit).
      if (clientWillSendInvite) {
        toast.success("Interview scheduled", { description: "Logged for tracking. No invites were sent." });
        onClose();
        return;
      }

      const failures: string[] = [];
      // Client invite first (it reuses the schedule-time tracking event;
      // the candidate invite then gets its own event with the same Meet).
      if (sendClientEmail && !sentRef.current.client) {
        const res = await sendInterviewInvite({
          interviewId,
          party: "client",
          attendeeEmail: interviewerEmail.trim(),
          attendeeName: interviewerName.trim() || undefined,
          // All interviewers ride the To so each attaches as a guest on the
          // client event. Cc stays the separate client-contacts pool;
          // interviewers are never auto-Cc'd.
          toEmails: interviewerEmails,
          ccEmails: parseEmailCsv(ccCsv),
          bccEmails: parseEmailCsv(bccCsv),
          subject: resolveForSend(clientDraft.subject, sched.meetLink),
          bodyText: resolveForSend(clientDraft.body, sched.meetLink),
          timeZone,
        });
        if (res.ok) {
          sentRef.current.client = true;
          if (res.value.meetLink && !sched.meetLink) {
            sched.meetLink = res.value.meetLink;
          }
        } else {
          failures.push(`Client invite: ${res.error}`);
        }
      }
      if (sendCandidateEmail && candidateEmail && !sentRef.current.candidate) {
        const meet = sched.meetLink;
        const res = await sendInterviewInvite({
          interviewId,
          party: "candidate",
          attendeeEmail: candidateEmail,
          attendeeName: candidateName || undefined,
          ccEmails: [],
          bccEmails: [],
          subject: resolveForSend(candidateDraft.subject, meet),
          bodyText: resolveForSend(candidateDraft.body, meet),
          timeZone,
        });
        if (res.ok) {
          sentRef.current.candidate = true;
        } else {
          failures.push(`Candidate invite: ${res.error}`);
        }
      }

      if (failures.length > 0) {
        // Interview is scheduled; some invite(s) didn't send. Keep the screen
        // open so Send can retry only the failed party (the others are marked
        // sent and won't re-fire).
        setErr(failures.join(" · "));
        toast.error("Some invites didn't send", { description: failures.join(" · ") });
        return;
      }
      toast.success("Interview scheduled", { description: "Invites sent." });
      onClose();
    });
  }

  // Edit mode: ONE Save → three-way update-choice prompt. The choice drives
  // updateInterview's notifyMode (who gets emailed); the calendar time always
  // moves regardless. The edited per-party bodies are pushed to the live
  // event + stored copies for whichever party was originally invited.
  function onSaveEdit() {
    setErr(null);
    if (!scheduledAt) return setErr("Pick a date and time.");
    if (type === "in_person" && !location.trim()) {
      return setErr("Address required for in-person interviews.");
    }
    // A party toggled ON that was never invited will be sent a fresh invite on
    // commit; block early if its email is missing (mirrors the new-mode guard).
    if (existingInterview) {
      if (sendClientEmail && !existingInterview.clientInvited && interviewerEmails.length === 0) {
        return setErr("Pick an interviewer (client contact) or turn off the client email.");
      }
      if (sendCandidateEmail && !existingInterview.candidateInvited && !candidateEmail) {
        return setErr("No candidate email on file. Turn off the candidate email to continue.");
      }
    }
    setAskNotify(true);
  }

  function commitEdit(notifyMode: "all" | "new_only" | "none") {
    if (!existingInterview) return;
    const ex = existingInterview;
    setErr(null);
    startSend(async () => {
      // Every interviewer + any Cc become guests on the client event (added per
      // notify mode by updateInterview). Drop blanks.
      const attendees = [
        ...interviewerList,
        ...parseEmailCsv(ccCsv).map((email) => ({ name: "", email })),
      ].filter((a) => a.email.length > 0);
      // Push a party's edited subject/body to its live event + stored copy only
      // when that party was ALREADY invited (has an event to patch) AND its
      // toggle is on. A never-invited party has no event to patch — it gets a
      // fresh invite via sendInterviewInvite below. resolveForSend is a no-op on
      // a stored copy (it carries the real Meet URL, not the token).
      const pushClient = ex.clientInvited && sendClientEmail;
      const pushCandidate = ex.candidateInvited && sendCandidateEmail;
      const result = await updateInterview({
        interviewId: ex.id,
        scheduledAt: wallClockInZoneToUTC(scheduledAt, timeZone).toISOString(),
        durationMin,
        type,
        timeZone,
        // type drives the address: clears it when switching away from in-person.
        location: type === "in_person" ? location.trim() : "",
        attendees,
        notifyMode,
        bcc: parseEmailCsv(bccCsv),
        ...(pushClient ? { clientSubject: clientDraft.subject, clientBody: clientDraft.body } : {}),
        ...(pushCandidate
          ? { candidateSubject: candidateDraft.subject, candidateBody: candidateDraft.body }
          : {}),
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't update interview", { description: result.error });
        setAskNotify(false);
        return;
      }

      // Newly-emailed party: a toggle turned ON for a party that was NOT
      // previously invited gets a fresh invite through the same working send
      // path new-schedule uses. The interview already exists, so
      // sendInterviewInvite creates that party's event, stores the sent copy,
      // and stamps its sentAt flag. The Meet link is already minted on the
      // interview, so resolve the token against it. Gated by the notify choice:
      // "don't send updates" suppresses the fresh invite too.
      const meet = ex.meetLink;
      const failures: string[] = [];
      const mayNotify = notifyMode !== "none";
      if (mayNotify && sendClientEmail && !ex.clientInvited && interviewerEmails.length > 0) {
        const res = await sendInterviewInvite({
          interviewId: ex.id,
          party: "client",
          attendeeEmail: interviewerEmail.trim(),
          attendeeName: interviewerName.trim() || undefined,
          toEmails: interviewerEmails,
          ccEmails: parseEmailCsv(ccCsv),
          bccEmails: parseEmailCsv(bccCsv),
          subject: resolveForSend(clientDraft.subject, meet),
          bodyText: resolveForSend(clientDraft.body, meet),
          timeZone,
        });
        if (!res.ok) failures.push(`Client invite: ${res.error}`);
      }
      if (mayNotify && sendCandidateEmail && !ex.candidateInvited && candidateEmail) {
        const res = await sendInterviewInvite({
          interviewId: ex.id,
          party: "candidate",
          attendeeEmail: candidateEmail,
          attendeeName: candidateName || undefined,
          ccEmails: [],
          bccEmails: [],
          subject: resolveForSend(candidateDraft.subject, meet),
          bodyText: resolveForSend(candidateDraft.body, meet),
          timeZone,
        });
        if (!res.ok) failures.push(`Candidate invite: ${res.error}`);
      }

      void triggerCalendarSync(router);
      void upsertInterviewReminder(ex.id);
      if (failures.length > 0) {
        // The time/body edit already landed; only the fresh invite(s) failed.
        setErr(failures.join(" · "));
        toast.error("Some invites didn't send", { description: failures.join(" · ") });
        setAskNotify(false);
        return;
      }
      toast.success("Interview updated");
      onClose();
    });
  }

  // Item #15: whole-interview Cancel from the candidate-profile edit path.
  // Reuses the cancelInterview engine verbatim (the SAME action the calendar
  // drawer calls) with the same two-way notify-guests choice, so the status
  // flip to cancelled + the local calendar-row mirror behave identically and
  // Ace + Google never drift. On success, refresh so the job pill updates.
  function doCancelInterview(notifyGuests: boolean) {
    if (!existingInterview) return;
    const id = existingInterview.id;
    setErr(null);
    startCancelInterview(async () => {
      const res = await cancelInterview(id, { notifyGuests });
      if (!res.ok) {
        setErr(res.error);
        toast.error("Couldn't cancel interview", { description: res.error });
        return;
      }
      toast.success("Interview cancelled");
      void triggerCalendarSync(router);
      router.refresh();
      onClose();
    });
  }

  const emailEditorsDisabled = clientWillSendInvite;

  return (
    <>
    <ModalShell
      title={isEdit ? "Edit interview" : "Schedule interview"}
      subtitle={`${candidateName} for ${job.jobTitle} at ${job.clientName}`}
      onClose={onClose}
      dismissOnOverlay={false}
      draggable
      resizable
      footer={
        isEdit ? (
          // Item #9: footer is plain Cancel + Save. Save opens the notify-choice
          // modal (NotifyChoiceModal) which owns its own Back/dismiss; the old
          // footer Save->Back swap is gone.
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isPending}
              className="gap-1 bg-court-surface py-2 font-medium text-court-fg-muted hover:text-court-fg"
            >
              <X className="h-3 w-3" /> Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSaveEdit}
              disabled={isPending}
              className="gap-1 px-4 py-2"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarClock className="h-3 w-3" />}
              Save
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isPending}
              className="gap-1 bg-court-surface py-2 font-medium text-court-fg-muted hover:text-court-fg"
            >
              <X className="h-3 w-3" /> Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSend}
              disabled={isPending}
              className="gap-1 px-4 py-2"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {clientWillSendInvite ? "Schedule interview" : "Send"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3 sm:space-y-4">
        <ScheduleFields
          scheduledAt={scheduledAt}
          setScheduledAt={setScheduledAt}
          durationMin={durationMin}
          setDurationMin={setDurationMin}
          timeZone={timeZone}
          setTimeZone={setTimeZone}
          type={type}
          setType={setType}
          location={location}
          setLocation={setLocation}
          typeExtras={
            // Provider (Meet/Teams) is fixed once an interview exists, so the
            // picker is new-mode only; edit keeps the existing Meet.
            type === "video" && !clientWillSendInvite && !isEdit ? (
              <MeetingProviderSelect
                value={meetingType}
                onChange={setMeetingType}
                teamsConnected={microsoftConnected}
              />
            ) : null
          }
          interviewerSlot={
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
                Interviewer(s) · client contacts
              </span>
              <InlineContactMultiInput
                value={interviewersCsv}
                onChange={setInterviewersCsv}
                options={interviewerOptions}
                placeholder="Pick a client contact or type email…"
              />
            </label>
          }
          ccBccSlot={
            clientWillSendInvite ? null : (
              <CcBccPicker
                clientContacts={job.clientContacts}
                cc={ccCsv}
                onCcChange={setCcCsv}
                bcc={bccCsv}
                onBccChange={setBccCsv}
              />
            )
          }
        />

        {/* "Client will send invite" is a new-interview-only concept. */}
        {!isEdit && (
          <label
            className="flex cursor-pointer items-start gap-2 rounded-lg border border-court-border/40 bg-court-surface-subtle/60 p-2.5 text-sm sm:p-3"
            title="Use this when the client is scheduling the interview themselves. We log it on your calendar for tracking + credit and skip the invite emails."
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
                Log the interview on your calendar + activity log for tracking and credit. Skip the
                candidate/client invite emails. The client is sending their own.
              </span>
            </span>
          </label>
        )}

        {/* New mode: toggle sections decide whether to send each party. */}
        {!isEdit && !emailEditorsDisabled && (
          <>
            <InviteToggleSection
              label="Send Client Email"
              hint={clientRecipientHint}
              enabled={sendClientEmail}
              onToggle={setSendClientEmail}
            >
              <InlineInviteEditor
                subject={clientDraft.subject}
                body={clientDraft.body}
                onSubjectChange={clientDraft.setSubject}
                onBodyChange={clientDraft.setBody}
              />
            </InviteToggleSection>

            <InviteToggleSection
              label="Send Candidate Email"
              hint={candidateEmail ? `To: ${candidateEmail}` : "No candidate email on file"}
              enabled={sendCandidateEmail}
              onToggle={setSendCandidateEmail}
            >
              <InlineInviteEditor
                subject={candidateDraft.subject}
                body={candidateDraft.body}
                onSubjectChange={candidateDraft.setSubject}
                onBodyChange={candidateDraft.setBody}
              />
            </InviteToggleSection>
          </>
        )}

        {/* Edit mode: ALWAYS show both party editors (toggle + subject + body),
            exactly like new-schedule mode — never hidden by the invited flags.
            Toggle defaults ON for a party already invited (Save re-pushes its
            edited copy per the notify choice) and OFF for a party never emailed
            (the editor still shows so Andrew can flip it on and send a fresh
            invite). Each editor is seeded from the stored sent copy when present
            and the scheduling-template default otherwise (see the *Default
            memos above). */}
        {isEdit && (
          <>
            <InviteToggleSection
              label="Send Client Email"
              hint={clientRecipientHint}
              enabled={sendClientEmail}
              onToggle={setSendClientEmail}
            >
              <InlineInviteEditor
                subject={clientDraft.subject}
                body={clientDraft.body}
                onSubjectChange={clientDraft.setSubject}
                onBodyChange={clientDraft.setBody}
              />
            </InviteToggleSection>

            <InviteToggleSection
              label="Send Candidate Email"
              hint={candidateEmail ? `To: ${candidateEmail}` : "No candidate email on file"}
              enabled={sendCandidateEmail}
              onToggle={setSendCandidateEmail}
            >
              <InlineInviteEditor
                subject={candidateDraft.subject}
                body={candidateDraft.body}
                onSubjectChange={candidateDraft.setSubject}
                onBodyChange={candidateDraft.setBody}
              />
            </InviteToggleSection>
          </>
        )}

        {/* Item #15: whole-interview Cancel — edit mode only. Sits at the
            bottom of the body above a border-t divider, styled like the red
            Cancel Placement button. Reveals the same two-way notify choice the
            calendar drawer uses; both call cancelInterview verbatim. */}
        {isEdit && existingInterview && (
          <div className="mt-4 border-t border-court-border/40 pt-3">
            {!cancelChoiceOpen ? (
              <>
                <button
                  type="button"
                  onClick={() => setCancelChoiceOpen(true)}
                  disabled={cancelPending || isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50/50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                >
                  {cancelPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <AlertTriangle className="h-3 w-3" />
                  )}
                  Cancel interview
                </button>
                <p className="mt-1 text-[11px] text-court-fg-muted">
                  Cancels the whole interview and removes every calendar invite tied to it.
                </p>
              </>
            ) : (
              <div>
                <p className="text-[12px] text-court-fg">
                  Cancel the whole interview? This removes every calendar invite tied to it.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => doCancelInterview(true)}
                    disabled={cancelPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50/50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                  >
                    {cancelPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    Cancel &amp; notify guests
                  </button>
                  <button
                    type="button"
                    onClick={() => doCancelInterview(false)}
                    disabled={cancelPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50/50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                  >
                    Cancel without notifying
                  </button>
                  <button
                    type="button"
                    onClick={() => setCancelChoiceOpen(false)}
                    disabled={cancelPending}
                    className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
                  >
                    Keep interview
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
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
      </div>
    </ModalShell>
    {/* Item #9: the three-way notify choice is now a small modal layered over
        the scheduler on Save. It owns its own Back/dismiss; the three buttons
        keep their exact labels + their existing commitEdit() wiring. */}
    {isEdit && askNotify && (
      <NotifyChoiceModal
        onChoose={commitEdit}
        onBack={() => setAskNotify(false)}
        isPending={isPending}
      />
    )}
    </>
  );
}

// Item #9: small modal for the edit-mode update-choice. Layered over the
// scheduler (z above ModalShell's z-[200]); portals to body so the backdrop
// covers the viewport. The three choices wire straight into commitEdit, which
// owns the close-on-success / close-on-error behavior; updateInterview's
// notifyMode engine and the mayNotify gate are unchanged.
function NotifyChoiceModal({
  onChoose,
  onBack,
  isPending,
}: {
  onChoose: (mode: "all" | "new_only" | "none") => void;
  onBack: () => void;
  isPending: boolean;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[210] overflow-y-auto bg-ink/40 p-4 sm:p-6"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex min-h-full items-center justify-center">
        <div className="w-full max-w-sm rounded-xl border border-court-border bg-court-surface p-5 shadow-xl">
          <p className="text-sm font-semibold text-court-fg">Send updated invites?</p>
          <p className="mt-0.5 text-[12px] text-court-fg-muted">
            The calendar time moves either way. This only controls who gets emailed.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onChoose("all")}
              disabled={isPending}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-court-brand bg-court-brand-tint px-4 py-2 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Update all guests
            </button>
            <button
              type="button"
              onClick={() => onChoose("new_only")}
              disabled={isPending}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-court-border bg-court-surface px-4 py-2 text-xs font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle disabled:opacity-60"
            >
              Update only new guests
            </button>
            <button
              type="button"
              onClick={() => onChoose("none")}
              disabled={isPending}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-court-border bg-court-surface px-4 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              Don&apos;t send updates
            </button>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onBack}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Toggle header + collapsible editor body for one invite party. The switch
// matches the Ace reminder toggle pattern (Button Standard: rounded-full is
// allowed on toggle switches).
function InviteToggleSection({
  label,
  hint,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  hint: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}) {
  // Phones only: the subject + body editor starts collapsed behind an
  // "Edit email copy" disclosure. Both editors expanded were roughly half the
  // scheduler's height on mobile, and the default template copy is what gets
  // sent the large majority of the time — the toggle still controls whether
  // the email goes out at all, this only hides the editing surface until it's
  // wanted. Desktop is unchanged: always expanded when the toggle is on.
  const narrow = useIsNarrowViewport();
  const [editorOpen, setEditorOpen] = useState(false);
  const showEditor = enabled && (!narrow || editorOpen);

  return (
    <div className="rounded-xl border border-court-border bg-court-surface p-2.5 sm:p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-court-fg">{label}</div>
          <div className="break-words text-[11.5px] text-court-fg-muted">{hint}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={label}
          onClick={() => onToggle(!enabled)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
            enabled ? "bg-brand" : "bg-court-fg-muted/40",
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
              enabled ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
      {enabled && narrow && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditorOpen((v) => !v)}
          className="-ml-1 mt-1.5 px-1 text-[11px] shadow-none"
        >
          {editorOpen ? "Hide email copy" : "Edit email copy"}
        </Button>
      )}
      {showEditor && <div className="mt-2 sm:mt-3">{children}</div>}
    </div>
  );
}
