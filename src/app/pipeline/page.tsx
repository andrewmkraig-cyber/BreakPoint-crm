import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Prisma } from "@prisma/client";
import {
  PipelineView,
  type AppliedRow,
  type KeptRow,
  type NextInterview,
  type PipelineRow,
  type PlacementDetails,
} from "@/app/pipeline/pipeline-view";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getCurrentUserId } from "@/lib/auth/getCurrentUserId";
import {
  canonicalStage,
  flattenPipeline,
  normalizeJob,
  PIPELINE_LABELS,
  daysBetween,
  type PipelineBucket,
  type RFCandidate,
  type RFCandidateJob,
  type RFJob,
} from "@/lib/rf-payload-shapes";
import { getRfCandidatesForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { getClientsForOrg } from "@/lib/clients";
import { getPlacementsForOrg } from "@/lib/placements";
import { getInterviewsForOrg } from "@/lib/interviews";
import { resolveJobTitle } from "@/lib/job-title";
import { formatLocation } from "@/lib/utils";
import { geocodePill } from "@/lib/geocode";
import { haversineMiles } from "@/lib/distance";

// Local helper for parsing the Json shape Prisma stores for
// `Candidate.expectedSalary` (`{ number, currency }`). Returns null when
// the blob is missing/zero so the Salary cell renders fully blank per
// Item 2 of the column-standardization spec.
function extractExpectedSalaryNumber(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const n = (raw as { number?: unknown }).number;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

export const dynamic = "force-dynamic";

// Applied / Kept were folded in from the standalone /applicants page —
// they live before "Submitted" in the stage strip so the recruiter scans
// the pipeline in the same chronological order the candidate moves
// through it (Applicants → Kept → Submitted → ...). The two intake
// stages keep their own row shapes / actions; the main pipeline stages
// still drive PipelineRow.
// "cancelled" is included alongside the main pipeline stages so the Show
// Cancelled toggle in PipelineView can switch into a dedicated tab — its
// visibility in the StageTabs strip is gated client-side, but a direct
// /pipeline?stage=cancelled deep-link is still accepted server-side.
type Stage = "applied" | "kept" | "cancelled" | keyof typeof PIPELINE_LABELS;
const STAGES: Stage[] = [
  "applied",
  "kept",
  "submitted",
  "interviewing",
  "offer",
  "pending_start",
  "hired",
  "cancelled",
];

// Owner scope for the Mine / <Name>'s / All filter (Step 4). Default is
// the signed-in user's own book, scoped by the parent client's owner.
type OwnerScope = "mine" | "theirs" | "all";

// Pagination removed Ace 67.11 — pipeline tabs render the full filtered
// set and the list grows downward. The shared <Pagination> component
// stays alive for /candidates, /jobs, /clients.

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: { stage?: string; q?: string; clientId?: string; jobId?: string; owner?: string };
}) {
  const stage: Stage = (STAGES as string[]).includes(searchParams?.stage ?? "")
    ? (searchParams!.stage as Stage)
    : "submitted";
  const q = (searchParams?.q ?? "").trim();
  // ?clientId=<cuid> filter — emitted by the client detail page's clickable
  // stat strip. When set, only Placement-rooted rows whose Placement.clientId
  // matches survive; the RF-flat-pipeline rows are dropped because they
  // aren't tracked in Neon Placement (consistent with how the client detail
  // counters compute, so the per-client counts match end-to-end).
  const clientFilter = searchParams?.clientId?.trim() || null;
  // ?jobId=<rfNumeric> filter — emitted by the per-job stage pills in the
  // client detail Jobs table. Job rows there iterate raw.open_jobs /
  // raw.closed_jobs, both keyed by the RF numeric id, so jobId here is
  // matched against Placement.jobRfId. RF-flat rows are skipped when set
  // (same rationale as the clientId filter — those rows aren't in Neon).
  const jobIdRaw = searchParams?.jobId?.trim();
  const jobFilter = jobIdRaw && /^\d+$/.test(jobIdRaw) ? Number(jobIdRaw) : null;

  // Owner scope (Step 4). Default to the signed-in user's own book.
  // Exception: when the page is deep-linked from a client/job stat pill
  // (clientId/jobId set) and no explicit owner is chosen, default to
  // "all" so drilling into a client you don't own still shows its rows.
  const rawOwner = searchParams?.owner;
  const ownerExplicit = rawOwner === "mine" || rawOwner === "theirs" || rawOwner === "all";
  const owner: OwnerScope = ownerExplicit
    ? (rawOwner as OwnerScope)
    : clientFilter || jobFilter !== null
      ? "all"
      : "mine";

  let rows: PipelineRow[] = [];
  let appliedRows: AppliedRow[] = [];
  let keptRows: KeptRow[] = [];
  let otherUserName: string | null = null;
  const counts: Record<Stage, number> = {
    applied: 0,
    kept: 0,
    submitted: 0,
    interviewing: 0,
    offer: 0,
    pending_start: 0,
    hired: 0,
    // Always populated so the Cancelled tab can show its count the moment
    // the recruiter toggles Show Cancelled on. Server-side build cost is
    // small (one cheap stage match in the existing loop).
    cancelled: 0,
  };
  let error: string | null = null;

  try {
    // Phase 4a: Placement + Interview reads routed through the tenant-
    // scoped helpers. The pipeline view is global to the signed-in org
    // (no per-candidate filter) so the helpers are called with just the
    // filters this page cares about.
    //
    // The Applicants / Kept stages need extra context the main pipeline
    // doesn't: RF jobs (for title/location lookup) + jobOverride titles +
    // the placement.job relation (Ace-native jobs missing from RF map).
    // Fetched alongside the existing reads so the page still single-hops
    // its dependencies.
    const [candidates, allJobs, placements, allPlacementsWithJob, interviews, clients, org, currentUserId, jobOverrides] = await Promise.all([
      getRfCandidatesForOrg(),
      getRfJobsForOrg(),
      // includeCancelled:true so the Cancelled tab can render when the
      // recruiter toggles it on. The existing in-loop continue still
      // drops cancelled rows from every other tab.
      getPlacementsForOrg({ includeCancelled: true }),
      // Mirror of getPlacementsForOrg but pulls in the Job relation
      // so the Applied/Kept assembly can resolve Ace-native job titles
      // (those carry jobRfId=null, so the RF-jobs map can't find them).
      // Same tenant scope, no extra filters.
      prisma.placement.findMany({
        where: { organizationId: (await getCurrentOrg()).id },
        include: {
          job: {
            select: {
              title: true,
              locations: true,
              client: { select: { name: true } },
            },
          },
        },
      }),
      getInterviewsForOrg({
        statuses: ["scheduled"],
        scheduledAfter: new Date(),
      }),
      getClientsForOrg(),
      getCurrentOrg(),
      getCurrentUserId(),
      prisma.jobOverride.findMany({ select: { jobRfId: true, title: true } }),
    ]);

    // Owner lookups (Step 4). Neon placement rows resolve their owner by
    // Placement.clientId (cuid); legacy RF-flat rows have no clientId so
    // they fall back to a clientName match. The "other" org member powers
    // the "<Name>'s Pipeline" option (same two-person-org assumption as
    // /clients).
    const members = await prisma.organizationMembership.findMany({
      where: { organizationId: org.id },
      select: { user: { select: { id: true, name: true } } },
    });
    const other = members.map((m) => m.user).find((u) => u.id !== currentUserId) ?? null;
    const otherUserId = other?.id ?? null;
    otherUserName = other?.name ?? null;
    const ownerByClientId = new Map<string, string | null>();
    const ownerByClientNameLower = new Map<string, string | null>();
    // Verified-by-client lookups. Drives the small shield badge next to
    // the Client column added in Ace 68.0's pipeline column standardization
    // pass. Same `isVerified` signal /clients + /jobs use (see
    // src/lib/clients.ts:153 — signed agreement custom field OR an
    // agreement-named file under Client.raw). We key by both clientId and
    // lowercased clientName so PipelineRow assembly (Placement.clientId-
    // bearing rows) and RF-flat rows (clientName only) can both resolve.
    const verifiedByClientId = new Map<string, boolean>();
    const verifiedByClientNameLower = new Map<string, boolean>();
    for (const c of clients) {
      ownerByClientId.set(c.id, c.ownerId);
      verifiedByClientId.set(c.id, c.isVerified);
      if (c.name) {
        ownerByClientNameLower.set(c.name.toLowerCase(), c.ownerId);
        verifiedByClientNameLower.set(c.name.toLowerCase(), c.isVerified);
      }
    }

    // (candidateRfId, jobRfId) -> earliest upcoming interview, AND
    // (ace:candidateId:jobId) for Ace-native interview rows.
    // Ace 68.0: prior to this pass the map only keyed RF interviews,
    // so the pipeline's per-row Edit Interview chip never rendered for
    // Ace-native rows (which is most of the live data post-RF removal).
    // Now we key whichever identity the Interview carries — both keys
    // can fire if a row happens to have both, but the row-build sites
    // below only look up the form that matches the row's identity.
    const nextByKey = new Map<string, NextInterview>();
    for (const iv of interviews) {
      const entry: NextInterview = {
        id: iv.id,
        scheduledAt: iv.scheduledAt.toISOString(),
        type: iv.type as NextInterview["type"],
      };
      if (iv.candidateRfId != null) {
        const rfKey = `${iv.candidateRfId}:${iv.jobRfId}`;
        if (!nextByKey.has(rfKey)) nextByKey.set(rfKey, entry);
      }
      if (iv.candidateId && iv.jobId) {
        const aceKey = `ace:${iv.candidateId}:${iv.jobId}`;
        if (!nextByKey.has(aceKey)) nextByKey.set(aceKey, entry);
      }
    }

    // Phase 4b: key on whichever identity the placement carries — RF
    // numeric for imported rows, cuid for Ace-native. Keeps the dedupe
    // below honest across both shapes (the flat-pipeline loop emits
    // RF-keyed entries; Ace-native rows only come from Placements).
    const placementKey = (p: {
      candidateRfId: number | null;
      candidateId: string | null;
      jobRfId: number | null;
      jobId: string | null;
    }) => {
      const cid = p.candidateRfId != null ? `rf:${p.candidateRfId}` : `ace:${p.candidateId ?? "?"}`;
      const jid = p.jobRfId != null ? `rf:${p.jobRfId}` : `ace:${p.jobId ?? "?"}`;
      return `${cid}|${jid}`;
    };
    const placementByKey = new Map<string, (typeof placements)[number]>();
    for (const p of placements) placementByKey.set(placementKey(p), p);

    const flat = flattenPipeline(candidates);
    const candidateNameById = new Map<number, string>();
    for (const c of candidates) {
      candidateNameById.set(
        c.id,
        c.name ??
          [c.first_name, c.last_name].filter(Boolean).join(" ") ??
          "(unnamed)",
      );
    }

    // Ace-native candidate + job lookups for rows that carry cuid
    // identities. Batched once so we don't per-row round-trip Neon.
    const aceCandidateIds = new Set<string>();
    const aceJobIds = new Set<string>();
    for (const p of placements) {
      if (p.candidateRfId == null && p.candidateId) aceCandidateIds.add(p.candidateId);
      if (p.jobRfId == null && p.jobId) aceJobIds.add(p.jobId);
    }
    const [aceCandidates, aceJobs] = await Promise.all([
      aceCandidateIds.size > 0
        ? prisma.candidate.findMany({
            where: { id: { in: Array.from(aceCandidateIds) } },
            // Ace 68.0: also select currentOrganization / location /
            // expectedSalary so the column-standardization pass can
            // render the Current Title/Employer sub-line, the Location
            // column, and the Salary column on Ace-native rows.
            select: {
              id: true,
              firstName: true,
              lastName: true,
              currentDesignation: true,
              currentOrganization: true,
              location: true,
              expectedSalary: true,
            },
          })
        : Promise.resolve([]),
      aceJobIds.size > 0
        ? prisma.job.findMany({
            where: { id: { in: Array.from(aceJobIds) } },
            select: { id: true, title: true, client: { select: { name: true } } },
          })
        : Promise.resolve([]),
    ]);
    const aceCandidateById = new Map(aceCandidates.map((c) => [c.id, c]));
    const aceJobById = new Map(aceJobs.map((j) => [j.id, j]));

    // Hired-stage invoice lookup: pull the single non-VOID invoice per
    // placement so the Invoicing column can render its lifecycle status
    // instead of the (stale) invoicingFlagged hint.
    const hiredPlacementIds = placements
      .filter((p) => p.stage === "hired")
      .map((p) => p.id);
    const hiredInvoices = hiredPlacementIds.length > 0
      ? await prisma.invoice.findMany({
          where: {
            placementId: { in: hiredPlacementIds },
            status: { not: "VOID" },
          },
          select: { placementId: true, status: true, paymentMethod: true },
        })
      : [];
    const invoiceStatusByPlacementId = new Map<string, "DRAFT" | "SENT" | "PAID">();
    const invoicePaymentMethodByPlacementId = new Map<string, "CHECK" | "ACH" | "CREDIT">();
    for (const inv of hiredInvoices) {
      if (inv.placementId) {
        invoiceStatusByPlacementId.set(
          inv.placementId,
          inv.status as "DRAFT" | "SENT" | "PAID",
        );
        if (inv.paymentMethod) {
          invoicePaymentMethodByPlacementId.set(
            inv.placementId,
            inv.paymentMethod as "CHECK" | "ACH" | "CREDIT",
          );
        }
      }
    }

    // Local placements win over RF's stage_name because Ace drove the move.
    const seen = new Set<string>();
    const allRows: (PipelineRow & { clientOwnerId: string | null })[] = [];

    for (const p of placements) {
      // Cancelled placements flow through the same path as every other
      // stage now — they end up in `allRows` and `scopedRows` so the
      // downstream owner-scope filter (line 399) and the counts loop
      // (line 405) handle them consistently. `rows = scopedRows.filter
      // (r => r.bucket === stage)` only emits cancelled rows into the
      // active view when the recruiter is on the Cancelled tab, so the
      // "hidden from main pipeline" behavior is preserved.
      // Applied / Kept / Rejected handled by the dedicated assembly
      // below — skip here so they don't double up in the main pipeline.
      if (p.stage === "applied" || p.stage === "kept" || p.stage === "rejected") continue;
      // Per-client filter: drop placements whose clientId doesn't match.
      // Skipped via early-continue so neither counts nor rows include them.
      if (clientFilter && p.clientId !== clientFilter) continue;
      // Per-job filter: same pattern, matching Placement.jobRfId against
      // the numeric id passed from the per-row pills on the client page.
      if (jobFilter !== null && p.jobRfId !== jobFilter) continue;
      const key = placementKey(p);
      seen.add(key);
      const stageName = p.stage as keyof typeof PIPELINE_LABELS;
      if (!(stageName in counts)) continue;

      // Pick the identity fields — numeric RF for imported, cuid for
      // Ace-native. Ace-native rows can't match flat-pipeline entries
      // (those only come from RFCandidate.jobs[], which is RF-scoped).
      const isRfCandidate = p.candidateRfId != null;
      const isRfJob = p.jobRfId != null;
      const candidateId: number | string = isRfCandidate ? p.candidateRfId! : p.candidateId!;
      const jobId: number | string = isRfJob ? p.jobRfId! : p.jobId!;
      const rfEntry = isRfCandidate && isRfJob
        ? flat.find((r) => r.candidateId === p.candidateRfId && r.jobId === p.jobRfId)
        : null;

      const aceCandidate = !isRfCandidate && p.candidateId ? aceCandidateById.get(p.candidateId) : null;
      const aceJob = !isRfJob && p.jobId ? aceJobById.get(p.jobId) : null;

      const candidateName = isRfCandidate
        ? candidateNameById.get(p.candidateRfId!) ?? rfEntry?.candidateName ?? "(unknown)"
        : aceCandidate
          ? [aceCandidate.firstName, aceCandidate.lastName].filter(Boolean).join(" ") || "(unnamed)"
          : "(unknown)";
      const candidateTitle = isRfCandidate ? rfEntry?.candidateTitle ?? "" : aceCandidate?.currentDesignation ?? "";
      // Ace 68.0 fields for the uniform LEFT column set. RF rows use the
      // employer/location/expectedSalary that flattenPipeline now emits;
      // Ace-native rows pull from the freshly selected candidate columns.
      const candidateEmployer = isRfCandidate
        ? rfEntry?.candidateEmployer ?? ""
        : aceCandidate?.currentOrganization ?? "";
      const candidateLocation = isRfCandidate
        ? rfEntry?.candidateLocation ?? ""
        : formatLocation(aceCandidate?.location ?? null);
      const candidateExpectedSalary = isRfCandidate
        ? rfEntry?.candidateExpectedSalary ?? null
        : extractExpectedSalaryNumber(aceCandidate?.expectedSalary ?? null);
      const jobTitle = isRfJob ? rfEntry?.jobTitle ?? "" : aceJob?.title ?? "";
      const clientName = isRfJob ? rfEntry?.clientName ?? "" : aceJob?.client?.name ?? "";
      // Owner of this row's client: prefer the Placement.clientId cuid
      // join, fall back to a clientName match for rows missing clientId.
      const clientOwnerId = p.clientId
        ? ownerByClientId.get(p.clientId) ?? null
        : clientName
          ? ownerByClientNameLower.get(clientName.toLowerCase()) ?? null
          : null;
      // Signed-agreement (verified) badge state, resolved through the same
      // clientId-first / clientName-fallback pattern.
      const clientIsVerified = p.clientId
        ? verifiedByClientId.get(p.clientId) ?? false
        : clientName
          ? verifiedByClientNameLower.get(clientName.toLowerCase()) ?? false
          : false;

      allRows.push({
        candidateId,
        candidateName,
        candidateTitle,
        candidateEmployer,
        candidateLocation,
        candidateExpectedSalary,
        jobId,
        jobTitle,
        clientName,
        clientIsVerified,
        // Capitalize the fallback so the Cancelled tab renders "Cancelled"
        // rather than the raw lowercase stage string. PIPELINE_LABELS only
        // covers the active pipeline stages by design.
        stageName: PIPELINE_LABELS[stageName] ?? (p.stage === "cancelled" ? "Cancelled" : p.stage),
        bucket: stageName,
        lastActionAt: p.updatedAt.toISOString(),
        daysInStage: daysBetween(p.updatedAt.toISOString()),
        isKept: rfEntry?.isKept ?? false,
        placementId: p.id,
        placement: toPlacementDetails(
          p,
          invoiceStatusByPlacementId.get(p.id) ?? null,
          invoicePaymentMethodByPlacementId.get(p.id) ?? null,
        ),
        // Ace 68.0: route the lookup through whichever identity the
        // placement carries. RF + RF uses the existing numeric key;
        // Ace-native pairs use the new `ace:<cuid>:<cuid>` key so the
        // pipeline can render Edit Interview on Ace-native rows too.
        // Mixed pairs (one side RF, one side Ace) fall through to null
        // — no interview record can match them.
        nextInterview: isRfCandidate && isRfJob
          ? nextByKey.get(`${p.candidateRfId}:${p.jobRfId}`) ?? null
          : !isRfCandidate && !isRfJob && p.candidateId && p.jobId
            ? nextByKey.get(`ace:${p.candidateId}:${p.jobId}`) ?? null
            : null,
        // Default — populated below for the current-stage `rows` set
        // via the Nominatim distance pass. Rows outside the active
        // stage (counted but not rendered this request) keep the
        // default; the next SSR for that stage will resolve them.
        distanceLine: "",
        clientOwnerId,
      });
    }

    for (const r of flat) {
      if (!isPipelineStage(r.bucket)) continue;
      // When a clientId or jobId filter is active, RF-flat rows are
      // excluded entirely (they aren't tracked in Neon Placement so we
      // can't verify their client/job linkage; counts on the client
      // detail page come from Placement only, so this keeps the math
      // consistent).
      if (clientFilter || jobFilter !== null) continue;
      // flat entries are always RF numeric on both sides.
      const key = `rf:${r.candidateId}|rf:${r.jobId}`;
      if (seen.has(key)) continue;
      allRows.push({
        candidateId: r.candidateId,
        candidateName: r.candidateName,
        candidateTitle: r.candidateTitle,
        candidateEmployer: r.candidateEmployer,
        candidateLocation: r.candidateLocation,
        candidateExpectedSalary: r.candidateExpectedSalary,
        jobId: r.jobId,
        jobTitle: r.jobTitle,
        clientName: r.clientName,
        clientIsVerified: r.clientName
          ? verifiedByClientNameLower.get(r.clientName.toLowerCase()) ?? false
          : false,
        stageName: r.stageName,
        bucket: r.bucket,
        lastActionAt: r.stageMovedAt,
        daysInStage: daysBetween(r.stageMovedAt),
        isKept: r.isKept,
        placementId: null,
        placement: null,
        nextInterview: nextByKey.get(`${r.candidateId}:${r.jobId}`) ?? null,
        // Default — populated below for the current-stage `rows` set
        // (Location distance sub-line). Cancelled / non-active stages
        // keep the default this request.
        distanceLine: "",
        // RF-flat rows carry no clientId; resolve owner by client name.
        clientOwnerId: r.clientName
          ? ownerByClientNameLower.get(r.clientName.toLowerCase()) ?? null
          : null,
      });
    }

    // Owner scope filter (Step 4). Applied before the stage counts so the
    // stage tab badges reflect the current scope, and before pagination.
    const scopedRows = allRows.filter((r) => {
      if (owner === "all") return true;
      if (owner === "theirs") return otherUserId != null && r.clientOwnerId === otherUserId;
      return currentUserId != null && r.clientOwnerId === currentUserId;
    });
    for (const r of scopedRows) {
      if (r.bucket in counts) counts[r.bucket] += 1;
    }

    rows = scopedRows.filter((r) => r.bucket === stage);

    // ---- Location distance sub-line ----
    //
    // Originally landed alongside a Match column read (Prompt 4) that
    // joined CandidateMatch. The Match column was pulled after the
    // deterministic scorer (5665a8a) got reverted (220e381), leaving
    // every stored CandidateMatch row stale; the join was removed with
    // the column so the pipeline page does not read CandidateMatch at
    // all anymore. Find Matches on /jobs still reads + writes
    // CandidateMatch via its own surface — only this page's read was
    // dropped. When a future scorer ships, re-introduce the join here.
    //
    // Distance sub-line — Candidate.lat/lng (backfilled by
    // scripts/geocode-candidates.ts) feeds the candidate side;
    // Job.locationZip / locationCity / locationState feeds the job
    // side via the shared Nominatim geocoder in src/lib/geocode.ts
    // (the same module-level cache the candidate-search route uses,
    // so a recruiter who's already searched Akron OH pays zero
    // Nominatim hits on the pipeline render). Unique job locations
    // are de-duped before the geocoder loop so cold-start hits scale
    // with distinct locations, not row count.
    if (rows.length > 0) {
      const rfCandidateIds: number[] = [];
      const cuidCandidateIds: string[] = [];
      const rfJobIds: number[] = [];
      const cuidJobIds: string[] = [];
      for (const r of rows) {
        if (typeof r.candidateId === "number") rfCandidateIds.push(r.candidateId);
        else if (typeof r.candidateId === "string") cuidCandidateIds.push(r.candidateId);
        if (typeof r.jobId === "number") rfJobIds.push(r.jobId);
        else if (typeof r.jobId === "string") cuidJobIds.push(r.jobId);
      }

      // Candidate lat/lng + rfId<->cuid mapping. The Candidate table
      // holds every candidate (RF-imported has rfId set; Ace-native
      // has rfId null), so a single query covers both row shapes.
      const candidateOr: Prisma.CandidateWhereInput[] = [];
      if (rfCandidateIds.length > 0) candidateOr.push({ rfId: { in: rfCandidateIds } });
      if (cuidCandidateIds.length > 0) candidateOr.push({ id: { in: cuidCandidateIds } });
      const candidateLatLngRows = candidateOr.length > 0
        ? await prisma.candidate.findMany({
            where: { organizationId: org.id, OR: candidateOr },
            select: { id: true, rfId: true, lat: true, lng: true },
          })
        : [];
      const candidateLatLngByCuid = new Map<string, { lat: number; lng: number }>();
      const candidateLatLngByRfId = new Map<number, { lat: number; lng: number }>();
      for (const c of candidateLatLngRows) {
        if (c.lat != null && c.lng != null) {
          const point = { lat: c.lat, lng: c.lng };
          candidateLatLngByCuid.set(c.id, point);
          if (c.rfId != null) candidateLatLngByRfId.set(c.rfId, point);
        }
      }

      // Job zip/city/state + legacyRfId<->cuid mapping.
      const jobOr: Prisma.JobWhereInput[] = [];
      if (rfJobIds.length > 0) jobOr.push({ legacyRfId: { in: rfJobIds } });
      if (cuidJobIds.length > 0) jobOr.push({ id: { in: cuidJobIds } });
      const jobLocRows = jobOr.length > 0
        ? await prisma.job.findMany({
            where: { organizationId: org.id, OR: jobOr },
            select: {
              id: true,
              legacyRfId: true,
              locationZip: true,
              locationCity: true,
              locationState: true,
            },
          })
        : [];
      type JobLoc = { zip: string | null; city: string | null; state: string | null };
      const jobLocByCuid = new Map<string, JobLoc>();
      const jobLocByRfId = new Map<number, JobLoc>();
      for (const j of jobLocRows) {
        const loc: JobLoc = {
          zip: j.locationZip,
          city: j.locationCity,
          state: j.locationState,
        };
        jobLocByCuid.set(j.id, loc);
        if (j.legacyRfId != null) {
          jobLocByRfId.set(j.legacyRfId, loc);
        }
      }

      // Distance sub-line. De-dupe job locations first so each unique
      // (zip OR city,state) string fires at most one Nominatim hit per
      // cold process. The geocoder's module-level cache covers the
      // warm-process case for free.
      const jobLocKey = (loc: JobLoc): string => {
        const zip = (loc.zip ?? "").trim();
        if (zip) return `zip:${zip.toLowerCase()}`;
        const parts = [loc.city, loc.state]
          .map((s) => (s ?? "").trim())
          .filter(Boolean);
        return parts.length > 0 ? `cs:${parts.join(",").toLowerCase()}` : "";
      };
      const jobLocQuery = (loc: JobLoc): string => {
        const zip = (loc.zip ?? "").trim();
        if (zip) return zip;
        const parts = [loc.city, loc.state]
          .map((s) => (s ?? "").trim())
          .filter(Boolean);
        return parts.join(", ");
      };
      const uniqueJobLocs = new Map<string, JobLoc>();
      for (const r of rows) {
        const jobLoc =
          typeof r.jobId === "string"
            ? jobLocByCuid.get(r.jobId)
            : jobLocByRfId.get(r.jobId);
        if (!jobLoc) continue;
        const key = jobLocKey(jobLoc);
        if (key) uniqueJobLocs.set(key, jobLoc);
      }
      const jobLatLngByKey = new Map<string, { lat: number; lng: number } | null>();
      // Serial loop intentional — keeps Nominatim within its usage
      // policy (one request at a time). Warm-cache hits are sync and
      // cheap; only cold strings actually round-trip. Array.from
      // wrapper matches the existing codebase pattern for Map iteration
      // (the tsconfig target does not enable downlevelIteration).
      for (const [key, loc] of Array.from(uniqueJobLocs.entries())) {
        const query = jobLocQuery(loc);
        if (!query) {
          jobLatLngByKey.set(key, null);
          continue;
        }
        jobLatLngByKey.set(key, await geocodePill(query));
      }

      // Attach distanceLine to each currently-rendered row.
      for (const r of rows) {
        const candidatePoint =
          typeof r.candidateId === "string"
            ? candidateLatLngByCuid.get(r.candidateId)
            : candidateLatLngByRfId.get(r.candidateId);
        const jobLoc =
          typeof r.jobId === "string"
            ? jobLocByCuid.get(r.jobId)
            : jobLocByRfId.get(r.jobId);
        if (candidatePoint && jobLoc) {
          const key = jobLocKey(jobLoc);
          const jobPoint = key ? jobLatLngByKey.get(key) : null;
          if (jobPoint) {
            const miles = haversineMiles(
              candidatePoint.lat,
              candidatePoint.lng,
              jobPoint.lat,
              jobPoint.lng,
            );
            r.distanceLine = `(${miles} ${miles === 1 ? "mile" : "miles"})`;
          }
        }
      }
    }

    // ---- Applicants + Kept assembly ----
    //
    // Ported from the standalone /applicants page when that surface was
    // folded into /pipeline. RF-sourced "applied" rows come from each
    // RFCandidate.jobs[].stage_name; local-Placement applied + kept rows
    // come straight from Placement.stage. The two row shapes carry the
    // fields the Applied / Kept row components need (source, appliedAt,
    // keptAt, clientRfId) and skip the PipelineRow extras (placementId,
    // next interview).
    const candidateByRfId = new Map<number, RFCandidate>();
    for (const c of candidates) candidateByRfId.set(c.id, c);
    const jobByRfId = new Map<number, RFJob>();
    for (const j of allJobs) jobByRfId.set(j.id, j);
    const overrideByJob = new Map<number, { title: string | null }>();
    for (const o of jobOverrides) overrideByJob.set(o.jobRfId, { title: o.title });

    type PlacementJob = {
      title: string;
      locations: string[];
      client: { name: string | null } | null;
    };
    const describeJob = (
      jobIdN: number | null,
      fallbackJob?: RFCandidateJob,
      placementJob?: PlacementJob | null,
    ): { title: string; location: string; clientName: string } => {
      if (jobIdN == null) {
        if (placementJob) {
          return {
            title: placementJob.title || "(job)",
            location: placementJob.locations?.[0] ?? "",
            clientName: placementJob.client?.name ?? "",
          };
        }
        return { title: "(job)", location: "", clientName: "" };
      }
      const rfJob = jobByRfId.get(jobIdN) ?? null;
      const normalized = rfJob ? normalizeJob(rfJob) : null;
      const title = resolveJobTitle({
        override: overrideByJob.get(jobIdN) ?? null,
        // Pass both the canonical RFJob AND the sparse RFCandidateJob so
        // the resolver can grab a title from whichever source has one.
        job: { ...(rfJob ?? {}), ...(fallbackJob ?? {}) },
      });
      const location = normalized?.location ?? "";
      const clientName = normalized?.company ?? fallbackJob?.client_company_name ?? "";
      return { title, location, clientName };
    };

    // Disqualify a (candidate, job) pair from Applied if the recruiter has
    // already moved them past applied. A Placement at stage="applied" is
    // the canonical "lives here" signal and must NOT hide the row.
    // Same for "kept" — those go in the Kept tab, not Applied.
    const HIDE_FROM_APPLIED: ReadonlySet<string> = new Set([
      "submitted",
      "interviewing",
      "offer",
      "pending_start",
      "hired",
      "rejected",
      "cancelled",
      "kept",
    ]);

    const intakeKey = (p: {
      candidateRfId: number | null;
      candidateId: string | null;
      jobRfId: number | null;
      jobId: string | null;
    }) => {
      const jobKey = p.jobRfId != null ? String(p.jobRfId) : p.jobId ?? "?";
      return p.candidateRfId != null
        ? `rf:${p.candidateRfId}:${jobKey}`
        : `ace:${p.candidateId ?? "?"}:${jobKey}`;
    };

    const placedPairsHidden = new Set<string>();
    const localApplied = new Map<string, (typeof allPlacementsWithJob)[number]>();
    for (const p of allPlacementsWithJob) {
      const key = intakeKey(p);
      if (HIDE_FROM_APPLIED.has(p.stage)) {
        placedPairsHidden.add(key);
      } else if (p.stage === "applied") {
        localApplied.set(key, p);
      }
    }

    // Batch-fetch Neon Candidate rows for every Ace-native candidateId
    // referenced by an Applied or Kept Placement (powers name/title in
    // the rows the legacy skip-gates used to drop).
    const aceIntakeCandidateIds = new Set<string>();
    for (const p of allPlacementsWithJob) {
      if (p.candidateRfId == null && p.candidateId) aceIntakeCandidateIds.add(p.candidateId);
    }
    const aceIntakeCandidates = aceIntakeCandidateIds.size > 0
      ? await prisma.candidate.findMany({
          where: { id: { in: Array.from(aceIntakeCandidateIds) } },
          // Ace 68.0: also select currentOrganization / location /
          // expectedSalary so the intake (Applicants + Kept) tables can
          // render the uniform LEFT column set.
          select: {
            id: true,
            firstName: true,
            lastName: true,
            currentDesignation: true,
            currentOrganization: true,
            location: true,
            expectedSalary: true,
            createdAt: true,
          },
        })
      : [];
    const aceIntakeById = new Map(aceIntakeCandidates.map((c) => [c.id, c]));

    // Helper to resolve an owner id for an intake row using the same
    // clientId / clientName fallbacks the main pipeline uses, so the
    // owner-scope filter behaves identically on these two new tabs.
    const intakeOwnerId = (clientId: string | null, clientName: string): string | null => {
      if (clientId) return ownerByClientId.get(clientId) ?? null;
      if (clientName) return ownerByClientNameLower.get(clientName.toLowerCase()) ?? null;
      return null;
    };

    const intakeMatchesOwner = (clientOwnerId: string | null): boolean => {
      if (owner === "all") return true;
      if (owner === "theirs") return otherUserId != null && clientOwnerId === otherUserId;
      return currentUserId != null && clientOwnerId === currentUserId;
    };

    // RF-sourced applied rows: candidates whose RF stage_name canonicalizes
    // to "applied" and that haven't been moved past Applied locally.
    for (const c of candidates) {
      const jobs: RFCandidateJob[] = Array.isArray(c.jobs) ? c.jobs : [];
      const name =
        c.name ??
        [c.first_name, c.last_name].filter(Boolean).join(" ") ??
        "(unnamed)";
      for (const j of jobs) {
        if (typeof j?.job_id !== "number") continue;
        if (canonicalStage(j.stage_name) !== "applied") continue;
        if (placedPairsHidden.has(`rf:${c.id}:${j.job_id}`)) continue;
        const desc = describeJob(j.job_id, j);
        appliedRows.push({
          candidateId: c.id,
          candidateName: name || "(unnamed)",
          // Ace 68.0 uniform-LEFT columns on the intake table.
          candidateTitle: c.current_designation ?? "",
          candidateEmployer: c.current_organization ?? "",
          candidateLocation: formatLocation(c.location ?? null),
          candidateExpectedSalary: extractExpectedSalaryNumber(c.expected_salary),
          jobId: j.job_id,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: j.client_company_id ?? 0,
          clientName: desc.clientName,
          clientIsVerified: desc.clientName
            ? verifiedByClientNameLower.get(desc.clientName.toLowerCase()) ?? false
            : false,
          appliedAt: j.stage_moved ?? j.added_time ?? c.added_time ?? null,
          source: c.source_name ?? null,
          clientOwnerId: intakeOwnerId(null, desc.clientName),
        });
      }
    }

    // Local-Placement applied rows: clicking Apply in Ace writes
    // Placement.stage="applied"; surface those even when RF still says
    // sourced. Skip dedupe against RF-sourced entries by candidate/job key.
    const seenAppliedKey = new Set<string>();
    for (const r of appliedRows) seenAppliedKey.add(`rf:${r.candidateId}:${r.jobId}`);
    for (const [key, p] of Array.from(localApplied.entries())) {
      if (seenAppliedKey.has(key)) continue;
      const rowJobId: number | string = p.jobRfId != null ? p.jobRfId : p.jobId ?? "";
      if (p.candidateRfId != null) {
        const cand = candidateByRfId.get(p.candidateRfId);
        const candJob = cand && Array.isArray(cand.jobs)
          ? (cand.jobs as RFCandidateJob[]).find((j) => j.job_id === p.jobRfId)
          : null;
        const candName =
          cand?.name ??
          [cand?.first_name, cand?.last_name].filter(Boolean).join(" ") ??
          "(unnamed)";
        const desc = describeJob(p.jobRfId, candJob ?? undefined);
        appliedRows.push({
          candidateId: p.candidateRfId,
          candidateName: candName || "(unnamed)",
          candidateTitle: cand?.current_designation ?? "",
          candidateEmployer: cand?.current_organization ?? "",
          candidateLocation: formatLocation(cand?.location ?? null),
          candidateExpectedSalary: extractExpectedSalaryNumber(cand?.expected_salary),
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
          clientIsVerified: p.clientId
            ? verifiedByClientId.get(p.clientId) ?? false
            : desc.clientName
              ? verifiedByClientNameLower.get(desc.clientName.toLowerCase()) ?? false
              : false,
          appliedAt: p.updatedAt.toISOString(),
          source: p.source ?? cand?.source_name ?? null,
          clientOwnerId: intakeOwnerId(p.clientId, desc.clientName),
        });
        continue;
      }
      if (p.candidateId) {
        const ace = aceIntakeById.get(p.candidateId);
        const aceName = ace
          ? [ace.firstName, ace.lastName].filter(Boolean).join(" ") || "(unnamed)"
          : "(unnamed)";
        const desc = describeJob(p.jobRfId, undefined, p.job);
        appliedRows.push({
          candidateId: p.candidateId,
          candidateName: aceName,
          candidateTitle: ace?.currentDesignation ?? "",
          candidateEmployer: ace?.currentOrganization ?? "",
          candidateLocation: formatLocation(ace?.location ?? null),
          candidateExpectedSalary: extractExpectedSalaryNumber(ace?.expectedSalary ?? null),
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
          clientIsVerified: p.clientId
            ? verifiedByClientId.get(p.clientId) ?? false
            : desc.clientName
              ? verifiedByClientNameLower.get(desc.clientName.toLowerCase()) ?? false
              : false,
          appliedAt: p.updatedAt.toISOString(),
          source: p.source ?? null,
          clientOwnerId: intakeOwnerId(p.clientId, desc.clientName),
        });
      }
    }

    appliedRows.sort((a, b) => {
      const ta = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
      const tb = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
      return tb - ta;
    });

    // Kept rows: local Placement rows with stage="kept". Handles both
    // RF-imported (candidateRfId) and Ace-native (candidateId) rows.
    for (const p of allPlacementsWithJob) {
      if (p.stage !== "kept") continue;
      const rowJobId: number | string = p.jobRfId != null ? p.jobRfId : p.jobId ?? "";
      if (p.candidateRfId != null) {
        const cand = candidateByRfId.get(p.candidateRfId);
        const candName =
          cand?.name ??
          [cand?.first_name, cand?.last_name].filter(Boolean).join(" ") ??
          "(unnamed)";
        const candJob = cand && Array.isArray(cand.jobs)
          ? (cand.jobs as RFCandidateJob[]).find((j) => j.job_id === p.jobRfId)
          : null;
        const desc = describeJob(p.jobRfId, candJob ?? undefined);
        keptRows.push({
          candidateId: p.candidateRfId,
          candidateName: candName || "(unnamed)",
          candidateTitle: cand?.current_designation ?? "",
          candidateEmployer: cand?.current_organization ?? "",
          candidateLocation: formatLocation(cand?.location ?? null),
          candidateExpectedSalary: extractExpectedSalaryNumber(cand?.expected_salary),
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
          clientIsVerified: p.clientId
            ? verifiedByClientId.get(p.clientId) ?? false
            : desc.clientName
              ? verifiedByClientNameLower.get(desc.clientName.toLowerCase()) ?? false
              : false,
          keptAt: p.updatedAt.toISOString(),
          clientOwnerId: intakeOwnerId(p.clientId, desc.clientName),
        });
        continue;
      }
      if (p.candidateId) {
        const ace = aceIntakeById.get(p.candidateId);
        const aceName = ace
          ? [ace.firstName, ace.lastName].filter(Boolean).join(" ") || "(unnamed)"
          : "(unnamed)";
        const desc = describeJob(p.jobRfId, undefined, p.job);
        keptRows.push({
          candidateId: p.candidateId,
          candidateName: aceName,
          candidateTitle: ace?.currentDesignation ?? "",
          candidateEmployer: ace?.currentOrganization ?? "",
          candidateLocation: formatLocation(ace?.location ?? null),
          candidateExpectedSalary: extractExpectedSalaryNumber(ace?.expectedSalary ?? null),
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
          clientIsVerified: p.clientId
            ? verifiedByClientId.get(p.clientId) ?? false
            : desc.clientName
              ? verifiedByClientNameLower.get(desc.clientName.toLowerCase()) ?? false
              : false,
          keptAt: p.updatedAt.toISOString(),
          clientOwnerId: intakeOwnerId(p.clientId, desc.clientName),
        });
      }
    }
    keptRows.sort((a, b) => new Date(b.keptAt).getTime() - new Date(a.keptAt).getTime());

    // Owner-scope the intake rows the same way the main pipeline rows are
    // scoped above so toggling Mine/Theirs/All affects all 7 tabs.
    appliedRows = appliedRows.filter((r) => intakeMatchesOwner(r.clientOwnerId));
    keptRows = keptRows.filter((r) => intakeMatchesOwner(r.clientOwnerId));

    // Apply the client/job deep-link filters (same semantics as the main
    // pipeline — RF-flat-only applied rows have no clientId so they fall
    // through clientFilter, mirroring the main loop's exclusion).
    if (clientFilter) {
      appliedRows = appliedRows.filter((r) => {
        const p = allPlacementsWithJob.find(
          (pp) =>
            (pp.candidateRfId != null && pp.candidateRfId === r.candidateId) ||
            (pp.candidateId != null && pp.candidateId === r.candidateId),
        );
        return p?.clientId === clientFilter;
      });
      keptRows = keptRows.filter((r) => {
        const p = allPlacementsWithJob.find(
          (pp) =>
            (pp.candidateRfId != null && pp.candidateRfId === r.candidateId) ||
            (pp.candidateId != null && pp.candidateId === r.candidateId),
        );
        return p?.clientId === clientFilter;
      });
    }
    if (jobFilter !== null) {
      appliedRows = appliedRows.filter(
        (r) => typeof r.jobId === "number" && r.jobId === jobFilter,
      );
      keptRows = keptRows.filter(
        (r) => typeof r.jobId === "number" && r.jobId === jobFilter,
      );
    }

    counts.applied = appliedRows.length;
    counts.kept = keptRows.length;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to fetch pipeline";
  }

  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.candidateName.toLowerCase().includes(needle) ||
        r.jobTitle.toLowerCase().includes(needle) ||
        r.clientName.toLowerCase().includes(needle),
    );
    appliedRows = appliedRows.filter(
      (r) =>
        r.candidateName.toLowerCase().includes(needle) ||
        r.jobTitle.toLowerCase().includes(needle) ||
        r.clientName.toLowerCase().includes(needle),
    );
    keptRows = keptRows.filter(
      (r) =>
        r.candidateName.toLowerCase().includes(needle) ||
        r.jobTitle.toLowerCase().includes(needle) ||
        r.clientName.toLowerCase().includes(needle),
    );
  }

  if (stage === "pending_start") {
    rows.sort((a, b) => {
      const ta = a.placement?.expectedStartDate ? new Date(a.placement.expectedStartDate).getTime() : Infinity;
      const tb = b.placement?.expectedStartDate ? new Date(b.placement.expectedStartDate).getTime() : Infinity;
      return ta - tb;
    });
  } else {
    rows.sort((a, b) => {
      const ta = a.lastActionAt ? new Date(a.lastActionAt).getTime() : 0;
      const tb = b.lastActionAt ? new Date(b.lastActionAt).getTime() : 0;
      return tb - ta;
    });
  }

  // Ace 67.11: pagination dropped on every pipeline tab. The main-
  // pipeline buckets (submitted / interviewing / offer / pending_start /
  // hired) render the full filtered set; intake buckets (applied / kept)
  // were already non-paginated, so this is now uniform.
  const pageRows = stage === "applied" || stage === "kept" ? [] : rows;

  // When the page is reached via a stage-pill on a client profile, render
  // a "← Back to <client>" affordance so the recruiter can return without
  // hitting the browser back button (which would replay the stage-pill
  // click and re-route them right back here).
  let backToClient: { href: string; name: string } | null = null;
  if (clientFilter) {
    try {
      const org = await getCurrentOrg();
      const client = await prisma.client.findFirst({
        where: { id: clientFilter, organizationId: org.id },
        select: { id: true, legacyRfId: true, name: true },
      });
      if (client) {
        const slug = client.legacyRfId != null ? String(client.legacyRfId) : client.id;
        backToClient = { href: `/clients/${slug}`, name: client.name || "client" };
      }
    } catch {
      // Soft-fail: missing client lookup just hides the back link.
    }
  }

  return (
    <div>
      {backToClient && (
        <Link
          href={backToClient.href}
          className="mb-3 inline-flex items-center gap-1 text-sm text-court-fg-muted transition hover:text-court-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to {backToClient.name}
        </Link>
      )}
      <PipelineView
        rows={pageRows}
        appliedRows={appliedRows}
        keptRows={keptRows}
        stage={stage}
        q={q}
        counts={counts}
        owner={owner}
        otherUserName={otherUserName}
        error={error}
      />
    </div>
  );
}

