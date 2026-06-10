"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { Bookmark, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, DollarSign, Edit3, Handshake, Loader2, Search, Send, UserX, X } from "lucide-react";
import { INPUT_FRAME_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import { toast } from "sonner";
import { PIPELINE_LABELS } from "@/lib/rf-payload-shapes";
import { StageAgePill } from "@/components/ui/stage-age-pill";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DataTableBody,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from "@/components/ui/data-table";
import { TabStrip } from "@/components/ui/tab-strip";
import { rejectLocalPlacement } from "@/app/candidates/[id]/local-placement-actions";
import { rejectCandidateJob } from "@/app/candidates/[id]/placement-actions";
import {
  keepCandidateForJob,
  keepLocalCandidateForJob,
  rejectLocalCandidateJob,
  removeKeptCandidate,
  removeLocalKeptCandidate,
} from "@/app/pipeline/applicants-actions";
import { setCandidateNavList } from "@/lib/candidate-nav";
import { RejectCandidateDialog } from "@/components/reject-candidate-dialog";
import {
  PlacementEditDrawer,
  type PlacementDrawerContext,
} from "@/app/pipeline/placement-edit-drawer";
import {
  GuaranteePeriodTable,
  type GuaranteePeriodRow,
} from "@/components/placements/guarantee-period-table";
import { resolveGuaranteeEnd } from "@/components/placements/guarantee-period-utils";

// Stage type now includes the two intake stages that used to live on
// /applicants. PIPELINE_LABELS only covers the main 5 (its type
// excludes applied/kept on purpose to keep counters that aren't pipeline-
// progression-aware honest), so a local label override carries the
// intake-stage labels.
// "cancelled" is a terminal stage gated behind the Show Cancelled toggle;
// it's part of Stage so counts/tabs can address it, but only renders in
// the StageTabs strip when the recruiter opts in.
type Stage = "applied" | "kept" | "cancelled" | keyof typeof PIPELINE_LABELS;

const STAGE_LABEL: Record<Stage, string> = {
  applied: "Applicants",
  kept: "Kept",
  cancelled: "Cancelled",
  ...PIPELINE_LABELS,
};

export type OwnerScope = "mine" | "theirs" | "all";

// Client-side sortable columns shared by the main pipeline table and the
// intake (Applicants/Kept) table. "distance" = Location column (numeric
// miles to the job), "lastAction" = Updated / Last Action column. The
// main table also supports a null (no active sort) state so it can fall
// back to the server-provided default order; the intake table always
// carries one of its IntakeSortKey values.
type MainSortKey = "distance" | "lastAction";
type SortDir = "asc" | "desc";

// Shared distance comparator. Rows with no resolvable distance (null /
// undefined / non-finite) always sort to the BOTTOM regardless of
// direction - the null checks return a fixed sign independent of `mul`,
// so they never interleave and the subtraction never sees a NaN. Used by
// both the main pipeline sort and the intake table's "distance" key so
// the two tables behave identically.
function compareDistance(
  a: number | null | undefined,
  b: number | null | undefined,
  mul: number,
): number {
  const aMissing = a == null || !Number.isFinite(a);
  const bMissing = b == null || !Number.isFinite(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return (a - b) * mul;
}

export type PlacementDetails = {
  id: string;
  stage: "offer" | "pending_start" | "hired";
  syncedToRf: boolean;
  acceptedSalary: number | null;
  acceptedCurrency: string | null;
  feePercentage: number | null;
  feeTotal: number | null;
  billingContactName: string | null;
  billingContactEmail: string | null;
  expectedStartDate: string | null;
  startConfirmedAt: string | null;
  invoiceStatus: "DRAFT" | "SENT" | "PAID" | null;
  // How the client paid this invoice. Set when the recruiter flips
  // the invoice to PAID; null on any pre-paid status. Surfaced as a
  // sub-label on the Invoicing pill so the desk can scan payment mix.
  invoicePaymentMethod: "CHECK" | "ACH" | "CREDIT" | null;
  placementNotes: string | null;
  candidateSource: string | null;
  cityOverride: string | null;
  // Custom payment agreement fields, threaded through to seed the edit
  // drawer. customGuaranteeDate is an ISO string (serialized in
  // toPlacementDetails), matching the expectedStartDate convention.
  useCustomTerms: boolean;
  installmentCount: number | null;
  inst1Amount: number | null;
  inst1DaysAfterStart: number | null;
  inst2Amount: number | null;
  inst2DaysAfterStart: number | null;
  inst3Amount: number | null;
  inst3DaysAfterStart: number | null;
  customGuaranteeDate: string | null;
  // Default guarantee window in days from start. Drives the "Guarantee
  // Period" countdown card below the hired table (resolved against
  // customGuaranteeDate when both are present).
  guaranteePeriodDays: number | null;
};

export type NextInterview = {
  id: string;
  scheduledAt: string;
  type: "phone_screen" | "video" | "in_person";
};

export type PipelineRow = {
  // Phase 4b: candidateId / jobId can be a legacy numeric RF id
  // (RF-imported rows) or a cuid (Ace-native rows). The /candidates/[id]
  // and /jobs/[id] routes resolve both shapes via their identifier-based
  // loaders so the Link hrefs work for either.
  candidateId: number | string;
  candidateName: string;
  candidateTitle: string;
  // Ace 68.0: uniform LEFT column inputs for the pipeline column-
  // standardization pass. Employer is the candidate's CURRENT employer
  // (not the job they applied to). Location is "City, ST" via the shared
  // formatLocation helper. ExpectedSalary is the candidate's expectation
  // ({ number, currency }.number); null = blank cell per Item 2 of the
  // spec ("if unknown, render the cell fully blank"). Verified mirrors
  // the /clients + /jobs `isVerified` signal so the badge shows next to
  // the Client cell when the client has a signed agreement on file.
  candidateEmployer: string;
  candidateLocation: string;
  candidateExpectedSalary: number | null;
  jobId: number | string;
  jobTitle: string;
  clientName: string;
  clientIsVerified: boolean;
  stageName: string;
  bucket: keyof typeof PIPELINE_LABELS;
  lastActionAt: string | null;
  daysInStage: number | null;
  isKept: boolean;
  // Neon Placement.id — present only for rows derived from a real
  // Placement row. RF-flat-pipeline rows (RFCandidate.jobs[] entries
  // with no Neon Placement) leave this null; the Reject button below
  // hides on those rows since there's no Placement to mutate.
  placementId: string | null;
  placement: PlacementDetails | null;
  nextInterview: NextInterview | null;
  // Pre-computed "(N miles)" sub-line for the Location cell, attached
  // server-side in pipeline/page.tsx. Empty string when any required
  // input is missing (no candidate lat/lng, no job zip/city/state, or
  // Nominatim couldn't resolve the job side). The Location cell renders
  // this verbatim below "City, ST"; blank string renders nothing per the
  // spec ("no dash, no placeholder, no N/A").
  distanceLine: string;
  // Numeric miles for the sortable Location column. Undefined/null when
  // no distance resolves - those rows sort to the bottom in both
  // directions. Set alongside distanceLine in pipeline/page.tsx.
  distanceMiles?: number | null;
};

// Intake-stage row shapes (Applicants + Kept). polymorphic ids match
// PipelineRow — RF numeric for imported, cuid for Ace-native.
// Ace 68.0: intake rows now carry the same uniform LEFT column inputs
// as PipelineRow (candidateTitle / candidateEmployer / candidateLocation
// / candidateExpectedSalary / clientIsVerified) so the Applicants + Kept
// tables can share the LEFT column set with the main pipeline tabs.
export type AppliedRow = {
  candidateId: number | string;
  candidateName: string;
  candidateTitle: string;
  candidateEmployer: string;
  candidateLocation: string;
  candidateExpectedSalary: number | null;
  jobId: number | string;
  jobTitle: string;
  jobLocation: string;
  clientRfId: number | null;
  clientName: string;
  clientIsVerified: boolean;
  appliedAt: string | null;
  source: string | null;
  // Owner of the parent client. Resolved server-side so the page-level
  // owner-scope filter can apply the same Mine/Theirs/All cut here.
  clientOwnerId: string | null;
  // "(X.X mi)" Location-cell sub-line, attached server-side for the
  // Applicants tab the same way the main pipeline rows get it (Item 1A).
  // Blank when candidate lat/lng or the job location can't resolve.
  distanceLine?: string;
  // Numeric miles for the sortable Location column (Item 1).
  distanceMiles?: number | null;
};

export type KeptRow = {
  candidateId: number | string;
  candidateName: string;
  candidateTitle: string;
  candidateEmployer: string;
  candidateLocation: string;
  candidateExpectedSalary: number | null;
  jobId: number | string;
  jobTitle: string;
  jobLocation: string;
  clientRfId: number | null;
  clientName: string;
  clientIsVerified: boolean;
  keptAt: string;
  clientOwnerId: string | null;
  // "(X.X mi)" Location-cell sub-line (Item 1A) — same shape + blank rule
  // as the main pipeline + Applicants rows.
  distanceLine?: string;
  // Numeric miles for the sortable Location column (Item 1).
  distanceMiles?: number | null;
};

type PipelineViewProps = {
  rows: PipelineRow[];
  appliedRows: AppliedRow[];
  keptRows: KeptRow[];
  // Cancelled placements, surfaced inside the Hired tab's list (no
  // separate tab). Empty unless the active stage is "hired".
  cancelledRows: PipelineRow[];
  stage: Stage;
  q: string;
  counts: Record<Stage, number>;
  owner: OwnerScope;
  otherUserName: string | null;
  error: string | null;
};

// Intake stages render before the main-pipeline stages so the strip
// reads in the order a candidate moves through it (Applicants → Kept →
// Submitted → Interviewing → Offer → Pending Start → Hired).
const STAGE_ORDER: Stage[] = [
  "applied",
  "kept",
  "submitted",
  "interviewing",
  "offer",
  "pending_start",
  "hired",
  // "cancelled" is intentionally NOT a tab. Cancelled placements render
  // inside the Hired tab's list (subdued, Cancelled-chipped) rather than
  // behind a toggle — see the Hired-tab render below.
];

// Stages where per-row Reject (and therefore bulk Reject) is offered.
// Pending Start + Hired have their own custom action cells and aren't
// in the rejection flow — those are "deal in flight / closed" states.
const REJECTABLE_STAGES: Stage[] = ["submitted", "interviewing", "offer"];

function isRejectableStage(s: Stage): boolean {
  return (REJECTABLE_STAGES as readonly Stage[]).includes(s);
}

function isIntakeStage(s: Stage): s is "applied" | "kept" {
  return s === "applied" || s === "kept";
}

// Ace 68.0 — shared uniform LEFT column set across every stage. The
// non-offer stages render checkbox + Candidate + Current Title/Employer
// + Location + Salary + Client + Job + Last Action (7 data columns + the
// far-left checkbox). Offer stage appends Offer Amount + Placement Fee
// inside the stage-specific RIGHT block. Stage-specific RIGHT columns
// (Days in Stage, Billing Contact, Invoicing, Days Until, action chips,
// Source, etc.) keep rendering after the uniform LEFT cells.
//
// UniformLeftRowShape is the minimum a row must carry to feed
// UniformLeftRowCells. Both PipelineRow and the intake AppliedRow /
// KeptRow satisfy this shape (verified by the prop typing on the helper
// below), so the same cells render on every table.
type UniformLeftRowShape = {
  candidateId: number | string;
  candidateName: string;
  candidateTitle: string;
  candidateEmployer: string;
  candidateLocation: string;
  candidateExpectedSalary: number | null;
  jobId: number | string;
  jobTitle: string;
  clientName: string;
  clientIsVerified: boolean;
  isKept?: boolean;
  // Optional Location-cell sub-line ("(N miles)"). Set on main-pipeline
  // rows by pipeline/page.tsx; intake (AppliedRow/KeptRow) rows leave it
  // undefined so the cell renders only "City, ST" on those tabs. Always
  // rendered verbatim — empty / undefined leaves the sub-line blank.
  distanceLine?: string;
};

// Inline shield SVG copied from jobs-view.tsx to keep the verified-
// client glyph identical across surfaces. Sharing a component is a
// future refactor (jobs-view + clients-view + this file all hold a copy).
function VerifiedShield() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-court-brand"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

// Candidate expected salary formatter. Returns the empty string when
// the value is missing so the Salary cell renders fully blank per
// Item 2 of the column-standardization spec ("if unknown, render the
// cell fully blank. No dash, no placeholder."). USD assumed — every
// pipeline candidate today carries USD; non-USD currencies fall through
// to the same "$" prefix because the pipeline display does not
// distinguish currencies (the placement-side cells do, via formatMoney).
function formatExpectedSalary(n: number | null): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "";
  return `$${n.toLocaleString()}`;
}

// Six uniform LEFT header cells for the main pipeline table. When sort
// props are passed the Location (distance) and Last Action columns become
// clickable, reusing the IntakeColHeader chevron affordance so the main
// table sorts identically to the intake (Applicants/Kept) table. Without
// the props they render as plain headers (unchanged default).
// Job + Client are one combined "Job/Client" column (job title primary,
// client name as the muted sub-line) — the brief's column merge.
function UniformLeftHeaderCells({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey?: MainSortKey | null;
  sortDir?: SortDir;
  onSort?: (k: MainSortKey) => void;
} = {}) {
  return (
    <>
      <DataTableHeaderCell>Candidate</DataTableHeaderCell>
      <DataTableHeaderCell>Current Title/Employer</DataTableHeaderCell>
      {onSort ? (
        <IntakeColHeader
          label="Location"
          active={sortKey === "distance"}
          dir={sortDir ?? "asc"}
          onClick={() => onSort("distance")}
        />
      ) : (
        <DataTableHeaderCell>Location</DataTableHeaderCell>
      )}
      <DataTableHeaderCell align="right">Salary</DataTableHeaderCell>
      <DataTableHeaderCell>Job/Client</DataTableHeaderCell>
      {onSort ? (
        <IntakeColHeader
          label="Last Action"
          active={sortKey === "lastAction"}
          dir={sortDir ?? "desc"}
          onClick={() => onSort("lastAction")}
          align="center"
        />
      ) : (
        <DataTableHeaderCell align="center">Last Action</DataTableHeaderCell>
      )}
    </>
  );
}

// Six uniform LEFT body cells. `lastActionAt` is passed in because
// each row source carries it under a different key (PipelineRow uses
// lastActionAt; AppliedRow uses appliedAt; KeptRow uses keptAt). The
// stop-propagation pattern on the Candidate / Job links matches the
// existing per-cell wrappers so the row's outer onClick (navigate to
// candidate profile) doesn't double-fire when the recruiter clicks the
// link inside the cell.
function UniformLeftRowCells({
  row,
  lastActionAt,
}: {
  row: UniformLeftRowShape;
  lastActionAt: string | null;
}) {
  return (
    <>
      {/* Candidate. Name + optional Kept badge. Ace 68.0 polish: the
          AK-style initials circle that used to sit to the left of the
          name is removed per recruiter feedback (visual noise on a
          high-density table). The title sub-line that used to live
          here lives in the dedicated "Current Title/Employer" column. */}
      <td className="px-3 py-2 align-top">
        <div className="min-w-0">
          <Link
            href={`/candidates/${row.candidateId}`}
            className="inline-flex items-center gap-1 font-medium text-court-fg hover:text-court-accent-dark"
            onClick={(e) => e.stopPropagation()}
          >
            {row.candidateName}
            {row.isKept && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-800 dark:bg-blue-950/60 dark:text-blue-100"
                title="Kept candidate"
              >
                <Bookmark className="h-2.5 w-2.5" /> Kept
              </span>
            )}
          </Link>
        </div>
      </td>

      {/* Current Title/Employer. Two-line cell: title on top (regular
          text), employer on the existing smaller sub-line style. Either
          line is fine on its own; both blank renders a fully empty cell
          (no placeholder dash — matches the Salary rule). */}
      <td className="px-3 py-2 align-top">
        <div className="min-w-0">
          {row.candidateTitle && (
            <div className="truncate text-sm text-court-fg">{row.candidateTitle}</div>
          )}
          {row.candidateEmployer && (
            <div className="truncate text-xs text-court-fg-muted">{row.candidateEmployer}</div>
          )}
        </div>
      </td>

      {/* Location. "City, ST" via shared formatLocation pass on the
          server (RF-flat + Ace-native paths). Distance sub-line is
          pre-computed in pipeline/page.tsx via formatDistanceSubLine
          (haversine against the candidate's stored lat/lng and the
          job's zip-geocoded centroid). Blank `distanceLine` renders no
          second line per the spec ("no dash, no placeholder, no N/A"). */}
      <td className="px-3 py-2 align-top text-sm">
        <div className="min-w-0">
          {row.candidateLocation && (
            <div className="truncate text-court-fg-muted">{row.candidateLocation}</div>
          )}
          {row.distanceLine && (
            <div className="truncate text-[11px] text-court-fg-muted/80">
              {row.distanceLine}
            </div>
          )}
        </div>
      </td>

      {/* Salary. Candidate's expected salary. Blank cell on rows where
          the field is missing — no dash, no placeholder. */}
      <td className="px-3 py-2 align-top text-right text-sm text-court-fg">
        {formatExpectedSalary(row.candidateExpectedSalary)}
      </td>

      {/* Job/Client. Combined column matching the Current Title/Employer
          shape: job title is the primary top line (regular weight — the
          candidate name is the only bold element in the row), client name
          is the smaller muted sub-line below it. The verified shield rides
          next to the client name when the linked Client has a signed
          agreement on file (same isVerified signal /clients and /jobs use).
          Job title links to /jobs/[id]; clicking it doesn't fire the row's
          navigate-to-candidate onClick (stopPropagation). */}
      <td className="px-3 py-2 align-top text-sm">
        <div className="min-w-0">
          <Link
            href={`/jobs/${row.jobId}`}
            className="block truncate text-court-fg hover:text-court-accent-dark"
            onClick={(e) => e.stopPropagation()}
          >
            {row.jobTitle || "—"}
          </Link>
          {row.clientName && (
            <div className="flex items-center gap-1 min-w-0">
              <span className="truncate text-xs text-court-fg-muted">{row.clientName}</span>
              {row.clientIsVerified && (
                <span title="Client has a signed agreement">
                  <VerifiedShield />
                </span>
              )}
            </div>
          )}
        </div>
      </td>

      {/* Last Action. Formatted date from whichever timestamp the row
          source carries (placement.updatedAt / appliedAt / keptAt).
          text-sm + muted so it reads at the same metadata size as the
          Start Date cells (no Last-Action-vs-Start-Date size mismatch). */}
      <td className="px-3 py-2 align-top text-center text-sm text-court-fg-muted">
        {formatDate(lastActionAt)}
      </td>
    </>
  );
}

