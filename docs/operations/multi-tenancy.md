# Multi-tenancy

## Model

Every row in a **tenant table** belongs to exactly one `Organization`. Cross-tenant reads and writes are impossible at three independent layers:

1. **Schema layer (Prisma).** Every tenant table has `organizationId: String` (NOT NULL) + a required `Organization` relation with `onDelete: Cascade`. The column can't be skipped on insert; the row can't survive its org's deletion.
2. **Call-site layer (explicit scoping).** Every reader in `src/` passes `organizationId: org.id` in its `where` clause. Every writer stamps `organizationId` on the `data` payload. These are the primary guard.
3. **Client-layer extension (belt-and-suspenders).** A Prisma client extension at `src/lib/prisma-tenant-scope.ts` intercepts tenant-table operations and auto-injects `organizationId` when the caller forgot. **This is a backstop, not a replacement.** Explicit scoping stays in call sites because silent auto-injection hides bugs — you want the scoping to show up in the diff when it's introduced.

Phase 5 shipped all three layers together. Before Phase 5, `organizationId` was nullable on most tenant tables and the call sites were the only guard.

## Tenant tables

13 models, all with `organizationId: String` NOT NULL:

| Model | Notes |
|---|---|
| `Candidate` | |
| `Job` | |
| `Client` | |
| `Placement` | |
| `Interview` | |
| `Contact` | |
| `ActionLog` | legacy audit log (pre-`ActivityLog`) |
| `ActivityLog` | Phase 4c audit log |
| `ClientAgreement` | fee agreements (PDFs) |
| `ClientBenefits` | per-client benefits notes |
| `ClientBenefitsFile` | benefits PDFs/docs |
| `CandidateResume` | resume binaries |
| `JobOverride` | per-job description overrides |

Non-tenant models (global, not scoped):
- `User`, `Organization`, `OrganizationMembership`, `Account`, `Session`, `VerificationToken` — auth + tenant identity.
- `EmailTemplate`, `Setting`, `KpiCache` — app-wide config / cache.
- `ResumeUpload` — transient staging (5-minute TTL); belongs to an uploader, not an org.
- `SmsMessage`, `CallLog`, `CallTranscript`, `AiWorkspaceMessage` — pre-multi-tenancy. Scheduled for tenancy wire-up when multi-tenant messaging lands.

## `getCurrentOrg()` — the resolution contract

Every server action + route handler that writes should call `getCurrentOrg()` from `src/lib/auth/getCurrentOrg.ts` to resolve the tenant before the write. Resolution order:

1. **Session-based** — read `OrganizationMembership` off the signed-in user (first membership by `joinedAt asc`). This is the hot path inside request handlers.
2. **`DEFAULT_ORG_ID` env fallback** — used by scripts, cron, and the Prisma extension's silent-skip path when no session exists.

Throws if neither resolves. That throw is intentional: a tenant-scoped code path running without a tenant is a bug, not a degraded-mode scenario.

## The tenant-scope Prisma extension

`src/lib/prisma-tenant-scope.ts` exports a plain object that's applied to `PrismaClient` via `.$extends()` in `src/lib/prisma.ts`. The extension's `query.$allOperations` hook intercepts every op, checks whether the target model is tenant-scoped, and injects `organizationId: org.id` into the `where` clause when the caller's where didn't already include it.

Behavior matrix:

| Caller scope | Model tenant? | Op supported? | Extension action |
|---|---|---|---|
| Explicit `where.organizationId` | Yes | Yes | Leaves caller's value alone. |
| Implicit (no `where.organizationId`) | Yes | Yes | Injects `organizationId: <current org>`. |
| No active session + no `DEFAULT_ORG_ID` | Yes | Yes | Skips injection silently. Prisma runs with whatever the caller built. |
| `upsert` | Yes | — | Skipped entirely (widening a compound unique would break the upsert contract; `create.data` + schema NOT NULL still enforces tenancy). |
| `create` / `createMany` | — | — | Not hooked (the `data` payload must include `organizationId`; schema non-null catches misses at compile time). |
| Non-tenant model (User, Organization, Setting, etc.) | No | — | Skipped. Global tables read without scoping. |

The extension is a **backstop**. Call sites still need explicit `where: { organizationId: org.id }`. Reasons:

- **Diff visibility.** Explicit scoping shows up in code review. Silent auto-injection doesn't.
- **Compound uniques.** Prisma's upsert `where` clause must be a unique key — it's never auto-widened; tenancy is enforced via `create.data` + schema.
- **Script contexts.** Scripts that set `DEFAULT_ORG_ID` rely on the extension; scripts that don't must pass orgId by hand.
- **Debuggability.** A bug that relied on auto-injection is harder to trace than a missing `where.organizationId`.

## How to add a new tenant model

1. **Schema** — add the model in `prisma/schema.prisma` with:
   ```prisma
   organizationId String
   organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
   @@index([organizationId])
   ```
   Add a back-relation on `Organization` (e.g. `newModels NewModel[]`).
2. **Register the model name in the extension.** Add the model's string name to `TENANT_MODELS` in `src/lib/prisma-tenant-scope.ts`. Without this, the extension silently skips it.
3. **Call sites** — every new reader/writer scopes by `organizationId: org.id`. Don't rely on the extension alone.
4. **Tests** — add a case to `scripts/test-middleware.ts` that confirms `findMany()` on the new model without an explicit orgId returns only the current org's rows.
5. **Docs** — update the "Tenant tables" list above.

## How to add a new organization (future multi-tenant rollout)

Single-org today: every row in Neon belongs to `cmobj8dxz00012gliequ53kvc` (BreakPoint Talent). When a second org signs up:

1. Create an `Organization` row: `prisma.organization.create({ data: { name, slug, ownerId } })`.
2. Create the owner's `OrganizationMembership`: `prisma.organizationMembership.create({ data: { organizationId, userId, role: "owner" } })`.
3. Nothing else — all 13 tenant tables auto-scope per-row, and cross-tenant reads are blocked by the client extension even if the call site forgets to scope.

A future "org switcher" UI needs to honour the active-org cookie (noted in `getCurrentOrg()`'s doc comment — currently returns the first membership). When that lands, update `getCurrentOrg()` to read the cookie and fall back to first-membership.

## What NOT to do

- **Don't** write directly to tenant tables with `prisma.$executeRaw` — the extension doesn't hook raw queries. Raw is allowed for read-only reporting; never for tenant-table writes.
- **Don't** relax `onDelete: Cascade` on `Organization` relations. Cascading is the fail-safe if a tenant ever needs to be purged.
- **Don't** add a new tenant model without adding it to `TENANT_MODELS`. The extension is the backstop — if it doesn't know the model exists, it can't catch mistakes.
- **Don't** call `prisma.<model>.create({ data: {...} })` without `organizationId` in `data` for a tenant model. The schema will reject the insert at runtime; the TypeScript type will reject it at compile time.

## Testing

Smoke: the happy-path Playwright test in `tests/smoke/happy-path.spec.ts` exercises the full tenant stack (candidate create → apply → job page → applicants → submit composer → interview composer). It runs against the default org and passes 1/1 today.

Extension unit: `scripts/test-middleware.ts` verifies the four behavior-matrix rows above. Run via:

```bash
set -a; source .env.local; set +a
DEFAULT_ORG_ID=cmobj8dxz00012gliequ53kvc npx tsx scripts/test-middleware.ts
```

Expected output: all four tests pass. If Test 1 fails (row in wrong org), the extension or a call site is leaking — investigate before shipping.