type PlacementRow = Awaited<ReturnType<typeof prisma.placement.findMany>>[number];

function toPlacementDetails(
  p: PlacementRow,
  invoiceStatus: "DRAFT" | "SENT" | "PAID" | null,
  invoicePaymentMethod: "CHECK" | "ACH" | "CREDIT" | null,
): PlacementDetails {
  return {
    id: p.id,
    stage: p.stage as "offer" | "pending_start" | "hired",
    syncedToRf: p.syncedToRf,
    acceptedSalary: p.acceptedSalary,
    acceptedCurrency: p.acceptedCurrency,
    feePercentage: p.feePercentage,
    feeTotal: p.feeTotal,
    billingContactName: p.billingContactName,
    billingContactEmail: p.billingContactEmail,
    expectedStartDate: p.expectedStartDate?.toISOString() ?? null,
    startConfirmedAt: p.startConfirmedAt?.toISOString() ?? null,
    invoiceStatus,
    invoicePaymentMethod,
    placementNotes: p.placementNotes ?? null,
    candidateSource: p.candidateSource ?? null,
    cityOverride: p.cityOverride ?? null,
    useCustomTerms: p.useCustomTerms,
    installmentCount: p.installmentCount ?? null,
    inst1Amount: p.inst1Amount ?? null,
    inst1DaysAfterStart: p.inst1DaysAfterStart ?? null,
    inst2Amount: p.inst2Amount ?? null,
    inst2DaysAfterStart: p.inst2DaysAfterStart ?? null,
    inst3Amount: p.inst3Amount ?? null,
    inst3DaysAfterStart: p.inst3DaysAfterStart ?? null,
    customGuaranteeDate: p.customGuaranteeDate?.toISOString() ?? null,
    guaranteePeriodDays: p.guaranteePeriodDays ?? null,
  };
}

function isPipelineStage(b: PipelineBucket): b is keyof typeof PIPELINE_LABELS {
  return b === "submitted" || b === "interviewing" || b === "offer" || b === "pending_start" || b === "hired";
}