// Soft-green native dropdown matching the /clients OwnerScopeSelect
// styling, sized (py-1 + text-[13px]) to the stage-tab pill height so it
// stops visually competing with the tabs beside it. "Theirs" only renders
// when there is another user in the org. Navigates via the `owner` URL
// param so the server filter runs before pagination.
function OwnerScopeSelect({
  scope,
  onChange,
  otherName,
}: {
  scope: OwnerScope;
  onChange: (s: OwnerScope) => void;
  otherName: string | null;
}) {
  const otherFirst = otherName?.trim().split(/\s+/)[0] ?? null;
  return (
    <div className="relative shrink-0">
      <select
        value={scope}
        onChange={(e) => onChange(e.target.value as OwnerScope)}
        aria-label="Filter pipeline by owner"
        className="appearance-none rounded-md border border-court-brand/40 bg-court-brand/5 py-1 pl-3 pr-9 text-[13px] font-medium text-court-brand transition hover:bg-court-brand/10 focus:border-court-brand focus:outline-none focus:ring-2 focus:ring-court-brand/20"
      >
        <option value="mine">My Pipeline</option>
        {otherFirst && <option value="theirs">{otherFirst}&apos;s Pipeline</option>}
        <option value="all">All</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-court-brand" />
    </div>
  );
}

