import type { Placement, Prisma } from "@prisma/client";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Placement.stage is a loose string on the schema (no enum) so callers
// still type-check the small set of stage values Ace writes. Tightened to
// a union here so downstream switch/case coverage stays honest.
export type PlacementStage =
  | "sourced"
  | "applied"
  | "kept"
  | "submitted"
  | "interviewing"
  | "offer"
  | "pending_start"
  | "hired"
  | "rejected"
  | "cancelled";

export type PlacementsForOrgOpts = {
  // Limit to one candidate (cuid). The candidate/profile views pass this
  // to keep the result set to a single candidate's placements.
  candidateId?: string;
  // Limit to one job. Accepts either a cuid (Ace-native) or a numeric
  // legacyRfId (RF-imported) — the helper tries both so callers don't
  // have to branch on identity shape. Undefined means "any job".
  jobIdentifier?: number | string;
  // Limit to one client. Same dual identity rules as job.
  clientIdentifier?: number | string;
  // Stage filter. ["kept","rejected",...] — implemented as `IN` when set.
  stages?: PlacementStage[];
  // Cancelled placements are excluded by default from every surface that
  // computes metrics, tables, maps, dashboards, or guarantee-period rows.
  // Callers that need cancelled rows visible (the /pipeline Show
  // Cancelled toggle, the candidate profile cancellation history, the
  // local-profile cancel ledger) opt in explicitly. When `stages` is
  // provided the caller is being explicit about which stages they want;
  // we respect that list and skip the implicit cancelled exclusion.
  includeCancelled?: boolean;
};

// Lists Placements for the signed-in tenant. All reads scope by
// organizationId (resolved from the session or DEFAULT_ORG_ID). Each
// filter above is optional and composable — unspecified filters widen
// the match, never narrow.
export async function getPlacementsForOrg(
  opts: PlacementsForOrgOpts = {},
): Promise<Placement[]> {
  const org = await getCurrentOrg();
  const where: Prisma.PlacementWhereInput = { organizationId: org.id };

  if (opts.candidateId) where.candidateId = opts.candidateId;

  if (opts.jobIdentifier !== undefined) {
    if (typeof opts.jobIdentifier === "number") {
      where.jobRfId = opts.jobIdentifier;
    } else {
      where.jobId = opts.jobIdentifier;
    }
  }
  if (opts.clientIdentifier !== undefined) {
    if (typeof opts.clientIdentifier === "number") {
      where.clientRfId = opts.clientIdentifier;
    } else {
      where.clientId = opts.clientIdentifier;
    }
  }
  if (opts.stages && opts.stages.length > 0) {
    where.stage = { in: opts.stages };
  } else if (!opts.includeCancelled) {
    // Default-exclude cancelled. Pipeline / dashboards / metrics callers
    // get the implicit filter; the candidate-profile and pipeline-toggle
    // callers pass includeCancelled:true to opt back in.
    where.stage = { not: "cancelled" };
  }

  return prisma.placement.findMany({ where });
}

// Resolves a Placement by its cuid primary key. Scoped to the caller's
// tenant so cross-org lookups return null rather than throwing.
export async function getPlacementByIdentifier(
  id: string,
): Promise<Placement | null> {
  if (!id) return null;
  const org = await getCurrentOrg();
  return prisma.placement.findFirst({
    where: { id, organizationId: org.id },
  });
}
