"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Loader2,
  Paperclip,
  Send,
  Target,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmailComposer, type EmailDraft } from "@/components/email-composer";
import {
  applyLocalCandidateToJob,
  generateLocalPublicAccountingSubmittalBullets,
  generateLocalSubmittal,
  sendLocalSubmittalEmail,
} from "@/app/candidates/[id]/local-placement-actions";
import { formatOpenJobOption } from "@/components/placements/placement-shared";
import { extractCityFromLocation } from "@/lib/candidate-compensation";
import {
  applyMergeFields as applyMergeFieldsClient,
  buildSmartGreeting,
  type MergeFieldValues,
} from "@/lib/merge-fields";
import { submittalMarkdownToEditorHtml } from "@/lib/submittal-format";
import { TEAM_BCC_OPTIONS } from "@/lib/team-contacts";
import {
  LOCAL_PLACEMENT_APPLIED_EVENT,
  type LocalPlacementAppliedDetail,
} from "@/app/candidates/[id]/local-placement-rows";

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
  // Pre-formatted location + compensation strings for the Apply-to-Job
  // dropdown. Empty strings when the job payload didn't carry them; the
  // option renderer just omits the separator. Populated off normalizeJob
  // in local-profile.tsx.
  jobLocation?: string;
  jobCompensation?: string;
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

const DEFAULT_SUBMITTAL_BCC = [
  TEAM_BCC_OPTIONS.find((contact) => contact.id === "teammate-andrew")?.email ??
    "andrew@breakpointtalent.com",
];

export function LocalCandidateActions(props: {
  candidateId: string;
  candidateName: string;
  candidateFirstName: string;
  candidateEmail: string | null;
  candidateLocation?: string | null;
  candidateCompensation?: string | null;
  openJobs: LocalOpenJob[];
  // Display name of the candidate's most recent resume version on file,
  // or null when none exists. Surfaced in the Submit composer so the
  // recruiter sees which resume will be auto-attached (the actual bytes
  // are fetched + attached server-side in sendLocalSubmittalEmail). Null
  // drives the "no resume on file" note instead of an attachment chip.
  latestResumeName?: string | null;
  // When true, render only the modals; the standalone Apply/Submit
  // button row is suppressed. Used by the candidate profile page so
  // the buttons live in the page header instead, while modals still
  // mount here and respond to the URL deep-link triggers below.
  hideButtons?: boolean;
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
    // ?openApply=1 / ?openSubmit=1 — header-button entry points that
    // open the modal without a pre-selected job. The numeric ?submit=
    // path stays the per-row deep link.
    const openApply = searchParams?.get("openApply");
    const openSubmit = searchParams?.get("openSubmit");
    let jobId: number | null = null;
    let nextModal: "apply" | "submit" | null = null;
    const paramsToStrip: string[] = [];
    if (openApply) {
      nextModal = "apply";
      paramsToStrip.push("openApply");
    } else if (openSubmit) {
      nextModal = "submit";
      paramsToStrip.push("openSubmit");
    } else if (submitParam) {
      const n = Number(submitParam);
      if (Number.isFinite(n)) jobId = n;
      nextModal = "submit";
      paramsToStrip.push("submit");
    } else if (composeParam === "submittal" && jobIdParam) {
      const n = Number(jobIdParam);
      if (Number.isFinite(n)) jobId = n;
      nextModal = "submit";
      paramsToStrip.push("compose", "jobId");
    }
    if (!nextModal) return;
    if (jobId != null) setSubmitInitialJobRfId(jobId);
    setModal(nextModal);
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    for (const key of paramsToStrip) next.delete(key);
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchParams, pathname, router]);

  return (
    <div className={props.hideButtons ? "contents" : "rounded-xl border border-court-border/40 bg-court-surface px-5 py-4 shadow-sm"}>
      {!props.hideButtons && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setModal("submit")}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-sm font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25"
          >
            <Send className="h-3 w-3" /> Submit
          </button>
          <Button
            type="button"
            size="sm"
            variant="apply"
            onClick={() => setModal("apply")}
          >
            <Target className="h-3 w-3" /> Apply to Job
          </Button>
        </div>
      )}

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
          candidateFirstName={props.candidateFirstName}
          candidateEmail={props.candidateEmail}
          candidateLocation={props.candidateLocation ?? null}
          candidateCompensation={props.candidateCompensation ?? null}
          openJobs={props.openJobs}
          latestResumeName={props.latestResumeName ?? null}
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
      props.onClose();
      // Optimistic pill: tell LocalPlacementRows to drop in an Applied row
      // immediately so the job pill shows without a reload. Mirrors how the
      // Reject action updates its pill from local state. The 500 ms RSC
      // refetch below reconciles the optimistic row with server truth (and
      // refreshes pipeline / applicants / jobs) once the write commits.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<LocalPlacementAppliedDetail>(LOCAL_PLACEMENT_APPLIED_EVENT, {
            detail: {
              candidateId: props.candidateId,
              jobRfId: job.jobRfId,
              jobTitle: job.jobTitle,
              jobLocation: job.jobLocation ?? "",
              clientRfId: job.clientRfId,
              clientName: job.clientName,
              clientContacts: job.clientContacts ?? [],
            },
          }),
        );
      }
      // Delay the RSC refetch by 500 ms so the Postgres insert (and any
      // read-replica replication) commits before LocalPlacementRows
      // re-reads. Immediate router.refresh() raced the commit — the
      // refreshed jobs prop arrived without the new placement and the
      // pill flickered out the moment the refresh landed. The optimistic
      // row above covers the gap so the pill never disappears.
      setTimeout(() => router.refresh(), 500);
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
        <Button
          type="button"
          size="sm"
          variant="apply"
          onClick={onSubmit}
          disabled={isSubmitting || !jobRfId || selectable.length === 0}
        >
          {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />}
          Apply
        </Button>
      </div>
    </ModalShell>
  );
}