export function PipelineView({ rows, appliedRows, keptRows, cancelledRows, stage, q, counts, owner, otherUserName, error }: PipelineViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(q);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setQuery(q);
  }, [q]);

  // Main pipeline table client-side sort (Item 1/2). Mirrors the intake
  // table's sortKey/sortDir + toggle pattern, but the key is nullable so
  // "no active sort" falls back to the server-provided default order
  // (default ordering stays untouched). One column active at a time -
  // selecting Location clears Last Action and vice versa. Distance sorts
  // closest-first on first click (asc); Last Action newest-first (desc).
  const [mainSortKey, setMainSortKey] = useState<MainSortKey | null>(null);
  const [mainSortDir, setMainSortDir] = useState<SortDir>("asc");
  function toggleMainSort(k: MainSortKey) {
    if (mainSortKey === k) {
      setMainSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setMainSortKey(k);
      setMainSortDir(k === "lastAction" ? "desc" : "asc");
    }
  }
  // Reset the sort whenever the stage or search changes so a sort chosen
  // on one tab doesn't silently persist into the next (matches how the
  // selection state clears on stage/search flip below).
  useEffect(() => {
    setMainSortKey(null);
    setMainSortDir("asc");
  }, [stage, q]);

  // Display order for the main table. Null key = server default order
  // (same array reference, untouched). distance/lastAction re-sort a
  // shallow copy via the shared comparators; no-distance rows fall to the
  // bottom in both directions.
  const sortedRows = useMemo(() => {
    if (!mainSortKey) return rows;
    const mul = mainSortDir === "asc" ? 1 : -1;
    const out = [...rows];
    out.sort((a, b) => {
      if (mainSortKey === "distance") {
        return compareDistance(a.distanceMiles, b.distanceMiles, mul);
      }
      const ta = a.lastActionAt ? new Date(a.lastActionAt).getTime() : 0;
      const tb = b.lastActionAt ? new Date(b.lastActionAt).getTime() : 0;
      return (ta - tb) * mul;
    });
    return out;
  }, [rows, mainSortKey, mainSortDir]);

  // Bulk selection — rejectable rows only. Stores Placement.id so the
  // bulk handler can call rejectLocalPlacement directly without
  // re-deriving the id from row keys. Cleared when the stage/search
  // changes so a stale selection can't bulk-reject the wrong rows
  // after navigation. (Pagination dropped Ace 67.11 — pipeline tabs
  // now scroll the full filtered set, so there's no per-page slice
  // to invalidate selection against.)
  const [selectedPlacementIds, setSelectedPlacementIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Hired-stage rows open an inline edit drawer instead of routing to
  // the candidate profile — the drawer mutates the placement directly
  // (start date, salary, fees, notes) without leaving the pipeline.
  const [drawerCtx, setDrawerCtx] = useState<PlacementDrawerContext | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  function openPlacementDrawer(row: PipelineRow) {
    if (!row.placement || !row.placementId) return;
    setDrawerCtx({
      placementId: row.placementId,
      candidateName: row.candidateName,
      clientName: row.clientName,
      jobTitle: row.jobTitle,
      stage: row.placement.stage,
      stageLabel: row.stageName,
      expectedStartDate: row.placement.expectedStartDate,
      acceptedSalary: row.placement.acceptedSalary,
      feeTotal: row.placement.feeTotal,
      feePercentage: row.placement.feePercentage,
      placementNotes: row.placement.placementNotes,
      candidateSource: row.placement.candidateSource,
      cityOverride: row.placement.cityOverride,
      useCustomTerms: row.placement.useCustomTerms,
      installmentCount: row.placement.installmentCount,
      inst1Amount: row.placement.inst1Amount,
      inst1DaysAfterStart: row.placement.inst1DaysAfterStart,
      inst2Amount: row.placement.inst2Amount,
      inst2DaysAfterStart: row.placement.inst2DaysAfterStart,
      inst3Amount: row.placement.inst3Amount,
      inst3DaysAfterStart: row.placement.inst3DaysAfterStart,
      customGuaranteeDate: row.placement.customGuaranteeDate,
    });
    setDrawerOpen(true);
  }
  useEffect(() => {
    setSelectedPlacementIds(new Set());
  }, [stage, q]);

  // Ace 68.0 — far-left checkbox column on every stage so the structural
  // position stays identical across the whole pipeline (Item 1 of the
  // column-standardization spec). Bulk selection is still gated on
  // `isRejectableStage` — on Pending Start / Hired / Cancelled the
  // checkbox renders disabled because no bulk action is wired for those
  // stages today. The header checkbox is similarly inert when no row
  // qualifies. This keeps the table grid uniform without inventing new
  // bulk behavior.
  const showCheckboxCol = true;
  const rowsSelectable = isRejectableStage(stage);
  const selectableRows = useMemo(
    () => rows.filter((r) => r.placementId !== null && isRejectableStage(r.bucket)),
    [rows],
  );
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((r) => selectedPlacementIds.has(r.placementId as string));
  const someSelected =
    selectedPlacementIds.size > 0 && !allSelected;
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  function toggleRow(placementId: string) {
    setSelectedPlacementIds((prev) => {
      const next = new Set(prev);
      if (next.has(placementId)) next.delete(placementId);
      else next.add(placementId);
      return next;
    });
  }
  function toggleAll() {
    setSelectedPlacementIds((prev) => {
      if (prev.size === selectableRows.length && selectableRows.length > 0) {
        return new Set();
      }
      return new Set(selectableRows.map((r) => r.placementId as string));
    });
  }

  async function onBulkRejectConfirm({ sendRejectionEmail }: { sendRejectionEmail: boolean }) {
    const ids = Array.from(selectedPlacementIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    // Sequential with a small gap — Gmail rate-limits when the
    // rejection-email checkbox fires for every row, and Neon's pool
    // is friendlier under serial writes than a thundering herd.
    for (const id of ids) {
      try {
        const res = await rejectLocalPlacement({ placementId: id, sendRejectionEmail });
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setBulkRejectOpen(false);
    setSelectedPlacementIds(new Set());
    if (fail === 0) {
      toast.success(
        sendRejectionEmail
          ? `Rejected ${ok}. Emails sent`
          : `Rejected ${ok}`,
      );
    } else if (ok === 0) {
      toast.error(`Couldn't reject (${fail} failed)`);
    } else {
      toast.warning(`Rejected ${ok}, ${fail} failed`);
    }
    router.refresh();
  }

  // Stash the visible row ids so the candidate profile's Prev/Next
  // nav can walk through this exact stage's slice in the user's
  // current sort/filter order. Re-runs whenever the rendered rows
  // change (stage, search). String() coerces both numeric RF ids and
  // cuids into the routing form /candidates/[id] expects.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params2 = new URLSearchParams(params?.toString() ?? "");
    const qs = params2.toString();
    const backHref = qs ? `/pipeline?${qs}` : "/pipeline";
    const visibleIds = isIntakeStage(stage)
      ? (stage === "applied" ? appliedRows : keptRows).map((r) => String(r.candidateId))
      : sortedRows.map((r) => String(r.candidateId));
    setCandidateNavList({
      source: "pipeline",
      backHref,
      ids: visibleIds,
    });
  }, [sortedRows, appliedRows, keptRows, stage, params]);

  // Hired-tab guarantee rows: surface every hired placement that has been
  // billed or paid, has a start date, and still has an active guarantee
  // window. The live countdown + zero-day drop live inside the table
  // component. Empty array on any non-hired stage so the section disables
  // itself cleanly outside the Hired view.
  const guaranteeRows = useMemo<GuaranteePeriodRow[]>(() => {
    if (stage !== "hired") return [];
    const out: GuaranteePeriodRow[] = [];
    for (const r of rows) {
      const p = r.placement;
      if (!p) continue;
      if (p.invoiceStatus !== "SENT" && p.invoiceStatus !== "PAID") continue;
      if (!p.expectedStartDate) continue;
      const guaranteeEndIso = resolveGuaranteeEnd({
        startDateIso: p.expectedStartDate,
        guaranteePeriodDays: p.guaranteePeriodDays,
        customGuaranteeDateIso: p.customGuaranteeDate,
      });
      if (!guaranteeEndIso) continue;
      out.push({
        placementId: p.id,
        candidateName: r.candidateName,
        clientName: r.clientName,
        roleTitle: r.jobTitle || null,
        startDateIso: p.expectedStartDate,
        guaranteeEndIso,
      });
    }
    return out;
  }, [rows, stage]);

  const buildHref = (overrides: Record<string, string | number | undefined>): string => {
    const next = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === "" || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    return `/pipeline?${next.toString()}`;
  };

  function onSubmitSearch(e: FormEvent) {
    e.preventDefault();
    startTransition(() => {
      router.push(buildHref({ q: query }));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3 md:flex-row md:items-center">
        <StageTabs stage={stage} counts={counts} buildHref={buildHref} />
        <div className="md:ml-auto flex items-center gap-3">
          <OwnerScopeSelect
            scope={owner}
            otherName={otherUserName}
            onChange={(s) => {
              startTransition(() => {
                router.push(buildHref({ owner: s }));
              });
            }}
          />
        </div>
      </div>

      {/* Clients-style search: clean rounded input, icon inside, no green
          fill or submit button. Enter submits the form, which runs the
          existing server-side `?q=` search. */}
      <form onSubmit={onSubmitSearch} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
        <div className={INPUT_FRAME_CLASS}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by candidate, job, or client…"
            className={`${INPUT_CONTROL_CLASS} pl-10 pr-10 text-sm`}
          />
        </div>
      </form>

      {/* Error panel keeps red semantics in every mode. */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load the pipeline.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      {isIntakeStage(stage) ? (
        stage === "applied" ? (
          <IntakeTable
            kind="applied"
            applied={appliedRows}
            kept={[]}
          />
        ) : (
          <IntakeTable
            kind="kept"
            applied={[]}
            kept={keptRows}
          />
        )
      ) : (
        <>
          {showCheckboxCol && selectedPlacementIds.size > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-court-accent/40 bg-court-accent-tint px-4 py-2 text-sm shadow-sm">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-court-fg">
                  {selectedPlacementIds.size} selected
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedPlacementIds(new Set())}
                  className="inline-flex items-center gap-1 text-xs text-court-fg-muted transition hover:text-court-fg"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="reject"
                  size="sm"
                  onClick={() => setBulkRejectOpen(true)}
                  disabled={bulkBusy}
                  className="h-7 px-3 text-[11px]"
                >
                  {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
                  Reject {selectedPlacementIds.size}
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
            <div className="overflow-x-auto">
              {/* min-w-[1100px] holds the 6 uniform LEFT columns
                  (checkbox + Candidate + Current Title/Employer +
                  Location + Salary + Job/Client + Last Action) plus each
                  stage's RIGHT extras. Offer stage (LEFT + Offer Amount +
                  Placement Fee + Days in Stage + Action) is the widest; on
                  a 13" laptop the rightmost columns may still scroll
                  horizontally, but the column STRUCTURE stays identical
                  across every stage per the standardization spec. The
                  shared px-3 py-2 padding from data-table.tsx still
                  applies. */}
              <table className="w-full min-w-[1100px] text-left text-sm">
                <DataTableHead>
                  <tr className="bg-court-surface border-b border-court-border/60">
                    {/* Far-left checkbox column on every stage. Disabled
                        on stages where no bulk action is wired (Pending
                        Start / Hired / Cancelled). */}
                    <DataTableHeaderCell align="center">
                      <input
                        ref={headerCheckboxRef}
                        type="checkbox"
                        aria-label="Select all rejectable rows on this page"
                        checked={allSelected}
                        disabled={!rowsSelectable || selectableRows.length === 0}
                        onChange={toggleAll}
                        className="h-3.5 w-3.5 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </DataTableHeaderCell>
                    <UniformLeftHeaderCells
                      sortKey={mainSortKey}
                      sortDir={mainSortDir}
                      onSort={toggleMainSort}
                    />
                    {/* Stage-specific RIGHT columns. */}
                    {stage === "pending_start" ? (
                      <>
                        <DataTableHeaderCell align="center">Start Date</DataTableHeaderCell>
                        <DataTableHeaderCell align="center">Days Until</DataTableHeaderCell>
                        <DataTableHeaderCell align="right">Action</DataTableHeaderCell>
                      </>
                    ) : stage === "hired" ? (
                      <>
                        <DataTableHeaderCell align="center">Start Date</DataTableHeaderCell>
                        <DataTableHeaderCell align="center">Invoicing</DataTableHeaderCell>
                      </>
                    ) : stage === "offer" ? (
                      <>
                        <DataTableHeaderCell align="center">Offer Amount</DataTableHeaderCell>
                        <DataTableHeaderCell align="center">Placement Fee</DataTableHeaderCell>
                        <DataTableHeaderCell align="center">Days in Stage</DataTableHeaderCell>
                        <DataTableHeaderCell align="right" />
                      </>
                    ) : stage === "cancelled" ? (
                      // Cancelled tab is audit-only — no stage-specific
                      // extras, just the uniform LEFT set.
                      null
                    ) : (
                      <>
                        <DataTableHeaderCell align="center">Days in Stage</DataTableHeaderCell>
                        <DataTableHeaderCell align="right" />
                      </>
                    )}
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {rows.length === 0 &&
                    !error &&
                    !(stage === "hired" && cancelledRows.length > 0) && (
                    <tr>
                      <td
                        colSpan={
                          // Checkbox + 6 LEFT columns (Job/Client merged
                          // into one) + per-stage RIGHT. Hired RIGHT dropped
                          // to 2 (Start Date + Invoicing) after Billing
                          // Contact was removed.
                          1 +
                          6 +
                          (stage === "pending_start"
                            ? 3
                            : stage === "hired"
                              ? 2
                              : stage === "offer"
                                ? 4
                                : stage === "cancelled"
                                  ? 0
                                  : 2)
                        }
                        className="px-4 py-12 text-center text-sm text-court-fg-muted"
                      >
                        No candidates in {STAGE_LABEL[stage]}
                        {q ? ` matching "${q}"` : ""}.
                      </td>
                    </tr>
                  )}
                  {sortedRows.map((r) => (
                    <DataTableRow
                      key={`${r.candidateId}-${r.jobId}`}
                      className="cursor-pointer"
                      onClick={() => {
                        // Hired-stage rows open the inline edit drawer; every
                        // other stage keeps the existing candidate-profile
                        // jump (action buttons / links inside the row already
                        // stopPropagation, so their behaviour is unchanged).
                        if (r.bucket === "hired" && r.placement && r.placementId) {
                          openPlacementDrawer(r);
                          return;
                        }
                        router.push(`/candidates/${r.candidateId}`);
                      }}
                    >
                      {/* Far-left checkbox cell on every stage. Disabled
                          input on non-rejectable stages so the structural
                          column stays present but no orphan selection state
                          can build up. The cell renders the next-interview
                          chip beneath the checkbox on Interviewing rows so
                          that signal moves with the Job column (it used to
                          live in the Job cell sub-line, which now only
                          carries the job title). */}
                      <td
                        className="w-px px-2 py-2 align-top text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.placementId && isRejectableStage(r.bucket) ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.candidateName}`}
                            checked={selectedPlacementIds.has(r.placementId)}
                            onChange={() => toggleRow(r.placementId as string)}
                            className="h-3.5 w-3.5 cursor-pointer accent-brand"
                          />
                        ) : (
                          <input
                            type="checkbox"
                            aria-label="Selection disabled on this stage"
                            disabled
                            className="h-3.5 w-3.5 cursor-not-allowed accent-brand opacity-30"
                          />
                        )}
                      </td>

                      {/* Uniform LEFT (6 columns): Candidate · Current
                          Title/Employer · Location · Salary · Job/Client ·
                          Last Action. Same render across every stage so the
                          table reads identically. */}
                      <UniformLeftRowCells row={r} lastActionAt={r.lastActionAt} />

                      {stage === "pending_start" ? (
                        <PendingStartCells row={r} />
                      ) : stage === "hired" ? (
                        <HiredCells row={r} />
                      ) : stage === "cancelled" ? null : (

                        <>
                          {/* Offer stage: Offer Amount + Placement Fee
                              are the two extra columns called out in
                              Item 1 of the column-standardization spec.
                              Submitted / Interviewing skip them. */}
                          {stage === "offer" && (
                            <>
                              <td className="px-3 py-2 align-top text-center text-sm text-court-fg">
                                {formatMoney(r.placement?.acceptedSalary ?? null, r.placement?.acceptedCurrency)}
                              </td>
                              <td className="px-3 py-2 align-top text-center text-sm text-court-fg">
                                {formatMoney(r.placement?.feeTotal ?? null, r.placement?.acceptedCurrency)}
                                {r.placement?.feePercentage != null && (
                                  <span className="ml-1 text-[11px] text-court-fg-muted">({r.placement.feePercentage}%)</span>
                                )}
                              </td>
                            </>
                          )}
                          <td className="px-3 py-2 align-top text-center">
                            <StageAgePill value={r.daysInStage} />
                          </td>
                          <td className="w-px whitespace-nowrap px-3 py-2 align-top">
                            {/* Schedule (submitted) + Offer (interviewing) sit
                                left of Reject. Both deep-link to the candidate
                                profile — the full modal flows live there.
                                Labels collapse to icon-only below md so the
                                action column stays visible when the page
                                decompresses; w-px + whitespace-nowrap on the
                                cell pins it to its natural width and forces
                                other columns (Job/Client) to compress first.
                                Interviewing rows show the "Edit interview"
                                deep-link icon next to the Offer chip when a
                                next interview is scheduled. */}
                            {/* Ace 68.0 polish: chips stack vertically and
                                drop to h-6 / px-2 / text-[10px]. The
                                Action cell is now a narrow vertical
                                stack rather than a wide side-by-side
                                row. Same chips, same order, same deep-
                                links — only the layout shrinks. */}
                            <div className="ml-auto flex w-28 flex-col gap-1">
                              {r.bucket === "interviewing" && r.nextInterview && (
                                <Link
                                  href={`/candidates/${r.candidateId}?edit=interview&interviewId=${encodeURIComponent(r.nextInterview.id)}`}
                                  onClick={(e) => e.stopPropagation()}
                                  title={`Edit interview · Next: ${formatInterviewWhen(r.nextInterview.scheduledAt)} · ${formatInterviewTypeShort(r.nextInterview.type)}`}
                                  aria-label="Edit interview"
                                  className="inline-flex h-6 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border border-court-border bg-court-surface-subtle px-2 text-[10px] font-semibold text-court-fg-muted shadow-sm transition hover:bg-court-surface hover:text-court-fg"
                                >
                                  <CalendarClock className="h-3 w-3" />
                                </Link>
                              )}
                              {r.bucket === "submitted" && (
                                <Link
                                  href={`/candidates/${r.candidateId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex h-6 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-2 text-[10px] font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60"
                                  title="Schedule interview on candidate profile"
                                  aria-label="Schedule Interview"
                                >
                                  <CalendarClock className="h-3 w-3" />
                                  <span className="hidden md:inline">Schedule</span>
                                </Link>
                              )}
                              {r.bucket === "interviewing" && (
                                <>
                                  {/* Ace 68.0 polish: Schedule chip
                                      lands on Interviewing rows too so
                                      recruiters can book a follow-up
                                      interview from the pipeline
                                      without first jumping to the
                                      candidate profile. Same Court
                                      brand-blue styling and same
                                      candidate-profile deep-link the
                                      Submitted-stage Schedule chip uses;
                                      the candidate profile's Schedule
                                      Interview flow handles both
                                      first-touch and follow-up cases. */}
                                  <Link
                                    href={`/candidates/${r.candidateId}?schedule=interview&jobId=${r.jobId}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex h-6 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-2 text-[10px] font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60"
                                    title="Schedule another interview on candidate profile"
                                    aria-label="Schedule Interview"
                                  >
                                    <CalendarClock className="h-3 w-3" />
                                    <span className="hidden md:inline">Schedule</span>
                                  </Link>
                                  <Link
                                    href={`/candidates/${r.candidateId}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex h-6 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border border-purple-200 bg-purple-50 px-2 text-[10px] font-semibold text-purple-700 shadow-sm transition hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-200 dark:hover:bg-purple-950/60"
                                    title="Record offer on candidate profile"
                                    aria-label="Record Offer"
                                  >
                                    <DollarSign className="h-3 w-3" />
                                    <span className="hidden md:inline">Offer</span>
                                  </Link>
                                </>
                              )}
                              {r.bucket === "offer" && (
                                <>
                                  <Link
                                    href={`/candidates/${r.candidateId}?edit=offer&jobId=${r.jobId}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex h-6 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border border-court-border bg-court-surface-subtle px-2 text-[10px] font-semibold text-court-fg shadow-sm transition hover:bg-court-surface"
                                    title="Edit offer details"
                                    aria-label="Edit offer"
                                  >
                                    <Edit3 className="h-3 w-3" />
                                    <span className="hidden md:inline">Edit Offer</span>
                                  </Link>
                                  <Link
                                    href={`/candidates/${r.candidateId}?edit=placement&jobId=${r.jobId}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex h-6 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border border-court-brand bg-court-brand-tint px-2 text-[10px] font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25"
                                    title="Record placement"
                                    aria-label="Make Placement"
                                  >
                                    <Handshake className="h-3 w-3" />
                                    <span className="hidden md:inline">Placement</span>
                                  </Link>
                                </>
                              )}
                              {(r.bucket === "submitted" ||
                                r.bucket === "interviewing" ||
                                r.bucket === "offer") &&
                                r.placementId && (
                                  <RejectButton placementId={r.placementId} candidateName={r.candidateName} />
                                )}
                            </div>
                          </td>
                        </>
                      )}
                    </DataTableRow>
                  ))}

                  {/* Cancelled placements live at the bottom of the Hired
                      tab's list (no separate tab, no toggle). Visually
                      subdued (opacity-60) with a red "Cancelled" chip in
                      the right-column block. They are NOT in counts.hired
                      and NOT in any live metric (the guarantee-period
                      table reads `rows`, not these). Clicking routes to
                      the candidate profile — the inline placement drawer
                      is for live placements only. */}
                  {stage === "hired" &&
                    cancelledRows.map((r) => (
                      <DataTableRow
                        key={`cancelled-${r.candidateId}-${r.jobId}`}
                        className="cursor-pointer opacity-60"
                        onClick={() => router.push(`/candidates/${r.candidateId}`)}
                      >
                        {/* Disabled checkbox cell keeps the column grid
                            aligned with the hired rows above. */}
                        <td
                          className="w-px px-2 py-2 align-top text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label="Selection disabled on cancelled rows"
                            disabled
                            className="h-3.5 w-3.5 cursor-not-allowed accent-brand opacity-30"
                          />
                        </td>
                        <UniformLeftRowCells row={r} lastActionAt={r.lastActionAt} />
                        {/* Spans the Hired tab's 2 RIGHT columns (Start
                            Date / Invoicing — Billing Contact removed) with
                            the Cancelled status chip (red/REJECTED stage
                            tone from the Stage Badge colors). */}
                        <td className="px-3 py-2 align-top text-center" colSpan={2}>
                          <span className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                            Cancelled
                          </span>
                        </td>
                      </DataTableRow>
                    ))}
                </DataTableBody>
              </table>
            </div>
            {/* Pagination footer dropped Ace 67.11 — pipeline tabs render
                the full filtered set and the list grows downward. The
                Showing/Prev/Next row that used to live here mapped to
                the shared <Pagination> component (still used by
                /candidates, /jobs, /clients). */}
          </div>
        </>
      )}
      {stage === "hired" && (
        <GuaranteePeriodTable rows={guaranteeRows} />
      )}
      {bulkRejectOpen && (
        <RejectCandidateDialog
          candidateName={`${selectedPlacementIds.size} candidate${selectedPlacementIds.size === 1 ? "" : "s"}`}
          onClose={() => {
            if (!bulkBusy) setBulkRejectOpen(false);
          }}
          onConfirm={onBulkRejectConfirm}
        />
      )}
      <PlacementEditDrawer
        open={drawerOpen}
        context={drawerCtx}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}

function PendingStartCells({ row }: { row: PipelineRow }) {
  const p = row.placement;
  const startDate = p?.expectedStartDate ? new Date(p.expectedStartDate) : null;
  const daysUntil = startDate ? Math.ceil((startDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const overdue = daysUntil != null && daysUntil < 0;
  const soon = daysUntil != null && daysUntil >= 0 && daysUntil <= 7;
  return (
    <>
      {/* Start Date renders at the same text-sm + muted metadata
          treatment as the Hired Start Date and the Last Action cell so
          every date column reads identically (no mismatched sizes/weights). */}
      <td className="px-3 py-2 align-top text-center text-sm text-court-fg-muted">
        {startDate ? startDate.toLocaleDateString() : <span className="text-court-fg-muted">—</span>}
      </td>
      <td className="px-3 py-2 align-top text-center">
        {daysUntil == null ? (
          <span className="text-court-fg-muted">—</span>
        ) : (
          <span
            className={cn(
              "inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
              // Red/amber/emerald "days until start" pills stay on their
              // semantic palette in every mode — overdue always reads red,
              // soon always reads amber, on-track always reads green.
              overdue
                ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200"
                : soon
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
            )}
          >
            {overdue ? `${Math.abs(daysUntil)}d late` : daysUntil === 0 ? "Today" : `${daysUntil}d`}
          </span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        {/* Edit Placement (left, slate) + Confirm Start (right, brand)
            mirror the candidate-profile pending_start action row in
            pipeline-row-actions.tsx so the two surfaces read as the
            same control. Edit3 + CheckCircle2 icons match the
            candidate-profile DialogOrNav chip pair. */}
        {/* Ace 68.0 polish: chips stack vertically instead of side-by-
            side, and each chip drops to h-6 / px-2 / text-[10px] so the
            Action column doesn't dominate the row. Edit Placement on
            top, Confirm Start on the bottom — same ordering as the
            side-by-side layout this replaced. */}
        <div className="ml-auto flex w-28 flex-col gap-1">
          <Link
            href={`/candidates/${row.candidateId}?edit=placement&jobId=${row.jobId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border border-slate-400 bg-slate-100 px-2 text-[10px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-200 dark:border-slate-500 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Edit placement details"
          >
            <Edit3 className="h-3 w-3" />
            Edit Placement
          </Link>
          <Link
            href={`/candidates/${row.candidateId}?confirmStart=1&jobId=${row.jobId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border border-court-brand bg-court-brand-tint px-2 text-[10px] font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25"
            title="Confirm start"
          >
            <CheckCircle2 className="h-3 w-3" />
            Confirm Start
          </Link>
        </div>
      </td>
    </>
  );
}

function HiredCells({ row }: { row: PipelineRow }) {
  const p = row.placement;
  // Ace 68.0: Salary moved into the uniform LEFT column on every stage.
  // Hired stage's RIGHT extras are now Start Date + Invoicing only —
  // Salary is LEFT (candidate.expectedSalary), Fee is Offer-stage-only,
  // and the Billing Contact column was removed (never requested).
  return (
    <>
      <td className="px-3 py-2 align-top text-center text-sm text-court-fg-muted">
        {formatDate(p?.expectedStartDate)}
      </td>
      <td className="px-3 py-2 align-top text-center">
        <div className="flex flex-col items-center gap-0.5">
          <InvoiceStatusPill status={p?.invoiceStatus ?? null} />
          {p?.invoicePaymentMethod ? (
            <span className="text-[10px] font-medium uppercase tracking-wider text-court-fg-muted">
              {paymentMethodLabel(p.invoicePaymentMethod)}
            </span>
          ) : null}
        </div>
      </td>
    </>
  );
}

function paymentMethodLabel(method: "CHECK" | "ACH" | "CREDIT"): string {
  if (method === "CHECK") return "Check";
  if (method === "ACH") return "ACH";
  return "Credit";
}

function InvoiceStatusPill({ status }: { status: "DRAFT" | "SENT" | "PAID" | null }) {
  // Invoice lifecycle pill — colors track the status meaning across all
  // three Court modes (paid=green, sent=blue, draft=amber, missing=muted).
  if (status === "PAID") {
    return (
      <span className="inline-flex items-center rounded-md border border-court-brand bg-transparent px-2 py-0.5 text-[11px] font-semibold text-court-brand">
        Paid
      </span>
    );
  }
  if (status === "SENT") {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
        Sent
      </span>
    );
  }
  if (status === "DRAFT") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        Draft
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] font-semibold text-court-fg-muted">
      No invoice
    </span>
  );
}

function formatMoney(n: number | null, currency: string | null | undefined): string {
  if (!n) return "—";
  const sym = (currency ?? "USD").toUpperCase() === "USD" ? "$" : `${(currency ?? "USD").toUpperCase()} `;
  return `${sym}${n.toLocaleString()}`;
}

function StageTabs({
  stage,
  counts,
  buildHref,
}: {
  stage: Stage;
  counts: Record<Stage, number>;
  buildHref: (overrides: Record<string, string | number | undefined>) => string;
}) {
  return (
    <TabStrip<Stage>
      ariaLabel="Pipeline stage"
      activeId={stage}
      items={STAGE_ORDER.map((s) => ({
        id: s,
        label: STAGE_LABEL[s],
        count: counts[s],
        href: buildHref({ stage: s }),
      }))}
    />
  );
}

// Inline Reject button for the per-row Action cell. stopPropagation on
// click so the row's outer onClick (navigate to candidate profile) doesn't
// also fire. Calls the placementId-keyed action so it works for both
// RF-imported and Ace-native rows.
function RejectButton({ placementId, candidateName }: { placementId: string; candidateName: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(true);
  }

  async function onConfirm({ sendRejectionEmail }: { sendRejectionEmail: boolean }) {
    await new Promise<void>((resolve) => {
      startTransition(async () => {
        const res = await rejectLocalPlacement({ placementId, sendRejectionEmail });
        if (!res.ok) {
          toast.error("Couldn't reject", { description: res.error });
          resolve();
          return;
        }
        toast.success(sendRejectionEmail ? "Rejected. Email sent" : "Rejected");
        setOpen(false);
        router.refresh();
        resolve();
      });
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="reject"
        size="sm"
        onClick={onClick}
        disabled={isPending}
        title="Reject this candidate for this job"
        aria-label="Reject"
        className="h-6 w-auto whitespace-nowrap px-2 text-[10px]"
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
        <span className="hidden md:inline">Reject</span>
      </Button>
      {open && (
        <RejectCandidateDialog
          candidateName={candidateName}
          onClose={() => {
            if (!isPending) setOpen(false);
          }}
          onConfirm={onConfirm}
        />
      )}
    </>
  );
}

function formatInterviewWhen(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatInterviewTypeShort(t: NextInterview["type"]): string {
  if (t === "phone_screen") return "Phone";
  if (t === "video") return "Video";
  return "Onsite";
}

// `initials()` helper removed Ace 68.0 — the candidate-initials avatar
// circle was dropped from UniformLeftRowCells per recruiter feedback,
// and no other call site uses this helper. Re-add if the avatar lands
// back somewhere else (candidate hover card, etc.).


// ============================================================
// Intake-stage table (Applicants + Kept) — formerly /applicants
// ============================================================
//
// One <IntakeTable> handles both stages via `kind`. The shape is so
// close (same header layout, same row click → candidate profile, same
// bulk-reject pattern) that splitting into two components meant
// duplicating ~250 lines of identical scaffolding.

function rowKey(r: { candidateId: number | string; jobId: number | string }): string {
  return `${r.candidateId}-${r.jobId}`;
}

// Render the Placement.source / RF source_name into a human label.
function formatSourceLabel(raw: string | null): string {
  if (!raw) return "—";
  if (raw === "recruiter_applied") return "Recruiter Applied";
  return raw;
}

// JobCell removed Ace 68.0 — the uniform LEFT column set now renders
// Job + Client + Location in dedicated columns, replacing this combined
// Job + jobLocation + clientName cell that the old IntakeTable used.
// AppliedRowView and KeptRowView both now route through
// UniformLeftRowCells, so this helper is no longer reachable.

// Shared row-action chip styles. Mirrors the Applicants-page palette so
// recruiters see the same Submit / Keep / Reject silhouettes after the
// merge. Submit reuses the Court Mode brand tokens so the affirmative
// action follows whichever Court Mode is active.
// Ace 68.0 polish: chip height dropped h-7 → h-6, padding px-2.5 → px-2,
// text-[11px] → text-[10px]; `w-full` lets each chip fill its parent so
// the stacked Action cell renders every chip at identical width
// regardless of label length (Submit / Keep / Reject all the same
// silhouette — recruiter screenshot showed varying widths read sloppy).
// The fixed `w-28` lives on the wrapper around these chips.
const ROW_ACTION_BASE =
  "inline-flex h-6 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 text-[10px] font-semibold shadow-sm transition disabled:opacity-60";

const ROW_ACTION_CLASS = {
  primary: cn(
    ROW_ACTION_BASE,
    "border-court-brand bg-court-brand-tint text-court-brand-dark hover:bg-court-brand/25",
  ),
  keep: cn(
    ROW_ACTION_BASE,
    "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60",
  ),
  reject: cn(
    ROW_ACTION_BASE,
    "border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60",
  ),
};

function RowActionButton({
  tone,
  label,
  icon,
  onClick,
  disabled,
}: {
  tone: "primary" | "keep" | "reject";
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={ROW_ACTION_CLASS[tone]}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

type IntakeSortKey = "name" | "job" | "when" | "source" | "distance";
type IntakeSortDir = "asc" | "desc";

// Single source of truth for dispatching a per-row reject — used by
// both the row-level Reject button (Applied tab) and the bulk handler.
async function rejectOneApplicant(
  r: { candidateId: number | string; jobId: number | string; clientRfId: number | null },
  previousStage: "applied" | "kept",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const isAceJob = typeof r.jobId === "string";
  const jobRfId = isAceJob ? null : (r.jobId as number);
  const jobId = isAceJob ? (r.jobId as string) : null;
  const clientRfId = r.clientRfId;
  if (typeof r.candidateId === "string") {
    return rejectLocalCandidateJob({
      candidateId: r.candidateId,
      jobRfId,
      clientRfId,
      jobId,
      previousStage,
      reason: "",
    });
  }
  return rejectCandidateJob({
    candidateRfId: r.candidateId,
    jobRfId: jobRfId ?? 0,
    clientRfId: clientRfId ?? 0,
    jobCuid: jobId,
    previousStage,
    reason: "",
  });
}

function IntakeTable({
  kind,
  applied,
  kept,
}: {
  kind: "applied" | "kept";
  applied: AppliedRow[];
  kept: KeptRow[];
}) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<IntakeSortKey>("when");
  const [sortDir, setSortDir] = useState<IntakeSortDir>("desc");

  const sortedApplied = useMemo(
    () => sortApplied(applied, sortKey, sortDir),
    [applied, sortKey, sortDir],
  );
  const sortedKept = useMemo(() => sortKept(kept, sortKey, sortDir), [kept, sortKey, sortDir]);

  // Bulk selection — keyed by `${candidateId}-${jobId}`. Cleared on
  // stage flip via the parent component's key swap (each kind renders
  // a fresh IntakeTable instance).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const visibleRows: Array<AppliedRow | KeptRow> =
    kind === "applied" ? sortedApplied : sortedKept;
  const visibleKeys = useMemo(() => visibleRows.map((r) => rowKey(r)), [visibleRows]);
  const allSelected =
    visibleKeys.length > 0 && visibleKeys.every((k) => selectedKeys.has(k));
  const someSelected = selectedKeys.size > 0 && !allSelected;
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  function toggleRow(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setSelectedKeys((prev) => {
      if (prev.size === visibleKeys.length && visibleKeys.length > 0) {
        return new Set();
      }
      return new Set(visibleKeys);
    });
  }

  async function onBulkRejectConfirm({ sendRejectionEmail: _sendRejectionEmail }: { sendRejectionEmail: boolean }) {
    // Intake reject actions don't yet support a send-email toggle (only
    // the placement-id-keyed pipeline reject does), so the dialog's
    // checkbox is informational here. Underscored param documents the
    // intentional drop.
    void _sendRejectionEmail;
    const keys = new Set(selectedKeys);
    if (keys.size === 0) return;
    setBulkBusy(true);
    const previousStage: "applied" | "kept" = kind;
    const targets = visibleRows.filter((r) => keys.has(rowKey(r)));
    let ok = 0;
    let fail = 0;
    for (const r of targets) {
      try {
        const clientRfId = "clientRfId" in r ? r.clientRfId : null;
        const res = await rejectOneApplicant(
          {
            candidateId: r.candidateId,
            jobId: r.jobId,
            clientRfId,
          },
          previousStage,
        );
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setBulkRejectOpen(false);
    setSelectedKeys(new Set());
    if (fail === 0) {
      toast.success(`Rejected ${ok}`);
    } else if (ok === 0) {
      toast.error(`Couldn't reject (${fail} failed)`);
    } else {
      toast.warning(`Rejected ${ok}, ${fail} failed`);
    }
    router.refresh();
  }

  function toggleSort(k: IntakeSortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "when" ? "desc" : "asc");
    }
  }

  // Ace 68.0 — column count for the empty-state colSpan. Checkbox + 6
  // uniform LEFT columns (Job/Client merged into one) + 1 Actions column.
  // Applied stage appends Source between Last Action and Actions, so it
  // lands at 9 columns vs Kept's 8. Stays in sync with the headers below.
  const colSpan = kind === "applied" ? 9 : 8;

  return (
    <div className="space-y-4">
      {selectedKeys.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-court-accent/40 bg-court-accent-tint px-4 py-2 text-sm shadow-sm">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-court-fg">
              {selectedKeys.size} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedKeys(new Set())}
              className="inline-flex items-center gap-1 text-xs text-court-fg-muted transition hover:text-court-fg"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="reject"
              size="sm"
              onClick={() => setBulkRejectOpen(true)}
              disabled={bulkBusy}
              className="h-7 px-3 text-[11px]"
            >
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
              Reject {selectedKeys.size}
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm">
        <div className="overflow-x-auto">
          {/* min-w-[1100px] matches the main pipeline table so the 6
              uniform LEFT columns + Source/Actions sit on the same grid
              as Submitted/Interviewing/etc. */}
          <table className="w-full min-w-[1100px] text-left text-sm">
            <DataTableHead>
              <tr className="bg-court-surface border-b border-court-border/60">
                <DataTableHeaderCell align="center">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    aria-label="Select all rows on this tab"
                    checked={allSelected}
                    disabled={visibleKeys.length === 0}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </DataTableHeaderCell>
                {/* Uniform LEFT headers. Three of the six carry the
                    existing sortable affordances (Candidate by name,
                    Job/Client by job title, Last Action by when) — the
                    rest are plain headers matching the main pipeline
                    table. Job + Client are one combined "Job/Client"
                    column (job title primary, client name muted sub-line). */}
                <IntakeColHeader label="Candidate" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                <DataTableHeaderCell>Current Title/Employer</DataTableHeaderCell>
                <IntakeColHeader label="Location" active={sortKey === "distance"} dir={sortDir} onClick={() => toggleSort("distance")} />
                <DataTableHeaderCell align="right">Salary</DataTableHeaderCell>
                <IntakeColHeader label="Job/Client" active={sortKey === "job"} dir={sortDir} onClick={() => toggleSort("job")} />
                <IntakeColHeader
                  label="Last Action"
                  active={sortKey === "when"}
                  dir={sortDir}
                  onClick={() => toggleSort("when")}
                  align="center"
                />
                {kind === "applied" && (
                  <IntakeColHeader label="Source" active={sortKey === "source"} dir={sortDir} onClick={() => toggleSort("source")} align="center" />
                )}
                <DataTableHeaderCell align="right">Actions</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {kind === "applied" ? (
                sortedApplied.length === 0 ? (
                  <IntakeEmptyRow label="No applicants in this view." colSpan={colSpan} />
                ) : (
                  sortedApplied.map((r) => {
                    const key = rowKey(r);
                    return (
                      <AppliedRowView
                        key={key}
                        row={r}
                        selected={selectedKeys.has(key)}
                        onToggle={() => toggleRow(key)}
                      />
                    );
                  })
                )
              ) : sortedKept.length === 0 ? (
                <IntakeEmptyRow label="No kept candidates yet." colSpan={colSpan} />
              ) : (
                sortedKept.map((r) => {
                  const key = rowKey(r);
                  return (
                    <KeptRowView
                      key={key}
                      row={r}
                      selected={selectedKeys.has(key)}
                      onToggle={() => toggleRow(key)}
                    />
                  );
                })
              )}
            </DataTableBody>
          </table>
        </div>
      </div>
      {bulkRejectOpen && (
        <RejectCandidateDialog
          candidateName={`${selectedKeys.size} candidate${selectedKeys.size === 1 ? "" : "s"}`}
          onClose={() => {
            if (!bulkBusy) setBulkRejectOpen(false);
          }}
          onConfirm={onBulkRejectConfirm}
        />
      )}
    </div>
  );
}

function IntakeEmptyRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-12 text-center text-sm text-court-fg-muted">
        {label}
      </td>
    </tr>
  );
}

function IntakeColHeader({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: IntakeSortDir;
  onClick: () => void;
  align?: "left" | "center" | "right";
}) {
  return (
    <DataTableHeaderCell align={align}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide",
          active ? "text-court-fg" : "text-court-fg-muted hover:text-court-fg",
        )}
      >
        {label}
        {active && (dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </DataTableHeaderCell>
  );
}

function AppliedRowView({
  row,
  selected,
  onToggle,
}: {
  row: AppliedRow;
  selected: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [isPending, startChange] = useTransition();

  function runAction(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, successMsg: string) {
    startChange(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error("Action failed", { description: result.error });
        return;
      }
      toast.success(successMsg);
      router.refresh();
    });
  }

  return (
    <DataTableRow>
      <td className="w-px px-2 py-2 align-top text-center">
        <input
          type="checkbox"
          aria-label={`Select ${row.candidateName}`}
          checked={selected}
          onChange={onToggle}
          className="h-3.5 w-3.5 cursor-pointer accent-brand"
        />
      </td>
      {/* Uniform LEFT (6 cells). appliedAt becomes the Last Action
          source for this row. */}
      <UniformLeftRowCells row={row} lastActionAt={row.appliedAt} />
      <td className="px-3 py-2 align-top text-center text-sm text-court-fg-muted">{formatSourceLabel(row.source)}</td>
      <td className="px-3 py-2 align-top">
        <div className="ml-auto flex w-28 flex-col gap-1">
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />}
          {/* Submit / Keep / Reject share the row-action chip style. */}
          <Link
            href={`/candidates/${row.candidateId}?compose=submittal&jobId=${row.jobId}`}
            className={ROW_ACTION_CLASS.primary}
            title="Submit candidate"
          >
            <Send className="h-3 w-3" />
            <span className="hidden sm:inline">Submit</span>
          </Link>
          <RowActionButton
            tone="keep"
            label="Keep"
            icon={<Bookmark className="h-3 w-3" />}
            disabled={isPending}
            onClick={() => {
              const isAceJob = typeof row.jobId === "string";
              const jobRfId = isAceJob ? null : (row.jobId as number);
              const jobId = isAceJob ? (row.jobId as string) : null;
              const clientRfId = row.clientRfId;
              runAction(
                () =>
                  typeof row.candidateId === "string"
                    ? keepLocalCandidateForJob({
                        candidateId: row.candidateId,
                        jobRfId,
                        clientRfId,
                        jobId,
                      })
                    : keepCandidateForJob({
                        candidateRfId: row.candidateId,
                        jobRfId,
                        clientRfId,
                        jobId,
                      }),
                "Kept",
              );
            }}
          />
          <RowActionButton
            tone="reject"
            label="Reject"
            icon={<UserX className="h-3 w-3" />}
            disabled={isPending}
            onClick={() => runAction(() => rejectOneApplicant(row, "applied"), "Rejected")}
          />
        </div>
      </td>
    </DataTableRow>
  );
}

function KeptRowView({
  row,
  selected,
  onToggle,
}: {
  row: KeptRow;
  selected: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [isPending, startChange] = useTransition();

  function runAction(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, successMsg: string) {
    startChange(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error("Action failed", { description: result.error });
        return;
      }
      toast.success(successMsg);
      router.refresh();
    });
  }

  return (
    <DataTableRow>
      <td className="w-px px-2 py-2 align-top text-center">
        <input
          type="checkbox"
          aria-label={`Select ${row.candidateName}`}
          checked={selected}
          onChange={onToggle}
          className="h-3.5 w-3.5 cursor-pointer accent-brand"
        />
      </td>
      {/* Uniform LEFT (6 cells). keptAt becomes the Last Action source
          for this row. */}
      <UniformLeftRowCells row={row} lastActionAt={row.keptAt} />
      <td className="px-3 py-2 align-top">
        <div className="ml-auto flex w-28 flex-col gap-1">
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />}
          <Link
            href={`/candidates/${row.candidateId}?compose=submittal&jobId=${row.jobId}`}
            className={ROW_ACTION_CLASS.primary}
            title="Submit candidate"
          >
            <Send className="h-3 w-3" />
            <span className="hidden sm:inline">Submit</span>
          </Link>
          <RowActionButton
            tone="reject"
            label="Remove"
            icon={<UserX className="h-3 w-3" />}
            disabled={isPending}
            onClick={() => {
              const isAceJob = typeof row.jobId === "string";
              const jobRfId = isAceJob ? null : (row.jobId as number);
              const jobId = isAceJob ? (row.jobId as string) : null;
              runAction(
                () =>
                  typeof row.candidateId === "string"
                    ? removeLocalKeptCandidate({
                        candidateId: row.candidateId,
                        jobRfId,
                        jobId,
                      })
                    : removeKeptCandidate({
                        candidateRfId: row.candidateId,
                        jobRfId,
                        jobId,
                      }),
                "Removed",
              );
            }}
          />
        </div>
      </td>
    </DataTableRow>
  );
}

function sortApplied(rows: AppliedRow[], key: IntakeSortKey, dir: IntakeSortDir): AppliedRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    const mul = dir === "asc" ? 1 : -1;
    // Distance uses the shared comparator so no-distance rows always sink
    // to the bottom (same behavior as the main pipeline table).
    if (key === "distance") return compareDistance(a.distanceMiles, b.distanceMiles, mul);
    let va: string | number = "";
    let vb: string | number = "";
    switch (key) {
      case "name":
        va = a.candidateName.toLowerCase();
        vb = b.candidateName.toLowerCase();
        break;
      case "job":
        va = a.jobTitle.toLowerCase();
        vb = b.jobTitle.toLowerCase();
        break;
      case "when":
        va = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
        vb = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
        break;
      case "source":
        va = (a.source ?? "").toLowerCase();
        vb = (b.source ?? "").toLowerCase();
        break;
    }
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
    return String(va).localeCompare(String(vb)) * mul;
  });
  return out;
}

function sortKept(rows: KeptRow[], key: IntakeSortKey, dir: IntakeSortDir): KeptRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    const mul = dir === "asc" ? 1 : -1;
    if (key === "distance") return compareDistance(a.distanceMiles, b.distanceMiles, mul);
    let va: string | number = "";
    let vb: string | number = "";
    switch (key) {
      case "name":
        va = a.candidateName.toLowerCase();
        vb = b.candidateName.toLowerCase();
        break;
      case "job":
        va = a.jobTitle.toLowerCase();
        vb = b.jobTitle.toLowerCase();
        break;
      case "when":
        va = new Date(a.keptAt).getTime();
        vb = new Date(b.keptAt).getTime();
        break;
      case "source":
        va = 0;
        vb = 0;
        break;
    }
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
    return String(va).localeCompare(String(vb)) * mul;
  });
  return out;
}
