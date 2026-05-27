import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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

export const dynamic = "force-dynamic";

// Applied / Kept were folded in from the standalone /applicants page —
// they live before "Submitted" in the stage strip so the recruiter scans
// the pipeline in the same chronological order the candidate moves
// through it (Applicants → Kept → Submitted → ...). The two intake
// stages keep their own row shapes / actions; the main pipeline stages
// still drive PipelineRow.
type Stage = "applied" | "kept" | keyof typeof PIPELINE_LABELS;
const STAGES: Stage[] = [
  "applied",
  "kept",
  "submitted",
  "interviewing",
  "offer",
  "pending_start",
  "hired",
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
      getPlacementsForOrg(),
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
    for (const c of clients) {
      ownerByClientId.set(c.id, c.ownerId);
      if (c.name) ownerByClientNameLower.set(c.name.toLowerCase(), c.ownerId);
    }

    // (candidateRfId, jobRfId) -> earliest upcoming interview
    const nextByKey = new Map<string, NextInterview>();
    for (const iv of interviews) {
      if (iv.candidateRfId == null) continue;
      const key = `${iv.candidateRfId}:${iv.jobRfId}`;
      if (nextByKey.has(key)) continue; // first match wins (orderBy asc)
      nextByKey.set(key, {
        id: iv.id,
        scheduledAt: iv.scheduledAt.toISOString(),
        type: iv.type as NextInterview["type"],
      });
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
            select: { id: true, firstName: true, lastName: true, currentDesignation: true },
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
      // Cancelled placements are excluded from the pipeline view entirely.
      if (p.stage === "cancelled") continue;
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
      const jobTitle = isRfJob ? rfEntry?.jobTitle ?? "" : aceJob?.title ?? "";
      const clientName = isRfJob ? rfEntry?.clientName ?? "" : aceJob?.client?.name ?? "";
      // Owner of this row's client: prefer the Placement.clientId cuid
      // join, fall back to a clientName match for rows missing clientId.
      const clientOwnerId = p.clientId
        ? ownerByClientId.get(p.clientId) ?? null
        : clientName
          ? ownerByClientNameLower.get(clientName.toLowerCase()) ?? null
          : null;

      allRows.push({
        candidateId,
        candidateName,
        candidateTitle,
        jobId,
        jobTitle,
        clientName,
        stageName: PIPELINE_LABELS[stageName] ?? p.stage,
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
        nextInterview: isRfCandidate && isRfJob
          ? nextByKey.get(`${p.candidateRfId}:${p.jobRfId}`) ?? null
          : null,
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
        jobId: r.jobId,
        jobTitle: r.jobTitle,
        clientName: r.clientName,
        stageName: r.stageName,
        bucket: r.bucket,
        lastActionAt: r.stageMovedAt,
        daysInStage: daysBetween(r.stageMovedAt),
        isKept: r.isKept,
        placementId: null,
        placement: null,
        nextInterview: nextByKey.get(`${r.candidateId}:${r.jobId}`) ?? null,
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
          select: { id: true, firstName: true, lastName: true, currentDesignation: true, createdAt: true },
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
          jobId: j.job_id,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: j.client_company_id ?? 0,
          clientName: desc.clientName,
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
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
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
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
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
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
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
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
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