// ---- Submit modal ----

function SubmitModal(props: {
  candidateId: string;
  candidateName: string;
  candidateFirstName: string;
  candidateEmail: string | null;
  candidateLocation?: string | null;
  candidateCompensation?: string | null;
  openJobs: LocalOpenJob[];
  // Most recent resume version name on file (null = none). Shown in the
  // composer as the auto-attached file; the bytes are attached server-side.
  latestResumeName?: string | null;
  // The job to submit to. Every Submit entry point (job pill row,
  // applicants table, pipeline row) deep-links with the job id, so the
  // composer always opens on a known job - there is no job picker.
  initialJobRfId?: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const job =
    props.initialJobRfId != null
      ? props.openJobs.find((j) => j.jobRfId === props.initialJobRfId) ?? null
      : null;

  // Defensive: with no resolvable job there is nothing to compose against.
  // The live Submit buttons always pass a job, so this only guards the
  // dead no-job entry point rather than rendering a broken form.
  if (!job) return null;

  // Last-name fallback for templates that interpolate {{candidateLastName}}.
  // candidateFirstName comes through cleanly from upstream; for last name we
  // derive from candidateName by stripping the first token rather than
  // adding another prop drill for a field templates rarely reference.
  const candidateLastName = (() => {
    const parts = (props.candidateName ?? "").trim().split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(" ") : "";
  })();
  // Subject defaults to whatever the selected template resolves to (handled
  // by resolveTemplate below + EmailComposer's empty-subject auto-apply).
  // When no template is picked, the composer hands an empty subject to
  // onSend and we substitute this fallback so the email always ships with
  // a sane subject. Same fallback format the RF submittal composer uses.
  const fallbackSubject = `Candidate Submittal - ${props.candidateName} | ${job.jobTitle}`;
  // Subject filled by Generate with Claude when the subject field is
  // still empty (no template picked, nothing hand-typed). Format requested
  // by Andrew: "<Candidate Name> - <Job Title> for <Client Company Name>".
  // Passed to EmailComposer via generateFallbackSubject so the existing
  // mechanism at email-composer.tsx:648-650 fills it right after setBody.
  // Kept distinct from fallbackSubject above so the post-send fallback
  // (which only fires if the recruiter clears the subject before send)
  // stays in its established shape.
  const generateSubject = `${props.candidateName} - ${job.jobTitle} for ${job.clientName}`;
  const contactOptions = (job.clientContacts ?? []).map((c) => ({
    id: String(c.id),
    name: c.name,
    email: c.email,
  }));
  const primaryContact = (job.clientContacts ?? []).find((c) => c.email) ?? null;
  const primaryContactFirst = primaryContact?.name?.trim().split(/\s+/)[0] ?? "";
  const baseMergeValues: MergeFieldValues = {
    candidateFirstName: props.candidateFirstName,
    candidateLastName,
    candidateFullName: props.candidateName,
    candidateEmail: props.candidateEmail ?? "",
    candidateLocation: props.candidateLocation ?? "",
    candidateCity: extractCityFromLocation(props.candidateLocation ?? ""),
    candidateCompensation: props.candidateCompensation || "open / to be discussed",
    clientCompanyName: job.clientName,
    clientContactFullName: primaryContact?.name ?? "",
    clientContactFirstName: primaryContactFirst,
    jobTitle: job.jobTitle,
    jobLocation: job.jobLocation ?? "",
    jobSalaryRange: job.jobCompensation ?? "",
  };
  const templateTextIncludesPublicAccountingBullets = (t: { subject: string; body: string }) => {
    const text = `${t.subject}\n${t.body}`;
    return (
      text.includes("[Public Accounting Submittal Bullets]") ||
      text.includes("{{public_accounting_submittal_bullets}}")
    );
  };

  return (
    <EmailComposer
      title="Submittal email"
      subtitle={`${props.candidateName} → ${job.jobTitle}${job.clientName ? ` · ${job.clientName}` : ""}`}
      draftKey={`local-submittal-${props.candidateId}-${job.jobRfId}`}
      // Subject + body both start empty so the picked template wins the
      // EmailComposer's empty-field auto-apply (no "replace?" prompt). The
      // fallback subject lands in onSend below if the recruiter ships
      // without picking a template.
      initial={{ to: [], cc: [], bcc: DEFAULT_SUBMITTAL_BCC, subject: "", body: "" }}
      recipientOptions={contactOptions.length > 0 ? contactOptions : undefined}
      // Multi-recipient To: pick from the client contacts or type any
      // address as chips (same as Cc), so a submittal can go to more than
      // one client contact. The send path already passes the full to array.
      toOptions={contactOptions.length > 0 ? contactOptions : undefined}
      onClose={props.onClose}
      sendLabel="Send Submittal"
      sendingLabel="Sending…"
      helperText="Pick a client contact, then Generate with Claude or write the submittal yourself."
      showGenerateInstructions
      generateInstructionsLabel="Submittal guidance for Claude"
      generateInstructionsPlaceholder="Example: focus on Game Plan notes about motivation, recent call notes, and why their tax background fits this role."
      showTemplatePicker
      templateFilter={(t) => t.audience !== "candidate"}
      mergeValues={baseMergeValues}
      richTextBody
      toEditorHtml={submittalMarkdownToEditorHtml}
      showCandidateConfirmationToggle
      // Always show what's being attached. The latest resume version on
      // file is auto-attached server-side on send (sendLocalSubmittalEmail);
      // when none exists, surface a clear note rather than failing silently.
      attachmentsSlot={
        props.latestResumeName ? (
          <div className="flex items-center gap-2 text-xs text-court-fg">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-court-fg-muted" />
            <span>
              Attaching latest resume:{" "}
              <span className="font-semibold">{props.latestResumeName}</span>
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              No resume on file for this candidate - the submittal will send
              without an attachment.
            </span>
          </div>
        )
      }
      resolveTemplate={async (t) => {
        // Mirror of the RF submittal composer's resolver — runs merge-field
        // interpolation against the candidate + job + primary client
        // contact so picked templates land with real values instead of
        // raw {{candidateFullName}} / {{clientCompanyName}} tokens.
        let values = baseMergeValues;
        if (templateTextIncludesPublicAccountingBullets(t)) {
          const res = await generateLocalPublicAccountingSubmittalBullets({
            candidateId: props.candidateId,
            jobRfId: job.jobCuid ? null : job.jobRfId,
            jobId: job.jobCuid ?? null,
          });
          if (!res.ok) throw new Error(res.error);
          values = {
            ...baseMergeValues,
            publicAccountingSubmittalBullets: res.value.bullets,
          };
        }
        return {
          subject: applyMergeFieldsClient(t.subject, values),
          body: applyMergeFieldsClient(t.body, values),
        };
      }}
      // Empty-subject auto-fill on Generate. EmailComposer's onGenerateClick
      // runs this right after setBody, only when the subject is empty —
      // so a picked template's subject or a hand-typed subject is never
      // clobbered.
      generateFallbackSubject={generateSubject}
      onGenerate={async (_draft, { instructions, toRecipients }) => {
        const res = await generateLocalSubmittal({
          candidateId: props.candidateId,
          jobRfId: job.jobCuid ? null : job.jobRfId,
          jobId: job.jobCuid ?? null,
          instructions,
          clientGreeting: buildSmartGreeting(toRecipients),
        });
        if (!res.ok) throw new Error(res.error);
        return res.value.writeup;
      }}
      onSend={async (draft: EmailDraft) => {
        const res = await sendLocalSubmittalEmail({
          candidateId: props.candidateId,
          jobRfId: job.jobCuid ? null : job.jobRfId,
          jobId: job.jobCuid ?? null,
          clientRfId: job.clientCuid ? null : job.clientRfId,
          clientId: job.clientCuid ?? null,
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          // Empty subject means no template was picked and the recruiter
          // didn't type one either — drop in the hardcoded fallback so
          // we never ship an empty-subject email.
          subject: draft.subject.trim() || fallbackSubject,
          bodyText: draft.body,
          bodyHtml: draft.bodyHtml,
          sendCandidateConfirmation: draft.sendCandidateConfirmation ?? true,
        });
        if (!res.ok) throw new Error(res.error);
        toast.success(`Submitted ${props.candidateName} to ${job.jobTitle}`);
        router.refresh();
        props.onClose();
      }}
    />
  );
}

// ---- Shared UI ----

function ModalShell({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  // Optional pinned footer. When provided, it stays fixed at the bottom of
  // the panel while the content area between header and footer scrolls -
  // so a long generated submittal can never push Send Submittal off
  // screen. Callers without a footer keep their buttons inside children.
  footer?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      {/* Capped to the viewport (backdrop has 1rem padding each side) and
          laid out as header / scroll area / footer so the footer never
          scrolls out of reach. */}
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-court-border px-5 py-3">
          <h3 className="font-serif text-lg font-semibold text-court-fg">{title}</h3>
          <button type="button" onClick={onClose} className="text-court-fg-muted hover:text-court-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-court-border px-5 py-3">{footer}</div>
        )}
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
        <option value="">Pick a job…</option>
        {openJobs.map((j) => (
          <option key={j.jobRfId} value={j.jobRfId} disabled={j.alreadyLinked}>
            {formatOpenJobOption(j)}
          </option>
        ))}
      </select>
      {openJobs.length === 0 && (
        <p className="mt-1 text-[11px] text-court-fg-muted">No open jobs found.</p>
      )}
    </label>
  );
}
