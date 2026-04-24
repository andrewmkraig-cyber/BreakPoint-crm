# Activity log

## What it is

`ActivityLog` is the canonical, tenant-scoped audit feed for user-initiated events across Ace. Every row captures **who did what to what, when, in which tenant**, with an optional JSON metadata blob for context that would otherwise require joining back to the target row.

Formalized in Phase 4c. The table was introduced specifically so Dashboard counters, per-entity activity feeds, and future admin audit tooling all read from one standard shape instead of re-deriving "what happened this week" from a patchwork of column timestamps + ad-hoc `ActionLog` rows.

## Relationship to `ActionLog`

`ActionLog` predates `ActivityLog`. It's still in use — specific workflows (keep / reject / apply stage moves, cancel-placement reason capture, applicant-status transitions) write rows there with their own schema quirks. Those rows are **not** being migrated.

Going forward, **new audit trails write to `ActivityLog`.** Dashboard and admin surfaces read from both until legacy workflows migrate or the feature they feed is retired.

| Concern | `ActionLog` | `ActivityLog` |
|---|---|---|
| Shape | Loose. `actionType` / `subjectType` / `subjectId` / `metadata`, plus a couple of legacy columns. | Standardized. Same six core fields on every row. |
| Scope | Specific workflows (keep / reject / cancel / applicant status). | Any user-initiated action worth auditing. |
| New surfaces | Don't add new actionTypes here. | Yes — add here. |

## Schema

```prisma
model ActivityLog {
  id             String   @id @default(cuid())
  organizationId String                // tenant scope
  userId         String                // who did it
  timestamp      DateTime @default(now())
  actionType     String                // event kind (see table below)
  targetType     String                // "candidate" | "job" | "client" | "placement" | "interview"
  targetId       String                // cuid of the target row
  metadata       Json?                 // optional structured detail

  @@index([organizationId, timestamp(sort: Desc)])
  @@index([userId, timestamp(sort: Desc)])
  @@index([targetType, targetId])
  @@index([actionType])
}
```

`(organizationId, timestamp DESC)` is the Dashboard read pattern (newest-first in one tenant). `(userId, timestamp DESC)` powers per-user recent-activity feeds. `(targetType, targetId)` backs the per-entity activity panels that'll land on candidate / job / client profiles. `(actionType)` covers filter-by-event-type rollups.

## Action types firing today (Phase 4c)

| `actionType` | `targetType` | `targetId` | `metadata` |
|---|---|---|---|
| `candidate_created` | `candidate` | new Candidate.id | `{ source: "manual", hasResume, hasEmail }` |
| `submittal_sent` | `placement` | Placement.id | `{ jobId, jobRfId, candidateRfId \| candidateId, clientId, clientRfId, jobTitle, clientName, local? }` |
| `placement_confirmed` | `placement` | Placement.id | `{ feeAmount, acceptedSalary, feePercentage, startDate }` |

### Where each fires

- `candidate_created` — `src/app/candidates/new/actions.ts` `createCandidate`.
- `submittal_sent` — **two sites**: `src/app/candidates/[id]/placement-actions.ts` `sendSubmittalEmail` (RF-imported candidate profile, `page.tsx`) and `src/app/candidates/[id]/local-placement-actions.ts` `sendLocalSubmittalEmail` (Ace-native candidate profile, `local-profile.tsx`). Same `actionType` + `targetType`; `metadata.local: true` distinguishes the Ace-native path.
- `placement_confirmed` — `src/app/candidates/[id]/placement-actions.ts` `confirmStart`. Shared between both candidate profile variants via the `PlacementActionsIsland`.

## Not in scope today

### Future wire (Phase 4d or wire-as-touched)

- `candidate_applied_to_job`
- `interview_scheduled`
- `interview_cancelled`
- `offer_extended`
- `email_sent`

### Intentionally excluded

- `call_logged` — Quo (Krispcall webhook → `KrispcallLog`) owns call audit. Duplicating into `ActivityLog` would require re-listening for webhooks and would offer no new value over the existing `KrispcallLog` reads.

## How to write a row

Use `logActivity` from `src/lib/activity.ts`. Never call `prisma.activityLog.create` directly.

```ts
import { logActivity } from "@/lib/activity";

await logActivity({
  organizationId: org.id,
  userId,
  actionType: "submittal_sent",
  targetType: "placement",
  targetId: placement.id,
  metadata: { jobTitle, clientName, ... },
});
```

Rules:
- Required: `organizationId`, `userId`, `actionType`, `targetType`, `targetId`.
- `metadata` is optional; prefer a flat JSON shape with the fields the reader will want for filtering or display.
- `logActivity` **never throws**. A failed audit write logs to `console.error` and returns. Instrumentation that breaks the user action it's observing is worse than a missing row.
- `logActivity` does **not** call `getCurrentOrg()`. The caller passes `organizationId` explicitly so cron / background / script contexts can log with any orgId.

## How to query

### Dashboard "this week" counter

```ts
await prisma.activityLog.count({
  where: {
    organizationId: org.id,
    actionType: "submittal_sent",
    timestamp: { gte: weekStart, lt: weekEnd },
  },
});
```

### Per-entity activity feed (candidate profile)

```ts
await prisma.activityLog.findMany({
  where: {
    organizationId: org.id,
    OR: [
      { targetType: "candidate", targetId: candidate.id },
      { targetType: "placement", targetId: { in: placementIds } },
    ],
  },
  orderBy: { timestamp: "desc" },
  take: 50,
});
```

### Per-user "what I did today"

```ts
await prisma.activityLog.findMany({
  where: {
    organizationId: org.id,
    userId,
    timestamp: { gte: startOfDay },
  },
  orderBy: { timestamp: "desc" },
});
```

### Prisma Studio

```bash
npm run db:studio
# open http://localhost:5555 — ActivityLog table, filter by organizationId
```

### One-off script (matches the Phase 4c verification pattern)

```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.activityLog.findMany({
  orderBy: { timestamp: "desc" },
  take: 20,
  select: { id: true, actionType: true, targetType: true, targetId: true, metadata: true, timestamp: true },
});
console.log(rows);
```

## Future expansion

- **Per-entity Activity tab on candidate / job / client profiles** — flat list of `ActivityLog` rows where `targetType` + `targetId` match (plus any placement/interview children of that entity).
- **Admin audit console** — cross-tenant `ActivityLog` reads for Breakpoint-internal review (gated on a role check; multi-tenant awareness is a must if the table ever leaves single-org reality).
- **Retention / archive policy** — nothing in place today. The table grows unbounded. When volume matters, archive rows > 12 months old to cold storage and truncate from the live table.
- **Standardized `metadata` shapes per `actionType`** — today each call site picks its own fields. When readers multiply, freeze a TypeScript discriminated union on `actionType` so metadata access becomes type-safe.

## Don't

- Don't call `prisma.activityLog.create` directly — always `logActivity`. Skipping the helper means skipping the required-field validation and the non-throwing guarantee.
- Don't log from client components. Server actions + API routes only. Client components can't forge `organizationId` / `userId` safely.
- Don't stuff raw PII into `metadata`. Email addresses, phone numbers, candidate resume text — leave those out. Store the reference (`candidateId`, `placementId`) and let the reader join back.
- Don't use `ActivityLog` as a replacement for state columns. `Placement.stage` / `Interview.status` etc. stay authoritative. `ActivityLog` captures the **event** that led to the state transition; the state itself lives on the row.
