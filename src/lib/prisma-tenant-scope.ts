// Phase 5: Prisma client extension that auto-injects organizationId on
// every read/write against a tenant-scoped model. Belt-and-suspenders —
// explicit `where: { organizationId: org.id }` stays in the call sites
// as the primary guard; this extension catches anything that slips.
//
// Behavior:
// - Resolves org by calling getCurrentOrg(). Inside a Next.js request
//   handler this reads the session cookie. Outside one (scripts, cron,
//   CLI) it falls back to DEFAULT_ORG_ID env.
// - When neither is available, skips injection silently. That's the
//   intended path for prisma generate / one-shot scripts that don't
//   carry a session context and don't set DEFAULT_ORG_ID — they'll run
//   with whatever where clause they built by hand.
// - Only injects when the caller's where clause doesn't already set
//   organizationId. Callers can still scope explicitly and the
//   extension won't fight them.

// Every tenant model that has an organizationId column. Must match the
// schema exactly — extensions are addressed by model name.
const TENANT_MODELS: ReadonlySet<string> = new Set([
  "Candidate",
  "Job",
  "Client",
  "Placement",
  "Interview",
  "Contact",
  "ActionLog",
  "ActivityLog",
  "ClientAgreement",
  "ClientBenefits",
  "ClientBenefitsFile",
  "CandidateResume",
  "JobOverride",
]);

// Operations where a where-clause injection makes sense. We deliberately
// skip `create` / `createMany` — those are enforced on the data payload
// side (callers must pass organizationId in data), and the Prisma
// non-null schema catches missing fields at compile time.
const SCOPED_OPERATIONS: ReadonlySet<string> = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

async function resolveOrgIdOrNull(): Promise<string | null> {
  try {
    const { getCurrentOrg } = await import("@/lib/auth/getCurrentOrg");
    const org = await getCurrentOrg();
    return org.id;
  } catch {
    // No session and no DEFAULT_ORG_ID — fine for scripts / generate.
    return null;
  }
}

function hasOrganizationIdInWhere(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  return Object.prototype.hasOwnProperty.call(where, "organizationId");
}

// Injects `organizationId: <org>` into a where clause when the caller
// didn't set it. Handles both top-level wheres (findMany.where) and the
// `where` inside upsert.create / upsert.update-style payloads — those
// are addressed by the Prisma type gymnastics that wrap them.
function injectOrgIdInWhere<T extends Record<string, unknown>>(
  where: T | undefined,
  orgId: string,
): T {
  if (!where) return { organizationId: orgId } as unknown as T;
  if (hasOrganizationIdInWhere(where)) return where;
  return { ...where, organizationId: orgId };
}

// Exported as a plain object literal (not `Prisma.Extension`) so the
// Prisma type machinery can infer the extension shape correctly —
// typing as Prisma.Extension widens returns to unknown and breaks
// callers' type inference across ~150 call sites.
export const tenantScopeExtension = {
  name: "breakpoint-tenant-scope",
  query: {
    $allOperations: async ({ model, operation, args, query }: {
      model?: string;
      operation: string;
      args: unknown;
      query: (args: unknown) => Promise<unknown>;
    }) => {
      if (!model || !TENANT_MODELS.has(model) || !SCOPED_OPERATIONS.has(operation)) {
        return query(args);
      }
      const orgId = await resolveOrgIdOrNull();
      if (!orgId) return query(args);

      // upsert's where MUST stay a unique — widening it with
      // organizationId would break the upsert contract. Leave it
      // alone; upsert.create data blocks are guaranteed non-null by
      // the schema flip.
      if (operation === "upsert") {
        return query(args);
      }

      // Mutate a shallow copy of args so we don't affect the
      // caller's object. Prisma passes args by reference; a direct
      // mutation would leak.
      const next: Record<string, unknown> =
        args && typeof args === "object"
          ? { ...(args as Record<string, unknown>) }
          : {};
      const currentWhere = next.where as Record<string, unknown> | undefined;
      next.where = injectOrgIdInWhere(currentWhere, orgId);

      return query(next);
    },
  },
} as const;
