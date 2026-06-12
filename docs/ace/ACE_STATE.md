# ACE_STATE.md
Last updated: 2026-06-12 · Ace 94.0
Current Version: Ace 94.0
Last Shipped: 2026-06-12
Live at: ace.breakpointtalent.com

## What Shipped in Ace 94.0 (2026-06-12) - Merge-field arc (city/blurb/description) + bulk composer cleanup + Edit Resume with Claude + agreement auto-fill + create_contact tool

A multi-arc session. All items pushed to main; `npm run build` exits 0 after each. No blocking schema changes. (Note: some concurrent Codex work sat uncommitted in the working tree during this session - it was deliberately kept OUT of these commits; Step 0 baselines must be measured against committed HEAD, see ACE_RULES.md.)

- **New merge fields with shared resolution: `{{job_city}}`, `{{job_description}}`, `{{client_blurb}}`.** Registered in `merge-fields.ts` and resolved through ONE shared path used by BOTH the bulk composer and the trigger/automation send paths, so a token renders identically wherever it appears.
  - **`{{client_blurb}}` is the anonymized client descriptor** (e.g. "a fast-growing fintech in Austin"). `resolveClientBlurb` is the single resolver: it returns the client's stored `candidateBlurb` when present, else GENERATES a blurb once as a fallback. Client NAMES never reach candidates - the blurb is the only client descriptor allowed in candidate-facing copy (now a PERMANENT rule in ACE_RULES.md).
  - **`{{job_city}}`** surfaces just the city (not the full location string); **`{{job_description}}`** injects the JD body.
- **Candidate Recruit + Application Received templates swapped to the new tokens.** The seeded "Candidate Recruit" and "Application Received" templates now use `{{job_city}}` / `{{client_blurb}}` / `{{job_description}}` instead of literal/older fields. Applied to prod via idempotent, dry-run-by-default `--apply` scripts (same `scripts/` backfill pattern as prior sessions); re-running is a clean no-op. Application Received specifically anonymizes the client to `{{client_blurb}}` (no client name to candidates).
- **Bulk composer cleanup.** Removed the AI-prompt accordion from the bulk email modal and added a formatting toolbar (matching the individual composer's editing affordances) - the bulk template picker remains a native select (per the standing rule). 
- **Bulk + merge HTML fixes in `applyMergeFields`.** Fixed bulk email losing blank-line spacing vs the single composer (HTML paragraph/line-break normalization), and fixed markdown-style `**bold**` not converting to email HTML `<strong>` on the merge path.
- **Pipeline Source column reads the candidate's real source.** The pipeline table's Source now reflects the candidate's stored source value instead of a placeholder/derived guess.
- **Job pickers filter to ACTIVE jobs via a shared job-lifecycle helper.** All job-selection dropdowns (across send/compose paths) now route through one shared active-only lifecycle filter, so a closed/filled job no longer appears as a pick target anywhere.
- **Clubhouse KPI detail popups.** The Clubhouse KPI tiles are now clickable drill-downs: six categories, a period toggle, and full candidate names (first + last) in the popups.
- **Edit Resume with Claude (NEW feature + a multi-round Vercel serverless saga - lessons below).** A candidate-profile action that takes a plain-English instruction, edits the candidate's current resume, and saves the result as a new resume version ("Edited - <date>") without touching the original. `editResumeWithClaude` in `src/app/candidates/[id]/generate-resume-action.ts`. The build of this feature surfaced THREE distinct prod-only failures, each of which passed local verification before failing on Vercel - the core lesson is that server-side PDF code must be tested against the serverless bundle, not a local run:
  - **Round 1 - "DOMMatrix is not defined".** The legacy pdfjs build constructs `new DOMMatrix()` at module load; its only source for it is the OPTIONAL native `@napi-rs/canvas`, whose platform `.node` binary Next's file tracing never ships into the lambda. Two earlier attempts (externalizing pdfjs-dist; `serverComponentsExternalPackages`) looked fixed locally and did nothing in prod, because a Mac loads the native binary fine. **Fix:** a pure-JS `DOMMatrix` polyfill (+ `ImageData`/`Path2D` stubs) installed on `globalThis` before pdfjs imports - `src/lib/pdf-node-globals.ts`, `ensurePdfNodeGlobals()`. Verified by simulating the lambda locally (forcing the `@napi-rs/canvas` require to fail) and reproducing the exact error.
  - **Round 2 - "Setting up fake worker failed: Cannot find module .../pdf.worker.mjs".** Server-side pdfjs runs on the main thread but still dynamically `import()`s its worker file, which isn't traced into the lambda. **Fix:** `await import("pdfjs-dist/legacy/build/pdf.worker.mjs")` before `getDocument` - this sets `globalThis.pdfjsWorker` (so pdfjs uses the in-memory handler and skips the file import) AND makes Next trace the worker into the bundle. Same fix applied to the resume redactor (`resume-redactor/redact-pdf.ts`), which shares the path. Both pdfjs fixes are now a PERMANENT rule in ACE_RULES.md; never reintroduce `@napi-rs/canvas` dependence. Walked the rest of the pipeline (DOCX via mammoth, Claude call, @react-pdf render, Blob upload, Prisma save) and confirmed no other lambda-missing file/binary deps.
  - **Round 3 - structural fidelity.** The edit worked end-to-end but reformatted the whole resume and dropped non-standard sections, because the original schema forced every resume into a rigid 6-bucket shape (summary/experience/education/skills/certifications) rendered in a two-column template. **Fix at all three stages:** (1) extraction now emits a blank line on large vertical baseline gaps so section boundaries survive into the text Claude sees; (2) replaced the rigid schema with a flexible, order-preserving `sections[]` model (each with its source heading + generic entries: primary/secondary/meta/description/bullets) and tightened the prompt to mirror the source 1:1 and change only what's asked; (3) a NEW single-column, source-ordered `EditedResumeDocument` (`edited-resume-template.tsx`) used ONLY by the edit path - the generator keeps its rigid `ResumeData` + two-column template, which is right for building from DB fields. Reduced section-header `letterSpacing` so uppercase headers don't extract/parse as "S U M M A RY" in an ATS. Verified end-to-end against the REAL Claude API on a 7-section resume: all sections (incl. Projects/Awards/Volunteer the old schema dropped) survived in order, and the before-vs-after PDF text-diff was exactly the instructed change ("senior" -> "staff") and nothing else.
- **Agreement auto-fill on "Summarize Terms" (`b402b2d`).** When summarizing an uploaded client agreement, Ace now does a structured extraction of status/fee and presents a confirm box to Apply the detected values to the client (rather than only summarizing). Includes a backfill script for existing agreements (dry-run-by-default per the `scripts/` pattern).
- **Ace Assistant `create_contact` tool (`1e00c70`).** A direct-execute write tool following the Ace Assistant Write-Tool Pattern, with a duplicate guard so the same contact isn't created twice. Composer-containment fix shipped alongside (`d44d506`).

## What Shipped in Ace 93.0 (2026-06-11) - Bulk email throttling + multi-format CSV import + structural build gates

Three arcs landed the same afternoon (after the 91.0-92.0 UI-consistency close), all pushed to main; `npm run build` exits 0 after each. The build now also runs `npm run check:ui` (structural gates, below). No new schema columns - the throttle reuses the existing `ScheduledEmail` table via `source = "bulk_email"`.

- **Bulk candidate email is server-throttled, not instant (`d6228c3`).** "Send to N candidates" no longer blasts every email inline. `bulkSendEmail` (`src/app/candidates/bulk-actions.ts`) resolves each recipient's merge fields, then enqueues ONE `ScheduledEmail` row per candidate (`source = "bulk_email"`) with a staggered `scheduledSendAt`; the existing per-minute cron `/api/cron/scheduled-send` drains them one at a time. Fully server-side: the send keeps going after the browser tab closes, never uses a client `setTimeout`, and survives a deploy. Timing math lives in `computeBulkSchedule` (`src/lib/bulk-send-queue.ts`):
  - **Spacing + jitter.** `bulkSendSpacingMinutes` between sends, each gap randomized +/- 20% (`0.8 + random*0.4`) so the cadence is not robotic. Default and current setting: **2 minutes**. `0` sends as fast as the queue allows. Configured in Settings > Bulk Email Pacing.
  - **Daily cap.** At most `bulkDailyCap` bulk emails land on any one Eastern calendar day (counts rows already SCHEDULED or SENT that day, so the cap holds ACROSS batches). Overflow rolls to the next ET day starting 8am. Default **50**, currently set **75**. Spacing alone does not limit volume; the cap does.
  - **Append, never parallel, never resets.** A new batch starts AFTER the latest still-pending bulk row's `scheduledSendAt` (a `findFirst` tail query), so a second batch queued while a first is draining extends the single timeline instead of racing or resetting it.
  - **Sender stored per row.** Each row persists `sendAsEmail = user.email` (the main Gmail today). When multi-inbox/domain rotation is added later, only this per-row field changes - the timing layer is a data change away, not a re-architect.
  - **Queue status panel** (`getBulkQueueStatus` + the BulkEmailDialog): pending, sent-today, next-send time, finish-by (`lastAt`), how many slipped to tomorrow (`overflowToNextDay`), the single sender, and a **Cancel remaining** action (`cancelBulkQueue` flips SCHEDULED -> CANCELED; never touches a SENDING/in-flight row).
  - **Cron tightened `*/5 * * * *` -> `* * * * *`** (`vercel.json`) so the per-minute drain actually honors sub-five-minute spacing.
  - **Settings split to their own tab (`5c9f508`).** Bulk email pacing is now `/settings/bulk-email`, listed above Templates + Triggers (split out of the templates page; Personal Trainer moved to the bottom above Claude History).
  - **Deliverability context (Andrew, operational - not code-derived).** All candidate bulk sends leave `andrew@breakpointtalent.com` via the Gmail API. Pin also sends from this same inbox (~13/day average, 64 peak). Combined Pin + Ace volume from this identity should stay under ~200/day. Domain reputation is monitored in Google Postmaster Tools (verified 2026-06-11). The bulk cap governs CANDIDATE bulk only (`source = "bulk_email"`): Apollo BD enrollment sends through its own Apollo mailboxes / Sending Domains (rotation live at N=5, Ace 89.0) with a separate budget - the two do NOT share sending domains.

- **CSV candidate import is multi-format and never silently reports zero (`b0565c6`, `e7f87b4`, `d4e4c3c`).**
  - **Format detection (`src/app/api/candidates/import-csv/route.ts`).** Reads the header row and picks a mapper: **Pin** (dotted `candidate.*` export, unchanged), **ZoomInfo PERSON export**, or a **generic** best-effort fallback. ZoomInfo mapping: First/Last Name, Job Title -> title, Email Address -> email, phone = Mobile phone preferred then Direct Phone Number, Person City + Person State -> location, Company Name -> employer, LinkedIn Contact Profile URL -> linkedin. Generic fallback matches common headers case-insensitively (first/last/full name, email, title, company, phone, location, linkedin) and splits a single "Full Name" cell, so an unknown export imports best-effort instead of skipping every row. The response carries a breakdown (`format`, `total`, `skippedNoName`, `skippedError`, `importedNoEmail`). Root cause it fixed: a ZoomInfo PERSON export imported 0 because the mapper only understood Pin's dotted headers, so every row hit the no-name skip silently.
  - **No silent zero (`src/app/candidates/add-multiple-dialog.tsx`).** The Add Multiple dialog shows an in-place results panel itemizing the detected format, imported count, duplicates, and skips with reasons; it STAYS OPEN unless the import was fully clean (then it auto-closes and refreshes the list). A zero-import renders as an error (red banner + error toast), not a success.
  - **Entry point restored (`e7f87b4`).** The "Add Multiple" chip lives in the global topbar next to New Candidate (`src/components/top-bar-page-title.tsx`, `extraAction`), always visible regardless of candidate filter state. History note: the original button was lost in the 2026-05-10 candidates-page redesign (`6615930`) because the new search-rail page never carried it over; the orphaned `candidates-view.tsx` (which still type-checked and still held the button) caused a false "feature is live" audit. `candidates-view.tsx` is now DELETED (`d4e4c3c`) and the dialog lives in `add-multiple-dialog.tsx`.

- **Structural build gates: `npm run check:ui` runs in every build (`7c74fc2`).** package.json's build is now `prisma generate && npm run check:ui && next build`, so Vercel and local builds both enforce two gates (full detail + the convert-and-shrink ratchet rule in ACE_RULES.md):
  - **Raw `<button>` gate** (`scripts/check-raw-buttons.mjs` + `scripts/raw-button-baseline.json`): blocks any NEW raw `<button>` outside `src/components/ui/`; existing ones grandfathered per-file; the baseline only ratchets DOWN; `--update` is a deliberate escape hatch. Applied today: the Add Multiple dialog footer buttons converted to the shared `<Button>` and its baseline lowered 5 -> 3 (`1eaeebe`); bulk-pacing Save + bulk-dialog footers earlier (`952c9dd`, `c183250`, `926c566`).
  - **Candidates topbar smoke test** (`tests/unit/candidates-topbar-actions.test.mjs`): fails the build if the topbar spec ever drops New Candidate or Add Multiple - a regression guard so the bulk-import entry point cannot silently disappear in a future redesign.

## What Shipped in Ace 91.0-92.0 (2026-06-11) - UI-consistency audit CLOSED (shared inputs + shared tables)

The multi-session UI-consistency audit is complete and the project is **CLOSED**. All commits pushed to main; `npm run build` exits 0 after each group. No schema changes.

- **Shared input migration (Ace 91.0).** Built shared `Input` / `Textarea` / `Select` (`src/components/ui/input.tsx`) wrapping the Ace 66.0 court-input-rect standard (no new styling) and migrated the hand-rolled form inputs across the app in three waves (F3 composers/modals; settings + F2 editables + misc; then the final pass: contacts-tab, invoice-detail, promote-tab, matches-tab, notes panels, compose-fab). Resolved audit F6 with the permanent **Owner-Filter Standard** (ACE_DESIGN.md): branded green chip for owner-scope filters (Jobs/Clients/Pipeline), neutral shared Select for all other generic filters. Genuinely-non-fitting controls flagged + skipped (calendar icon-composite frame family, chip widgets, frameless note titles, file pickers, checkboxes/radios, pill surfaces). Full record in ACE_ROADMAP.md.
- **Table migration (Ace 92.0).** Routed the last two hand-rolled list tables (`candidates-view.tsx`, `clients-view.tsx`) through the shared `DataTableBody` + `DataTableRow` (`ui/data-table.tsx`), so all recruiter list tables (Pipeline / Jobs / Applicants / Candidates / Clients) share the canonical row treatment (soft dividers, `hover:bg-court-surface-subtle/60`, `px-3 py-2`). Fixed the remaining table-audit items: **T5** (candidates dropped its per-row `border-b border-court-border/40` heavy divider), **T6** (clients: only the name stays emphasized - Open count + Fee % de-bolded), **T7** (client name `font-semibold` -> `font-medium`), **T8** (candidates: one metadata size per row - Location + Last Updated normalized to `text-sm text-court-fg-muted`). No shared-component extension needed - `DataTableRow` already spreads `onClick` + className, so the candidates checkbox column + selected-row accent tint compose without forking. Sorting, row click-through, bulk select, badges, logos, empty states, and pagination are all unchanged.
- **Input follow-up.** `candidate-compact-overview.tsx` (skipped earlier for then-uncommitted WIP that has since landed) migrated: Title/Employer/Location inputs + Source select + email/phone list rows -> shared Input/Select; the Comp `MaskedCurrencyInput` wrapped in the rect frame (editable-helpers currency pattern).
- **Not part of this audit (still open):** the Action-row button audit (ACE_ROADMAP Next Up #1) is a separate 71.0-audit item and is untouched.

## What Shipped in Ace 90.0 (2026-06-09) - Cleanup follow-ups + Invoice Email template-wiring (Path-B)

Closeout-and-wire session. All items pushed to main; `npm run build` exits 0. No schema changes.

- **Make Placement free-text Currency field removed (`local-placement-rows.tsx`).** The Make Placement modal no longer renders an editable free-text "Currency" input; `currency` is now a hardcoded `"USD"` const mirroring the Offer row, still written to `Placement.acceptedCurrency` on save. Fee %, flat-fee override, and invoice math untouched. Closes the Ace 79.0 cosmetic follow-up.
- **Temp `[web-push][diag]` logging removed (`web-push.ts`).** All 10 `[web-push][diag]` console.logs stripped, plus the now-orphaned `redactDigits` / `diagPayload` helpers (the "light rebase" the roadmap noted). The functional Test button + delivery tally (`PushDispatchResult`) + `forceNotify` path + the plain `[web-push]` error logs were RETAINED, so Bug 2 can still be monitored from Settings; only the console spam is gone. The `[push][badge-diag]` logs (4 files) remain live and out of scope.
- **Invoice Email template-wiring (Path-B) shipped.** The Settings ▸ Templates "Invoice Email" template now DRIVES the drafted invoice email body (it was visible/editable but inert before). `invoices/[id]/page.tsx` loads the active `confirmed_start_invoice` template via the canonical `loadTriggeredTemplate` and passes it RAW (unmerged) to `InvoiceDetail`; `handleEmailDraft` resolves subject + body through the shared `applyMergeFields` machinery client-side at click time (so recruiter edits to fee / dates / contacts reflect), em dashes stripped, plain/HTML normalized via `templateBodyToEditorHtml`. Falls back to the hardcoded literal when no active template exists, so a deleted/disabled template never breaks the send. Recipients (To = billing, Cc = hiring, deduped) + smart recipient-count greeting + the shared PDF start-date formatter (`formatInvoiceDateLabelFromIso`, the UTC off-by-one guard) are unchanged. Verified against real invoice INV-1054 (To/Cc auto-populate, greeting "Hi Laurie and Benjy,", `[Start Date]` -> "Jun 1, 2026", body sourced from the DB template).
- **Three invoice merge tokens registered (`merge-fields.ts`, additive).** `[Invoice Number]`, `[Fee Amount]`, `[Invoice Due Date]` added to `MERGE_FIELDS` + `MergeFieldValues` + the `applyMergeFields` map so the template can reference them. `[Invoice Number]` resolves to the invoiceNumber field, which already carries the `INV-` prefix (e.g. "INV-1054").
- **One-time "Invoice Email" template data update (`scripts/update-invoice-email-template.ts`).** Dry-run-by-default, `--apply`-to-write, idempotent, org-traceable one-off (same pattern as the existing `scripts/` backfills). Applied to PROD: enriched the seeded "Invoice Email" template row so the email carries the invoice-specific details the old hardcoded body had. Subject appended `([Invoice Number])` (renders `(INV-####)` - NOT `(INV-INV-####)`, because the token already carries the `INV-` prefix). Body fee sentence became "...for the placement fee of [Fee Amount], with a start date of [Start Date]. Payment is due by [Invoice Due Date]." Existing voice + structure preserved, no em dashes. EmailTemplate is a global (single-org) table so the row was selected by trigger + isActive, not org id. Re-run is a clean no-op.

### Also shipped Ace 90.0 - client Gmail history backfill + Overview company-card editing (committed 2026-06-09 by Andrew; recorded in the 2026-06-10 doc pass)
Two client-side features that landed the same day but were omitted from the writeup above. `npm run build` exits 0 on HEAD. No blocking schema changes (both reuse the existing `GmailThreadTag` model + `Client`/`Contact` columns).

- **Client Gmail history backfill (`4aa39b9`).** New `backfillClientGmailThreadTags` helper (`src/lib/gmail.ts`) retroactively links older Gmail threads to a client: it searches Gmail by the client's contact emails + domains, then VERIFIES each candidate thread against its actual From/To/Cc/Bcc participant headers (NOT a body-text match) before upserting a `GmailThreadTag`. Org-scoped, capped (<=25 threads / 12 emails / 4 domains), failure-isolated. Wired into every client create/update entry point - `createClient` (clients/new), `addContact` / `updateContact` / `updateClientCompany` (clients/[id]), candidate-side `createClientContact`, and the BD reply-prompt create-client path - each call `.catch()`-wrapped so a Gmail failure never breaks the underlying write. The `/api/clients/[id]/email-threads` GET route also lazily backfills on first load when a client has zero tags yet, then re-reads (a one-time synchronous Gmail fetch on that first open - perf consciously accepted). Before this, only threads received AFTER a client existed got linked; old threads were invisible in the client's email history.
- **Client Overview company-card editing (`1fcd563`).** On the client detail Overview card: (a) the free-text "Country" field was REMOVED - country is now hardcoded server-side to "United States of America" in `updateClientCompany` (intentional; Ace is a US desk, so a non-US country can no longer be recorded); (b) the fee-agreement "Billing contact" changed from a free-text box to a DROPDOWN sourced from the client's own contacts, with a "+ add contact" link that deep-links to the Contacts tab with the new-contact form pre-opened (new `openAddForm` prop on `ContactsTab`, via `?tab=contacts&addContact=1`); (c) the card's "Open agreement" link now points to the most recently uploaded agreement PDF (`/api/client-agreements/{id}`) instead of the older `agreementFile` link. Also normalized phone numbers for Quo shipped same-day (`8a5df83`).

## What Shipped in Ace 89.0 (2026-06-08) - ROOT CAUSE of BD enroll-zero found + fixed; client-signal credit throttle

The BD "enrolls 0 or 1 company" bug is solved at the root. All items pushed to main; `npm run build` exits 0. One additive schema column (`BdOrgConfig.lastClientMonitorAt`, applied to prod via `db push`; `migrate diff` confirmed additive-only).

- **ROOT CAUSE of BD enroll failures (FIXED).** The Approve & Enroll modal's selection `Set` was a lazy `useState` snapshot with NO `key={run.id}` and NO re-sync effect. The Today's Batch auto-refresh polling (shipped Ace 88.0, same arc) swaps the run's `discoveredPayload` mid-modal, which froze `selected` to a stale, narrowed set (often `[0]` or empty) while the rendered checkboxes updated underneath. The server then enrolled only that narrowed set, so runs enrolled 0-1 companies while the UI showed "all selected". This is why a run enrolled 19 once (before auto-refresh existed) then 0 after auto-refresh landed. Fix: `key={run.id}` on `<CompanySelectionModal>` + a `useEffect` re-seeding `selected` to all indexes on `run.id`/`companies.length` change. `toggle`/`toggleAll` unchanged; manual unchecks preserved (they never change the count).
- **Interaction flagged.** The Ace 88.0 Today's Batch auto-refresh is what INTRODUCED the selection-freeze bug. Any future polling that swaps a payload behind an open modal MUST remount or re-sync the modal's derived state.
- **Mailbox rotation confirmed live at N=5.** `add_contact_ids` passes all healthy mailboxes as the `send_email_from_email_account_id[]` array; resolver filters `Connected` + not `sendingDisabled`; log line reads "sending mailbox rotation: N mailbox(es)". Andrew reconnected the 5th mailbox (`andrew@breakpoint-talent.com`); confirmed N=5 live.
- **Client-signal credit throttle (was burning ~1700 credits/month).** The per-client-domain TheirStack `/v1/jobs/search` sweep (`syncClientSignals`) ran on EVERY `GET /api/cron/bd-discovery`, which both the daily cron AND every manual "Run Discovery Now" hit (one search per client domain, `limit:25`, ~25 credits each). Now CRON-ONLY and once per America/New_York calendar day: `triggerManualDiscovery` tags the call `manual=1` and the route skips the sweep entirely on that path (ZERO client-signal calls on manual); `syncClientSignals` self-throttles via the new `BdOrgConfig.lastClientMonitorAt` ET-day marker so a duplicate cron fire the same day no-ops. Main discovery search unchanged.
- **`maxDuration` on `/bd/launch` raised to 60s** (was Vercel default ~10-15s). NOT the enroll root cause, but a real ceiling at high volume: one Approve & Enroll can do up to ~80 contacts x (reveal + create + add_contact_ids) sequentially. Per-contact enrollment is already atomic (create + add_contact_ids fire back-to-back), so a cutoff strands at most one in-flight contact, never a batch.
- **TEMP diag instrumentation (remove once confirmed in prod).** Added a per-company try/catch in `enrollCompaniesInApollo` that logs full message + stack, because a Prisma error in `loadTargeting` (which runs OUTSIDE `fetchApolloContacts`'s own try/catch) could silently kill a run right after the rotation log. Remove these TEMP markers after a clean end-to-end run.
- **Prod dedup reset (re-run).** Ran `scripts/clear-bd-dedup-for-empty-runs.ts --apply` against prod: cleared 3 runs (incl. `cmq51izow`), freeing 10 company/job fingerprints for re-discovery on the next cron.

### Go-live gate
The enroll arc is now unblocked by the root-cause fix. Go-live is blocked only on TheirStack discovery credits, which renew **June 14**. Once they renew: run one real discovery + Approve & Enroll, confirm the rotation log shows N=5 and that contacts actually LAND in the sequence (not just get created), then flip Apollo "Tax BD Sequence" (id `6a06068f8142ee001d2b3dd2`) Activate ON. See ACE_ROADMAP.md ▸ NEXT.

## What Shipped in Ace 88.0 (2026-06-06) - BD Apollo enrollment arc WORKING end to end

The BD outbound path now enrolls real, named, emailable contacts. A live run landed **18 real named contacts with verified emails in the "Tax BD Sequence"** - the sequence stays **PAUSED with Activate OFF** pending Monday go-live. All items pushed to main; `npm run build` exits 0. No schema changes.

- **People-search endpoint migrated to `/api/v1/mixed_people/api_search`.** The deprecated `/api/v1/mixed_people/search` 422'd. Added `contact_email_status: ["verified"]` to the api_search body for email yield.
- **Email reveal now matches by Apollo PERSON ID.** `people/match` keyed on the real Apollo person id returns a real email; matching by name+domain returned a hollow 200 with a null email. The real id is now threaded end to end through BOTH the search path and the approved/curated path - it was being dropped on the curated path, which was the core break. `reveal_personal_emails=true` is sent as a QUERY-STRING param, not in the body.
- **Mailbox rotation at enroll.** The `add_contact_ids` call now passes ALL healthy connected mailboxes as a `send_email_from_email_account_id[]` array (rotation) instead of pinning one. The resolver filters to `status = Connected` + not `sendingDisabled`, and falls back to a single mailbox when only one is healthy. Apollo only sets rotation at add-time, which is why the sequence-settings UI has no rotation toggle - it is chosen on enroll.
- **Today's Batch auto-refresh.** In-flight-aware polling (6s active / 20s idle) that refreshes only on an awaiting-count change and pauses on a hidden tab. New counts-only `getBDBatchSignal` query backs it.
- **No-saved-search guard.** Any vertical with no saved search now blocks Run Discovery with a clean inline message + link to BD Settings, instead of silently firing the hardcoded Tax search.
- **5th mailbox reconnected.** Andrew reconnected `andrew@breakpoint-talent.com`, so rotation now has 5 healthy mailboxes.

### Go-live gate (Monday)
Enroll, confirm the rotation log shows N=5 mailboxes, confirm contacts land in the sequence, then flip Apollo "Tax BD Sequence" (id `6a06068f8142ee001d2b3dd2`) Activate ON. After that, the next build is TheirStack dynamic per-vertical discovery (see ACE_ROADMAP.md ▸ NEXT).

## What Shipped in Ace 87.0 (2026-06-05) - BD Apollo enrollment: find-the-person path fix + 422 fix + dedup reset

BD enrollment was discovering companies but enrolling nobody (nameless org-only shells). This session diagnosed the root cause read-only, then shipped the find-the-person fix, the Apollo 422 fix, and a prod dedup reset so the broken runs' companies can resurface. All items pushed to main; `npm run build` exits 0. No schema changes.

- **Root-cause diagnosis (read-only).** The Apollo enrollment bug traced to three faults: (a) the people-search step was **disconnected from the enroll path** - discovery found companies but the contact lookup never resolved real people; (b) **wrong hardcoded titles** were used instead of the BD Settings titles; (c) when no person resolved, the run wrote a **nameless org-only shell** and counted it as discovered, so it both polluted Active Campaigns and seeded the dedup window. No code touched in the diagnosis pass.
- **Prompt 1 - find-the-person path fixed (`cf61095`).** Backfills the company **domain during discovery** so the contact search has something to key on; **collapsed the contact lookup to a single domain + BD-Settings-titles people search** (was a disconnected/wrong-title query); **deleted the hardcoded HR/exec fallback** title union; and now **skips the company instead of writing a nameless shell** when no people are found. Net: runs either enroll a real, named contact or cleanly skip - no more shells.
- **Apollo 422 fixed (`b1ce721`).** The people-search call 422'd on the org-domains filter. Renamed `organization_domains` to **`q_organization_domains_list`** (the field name Apollo's People Search actually accepts).
- **Dedup reset applied to prod (`b0432f5`).** Added `scripts/clear-bd-dedup-for-empty-runs.ts` - nulls `discoveredPayload` on `COMPLETE` runs with `enrolledCount = 0` so the 30-day dedup window (`api/cron/bd-discovery`) stops blocking those never-enrolled companies from re-discovery. Dry-run by default, `--apply` to write, org-scoped. **Ran `--apply` against prod**: cleared 1 run (`cmq10k2840001jv04ckjv9207`, discovered=1/enrolled=0), freeing 1 company/job fingerprint for the next cron run.

### Queued bugs (Ace 87.0) - BOTH FIXED in Ace 88.0
- ~~Manufacturing-tab no-saved-search guard~~ - DONE Ace 88.0 (any vertical with no saved search blocks Run Discovery with an inline message + BD Settings link).
- ~~Auto-refresh after a discovery run~~ - DONE Ace 88.0 (in-flight-aware polling, refreshes on awaiting-count change).

### Next task - DONE / superseded
The Ace 88.0 candidate arc (email reveal -> dry-run -> activate) is shipped end to end - see the Ace 88.0 section above. Only the Monday go-live gate remains. After go-live, the next build is TheirStack dynamic per-vertical discovery (ACE_ROADMAP.md ▸ NEXT).

## What Shipped in Ace 82.0-86.0 (2026-06-05) - BD Engine hardening: webhook retirement, Today's Batch redesign, BD Settings overhaul, Client Signals + sweep

Consolidated session summary across Ace 82.0 -> 86.0 (per-version detail also lives in the individual sections below). All items pushed to main; `npm run build` exits 0.

- **Webhook retirement + DB cleanup.** Deleted the `/api/webhooks/theirstack` endpoint (the external auto-enroll path flagged as a credit-drain risk; cron `api/cron/bd-discovery` confirmed self-contained, so retiring the webhook is safe). Deleted the **AHF Products** and **American Express** `BDRun` rows from the DB - the two companies that entered via the webhook path. No auto-enroll can fire from an external webhook anymore.
- **Today's Batch redesign.** KPI tiles row (Discovered Today / Enrolled / Last Run), a Rows/Cards view toggle, a "Review all" button on each run card, and a panel-dismiss fix so a drag that starts inside a number input and releases on the backdrop no longer closes the dialog (mousedown-on-backdrop, not click). Conforms to Andrew's button standards (shared chrome, not the rejected mockup).
- **BD Settings overhaul.** Sequence labeled **"Tax BD Sequence"** everywhere with an alias resolver (replaces the "BD Outbound v1" placeholder mislabel); the New Saved Search form starts blank; vertical collapse state is independent per vertical; saved-search delete is inline-confirm + optimistic; New Vertical Name + Slug share one row; the Location override hint text is corrected (honest "not yet active" copy); per-vertical daily cap auto-distributes the remaining global budget; Primary Titles chips are drag-to-reorder and the enrollment path now sends `person_titles` in the stored priority order (re-ranks Apollo results by stored title index); mailbox health is matched by full email address (was domain-collapsed) with a red "Disabled" chip for Apollo-disabled mailboxes; and the **Pause all** toggle now actually gates both the cron and Run Discovery Now (was a no-op column nothing read).
- **Client Signals (Ace 82.0).** Dismiss fix (dismissed rows stay gone), newest-first sort, "Reach Out" opens a pre-filled email composer and marks the signal ACTED on send.
- **Client signal sweep.** Stable `orderBy id asc`, a rotating cursor (`lastSignalCursorId` on `BdOrgConfig`) so each run advances through the client list, limit raised 10 -> 25, and a no-domain warning log for clients the sweep can't query.
- **Cleanup.** Removed the `[bd-discovery][theirstack-body][diag]` log; deleted the dead `POST /api/bd/runs` route (no in-app caller); deleted the unused top-level `src/components/client-logo.tsx` (zero imports; live component is `components/clients/client-logo.tsx`).

## What Shipped in Ace 85.0 (2026-06-05) - BD: drag-to-reorder Primary Titles + per-mailbox Apollo health + cleanup

All items pushed to main; `npm run build` exits 0. No schema changes. Files: `src/app/settings/bd/contact-targeting-section.tsx`, `src/lib/bd/apollo-enroll.ts`, `src/lib/bd/apollo-email-accounts.ts`, `src/app/settings/bd/page.tsx`, `src/app/settings/bd/domains-section.tsx`, `src/lib/bd/theirstack-provider.ts`. Deleted: `src/app/api/bd/runs/route.ts`, `src/components/client-logo.tsx`.

- **Primary Titles chips are now drag-to-reorder (priority order).** Used `@dnd-kit/core` + `@dnd-kit/sortable` (already installed). Each chip is the drag handle (grip affordance + whole-chip listeners); `PointerSensor` distance:5 so a click/remove never starts a drag. On drop, the new order is set locally AND persisted immediately via the existing `saveContactTargeting` upsert (no Save click) - `cleanTitles`' `Set` preserves array order, so the stored `BdContactTargeting.primaryTitles String[]` is the priority sequence. Only the Primary tier is sortable; small-firm/practice tiers unchanged. Spinner shows on the label during persist.
- **Enroll path now honors the stored title order.** `apollo-enroll.ts` previously sent a hardcoded `TARGET_TITLES` union and took Apollo's arbitrary return order. Removed `TARGET_TITLES`. Now loads the run's vertical (`BDRun.verticalId`) -> `BdContactTargeting.primaryTitles` (falls back to `DEFAULT_CONTACT_TARGETING.primaryTitles`), sends that as `person_titles`, fetches 25, then `orderByTitlePriority` re-ranks results by first-matching stored title index (case-insensitive substring; unmatched last; stable) before the per-firm cap slice. Curated-contact path keeps Andrew's hand-ordered sequence verbatim.
- **Mailbox health: each row shows its OWN Apollo status.** `page.tsx` matched mailboxes by domain-part (`mailboxByDomain`), collapsing every same-domain mailbox to one status. Now keyed by full email (`mailboxByEmail`, matched against `SendingDomain.domain` which stores the full address). Added `sendingDisabled` to `ApolloMailbox` (derived from `sending_disabled`/`is_sending_disabled`/`sending_enabled:false`/status contains "disabled"); a found-but-disabled mailbox renders a red "Disabled" chip instead of the green Connected chip.
- **Cleanup.** Removed the `[bd-discovery][theirstack-body][diag]` console.log from `theirstack-provider.ts`. Deleted dead `POST /api/bd/runs` route (no in-app caller; runs are created via `bd-run-actions.ts`; it was the only writer of real `BDRun.plan` data but was never invoked, so the campaigns plan-snapshot card still renders defensively from `{}` exactly as before - no runtime change). Deleted unused `src/components/client-logo.tsx` (zero imports; live component is `components/clients/client-logo.tsx`).

## What Shipped in Ace 84.0 (2026-06-05) - BD limits: honest location-override hint + per-vertical cap auto-distribute

All items pushed to main; `npm run build` exits 0. No schema changes. Files: `src/app/settings/bd/verticals-section.tsx`, `src/app/settings/bd/limits-section.tsx`.

- **Plan snapshot card: KEPT (investigated, not removed).** Step 0 grep confirmed `BDRun.plan` is written with real data (`{ contactCap, domains }`) at `src/app/api/bd/runs/route.ts:72` (launch route), so the card on `bd/campaigns/[id]/page.tsx` stays. Nuance: that launch route currently has no in-app caller; cron-created runs (`api/cron/bd-discovery`) write null `plan` and render `{}` via the existing defensive default. `metrics` is never written (always null, sub-block never shows). No code change.
- **locationOverride hint is now honest.** Changed the helper text on the Location override field from "Optional. Passed to TheirStack when set; ignored when blank" (known false, flagged in 83.0) to "Not yet active - reserved for future per-vertical location filtering." Field behavior unchanged - still saved per saved-search, still unwired. Resolves the dangling note from Ace 83.0.
- **Per-vertical daily caps now auto-distribute.** When a vertical has no manual cap, `limits-section.tsx` computes its share = `floor(max(0, globalCap - sum(locked caps)) / unlocked count)` and shows it as a muted "auto" placeholder (NOT persisted until the user confirms with the check button, or overrides via the pencil). Setting/locking one vertical re-distributes the remaining budget across the rest. Math floored at 0 both on the remainder and on save, so caps never go negative. Example: global 80, set Accounting 50 -> Manufacturing shows auto 30.

## What Shipped in Ace 83.0 (2026-06-05) - BD Verticals: inline delete, Name/Slug row + locationOverride diagnosis

All shipped items pushed to main; `npm run build` exits 0. No schema changes. File: `src/app/settings/bd/verticals-section.tsx`.

- **Saved-search delete is now inline + optimistic.** The trash icon (muted at rest, red on hover, icon-only) opens an inline "Delete this search?" with small Yes/Cancel instead of a `window.confirm`. On confirm it deletes from the DB and removes the row from local state immediately via a `deletedSearchIds` set (no `router.refresh` / reload). The vertical's count badge and its "delete vertical" enable-gate both follow the visible (post-deletion) count.
- **New Vertical form: Name + Slug on one row** - `flex items-end gap-4`, each field `flex-1`, inputs baseline-aligned. No other field in the form changed.
- **locationOverride diagnosed as a DEAD field (left unwired, by decision).** It's saved per saved-search and shown in the row summary, but the only `discoverJobs` caller (`src/app/api/cron/bd-discovery/route.ts`) never reads saved searches - it passes hardcoded `DISCOVERY_TITLES` + `locations: []`, and `TheirStackProvider` hardcodes `job_location_or: [{ id: 6252001 }]`. Wiring was deferred: TheirStack's `job_location_or` wants a numeric geonames id (not the free-text the field holds), and the cron has no per-saved-search context to source an override from. NOTE: the field's UI hint still claims "Passed to TheirStack when set" - now known false; left as-is pending the wiring decision.

## What Shipped in Ace 82.0 (2026-06-05) - Client Signals: Dismiss/sort/Reach-out composer

All three items pushed to main; `npm run build` exits 0. No schema changes.

- **Dismiss now removes the row** (`src/app/bd/client-signal/signal-list.tsx`, new). Dismiss is optimistic (row drops instantly, restored on write failure) and the "All" list query now excludes `DISMISSED` (`status: { not: "DISMISSED" }`), so dismissed signals never resurface on refresh - only the Dismissed tab shows them. Persistence (`markSignalDismissed`) was already correct; the bug was the list query + no local removal.
- **Sorted newest-posted first** - `orderBy: [{ postedAt: { sort: "desc", nulls: "last" } }, { discoveredAt: "desc" }]`. "New this week" inherits the same order.
- **Reach out opens the shared EmailComposer** pre-filled (To = first client contact email or blank; Subject "Quick question re: [title] search"; templated body). Reuses `EmailComposer` + `sendEmailAction`/`scheduleEmailAction` (same path as `EmailLink`). Sending marks the signal `ACTED`. Primary contact resolved server-side in `page.tsx` (first `Client.contacts` row with a non-empty email).

## What Shipped in Ace 81.0 (2026-06-03 to 2026-06-04) - BD Engine: tabs/Today's Batch cleanup, real TheirStack saved-search query, timeout hardening, Active Campaigns row identity. PLUS a critical external-webhook credit-drain finding.

All BD-engine work below is pushed to main and `npm run build` exits 0. No schema changes this session.

**BD tabs + Today's Batch shell**
- BD tabs reordered: **Today's Batch, Active Campaigns, Activity, Client Signals**. Page subtitles removed.
- Today's Batch is now a **single card container**. Run Discovery Now (amber) + BD Settings (neutral grey) resized to the standard button size. Last-run pill moved inside the card.
- The old **"Launch BD Run" button was DELETED** - it was dead (wrote a `QUEUED` BDRun that nothing consumes).

**Discovery query REWRITTEN to Andrew's live-validated TheirStack body (`src/lib/bd/theirstack-provider.ts`)**
- Ace previously ran its OWN hardcoded broad query and ignored the user's TheirStack saved search. It now sends Andrew's live-validated body:
  - `job_title_or` ["Tax Manager","Senior Tax Accountant","Tax Senior","Tax Supervisor"]; plus a `job_title_not` exclusion list.
  - `job_location_or` `[{id:6252001}]` (US) - the **object shape, NOT `country_code`**.
  - `company_name_partial_match_or` - 26 firm-name strings (CPA / LLP / Partners / & Co. / Associates / etc.); `company_name_partial_match_not` (recruiter / big-4 / etc.); `company_id_not` - 5 big-4 ids.
  - `min_employee_count` 10; `limit` 25; `blur_company_data` false; **`posted_at_max_age_days` capped at MAX 14**.
- A temporary log tagged **`[bd-discovery][theirstack-body][diag]`** is still in that file (queued for removal - see ROADMAP cleanup).

**Timeout hardening**
- 25s `AbortController` on the discovery POST.
- 10s + 20s budget on the client-signal sweep (`src/lib/bd/client-signal-sync.ts`).
- 10s on the jsearch fallback.
- cron route `maxDuration` 120 (`src/app/api/cron/bd-discovery/route.ts`).

**Name recovery + dedup helpers (`src/lib/bd/discovered-company.ts`)**
- `recoverCompanyName`, `recoverDomain`, `dedupeDiscoveredByCompany` applied in ONE shared place so the Review-companies popup and the enroll extractor stay index-aligned.

**Approval + Active Campaigns surfaces**
- **Approved-leads detail view** (real company list with favicons) and a **"Review companies" popup selector** (all checked by default; uncheck to exclude; Approve & Enroll enrolls only the selected companies via `selectedIndexes`).
- **Client Signals favicons** fixed to the Google favicon service keyed on `Client.domain`.
- **Active Campaigns rows** now lead with the real deduped enrolled company names, label the date **"Enrolled"** (`approvedAt`), and show a muted **"awaiting Apollo activity"** hint when metrics are all zero. Files: `src/app/bd/campaigns/page.tsx`, `src/app/bd/campaigns/campaigns-list.tsx`.

### CRITICAL - External TheirStack webhook (credit drain + safety)
- TheirStack support (Christian Palou) confirmed an **external webhook named "Ace BD Engine"**, tied to saved search **"BreakPoint BD-Tax"**, live on the TheirStack account **since May 14**. It scans every 3 hours and POSTs each matching Tax Manager job to `https://ace.breakpointtalent.com/api/webhooks/theirstack`, spending **1 TheirStack credit per delivered job (~951 credits consumed this way)**.
- This webhook runs a **BROAD saved search with NO firm-name filter**. It is the **suspected source of the unrecognized "AHF" and "American Express" rows** on Active Campaigns (large corporate tax departments, not CPA firms).
- The webhook is **INTENTIONALLY LEFT ON**. It must NOT be killed until next session confirms (a) the daily cron is fully self-contained and does NOT depend on this webhook, and (b) `/api/webhooks/theirstack` does NOT auto-create campaigns or auto-enroll to Apollo.
- **The TheirStack API key was exposed in chat earlier this session and still needs to be ROTATED.**

### GO-LIVE GATE
Apollo sequence **"Tax BD Sequence"** (id `6a06068f8142ee001d2b3dd2`) activation is **BLOCKED** until the webhook path is confirmed safe. Risk: if `/api/webhooks/theirstack` auto-enrolls, activating Apollo could email companies like American Express that were never approved. See ACE_ROADMAP.md ▸ Next Session (items 1-2).

## What Shipped in Ace 80.0 (2026-06-03) - BD Engine: Apollo enrollment rewrite + TheirStack discovery fix

The BD outbound path was fully broken in prod (Apollo 422'd on every enroll; TheirStack 422'd on every first/no-history discovery). Both are now fixed end-to-end: Run Discovery Now returns companies, and Approve & Enroll writes contacts into Apollo with the correct job-posting merge fields. The Apollo sequence "Activate" toggle is deliberately still OFF - nothing sends live until a real approve-and-inspect pass is done. `npm run build` exits 0 (save the two pre-existing react-hooks/exhaustive-deps warnings). No schema changes.

**Apollo enroll path rewritten (`src/lib/bd/apollo-enroll.ts`, called from `src/app/bd/launch/bd-run-actions.ts`)**
- **Custom fields sent via `typed_custom_fields` keyed by the REAL Apollo custom field IDs** (recorded permanently in ACE_RULES.md ▸ BD Engine Rules so no future session re-discovers them):
  - Posting Job Title = `6a207e120239f0000c18decd`
  - Posting Job URL = `6a207e2290a45c00208eccbb`
  - Posting Job City = `6a207f8bc3715c0010ae118e`
  - These are **CONTACT** custom fields in Apollo. The email-template merge vars are `{{contact.Posting Job Title}}`, `{{contact.Posting Job URL}}`, `{{contact.Posting Job City}}`. **The original bug was using Apollo's built-in `{{job_title}}`** - that is the contact's OWN title (the wrong field), so every outbound email referenced the prospect's job instead of the role we're pitching. (`b5fc59c`)
- **Apollo API key now sent in the `X-Api-Key` HEADER, not the JSON body.** The old body placement 422'd - prod was fully broken. Applies to BOTH `apolloEnrollContact` and `apolloSearchPeople`. (`84df40f`)
- **Enrollment is now TWO calls** (`b4e217c`): (1) `POST /api/v1/contacts` with `typed_custom_fields` + `run_dedupe:true`, capture the returned contact id; (2) `POST /api/v1/emailer_campaigns/{sequence_id}/add_contact_ids` with params in the **QUERY STRING** (`emailer_campaign_id`, `send_email_from_email_account_id`, `contact_ids[]`). **Passing `sequence_id` on contact-create does NOT enroll** - Apollo silently ignores it; the second add-contact-ids call is mandatory.
- **`run_dedupe:true` on contact-create** (`140b527`) so returning prospects UPDATE instead of duplicating.
- **Posting Job City trimmed to city-only via `cityOnly()`** (everything before the first comma) - TheirStack returns "City, State", we store "Chicago".
- **Sequence / mailbox resolution** via `apolloResolveEmailAccountId`: `APOLLO_EMAIL_ACCOUNT_ID` env override, else the team default active mailbox (`a.kraig@breakpoint-talent.com` / `69cac1772e443a000dfc7970`). Sequence id falls back to registry `6a06068f8142ee001d2b3dd2` (the real "Tax BD Sequence"). NOTE: the in-app label "BD Outbound v1" in `apollo-sequences.ts` is a hardcoded placeholder NAME that does NOT match the real Apollo sequence name - cosmetic mislabel, not yet fixed.
- **`candidate_summary` generation removed** - it was Apollo-ignored and read nowhere. `generateCandidateSummary` / `genericCandidateSummary` + the Claude imports were deleted as dead code. If a per-candidate pitch line is wanted later, wire it as a 4th `typed_custom_field`.

**TheirStack discovery fix (`src/lib/bd/theirstack-provider.ts`, `4f233cc`)**
- **Always send `posted_at_max_age_days`** (integer days) on every `/v1/jobs/search` so TheirStack's mandatory-filter requirement is satisfied. Derived from `postedSince` when a prior run exists (whole days, min 1), else default **7**. The old code only sent `posted_at_gte` conditionally, so a first run / a run with no prior `AWAITING_APPROVAL`/`COMPLETE` `BDRun` sent NO mandatory filter and TheirStack 422'd "Missing mandatory filter - at least one of [posted_at_max_age_days, posted_at_gte, ...] must be provided" - discovery silently returned nothing. Both the cron and "Run Discovery Now" route through this one provider, so one fix covers both. Confirmed working: Run Discovery Now now returns companies. (Live authenticated 200 not re-run locally - prod `THEIRSTACK_API_KEY` is Sensitive in Vercel so `vercel env pull` returns it empty; the field name + shape are confirmed by TheirStack's own 422 message.)

**Test scaffold left in repo (test-only)**
- `scripts/test-apollo-enroll.ts` - a one-off single-contact enroll test (`35462ae`). `apolloEnrollContact` + the `EnrollPayload` type were exported from `apollo-enroll.ts` to support it. Test-only; not wired into any product path.

## What Shipped in Ace 79.0 (2026-06-03)

A 16-item fix batch (numbered items across nine prompt batches) plus four same-session commits that were not in the original batch list. No blocking schema changes except the one nullable indexed column in Batch 7. `npm run build` exits 0 (save the two pre-existing react-hooks/exhaustive-deps warnings). **Batch 2 has now shipped (`87e7599`) - see its entry below.**

**Hotfix - short-code text threads wouldn't clear (`de8f4f1`)**
- `markThreadRead` (`src/app/phone/actions.ts`) bailed with `{updated:0}` whenever an `unk:` thread key had fewer than 10 digits (`digits.length !== 10` guard, introduced in `252f305`). Short-code senders (verification texts like `22395`, Slate Milk, Shop) are keyed `unk:<full code>` by `/api/phone/threads`, so opening or "Mark as read"-ing those threads marked nothing read and the unread badge stuck forever - on the phone tab AND the toast path (both share this action). The `right(normalized,10) = digits` SQL already matches short codes correctly, so the guard was the sole blocker; relaxed to bail only on an empty digit string. Org scoping unchanged.

**Batch 2 - calendar legend / watermark / jobs Delete (`87e7599`)**
- **Calendar Event Types legend swatches now match the tile source of truth** (`lib/calendar/utils.ts` `eventTypeMeta()`): the Interview and Client Call swatches in `left-rail.tsx` `EventTypeLegend()` were swapped. Corrected so Interview = blue, Client Call = green, Reminder = orange (amber), Other unchanged. Tile colors themselves untouched; only the legend chip/fill/ring tokens changed. Court Mode tokens only, no hex. Reminder tiles stay Ace-native (toast-only).
- **Resume watermark logo default position moved from dead-center to top-right** (`resume-editor.tsx`): the one-shot seed coords now place the logo's normalized left/top edge at `1 - logoWidth/pageWidth - 0.03` / `0.03`. Drag + clamp logic (`onPagePointerMove`) untouched - the logo still drags freely from there; watermark export unchanged.
- **jobs/[id] Delete button un-pinned** (`delete-job-button.tsx` + `page.tsx`): was `fixed bottom-3 right-3 z-30` rendered outside the tab conditional (all tabs). Now static inline `flex justify-end pt-8` at the end of the **Overview** tab content only, scrolling away with the page - matches `DeleteCandidateButton` (Profile) / `DeleteClientButton` (Overview) from `4155f68`. Confirm strip wrapper `pt-24 → pt-8`. Delete action + inline-confirm unchanged.

**Batch 1 - cosmetics (`91649c7`)**
- **My Jobs / My Clients owner dropdown shrunk to TabStrip pill height** on the Jobs + Clients list pages. The topbar + New button were intentionally LEFT as-is (already ~pill height, shared across 8 pages - per the Ace 40.0 keep-it-small decision).
- **Submittal composer To/Cc/Bcc typed text recolored to `text-court-fg`** so it is legible on the dark modal (chip model + send path unchanged).
- **Make Placement Billing/Hiring Name + Email placeholders removed** (fields render blank).

**Batch 3 - jobs domain (`8ed85e5`; Location-column trim `9981b41`)**
- **`+ New Job` on the client-overview Jobs header** routes to `/jobs/new?clientId=` with the client prefilled.
- **Search Keywords converted to a pick-or-type pill input** (the stored value is still the comma-string the matcher + Boolean search read).
- **Apply to Job dropdown filtered to ACTIVE jobs only**; the Keep picker derives from the same list, now active-only too.
- **(`9981b41`)** jobs Location column drops the zip - shows City, ST only.

**Batch 4 - shared masked-currency input (`4d75561`; comp `$` display prefix `2035632`)**
- **One shared masked-currency input** (blank at rest, leading `$`, thousands commas, no USD suffix, emits a clean number on save) wired to candidate overview, job overview, the Offer modal, and the Make Placement modal. Fee % / flat-fee override / invoice math unchanged. The candidate comp DISPLAY also gained a `$` prefix ($60,000 USD).
- **KNOWN cosmetic follow-ups:** the `120k` shorthand no longer works (digits only, per spec); the Make Placement free-text "Currency" field was left in place (the Offer modal already dropped its USD tag). See ACE_ROADMAP.md.

**Batch 5 - interview scheduler (`877036d`)**
- The **update-all / new-only / don't-send notify choice moved from an inline bottom panel into a `NotifyChoiceModal` popup on Save** (`commitEdit` / `updateInterview` `notifyMode` + the `mayNotify` gate byte-for-byte unchanged).
- A **whole-interview red Cancel control added to `ScheduleInterviewScreen` edit mode**, reusing the existing `cancelInterview` two-way notify engine the calendar drawer uses. The Ace 76.0 "one Save drives the notify choice" standard still holds - this is a presentation move + the profile-path cancel, not a new engine.

**Batch 6 - invoice email sign-off de-dupe (`eeac797`)**
- Removed the hardcoded `Best,<br />${signer}` line from the invoice email body literal in `invoice-detail.tsx` `handleEmailDraft`, so the single branded sign-off comes from `withSignature` at true send only (the 78.0 send-time rule + 70.0 de-dupe stay intact).
- ~~**STILL OPEN (carried forward):** the Settings "Invoice Email" template still does NOT drive the populated body~~ - RESOLVED Ace 90.0. `handleEmailDraft` now loads the active `confirmed_start_invoice` template (via `loadTriggeredTemplate` in `invoices/[id]/page.tsx`) and resolves it through the shared `applyMergeFields` machinery client-side at click time, with the hardcoded literal as fallback when no active template exists. New `[Invoice Number]` / `[Fee Amount]` / `[Invoice Due Date]` merge tokens added. Recipients + the PDF start-date formatter unchanged. See ACE_ROADMAP.md ▸ Completed - Ace 90.0.

**Batch 7 - offer/placement note fanout (`6fe7313`)**
- Added nullable indexed **`Note.sourcePlacementId`**. `recordLocalOffer` + `recordLocalPlacement` now upsert ONE shared Note keyed by (`sourcePlacementId`, `createdById`, org) attached to candidate + client + job (cuids only); blank notes skipped, failure-isolated (a note error never rolls back the deal), author-scoped like every other note.
- **KNOWN follow-up:** the pipeline edit-drawer fanout was intentionally NOT wired (candidate-profile saves only). See ACE_ROADMAP.md.

**Batch 8 / item #14 - placement propagation + map (`4e044cc`, `8b8c4a6`)**
- **DIAGNOSED not-a-bug** for the reported repro: the test placement was CANCELLED with no invoice (correctly excluded everywhere) and its `expectedStartDate` + `placedAt` were BOTH Q2 (no quarter divergence). A live uncancelled placement propagates correctly across the revenue cards, map, Metrics Q2, and Clubhouse.
- **Two real defects fixed:** (a) **map geocode fallback (`4e044cc`)** - cities not in the static `CITY_COORDS` table now resolve through the shared `src/lib/geocode.ts` Nominatim helper at data-build time (cached, the one-geocoder rule), so any city gets a dot, and the marker popup now shows client / candidate / fee / date per placement; (b) **map marker fill (`8b8c4a6`)** - dots are now FILLED with their payment-state color (reusing `STATUS_COLORS`, thin white outline for tile contrast) instead of green-fill-with-colored-ring.
- **KNOWN LATENT, consciously not changed:** the Placements RevenueCards are still collection-gated (require a SENT/PAID invoice, or bucket uninvoiced by `placedAt` with a `feeTotal > 0` gate) - only bites a custom-terms (null `feeTotal`) or cross-quarter placement; revisit if that case ever surfaces. See ACE_ROADMAP.md.

**Batch 9 / item #16 - cancel-placement state sync (`14ec315`)**
- Split `onCancelled` off `onSaved` on `LocalPlacementDialog` so cancel optimistically stamps `"cancelled"` (it was wrongly reusing the save path's `"pending_start"`); the pill now flips straight to "Placement Cancelled" with the cancelled button set and the soft `router.refresh()` reconciles - no hard refresh. The save path still stamps `"pending_start"`.

**Same-session extras (not in the original batch list)**
- **Clickable links in email bodies (`77b7a95` -> `1a24235`).** Bare URLs / `www.` links / email addresses that sat as plain TEXT in a received email are now real clickable anchors. Final form lives in `EmailHtmlViewer`: it walks the parsed DOM's text nodes, skips anything already inside `<a>` / `<script>` / `<style>`, and wraps http(s) / www / mailto matches - covering BOTH HTML and plain-text (`<pre>`) bodies. Only http(s)/www/mailto hrefs are produced (never `javascript:` / `data:`), the href is set via the DOM (can't break out of an attribute), and when nothing matches the original html is returned byte-for-byte so newsletters with their own anchors / `<head>` styles are never reserialized. (`77b7a95` was a first plain-text-only pass in `gmail.ts`; it was reverted in favor of the viewer-level fix in `1a24235`, since `pickBestBody` prefers the `text/html` part so the plain-text branch never fired for HTML emails with bare-text URLs.)

## What Shipped in Ace 78.0 (2026-06-02)

Mail polish, pipeline-distance accuracy, required job location, email draft/signature fixes, the first Ace Assistant write capability (create reminders), and the topbar weather live-location fix. Plus the session-close cleanup: the temporary `[reminder-tz-diag]` logging was removed from all 4 files it lived in (`reminder-actions.ts`, `calendar/page.tsx`, `claude-panel/chat/route.ts`, `claude-panel/reminders.ts`) - the `reanchorToEastern` guard it sat beside is permanent and stays. No blocking schema changes; `npm run build` exits 0 (save the two pre-existing react-hooks/exhaustive-deps warnings). The same-day Ace 77.0 mail cosmetic batch (`068b659`: Save -> Save Draft, Drafts (N) count, Clay-light card token) is logged separately under Ace 77.0 below and not repeated here.

**Mail visual gaps + mobile email viewer (`63c476e`)**
- `/mail` border/divider gaps closed: the search-bar lines run full-width, the top header divider extends to the sidebar via the resize-handle filler, the subject/body divider runs full-left, and the thread-column gutter dividers run full width/height. The mobile/PWA toast-opened email viewer (`FloatingThreadWindow`) now renders as a **viewport-bounded full-screen sheet below `lg`** with safe-area insets, internal scroll, and a reachable close button; the desktop floating window is unchanged.

**Pipeline + profile distance accuracy (`af0b76a`, `f2d48d8`)**
- **Job-side distance query falls back to `Job.locations[0]`** when the structured city/state/zip columns are empty, so jobs stored only with a loose location string still geocode for the distance sub-line.
- **`scripts/geocode-jobs.ts`** added (parse-only, idempotent, org-scoped). Run against BreakPoint: **9 jobs updated** (7 Springfield OH, 2 Florence KY), **5 correctly skipped** (3x Remote, "Northeast Ohio", bare "Springfield" with no state).
- **`createCandidate` geocode changed from detached fire-and-forget to AWAITED + failure-isolated** - this was the root cause of candidates that had a location but null `lat/lng` on Vercel serverless (the detached promise was being killed when the serverless function returned before it resolved).
- **Precision gate `isPreciseGeocodeQuery` in `src/lib/distance.ts`** blanks the distance for non-precise location strings, so a region like "Northeast Ohio" no longer produces a misleading centroid distance. Applied to **both** the pipeline Location cell and the candidate-profile job pill.

**Required job location + CSV geocode (`271d4ac`)**
- **City + State (2-letter) + Zip (5-digit) are now REQUIRED** on NEW job create AND on the job-edit **Details** surface (new structured City/State/Zip fields added there; enforced client + server). Existing loose-location jobs are unaffected until they're next edited.
- **CSV-import candidate path now awaits geocode per row**, capped at **75 inline**; the rest fall to the backfill script (`scripts/geocode-candidates.ts`). The invoice-demo and match-by-name create paths are intentionally **NOT** geocoded - they create location-less candidates, so geocoding there would be dead code.
- **`updateJobOverview` lookup made org-scoped** (Rule 8 fix).

**Email draft / signature fixes (`a6ad368`)**
- **Signature no longer baked into stored drafts or scheduled (Send Later) bodies.** `withSignature` now fires only at **true send** (immediate send and scheduled-dispatch), so saved drafts and scheduled bodies are clean and the oversized-signature-in-editor bug is gone.
- Navigating to the Mail tab **no longer auto-opens a composer** (gated on an explicit user-thread-selection ref). The composer manager `open()` **dedupes by draft id** so one trigger opens exactly one composer (fixed the double-composer).
- **NOTE (pre-existing data, not retroactively cleaned):** Gmail drafts created BEFORE this deploy still carry the baked-in signature until they're resent or deleted.

**Ace Assistant creates reminders - first write capability (`86c873a`, `71b3ba8`, `fea6a2d`)**
- NEW assistant capability: a `create_reminder` tool that **executes DIRECTLY server-side** with **no per-item Confirm/Cancel card**. This is a documented, intentional exception to the Confirm-card pattern, justified because reminder creates are **reversible and explicitly user-requested**; destructive tools KEEP their card. (See ACE_RULES.md ▸ Ace Assistant Write-Tool Pattern.)
- One assistant turn fires N creates; a single **`batch_receipt`** summary line renders in the panel ("Added 6 reminders"). Over-10 creates in one turn fall back to a single confirm card.
- **Timezone:** the model is injected `{{NOW_ET}}` (live ET wall-clock) + `{{ET_OFFSET}}` (DST-correct) and resolves relative phrases ("in 20 minutes") against it. A `reanchorToEastern` guard forces any `reminderAtIso` onto the correct ET offset (defense-in-depth), and naive datetimes (no offset) are rejected. **Root cause of the original skew was a MISSING current-time injection** (the model had no "now" to anchor relative phrases against), not a UTC conversion bug.
- **Reminder edit panel in the calendar left rail:** click-to-open for any tile (including past / 11th-and-later), a red **Delete** added, sticky viewport-bounded footer. EVENT TYPES + TEAM consolidated into a two-column card to reclaim vertical space so the edit form fits. Reminders stay Ace-native (toast-only, never pushed to Google).
- **KNOWN follow-up (not done):** the reminder edit panel is desktop-only (`hidden lg:flex`); mobile/PWA click-to-edit would need consolidating into `CalendarEventDrawer` - deferred (see ACE_ROADMAP.md).

**Topbar weather live location (`647d532`)**
- The topbar weather chip now reads **LIVE per-device geolocation on each load** instead of reusing a once-saved coordinate. Root cause: `weather-widget.tsx` `bootstrap()` returned immediately on the cached-granted branch (`startWith(cached.lat, cached.lon, ...)` ~line 750), and the once-a-day staleness refresh only rewrote localStorage - it never re-fetched the live session - so a single permission grant in Solon pinned the chip to Solon forever.
- New behavior: live `getCurrentPosition` on each load (silent when permission is already granted) plus a focus/visibility re-read throttled to once per 10 min; weather data still refreshes every 30 min. **Fallback order: live read -> last-known cached coords -> Chagrin Falls, OH default** - the chip is never blank. Works on desktop + iOS PWA with Permissions-API state handling (a hard "denied" stays on the fallback without re-prompting; an `onchange` listener picks up a later OS grant). Per-device: a laptop and a phone show their own cities independently.

## What Shipped in Ace 77.0 (2026-06-02)

Three-item mail/sidebar fix. No schema changes. `npm run build` exits 0 (save the two pre-existing react-hooks/exhaustive-deps warnings). Commit `068b659`.

- **Mail composer footer button relabeled "Save" -> "Save Draft" (`src/app/mail/mail-composer.tsx`).** Label text only; the `onSaveDraft` handler, `variant="secondary"`, `Save` icon, and disabled logic are unchanged, and the send / draft-POST paths are untouched. This is an **INTENTIONAL documented exception** to the Ace 71.0 "Save everywhere" label standard - the footer sits next to Send / Send Later, so "Save Draft" disambiguates that it stashes a Gmail draft. (The Button Standard's Toolbar-buttons list already names "Save Draft" as a canonical toolbar label, so this aligns with it rather than violating it.) A code comment at the button marks the exception so a future label sweep won't revert it.
- **Drafts nav row now shows a muted "(N)" draft count (`src/app/mail/mail-view.tsx`).** Derived from the already-fetched Gmail labels (`labels` state, system `DRAFT` label's `messagesTotal`) via a `useMemo` - **no new query**; the labels fetch is already scoped to the signed-in user's own mailbox via their OAuth token (Gmail drafts are per-user, not `organizationId`-scoped). Renders `(N)` as a `text-court-fg-muted` span at the row's right edge (regular weight, `text-sm`, NOT the tinted Inbox unread pill); at 0 it renders nothing so Drafts looks exactly as before. Inbox / Sent rows unchanged.
- **Clay-LIGHT sidebar profile card token fix (`src/app/globals.css`).** The card (`bg-court-sidebar-card`) rendered near-white over the tan Clay-light sidebar because Clay light's `--court-sidebar-card` was set to `255 250 243` (#FFFAF3, the content `--court-surface` value) instead of the sidebar surface `--court-sidebar-bg` (`232 210 189` / #E8D2BD). Clay light was the only "(== surface here)" theme whose card token diverged from its sidebar-bg (Hard light/dark + Clay dark already match; Grass/Night use an intentional raised panel). Fixed by pointing the Clay-light card token at `var(--court-sidebar-bg)` (token reference, no hardcoded hex), so it can never drift again. Only the Clay-light line changed; the other 7 theme/mode combos are untouched, and Clay dark still reads correctly.

## What Shipped in Ace 76.0 (2026-06-02)

The full interview restructure (D1 / D2 / E), shipped across `5376d95` through `add9811`, plus a closing batch of edit-mode, multi-interviewer, and widget fixes. The interview scheduler is now ONE scrolling screen and the ONLY scheduling entry point. No change to the existing per-recipient invite bodies/subjects or the working send engine - they are reused verbatim. New Interview columns (`sentCandidateSubject/Body/At`, `sentClientSubject/Body/At`) added for the stored "what the recipient saw" copy. `npm run build` exits 0 (save the two pre-existing react-hooks/exhaustive-deps warnings).

**D1 - store what the recipient saw + model calendar events**
- At invite send time Ace stores a verbatim copy of each sent invite's subject + body, **candidate and client separately** (the new `sent*` columns). The calendar renders per-party events off what was actually emailed; clicking an interview event shows the stored "what the recipient saw" detail with **Edit + Cancel**, not the generic event editor. The Clubhouse weekly widget stays **ONE** row per interview.

**D2 - one Save, real update-choice, whole-interview Cancel**
- ONE Save in the edit flow drives a three-way notify choice (**update all guests / only new guests / don't send updates**) via `updateInterview` `notifyMode`, applied per party event. Whole-interview **Cancel** carries a two-way notify choice (notify guests / don't). Candidate and client are separate Google events, so updates fire independently per party.

**E / Pass 2a - calendar tiles + one Save on the generic editor**
- Side-by-side calendar tiles: overlapping same-time events column-pack into narrow blocks via new packing logic in the calendar utils / week-view / day-view; all-day events stay full width. Clicking an interview tile opens the read-only sent-detail with Edit/Cancel. The three unlabeled Save buttons on the generic event editor collapsed to **one Save + notify prompt**. Deleted dead `dashboard/interview-invite-actions.ts`.

**E / Pass 2b-i - the one-screen scheduler**
- The multi-window schedule flow (`ScheduleDialog` + two invite composers + the `inviteFlow` state machine) was replaced by **ONE scrolling screen**, `ScheduleInterviewScreen` in `local-placement-rows.tsx`: header, type, date/start/end/tz, location, interviewer(s), **Cc = client contacts**, **Bcc = Austin**, a **Send Client Email** toggle + its own subject/body editor, a **Send Candidate Email** toggle + its own subject/body editor, and **ONE Send button** that fires whichever toggles are on (one `sendInterviewInvite` call per enabled toggle). Bodies/subjects reuse the existing templates + send engine verbatim. The **"Client will send invites"** toggle sends nothing and logs one event. **No attachment field** - the interview send path has no attachment channel, so it was omitted deliberately. The killed checkboxes (separate-email, anonymize, split-with-recruiter) were not reintroduced.

**E / Pass 2b-ii + follow-ups - edit mode folded in, old paths deleted**
- Edit mode folded into the **same** `ScheduleInterviewScreen` (`existingInterview` prop), pre-filled. `RescheduleDialog` + the dead `rescheduleInterview` server action + `RescheduleInterviewInput` type deleted. The job-pill **Edit Interview** button (styled like Edit Offer, sitting between Schedule and Offer) renders for an interviewing-stage candidate with a scheduled interview; the interview->job join was fixed read-side for Ace-native jobs (look up by the synthetic `rfJob.id` the interview was stored under, in addition to `ace:cuid`). The calendar drawer Edit + weekly-widget click + the `?edit=interview` deep-link all open the one screen in edit mode. On Save, an edited body pushes to the live Google event **gated by the notify choice** - "don't send updates" patches the event description silently (no email) so Ace and Google never drift.

**Polish fixes**
- Template picker + "Ace default copy" controls removed from the scheduler (the client editor auto-fills the Client Interview Confirmation template, the candidate editor the candidate-prep template, both editable inline). The HTML body tag-leak (`<p>`/`<br>` showing literally in the scheduler editor, the calendar tile detail, and the Bcc Gmail copy) fixed by routing seed bodies through the existing `htmlToReadableText` helper - the calendar invite path is unchanged. Sticky Save footer (`90dvh`) so Save is reachable at any screen height. Notes field removed from the scheduler. Auto-retry once on a transient Google `403 rateLimitExceeded` (safe - the quota rejection happens before any event is created). USED BY / UNUSED status badges removed from Settings template cards.

**Bcc fixes**
- The private Bcc copy now sends **only** to addresses in the Bcc field (the sender is no longer hardcoded as a recipient). `andrew@breakpointtalent.com` added to `TEAM_BCC_OPTIONS` as a selectable Bcc option alongside Austin. Selected Cc/Bcc options drop out of the remaining dropdown.

**Edit-mode + multi-interviewer final fixes**
- Both **Send Client / Candidate Email** toggles now **default ON in edit mode** with their editors shown - previously they were hidden when the invited-flags were false (never-emailed / client-will-send / pre-D1 interviews), the bug that made edit mode look like the old time-only popup. The interviewer field was restored to the multi-chip **`InlineContactMultiInput`** (the Ace 75.0 multi-recipient behavior had regressed in the rebuild) in **new + edit** modes - multiple interviewers attach to the **CLIENT event only**, never the candidate event, never auto-Cc'd, and picked chips drop from the options. Interviewer(s) prefill from the stored attendees in edit mode. The job-pill **Edit Interview** button only shows for an **upcoming** interview - once the scheduled time passes (the interview has taken place) it disappears until another is booked. The This Week widget renders all events per day (removed the Up-next `slice(0, 2)`; the 5-day strip was already uncapped).

### Known / deferred from this session
- **`updateInterview` `notifyMode` is global across both party events** - the notify choice is the master control on edits; the per-party Send toggle is fully wired for the newly-invited case. Acceptable as-is (see ACE_ROADMAP.md).
- **On edit reopen, a previously-Cc'd client contact can appear as an interviewer chip** because the stored `clientAttendees` historically merged interviewer + Cc client contacts into one list. Cosmetic only (all are client-event guests; no Cc leak). A strict interviewer/Cc split would need a separate stored column - deferred, not scheduled (see ACE_ROADMAP.md).

## What Shipped in Ace 75.0 (2026-06-01)

Invoice + placement billing accuracy, installment reminders, the composer recipient model, and a batch of profile/scheduler fixes. The same-day Finances restructure is logged separately under Ace 74.0 below (not repeated here). `npm run build` exits 0 (save the two pre-existing react-hooks/exhaustive-deps warnings).

**Invoicing + placement contacts**
- **Invoice email composer auto-populates recipients + smart greeting.** The invoice email `To` auto-fills from the placement **billing contact** and `Cc` from the **hiring manager**. The greeting scales to the recipient count: 1 person -> "Hi [First],", 2 -> "Hi [First] and [First],", 3+ -> "Hi Team,". The email-body **start date now reads the SAME placement start-date source + formatter as the PDF**, fixing the UTC off-by-one that showed 5/31 instead of 6/1.
- **`createDraftInvoiceAction` (custom-installment path) carries billing + hiring contacts** via the shared **`resolvePlacementInvoiceContacts()`** helper, so the installment invoice flow resolves the same contacts as the standard flow.
- **Billing + hiring contact PICKER restored on the live Make Placement modal (`LocalPlacementDialog` in `src/app/candidates/[id]/local-placement-rows.tsx`).** One-click chips from `job.clientContacts`, inline add, name-only contacts supported. `recordLocalPlacement` now writes the full `billingContacts` / `hiringContacts` JSON arrays and mirrors the first entry to the legacy columns. (Closes the gap on the Ace-native modal path where the richer picker had been lost - see architecture non-negotiable 14.)

**Invoice PDF**
- **Base Salary shows the accepted salary.** The Fee field reads **"Min Fee"** when a minimum/flat fee drove the amount, else the percentage. On min-fee deals the line-item description reads **"$X base (minimum fee of $Y applied)"**.
- **Client-facing note (`Invoice.clientNote`) prints on the PDF**, separate from the internal note. Removed the "On invoice for reference..." italic line. Un-bolded Payable to / EIN / Accounts Receivable; only **"Please reference INV-#### on payment."** stays bold.
- **Email signature oversize regression fixed** (kept the images-loading fix).

**Installment reminders**
- **Reminders fire 10 calendar days before each installment due date, slid to the prior Friday when that lands on a weekend** (new `src/lib/business-days.ts`). Reminder pseudo-events are clickable on the calendar grid; the Upcoming-panel reminder edit form is no longer clipped (scrolls down to Update). Ethan's installment-2 reminder moved Aug 30 -> Aug 20.

**Composer recipient model**
- **TO accepts multiple recipients as pick-or-type chips across every composer (`8b8146c`).** `EmailComposer`'s `To` always renders **`ContactComboMulti`** (the same chip widget as Cc/Bcc, seeded from `toOptions ?? recipientOptions`); the dead `ContactSinglePicker` single-select was removed. `MailComposer`'s **`AddressRow`** gained chip rendering (committed addresses as removable chips + a local typed buffer) while **KEEPING its live Gmail/contact server-search typeahead**; the value stays the comma-string the send path (`splitAddresses`) consumes, so no send-path change. Enter / comma / semicolon / Tab / blur commit a chip; Backspace on empty input removes the last chip; prefilled recipients render as chips at rest. Calendar Guests left untouched. Every send path already takes `to: string[]`. Covers submittal, interview client + candidate invites, find-matches "New email", click-to-email, Mail compose, reply / reply-all / forward, ComposeFAB New Email, and the invoice email.
- **Cc = client contacts, Bcc = Austin only (new `src/lib/team-contacts.ts` `TEAM_BCC_OPTIONS`).** Client contacts no longer leak into the Bcc dropdown across the composers.

**Profile / scheduler / UI fixes**
- **Submit always opens the submittal composer with the candidate's most recent resume version attached** (amber note when there is none).
- **Interview Ace reminder defaults ON on reopen**; `updateCalendarEventAction` dedupes so editing an interview no longer creates a duplicate reminder.
- **Save Note button matches the Button Standard** (tinted-green outline).
- **New candidate from pasted LinkedIn text no longer requires an email.**
- **Keep-candidate popup no longer clips off-screen** (capped height + scroll).

## What Shipped in Ace 74.0 (2026-06-01)

Finances surface restructure. No schema changes. `npm run build` exits 0; lint + types clean (save the two pre-existing react-hooks/exhaustive-deps warnings).

- **Finances split into two standalone Ops pages (`f5e099b`).** The single OPS "Finances" sidebar link (three `?tab=` tabs) is gone, replaced by two entries in `src/components/nav-items.ts`: **Invoices** (`/invoices`, Receipt icon, lime) and **Expenses** (`/expenses`, Wallet icon, amber). Both desktop `Sidebar` and `MobileNav` inherit the split from the shared nav source. `/invoices` is now a real page (the old InvoicesTab content + KPI tiles + filter TabStrip + future-invoices section, moved out of `finances/page.tsx`; `future-invoices-section.tsx` relocated to `app/invoices/`), no longer a redirect. `/expenses` is a thin new page rendering `FinancialPerformanceTab`. `top-bar-page-title.tsx` gained `/invoices` + `/expenses` specs (titles "Invoices"/"Expenses", "+ New Invoice"/"+ New Expense" actions; `/invoices/[id]` breadcrumb now links to `/invoices`). `/finances` is kept as a redirect (`?tab=expenses` -> `/expenses`, else -> `/invoices`) so old bookmarks + `revalidatePath("/finances")` still land.

- **Revenue & Profitability deleted; three Revenue cards moved to Placements (`f5e099b`).** The By client / By source / Trend cards were extracted verbatim (data wiring + styling) into `src/components/finances/revenue-cards.tsx` (`RevenueCards`, a self-contained server component that runs its own invoice + placement queries, honoring the Placements period selection) and now render **above the map** on the Placements tab (`placements-tab.tsx`, between PlacementsBreakdowns and PlacementsMapCard). The entire Revenue & Profitability surface was then removed from `financial-performance-tab.tsx`: the top KPI row (Total Revenue / Gross Margin / Net Margin / Total Expenses / Blended ROI), the Revenue section, and the Profitability section (Margins + P&L) are gone. `FinancialPerformanceTab` is now Expenses-only (no `mode`/`selection` props, calendar-year scoped). It still runs the revenue-invoice query, but only to feed **ROI-per-tool** revenue attribution (an Expenses card) — that was the one cross-dependency. `PnlCard`/`buildPnlData` are no longer imported here.

- **Expenses "Money In" is bank-truth only (`f5e099b`).** Money In combined Ace placement rows (`stage: hired`, candidate name + `feeTotal`) with Mercury IO Cashback. The Ace placement rows let projected/cancelled placement amounts (the stray **$18,000 Andrew Kraig** Jun 1 row) leak into the cash tally and double-count against Net Profit / Loss. The placement-sourced rows are removed entirely; Money In = Mercury (and QuickBooks once wired) transactions only. Total Money In + Net Profit/Loss derive from `moneyInRows` so they recompute without the placement rows. Matched Mercury rows untouched. `expense-actions.ts` now also `revalidatePath("/expenses")`.

## What Shipped in Ace 73.0 (2026-06-01)

Test-run close-out session: per-job Matches search, toast-theme regression fix, news-tab restructure, app-wide placeholder sweep, read-only-calendar resilience, start-confirmation screenshot viewer, This-Week week paging, and a unified time control across all four dashboards. No schema changes. `npm run build` exits 0. (The mobile-nav rainbow + icon-audit work shipped earlier the same weekend is logged separately under Ace 72.0 — not repeated here.)

- **Matches tab now job-seeded (`dd915d8`).** Root cause: `/api/candidates/search` is org-scoped only; passing `jobId` merely excluded that job's already-rejected candidates, so every job's Matches tab opened to the same global org list. Fix: the tab now opens to a per-job *seeded* search — an OR-group built off the job title + `searchKeywords` (location deliberately omitted so candidates with null coordinates aren't zeroed out; skills matched via forgiving ILIKE). The route stays org-scoped and user-widenable, and the empty-state gate was left untouched.

- **Toast theme regression fixed (`868c2e2`).** Root cause: `dafdbfb` deleted the `getStoredToastTheme()` read from both toast renderers and hardcoded a brand-tint, so the in-app toast theme picker (Ink especially) stopped applying. Fix: restored the stored-theme read so both renderers are inline-driven from the spec again. Side effect: `_toast-chrome.tsx` is now orphaned (flagged for cleanup in the roadmap).

- **News tabs migrated to TabStrip + companion buttons neutralized (`2a1c2aa`).** Today's Briefing tabs were a hand-rolled segmented control; migrated onto the shared `TabStrip` so they match the rest of the app and inherit the proximity-hover effect. While there, restyled the Daily Chess Puzzle + Word of the Day to the standard neutral-outlined button (no green/blue), slim height, width preserved.

- **News tabs trimmed to 3 (`e6e36d2`).** Per Andrew, the Front Page tab was removed; the strip is now Recruiting / AI & Tech / Public Accounting, defaulting to **Recruiting**, in that order.

- **App-wide placeholder sweep (`6c76cd6` + follow-up).** Removed ~113 example/hint placeholders across 42 files. Verified safe: app-wide `defaultValue` count = 0, so removing `placeholder` text cannot touch any real pre-filled value. Keepers were documented and deliberately retained — branding identity hints, job-form Full-time / 1 / USD defaults, invoice `0.00`, the Title-optional hint, functional search/composer placeholders, Select prompts, and the Mercury API-key field.

- **Calendar edit/delete is 403-resilient (`9112622`).** Root cause: read-only Google holiday/subscribed events return a 403 on mutate, which surfaced as an opaque failure. Fix: edit/delete actions now return typed results — edit shows a clean "read-only" message, and delete skips the Google call but still removes the local Neon row so the event disappears from Ace.

- **Calendar ingestion stops mirroring read-only feeds (`0df74e3`).** `google-sync.ts` now skips `accessRole === "reader"` (and `freeBusyReader`) calendars so holiday/subscribed feeds aren't ingested into Neon; the delete-confirm only warns "notify attendees" when the event actually has guests. No safe blanket cleanup of already-synced reader rows is possible (the schema has no `accessRole` column), so already-mirrored rows must be deleted manually — Republic Day was removed by hand and won't return.

- **Start-confirmation screenshot viewer (`2a9e6c2`).** Placements now derive a `hasStartConfirmation` boolean (the screenshot bytes are NOT shipped into the page payload). Placements that have one show a "View start confirmation" chip that opens `/api/placement-screenshot/<id>` on demand.

- **This-Week widget week paging (`5b7cd07`).** Added a client `weekOffset` + a server action that re-runs the same `getEasternWeekBounds` queries over a shifted window. Offset 0 keeps the today/this-week sections; any other week shows a "WEEK OF" range header + a 5-day strip only.

- **Unified time control across Clubhouse / Metrics / Placements / Finances (`284a7a1` + `1ff9f98` active-tab restyle).** One combined control row = grain tabs (Week / Month / Quarter / Year) + divider + prev/next arrows around a center period label. `TimeRangeSelection` moved from a 3-value period enum to an integer **offset** (0 = this, −N = back); the underlying `timeRange()` math is unchanged. Year grain is now enabled everywhere (only Clubhouse had restricted grains; Clubhouse is forward-capped at the current week, unbounded backward). The active grain tab is the standard squared green-outline (`border-court-brand` + `text-court-brand`, transparent) matching the app TabStrip standard. Legacy URL params still parse.

### Resolved / Closed this session (no longer in the queue)

- **Settings Personal Info white-vs-grey field values — NOT A BUG.** The grey fields were simply empty and rendering their placeholder; a saved value can only ever render white. The save/load JSON round-trip is correct — Andrew re-entered the values and confirmed. **Latent edge flagged:** the `parseAddress` legacy fallback (`constants.ts:60`) collapses a non-JSON address into street-only; worth a guard if a legacy single-string address ever shows up.

- **Bug 3 "dark mode resets itself" — was Auto Night Mode, now toggled off; pending one morning confirmation.** The resets traced to the Auto Night Mode 7 AM ET light-flip, not a persistence failure. Auto Night is now off. **If it still resets with Auto Night off**, it's the real localStorage-only / no-DB-backstop bug: `courtSurface` / `courtTheme` columns don't exist (the prior "fix" crashed prod by calling a client-module fn from the server root layout and was wrongly logged as shipped in 70.0). The safe 3-step fix is already mapped in the roadmap.

- **v2 deterministic scorer / pipeline Match column — DECIDED: leave gone, not rebuilding.** Removed from the active queue.

- **Test-run Batch 5 (Ethan metric refresh) + Batch 8 (interview attendee hydration) — CLOSED per Andrew.** Both were stale carry-overs; a prior session's doc update missed the actual fixes. Removed from the active queue.

### Note — Step 0 grep baseline UNITS mismatch (for future audits)

The CLAUDE.md Step 0 grep baselines (`recruiterflow ~0`, `RecruiterFlow ~18`, `RfId ~1076`) read as **occurrence/line counts**, but the documented grep commands pipe through `-l | wc -l`, which yields **file counts**. This session Code reported file counts (`recruiterflow` 3, `RecruiterFlow` 10, `RfId` 84 files) and they looked alarmingly "below baseline" only because the units didn't match. Future audits must compare like-for-like: either drop `-l` to compare occurrences, or restate the baselines as file counts. (Also recorded in ACE_RULES.md under the Step 0 rule.)

## What Shipped in Ace 72.0 (2026-05-31)

Mobile-nav rainbow + icon semantic-color audit. No schema changes. `npm run build` exits 0.

- **Mobile-nav rainbow via a shared nav source.** New `src/components/nav-items.ts` is the single source of truth for the primary nav — `NAV_GROUPS` + `FOOTER_NAV`, including the per-item rainbow `iconColor`. The desktop `Sidebar` and the mobile hamburger `MobileNav` previously kept independent copies of the nav list, so the rainbow only existed on desktop. Both now consume the shared source, so per-item icon colors match and can never drift. Mobile inactive rows show the rainbow; the active row inherits the high-contrast active foreground (same rule as desktop). No new colors / no hardcoded hex — reuses the existing desktop palette tokens. ACE_DESIGN.md Icon Semantic Color note updated to record that mobile now consumes the shared source.

- **Icon semantic-color sweep — audited, already compliant.** Enumerated every standalone/icon-only action across candidate/job/client/placement/pipeline (86 files, 392 icon usages). They already follow the Icon Semantic Color System: action icons inherit the correct color from their wrapping `Button` (shared `reject`/`apply`/`keep`/`schedule`/`offer`/`reapply`/`primary` variants, or colored-outline native/ghost buttons), and quiet row-action deletes already rest muted and go `hover:text-red-600`. No unambiguous icon-token fixes were needed. A short list of BUTTON-color judgment calls was deferred to Andrew (see ACE_ROADMAP.md Next Up / Queued-from-71.0): emerald-600 vs brand-green confirm checks; a couple of standalone keep glyphs inside primary-green buttons; the neutral-ghost `dismiss-placement-button` confirm; decorative `text-brand-dark` accents.

## What Shipped in Ace 71.0 (2026-05-31)

UI-consistency session: a shared TabStrip proximity-hover effect, a unified two-tier TimeRangeSelector across all five selectors, a button shape/width/label standardization sweep, two Button Standard doc reconciliations, and the first batch of the new icon semantic-color system. No schema changes. Every commit built clean (`npm run build` exits 0).

- **1. Proximity hover on the shared TabStrip.** The shared `src/components/ui/tab-strip.tsx` gained a proximity-hover effect: tabs scale to `1.04` + pick up a tint as the pointer nears, rAF-throttled so the pointer-move handler never thrashes layout, and gated behind `prefers-reduced-motion` (no transform when reduced motion is requested). Because every tab strip in the app routes through TabStrip (UI Consistency Rule), every TabStrip-based strip inherits the effect app-wide for free - no per-surface wiring.

- **2. Unified two-tier TimeRangeSelector across all 5 selectors.** New `src/lib/time-range.ts` + `src/components/ui/time-range-selector.tsx` replace the five divergent ad-hoc range pickers with one two-tier model: **grain** (Week / Month / Quarter / Year) x **period** (Last / This / Next). A **compact dropdown variant** is used for the Billing Tower where horizontal space is tight; the full segmented variant is used elsewhere. The query layer is unchanged (the selector resolves to the same date bounds the old pickers produced) and timezone behavior is preserved exactly - **week boundaries compute in ET, all other grains compute local** - so no metric shifts. One selector, five consumers.

- **3. Button Standard doc reconciliation - primary CTA is tinted-green outline, NOT filled green.** Code is canonical: the shipped primary CTA is `border border-court-brand bg-court-brand-tint text-court-brand-dark` (hover `bg-court-brand/25`), not a solid `bg-court-brand text-white` fill. The Button Standard block in both ACE_RULES.md and ACE_DESIGN.md already carried this corrected wording; this session also fixed the stale **"Primary: green filled"** line in ACE_DESIGN.md's older "Button hierarchy" section so the two no longer contradict.

- **4. Save label uniformity; toast hex left as-is (deliberate).** Save buttons read a uniform **"Save"** across surfaces (see item 6). The toast hardcoded hex was reviewed and **intentionally left in place**: there is no white / on-accent Court Mode token to route it through, and the Ink toast theme is intentionally NOT Court-bound (it carries its own fixed palette by design). Documented so a future audit doesn't try to tokenize it.

- **5. Button shape + width fixes.** **15 `rounded-full` text buttons -> `rounded-md`** (Button Standard: the `rounded-full` ban applies to text buttons; pills/chips/avatars/icon-only/FAB/toggles are unaffected). **6 non-submit full-width buttons -> `w-auto`** (the no-full-width rule: only a full-width form-submit CTA stretches edge-to-edge).

- **6. Button LABEL standardization (39 edits).** Canonical label per action family: **Save** everywhere (no "Save changes" / "Save to Ace" variants in the label text); **Cancel / Reject / Submit / Delete** collapsed to the single canonical verb; the **"Submit to Job"** label was killed (it's just **Submit**); **Edit** keeps a noun only for Offer / Placement / Interview (where the screen has more than one editable thing); **Send** keeps a noun only where the same screen fires more than one kind of send; **New / Create** keep their noun in Title Case; connectors **name the service** (e.g. Reconnect Gmail); the pipeline chip-vs-submit pair is unified (short chip label + full label on the modal submit, with `aria-label` matching the full intent); busy states use the ellipsis character.

- **7. Icon semantic color system - first fixes + new permanent rule.** Established the icon semantic-color system (now a permanent rule in ACE_DESIGN.md): **delete = red-600, reject = red + UserX, edit = muted, create/add = brand, send = brand, confirm = brand-green + CheckCircle2, schedule = blue, keep = cyan, apply = amber, offer = purple, warning = amber, neutral/nav = muted.** Icons inside a semantic Button **inherit** the button's color (set no color); standalone / icon-only actions take the token explicitly. First three fixes shipped: (a) **unified the delete trashcan** (was a 5-way split - mail-view delete-label `red-700 -> red-600`, the mail-composer "Delete draft" went from the lone neutral `secondary` to `danger`/red, settings/templates delete `red-700 -> red-600`, the delete-candidate resting state normalized to plain muted; no delete is ever fully neutral and all reds are red-600); (b) **retired the lone orange Email button** on the job Matches tab (bespoke `border-orange-500 / bg-white / text-orange-600` -> shared `Button variant="secondary"`, reskins across Court themes); (c) **fixed the Ace Assistant glyph dark-mode bug** (`src/components/icons/in-conversation.tsx` hardcoded `#5A9642` + `#FAF8F3` -> `rgb(var(--court-brand))` accent + `rgb(var(--court-surface))` bubble; the ink "you" figure -> `rgb(var(--court-fg))` so it stays legible on the surface bubble in the active green-button state). Ace glyph browser-verified light + dark, inactive + active (bubble inverts white<->dark-navy, accent tracks brand, ink figure legible in all states). The standalone-icon token sweep + the rainbow sidebar->mobile-nav port are queued (see ACE_ROADMAP.md Next Up).

## What Shipped in Ace 70.0 (2026-05-30)

Eleven-item session: scoreboard cancelled-placement accuracy, interview-pill dedup, submittal double-signature + iOS image fixes, the Edit Template editor pass (modal-close behavior + rich-text bold + Save restyle), recipient-autocomplete speed, approve-before-sending removal, interview Bcc, placement-modal card alignment, the web-push Test-notification diagnostic, and the dark-mode/settings persistence fix. (The docs were bumped to 70.0 mid-session capturing only four of these — this consolidated entry is the full session. Every commit built clean, `npm run build` exits 0, save the two pre-existing unrelated react-hooks/exhaustive-deps warnings.)

- **1. Cancelled placements drop out of every scoreboard metric (`0058522`).** Cancelled placements were still inflating the Scoreboard. `src/app/dashboard/scoreboard-data.ts` now excludes `stage: "cancelled"` from all metric surfaces — Top Clients by Revenue, Top Roles Closed, Placements QTD, Win Rate, Avg Fee, Days to Fill, and Offers — and `src/app/dashboard/scoreboard.tsx` surfaces a cancellation as a red **"Placement cancelled"** entry in Recent deal moves (so the event is still visible without counting toward the numbers). Matches the Ace 67.19/68.0 "cancelled is excluded from live metrics" rule and extends it to the scoreboard.

- **2. Interview scheduling updates the existing pill instead of duplicating it (`ba31cb9`).** Scheduling an interview was creating a second pill rather than advancing the existing one. `src/app/candidates/[id]/interview-actions.ts` now updates the existing placement/interview row on schedule; `local-placement-rows.tsx` drops the date/time off the pill **title line** (the schedule detail lives in the row body, not the title), so the pill reads cleanly and there's one pill per placement.

- **3. Submittal double-signature fixes — sign-off strip, then the real iOS image fix (`5b9eec2`, `d754cca`).** Submittal emails were rendering the signature twice. First pass (`5b9eec2`, `src/lib/claude.ts` + `src/lib/gmail.ts`): strip the stray AI sign-off and de-dupe the HTML signature on the `"-- "` delimiter so the signature is appended exactly once. The deeper iOS cause (`d754cca`): the logo/icon images were going out as ordinary attachments, which **iOS Mail double-renders** (inline + as a visible attachment). Now the signature images are embedded as proper **inline `cid:` MIME parts** (`src/lib/signature.ts` new helper + `src/lib/gmail.ts` multipart/related assembly), so Gmail and iOS Mail show the logo once and don't expose it as an attachment. Covered by `tests/unit/signature-inline-images.test.ts`.

- **4. Edit Template modal — close behavior + Save restyle (`465c9fb`, `395ea36`, `b9c9eed`).** The template editor modal now **closes only on X / Cancel** — not on overlay click, drag, or Escape — so an in-progress edit can't be lost by a stray click (`465c9fb`, `src/app/settings/templates-view.tsx`). The Save button was restyled across two passes to land on the outlined **"Save branding" / "Save to Ace"** CTA exactly: transparent `court-brand-tint` fill, `court-brand` border, `court-brand-dark` text, `rounded-md`, disk (Save) icon (`395ea36` → final `b9c9eed`), replacing the solid-filled shared Button primary variant.

- **5. Recipient autocomplete speed — instant DB matches, Gmail folds in async (`2dd6a44`).** The To-field autocomplete used to block on a cold Gmail snapshot. `src/lib/gmail-recipients.ts` + `src/app/api/mail/contacts-search/route.ts` now return **instant DB/contact matches first**, fold Gmail history in **asynchronously**, and warm the Gmail snapshot up **on focus** so the first keystroke is fast. `src/app/mail/mail-composer.tsx` consumes the progressive results.

- **6. Rich-text template body with bold, including bolded merge fields, across all send paths (`ce43c32`).** Template bodies now support rich-text **bold** that survives through to send — including **bolded merge fields** (a bolded `[First Name]` stays bold after substitution). New `src/lib/merge-fields.ts` handling preserves the formatting through `applyMergeFields`; wired through `src/app/settings/templates-view.tsx` (editor), `src/components/email-composer.tsx`, `src/lib/templated-email.ts`, and the bulk path (`src/app/candidates/bulk-actions.ts` + `bulk-dialogs.tsx`) so every send path renders the bold consistently.

- **7. Approve-before-sending removed from Templates + Triggers; triggers send directly (`33c0a8b`).** The per-template "Approve before sending" toggle + "Drafts to your inbox" indicator (`templates-view.tsx`) and the Edit-Trigger "Approve before sending" toggle + "Approve in drafts" chip + approve-tied warnings (`triggers-view.tsx`) were all removed. Runtime: `src/lib/templated-email.ts` no longer diverts a fire to draft on `template.sendAsDraft` / `forceDraft` — `effectiveMode` is purely the caller's mode; `src/lib/trigger-fire.ts` dropped the `forceDraft` plumbing and the `rule.sendAsDraft` read. The `gmailConnected` signal in the trigger cards/dialog was repurposed into a general "Gmail isn't connected, so this auto-send trigger can't send" warning (kept it load-bearing instead of orphaning it under `next/typescript` no-unused-vars). DB columns (`EmailTemplate.sendAsDraft`, `TriggerRule.sendAsDraft`) left in place — no migration, just no longer surfaced or read on the send path. Triggered templates now always send (subject to the caller's mode, which is `send` for every live trigger callsite).

- **8. Bcc on the interview scheduler, delivered via a private Gmail copy (`d7351c5`).** The Schedule Interview modal's `CcBccPicker` (`src/components/placements/placement-shared.tsx`) gained a Bcc field beside Cc. A Google Calendar invite has no private Bcc bucket, so a Bcc recipient (e.g. Austin) is delivered a **separate Gmail copy** of the invite (same subject + description) at client-invite send time, hidden from the candidate and client. Wiring: `bccCsv` state on the schedule modal → `onScheduled` `bccEmails` → the client invite `EmailComposer` un-hides Bcc (Austin auto-offered via `BCC_TEAMMATE_OPTIONS`), pre-fills `initial.bcc`, and passes `draft.bcc` to `sendInterviewInvite`; the action (`src/app/candidates/[id]/interview-actions.ts`) sends the best-effort copy (`to: sender`, `bcc: recipients`) after the calendar event is created. Files: `placement-shared.tsx`, `local-placement-rows.tsx`, `interview-actions.ts`.

- **9. Billing Contact + Hiring Manager cards equal height + aligned (`5e94832`).** In the Edit/Confirm placement modal (the one carrying the Cancel placement button), the side-by-side Billing contact / Hiring manager cards (`src/app/candidates/[id]/local-placement-rows.tsx`) rendered uneven because their helper paragraphs wrap to different line counts. Each card is now `flex flex-col` with the Name/Email block bottom-anchored via `mt-auto`; grid `align-items: stretch` keeps the two boxes equal height, so the inputs line up across both regardless of description length.

- **10. Web-push Test-notification diagnostic shipped from stash (`e72ba19`).** A self-diagnostic for the push-delivery investigation (Bug 1 / Bug 2). `src/lib/web-push.ts` returns a **delivery tally** (how many subscriptions were targeted vs delivered) and supports a `forceNotify` path; `src/app/api/push/fire/route.ts` plumbs it through; `src/components/push-permission-button.tsx` + `src/app/settings/connectors-view.tsx` add a **Test** button with a tri-state "Checking…" row so Andrew can fire a test push and read the result inline. `public/sw.js` tweaked to honor the forced notify. **Diagnostic only — does not by itself cure Bug 2** (see Next Task). NOTE: this leaves `[web-push][diag]` temp logging live in prod for now — cleanup pending (see Next Task; `web-push.ts` wants a light rebase when the logs come out).

- **11. Dark mode + settings persistence — surface/theme now DB-backed so they survive a PWA hard close (`bf7f284`).** Reported symptom: dark mode and other settings "get forgotten over time," especially on the installed PWA. Root cause (Step 0, confirmed before any edit): the Court Mode **surface + theme were persisted to localStorage only** (`ace-court-surface` / `ace-court-theme`), with **no DB leg**. Installed PWAs — iOS especially — evict script-writable storage after inactivity / storage pressure, so on a hard close the pre-hydration script and `CourtModeProvider` found nothing, defaulted to **Hard/Light**, and then **rewrote those defaults back into localStorage**, permanently forgetting the preference. Auto Night Mode survived because `UserProfile.autoNightMode` was the only DB-backed appearance value; that asymmetry (DB settings reload, localStorage ones reset) was the fingerprint. Fix — make the DB the durable source of truth, mirroring the `autoNightMode` pattern: added nullable `UserProfile.courtSurface` / `courtTheme` (`prisma db push`; additive, zero data risk); new `setCourtMode({ surface?, theme? })` server action in `src/app/settings/appearance-actions.ts` (each column written independently so a theme toggle never clobbers the surface), called fire-and-forget from `setSurface` / `setTheme` / `toggleTheme` in `src/lib/court-mode.tsx` alongside the localStorage write; `layout.tsx` seeds the DB values into both the pre-hydration inline script and the provider; `buildCourtModePreHydrationScript(surface, theme)` (replaces the old `COURT_MODE_PRE_HYDRATION_SCRIPT` constant) falls back to the DB value when a localStorage key is missing and **re-seeds localStorage from it** (palette restores with no flash after eviction); `CourtModeProvider` gained `initialSurface` / `initialTheme` props so SSR + first client render agree, and `readStored(fallback)` uses the DB seed instead of hardcoded Hard/Light when storage is empty. Legacy single-key `courtMode` migration + Hard/Light defaults preserved. Verified by executing the real emitted pre-hydration script against a simulated evicted localStorage (restores clay/dark + night/dark, re-seeds storage, preserves legacy migration, sanitizes garbage). Files: `prisma/schema.prisma`, `src/app/layout.tsx`, `src/app/settings/appearance-actions.ts`, `src/lib/court-mode.tsx`.

## What Shipped in Ace 69.0 (2026-05-30)

**Headline: the RF two-profile split is CLOSED.** Every one of the 726 candidates now renders the single Ace-native `LocalCandidateProfile`; the legacy `rfId`-keyed RF profile path is deleted. Executed as a four-phase, reversible-until-the-flip migration (rule 7: no partial migrations), plus two UI fixes and the Edit Resume render-bug fix surfaced by the flip. SHAs: `1f7e5d0` (A), `f4e6850` (B), `c985104` (C1), `791c843` (C2), `ff178a2` + `6c78351` (rail/mobile padding), `bd7c69e` (Edit Resume).

- **Phase A — extract shared placement UI into a neutral module (`1f7e5d0`).** Behavior-neutral. Moved 7 shared symbols verbatim (`ConfirmStartDialog`, `formatOpenJobOption`, `InlineContactMultiInput`, + shared types `ClientContactRef` and the others) out of the legacy `placement-flows.tsx` into a new neutral module **`src/components/placements/placement-shared.tsx`**. `local-placement-rows.tsx` and `local-candidate-actions.tsx` now import from the new module instead of the RF closure; `placement-flows.tsx` re-imported them back so `PlacementActions` stayed unchanged. No query, data, or upload behavior change — pure relocation to break the Ace-native path's dependency on RF code ahead of the flip.

- **Phase B — cuid-FK backfill (`f4e6850`).** Backfilled every `Placement` / `Interview` foreign key to the candidate cuid so the Ace-native path (which reads by cuid) reaches every row the legacy path reached by `rfId`. **68 cells filled** across Placement/Interview; **4 synthetic-id shim-bug rows resolved** (rows that had been written with a synthetic id instead of a real cuid); **1 duplicate placement reconciled**; **1 rejected RF orphan left untouched** (intentionally — no live candidate). `ActivityLog` and the client agreements/benefits tables were already cuid-keyed, so they needed no backfill. Idempotent, re-runnable artifact at **`scripts/migrations/phaseB-cuid-fk-backfill.cjs`**. Audit (`scripts/audit-legacy-candidates.ts` + `c1-verify-flip.ts`) confirmed **0 pill-loss** afterward: every Neon placement is reachable by cuid.

- **C1 — THE FLIP, reversible (`c985104`).** Routed all 726 candidates (690 legacy + 36 Ace-native) through `LocalCandidateProfile` behind a `ROUTE_ALL_THROUGH_LOCAL: boolean = true` guard, deleting nothing — the legacy body stayed type-checked and one constant-flip away from restoration. Only `page.tsx` (+26) and a verify script changed. **Accepted behavior decision:** 594 legacy candidates whose pipeline pills came *only* from RF-cache `raw.jobs[]` (no backing Neon Placement) now show an empty pipeline strip. This is correct, not a regression — Neon is the canonical source of pipeline truth (rule 13) and RF is removed (rule 1); RF-cache-only pills were never real placements. The 3 spot-check candidates (Mac Bowers, Sidney Long, Jennifer Baker) built complete non-null props (name/contact, geocoded distance, Neon placements w/ job+client, interviews, resumes).

- **C2 — delete the dead legacy path, atomic (`791c843`).** With C1 settled and live, removed the legacy path entirely (rule 7). `page.tsx` legacy body (RFCandidate-from-raw reconstruction, `PlacementActionsIsland` mount, all orphaned helpers) deleted; `ROUTE_ALL_THROUGH_LOCAL` + the `|| rfId == null` clause gone; **`LocalCandidateProfile` is now the unconditional return** (`page.tsx` 1186 → 44 lines). Deleted whole files: **`placement-actions-island.tsx`** (47 lines) and **`placement-flows.tsx`** (4225 lines) — both had no live importers after C1. **Synthetic-id shim RETAINED — still load-bearing:** `syntheticIdFromCuid` + `_aceJobId`/`_aceClientId`/`_aceContactId` carry-fields are read live by the Ace path (`local-profile.tsx`, `candidates/bulk-actions.ts`, `placement-actions.ts`, `jobs/page.tsx`, `jobs/[id]/page.tsx`, `lib/candidates.ts`, `lib/rf-payload-shapes.ts`). Its removal is a separate future phase, not part of the two-profile-split close.

- **`/candidates` search-rail padding fix (`ff178a2`).** Ace 68.0's `3ae8c2c` slide-left trimmed the `isFullBleed` (`/candidates`) main-column left padding but left the rail wrapper's negative margins (`-ml-[18/22/38/54px]`) tuned to the old padding, jumping the net offset from a uniform −6px to −14/−26/−38px — shoving the rail under the sidebar and clipping the first letter of every filter label. Restored the original padding on the `isFullBleed` branch ONLY (`pl-3 / md:pl-4 / xl:pl-8 / 2xl:pl-12`) in `src/components/app-shell.tsx` so the net offset returns to −6px; negative margins untouched; every other route uses the unchanged else branch so the slide-left is preserved.

- **Mobile/PWA left-shift fix (`6c78351`).** Symmetric page padding below `md` so the installed PWA no longer renders content shifted left on phone viewports.

- **Edit Resume render fix (`bd7c69e`).** Once C1 routed all candidates through the canvas-based Ace-native editor, the Edit Resume tool (`src/app/candidates/[id]/resume-editor.tsx`) surfaced a runtime error — *"Cannot use the same canvas during multiple render() operations"* — and rendered the resume upside-down/mirrored. Root cause: the render effect reused persistent canvas DOM nodes but never cancelled its pdf.js `RenderTask`, so a `ResizeObserver`-driven fit-scale change re-ran the effect mid-render on the same canvas; pdf.js rejected the second `render()` and the interrupted task left the 2D-context transform half-applied (the flip). Fix: track the in-flight `RenderTask` per page, cancel any task still painting a canvas before re-rendering it, cancel all in-flight tasks on effect cleanup, and swallow pdf.js's `RenderingCancelledException` so a deliberate cancel isn't surfaced as an error. The same cancellation resolves the flip — pdf.js unwinds its Y-flip transform before the next pass. Type-only change to `src/lib/pdfjs-loader.ts` to expose `cancel()` (new `PdfJsRenderTask` type). Scope held to those two files; `PdfCanvasViewer` and routing/data untouched.

## Next Task

**The interview restructure (D1 / D2 / E) is DONE — shipped in Ace 76.0 (see What Shipped in Ace 76.0 above and ACE_ROADMAP.md ▸ Completed - Ace 76.0). The active queue is clear of the restructure.** Two deferred edge items from it are parked in ACE_ROADMAP.md (global `notifyMode`; interviewer/Cc chip merge on reopen) — neither is scheduled.

**Next priority — pick from ACE_ROADMAP.md ▸ Next Up:** the action-row button audit (#1) and auto-geocoding the remaining 3 candidate-create paths (#2) are the front of the queue. Confirm the live deploy carried this session's interview-restructure ships first (the live deploy lags repo — `live-deploy-diverges-from-repo`).

**Surfaced earlier (Ace 71.0) — queued, see ACE_ROADMAP.md Next Up for full detail:**
- **NEW BUG (high priority): `/jobs/[id]` Matched tab shows 129 matched for EVERY job.** The matched count + list is not job-specific - it's returning a global candidate set instead of scoping per job. Diagnose the matched-candidates query scoping first (diagnose-only prompt before any fix).
- **Toast style-switch regression.** The in-app toast theme picker (Ink especially) stopped applying / the "Try it: Email" demo fires a wrong-themed toast. Diagnose, then fix.
- **Second icon fix - standalone-icon token sweep** + port the rainbow sidebar `iconColor` to `mobile-nav` (decision made: keep the rainbow, match desktop + mobile).
- **Widened visual-consistency audit, News-tabs->TabStrip migration, form placeholder sweep, Settings Personal Info white-vs-grey field diagnosis** - all queued in ACE_ROADMAP.md Next Up.

**Push notifications — open after the 70.0 diagnostic ship:**
- **Bug 2 (Enable Notifications turns itself off overnight) is still UNFIXED.** The web-push Test diagnostic (`e72ba19`) was instrumentation, not a cure — it lets us observe delivery, it does not stop the overnight self-disable. Working theory: subscription expiry tied to the Ace 67.3 PWA self-heal path (iOS expires the PushSubscription after idle/app-close and the re-subscribe isn't firing/sticking overnight). **Monitor overnight with the new Test button + delivery tally**, then fix from what the diagnostic shows.
- **Bug 1 is confirmed WORKING** via the new diagnostic (a fired Test push delivers and the tally reflects it).
- **iOS caveat (carry in any push reasoning):** a green Test result proves **server dispatch succeeded**, NOT that iOS woke the app in the background. Background wake is a separate failure mode the tally can't see — don't read a green Test as "Bug 2 fixed."
- ~~**Temp `[web-push][diag]` log cleanup still pending.**~~ DONE Ace 90.0. All 10 `[web-push][diag]` console.logs removed from `web-push.ts` along with the orphaned `redactDigits` / `diagPayload` helpers (the light rebase). The functional Test button + delivery tally + `forceNotify` path were retained, so Bug 2 can still be monitored from Settings; only the console spam is gone. (Was tracked alongside the older temp-diag-log cleanup noted in `project_web_push_temp_diag`.)

**Carried forward (unchanged):**
- **Auto-geocode the remaining candidate-create paths.** `createCandidate` self-geocodes; the **3 other create paths** (invoice flow, CSV import, match-by-name) do not yet — wire the same fire-and-forget `geocodePill` call into all three.
- **v2 deterministic scorer decision.** The Match column was pulled after the scoring engine was reverted (Ace 68.0). Decide whether a v2 scorer ships (resume-text + JD-prose as primary inputs) before re-adding any Match column.
- **Batch 5 metric refresh.** Carried forward.
- **Batch 8a/8b interview attendee hydration.** Carried forward.
- **Verify this session's ships on the live deploy.** HEAD is correct + builds clean, but the live deploy lags repo (`live-deploy-diverges-from-repo`); confirm the scoreboard cancelled-placement exclusion, the single interview pill, the submittal signature rendering once on iOS, the Edit Template close-only-on-X + Save style, rich-text bold across send paths, recipient autocomplete speed, the interview Bcc private copy, and the dark-mode/settings persistence (toggle dark + a surface, hard-close the PWA, confirm it returns dark) after the next deploy.
- **Synthetic-id shim removal (future phase).** Retained and load-bearing across 7 files after C2; removing it is its own scoped RF-removal phase.

## What Shipped in Ace 68.0 (2026-05-29)

Pipeline + candidate-profile distance pass, Find Matches UX, a column-standardization + typography pass, the Match column removal, candidate geocoding, and the RF vocabulary scrub. Shipped across `287d4e1`, `16af414`, `cc8a89f`, `95f4635`, `3874761`, `bcee788`, `882c8fe`, `3825f27` (plus the column-standardization groundwork in `d13983c` / `3ae8c2c` / `3c86061`).

- **Prompt 4 — pipeline distance sub-line + Match column (`287d4e1`, `16af414`).** Added a Location-cell "(X.X mi)" candidate→job distance sub-line on `/pipeline`, computed server-side via the lifted Nominatim geocoder (`src/lib/geocode.ts`, with its module-level cache) plus a new `src/lib/distance.ts` haversine + formatter helper. Candidate side reads `Candidate.lat/lng`; job side geocodes `Job.locationZip` (preferred) or `City, ST`. A Match column was added alongside, reading `CandidateMatch.score`. Follow-up `16af414` handled Nominatim 429 backoff and a Match-score-0 edge.

- **Match column REMOVED (`cc8a89f`).** The deterministic scoring engine that fed the column (`5665a8a`) was reverted (`220e381`), and the stored `CandidateMatch.score` rows were zeroed post-revert — so the column had no live data source and rendered all-zero. Pulled until a v2 scorer ships. The `CandidateMatch` model and the Find Matches surface were left untouched (only the pipeline column was removed).

- **Candidate geocode backfill + auto-geocode on create (`95f4635`).** `scripts/geocode-candidates.ts` gained an optional `--org=<cuid>` arg (base WHERE `lat: null, location: { not: null }` unchanged; org filter ANDed when present). Ran against BreakPoint Talent — coverage is now 724/726 candidates with lat/lng (the 2 misses have no location string). `createCandidate` (`src/app/candidates/new/actions.ts`) now fires a non-awaited `geocodePill(location)` → `prisma.candidate.update({ lat, lng })` right after the row is created, so new candidates self-geocode. Known gap: the other three candidate-create paths (invoice flow, CSV import, match-by-name) do NOT auto-geocode yet — backlog.

- **Distance everywhere + button borders + Show Cancelled removed (`3874761`).** Distance sub-line now renders on every pipeline stage tab AND on the Ace-native candidate profile job pill (`local-profile.tsx` computes it server-side keyed by placementId; `local-placement-rows.tsx` renders it muted next to the job/client). Format unified to "(X.X mi)" via the single `formatMiles` helper in `src/lib/distance.ts` — both surfaces share it, no second helper or geocoder. Pipeline per-row action buttons fixed (a border typo) to uniform colored outlines. The Show Cancelled toggle was removed; cancelled placements now render dimmed at the bottom of the Hired tab with a red "Cancelled" chip, excluded from the Hired count and from live metrics.

- **Prompt 6 — Find Matches UX (`bcee788`).** Floating match panels click-to-front (raise on focus), View Profile opens in a new tab, and every Find Matches button was restyled to the amber/gold magnifying-glass treatment.

- **Prompt 7 — sortable Location + Last Action on all tabs (`882c8fe`).** Both the main pipeline table and the intake (Applicants/Kept) tables gained click-to-sort Location and Last Action columns. Numeric `distanceMiles` is lifted onto each row so the Location sort is comparable; no-distance rows always sort to the bottom in both directions; one active sort at a time; the sort pattern is shared across the main + intake tables. Mobile PWA email composer shows the full sender name + a copyable email address below the `lg` breakpoint; desktop is unchanged.

- **Pipeline typography + layout pass (`3825f27`).** Job + Client collapsed into one stacked **Job/Client** column matching the Current Title/Employer pattern (job title primary line, client name muted sub-line + verified shield). Billing Contact column removed from the Hired stage. Typography normalized to one-bold-element-per-row (candidate name only); job title dropped its `font-medium`; date/location/salary cells normalized to one metadata size (Last Action bumped `text-xs`→`text-sm`, Start Date colors aligned). Placement Fee percent font preserved per spec. The My Pipeline owner selector was sized down (`py-1` + `text-[13px]`) to match the stage-tab pill height. colSpans updated everywhere (main empty-state 7→6 LEFT cols, intake 10/9→9/8, Hired RIGHT 3→2). Applies to the main table and the intake tables via the shared `UniformLeftRowCells`.

- **RF vocabulary scrub.** Cosmetic, user-facing RF-string renames were completed; dead/legacy columns and shim fields were left in place (no schema churn). The deeper structural RF items were catalogued, not executed — the headline bucket-C finding is the live two-profile split on the candidate profile (see Next Task below), deliberately left untouched this session so it can get its own focused migration.

## What Shipped in Ace 67.20 (2026-05-28)

Batch 7 — UI polish, two cosmetic items. No schema changes, no query changes, no tenant-scope impact (className-only edits inside two existing components).

- **Interview scheduler Type joins the Date+time/Time zone/Duration row** (`src/app/candidates/[id]/local-placement-rows.tsx`, `ScheduleFields` at line 1914). Step-0 grep confirmed `ScheduleFields` is the live Ace-native helper used by the schedule flow (called from line 1093); `placement-flows.tsx` has the same field set but is dead RF code per the dual-file rule. The Type field was rendering on its own full-width line below the time-related row (`<label className="block text-sm">` with `mt-1 w-full` on the select), which left ~50% empty space to the right of the selected value. Moved the Type label inside the existing `flex flex-wrap items-end gap-3` row alongside Duration. Constrained the Type wrapper to `w-36` so the dropdown is just wide enough to fit "Phone Screen" (the longest of the three options: Phone Screen / Video / In-Person) plus the native chevron, with a touch of right whitespace. Time zone (w-32) and the compact DurationSelect keep their existing widths; Date & time still flex-grows via `min-w-[16rem] flex-1`.

- **Guarantee Period row height matches the placements ledger** (`src/components/placements/guarantee-period-table.tsx`). Step-0 grep showed both tables already use `py-1.5` on their td cells — same padding. The visual height delta came from content shape, not padding: `placements-ledger.tsx:309-313` renders the Client column as a two-line cell (`clientName` + `clientIndustry` sub-line at `text-[11px]`), giving each ledger row ~38px of total height. Guarantee Period rows are single-line everywhere, so the same `py-1.5` produced ~25px rows. Per spec ("padding only — do not change data or columns") I left the columns/content alone and bumped every td in the guarantee-period tbody from `py-1.5` to `py-3` (12px each side = 24px padding; with a ~13px single line, total ~37px ≈ the ledger's 38px). Header padding stays at `py-1.5` so the column-header strip still aligns visually between the two tables.

Touches (2 source files): `src/app/candidates/[id]/local-placement-rows.tsx`, `src/components/placements/guarantee-period-table.tsx`.

Tenant-scope check: no queries touched. `placements-dashboard.ts` (placements ledger source) and `guarantee-period-utils.ts` (guarantee row source) are unchanged. Rule 8 surface unaffected.

Build clean (`npm run build` exits 0; only the two pre-existing react-hooks/exhaustive-deps warnings, unrelated).

Andrew browser-verify (after deploy):
1. Open a candidate → click Schedule Interview → confirm Date & time, Time zone, Duration, and Type now sit on the same row. The Type dropdown should be visibly tighter (no large empty band to the right of the selected value). Switching Type to In-Person still reveals the Address field on its own row underneath.
2. Open the Placements page → eye-compare a Guarantee Period row against an All Placements This Quarter row directly below it. They should look like the same vertical "block size" without the prior squat-vs-tall mismatch.

## What Shipped in Ace 67.19 (2026-05-28)

Batch 6 — Cancel Placement. Step-0 grep flipped the brief's data-model premise before any edit landed: there is no `PlacementStatus` enum in `prisma/schema.prisma` (Placement.stage is a free-string column), `cancelPlacement` already existed at `src/app/candidates/[id]/placement-actions.ts:965` with a tenant-scope hole and narrow revalidation, and `/placements` is not a real route (only `revalidatePlacementSurfaces` keeps trying to revalidate it). Decisions confirmed before code: keep string `"cancelled"` on `stage` (matches every existing call site — no migration), harden the existing action in place, land the toggle on `/pipeline`, sweep only the queries that don't already whitelist active stages, and unblock cancelled candidates in the Game Plan matched-rows guards.

- **`cancelPlacement` hardened in place** (`src/app/candidates/[id]/placement-actions.ts`). The lookup now does `findFirst({ where: { id, organizationId: org.id } })` so a stray cuid from another tenant returns "Placement not found." (Rule 8 fix). Revalidation swapped from the old `revalidatePath('/candidates/{rfId}') + revalidatePath('/pipeline')` pair to `revalidatePlacementSurfaces(input.placementId, org.id)` so cancel busts `/dashboard`, `/placements`, `/pipeline`, `/finances`, plus the specific candidate + client pages (placements ledger, scoreboard KPIs, placement map, guarantee period table, financial performance tab — every surface a placement edit can move).

- **`getPlacementsForOrg` default-excludes cancelled rows** (`src/lib/placements.ts`). New `includeCancelled?: boolean` opt (default false). When `stages` is passed the caller is explicit and we respect it; otherwise we AND `stage: { not: "cancelled" }` onto the where clause. Three callers opt back in: `/candidates/[id]` and `/local-profile` keep cancelled rows visible so the candidate profile keeps rendering the cancellation history pill; `/pipeline` opts in so the Show Cancelled toggle has rows to show.

- **Query sweep — 8 surfaces gained explicit cancelled filters.** `src/app/clients/page.tsx` (per-client groupBy), `src/app/clients/[id]/page.tsx` (counts.hired strip + per-job row counters), `src/app/dashboard/my-dashboard.tsx` (Offers Extended + Placements Made KPIs), `src/app/dashboard/goal-pacing.tsx` (YTD placements count), `src/app/api/dashboard/placement-drilldown/route.ts` (cash_collected, client, and role branches), `src/app/api/jobs/search-candidates/route.ts` (re-applicability — cancelled candidates can be re-applied to the same job), `src/app/api/game-plan/find-matches/route.ts` + `src/app/api/game-plan/matched-candidates/route.ts` (cancelled candidates are eligible for re-sourcing). Surfaces that already whitelist active stages via `stage: { in: [...] }` (`src/lib/placements-dashboard.ts`, `src/app/dashboard/scoreboard-data.ts`, `src/app/dashboard/financial-performance-tab.tsx`, `src/lib/billing-events.ts`) needed no edit — they already exclude cancelled implicitly.

- **`/pipeline` Show Cancelled toggle** (`src/app/pipeline/page.tsx`, `src/app/pipeline/pipeline-view.tsx`). Local UI state (not URL-persisted). Adds `cancelled` to the Stage type + STAGE_ORDER so the strip can address a Cancelled tab. The tab is hidden by default; the checkbox next to the OwnerScopeSelect lights it up. When the recruiter is currently on `?stage=cancelled` and turns the toggle off, the page routes them back to `?stage=submitted` so the strip never strands them. `counts.cancelled` is computed from `scopedRows` (after owner-scope filter) so the badge respects Mine / Theirs / All consistently with the other stages.

- **Cancel placement button in Edit Placement modal** (`src/app/candidates/[id]/local-placement-rows.tsx`). Ace-native path only — placement-flows.tsx's RF cancel UI was unreachable per the dual-file rule. Button sits below the Notes textarea, red outlined `rounded-md` (explicitly not `rounded-full`), shown only when `editing && !job.placementId.startsWith('local-applied-')` so a fresh Make Placement can't cancel a non-existent row. Click fires `window.confirm("Cancel this placement? This cannot be undone.")` then `cancelPlacement({ placementId, reason: 'other', detail: '' })`. Success toast points the recruiter at the Show Cancelled toggle for re-finding the row. Independent `useTransition` from Save so the destructive button can't fire concurrently.

Touches (12 source files): `src/app/candidates/[id]/placement-actions.ts`, `src/lib/placements.ts`, `src/app/candidates/[id]/page.tsx`, `src/app/candidates/[id]/local-profile.tsx`, `src/app/clients/page.tsx`, `src/app/clients/[id]/page.tsx`, `src/app/dashboard/my-dashboard.tsx`, `src/app/dashboard/goal-pacing.tsx`, `src/app/api/dashboard/placement-drilldown/route.ts`, `src/app/api/jobs/search-candidates/route.ts`, `src/app/api/game-plan/find-matches/route.ts`, `src/app/api/game-plan/matched-candidates/route.ts`, `src/app/pipeline/page.tsx`, `src/app/pipeline/pipeline-view.tsx`, `src/app/candidates/[id]/local-placement-rows.tsx`.

Build clean (`npm run build` exits 0; only the two pre-existing react-hooks/exhaustive-deps warnings, unrelated).

Andrew browser-verify (after deploy):
1. Open a Hired or Pending Start placement → Edit Placement → confirm a red "Cancel placement" button is visible at the bottom. Click → confirm dialog → OK → toast confirms cancellation. Row disappears from the placements ledger, dashboard KPIs, placement map, guarantee period table, client overview hired count, and the Hired pipeline tab.
2. On `/pipeline`, check the "Show Cancelled" checkbox above the search bar → a Cancelled tab appears at the right end of the strip with the cancelled row's count. Click into it → the cancelled row renders there. Uncheck the toggle while on the Cancelled tab → routed back to Submitted, Cancelled tab hidden.
3. Re-apply the cancelled candidate to the same job from the candidate profile → succeeds (search-candidates no longer treats the cancelled row as an active block). On the Game Plan matched-candidates view, the cancelled candidate is eligible to be re-sourced for the same job.

Regression check:
- Tenant-scope: every new query is scoped by `organizationId` (Rule 8). `cancelPlacement` lookup converted from `findUnique({ id })` to `findFirst({ id, organizationId })`.
- Active-stage surfaces (placements ledger, scoreboard, financial performance, billing events) needed no edit — already filter via stage IN.
- `/pipeline` performance: `getPlacementsForOrg({ includeCancelled: true })` returns the same row count as before (the helper used to include everything by default); the in-loop cancel handling is the only logic change.
- candidate profile: cancellation reason / detail still renders against cancelled rows via `cancelReasonByPlacement` (line 448) — both `/candidates/[id]/page.tsx` and `/local-profile.tsx` opt back into cancelled rows.

## What Shipped in Ace 67.18 (2026-05-27)

Batch 3 Item B regression closed — Placements ledger flipped from "Invoice Draft" to "Invoice Sent" after the recruiter actually clicks Send inside the floating invoice composer.

**Root cause (caught on a Step-0 trace, no code changed until Andrew confirmed):** The invoice page has two distinct "Send" paths. `handleSend` (wired to the "Mark as sent" button at `invoice-detail.tsx:524`) calls `markInvoiceSentAction` and flips DRAFT → SENT in Neon. `handleEmailDraft` (wired to the "Draft Email" button AND auto-fired by the Confirm-Start `?compose=1` hand-off) opens the floating Gmail composer via `composer.open(...)` but never touched the Invoice row. The MailComposer's send handler emitted email through Gmail and called the composer's `onSent` callback — but `handleEmailDraft` never passed an `onSent`. Result: the email went out, the Invoice stayed `DRAFT` in Neon, and the Placements ledger correctly displayed "Invoice Draft" against that unchanged DB state. Not a deriveBillingStatus bug, not a revalidatePath bug, not a denormalized-column bug — a missing callback wire on a single composer.open call.

- **`handleEmailDraft` in `src/app/invoices/[id]/invoice-detail.tsx` now passes `onSent` to `composer.open({...})`.** The callback awaits `markInvoiceSentAction(props.id!)` → `router.refresh()` on success or `setError(r.error)` on failure. `props.id` is non-null at the call site (guarded by the early-return at line 274). The composer-manager already wires `onSent` through to the MailComposer (`src/lib/composer-manager.tsx:69, 120`), and the MailComposer only fires it after Gmail confirms the send — so a Cancel/X close leaves the invoice as DRAFT for a follow-up Send.

- **`markInvoiceSentAction` is the same action `handleSend` uses**, so the DB flip semantics are identical (DRAFT → SENT, stamps `sentAt`, clears `isFuture`), and `revalidateInvoiceSurfaces` (added Ace 67.14) already refreshes `/invoices`, `/invoices/[id]`, `/dashboard`, `/pipeline`, `/finances`, and the specific `/candidates/[id]` + `/clients/[id]` routes the invoice is linked to — no parallel revalidation list to maintain.

Touches (1 source file): `src/app/invoices/[id]/invoice-detail.tsx` — six new lines inside an existing `composer.open(...)` call.

Build clean (`npm run build` exits 0; only the two pre-existing react-hooks/exhaustive-deps warnings, unrelated).

Andrew browser-verify (3 steps, after deploy):
1. Confirm Start a fresh placement → invoice composer auto-pops → click Send → toast confirms email sent → navigate to the dashboard placements ledger → row reads **"Invoice Sent"** (not "Invoice Draft").
2. Same on the `/pipeline` Hired tab → invoice pill flips to "Sent" without a manual refresh.
3. Open a draft invoice → click the "Draft Email" button → cancel out of the composer with X → return to the placements ledger → row still reads "Invoice Draft" (no premature flip on aborted compose).

Regression check (per Andrew's brief, verified in code):
- "Mark as sent" button path (`handleSend`) unchanged — still calls `markInvoiceSentAction` directly, still works independently of the composer path.
- Composer closed without sending (X / Cancel) → `onSent` never fires → Invoice stays DRAFT in Neon → ledger keeps reading "Invoice Draft" as intended.
- Sending the email via the composer → DRAFT → SENT → ledger reflects "Invoice Sent" on next render across every status-bearing surface (covered by the existing `revalidateInvoiceSurfaces` helper from 67.14).

## What Shipped in Ace 67.17 (2026-05-27)

LocalPlacementDialog correction ship — Ace 67.12 (Make Placement X-only close + Lead Source dropdown + required) and 67.15 (Make Placement modal density pass) were both applied to the wrong file (`placement-flows.tsx` PlacementDialog, RF flow). Since RecruiterFlow is removed per rule 1, the recruiter actually opens `LocalPlacementDialog` in `src/app/candidates/[id]/local-placement-rows.tsx` (line 1365). Andrew's screenshot showed the prior layout intact on prod because none of those changes ever reached the right modal. Audit triggered by his "did you miss anything else?" prompt — answer was yes, 67.12 + 67.15 both. This ship re-applies them to the correct file, plus adds the drag/resize parity he asked for in the same prompt.

- **`LocalPlacementDialog` ModalShell now passes `dismissOnOverlay={false}`, `draggable`, `resizable`** — matches the OfferDialog precedent from 67.10/67.11. Backdrop click and Escape are inert; X / Cancel are the only close paths. Header drags via the same `useDraggableResizable` hook the OfferDialog uses; bottom-right corner resizes between MODAL_MIN_W/MIN_H and 90vw/90vh.
- **Lead Source converted from free-text `<OfferField>` to a `<select>`** sourced from `LEAD_SOURCES` (`src/lib/lead-sources.ts`) — the same canonical list the RF PlacementDialog, the pipeline placement-edit-drawer, and the Financial Performance By Source widget all read. Disabled placeholder ("Select a source…"), `required` + `aria-required="true"`, and a legacy-value preservation pass so existing placements with free-text sources like "Pin" / "Apollo BD" / "Cold Outreach" reopen with the saved value still selected.
- **`onSave` validate now blocks blank Lead Source** with `"Lead Source is required."` — the existing red error banner above the footer surfaces it like every other validation miss.
- **Density pass on the same modal:**
  - Lead Source moved into the main 7-field grid (now an 8-field 2-col grid using `gap-x-3 gap-y-2`).
  - Fee summary card hoisted ABOVE billing/hiring (was at the bottom of the modal — now sits right after the field grid). Re-laid as a single horizontal row: label + breakdown left, big total right. Drops `p-3 text-2xl` to `px-3 py-2 text-xl`.
  - Billing contact + Hiring manager cards placed side-by-side via `grid-cols-1 sm:grid-cols-2` (each card `px-3 py-2`). Was `sm:col-span-2` on each card (stacked full-width); now ~140px combined instead of ~280px.
  - Notes textarea `rows={3}` → `rows={2}`.
  - Helper copy on Billing/Hiring section descriptions tightened to single-line phrasing.

Combined effect: ~250–300px shaved off total modal height. Fee summary card is now visible above the fold on first open on a 13" laptop, AND the modal is draggable + resizable so Andrew can move it off whatever it sits on top of.

Touches (1 source file): `src/app/candidates/[id]/local-placement-rows.tsx`. New import: `LEAD_SOURCES` from `@/lib/lead-sources`. Build clean (`npm run build` exits 0; only the two pre-existing react-hooks/exhaustive-deps warnings, unrelated).

Audit follow-up: every UX change from 67.10 onward has been cross-checked against both files. 67.10 OfferDialog dismiss + 67.11 OfferDialog drag/resize both shipped to RF AND Ace-native (placement-flows.tsx OfferDialog + local-placement-rows.tsx LocalOfferDialog). 67.8 Offer popup constraints shipped to both. ConfirmStartDialog is an exported shared component used by both flows, so 67.7 Confirm-Start → composer pop worked on both. Only the Make Placement modal had a parallel implementation that was missed in 67.12 + 67.15.

Open question for Andrew (raised after this ship): `placement-flows.tsx` is RF-flavored code per rule 1's "RecruiterFlow is removed." Worth scheduling its removal (or stub-out) so future UX changes can't end up in the wrong file again? Will raise as a separate next-up after browser-verify.

Andrew browser-verify (6 steps, after deploy lands):
1. Open Make Placement on an offer-stage candidate. Click outside the modal → modal stays open. Press Escape → stays open. Click X → closes.
2. Grab the title-bar area and drag the modal across the screen → modal moves with the cursor and stops cleanly on release.
3. Drag the bottom-right corner → modal resizes between the min (480x400) and 90vw/90vh.
4. Lead Source field is a dropdown showing Network / Referral / LinkedIn / Inbound / Indeed / Other with a disabled "Select a source…" placeholder. Try to save with Lead Source on the placeholder → red error banner "Lead Source is required." and save blocks.
5. Fee summary card (left label + big total on the right) visible without scrolling on first open.
6. Billing contact + Hiring manager render side-by-side as two columns; Notes textarea is shorter (2 rows).

Regression: Existing placements with legacy candidateSource strings ("Pin", "Apollo BD", "Cold Outreach") still reopen with that value pre-selected via the fallback option. recordLocalPlacement server action unchanged. Confirm Start, Reject, Reapply, Schedule Interview, Edit Interview, Extend Offer modals all untouched.

## What Shipped in Ace 67.16 (2026-05-27)

Calendar display follow-up for the per-party interview invite model.

- **Both Google invite copies now render as Interviews inside Ace.** `/calendar` now builds a map from active `Interview.googleEventIdMine/client/candidate` values to the owning `Interview.id`. Any Google `CalendarEvent` row whose event id belongs to an active Interview renders with `type: "interview"` even if the Google title looks like a generic event (for example the candidate-facing "You're confirmed..." title).
- **Clubhouse This Week collapses client/candidate invite copies to one logical interview.** The widget keeps the existing Google-event dedupe, then additionally collapses all CalendarEvent rows that map to the same `Interview.id`. It prefers the row whose title/type already reads like an interview, then sorts the final list by start time. Result: two real Google events can exist on Andrew's calendar, but the Clubhouse widget shows one interview row.

Touches: `src/app/calendar/page.tsx`, `src/app/dashboard/this-week-widget.tsx`. Build clean (`npm run build` exits 0; only the two pre-existing react-hooks/exhaustive-deps warnings in `mail-view.tsx` + `event-drawer.tsx`, unrelated).

Andrew browser-verify: after scheduling and sending both candidate + client invites, `/calendar` should show both blocks as Interview-colored/labeled events. Clubhouse This Week should show only one row/chip for that interview.

## What Shipped in Ace 67.15 (2026-05-27)

Two visual-density fixes — recruiter screenshot showed (a) Pipeline columns scrolling sideways on a 13" laptop and (b) the Make Placement modal forcing a scroll just to see the fee summary.

- **Pipeline + recruiter-facing list tables tightened to fit a 13" laptop.** Cell padding dropped from `px-4 py-3` to `px-3 py-2` across the body cells in `src/app/pipeline/pipeline-view.tsx` (24 hits, replace_all). Checkbox columns dropped from `px-3 py-3` to `px-2 py-2` (3 hits). Table `min-w-[820px]` → `min-w-[720px]` on the active-stage table and `min-w-[900px]` → `min-w-[820px]` on the Applicants/Kept/Rejected table so the Hired tab's 7 columns + optional checkbox slot inside a ~960px usable viewport without horizontal scroll. Shared `DataTableHeaderCell` in `src/components/ui/data-table.tsx` got the same `px-3 py-2` update so headers stay vertically aligned with the new body rows — this cross-cuts into Jobs / Candidates / Applicants / Clients list pages too per the shared component's "centralize tweaks in one file instead of five" comment. Andrew confirmed this scope on AskUserQuestion before the edit landed.
- **Make Placement modal compressed so the fee summary sits above the fold.** Three changes inside `PlacementDialog` in `src/app/candidates/[id]/placement-flows.tsx`:
  1. Brand-tint client-default banner from `p-3 text-xs` to `px-2.5 py-1.5 text-[11px]` (~30px saved).
  2. Fee summary card re-laid as a single horizontal row (label + breakdown on the left, total on the right) instead of a three-line vertical stack — drops `text-2xl` to `text-xl`, drops `p-3` to `px-3 py-2`, ~40px saved.
  3. Biggest win: Billing contacts + Hiring managers sections placed side-by-side via a `grid-cols-1 sm:grid-cols-2` wrapper. Previously stacked vertically (~280px combined) → now ~140px on `sm:` viewports and up, falling back to a single stack on narrow screens. Section headers, "Add" button labels, and inter-row spacing all tightened in parallel.
  
  Combined effect: ~150–200px shaved off total modal height. On a 13" laptop the fee summary now sits inside the visible viewport on first open instead of forcing a scroll to find it. Custom Payment Agreement collapsed-header margin/padding also dropped from `mt-5 pt-5` to `mt-4 pt-4` so the bottom of the modal doesn't have stale breathing room.

Touches (3 source files):
- `src/app/pipeline/pipeline-view.tsx` (body cell padding + table min-widths)
- `src/components/ui/data-table.tsx` (shared `DataTableHeaderCell` padding)
- `src/app/candidates/[id]/placement-flows.tsx` (PlacementDialog banner + fee summary + Billing/Hiring side-by-side + tightened section margins)

Build clean (`npm run build` exits 0; only the two pre-existing react-hooks/exhaustive-deps warnings in `mail-view.tsx` + `event-drawer.tsx`, unrelated).

Andrew browser-verify (5 steps):
1. Go to `/pipeline` Hired tab on a 13" laptop. All columns (Candidate / Job / Salary / Fee / Start Date / Billing Contact / Invoicing) visible without horizontal scroll.
2. Same check on Submitted / Interviewing / Offer / Pending Start tabs.
3. Other list pages (Jobs / Candidates / Applicants / Clients): row heights slightly tighter, headers still vertically aligned with body rows.
4. Open Make Placement on an offer-stage candidate. The fee summary card (left-label + total on the right) visible without scrolling on a 13" laptop.
5. Billing contacts + Hiring managers visible side-by-side as two columns instead of stacked vertically.

Regression: No data-shape changes. Existing Pipeline / Jobs / Candidates / Applicants / Clients table contents render identically (only paddings shrunk). PlacementDialog field set / save behavior unchanged — Lead Source still required (from 67.12), dismissOnOverlay still false (from 67.12), all input handlers wired the same way. Custom Payment Agreement still collapsed by default, opens with the same field set. On narrow / mobile viewports the Billing+Hiring 2-col grid falls back to single-column stack so nothing crowds.

## What Shipped in Ace 67.14 (2026-05-27)

Confirm Start → Invoice flow hardening — two of the three items in the brief; Item A skipped after Step 0 grep showed the Confirm-Start → invoice-composer hand-off was already shipped earlier today (placement-flows.tsx:2386-2396 navigates to `/invoices/[id]?compose=1`; invoice-detail.tsx:374-386 consumes the param and auto-fires `handleEmailDraft()`). Andrew confirmed he was seeing stale prod (per the `live-deploy-diverges-from-repo` memory); no Item-A code change needed.

- **Invoice mark-status actions revalidate every status-bearing surface.** `src/app/invoices/actions.ts` now routes `markInvoiceSentAction`, `markInvoicePaidAction`, and `markInvoiceVoidAction` through a single `revalidateInvoiceSurfaces(id, orgId)` helper. The helper unconditionally invalidates `/invoices`, `/invoices/[id]`, `/dashboard`, `/pipeline`, and `/finances`, then looks up `Invoice.{candidateId, clientId, placementId}` org-scoped and invalidates the specific `/candidates/[id]` + `/clients/[id]` dynamic routes (falls back to `revalidatePath("/candidates/[id]", "page")` / `("/clients/[id]", "page")` when those fields are null or the lookup throws). Closes the bug where the Pipeline Hired tab pill and per-client placements list kept reading the prior status until manual navigation.
- **New billing status: `INVOICE_DRAFT`.** Single-invoice placements no longer fall through to `"PENDING_START"` after `confirmStart` fires. New union member in `src/lib/placements-dashboard.ts` PlacementsDashboardBillingStatus; `deriveBillingStatus` single-invoice branch now returns `"INVOICE_DRAFT"` when `latest.status === "DRAFT"`. Same fix mirrored in the standalone `deriveBillingStatus` copy inside `src/app/api/dashboard/placement-drilldown/route.ts` so the drilldown dialog and the dashboard ledger never disagree on what a post-confirmStart-pre-send row looks like.
- **`BILLED` + `INVOICED` both display as "Invoice Sent".** Per Andrew's call on the second batch question — the recruiter shouldn't have to track single-vs-split-payment as separate terminology. The underlying enum values stay distinct so split-payment-only logic (`PARTIALLY_PAID` resolution, future-invoice ordering, guarantee-period inclusion) keeps the signal it needs; only the display label, filter tab label, and pill tone change. New `"Invoice Draft"` filter tab + slate chip slots between Pending Start and Invoice Sent in the ledger. Pipeline hired tab's own `InvoiceStatusPill` (`pipeline-view.tsx:930`) is left alone per Andrew's call — that pill renders raw Invoice.status with "Draft" / "Sent" / "Paid" / "No invoice" labels.
- **Guarantee-period table includes `INVOICE_DRAFT` rows.** `src/app/dashboard/placements-tab.tsx` `toGuaranteeRows` previously gated on `BILLED | COLLECTED | INVOICED | PARTIALLY_PAID`; added `INVOICE_DRAFT` so a placement whose draft invoice hasn't been sent yet still appears in the live guarantee-window countdown (confirmStart has fired, so the candidate is in their guarantee window).

Touches (8 source files):
- `src/app/invoices/actions.ts` (`revalidateInvoiceSurfaces` helper + wired into 3 mark-status actions)
- `src/lib/placements-dashboard.ts` (`PlacementsDashboardBillingStatus` union + `deriveBillingStatus` DRAFT branch)
- `src/lib/placements-map-geo.ts` (`STATUS_COLORS`, `STATUS_LABELS`, `dominantStatus` order, `aggregateByCity` statusMix initializer)
- `src/components/placements/placements-ledger.tsx` (`FILTERS`, `STATUS_LABEL`, `STATUS_PILL`, `counts` initializer)
- `src/components/placements/placements-map-card.tsx` (`STATUS_ORDER`)
- `src/app/dashboard/placements-tab.tsx` (`toGuaranteeRows` inclusion list)
- `src/app/api/dashboard/placement-drilldown/route.ts` (`DrilldownRow.billingStatus` union + local `deriveBillingStatus` DRAFT branch)
- `src/components/dashboard/placement-drilldown-dialog.tsx` (`STATUS_LABEL`, `STATUS_PILL` — caught on a second sweep; the dialog has its own maps independent of the ledger and would have rendered `undefined` for INVOICE_DRAFT rows without this)

Build clean (`npm run build` exits 0; only the two pre-existing react-hooks/exhaustive-deps warnings, unrelated). Note: a parallel Andrew session shipped Ace 67.13 (interview-invite restoration) while this work was in flight; my code base rebased cleanly onto that ship (different files), no merge conflicts.

Item A skipped on Andrew's call after AskUserQuestion surfaced that the Confirm-Start → composer auto-pop is already wired in main (shipped in an earlier session today, dated 2026-05-27 in source comments). The live deploy on ace.breakpointtalent.com had not picked up that ship yet — same pattern as the `live-deploy-diverges-from-repo` memory. No code change needed; once the next Vercel deploy lands, Andrew should see Confirm Start route him to `/invoices/[id]` with the composer auto-popping.

Andrew browser-verify (after deploy lands — 8 steps):
1. Confirm Start a pending-start placement → land on `/invoices/[id]` → invoice email composer pops automatically with the invoice PDF attached. (Item A — should already be live or land on next deploy.)
2. Click Send on the invoice draft → toast confirms send.
3. Go to `/pipeline` Hired tab → invoice-status pill on that row reads "Sent" (not "Draft" or "No invoice").
4. Go to the dashboard placements ledger → row's billing pill reads "Invoice Sent".
5. Open the candidate's profile (`/candidates/[id]`) → pipeline rows reflect the new status without a hard refresh.
6. Confirm Start a fresh placement → before clicking Send anywhere, navigate to the dashboard placements ledger → that row reads "Invoice Draft" (not "Pending Start").
7. The new "Invoice Draft" filter tab on the ledger has a count of ≥1 and clicking it shows the row.
8. Mark an existing invoice as Paid from `/invoices/[id]` → /pipeline + dashboard + the client's `/clients/[id]` page all reflect the COLLECTED / "Paid" status without a refresh.

Regression: Existing placements at any status (PENDING_START / BILLED / INVOICED / COLLECTED / OVERDUE / PARTIALLY_PAID) still render with their existing pill — only the BILLED and INVOICED labels swapped from "Billed" / "Invoiced" to "Invoice Sent". `markInvoiceSentAction` still actually flips the row to SENT (the existing `markInvoiceSent` helper call is unchanged; only the post-success revalidations expanded). Confirm Start still records the start date and creates the DRAFT invoice. Pipeline Hired tab still renders every hired placement — INVOICE_DRAFT is purely additive on the ledger surface and doesn't filter rows out anywhere. `InvoiceStatusPill` on `/pipeline` left alone per Andrew's scope call.

## What Shipped in Ace 67.13 (2026-05-27)

Interview invite model restored to Andrew's intended workflow, plus schedule-modal polish.

- **Client and candidate now get separate Google Calendar invite events again.** `sendInterviewInvite` no longer appends both parties to one shared event. The first invite reuses the organizer-only tracking event created by `scheduleInterview`; the second invite creates its own Google event and attaches the same Meet conference data when the interview uses Google Meet. Each party event keeps its own subject/body, so the candidate invite body no longer overwrites the client invite body (or vice versa). Existing old shared rows are handled defensively: if both per-party columns point at the same Google event, a resend/edit for either party routes back through the create path and splits that party into a distinct event.
- **Client-scheduled stays tracking-only.** The "Client will send invite" branch still creates a single no-attendee tracking event on Andrew's calendar and skips both client/candidate invite composers. No candidate/client email is sent from Ace in that branch.
- **Invite edits respect per-party privacy.** `updateInterview` still patches date/time/location across all related Google events, but new interviewer attendees are only added to the client-side invite event. Candidate invite events stay candidate-only.
- **Stale cancelled interview rows are filtered even when Google never replays the cancellation.** The Calendar page and Clubhouse This Week widget now exclude `CalendarEvent` rows whose Google event id belongs to a cancelled `Interview` in the same date window. This covers the existing Jennifer Cole duplicate where the old `CalendarEvent` row was still `CONFIRMED` locally.
- **Schedule/edit/reschedule interview modals no longer close on backdrop click and now opt into drag/resize.** The modals use the Ace 67.11 shared `useDraggableResizable` hook with `dismissOnOverlay={false}`, so X/Cancel still close, the header drags cleanly, and the bottom-right resize handle uses the same pointer-capture release behavior as the offer modal.
- **Dark-mode time dropdown contrast fixed.** The selected 15-minute time option now uses Court brand tint with `text-court-brand-dark`, so selected times are readable in dark mode.

Touches: `src/app/candidates/[id]/interview-actions.ts`, `src/lib/google-calendar.ts`, `src/app/dashboard/interview-invite-actions.ts`, `src/app/dashboard/this-week-widget.tsx`, `src/app/calendar/page.tsx`, `src/components/datetime-15-picker.tsx`, `src/app/candidates/[id]/local-placement-rows.tsx`, `src/app/candidates/[id]/placement-flows.tsx`. Build clean (`npm run build` exits 0; only the existing react-hooks/exhaustive-deps warnings in `mail-view.tsx` and `event-drawer.tsx`).

Regression check for Andrew: schedule a fresh Ace-scheduled video interview from the candidate profile/pipeline pill, send the candidate invite, then send the client invite. Google Calendar should show two events at the same time, one per party, with separate descriptions and the same Meet. Then use "Client will send invite" and confirm it creates one tracking event only, with no invite emails. Confirm the Jennifer duplicate is gone from the Clubhouse widget after deploy. Confirm the schedule modal stays open on outside click, can be dragged by its header, can be resized, and the time dropdown selected row is readable in dark mode.

## What Shipped in Ace 67.12 (2026-05-27)

Make Placement modal hardening — two of the three items in the original brief; Item C dropped after Step 0 grep showed the picker pattern was already richer than the Edit Placement drawer's (the drawer has no billing/hiring picker at all).

- **PlacementDialog locks to X-only close.** `placement-flows.tsx:1741` now passes `dismissOnOverlay={false}` to the `Modal` wrapper, matching the OfferDialog precedent at `:1327`. Backdrop click + Escape press both inert; Cancel button + X are the only paths out. The dialog collects accepted salary, fee math, billing/hiring contacts, custom payment terms, and now a required Lead Source — a reflexive Escape can't be allowed to throw that work away. No other modal consumer is touched (Confirm Start, Reject, Reapply, Edit Interview, Apply/Submit to Job, Cancel Placement, Extend Offer keep their backdrop-click-to-close behavior). Comment in source ties this to the OfferDialog ship in 67.10.
- **Lead Source is required on save.** The dropdown already exists (`placement-flows.tsx:1867-1898`, sourced from `src/lib/lead-sources.ts` which is also imported by `placement-edit-drawer.tsx:13` so the two screens cannot drift). Two changes: (1) the leading `<option value="">—</option>` is now `<option value="" disabled>Select a source…</option>` plus the `<select>` has `required` + `aria-required="true"`, so the browser can't auto-fall-through to "Network" on an unselected state; (2) `validate()` at `placement-flows.tsx:1646-1649` returns `"Lead Source is required."` when `leadSource.trim()` is empty, so the existing red error banner above ModalFooter surfaces it like every other validation miss. All six `LEAD_SOURCES` entries (Network / Referral / LinkedIn / Inbound / Indeed / Other) stay — the legacy-value preservation pass below the canonical list still renders any saved string ("Pin", "Apollo BD", "Cold Outreach") so existing placements reopen with their source pre-selected.

Touches: `src/app/candidates/[id]/placement-flows.tsx`. Build clean (`npm run build` exits 0; no new errors or warnings).

Item C dropped on the user's call after Step 0 grep contradicted the brief's premise: the Make Placement modal already had a multi-row billing/hiring contact list with one-click chip auto-fill from `job.clientContacts` (`placement-flows.tsx:1903-2048`) AND name+email datalist suggestions; the Edit Placement drawer (`src/app/pipeline/placement-edit-drawer.tsx`) has NO billing/hiring picker at all. The brief's "copy the Edit Placement pattern" was inverted — Make Placement is the richer screen, not the simpler one. Confirmed scope reduction to two items via AskUserQuestion before any edit.

Andrew browser-verify (5 steps, none I could run from this env):
1. Open Make Placement on an offer-stage row. Click the dim overlay outside the dialog → modal stays open.
2. Press Escape → modal stays open.
3. Click the X → modal closes.
4. Open Make Placement. Lead Source field shows "Select a source…" as a disabled placeholder, then Network / Referral / LinkedIn / Inbound / Indeed / Other.
5. Try to save with Lead Source left on the placeholder → red error banner reads "Lead Source is required." and the save is blocked. Pick a source → save proceeds.

Regression: Existing placements with `candidateSource` set still reopen with that value pre-selected (including legacy values like "Pin" or "Apollo BD" via the preservation pass). Billing/Hiring multi-contact list + chip auto-fill UNTOUCHED — the existing richer picker survives. Custom Payment Agreement section UNTOUCHED. Edit Placement drawer at `/pipeline` UNTOUCHED. Submit path (`recordPlacement`) field set UNCHANGED — no new required server-side fields beyond what the client-side validate() now blocks. Financial Performance "By Source" widget reads whatever `candidateSource` was saved, so the require-on-save change only affects rows created from 67.12 onwards.

## What Shipped in Ace 67.11 (2026-05-27)

Offer modal drag/resize + pipeline pagination removal + Edit-Offer-chip verification.

- **Offer modal is draggable + resizable.** New shared hook `src/lib/use-draggable-resizable.ts` exposes pointer-capture-based drag (translate3d from the centered flex slot) and bottom-right corner resize (inline width/height overriding the default `max-w-lg` cap). Min 480x400, max 90vw/90vh. Both `Modal` (`placement-flows.tsx:3977`) and `ModalShell` (`local-placement-rows.tsx:1837`) gained opt-in `draggable?: boolean` / `resizable?: boolean` props (default false). Both `OfferDialog` instances pass both `true`. Every other modal consumer (Confirm Start, Reject, Reapply, Edit Interview, Apply/Submit to Job, Cancel Placement, Extend Offer, Make Placement, Local Placement, Local Confirm Start — 13 in total) leaves them false and renders identically to 67.10. setPointerCapture + onLostPointerCapture + onPointerCancel cover the clean-release guarantee even if the pointer leaves the window. The `dismissOnOverlay={false}` lock from 67.10 stays — header pointer events don't propagate to the overlay's onClick.
- **Pagination footer dropped from every pipeline tab.** `<Pagination>` JSX + `total / page / totalPages / pageSize` props + the `PAGE_SIZE = 25` slice in `pipeline/page.tsx` are gone. Applicants / Kept / Submitted / Interviewing / Offer / Pending Start / Hired all render the full filtered set and grow downward. `?page=` URL param is no longer parsed (passing it is harmless — it's just ignored). The shared `src/components/pagination.tsx` component stays alive (still used by `/candidates`, `/jobs`, `/clients`). The Matched candidates pager on `/jobs/[id]` (`pipeline-summary.tsx:373`) is a separate feature and was not touched.
- **Edit Offer chip on /pipeline — verified, no code change.** Step 0 grep confirmed the chip already exists at `pipeline-view.tsx:731-740` gated on `r.bucket === "offer"`, deep-linking `?edit=offer&jobId=NN`. Both deep-link handlers are wired: RF at `placement-flows.tsx:638-652`, Ace-native at `local-placement-rows.tsx:361-375` (both shipped in commit `093ed75`, Ace 67.8). If the chip looked missing on prod, the cause is Vercel deploy lag (per the `live-deploy-diverges-from-repo` memory), not a code bug.

Touches: `src/lib/use-draggable-resizable.ts` (new), `src/app/candidates/[id]/placement-flows.tsx`, `src/app/candidates/[id]/local-placement-rows.tsx`, `src/app/pipeline/page.tsx`, `src/app/pipeline/pipeline-view.tsx`. Build clean (`npm run build` exits 0; only the same two pre-existing react-hooks/exhaustive-deps warnings).

Andrew browser-verify (10 steps, none I could run from this env):
1. Open offer modal. Click and hold the header. Drag across the screen. Release. Modal stays put where released. No drift, no flicker.
2. Open offer modal. Grab the bottom-right corner. Resize bigger and smaller. Release. No lag, no continued resize after release.
3. Open offer modal. Drag fast and release. Modal stops the frame the pointer releases.
4. Open offer modal. Click overlay outside. Modal stays open (regression check on 67.10 ship).
5. Open a non-offer modal (e.g. Reject). Header is NOT draggable. No resize handle in corner.
6. Go to /pipeline. Find an offer-stage row. Edit Offer chip visible on the right next to Placement and Reject.
7. Click Edit Offer on /pipeline. Modal opens prefilled with the existing offer values.
8. Go to /pipeline. Applicants, Kept, Submitted, Interviewing, Pending Start, Hired tabs: "Showing 1-1 of N submittals" + Prev/Next gone from every one.
9. Go to /jobs/[id] (single-job pipeline buckets). No regression — Matched tab pager (separate feature) still works.
10. /candidates, /jobs, /clients — pagination still intact (shared component untouched).

Regression: Existing OfferDialog open/close/save still works; X-only close survives; `dismissOnOverlay={false}` survives; the other 13 modals are non-draggable and non-resizable; list rendering at 50+ rows works (no LIMIT/OFFSET to break); Edit Offer on candidate page still works.

## What Shipped in Ace 67.10 (2026-05-27)

Offer modal hardening — three asks on the Make Offer / Edit Offer popup.

- **Modal closes only via the X.** Both `OfferDialog` components (`placement-flows.tsx:1161` RF + `local-placement-rows.tsx:1166` Ace-native) now pass `dismissOnOverlay={false}` to their respective shells. The shells gained the new prop with default `true` so every other consumer (Confirm Start, Reject, Reapply, Edit Interview, Apply/Submit to Job, Cancel Placement, Extend Offer, Make Placement, …) keeps its existing backdrop-click-to-close behavior. When `false`: the outer backdrop `onClick` becomes `(e) => e.stopPropagation()` (swallows the click without calling `onClose`) and a capture-phase window `keydown` listener swallows `Escape` so the lock survives any future Radix Dialog ancestor.
- **No numeric placeholders on the four offer fields.** Stripped the `e.g. 120000 or 120k` salary placeholder, the `25` Fee % placeholder, the `20000 (optional)` Min fee placeholder, and the `7500 (wins over salary × fee %)` Fee amount placeholder on BOTH OfferDialog instances. New text-only ghost prompts: `Enter amount`, `Enter percent`, `Optional`, `Optional flat amount`. Fresh Make Offer on a client with `feePct = null` now renders all four fields visually empty. Editing an existing offer still prefills from `placement?.*` snapshot; fee % auto-fill from `client.feePct` is untouched (still seeded at `placement-flows.tsx:1186` + `local-placement-rows.tsx:1196`).
- **USD is inert chrome.** `LabeledField` (`editable-helpers.tsx`) and `OfferField` (`local-placement-rows.tsx`) both gained an optional `suffix?: ReactNode` prop. When set, the wrapping `<label>` is replaced with a `<div>` plus a sibling `<label htmlFor={useId()}>` so the native "click anywhere in the label forwards focus to the input" no longer fires when the user clicks on the suffix. The suffix span itself has `pointer-events-none select-none cursor-default aria-hidden="true"`. The salary label is now plain "Offered salary" with a "USD" suffix sitting inside the same input frame on the right edge. `Placement.offerCurrency` / `acceptedCurrency` still write `"USD"` on every save — column not dropped, server still defaults to `"USD"` if `currency` is falsy.

Touches: `src/app/candidates/[id]/editable-helpers.tsx`, `src/app/candidates/[id]/placement-flows.tsx`, `src/app/candidates/[id]/local-placement-rows.tsx`. Build clean (`npm run build` exits 0; only existing unrelated react-hooks/exhaustive-deps warnings).

Andrew browser-verify (6 steps, none I could run from this env):
1. Open Make Offer. Click the dim overlay outside the dialog → modal stays open.
2. Press Escape → modal stays open.
3. Click the X → modal closes.
4. Open Make Offer for a candidate whose client has `feePct = null` → all four fields visually empty.
5. Open Edit Offer on a placement with stored values → real values prefill (salary, fee %, min fee, fee amount).
6. Click "USD" next to the salary field → no focus shift, no selection, no typing affects USD; the cursor does NOT jump into the salary input from a USD click (sibling-label structure breaks the forward).

Regression: Save still works for new + edit flows; existing offers in any pipeline stage still load with stored values; X still closes; previous-ship negative-salary / negative-fee-% input + submit + server checks all still fire.

## What Shipped in Ace 67.9 (2026-05-27)

Interview calendar duplicate/update behavior — three bugs the Jennifer Cole reschedule surfaced.

- **Stale CalendarEvent rows now sync on cancel/reschedule/update.** `cancelInterview`, `rescheduleInterview`, and `updateInterview` in `src/app/candidates/[id]/interview-actions.ts` now write the matching `CalendarEvent` mirror rows immediately after the Google PATCH/DELETE — `status=CANCELLED` on cancel, new `startTime/endTime/location/status=CONFIRMED` on reschedule + update. Scoped by `organizationId + googleEventId IN (...)` with a best-effort try/catch (the next on-demand sync is the safety net). Previously the local mirror only refreshed when `syncGoogleCalendars` next ran, so a cancelled Google event left a `CONFIRMED` row that kept rendering on the Clubhouse / This Week widget alongside any replacement interview. New helpers `markLocalCalendarEventsCancelled` + `updateLocalCalendarEventsTime` live in the same file (server-action module, so no extra exports). `revalidateForCandidate` also revalidates `/calendar` now.
- **Google sync no longer skips cancelled events.** `src/lib/calendar/google-sync.ts` was hard-skipping any event with `status === "cancelled"` from the Google API. That left orphan rows the cancel-flow couldn't reach (event id not in the Interview row). The sync now upserts those into the local table with `status=CANCELLED, syncedAt=now()` so any cancelled Google event eventually falls out of the widget + `/calendar` queries (both filter `status: { not: "CANCELLED" }`).
- **`sendInterviewInvite` only sets summary/description on the first send.** Previously every send PATCHed `event.summary + event.description` from the per-party composer body — so sending the candidate invite overwrote the client-facing description that Austin already received, and Google mailed every prior attendee a confusing "this event was updated" notification with the candidate-targeted text. Now: if neither `googleEventIdClient` nor `googleEventIdCandidate` is set (first invite), the composer subject/body still flows into `event.summary/description`. On subsequent sends those fields are omitted and only the new attendee is appended via `updateEventAsInvite` (which now accepts optional summary/description and short-circuits no-op PATCHes that would have no new attendee AND no header changes). Per-party composer messaging that needs to differ between client and candidate should land via Gmail/templates as a follow-up; the shared calendar event keeps the neutral first-send body.
- **Widget dedupe defense.** New shared helper `src/lib/calendar/dedupe.ts` collapses CalendarEvent rows by `googleEventId` and a `title|start|end|meetLink` fallback (for the cross-calendar case where Google mints distinct event ids for the same invite — `iCalUID` mirror is a TODO that would replace the fallback). `this-week-widget.tsx` runs Andrew-scoped rows through this helper before rendering, so the worst-case effect of any remaining mirror drift is one row per logical interview instead of two.

Touches: `src/lib/google-calendar.ts`, `src/app/candidates/[id]/interview-actions.ts`, `src/lib/calendar/google-sync.ts`, `src/app/dashboard/this-week-widget.tsx`, `src/lib/calendar/dedupe.ts` (new). Build clean (`npm run build` exits 0; only existing react-hooks/exhaustive-deps warnings unrelated to this change).

Regression check: schedule an interview, send client invite, send candidate invite, edit/reschedule once, cancel/recreate if needed. Confirm Google Calendar shows one current event, Clubhouse + This Week show one row per interview, Austin no longer receives a candidate-facing description on the second invite, cancelled events disappear from Ace immediately. Open follow-up: store Google `iCalUID` on `CalendarEvent` + a `prisma db push` migration, then prefer iCalUID over the title/start/end/meetLink fallback in the dedupe helper.

## What Shipped in Ace 67.8 (2026-05-27)

Three asks shipped together — all on the offer popup + pipeline offer stage.

- **Offer popup field constraints.** Negative numbers are now blocked on the Offered salary and Fee % inputs at three layers: (1) input-layer — the salary `onChange` strips any `-` before reaching state; the fee % field is a `NumericField` with `min={0}` that ignores out-of-range strokes; (2) submit-side — `OfferDialog.onSave` returns the existing `"Salary can't be negative."` / `"Fee percentage can't be negative."` errors before calling the server; (3) server-side — `recordOffer` (RF) and `recordLocalOffer` (Ace-native) reject `salary < 0` / `feePercentage < 0` with a clear error message so the dialog's checks can't be bypassed. The Currency dropdown was removed from the UI entirely — USD is the only allowed value, displayed as a static `($USD)` suffix on the salary label. The `currency` state is kept as a `const "USD"` so the save payload still writes `offerCurrency` / `acceptedCurrency = "USD"` to the DB; the column is **not** removed.
- **Fee % auto-fill from client agreement — verified.** The existing seed at `placement-flows.tsx:1159` (`seedFeePct = job.placement?.feePercentage ?? job.clientFeePct ?? null`) already prefills the fee % from the client's `feePct` when present, and leaves the field blank when null. Every read feeding `clientFeePct` is tenant-scoped by `organizationId`: `getRfClientsForOrg` (`src/lib/candidates.ts:363-366`), `getRfJobsForOrg` (`src/lib/candidates.ts:292-296`), `getPlacementsForOrg` (`src/lib/placements.ts:42-43`), plus the direct `prisma.client.findMany({ where: { organizationId } })` in `candidates/[id]/page.tsx:367-370`. No code change needed — verify-only per Andrew's clarification.
- **Edit Offer button on /pipeline offer-stage rows.** New chip in the pipeline offer-stage action column at `pipeline-view.tsx:718`, anchor-shaped twin of `<Button variant="secondary">` (border-court-border + bg-court-surface-subtle + text-court-fg). Reads as neutral grayish, distinct from the green Placement chip beside it and the red Reject after it — matches Andrew's "grayish, match color coding" spec. Deep-links to `/candidates/${id}?edit=offer&jobId=NN`, which is handled by two new `useEffect`s (one in `placement-flows.tsx` for RF rows, one in `local-placement-rows.tsx` for Ace-native rows) that find the matching offer-stage job, call `setOfferFor(target)`, and strip the params via `router.replace` so refreshes don't re-fire. Save updates the existing Placement row via the same `recordOffer` / `recordLocalOffer` upsert that the original offer used — no duplicate row created. The Ace-native `OfferDialog` (which previously seeded every field with `""`) now seeds from `job.placement?.*` so Edit Offer opens with the saved values prefilled instead of a blank form. The button only renders inside the `r.bucket === "offer"` block, so it never appears on sourced / applied / submitted / interviewing / pending_start / hired rows.

Touches: `src/app/candidates/[id]/placement-flows.tsx`, `src/app/candidates/[id]/local-placement-rows.tsx`, `src/app/candidates/[id]/placement-actions.ts`, `src/app/candidates/[id]/local-placement-actions.ts`, `src/app/pipeline/pipeline-view.tsx`. Build clean.

Next task: Andrew browser-verifies — (1) salary / fee % inputs reject negatives at input + submit; (2) currency dropdown is gone, `($USD)` shows on the salary label; (3) offer popup opens with fee % prefilled for clients whose `feePct` is set and blank otherwise; (4) Edit Offer chip on offer-stage rows opens the popup with existing values, save updates the same Placement row (`SELECT COUNT(*) FROM "Placement" WHERE id = X` identical before/after); (5) Edit Offer never appears on rows outside the offer stage. Regression: existing offers in other stages still load + edit; the Make Placement flow downstream of save still ingests salary / fee values; `offerCurrency` / `acceptedCurrency` continue to read/write "USD" for both new and existing rows.

## What Shipped in Ace 67.7 (2026-05-27)

Three asks from Andrew rolled into one ship: invoice email subject uses the candidate's full name; trigger-edit modal overlap fixed; Confirm Start now hands off to the invoice email composer + the new "Invoice Email" template + "Confirmed Start: Invoice Draft" trigger are seeded into Settings.

- **Invoice subject reads "first + last name placement."** `src/app/invoices/[id]/invoice-detail.tsx` switched from the last-name-only "Cole placement" form to the full `${candidateFullName} placement` form so a client opening multiple invoices can tell candidates apart at a glance. Falls back to a bare "placement" clause if the placement somehow has no candidate name on file.
- **Edit-trigger modal layout fix.** The read-only event-identity card was a `sm:grid-cols-3` with 4 cells, so the long `candidate_applied_confirmation` trigger key bled into the Event column. Layout is now `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` and the code value gets `break-all` so an extra-long key wraps instead of overlapping. `Meta` cells gained `min-w-0` so children truncate cleanly inside the grid. Trigger key + Event + Audience + Dispatch stay read-only this prompt (changing the key would silently desync from the code call-site that fires it).
- **`confirmed_start_invoice` trigger registered.** New constant in `template-constants.ts` + a `TRIGGER_OPTIONS` entry with `dispatch: "compose-prefill"` and `audience: "client"` so it shows up in Settings → Templates + Triggers immediately. Recruiter can pin a template or pause the auto-pop from there.
- **"Invoice Email" template seeded.** New `CONFIRMED_START_INVOICE_DEFAULT` in `templates-actions.ts` flows through `ensureDefaultTemplates` (which already runs on every settings-page load), so the row appears in Settings → Templates as a `category: "invoice"` template with merge-field-style body: `[Client Contact First Name]`, `[Candidate Full Name]`, `[Job Title]`, `[Client Company Name]`, `[Start Date]`. The seed is idempotent against the trigger key.
- **Confirm Start hands off to the composer.** `confirmStart` now captures the just-created invoice id from both `createInvoiceForPlacement` (non-custom-terms path) and `createDraftInvoiceAction` (custom installment-1 path) and returns it in `ConfirmStartResult.invoiceId`. `ConfirmStartDialog.onSave` routes the recruiter to `/invoices/[invoiceId]?compose=1` on success instead of `router.refresh()`. The invoice page reads the `compose` param with `useSearchParams`, fires `handleEmailDraft` once on mount behind a `useRef` re-fire guard, then strips the param via `router.replace` so a back/forward or hard refresh doesn't re-pop the composer.

### Known follow-up (NOT shipped this prompt)
The seeded "Invoice Email" template body is **visible and editable in Settings → Templates** but **does not yet drive the actual send**. The composer body comes from the literal in `invoice-detail.tsx#handleEmailDraft` (with the first+last subject fix applied). To wire the DB template into the send path properly, a follow-up needs to:
1. Add `[Invoice Number]`, `[Fee Amount]`, `[Invoice Due Date]` to the merge-field system (`src/lib/merge-fields.ts` + `src/lib/merge-context.ts`).
2. Fetch the active `confirmed_start_invoice` template in the invoice page's server component, apply merges, pass merged subject + body to `<InvoiceDetail>` as props.
3. Have `handleEmailDraft` consume those props, fall back to the hardcoded literal when the template row is missing/deleted.

Touches: `src/app/invoices/[id]/invoice-detail.tsx`, `src/app/settings/triggers-view.tsx`, `src/app/settings/template-constants.ts`, `src/app/settings/templates-actions.ts`, `src/app/candidates/[id]/placement-actions.ts`, `src/app/candidates/[id]/placement-flows.tsx`. Build clean.

Next task: Andrew browser-verifies — (1) Settings → Templates shows "Invoice Email" + Settings → Triggers shows "Confirmed Start: Invoice Draft" with dispatch "compose-prefill"; (2) the edit-trigger modal no longer has overlapping columns; (3) Confirm Start on a placement immediately routes to /invoices/[id] with the invoice email composer already open; (4) the composer subject reads "Invoice from BreakPoint Talent - [first] [last] placement (INV-####)". Regression: existing Confirm Start side-effects (Hired stage flip, candidate welcome trigger, RF sync, custom-terms installments + reminders) all still fire from `confirmStart`; the only behavior change is the navigation target on success.

## What Shipped in Ace 67.6 (2026-05-27)

Reading-pane chrome follow-up after Andrew's 67.5 screenshot review — the long subject line was getting truncated and the action toolbar was eating subject-row width.

- **Subject row is now subject only.** `ThreadDetail`'s top row dropped the Reply / Reply All / Forward / 3-dot buttons. The `<h2>` lost its `truncate` and gained `break-words` + `leading-snug` so a long subject (e.g. "Invoice from BreakPoint Talent - Cole placement (INV-1053)") wraps to a second line instead of getting cut off at "Cole plac...".
- **Thread-level toolbar moved into the latest message's header card.** New `headerActions` prop on `MessageBlock` accepts the Reply / Reply All / Forward / 3-dot node from `ThreadDetail` and renders it in the top-right of the latest message's header — the slot the message timestamp used to occupy. Older messages still get the per-message `onAction` buttons in the same slot, so the two paths never duplicate chrome.
- **Timestamp moved to the right of Cc.** The To/Cc metadata row inside the header card now also carries the timestamp, right-aligned on the same line as To/Cc. The metadata row's render condition expanded to `(to || cc || dateIso)` so a message with no recipients still surfaces its timestamp.

Touches: `src/app/mail/mail-view.tsx`, `src/components/mail/message-block.tsx`. Build clean.

Next task: Andrew browser-verifies — confirm the full Cole-placement subject is visible (no `...` truncation), Reply / Reply All / Forward / 3-dot sit in the top-right of the AK header card, and `5/27/2026, 2:59:31 PM` is to the right of `Cc Austin@breakpointtalent.com` on the same metadata line. Regression: per-message action buttons on older messages in a multi-message thread, floating-window title bar actions, attachment download, thread collapse.

## What Shipped in Ace 67.5 (2026-05-27)

Mail reading-pane redesign — Andrew's screenshot-driven pass on the right-pane chrome to make the conversation header read like a native mail client.

- **Subject + actions on one row.** `ThreadDetail`'s top bar now puts the subject (large, bold, `font-serif text-lg`) on the left and Reply / Reply All / Forward + a single overflow button on the right, all on the same line. The old "subject + message-count stacked over a wrapped row of six buttons" layout is gone.
- **3-dot overflow menu replaces four visible buttons.** Archive, Mark Unread, Move to label, and Pop out collapsed into a new `ThreadActionsMenu` component behind a `MoreHorizontal` trigger. Move-to-label expands inline within the same dropdown via a chevron toggle so labeling stays one click-target.
- **Message header is now an avatar card.** `MessageBlock`'s expanded header is wrapped in a rounded card (border + subtle shadow) above the email body. Layout: avatar/initials circle (Court brand-tint background) on the left, sender name bold + sender email muted directly underneath, timestamp far right. New `SenderAvatar` component derives initials from `fromName` first, then the local part of `fromEmail`.
- **To/Cc metadata row below a divider.** The card carries a separator under the avatar row and a metadata row showing `To <addr>` and `Cc <addr>` with bold field labels. Sender email + To + Cc are all visible without any hover or expand interaction.
- **Thread row active state is soft green.** The center-column selected row now reads `bg-court-brand-tint` (the same brand-tint token used on the unread counter pill) instead of `bg-court-accent-tint/60`. Hover dropped to `bg-court-surface-subtle` so it visually contrasts with selection. All changes use Court Mode tokens — no hardcoded hex per CLAUDE.md rule 12.

Touches: `src/app/mail/mail-view.tsx`, `src/components/mail/message-block.tsx`. Build clean.

Next task: Andrew browser-verifies on `/mail` — confirm subject + action row read clean, the 3-dot menu opens with Archive/Mark Unread/Move to label/Pop out, message header card shows avatar + name + email + timestamp + To/Cc row, and the selected thread row is soft-green. Regression: confirm Reply, Reply All, Forward, Archive, Mark Unread, Move to label, Pop out, thread collapse, attachment download all still work.

## What Shipped in Ace 67.4 (2026-05-27)

Gmail-native signature logo fix after the phone-icon pass exposed that Gmail was still holding a stale black-background BreakPoint logo in its SendAs signature settings.

- **Push to Gmail now uses compact public image URLs.** The Gmail settings action renders the signature with the hosted `SignatureAssetUrls` asset set instead of base64 data URIs, keeping the HTML under Gmail's 10,000-character SendAs limit. Ace-sent and copied signatures still use inline base64 artwork for normal email-client reliability.
- **White logo is explicit for Gmail settings.** The Gmail hosted asset set now points the logo at `/brand/breakpoint_logo_signature.png`, the white-background signature mark, rather than the older black-background brand asset.
- **Gmail was repaired live.** Andrew's primary SendAs signature (`andrew@breakpointtalent.com`) was updated with the compact white-logo HTML so new Gmail-composed test emails should show the correct white-background BreakPoint logo immediately.

Next task: Andrew should send one fresh Gmail.com test email after deploy/refresh and confirm the signature logo is white-background, with the updated phone icon still crisp.

## What Shipped in Ace 67.3 (2026-05-27)

PWA push notification self-heal for mobile installs where browser permission stayed granted but the underlying PushSubscription expired after idle/app close, making Settings > Connectors show Enable notifications again.

- **Granted push subscriptions now repair on launch.** New `src/lib/push-client.ts` centralizes the client-side VAPID key conversion, `/api/push/subscribe` POST, manual subscribe call, and granted-permission sync. `<SwRegister />` now re-posts the existing subscription on every app launch and, when permission is already granted but the browser subscription is missing, recreates it automatically without making Andrew tap Enable again.
- **Settings button uses the same repair path.** `PushPermissionButton` now runs the granted-permission sync when it mounts, so Settings reflects the repaired state instead of drifting back to the Enable button after iOS PWA subscription expiry.
- **Explicit Disable is honored.** The device writes a local intent flag when Enable or Disable is clicked. Disable stores `disabled` and unsubscribes any lingering browser subscription so the launch self-heal does not immediately turn notifications back on after Andrew intentionally turns them off.
- **Race guard added.** The shared helper dedupes simultaneous repair attempts from global app registration and the Settings row, avoiding double-subscribe races on the same launch.

Next task: Andrew should verify on the installed mobile PWA after deploy: open Ace, confirm Push Notifications stays CONNECTED/Disable in Settings > Connectors, then leave the PWA closed/idle and confirm it no longer repeatedly flips back to Enable notifications.

## What Shipped in Ace 67.2 (2026-05-26)

Three small UX/polish fixes: the email-signature phone icon redrawn into
an actually-recognizable handset, the left sidebar nav reordered into
Andrew's preferred workflow order, and the weather popover's hourly strip
made horizontally scrollable so it can show past 6 hours.

- **Email-signature phone icon → recognizable handset.** The phone icon
  next to Andrew's phone number in the signature used to draw as a pair
  of outlined rectangles connected by a 1-px diagonal (came out reading
  as a key or pager, not a phone). Redrew `makePhone()` in
  `scripts/generate-signature-icons.js` as a tilted-handset silhouette:
  rounded ~4×4 earpiece bulb upper-left, mirror mouthpiece bulb
  lower-right, thin 1-px diagonal handle joining them. Regenerated the
  PNGs in `public/brand/` + the base64-baked constants in
  `src/lib/signature-icons.ts` (the only constants the signature
  renderer reads at runtime, since Vercel serverless can't fs-read
  `/public`). Email + globe icons untouched.
- **Left sidebar nav reorder.** Andrew's preferred workflow order
  (no alphabet rule):
    - Home — Clubhouse
    - Communication — Mail → Phone → Calendar
    - ATS — Pipeline → Candidates → Jobs
    - CRM — BD → Clients
    - Ops — Finances → Notes
    - Scoreboard — Placements → Metrics
    - Settings + profile card pinned at bottom (unchanged).
  Calendar moved out of Ops into Communication so all three inbox-style
  surfaces sit together. Jobs moved out of CRM into ATS so it lives
  beside Pipeline + Candidates where it's actually used. Placements
  now leads Scoreboard (it's the dollar headline). Both `sidebar.tsx`
  and `mobile-nav.tsx` updated in lockstep — the mobile drawer mirrors
  the desktop sidebar per the comment in mobile-nav.tsx.
- **Weather hourly strip → horizontally scrollable.** Bumped
  `HOURS_AHEAD` from 6 to 24 in `weather-widget.tsx` and converted the
  hourly strip from `flex justify-between` (six equal columns) to
  `flex gap-1 overflow-x-auto` with fixed-width `w-9 shrink-0` cells.
  First ~6 columns fit inside the popover's `w-72` footprint at the
  cell's natural width; the rest reveal as the recruiter scrolls right.
  Added a `.weather-hourly-scroll` utility in `globals.css` that hides
  the native scrollbar (Chromium/Safari/Firefox) so the strip reads as
  a clean row of chips while staying mouse-wheel / touchpad / drag
  scrollable. Daily forecast + current chip untouched. Strip header
  updates dynamically: "Next 24 Hours" instead of "Next 6 Hours".

## What Shipped in Ace 67.1 (2026-05-26)

Ace-native candidate-profile job-pill polish: action buttons shrunk to chip
size, an Extend Offer affordance added at the interviewing stage with a new
local recordLocalOffer server action, the standalone "Client Sending Invite"
button folded into the schedule modal as a "Client will send invite"
checkbox, and the Keep button reskinned to cyan so it stops reading as the
INTERVIEWING stage badge sitting beside it.

- **Smaller job-pill action buttons.** Every chip on the candidate-profile
  job pill (Submit / Edit Interview / Schedule Interview / Reject / Reapply
  + the new Extend Offer) now renders at `px-2 py-0.5 text-[11px] gap-1`
  via a shared `CHIP_BTN_CLS` override on each size="sm" Button. Visually
  closer to the stage-badge chips (`px-2 py-0.5 text-[10px]`) the row
  carries beside them, so the pill reads as a uniform row of chips instead
  of a stack of full-size action buttons.
- **Extend Offer at interviewing.** New chip-style "Extend Offer" button
  surfaces on the job pill when stage === "interviewing", mirroring the
  Pipeline-board Offer action. Opens a local OfferDialog (salary /
  currency / title / start date / fee % / min fee / flat-fee override /
  notes) wired to a new `recordLocalOffer` server action — it keys the
  Placement update off `placementId` (rather than the RF
  `candidateRfId_jobRfId` upsert key) because Ace-native rows carry
  `candidateRfId: null`. Auto-fires the OFFER_EXTENDED trigger by
  `candidateId` (cuid), parity with the RF recordOffer path.
- **Client Sending Invite button removed; folded into ScheduleDialog as a
  checkbox.** The standalone "Client Sending Invite" chip on the job pill
  is gone (along with `ClientInviteDialog`, `clientInviteFor` state, the
  `onClientInvite` prop, and the CalendarPlus import). In its place,
  ScheduleDialog gains a "Client will send invite" checkbox below the
  form: when checked, scheduling routes through `source="client_scheduled"`
  (Interview row + calendar sync + activity log still write, recruiter
  gets credit) and skips the candidate/client invite composers — no
  emails go out. The Open-Meeting + Cc/Bcc fields are suppressed in that
  branch since they only ride on outbound invite emails.
- **Extend Offer Button variant.** New `offer` variant in `button.tsx`
  (purple) matching the OFFER stage badge + the Pipeline-row Offer tone
  so the new Extend Offer chip reads as the same intent wherever it
  lands.
- **Keep button → cyan.** The `keep` Button variant used to share the
  `schedule` variant's blue-50 wash, which read as the INTERVIEWING stage
  badge (also blue-50) sitting beside it on the candidate-profile job
  pill. Pulled `keep` off the shared wash and onto cyan-50 / cyan-700 /
  cyan-200 (dark: cyan-950/40 / cyan-200 / cyan-900) so the Keep button
  stays in the blue family but reads as a distinctly different hue from
  INTERVIEWING. Applies everywhere the Keep button surfaces
  (KeepCandidateButton, matches-tab x2, pipeline-row-actions x2,
  pipeline-view).

## What Shipped in Ace 67.0 (2026-05-26)

ATS consolidation: the standalone /applicants page was folded into /pipeline as the first two stage tabs so a candidate is followed from intake through hired without leaving the surface.

- **Pipeline gains Applicants + Kept tabs (b144ad2).** Stage strip is now Applicants → Kept → Submitted → Interviewing → Offer → Pending Start → Hired so it reads in the chronological order a candidate moves through it. Submit / Keep / Reject (Applicants) and Submit / Remove (Kept) row actions carried over from the old /applicants page; bulk Reject works on both new tabs.
- **Owner scope + deep-links extended.** The Mine / Theirs / All dropdown now scopes Applicants + Kept the same way it scopes the main stages, and the ?clientId / ?jobId deep-links emitted from client/job stat pills now also filter the two new tabs.
- **/applicants page deleted; nav cleaned up.** Sidebar ATS group is now Candidates → Pipeline (the User lucide import dropped with it). mobile-nav and top-bar-page-title /applicants entries removed. candidate-profile-nav legacy "applicants" snapshot source routes to /pipeline?stage=applied so older sessionStorage entries still land somewhere.
- **Server-action cleanup.** /app/applicants/actions.ts moved to /app/pipeline/applicants-actions.ts with revalidatePath('/applicants') retargeted to /pipeline. setApplicantStatus dropped (dead code). 9 redundant revalidatePath('/applicants') calls stripped from candidate-side placement-actions / local-placement-actions — each was already paired with a /pipeline revalidation.

## What Shipped in Ace 66.0 (2026-05-23)

A full UI-polish session: the input field treatment pass landed the `court-input-frame` / `court-input-rect` system, the Liquid Glass pass added translucency to floating surfaces, the New Job page was restructured, and a long sweep of dark-mode button fixes, Court Mode token migrations, and list-page / table polish shipped across the app.

- **Input field treatment pass.** New shared input system in `globals.css`: `court-input-frame` (pill wrapper with surface fill, border, and a focus-within glow + 1px lift) and `court-input-control` (transparent inner field), paired via `INPUT_FRAME_CLASS` / `INPUT_CONTROL_CLASS`, plus `court-input-rect` for the squared `0.75rem` variant. Pill on the search bar, SMS composer, and Ace Assistant; rectangular on the forms (New Candidate / New Job / settings / inline editable fields). Iterations along the way: removed an early backdrop-blur for a cleaner solid fill, wrapped the tokens in `rgb()`, tuned the frame fill to be subtle-but-visible across all Court Modes, and removed a green tint that showed in light mode.
- **Liquid Glass floating-surface pass.** Targeted translucency on floating surfaces only - topbar, dropdowns, popovers, and modals got `backdrop-blur` + glass shadow stacks. Heavier panel glow added to the Ace Assistant / YouTube / briefing tiles, and the YouTube panel tabs moved onto TabStrip. Not a full-app conversion - floating surfaces only.
- **New Job page restructure.** Rebuilt into two numbered section cards (Add Job Description / Job Details), a TabStrip for the URL-vs-file source toggle, a "Save to Ace" primary CTA, and uniform dropdowns. The numbered badges render as dark-fill green rings (not solid green discs). Header lifted to the top of the page (removed extra top padding) to match Applicants / New Candidate, and the New Candidate two-column layout was evened up so both columns end on the same line.
- **Dark-mode button fixes.** Invoice page buttons converted to outlined style in dark mode (Mark as sent / paid green outlined, Delete draft / Void red outlined, Draft Email differentiated blue); note Add/Save buttons set to solid theme-aware `bg-court-brand` green matching the Create job CTA; plus call / connector / amber-banner dark-mode fixes. Textarea corners squared to match the rect input frame.
- **Court Mode token migration on the candidate flow.** The New Candidate page moved off hardcoded styling onto Court Mode tokens (matching the clients page), with a dark-mode card fix, rect inputs on the form, and a lengthened Notes textarea so the right card bottom aligns with the left column.
- **Theme-toggle iframe re-skin.** Court Mode now listens for `storage` events so embedded iframes (e.g. the candidate resume split-view) re-skin immediately on a theme toggle instead of staying on the old palette until reload.
- **List-page + table polish.** Table header rows on pipeline / applicants / jobs made visually distinct from body rows (`bg-court-surface` + a bottom border). Client cards got a resting + hover shadow/lift, and the "X clients / X verified" footer row was removed. Pipeline + jobs search restyled to the clean clients-page style (rounded input, icon inside, no green fill or submit button), kept on both pages.
- **Settings + chrome polish.** Uniform Save buttons across the settings pages (personal info, branding, billing, BD limits) - outlined green with a floppy-disk icon, matching the BD Engine "Save targeting" button. The "My contact info" floating panel got the YouTube-panel glass treatment (`bg-court-surface/90` + `backdrop-blur-md` + the matching shadow stack).
- **Infra / deploy fixes (this session).** Removed the GitHub Actions "Smoke tests" workflow plus its orphaned Playwright config, specs, seed script, and screenshot fixtures - it had exhausted the month's free Actions minutes (2000/2000) and was failing in ~4s on every push, which gated Vercel and froze production at `b38deba` (the last green commit). Changed the `scheduled-send` Vercel cron from every minute (`* * * * *`) to every 5 minutes (`*/5 * * * *`) after the Vercel Pro upgrade - Send Later still fires within 5 minutes and cron invocations drop ~5x, with `BATCH_SIZE` left at 25 (fine for a solo recruiter). Excluded the PWA assets (`/sw.js`, `/manifest.json`, `/icons`, `/offline`, brand marks) from the auth middleware matcher so the installed PWA's service worker can update on an expired session instead of getting 307'd to the sign-in HTML - a redirected service-worker script is rejected by the browser, the same reason `/pdfjs` is already excluded.

## What Shipped in Session (2026-05-27) - Test Run Fix List

Andrew and Austin ran a live test session and flagged 18 items. This session closed Batches 1-4b.

- **Offer popup constraints**: no negative salary or fee %, USD hardcoded as static label (column still writes "USD"), currency dropdown removed. Both OfferDialog instances (RF + Ace-native).
- **Offer modal: closes only on X** (`dismissOnOverlay={false}` + Escape blocked). New `dismissOnOverlay` prop on `Modal`/`ModalShell`, default `true` so 11 other modal consumers keep existing behavior.
- **Offer modal: numeric placeholder values removed** (replaced with text placeholders). USD rendered as inert chrome (`pointer-events-none`, `select-none`).
- **Offer modal: draggable by header, resizable from bottom-right corner** (480x400 min, 90vw x 90vh max). Clean pointer-event release via `setPointerCapture` / `releasePointerCapture`. Opt-in via `draggable` / `resizable` props on `Modal` / `ModalShell`, default `false`.
- **Offer modal fee % auto-fill**: existing seed at `placement-flows.tsx:1197` (`job.placement?.feePercentage ?? job.clientFeePct ?? null`) verified tenant-scoped. `Client.feePct` backfilled from `raw.custom_fields` for RF-imported clients (`scripts/backfill-client-feepct.ts`). `candidates/[id]/page.tsx` now falls back to `extractFeePct(customFields)` when `client.feePct` is null. Ace-native OfferDialog and LocalPlacementDialog both wired to `snap?.feePercentage ?? job?.clientFeePct ?? null`.
- **Edit Offer button**: added to pipeline offer-stage rows in `pipeline-view.tsx` (grayish neutral outlined, `rounded-md`). Deep-links to `/candidates/<id>?edit=offer&jobId=NN`. Also on candidate profile job pill (was already there). Gated to offer stage only.
- **Pipeline pagination removed**: "Showing X-X of N submittals" footer + Prev/N/Next buttons removed from all pipeline tabs (Applicants, Kept, Submitted, Interviewing, Pending Start, Hired) and `/jobs/[id]/pipeline`. Lists grow downward. Non-pipeline pagination untouched.
- **Make Placement modal** (`LocalPlacementDialog` in `local-placement-rows.tsx`): `dismissOnOverlay={false}`, Lead Source converted to dropdown sourced from `LEAD_SOURCES` constant (Network/Referral/LinkedIn/Inbound/Indeed/Other), required validation added. Note: earlier ships (67.12, 67.15) accidentally edited the wrong file (`placement-flows.tsx` RF path). 67.17 fixed on the correct file. Dual-file trap lesson added as architecture non-negotiable 14.
- **Invoice flow**: new `revalidateInvoiceSurfaces(id, orgId)` helper invalidates `/invoices`, `/invoices/[id]`, `/dashboard`, `/pipeline`, `/finances`, `/candidates/[id]`, `/clients/[id]` on `markInvoiceSentAction`, `markInvoicePaidAction`, `markInvoiceVoidAction`. New `INVOICE_DRAFT` billing status (`deriveBillingStatus` maps DRAFT -> INVOICE_DRAFT). BILLED + INVOICED display as "Invoice Sent". INVOICE_DRAFT displays as "Invoice Draft" (slate chip). Pipeline `InvoiceStatusPill` left unchanged (separate surface). Guarantee-period table now includes INVOICE_DRAFT rows.
- **Invoice send regression fix**: `handleEmailDraft` in `invoice-detail.tsx` now passes `onSent` callback to `composer.open()` so Gmail composer send flips `Invoice.status` DRAFT->SENT in Neon and fires revalidation. Previously the composer sent the email but never updated the DB.
- **Post-placement disconnect fix** (Jennifer/Sheehan root cause): `Placement.clientId` was null for all 11 RF-imported placements because `getRfJobsForOrg` was gating `_aceClientId` on `legacyRfId == null` (excluded RF-imported clients). Fixed in `src/lib/candidates.ts` - `_aceClientId` now stamped whenever `r.client.id` exists regardless of `legacyRfId`. Backfill script (`scripts/backfill-placement-clientid.ts`) ran live: 11 found, 11 updated. `Springfield, OH` added to `CITY_COORDS` in `placements-map-geo.ts`. `cityFromJob()` fallback added (Job.locationCity -> Job.locations[0]) for RF-imported placements with sparse Client.location.

Next task: Batch 5 - metric refresh. Two items: (1) editing a placement does not trigger Momentum or Recent Deal Moves refresh on the dashboard (Ethan Larocca case), and (2) the Offer-to-Start <=14d count did not update after a same-day placement+start (Jennifer Cole, placed and started 2026-05-27, <=14d still reads 0). Likely a revalidatePath gap on the edit/confirm server actions.

## What Shipped in Ace 67.0-67.1 (pre-test-run session, Newest Ace chat)

Pipeline + candidate profile polish pass.

- **Job pill button sizing**: Apply to Job, Kept, and Add to List buttons resized to match Profile/Game Plan/Notes tab button size. Applied across all candidate profile render paths (full profile, split view, pipeline access, search access).
- **Extend Offer renamed to "Offer"** everywhere it appears.
- **Extend Offer gated to INTERVIEWING stage only** (was showing on other stages).
- **Client Sending Invite button removed** from the Schedule Interview flow.
- **"Client will send invite" checkbox** now skips the invite email screens and just logs the interview on the calendar/activity log.
- **Keep button color changed to cyan** (`cyan-50` / `cyan-700` / `cyan-200`) to distinguish from the blue INTERVIEWING badge.

## What Shipped in Ace 66.0 (2026-05-23 to 2026-05-25)

iOS-style input field pass, Liquid Glass floating-surface pass, forms sweep, custom installment invoice automation, and permanent roadmap kills.

- **Input field treatment**: `court-input-frame` / `court-input-control` CSS classes in `globals.css`. Pill shape (`rounded-full`), solid `court-surface-subtle` fill, thin court-brand-tinted border, spring-eased focus-within glow (`color-mix` brand green ring + 4px lift on desktop, no lift on touch). `INPUT_FRAME_CLASS` and `INPUT_CONTROL_CLASS` exported from `src/components/ui/input.tsx`. Applied to: global search bar, SMS composer, Ace Assistant input bar, candidate/job/client forms, settings inputs, editable fields.
- **Liquid Glass floating-surface pass**: targeted translucency on topbar, modals, dropdowns, panels only (not a full-app conversion).
- **New Job page restructure** with numbered section badges.
- **Dark-mode button fixes** across invoice/note/connector/settings buttons.
- **Candidate split-view Court Mode token migration**.
- **Storage-event listener for iframe theme re-skin**.
- **Table header distinction pass**.
- **Client card shadows + footer removal**.
- **Uniform settings Save buttons**.
- **Glass Contact Info panel**.
- **Connector page mobile polish**: Mercury green Court Mode token fix, connector pop-out visibility fix (`hidden md:flex`), shadow additions.
- **Service worker v8**: overnight PWA badge self-heal. Re-derives badge on push receipt and on SW activate. `setPointerCapture` / `releasePointerCapture` for clean drag release.
- **Custom installment invoice automation**: when Confirm Start fires and `useCustomTerms` is true, creates a draft invoice for installment 1 via `createDraftInvoiceAction` and `AceReminder` entries for installments 2 and 3. Both creation paths are idempotent and wrapped in `try/catch`. Success toast updated.
- **Permanently killed from roadmap**: QuickBooks standalone page, Quo setup wizard, APRO/job order worksheet. Do not bring these back.
- **ACE_DESIGN.md updated**: input fields get a distinct pill/soft-glass treatment separate from the button standard. Buttons stay `rounded-md`. Inputs are pill-shaped. These are separate standards and not a conflict.

## What Shipped in Ace 65.0 (2026-05-23)

Button/color standard cleanup closed out (the fix pass the Ace 64.0 audit surfaced), the deferred cleanup queue cleared (branch kill, tenant-scoping, Sentry N+1), and a dark-mode polish pass plus the sidebar profile card token and PWA icon.

- Button / color standard cleanup (audit items 1A/1B + 2A): removed `rounded-full` from text buttons, converted several one-off buttons to shared Button variants, and replaced the remaining hardcoded hex with Court Mode tokens. Follow-up fixes after first review: phone Call buttons switched to solid filled green, the connector-banner Reconnect button squared to `rounded-md`, and Upload Resume set to the blue outline treatment (`border-blue-500 text-blue-600`).
- `design/phase-1` branch deleted (abandoned, never merged).
- `src/lib/recruiterflow/` confirmed nonexistent - the MANUAL "delete the directory" cleanup item is a no-op, no action needed.
- SmsMessage / CallLog tenant-scoping: 9 query sites fixed across 5 files, all now org-scoped by organizationId.
- CallTranscript / AiWorkspaceMessage tenant-scoping completed (closes the rest of the cleanup-queue tenant-scoping line).
- Sentry N+1 fixes: 3 genuine N+1s fixed - bulk-actions placement lookup, import-csv candidate lookup, and match-by-name lookup - all converted to batched `findMany`.
- Dark-mode glow added to floating popovers: briefing tiles, Ace Assistant, YouTube panel, and the + New dropdown.
- Dark-mode tone-downs: skills chips, the candidate search selected row, and keyword highlight pills.
- Sidebar profile card fix: new `--court-sidebar-card` token added across all 8 themes, fixing the washed-out card on Grass and Night Court.
- PWA icon regenerated to match the topbar Ace logomark (dark disc, green arc).

Next task: iOS-style input field pass - soft pill / glass treatment, lift-on-focus, spring easing for the search bar, SMS composer, Ace Assistant bar, and all text inputs.

## What Shipped in Ace 64.0 (2026-05-22)

Push delivery + badge reliability fixes, a connectors page cleanup, and a mobile/topbar UI pass, plus the button/color audit closed out.

- Push delivery regression fix: when `candidate.createdById` has zero push subscriptions, delivery now falls back to the org so notifications still land instead of silently dropping. (The org-fallback in `sendPushToUserOrOrg` is the permanent fix from the temp-diag work.)
- Phone badge counts unread messages, not threads: the phone unread leg now reflects the number of unread messages rather than the number of conversations.
- Badge reliability fix: when the live Gmail unread lookup fails, the badge holds the last-known-good mail count instead of resetting, so a transient Gmail error no longer wipes the count.
- Connectors page mobile overflow fixes: the Settings > Connectors rows no longer blow out horizontally on narrow viewports.
- Gmail Push Notifications connector removed from Settings > Connectors.
- Weather fallback changed to Chagrin Falls OH (was the prior default location) for the dashboard weather widget.
- Mobile nav unread badges for Mail and Phone: the mobile navigation now surfaces unread-count badges on the Mail and Phone entries.
- Topbar pass: avatar removed, a light/dark toggle added, the PWA Ace logo added, and the hamburger menu moved down to the search row.
- Light-mode profile card fix for Grass and Night Court Light: the profile card now renders legibly in those two light palettes.
- Profile card added to the PWA drawer.
- Mobile-only stat card compaction: stat cards are tightened on mobile only; desktop sizing unchanged.
- Button / color audit completed: full audit done. Three doc-vs-code reconciliations captured in ACE_RULES.md + ACE_DESIGN.md (Generate-with-Claude buttons are solid-filled `ai-primary`, the AI-pill hex family is a third documented hex exception scoped to `button.tsx` + `edit-with-claude-menu.tsx`, and the Spotify-panel `rounded-full` buttons are a documented shape exception). The remaining fix work - pill-shaped text buttons (audit items 1A/1B) and the 4 hardcoded hex colors (audit item 2A) - is queued first in ACE_ROADMAP.md.

Next task: button/color standard cleanup - fix the pill-shaped text buttons (audit items 1A/1B) and the 4 hardcoded hex colors (audit item 2A).

## What Shipped in Ace 63.1 (2026-05-22)

Today's Briefing daily-companion tiles: fixed clicks, restyled pills, and hardened the rate-limited fetches.

- Click fix: Word of the Day / Daily Fact / Daily Horoscope popovers were clipped by the overflow-hidden grid cells (only chess worked, because it renders a position:fixed modal). Replaced the clipping 2x2 grid in news-feed.tsx with a non-clipping flex-wrap row so the absolute popovers are visible.
- Pill restyle: tiles are now content-width with a very light tinted border per color family (emerald/sky/amber/violet), padding trimmed px-3 py-2 to px-2.5 py-1.5 — removes the large empty colored space to the right of each label.
- 429 resilience: Word/Fact/Horoscope routes proxy rate-limited upstreams (Claude API for word/fact, free horoscope API for horoscope) and can transiently 429 on the first cold load of an ET day before the per-day cache warms. New src/lib/retry-fetch.ts adds bounded backoff retries on 429/502/503/504 to those on-mount fetches so one attempt lands and warms the cache for the rest of the day. Chess (Lichess, reliable) left unchanged.

Next task: confirm in prod that the briefing tiles open and load cleanly on a fresh ET day (cold-cache morning).

## What Shipped in Ace 63.0 (2026-05-21)

Multi-user client ownership Steps 3-5, push re-registration UI, Quo webhook fromNumber hardening, temp diagnostic log cleanup, the badge fallback fix, and a comprehensive badge/title reliability fix in flight at session close.

- Multi-user client ownership Step 3: read-only banner on non-owned clients, hidden action buttons (company edit, delete, contacts, agreements, benefits, add note), claim flow for Available clients (owner null), server action stamps owner on claim
- Multi-user client ownership Step 4: Mine / Austin's / All dropdown on /jobs and /pipeline, defaults to logged-in user's book, URL-persisted, no locks on job or pipeline detail pages
- Multi-user client ownership Step 5: daily auto-release cron at /api/cron/client-release (8:00 UTC), 60-day createdAt grace floor added after discovery that all 6 clients had zero activity (prevents day-one mass release), last-activity line added to view-only banner
- Push notifications re-register: PushPermissionButton wired into Settings > Connectors as a standalone Push Notifications row with CONNECTED / DISCONNECTED status and Enable / Disable, fixes re-registration after PWA reinstall
- Quo webhook fromNumber hardening: new src/lib/quo-phone.ts with pickPhone (handles object-shaped from values), redactPhone (last-4 suffix only), inbound extract diagnostic log, fromNumber missing log, 14 unit tests passing
- Temp log cleanup: all [web-push][diag] lines removed from web-push.ts, all [badge-diag] lines removed
- Badge fallback fix: Quo SMS/call paths no longer send badgeCount: 1 as fallback, omit badgeCount when the count is unreliable so the SW leaves the existing badge untouched
- Badge/title comprehensive fix (in progress at session close): mailUnread null coerced to 0 causing badge reset to 1, desktop title disappearing on navigation, phone unread API hardcoded zeros, Codex prompt pasted, awaiting confirmation

## What Shipped in Ace 62.0 (2026-05-21)

UI polish pass, AI-compose hardening, Quo webhook resilience, and the first two steps of multi-user client ownership.

- UNKNOWN badge chip: removed border and font-medium from thread list and detail header, now bg-court-surface-subtle text-court-fg-muted no border
- Phone sidebar filter renamed from "All" to "Inbox"
- Mail sidebar active state: hardcoded hex replaced with TabStrip canonical style across Inbox/Sent/Drafts/labels
- Generate button in Claude modal: switched from solid filled to CLAUDE_PILL_CLASS outlined style
- Gmail badge undercount fix: Gmail leg counts actual unread thread IDs instead of resultSizeEstimate
- Send Later: UTC removed from timezone dropdown, time field replaced with quarter-hour TimeSelect dropdown
- Phone sidebar active item: hardcoded hex replaced with court-brand outlined style matching Mail Inbox
- AI compose JSON parser: hardened to survive unescaped newlines, max tokens raised to 2048
- Quo webhook resilience: smsMessage.create try/catch, orgId null logging, getUnreadCountsForOrg try/catch with fallback
- Sidebar polish: active nav item gets thin court-brand left border and subtle background glow using court tokens
- Profile card consolidated: single bottom card with Andrew Kraig / 216-340-9511 / ACE CREATOR pill, phone copies to clipboard, per-user contact details (Andrew vs Austin)
- Markdown-to-HTML in generated emails: bold headers and hyperlinks render correctly in sent emails
- Multi-user client ownership Step 1: owner field added to Client model, 6 existing clients backfilled to andrew@breakpointtalent.com, new clients stamp owner on create
- Multi-user client ownership Step 2: Mine/All clients toggle on Clients page, owned-by badge on non-owned clients in All view
- Temporary [web-push][diag] logging in web-push.ts still live - pending removal after push notification debugging

## What Shipped in Ace 61.1 (2026-05-20)

### Bulk archive / move no longer drops threads under rate limits
- **Symptom:** selecting 5 threads and clicking Archive moved only one to the archive; the other four stayed selected and required a second click. Gmail serializes writes per mailbox, so the bulk loop's rapid sequential `threads.modify` calls were coming back 429/403/5xx for all but the first, and the client treated those as hard failures (left them selected) instead of retrying.
- **Fix:** added a shared `modifyGmailThreadLabels` wrapper in `src/lib/gmail.ts` with exponential backoff + jitter (4 attempts, ~0.4s / 0.9s / 1.9s) on retryable statuses (403, 429, 500, 502, 503, 504). `archiveGmailThread`, `moveGmailThread`, `markGmailThreadRead`, and `markGmailThreadUnread` all route through it, so a single bulk pass now lands every thread. Also removed the duplicated bare-fetch bodies from those four helpers.
- The client's 150ms inter-call gap in `runBulk` (mail-view.tsx) is kept as visual pacing; the real durability now lives server-side.
- Files: `src/lib/gmail.ts`.

## What Shipped in Ace 61.0 (2026-05-20)

Profile + pipeline regression close-out, the calendar reminder-mode drawer, scheduled send across every email surface, the dark login redesign, the PWA badge auto-fire fix, and the Auto Night Mode setting.

### Candidate profile + pipeline fixes
- **Split-view Delete restored.** The candidates split-view embed branch rendered no Delete control (Batch 2 Prompt 2 only placed it on the full profile + client Overview). An inline Delete is back on the split-view profile. Closes the carried regression.
- **Real-time stage pill after Apply / Keep / Reject.** The job pill now updates to the new stage immediately via optimistic state that holds until the server confirms, instead of staying on "Sourced." Also fixes the follow-on regression where the pill flashed then disappeared right after Apply.
- **Add Note button removed everywhere.** Pulled from all four candidate profile locations (no Add Note on any candidate surface).
- **Stage button visibility aligned to spec** in `pipeline-row-actions.tsx` so each pipeline stage shows the correct action button set.
- **Favicon / browser-tab unread counter** was already correct; verified, no change needed.

### Phone + calendar
- **Phone thread auto-scrolls to the bottom on open** so the newest message is visible without scrolling.
- **CalendarEventDrawer reminder mode.** When the drawer is in reminder mode it hides Guests, Location, Meeting type, All day, and Timezone (reminder-only fields). Time is hard-coded to ET for now, with a code comment to pull the per-user timezone once multi-user ships.

### Scheduled send (Send Later)
- **Send Later on every email surface.** Date / time / timezone picker on the composer; scheduled emails persist to a new `ScheduledEmail` table in Neon; a per-minute Vercel cron fires due sends; a failure toast with a Retry action surfaces sends Gmail rejected.

### Login redesign
- **Dark luxury sign-in.** Reworked `/sign-in` into a dark recruiter-network screen: world map with the Solon, OH HQ marker and connection arcs, glassy auth card, pulsing status dot. The top-bar stats strip ("14 Markets / 1,247 Candidates / clock") and the "BreakPoint - Global Desk" eyebrow were removed; map, card, bottom bar, and HQ label stay.

### PWA badge auto-fire fix (`2d0081e`)
- **Null badgeCount bug fixed.** `getUnreadCountsForOrg` in `src/lib/unread-counts.ts` returned `badgeCount: null` whenever the webhook's live Gmail unread lookup came back null, and `sw.js` maps a null badge to "leave it alone" - so new SMS / email frequently never moved the PWA app-icon badge while Ace was closed. It now always returns a numeric `badgeCount = (mailUnread ?? 0) + phoneUnread`, so every Quo SMS, Gmail push, and client-relayed push carries the real combined total (unread email threads + unread SMS conversations). Service worker cache bumped `v4 -> v5` to force stale installs onto the current SW.
- Files: `src/lib/unread-counts.ts`, `public/sw.js`.

### Auto Night Mode (`0dd1e41`)
- **Auto Night Mode toggle** in Settings > Appearance. When on, the client flips the active Court Mode surface to its dark variant at 7:00 PM ET and back to light at 7:00 AM ET on a 1-minute interval (no cron). State saves to `UserProfile.autoNightMode` (not localStorage) so it follows the user across devices; the chosen surface/theme stay in localStorage. A manual Light / Dark switch made inside a window is respected until the next 7am / 7pm boundary (tracked by a per-window key). ET is computed via `Intl` with the `America/New_York` zone so DST is automatic. Additive `autoNightMode` column applied to the DB via `prisma db push`.
- Files: `prisma/schema.prisma`, `src/lib/court-mode.tsx`, `src/app/settings/court-mode-view.tsx`, `src/app/settings/appearance-actions.ts` (new), `src/app/layout.tsx`.

## What Shipped in Ace 60.0 (2026-05-20)

Reminder toast brought onto the shared toast design, plus two new notification settings (duration + stack direction) and a Dismiss All control.

### Reminder toast + notification settings
- **Reminder toast redesign.** `ReminderToast` now renders the same card structure + sizing as the SMS/email toasts (`w-[314px]`, `rounded-xl`, white `h-9` icon square, `text-[12px]`/`[10px]`, scaled bottom-right action row) in an amber palette: `bg-amber-50` card, `border-amber-400`, Bell glyph at `text-amber-500`, with `dark:` variants so dark courts stay legible. Dropped the old theme-driven inline-style chrome + `ActionChip`. The existing Dismiss button + `handleDismiss` (which calls `dismissReminder` then clears the fired-key) are unchanged.
- **Notification duration setting.** New `SegmentedSetting` under In-app notifications: 5s / 10s / 30s / Until dismissed, default 5s. Saved to `localStorage` (`ace_toast_duration`) and read fresh at render time by all three toast renderers (`renderNewTextToast`, `renderNewCallToast`, `renderNewMailToast`, and the reminder `fire`). Note: reminders now auto-dismiss on the chosen duration instead of always persisting; pick "Until dismissed" for the old persist-forever behavior.
- **Stack direction setting.** Standard (bottom-right, current) vs Stack up (top-right, newest on top). Sonner has no reverse-order prop, so this is position-based: the `Toaster` `position` switches corners. Saved to `ace_toast_stack_dir`; `providers.tsx` re-reads it live on `TOAST_PREFS_CHANGED_EVENT` so the toggle applies without a reload.
- **Dismiss All.** New `ToastStackControls` pill (rendered in `providers.tsx`) appears only when 2+ notification toasts are visible and calls `toast.dismiss()` to clear them all. Active count tracked by `registerToast()` (in `src/lib/toast-prefs.ts`), which each notification toast calls on mount and releases on unmount.
- Files: `src/lib/toast-prefs.ts` (new), `src/components/toast-stack-controls.tsx` (new), `src/components/reminder-toast-provider.tsx`, `src/components/providers.tsx`, `src/components/text-notification-toast.tsx`, `src/components/mail-notification-toast.tsx`, `src/app/settings/preferences-view.tsx`.

### Batch 2 Prompt 1 - chat bubbles / Game Plan / apply pill (`14e2814`)
- **Chat bubble unification** across AiWorkspace, ClaudePanel, and TextingExchanges to the shared phone-view bubble treatment.
- **Delete overlap fix** on the Game Plan pages (Delete no longer overlaps content).
- **Apply to Job optimistic pill** - applying to a job shows the job pill immediately instead of waiting on a refresh.

### Batch 2 Prompt 2 - job pill spacing / dismissible pills / delete button (`4155f68`)
- **Job pill spacing on split-view.** Top margin added to the job pills row in the candidates split-view (both render paths) so the pills clear the chrome above; full profile unchanged.
- **Dismissible job pills.** Every job pill (split-view + full profile, all pipeline stages, both render paths) now has a faint X on the far right with a two-step inline confirm. New org-scoped `dismissPlacementFromProfile` action deletes the placement.
- **Delete button moved.** Delete on candidate + client profiles is now static and inline at the very bottom of the page content, Profile/Overview tab only - no longer fixed/floating.
- Files: `local-placement-rows.tsx`, `placement-flows.tsx`, `local-placement-actions.ts`, `dismiss-placement-button.tsx` (new), `local-profile.tsx`, `candidates/[id]/page.tsx`, `delete-candidate-button.tsx`, `clients/[id]/delete-client-button.tsx`, `clients/[id]/page.tsx`.

### Batch 3 - submittal modal fix (`0251e9d`)
- **Send always enabled.** Send Submittal in the Ace-native Submit to Job modal is no longer gated on a generated/typed body - it is disabled only when To or Subject is empty, so the recruiter can type or paste their own body and send without running Generate with Claude.
- **Max-height + sticky footer.** `ModalShell` is now header / scrollable content / pinned footer, capped at viewport height, so a long generated submittal scrolls inside the content area instead of pushing Cancel / Send Submittal off screen. Also fixed an em dash in the auto-filled submittal subject.
- File: `src/app/candidates/[id]/local-candidate-actions.tsx`. Note: the imported-candidate path uses the shared `email-composer.tsx` ("Submittal email"), which already enables Send immediately, so it was left unchanged. Pending Andrew's browser verification.

### Legacy render path retirement - Phase 0 audit (read-only, complete) (`8876af2`)
Scoping audit for retiring the legacy (rfId-keyed) candidate profile render path so every candidate renders through `LocalCandidateProfile` (Neon-only). Read-only, no writes. Scripts: `scripts/audit-legacy-candidates.ts`, `scripts/spotcheck-rawjobs-candidates.ts`. Numbers:
- **Candidates:** 726 total - 692 legacy (rfId set, 95%), 34 native (cuid). New candidates are created without an rfId, so the legacy path is frozen, not growing.
- **Display data:** already in Neon - only 1 legacy candidate has a field missing from Neon columns (a single LinkedIn URL).
- **Placement (pill) reachability across the 692 legacy candidates:** 19 survive (placements keyed by cuid); **10 would lose pills** (placements keyed only by rfId, candidateId null - BLOCKER, includes Billy Overton rfId 848); 594 show pills only from the imported `raw.jobs[]` list with no Neon placement (580 Sourced / 14 Disqualified); 69 have no placements.
- **Placement keying:** 59 placements total - 45 keyed by cuid, 14 with candidateId null.
- **Late-stage exposure:** only 2 legacy candidates in offer/hired/pending/cancelled (stages the native pill renderer does not yet fully support).
- **Phase 1 scope (deferred):** backfill candidateId onto the 14 null-cuid placement rows, create 594 Placement rows from raw.jobs[] (stage sourced/rejected), backfill the 1 LinkedIn URL, then atomic cutover. `placement-flows.tsx` + `placement-actions.ts` are shared with Applicants / Jobs / bulk and must NOT be deleted; only the page.tsx profile branch retires.

## What Shipped in Ace 59.0 (2026-05-20)

Notification toast polish: SMS + email toasts redesigned to the shared mockup layout (Reply / View / Mark as Read), and the Settings phone "Try it" Call test removed.

### SMS + email notification toasts
- **SMS toast icon.** The lowercase "text" label box is replaced by a green `MessageSquare` lucide glyph inside the same white rounded square (`text-court-brand`, matching the card's green border). Call mode keeps its phone glyph.
- **Actions moved to a bottom row.** Both toasts stack their action buttons on a right-aligned row beneath the sender + preview (matching the mockup) so three buttons fit the 470px card without crushing the sender. SMS: Reply (text only) + View + Mark as Read (text only); replying still swaps in Send + Cancel. Email: Reply + View + Mark as Read.
- **Mark as Read on both toasts.** SMS Mark as Read runs the same `markThreadReadAndBroadcast` path the View popup uses (clears the sidebar Phone badge + /phone list), then closes. Email Mark as Read POSTs to `/api/mail/threads/[id]/read` and optimistically clears the badge via `useMailContext().markThreadRead`, then closes. Sample preview toasts (`id` prefixed `sample-`) just close.
- **Email toast Reply opens the composer focused.** Reply opens the floating thread straight into the reply editor with the body focused, no read-only preview step. `FloatingThreadOpenOptions` gained a `composerMode` flag; `open()` stores it as `initialComposerMode`, and `FloatingThreadWindow` seeds its `composerMode` from it on open, so the existing `autoFocusBody` path drops the cursor in the reply body.
- **Settings "Try it" Call test removed.** The phone notification-style picker's Try-it row shows Text only; the Call test button, `fireSampleCallToast`, and the now-unused `renderNewCallToast` import are gone.
- **Compact sizing.** Both toasts are about 33% smaller (470px to 314px wide, with icon, text, padding, and the X scaled to match) for a more discreet footprint while keeping the same proportions.
- Files: `src/components/text-notification-toast.tsx`, `src/components/mail-notification-toast.tsx`, `src/lib/floating-thread-context.tsx`, `src/components/mail/floating-thread-window.tsx`, `src/app/settings/preferences-view.tsx`.

## What Shipped in Ace 58.0 (2026-05-20)

SMS notification toast View button + centered popup.

### SMS toast View popup
- **View now opens a centered popup, not a page jump.** The inbound-text toast's three actions are Reply (inline quick-reply), View, and X. View dispatches a new `PHONE_VIEW_POPUP_EVENT`, dismisses the toast, and a global host (`TextNotificationPopup`, mounted in `TextingProvider`) renders a centered popup for that one message. Call toasts (and texts with no matched candidate) keep the original profile jump.
- **Popup actions.** Shows the message body + sender name/number, with X (close, thread stays unread), Mark as Read (clears the unread badge via `markThreadRead`, closes), and Reply (expands an inline input + Send inside the popup). Send routes through the shared `sendSmsReply` path, which marks the thread read and broadcasts `PHONE_THREAD_READ_EVENT` + `PHONE_SMS_SENT_EVENT`, then closes the popup.
- **Send path factored.** Extracted `sendSmsReply` + `markThreadReadAndBroadcast` helpers in `text-notification-toast.tsx` so the toast quick-reply and the popup share one outbound-SMS + mark-read path instead of duplicating the fetch.
- **Reply + View ungated from candidate match.** The toast Reply button and the View popup now work for every inbound text (`props.mode === "text"`), not just texts from a matched candidate/client. The reply + mark-read flow is candidateId-optional: unmatched sends route by `fromNumber` and mark read via the `unk:<digits>` thread key, and the popup shows the raw phone number as its title when no name is available. The Settings → Preferences theme-preview toast (`id` prefixed `sample-`) renders Reply/View for fidelity but never hits `/api/sms` or `markThreadRead`.
- **Auto-mark-on-open in /phone.** Clicking a thread in `phone-view.tsx` now auto-marks it read after the detail loads — same path as the manual "Mark as read" button (`markThreadRead` → local `hasUnread` flip → `phoneCtx.refreshUnread()`), guarded by `autoMarkedRef` so a post-send refresh doesn't re-fire. The manual button is unchanged.
- Files: `src/components/text-notification-toast.tsx`, `src/lib/texting-context.tsx`, `src/app/phone/phone-view.tsx`.

## What Shipped in Ace 57.0 (2026-05-20)

Ace-native reminder system end to end, a calendar create/edit drawer overhaul, the dashboard This Week widget, and connector + lists + settings closeouts. Closed items 36, 34, 35, 33, 38.

### Reminders - full system
- **Full reminder system.** Standalone AceReminder rows render as reminder-type pseudo-events on the calendar grid and the dashboard This Week widget. Edit + delete from the reminders panel. Stacked lead-time notifications (notify 15 / 30 / 60 / 120 / 1440 min ahead) fire as site-wide amber toasts.
- **FAB reminders write AceReminder rows.** The global FAB "New Reminder" writes an Ace-native AceReminder (toast-only, never pushed to Google) instead of a Google CalendarEvent, so it surfaces in the panel + grid + toast. Shared NOTIFY lead-time picker between the panel and the FAB so a FAB reminder matches a panel-created one.
- **Reminder times in ET.** Reminder times display in Eastern; the Upcoming panel row + time layout was restructured.
- **Item 35 - Interview auto-reminder on scheduling.** Scheduling an interview auto-creates an AceReminder so the recruiter gets the amber toast ahead of the interview.

### Calendar create/edit drawer
- **Interactive timezone selector + single-time reminders** in the drawer. Timezone picker limited to the four continental US zones.
- **Quarter-hour time pickers + duration pills.** Drawer persists the event type and loads the reminder toggle to its current state when an event is reopened. Live Spotify status added alongside the picker work.
- **Item 36 - Calendar auto-sync after scheduling (verified).** `triggerCalendarSync` fires after all schedule + reschedule callsites and the drawer create + edit handlers, so a freshly scheduled event appears in the local CalendarEvent mirror without clicking Sync.

### Dashboard This Week widget + calendar grid collisions
- **Widget shows FAB-created reminders;** reminders and calendar events that share a time slot now split into left/right lanes on the week + day grids instead of overlapping. Day-view lane tiles render a compact label + title so the header no longer wraps and clips.
- **Dashboard freshness.** Router-cache dynamic staleTime set to 0 plus a dashboard auto-refresh on tab focus/visibility, so a reminder created on the calendar or via the FAB shows on the widget without a manual reload.
- **Up to 5 events per day** on the This Week widget before "+N more" (was 2) so a busy day's reminders are not buried.

### Lists + interviews
- **Item 34 - Bulk reject from Lists.** Saved Candidate Lists selection toolbar now offers Remove from List / Reject All so a recruiter can clear a list in one pass.

### Settings - Templates + Triggers
- **Item 33 - Templates + Triggers unified.** The two panels are now one Settings page; the Trigger override dropdown shows every active template.

### Connectors - Microsoft Teams
- **Item 38 - Teams OAuth expiry surfaced.** Connector now validates token health (not just row existence), classifies Teams meeting permission errors correctly, shows clean error copy, and logs granted OAuth scopes on reconnect. Connector status pills made consistent and push suppression made focus-aware.

## What Shipped in Ace 56.0 (2026-05-19)

Polish queue close-out session covering the next slice of the backlog: StageAgePill extraction (22), news-feed mobile overflow (24), ClaudePanel touch fixes (25 + 25b), candidates panel resizer (26), PWA badge audit (30), em-dash scrub on outbound email (37), AI Workspace prose line breaks (41), plus font-weight reconciliation, PWA nav rebuild, email popup Mark as Read, and iMessage-style texting polish. Item 36 (calendar auto-sync after scheduling) is in progress.

### Pipeline + reusable UI
- **Item 22 — StageAgePill extracted.** New shared component at `src/components/ui/stage-age-pill.tsx`. `pipeline-view.tsx` now consumes `<StageAgePill value={r.daysInStage} />`. Verbatim className, thresholds, and null em-dash placeholder preserved end-to-end so the pill reads identically to the inline version it replaced.

### News feed
- **Item 24 — Mobile overflow fix on news feed companions.** Wrapper at `news-feed.tsx:398` got `overflow-x-auto`. Four child pills wrapped in `min-w-0 overflow-hidden` divs so long entity strings don't blow out the row on narrow viewports. Desktop 2-col grid unchanged.

### Claude Panel — mobile touch
- **Item 25 — Drag + scroll touch behavior.** `ClaudePanel.tsx` header drag div gets `touchAction: none` so the panel drag claims the gesture without browser scroll cancelling it. `onHeaderPointerDown` calls `stopPropagation` after `preventDefault`. `listRef` scroll container gets `touchAction: pan-y` so vertical scrolls inside the panel pass through without triggering drag.
- **Item 25b — Composer affordances.** Close X button (`ClaudePanel.tsx:1196`) gets `touchAction: auto`. Message textarea (`ClaudePanel.tsx:1328`) gets `touchAction: manipulation` so input gestures don't fight the panel-level pan-y rule.

### PWA — nav + manifest shortcuts
- **`mobile-nav.tsx` NAV_GROUPS rebuilt** to Clubhouse / Inbox / ATS / CRM / Ops / Scoreboard / Settings so the installed PWA's nav reads like the desktop sidebar instead of the old flat list.
- **`manifest.json` shortcuts array** populated with 14 long-press home-screen targets so a recruiter can jump straight to specific surfaces (Inbox, Phone, Candidates, Pipeline, Calendar, etc.) without going through the app shell.

### Email popup — Mark as Read
- **CheckCheck button on floating thread toolbar.** Renders only when the thread carries `UNREAD` via a `useState<boolean>` gate. Click POSTs `/api/mail/threads/{id}/read` + fires Gmail `labelMessage` to remove the UNREAD label. Local state only flips to `false` after the API resolves so an error keeps the button visible. No auto-mark-on-open — explicit click only.

### Texting visual polish
- **iMessage-style bubbles in `phone-view.tsx`.** Inbound bubbles render `bg-white rounded-bl-sm` left-aligned (grey backdrop reads as "not from me"). Outbound bubbles render `bg-court-brand text-white rounded-br-sm` right-aligned. Timestamps moved outside the bubbles (italic, muted). Day separators render as pill chips in `MON, APR 27` format. Closes the inbound SMS bubble color item raised at Ace 55.0 close.

### Candidates split view — resizable left panel
- **Item 26 — Resizable left panel restored.** Drag handle between the candidate list and the detail iframe (re-adds the affordance that was locked to `w-64` in Ace 53.0). Constraints: min 200px, max 480px. Width persists to localStorage at key `"ace-candidates-left-width"`. Default 256px so first-load matches the previous fixed layout.

### Notifications + badges
- **Item 30 — PWA badge audit only.** Gmail leg confirmed working via push-driven `ace:refresh-unread` event. Quo leg confirmed working via webhook → DB → context refresh. Reminders leg is intentionally NOT contributing to the badge — `ReminderToastProvider` still fires toast-only (no badge increment) for now. Stale `unreadCount:0` field at `src/app/api/phone/threads/route.ts:251` flagged for future cleanup (no consumer reads it). No code changes — audit-only pass to confirm the aggregate badge reads correctly with the current legs wired.

### Em dashes — outbound email scrub
- **Item 37 — Em dashes scrubbed from every outbound-email surface.** Template seeds in `templates-actions.ts` cleaned (Applied Confirmation, Offer Extended, Hired Welcome, Client Interview Scheduled, Candidate Interview Prep, Reference Check). New `stripEmDashesFromTemplates` migration runs from `ensureDefaultTemplates` and scrubs existing DB rows so customized templates also catch up. Runtime strip added in `fireTemplatedEmail` after `applyMergeFields` so any em dash that arrives via a merge value (e.g. a free-form notes field) still gets caught before send. Claude prompts cleaned in `claude.ts` (submittal generator + JD generator + agreements + benefits), `format-email/route.ts`, and `ai-workspace/route.ts` so generated copy no longer carries em dashes back into emails. Table cell em-dash placeholders for null/empty states preserved per [[feedback_no_em_dashes]] exception in `ACE_RULES.md`.

### Font-weight reconciliation
- **`kpi-tile.tsx:53` font-bold → font-extrabold.** Now matches the 26px `Stat` value at `clients/[id]/page.tsx:621`. Single canonical weight across both KPI surfaces. Closes the font-weight reconciliation item raised at Ace 55.0 close.

### AI Workspace — prose line breaks
- **Item 41 — Mid-sentence breaks fixed.** `MarkdownContent` in `AiWorkspace.tsx` now passes content through a `collapseProseHardBreaks` preprocessor before `ReactMarkdown` renders. Strips CommonMark hard-break syntax (two trailing spaces + newline, backslash + newline) so single newlines in Claude output no longer render as visible `<br>`. Paragraph breaks (double newlines) preserved so structure survives. Scoped to AI Workspace + Claude Panel only (same `MarkdownContent` export). `MarkdownProse` (used by client agreements + benefits) untouched.

### In progress
- **Item 36 — Calendar auto-sync after scheduling.** Helper `triggerCalendarSync(router)` extracted from the Sync button at `calendar-view.tsx` to `src/lib/calendar/trigger-sync.ts`. Wired into all 4 schedule + 1 reschedule callsites in `local-placement-rows.tsx` + `placement-flows.tsx`, plus the `CalendarEventDrawer` create + edit handlers. Prompt sent; Andrew's browser verification pending so it carries into Ace 57.0 as the first item.

## Known Issues Carrying Into Ace 62.0
- **Legacy render path retirement - Phase 1+ pending.** Phase 0 audit complete (numbers under What Shipped in Ace 60.0). Phase 1 backfill (candidateId on 14 placement rows, 594 Placement rows from raw.jobs[], 1 LinkedIn URL) then atomic cutover is deferred to a later version.
- **Scheduled send + PWA badge + Auto Night Mode awaiting browser verification.** All three shipped in Ace 61.0; Andrew verifies live next session (a scheduled email actually firing on the per-minute cron, the app-icon badge moving on a fresh SMS / email with Ace closed, and the 7pm / 7am ET theme flip).
- **Button styles inconsistent across app.** Submit was unified in Ace 54.0 and PipelinePill / Stat / Scoreboard subtext landed in 55.0, but the full button + color sweep is still outstanding (item 31 + 45). `rounded-full` still appears on some `<button>` elements, hardcoded color literals remain on others, and some buttons bypass the shared `Button` component entirely.
- **BCC hardcoded to Austin.** Bulk and individual email send paths hardcode Austin's address into the BCC field for every send. Should be a per-user setting or removed entirely for non-bulk sends (item 32).
- **Reminders leg not contributing to PWA badge.** Intentional for now - `ReminderToastProvider` fires toast-only. Revisit when the badge story needs the third leg.
- **Stale `unreadCount:0` field in `src/app/api/phone/threads/route.ts:251`.** No consumer reads it; safe to remove on the next pass through that file. Future cleanup only.

## Next Task
Ace 62.0 opens with verification of what shipped in 61.0, then the next build batch. Order for tomorrow:
1. **Verify scheduled send fired.** Confirm a Send Later email actually went out on the per-minute Vercel cron (ScheduledEmail row flips SCHEDULED -> SENT, sentMessageId set), and the failure-toast Retry path works.
2. **Verify PWA badge + Auto Night Mode.** App-icon badge moves on a fresh SMS / email with Ace closed (after the v5 service worker takes on each device); Auto Night Mode flips dark at 7:00 PM ET and light at 7:00 AM ET and persists across devices.
3. **Quo setup wizard.** Guided Settings flow to connect Quo, configure the webhook URL, verify inbound SMS / call routing, and confirm transcription is live. (Promoted from Non-Urgent.)
4. **Legacy render path retirement - Phase 1+.** Backfill candidateId on the 14 null-cuid placement rows, create 594 Placement rows from raw.jobs[], backfill the 1 LinkedIn URL, then atomic cutover. `placement-flows.tsx` / `placement-actions.ts` are shared and stay; only the page.tsx profile branch retires.
5. **Button / color audit (item 31 + 45).** Full sweep: scan every `.tsx` under `src/` for `rounded-full` on `<button>` / `Button`, hardcoded color literals on buttons, and `<button>` elements bypassing the shared `Button` component. Report findings by file with line numbers before changing anything.
6. **QuickBooks standalone page.** New route at `/finances/quickbooks`, isolated from the existing Mercury-driven Finances page (income / expenses / aging / P&L). Spec under Queued Specs in ACE_ROADMAP.md.

Full priority queue lives in ACE_ROADMAP.md under Active Build Sequence.

## What Shipped in Ace 55.0 (2026-05-18)

Polish queue close-out session. Closed 11 items from the queue carried out of Ace 54.0 — calendar create unification, ComposeFAB global drawer wiring, Delete button placement parity, Edit Interview button across all 4 pipeline surfaces, Scoreboard KPI subtext, PipelinePill Court Mode tokens + client profile Stat sizing, ExpenseMerchantLogo + favicons, Mark as Read on Quo thread, and Add Number SMS verified.

### Calendar + reminders
- **Item 7 — CreateEventModal killed.** All calendar create entry points unified into `CalendarEventDrawer` create mode. `allDay` toggle and meeting type picker (Google Meet / Teams / Phone / In Person) ported into the drawer; `GuestTypeahead` wired into the recipients field.
- **Item 3 — ComposeFAB New Reminder wired to global drawer.** The ComposeFAB "New Reminder" entry now dispatches through `CalendarDrawerProvider` so the drawer opens inline on whatever page the recruiter is on. No navigation to `/calendar`.
- **FAB overlay fix.** Both ComposeFAB New Event and ComposeFAB New Reminder open the drawer as a true overlay on the current page via the global `CalendarDrawerProvider`. Previously the FAB navigated the recruiter to `/calendar` before opening the create surface.
- **Timezone fix.** `CalendarEventDrawer` create mode was persisting datetimes as UTC; fixed to write ET offset so a 3 PM ET event saves as 3 PM ET, not 3 PM UTC.

### Pipeline + interviews
- **Item 19 — Edit Interview button across 4 surfaces.** Added the Edit Interview affordance to `pipeline-view.tsx` (tiny underline link on `/pipeline`), `pipeline-row-actions.tsx` (rounded-md outlined button on the job pipeline tab), `local-placement-rows.tsx` (Ace-native candidate profile rows), and `placement-flows.tsx` (RF candidate profile rows). Consistent action across every surface that shows an interview.

### Candidate + job profile chrome
- **Item 9 — Delete buttons relocated to floating bottom-right.** `DeleteCandidateButton` and `DeleteJobButton` now match the `DeleteClientButton` pattern: floating in the bottom-right of the profile page so the action lives in a predictable place across all three entity profiles.

### Dashboard + finances
- **Item 27 — ExpenseMerchantLogo + Google s2 favicons on expense rows.** `ExpenseMerchantLogo` component renders Google `s2/favicons` icons next to every recurring/one-time expense row on the Finances Expenses tab, with initials fallback. Domain colocated on each `KNOWN_TOOLS` entry and on each `RecurringCatalogEntry` so the favicon URL resolves from the tool name automatically. (Item also appeared in the Ace 54.0 ship list — closed out in 55.0 with the catalog colocation pass.)
- **Item 15 — Scoreboard KPI subtext now visible.** `ScoreboardKpiTile`'s `sub` prop renders as a visible 10px muted line under the value (was hover-only via `title=`). Five context strings ("Per placement, last 90 days", "Avg, job posted → placed (90d)", etc.) surface inline without a tooltip.
- **Item 17 — PipelinePill Court Mode tokens + Stat sizing.** `PipelinePill` stage dots swapped from hardcoded hex to Court Mode tokens (`court-brand-dark` for submitted, `court-brand` for hired) + canonical Tailwind hues for typed stages (blue-700, purple-600, amber-700). Client profile `Stat` value sized to `text-[26px]` to match the canonical `KpiTile` chrome used on Clubhouse + Finances.

### Phone + texting
- **Item 29 — Mark as Read button on Quo thread.** `ThreadDetailPane` header renders a manual "Mark as read" button (CheckCheck icon) when the current thread has `hasUnread: true`. Reuses the same `markThreadRead` + `refreshUnread` chain as auto-mark-on-open. Fallback when auto-mark errored or the recruiter wants to clear without scrolling.
- **Item 21 — Add Number inline on SMS composer verified.** Confirmed working in browser; shipped in Ace 54.0, no code changes needed this session.

### New backlog items raised this session
- **Inbound SMS bubble color** — inbound bubbles currently render brand-green; should be grey so they read as "not from me" at a glance. Outbound stays brand-green. Logged on ACE_ROADMAP.md.
- **font-bold vs font-extrabold reconciliation** — open flag: `KpiTile` (`src/app/dashboard/kpi-tile.tsx`) uses `font-bold` on the 26px value; client profile `Stat` (`src/app/clients/[id]/page.tsx`) uses `font-extrabold`. Pick one weight and align across both.

## What Shipped in Ace 54.0 (2026-05-18)

Polish + feature session across the candidate, dashboard, finances, calendar, sidebar, and global-chrome surfaces. Closes most of the 30-item Active Build Sequence carried out of Ace 53.0 and ships the Notes feature end-to-end as a new product surface.

### Candidate search + profile
- **Boolean AND search** on `/candidates`. Multi-token queries now require every term to hit instead of OR'ing, so a 3-term search returns only candidates that match all 3. Replaces the implicit OR behavior that was burying tight matches under loose ones.
- **Keyword highlighting** on the candidate profile resume — search tokens propagated from `/candidates` carry through to the embed and highlight every hit inside the resume text.
- **Candidate inline editing** for top-of-profile fields (name, title, current employer, location, email, phone, LinkedIn) — save-on-blur, no separate Edit modal.
- **Tabs on /candidates** — the candidate search page now carries a tab strip for filtering instead of the previous flat list, matching the chrome on `/applicants` and `/pipeline`.
- **Job pill after apply** — applying a candidate to a job now renders the job as an inline pill on the candidate profile immediately, no reload.
- **Resume highlight right panel removed** — the inline highlighting panel that lived to the right of the resume PDF in embed view was dropped per design feedback; the panel was crowding the resume and the highlights inside the PDF itself already carry the signal.
- **Submit modal portal fix** — submit-to-job modal renders as a true viewport overlay via portal instead of inside the app shell, so the candidate's split-view iframe can't clip it.

### Composer + AI
- **Custom Edit with Claude** — recruiter can now type a freeform instruction ("make it shorter", "more enthusiastic") into the Edit with Claude affordance on the mail composer instead of choosing from a fixed preset menu.
- **Chevron fix on Generate with Claude** — trailing chevron on the Generate with Claude pill points the right way and matches the sibling Use Template / Insert Field / Edit with Claude buttons on the composer toolbar row.

### Dashboard + finances
- **TrendCard zero-revenue fallback** — Trend tile on the Financial Performance tab renders a clean 3-column text layout when a quarter has zero revenue, instead of three flat 4%-tall bars stamped with `$0`.
- **Momentum excludes rejected** — the dashboard Momentum widget no longer counts rejected placements toward weekly movement so the number reflects real forward motion.
- **Goal Pacing sized down** — GoalPacingCard padding + internal type scaled to match the canonical big-panel chrome on Scoreboard.
- **Invoice blank cells** — invoice table empty cells now render em-dash placeholders instead of fully blank cells.
- **Merchant favicons on Expenses rows (item 27)** — new `ExpenseMerchantLogo` component (`src/components/expense-merchant-logo.tsx`) renders the Google `s2/favicons` icon (sz=32, 20px) next to every recurring/one-time row on the Finances Expenses tab, with initials fallback when the favicon errors. Domain colocated on each `KNOWN_TOOLS` entry in `src/lib/mercury-matcher.ts` (new `domain?: string` field + `domainForTool()` helper) and on each `RecurringCatalogEntry` in `financial-performance-tab.tsx`. Manual `ToolExpense` rows resolve their domain via `domainForTool(name)` when the name matches a known tool; arbitrary names fall through to initials. LinkedIn intentionally skipped (not in `KNOWN_TOOLS`).

### Settings + triggers
- **Trigger warning banners** — Settings ▸ Triggers shows a yellow warning row when a rule is enabled but its template is missing/inactive or `sendAsDraft` is on without an email account connected.

### Phone + texting
- **SMS bubbles polish** — outbound bubble color and weight tightened on both `/phone` and the candidate sidebar to match the rest of the brand-green surface family.
- **Add Number inline** — SMS composer now surfaces an "Add Number" affordance when the candidate has no phone on file instead of dead-ending the recruiter at a disabled input.
- **Mark-as-read button on Quo thread (item 29)** — `ThreadDetailPane` header now renders a manual "Mark as read" button (CheckCheck icon) when the current thread has `hasUnread: true`. Wraps the existing `markThreadRead` server action (writes Ace DB, not Quo's API) + the same optimistic local thread flip + `phoneCtx.refreshUnread()` chain as auto-mark-on-open. Acts as a fallback when auto-mark errored or the recruiter wants to clear without scrolling.

### Mail + phone layout
- **Email + phone full-width** — `/mail` and `/phone` content surfaces now extend full viewport width on wide displays, matching `/candidates` and `/pipeline`. The previous max-width cap was leaving dead space on the right.

### Sidebar + chrome
- **Sidebar restructure** — top-level groups reorganized to Inbox → ATS → CRM → Ops → Scoreboard with Inbox pinned high so unread badges read fast. Items within ATS and CRM groups alphabetized (Applicants → Candidates → Pipeline; BD → Clients → Jobs).
- **White X bar fix** — the white close affordance bar that was bleeding into the topbar / app-shell seam was anchored correctly so it stops floating over content.

### Buttons + TabStrip + visual unification
- **Submit button style** unified across every surface (`/candidates`, `/applicants`, `/pipeline`, candidate profile, embed view) — rounded-md, filled brand green, white text. Stops the variant drift where Submit read as four different buttons depending on which page surfaced it.
- **TabStrip conversion** — final per-page tab strips converted to the canonical `TabStrip` component. No more one-off pill rows in product surfaces.
- **Applicants job title** — `/applicants` table now shows the linked job title inline on each row instead of forcing the recruiter to drill into the candidate to see what they applied to.

### Notes feature — full build
New `/notes` page + standalone `Note` model + activity-feed integration.
- **Schema** — new `Note` Prisma model (org-scoped, per-user-private) with implicit many-to-many relations to Candidate / Client / Job. One note can be attached to any combination of candidates, clients, and jobs simultaneously; Prisma manages the three join tables. Back-relations named `noteEntries` on each entity to avoid collision with the existing `Candidate.notes` / `Client.notes` text columns that back the legacy profile Notes tabs.
- **/notes page** — composer-first layout. Always-visible doc-style composer card with optional title, required body, and an Attach button that expands an inline multi-select picker (no popover — the absolute-positioned popover the first cut shipped with overflowed the viewport). TabStrip filter (All Notes / My Notes / Attached) sits above the composer with live counts. Saved notes render below as `NoteCard` rows with hover toolbar (pin / re-attach / edit / delete).
- **Server actions + queries** — `createNote / updateNote / deleteNote / attachNote / setPinned` in `src/app/notes/actions.ts`, all scoped by `organizationId AND createdById`. Attachment payloads carry arrays per kind; the action verifies every id belongs to the same org before connecting. Queries in `src/lib/notes/queries.ts` filter via Prisma `some` / `none` on each relation.
- **ComposeFAB** — root menu collapsed to the six canonical entries in the requested order: New Email → New Call → New Text → New Note → New Event → New Reminder. New Note opens a popup with title + body + inline multi-select picker so the recruiter can attach to any combo of profiles in one save. New Reminder dispatches `ace:calendar:new-reminder` to mirror the TopBar reminder affordance.
- **Activity feed integration** — `EntityNotesSection` server component reads notes attached to the current entity and renders them above the existing `ActivityFeed` on `/clients/[id]` and `/jobs/[id]` activity tabs, and inline below `CandidateActivityCard` in the candidate-profile right rail. Cross-attachment chips on each note row link to every other profile the note also lives on.
- **Sidebar** — new `/notes` nav entry under Ops with the StickyNote lucide icon, replacing the NotebookPen stub that was sitting there.
- **TopBar** — `/notes` title wired through `top-bar-page-title.tsx` under the Ops group breadcrumb.

## What Shipped in Ace 53.0 (2026-05-17)

Visual redesign session. Attempted Prompts 1-17 of a sweeping visual pass across every surface; result was inconsistent and broke too many things at once, so the session pivoted to a full revert of all 41 redesign commits back to `f56b6be` ("typeahead contact suggestions on TO/CC/BCC chip inputs"), then surgically cherry-picked just the confirmed-good fixes back on top. Three batches of restoration landed clean, then one targeted re-revert on a problematic sub-change, then a final fix-up batch.

### Redesign attempt + revert (`2a6b463`)
- 41 commits across the redesign attempt (covering Cursor design phases 1-2, table unification, dashboard sizing, client cards, briefing polish, finances redesign, applicants/pipeline restyle, settings unification, scoreboard restyle, placements KPI normalization, mail/phone visual passes, stage chip recoloring, several rounds of KPI tile work, plus the per-item polish from `cdf7ece`, `b09ab5e`, `da8992d`, `ba38673`, `2dfb72c`, `5629d89`, `a987d66`, `5327215`, `76292b6`, `da75fda`, `cadfcf4`, `d1fdad0`, `f841e7c`, `963bbe2`, `8fa5c8b`, `f794cfc`, `9a2f0fb`, `ebd23c3`, `1251b9a`, `d2bea12`, `7095091`, `f293bd1`, `0677307`, `26770ab`, `7505552`, and the docs rolls between).
- Result: visual inconsistencies across pages, several regressions (Clearbit logos overwritten, briefing card backgrounds going green, candidate resume pane shrunk, applicants/pipeline page backgrounds tinting green, Goal Pacing sized too large).
- `2a6b463 revert: roll back to before redesign` — single revert commit unwound the entire range. 82 files, -3,744 / +2,443 lines. Original commits remain in git history for selective cherry-pick.

### Batch 1 restoration: unified table system + applicants page + pipeline buttons (`4c915b1`, from `50f2c54`)
- `data-table.tsx` — added `DataTableBody` + `DataTableRow` exports. `DataTableHead` shortened to `bg-court-surface-subtle`. Header cell helper carries spec padding/typography centrally so individual tables stop redefining the same classes.
- `applicants-view.tsx` — switched table body + rows to the shared `DataTableBody`/`DataTableRow`. Tightened cell padding `px-5 → px-4`. Action-row gap `1.5 → 2`.
- `jobs-view.tsx` — same body/row adoption + padding tightening.
- `pipeline-view.tsx` — same body/row adoption + `px-5 → px-4` across the file. PendingStartCells action buttons restyled to spec: `flex-row gap-2`, taller pill chips (`h-8`, `rounded-full`, `text-[12px]`, no all-caps).
- Skipped `placements-tab.tsx` — `50f2c54`'s diff there only re-skinned a KpiTile block introduced in an earlier (reverted) commit; nothing to update on the post-revert tree.

### Batch 2 restoration: ComposeFAB / stage chips / row heights / dashboard sizing / JD tab (`32d4c44`, from `793f33c`)
- `compose-fab.tsx` — ComposeFAB order is now Email → Call → Text → Note → Event. (No Reminder row — that entry never landed on the current base; queued separately for a follow-up.)
- `pipeline-summary.tsx` — replaced the green-brand progression with the per-stage tonal palette: amber=applied/pending_start, slate=sourced/kept, blue=interviewing, purple=offer, court-brand=submitted/hired, red=rejected. Matched chip swapped from emerald to court-brand tokens.
- `mail-view.tsx` + `phone-view.tsx` — thread row vertical padding `py-3 → py-2.5` in both.
- `financial-strip.tsx` + `goal-pacing.tsx` + `financial-performance-tab.tsx` — Billing Tower section padding `p-5 → p-4`, stat values `26px → 32px` serif. GoalPacingCard padding `p-5 → p-4`. TrendCard gained the zero-revenue fallback grid so quarters with no revenue render a clean 3-col text layout instead of three flat 4%-tall bars stamped with `$0`.
- `job-description-tab.tsx` + `jobs/[id]/page.tsx` — removed `InternalNotesCard` + `initialInternalNotes` prop + the `saveJobInternalRecruiterNotes` import.

### Batch 3 restoration: resume pane containment + bulk email modal + apply live update (`e4af7b2`, from `b194adc`)
- `placement-flows.tsx` — added `finally { router.refresh() }` after the optimistic submit IIFE so pipeline / applicants / jobs reconcile to RSC after a snapshot lands without a manual reload.
- `bulk-dialogs.tsx` — byte-identical swap to the `b194adc` version (1,130 lines, +461 / -299). Current file was an exact match of `b194adc`'s parent so the rewrite applied cleanly without any conflict resolution. New layout adds a FROM row and unblocks the modal sizing.
- `candidates/page.tsx` (outer split view) — three coordinated edits: outer wrapper gets `bg-court-surface-subtle`, the filter aside drops its own `bg-court-surface` so the wrapper tint shows through, and the iframe section becomes a contained card (`overflow-hidden rounded-2xl bg-court-surface` + soft long-shadow).

### Sub-revert: drop client avatar palette change from batch 2 (`1e3054a`)
- `clients-view.tsx` — surgical revert of the colorful A-Z avatar palette + helpers that batch 2 imported. Client grid cards are back to rendering `<ClientLogo>` (Google favicons + initials fallback). All other items from `32d4c44` stayed intact.

### Final batch: candidate split view column widths + scoreboard KPI icons (`bebbe50`)
- `candidates/page.tsx` — outer left list locked to `w-64 flex-shrink-0`. Dropped `listWidth` state, the localStorage persistence, the drag handlers, the resizer separator, the iframe `pointerEvents` override, and the now-unused `useCallback` import.
- `candidates/[id]/page.tsx` (embed mode) — right aside switched from `w-[280px] shrink-0` to `w-72 flex-shrink-0`. Inserted `<ResumeMatchesRail>` between CompactOverview and EditableSkills so highlighting stacks inside the right panel below the candidate info instead of competing with the resume for horizontal space.
- `candidates/[id]/editable-resume.tsx` — ripped out the inline highlighting `<aside>` and its wrapper flex-row plus `TOKEN_COLORS`, `buildTokenColorMap`, `ResumeMatchesPanel`, `MarkedSnippet`, `useSearchParams`, and `parseHighlightTokens`. Removed `[height:calc(100vh-200px)]` from both PdfCanvasViewer and DocxPreview so the resume iframe fills its container with no max-height cap.
- `candidates/[id]/resume-matches-rail.tsx` (new) — houses the moved highlighting panel; renders colored token chips + `ResumeMatchesPanel` against the most-recent resume.
- `scoreboard.tsx` — imported `Clock`, `DollarSign`, `Target`, `TrendingUp`, `Users` from lucide-react. Each of the 5 KPI tiles now carries an icon: Pipeline Value=TrendingUp, Avg Fee Size=DollarSign, Placements=Users, Win Rate=Target, Avg Days to Fill=Clock. `ScoreboardKpiTile` renders the icon in an `h-5 w-5 rounded-lg bg-court-brand-tint` chip top-left next to the label so the Scoreboard reads as one family with the canonical `KpiTile` on Clubhouse / Finances.

## Known Issues That Carried Into Ace 54 (historical, mostly resolved this session)
- ComposeFAB New Reminder entry — restored.
- Applicants + pipeline page green background leaks — fixed.
- Oversized Goal Pacing — fixed.
- Invoice empty cells — em-dash placeholders added.
- Trigger warning alerts — added.
- Texting Add Number inline button — added.
- Resume highlight right panel — removed.
- Notes feature — built (see What Shipped above).

## What Shipped in Ace 51.0 (2026-05-17)

Big-haul session. Resume storage moved off Postgres bytes to Vercel Blob; bulk email landed end-to-end on the candidate search surface and the per-job Matches tab; Gmail push notifications are live (no more polling-tab dependency); Microsoft Teams OAuth + Teams meetings as an interview option; Triggers UI for per-trigger template + approve-before-send; Find Matches now reads explicit searchKeywords off the job; candidate search rows + resume viewer got a keyword highlighting + snippet polish pass.

### Vercel Blob migration — resume bytes off Postgres
- **Schema + write paths (`ec6fc03`, `7040d1e`).** `CandidateResume.blobUrl` + `redactedBlobUrl` columns added. Upload, brand-resume, and generate-resume write paths now `put()` to Vercel Blob and persist the URL; the legacy inline `data` / `redactedData` columns stay nullable for the duration of the migration. Delete cleans up the Blob before dropping the DB row so we don't leak orphan objects.
- **Read paths + private-access fix (`657589e`, `0ed462f`).** New `getResumeBytes(url)` helper in `src/lib/resume-blob.ts` resolves blobUrl-first with a Postgres-bytes fallback; every read path (PDF viewer, redacted variant, submittal attachment, AI Workspace ingestion) routes through it. Private Blob reads need `get(url, { access: "private" })` — the by-id route was failing on the public default. `55a9471` fixes the by-id route to serve the redacted variant off `redactedBlobUrl` when the request asks for it.
- **Backfill script (`a5e171c`).** `scripts/migrate-resumes-to-blob.ts` walks every `CandidateResume` row, uploads the existing bytes to Blob, sets `blobUrl` (+ `redactedBlobUrl` if redacted bytes exist), and nulls the inline columns. Idempotent; safe to re-run.

### Bulk email to candidates — search surface + Matches tab
- **Search-surface dialog (`1074402`).** New `BulkEmailDialog` in `src/app/candidates/bulk-dialogs.tsx`. Multi-select on `/candidates`, click Email → modal wraps `EmailComposer`. Recipients resolved server-side from each candidate's email-on-file via `bulkSendEmail`. Per-recipient merge field resolution (Candidate First Name, Last Name, Current Title, Current Company). ActivityLog row per successful send.
- **Hidden To/Cc/Bcc + > 25 confirm gate (`21d09b2`).** Composer hides recipient inputs (`hideRecipientFields`) so the recruiter can't accidentally type the wrong address. Sends > 25 trigger an explicit "Are you sure?" overlay.
- **Generate/Edit with Claude + view recipients + job picker (`04de163`, `df3c6fd`, `07d173e`).** AI prompt panel above the composer drives Generate. Recipients panel toggle shows the resolved list with "no email on file" warnings. Templates that reference `[Job Title]` / `[Client Company Name]` etc. open a job picker; the picker uses the same two-step flow the individual composer uses. Earlier hang where the picker spun indefinitely was a missing resolve on the error path — fixed.
- **Bulk email from per-job Matches tab (`993f7b9`).** Same dialog wired into `/jobs/[id]?tab=matches` so the recruiter can bulk-email a vetted match set without leaving the job.
- **Template picker rebuilt to match individual composer (`a3136d9`, `7696634`, `384b60c`).** Imperative `applyDraftRef` on EmailComposer replaced with declarative `externalDraft` prop (the ref silently no-opped when `.current` was unset). The footerExtras select went through several iterations and is now an anchored button + popover matching `mail-composer.tsx`'s pattern; job picker swaps the popover content inline instead of a separate modal. `applyTemplateDraft` pre-resolves job tokens via `applyMergeFields` so the composer shows the real role name, not `[Job Title]` placeholder. `subtitle="To: N selected candidates"` shows the recipient count under the title.
- **Status:** template picker rewrite is on `main` at `384b60c`. Pending Andrew's browser verification.

### Gmail push notifications — webhook + watch + auto-renew
- **Push receiver + watch registration (`0bbb172`).** `/api/webhooks/gmail` accepts Pub/Sub push messages, decodes the base64 envelope, resolves the userId from `emailAddress`, runs a history-id delta against the stored `Account.gmailHistoryId`, and fires `sendPushToUser` per new thread. `users.watch` registration + Pub/Sub topic wiring lives behind a Settings ▸ Notifications toggle. Auto-renew cron at `/api/cron/gmail-watch-renew` re-arms before the 7-day expiration window so push doesn't silently die.
- **Service-worker badge refresh (`01884fb`).** Push handler in `public/sw.js` posts to all visible clients via `client.postMessage({ type: "GMAIL_PUSH" })`; mail context listens and bumps the unread query immediately instead of waiting on the 30s poll. Closes the Ace 50 known issue.

### Microsoft Teams OAuth + meeting type selector
- **Microsoft OAuth + connector card (`b6e788e`).** `MicrosoftToken` Prisma model (access + refresh + expires + scope, org-scoped). `/api/auth/microsoft/start` + `/api/auth/microsoft/callback` run the Graph API consent flow. Teams card added to Settings ▸ Connectors with Connect / Disconnect actions and a status pill.
- **Meeting type selector on interview scheduler (`9f73483`).** New `meetingType` field on the schedule modal — `Google Meet` (default) or `Microsoft Teams`. Teams branch hits `POST /me/onlineMeetings` via Graph API, returns the join link, and embeds it into the calendar event the same way the existing Meet path does. Removes the Google Meet anonymous-access workaround for client-side recruiters whose orgs are MS-shop.

### Triggers UI — per-trigger template + approve-before-send
- **TriggerRule model + Settings UI (`fb25d58`).** New `TriggerRule` Prisma model (per-org, per-trigger). Settings ▸ Triggers renders the available triggers with enable/disable toggle, template selector (from active templates), and approve-before-send checkbox per rule. Foundation for surfacing template sends as drafts the recruiter eyeballs before launch.

### Template send-as-draft (Gmail Drafts vs Send)
- **`sendAsDraft` flag honored end-to-end (`9944f10`).** Template send path checks the rule's `sendAsDraft` flag and routes to `createGmailDraft` instead of `sendGmail` when on. Andrew can stage a template, draft it for review, then send manually. Closes Active Sequence item 2 from the Ace 50 roadmap.

### Find Matches keyword scoring + Job Description tab additions
- **`searchKeywords` field on jobs (`a2c43cf`, `a63b482`).** New `Job.searchKeywords String[]` column. Editable on the Job Description tab as a tag-input. Find Matches scoring now weights candidates whose resume / experience text overlaps these keywords; same field also seeds the Boolean search default for that job. Replaces the old "the description text drives matching" implicit signal with an explicit recruiter knob.
- **Internal notes on the JD tab (`a63b482`).** Free-text Internal Recruiter Notes block (org-private; never exposed to candidates / public board). Saves on blur via the same pattern as the Notes field on Overview.
- **Keyword scoring in candidate search (`a63b482`).** The candidate search route now ranks results by the explicit-keyword overlap when the user is searching from a job context. Stable ordering for the recruiter who's iterating filters on the same role.

### Candidate search polish + PDF keyword highlighting + resume snippets
- **Row breathing room + readable snippet (`d0d33d5`).** Candidate search rows on `/candidates` got more vertical padding, a heavier name, and a snippet line that reads at the same weight as body copy instead of a muted footer.
- **PDF keyword highlighting via pdfjs text layer (`5605b0c`, `c947319`, `65507c2`, `63fb997`).** The resume viewer in the candidate split-view now overlays `<mark>`-style highlights on every matched search token by hooking into pdfjs's text layer DIVs. Word-boundary matching (so "ax" doesn't highlight inside "tax"), reduced opacity, multiply blend mode so the highlight reads against the PDF without obscuring the text. Falls back to an extractedText snippet panel when PDF alignment fails (scanned-image PDFs).
- **Resume match snippets panel (`8867d75`, `1dadfde`).** Multi-color snippet panel renders beside the PDF (not below) on the candidate profile embed view. One color per keyword so the recruiter can scan which tokens hit where without re-reading the full resume.

### Mobile UX polish
- **Settings nav horizontal pill strip (`9143c92`).** Closes the Ace 50 known issue. All 11 Settings categories now render as a horizontally-scrollable pill strip below `lg` (same pattern as `MobileBucketTabs` on `/phone`) instead of stacking vertically above the panel content.
- **BD tab in mobile PWA nav + Boolean search clip fix (`f44ea28`).** BottomNav was missing the BD entry on mobile; added. Boolean search input on `/candidates` was getting horizontally clipped under the mobile filter sheet — input width corrected.

## Known Issues Carrying Into Ace 52
- **Bulk email template picker pending browser verification.** The `384b60c` rewrite (anchored Use Template popover + in-popover job picker + `externalDraft` declarative sync) compiles and lands on `main` but Andrew has not yet eyeballed the live flow end-to-end. First task next session: test, confirm, then move to candidate-lists bulk email.
- **Candidate lists bulk email not built yet.** Bulk email currently only ships from `/candidates` search and `/jobs/[id]?tab=matches`. Sending from a saved Candidate List queued — next session after bulk-email verification.
- **`design/phase-1` branch has Cursor UI redesign Phases 1-2 not merged to main.** Local branch carries `86d3e31` (Phase 1 design system foundation), `38f119c` (Phase 2a card shells on dashboard / placements / finances), `d7f5437` (Phase 2b TableRow + TableCell on list views), `c0fb973` (Phase 2c sidebar polish + list table chrome). Not yet merged; review pending. Treat the branch as in-progress experimental work — `main` is the source of truth for everything in this 51.0 entry.
- **Mac PWA still not appearing in System Settings > Notifications** (Chrome PWA registration quirk on macOS — carried from Ace 50, not code-related).
- **Unread badge count still drifting in places.** The mail-side fix from this session (push-driven refresh) handles the Gmail leg; Quo + reminder legs still need an audit pass before the aggregate is provably correct.

## What Shipped in Ace 50.0 (2026-05-16)

Cumulative roll-up of every commit between the Ace 49.0 close (`80fdbbf`) and the 50.0 close (`93272a0`). Design overhaul polish pass is now substantially done — the remaining items moved to the queued list on the roadmap.

### Court Mode — dark theme rebuild (Clay + Grass) + hover dropdown fix
- **Clay + Grass dark tokens rebuilt on a neutral canvas (`e3f3af3`).** Old dark variants had brand-green bleed into surface, surface-subtle, and border tokens which made every panel read as a different green wash. Replaced with court-neutral grays so the brand-green only appears where it's intentional (primary buttons, active nav, brand pills). Hard / Grass / Clay all share the same dark canvas now; brand hue is the only differentiator between modes.
- **Dropdown hover rows visible in dark Court themes (`72f848a`).** `<option>` hover in dark mode resolved to `bg-court-surface-subtle` on `text-court-fg`, both reading as the same near-black — the hovered row went invisible. Hardcoded a contrasting hover bg + fg pair on every `<select>` option across the app so the row is always visible regardless of which Court palette is active.

### Tables / lists / segmented controls polish
- **Candidates + Jobs table row styling tightened (`abe0438`).** Subtle hover (no full-row tint), softer dividers (`border-court-border/40`), card border weight reduced. Stops the row from feeling like a button while still indicating hoverability.
- **Client detail tabs migrated to canonical `TabStrip` (`690d803`).** Removes the one-off underline implementation; tab strip language is now consistent with /jobs, /candidates filter rails, dashboard period tabs, and /finances.

### Spacing + border + shadow reduction (`2bc4e14`)
- 65 panel / card / sub-panel wrappers softened from `border border-court-border` → `border border-court-border/40` across /clients, /jobs, /pipeline, /candidates (33 files). Skipped table wrappers, buttons, inputs, chips, floating dropdowns, focus-within input wrappers, and modal dialogs.
- Top-level `p-8` page wrappers normalized to `px-6 py-6` (only `/offline` had the legacy padding).
- `hover:shadow-md` on hoverable cards → `hover:shadow-sm` (client cards, metric link tiles, calendar day/week event pills). Floating-UI resting `shadow-lg` (dropdowns, popovers, phone FAB, PWA install banner, minimized composer tray) untouched per the floating-panels exemption.

### Dashboard — KPI tiles + panel chrome unified
- **KPI tiles match exact spec across Clubhouse / Scoreboard / Invoices (`2f33230`).** Canonical `KpiTile` already matched; Scoreboard's local `ScoreboardKpiTile` dropped its third sub-line (moved to wrapper `title` for hover context). Shadow alpha normalized 0.06 → 0.08 so resting tiles all match.
- **Big dashboard panels unified to `rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]` (`2f33230`).** Covers Billing Tower, Today's Briefing, This Week, Scoreboard (Funnel / Cash / Lists / Goal pacing), Placements (ledger / breakdowns / map), Finances (PnL / Margins / Subs / ROI / MOC / Trend / Revenue panels), and the Invoices table panel. /candidates /jobs /clients /pipeline panels intentionally untouched.

### Billing Tower + Finances revenue math
- **Outstanding folds in uninvoiced placements (`e0bdbbe`).** Outstanding now reads "SENT invoices + all uninvoiced placements" so locked-fee placements that haven't been invoiced yet don't disappear from the open-billing surface. Revenue holds at "collected" only on this tile.
- **Revenue = PAID invoices this quarter + this-quarter uninvoiced placements (`0ac1810`).** Revenue tile now matches "fees earned this quarter" rather than "cash in hand." Eyebrow meta reads `X placement(s)` regardless of invoice status.
- **Goal Progress denominator aligned to revenueUsd (`5681b9f`).** All three Billing Tower tiles (Revenue / Outstanding / Goal Progress) now read off the same source figure so the percentages stay numerically consistent — switching to billedThisQuarter let Goal % drift below Revenue the moment an uninvoiced placement landed.
- **Finances tab folds uninvoiced placements into KPI + By Client + By Source + Trend + P&L (`0bcc7eb`).** Single revenue definition across the dashboard and the Finances page; recruiter no longer sees three different "revenue this quarter" numbers depending on which surface they're on.

### Map + Ace Assistant fixes
- **Edit Placement drawer renders above the Leaflet map (`f100a8e`).** City field added for map refresh; drawer z-index bumped to `z-[1100]` so it sits above the Leaflet pane on the Placements tab.
- **Ace Assistant clamped to viewport during drag + on window resize (`975f296`).** Drag math previously allowed the panel to slide off the right/bottom edge when the user dragged past the viewport or resized the window with the panel near an edge; now it bounces back into the visible area.

### From selector on mail composer + invoices
- **Mail composer From dropdown (`5bc2533`).** New `/api/mail/send-as-aliases` route hits `gmail.users.settings.sendAs.list`, returns primary + accepted-verification rows. `MailComposer` renders the dropdown when more than one alias exists; `sendAsEmail` threads through send/draft/reply routes and drives the Gmail `From:` header.
- **Invoice "Sent from" selector + Gmail wiring (`82ef66e`).** New `Invoice.sendFromAlias String?` column persists the per-invoice From choice. The Sent from panel on `/invoices/[id]` is now a dropdown that defaults to the billing AR email when it's a verified alias. The composer carries the selection through to the actual Gmail send — invoice Draft Email opens with the AR@ alias pre-selected.

### SMS — silent-fail diagnostics + organizationId stamping + thread refresh
- **Quo sends no longer report "sent" when the carrier rejects (`95e6de4`).** `sendSms` returns a structured `QuoSendResult` with httpStatus, parsed body, messageId, and providerStatus. Treats `data.status` of `undelivered` / `failed` as a send failure even on 2xx. Logs full request payload (sans API key) and full response body on every dispatch. `/api/sms` normalizes `toNumber` to E.164 before dispatch + persistence; persists `status: 'failed'` when the result isn't ok; returns `providerStatus` + `providerError` so composer banners can surface the actual carrier reason.
- **Outbound row stamps organizationId; `/phone` detail pane refreshes on send (`a437ce1`, `2951bfb`).** Previously rows were written with `organizationId: null`, which made them invisible to `/api/phone/thread/[id]` (which filters by org for tenant isolation) — outbound bubbles only appeared in the un-scoped candidate sidebar. `/api/sms` POST now resolves org from the candidate (when linked) or `getCurrentOrg()`. Belt-and-suspenders: new `PHONE_SMS_SENT_EVENT` window event dispatched from every composer (`NewTextPanel`, `SmsComposer`, `InlineSmsComposer`, toast quick-reply); `PhoneView` subscribes directly and bumps `detailRefresh` so the open thread re-fetches even if a composer's `onSent` callback chain breaks in the future. Strips `cand:` / `unk:` thread-id prefixes off `candidateId` before persistence so unknown-thread sends don't corrupt the column.
- **QUO_FROM_NUMBER guard relaxed (`2951bfb`).** Previous guard aborted dispatch when only `QUO_PHONE_NUMBER_ID` was set, even though OpenPhone accepts either identifier alone. Now we abort only when both are unset (or when `QUO_API_KEY` is missing) and only include `from` in the payload when it's set. Module-init log surfaces which Quo env vars actually reached the build.
- **Outbound bubble font + color polish (`f1a251d`, `93272a0`).** `/phone` and candidate sidebar outbound bubbles swapped `bg-[#5A9642]` / `bg-emerald-600` → `bg-brand text-white` so the bubble re-skins with Court Mode and stops violating the no-hardcoded-hex rule. `font-sans` already pinned on both surfaces (pre-existing iOS Safari first-paint mitigation).

### Phone — New Text recipient search + MMS image rendering
- **New Text recipient typeahead searches the full Candidate + Contact set (`9a8848a`).** New tenant-scoped `GET /api/phone/people-search?q=…` route hits Candidate (firstName/lastName/email/phone) and Contact (firstName/lastName/name/emails text[]/phoneNumbers Json via raw cast). Flat-maps each Contact's `phoneNumbers` to one row per number; digit-substring queries surface only matching numbers. Wired into the `NewTextRecipientInput` inside `NewTextPanel` AND the global ComposeFAB phone picker (hits above recents, de-duped against any recent thread for the same digits).
- **MMS images render inline in SMS bubbles (`9a8848a`).** New `SmsMessage.mediaUrl String?` column. Quo webhook scans `data.object.media[].url` array + falls back to `data.object.mediaUrl` / `data.object.media_url`. Both bubble surfaces (`/phone` ThreadDetailPane and candidate/client profile `<TextingExchanges>`) render an `<img>` wrapped in `<a target="_blank">`. Image renders above the text body; image-only rows suppress the empty body div.

### Candidate profile polish
- **Action row hierarchy (`e7510a8`).** New top-level Submit to Job (primary green) prepended so order reads Submit → Apply → Keep → Add Note → Add to List, with Submit reading as the affirmative action. `PlacementActionsIsland` always mounted in the non-embed view (was gated on `placementJobs.length > 0`) so the openSubmit deep link works even when the candidate has no placements yet. Reject stays inside the per-job pipeline row — no top-level Reject affordance.
- **Compact overview field typography (`e7510a8`).** Label drops `font-medium`, `tracking-wider` → `tracking-wide`; value `text-xs` → `text-sm`. The dl already used `gap-y-2` with no per-field borders so spacing is the only separator.
- **Pipeline row strip lighter (`e7510a8`).** Dividers → `divide-court-border/40`. Rejected / cancelled rows render at `opacity-50` (hover restores full opacity so they stay interactable). Client name + interview-date metadata shrinks to `text-[11px]` so the job title carries the row.
- **Breathing room below AI Workspace (`0060032`).** Floating Delete button no longer crowded.

### Lead Source field + unified options
- **Lead Source persists end-to-end on the placement modal + dashboard (`fb6a62f`).** Field now writes through every save path and round-trips into the placement ledger + dashboard breakdowns.
- **Shared Lead Source list across the pipeline drawer + placement modal (`82a02b4`).** Single options array sourced from one module so the drawer and the modal can't drift; new sources only need to land in one file.

### Misc polish
- **Spotify glyph swapped in for the lucide music icon in the topbar (`4a083d7`).** Matches the real Spotify panel's brand glyph.

## Known Issues Carrying Into Ace 51
- **Gmail push notifications require Google Pub/Sub buildout.** Mail is currently polled via `src/lib/mail-context.tsx` and the push relay only fires when at least one Ace tab is open + polling. True offline mail push needs a `users.watch` + Pub/Sub topic subscription with a server endpoint that fires `sendPushToUser` on each new-message event. Real piece of work, own phase.
- **Notification read state for Quo: reading in Quo doesn't clear the Ace badge.** Quo doesn't ship a read-receipt webhook event so Ace can't observe when a thread is read on the Quo side; the unread count stays inflated until the recruiter opens the thread inside Ace. Workaround would be either a periodic Quo API poll (rate-limit risk) or a manual "Mark as read in Quo" affordance.
- **Settings nav on mobile is functional but tall.** Currently stacks 11 category links vertically above the panel content. Horizontal scrollable pill strip — same pattern as the `MobileBucketTabs` on /phone — queued.
- **`+ New` menu missing Event + Reminder entries.** ComposeFAB currently doesn't surface New Event / New Reminder; both flows exist via the calendar drawer but need to be reachable from the global add affordance. Queued.
- **Unread badge count showing incorrect total.** Sidebar / topbar unread badge surfaces a number that doesn't match the actual unread thread count — likely an off-by-one or stale-cache issue in the count source. Needs an audit pass against the Gmail unread query + Quo unread count + reminder due count to identify which input is drifting. Queued.
- **Mac PWA not appearing in System Settings > Notifications** (Chrome PWA registration quirk on macOS — not code-related).

## What Shipped in Ace 49.0 (2026-05-15)

### PWA — manifest, install prompt, service worker, real Ace logo
- **Manifest + install prompt.** `public/manifest.json` (Ace by BreakPoint, brand-green theme, portrait-primary, standalone), wired through the Next 14 Metadata API in `src/app/layout.tsx` (`metadata.manifest`, `metadata.appleWebApp`, `viewport.themeColor`). New `<PwaInstallPrompt />` listens for `beforeinstallprompt`, gated on mobile + non-standalone, renders a dismissible bottom-of-screen banner with Install + × actions via the canonical Button variants. Manifest URL bumped to `?v=3`; icon paths bumped to `?v=2` so the placeholder green "A" can't survive in any CDN / SW / installed-PWA cache after the real logo lands.
- **Real Ace icons.** Placeholder green "A" replaced with the line-art tennis swoosh + ball-end dot from `public/ace-mark.svg`, recolored white on the brand-green canvas, scaled to ~70% of canvas and centered inside the 80% safe zone for Android adaptive maskable cropping. Generated by a one-off Node script (sharp installed `--no-save` so neither `package.json` nor the lockfile was touched). Outputs at `public/icons/icon-192.png` (~2.1 KB) and `public/icons/icon-512.png` (~6.6 KB).
- **Service worker offline shell + asset caching.** `public/sw.js` cache name `ace-shell-v1`. On install: precache `["/", "/offline"]`. On fetch: cache-first for `/_next/static/` + `/icons/`, network-first for `/api/`, network-first with `/offline` fallback for navigation. On activate: purge stale cache names + `self.clients.claim()`. New `src/app/offline/page.tsx` renders a centered "You're offline" message using court tokens. `<SwRegister />` mounted in layout; silently re-syncs an existing pushManager subscription on register when permission is already granted — never auto-prompts.

### Push notifications — wired to every existing trigger
- **`PushSubscription` model + endpoints.** New Prisma model: cuid id, indexed userId + organizationId, unique endpoint, p256dh + auth, optional userAgent, createdAt. Back-relations added on User + Organization. Schema synced via `prisma db push` (the project doesn't use migrations). New API routes: `/api/push/subscribe` (upsert by endpoint, tenant-scoped via getCurrentOrg), `/api/push/unsubscribe` (delete by endpoint, scoped to caller's userId), `/api/push/fire` (client-fired relay used by mail + reminder triggers — resolves session, dispatches via `sendPushToUser`).
- **`sendPushToUser` + `sendPushToOrg` in `src/lib/web-push.ts`.** VAPID details lazy-configured; missing env collapses to a no-op so callers never need to guard. Best-effort dispatch with 410/404 auto-purge of dead subscriptions and full server-side `console.error` on other failures.
- **Push wired alongside every existing in-app toast.**
  - **Quo SMS** (`message.received` / `new_sms_or_mms`): title = "New text from <name>", body = first 100 chars, url = `/phone?candidateId=<id>` or `?from=<number>`, tag = `sms-<candidateId|digits>`.
  - **Quo calls** (`call.completed` / `new_call`, inbound only): "Missed call" when duration ≤3s else "Call ended", body = caller name + `M:SS`, url = `/phone?call=<callLogId>`, tag = `call-<callLogId>`. Outbound calls skipped.
  - **Mail** (`src/lib/mail-context.tsx:112` after `renderNewMailToast`): POST to `/api/push/fire` with sender + subject + thread deep-link, tag = `mail-<threadId>`.
  - **Calendar reminders** (`reminder-toast-provider.tsx:59` after `fire(r)`): POST with the reminder title + ET-formatted time + `/calendar` deep-link, tag = `reminder-<reminderId>`.
- **Per-user routing for Quo.** No `Inbox` model in the schema — closest ownership signal is `Candidate.createdById`. SMS + call branches route via `sendPushToUser(candidate.createdById, orgId, payload)` when a candidate matches the inbound number; unknown-number / shared-line fall through to `sendPushToOrg`.
- **Enable / Disable toggle in Settings → Notifications.** `PushPermissionButton` distinguishes browser permission state from server-side subscription presence. Granted + active subscription → green Check pill "Enabled on this device" + Disable button. Disable hits `/api/push/unsubscribe` server-first (so the row is gone even if `subscription.unsubscribe()` hangs), then revokes the browser subscription. Errored state shows "Couldn't enable notifications" header + Try-again button + "Check browser notification settings if this persists." hint, and wins the render branch over `granted` so a non-2xx `/api/push/subscribe` can't leave the UI claiming success. Section was moved to be the **first** block inside the Notification Preferences collapsible.
- **Double-fire suppression in the SW.** Push handler now calls `self.clients.matchAll({ type: "window", includeUncontrolled: true })` before `showNotification` and short-circuits when any same-origin window is `visibilityState === "visible"` — recruiter looking at Ace gets only the in-app toast, no redundant OS notification. `notificationclick` focuses an existing tab if one's open and `client.navigate(url)`s it; otherwise opens a fresh window at the payload's deep-link.
- **VAPID base64url decode fix.** `urlBase64ToUint8Array` was byte-for-byte correct; the real `InvalidCharacterError` from `atob` was wrapping quotes / trailing newline in the env-var paste. Added defensive `.trim().replace(/^"|"$/g, "")` at the call site so Vercel paste artifacts can't blow up the decode again.
- **Safari iOS push gesture fix.** `pushManager.subscribe()` was sitting behind two `await`s (`Notification.requestPermission()` → `navigator.serviceWorker.ready` → `subscribe`); iOS Safari rejected with NotAllowedError because the user-gesture flag was gone by the time subscribe ran. Restructure: cache `ServiceWorkerRegistration` in a `useRef` on mount, drop async/await in `enable()`, call `reg.pushManager.subscribe({ userVisibleOnly: true, ... })` synchronously in the click frame (it handles the permission prompt internally), chain the rest via `.then()`.
- **PWA badge updates immediately on push notification arrival via service worker message relay** (`sw.js` → `mail-tab-title-sync` → mail/phone context refetch). Previously the badge only moved on the 30s `MailContext` / `PhoneContext` poll, so a push that arrived while Ace was closed had no visible home-screen indicator until the user opened the app and waited a tick. The SW push handler now calls `self.navigator.setAppBadge()` after `showNotification` and `postMessage({ type: "PUSH_RECEIVED" })` to every open window; `MailTabTitleSync` rebroadcasts as `ace:refresh-unread` and both providers refetch on the same tick.

### Mobile UX pass
- **Topbar collapse.** Below `md` the topbar wraps to two rows: icon row (h-14) + full-width search row via `order-last w-full md:order-none md:w-56` on the search wrapper — single `TopBarSearch` instance, no duplicate state. Weather widget + date pill stay visible on mobile (temp text gated `hidden min-[360px]:inline` so sub-360px viewports drop the "60°" rather than wrapping). YouTube + Spotify hidden via `hidden md:inline-flex`; ComposeFAB + Ace Assistant stay. md+ unchanged.
- **Dashboard 1-column grid.** `my-dashboard.tsx` 6-tile KPI strip (`grid-cols-2 sm:grid-cols-3 md:grid-cols-6` → `grid-cols-1 sm:grid-cols-3 md:grid-cols-6`); 5-col ThisWeek + NewsFeed layout collapsed to `grid-cols-1 md:grid-cols-5` with child col-spans gated to `md:`. Scoreboard KPI strip same pattern. `/clients`, `/jobs`, `/pipeline` were already responsive.
- **Candidates split-view tap-to-expand.** When a candidate is selected on mobile, the list column + resizer get `hidden md:flex` / `hidden md:block` — the iframe profile fills the viewport flush. X / "All Candidates" inside the iframe return to the list. md+ keeps the resizable split.
- **Mobile filter sheet on `/candidates`.** New "Filters" button (with active-category count badge — counts groups, not chips) appears next to the count strip below md. Tapping opens the existing filter rail as a full-screen sheet via a `md:contents` wrapper, with a sticky header (close X) and footer (Reset / Apply) rendered `md:hidden`. Single mount keeps filter state coherent — the same aside renders inline on desktop and inside the sheet on mobile. Aside width responsive: `w-full md:w-[220px]`.
- **Phone — horizontal bucket tabs + dial pad FAB.** New `MobileBucketTabs` at the top of `/phone` renders all 9 buckets (All / Texts / Calls / Missed / Voicemails / Candidates / Clients / Unknown / Needs Reply) as a horizontally scrollable pill row; left sidebar nav becomes `hidden lg:flex`. Thread list and detail toggle on mobile based on `selectedId`: list fills viewport when no thread selected; detail fills viewport when one is, with a new `onBack` prop on `ThreadDetailPane` rendering a `ChevronLeft` button (md:hidden) for return. Green FAB (`h-14 w-14`, brand-green, PhoneCall icon) fixed bottom-right when no thread is selected — calls `phonePanels.openDialPad()`. `DialPadModal` now full-screen on mobile while keeping the centered modal feel at md+.
- **Mail composer full-screen sheet.** Inline `composerNode` wrapped in `<div className="fixed inset-0 z-50 flex flex-col bg-court-surface md:contents">` so on mobile it renders as a full-screen overlay and at md+ the `md:contents` makes the wrapper inert (composer renders inline exactly as before). One MailComposer instance, two layout modes — no duplicate debounced editors. Existing close X handles "Cancel"; Send fires the existing handler.
- **Settings nav mobile visibility.** Settings sub-nav was `hidden lg:block` in `src/app/settings/layout.tsx`, which meant mobile users landing on `/settings` (redirects to `/settings/appearance`) had no way to navigate to other categories — they saw only Court Mode. Dropped the `hidden` class; on mobile the nav stacks above content via the existing parent `flex-col lg:flex-row`. Functional but tall — a horizontal pill strip is queued.

### Composer + misc fixes
- **Generate with Claude — multi-block response parsing.** `/api/mail/ai-compose` was reading `response.content[0]` and 502'ing "Claude returned no content" whenever Claude used the `web_search` tool — the first content block in that case is `server_tool_use`, not `text`, so the actual draft sitting two slots later was discarded. Now `filter((b) => b.type === "text").map(b => b.text).join("\n\n")`. Empty-content branch logs `stop_reason` + block types and returns stop-reason-aware copy ("Claude hit the response length limit before writing a draft", "Claude got stuck mid-tool-use", etc.). Catch block logs full SDK errors server-side. Added explicit `ANTHROPIC_API_KEY` env-presence check at the top so a misconfigured Vercel surfaces useful copy instead of a generic 401.
- **Edit with Claude — same fix.** `/api/email/edit-with-claude` had the identical `content[0]` bug + `web_search` enabled — patched identically.
- **Generate with Claude — chevron flipped.** Trailing chevron now matches the sibling buttons (Use Template / Insert Field / Edit with Claude) on the composer row.
- **SMS thread font.** Pinned `font-sans` explicitly on both bubble surfaces (`texting-exchanges.tsx` and `phone-view.tsx`) so the message body always picks up Inter — iOS Safari can drop the `next/font` CSS variable on first paint, falling back to `system-ui` which reads as a different / mono-ish font.
- **Pending-start row actions trimmed.** Cancel + Reject removed from the `pending_start` branch in `pipeline-row-actions.tsx`. Only Edit Placement + Confirm render now — cancellation flows through Edit Placement (which already has the reason picker the row-level Cancel never offered), matching the recruiter mental model that a pending-start candidate has been placed and only "they started" / "open the placement to edit" are valid intents.

## Known Issues Carrying Into Ace 50
- **Gmail push notifications require Google Pub/Sub buildout.** Mail is currently polled via `src/lib/mail-context.tsx` and the push relay only fires when at least one Ace tab is open + polling. True offline mail push needs a `users.watch` + Pub/Sub topic subscription with a server endpoint that fires `sendPushToUser` on each new-message event. Real piece of work, own phase.
- **Notification read state for Quo: reading in Quo doesn't clear the Ace badge.** Quo doesn't ship a read-receipt webhook event so Ace can't observe when a thread is read on the Quo side; the unread count stays inflated until the recruiter opens the thread inside Ace. Workaround would be either a periodic Quo API poll (rate-limit risk) or a manual "Mark as read in Quo" affordance.
- **Settings nav on mobile is functional but tall.** Currently stacks 11 category links vertically above the panel content. Horizontal scrollable pill strip — same pattern as the `MobileBucketTabs` on /phone — queued.
- **`+ New` menu missing Event + Reminder entries.** ComposeFAB currently doesn't surface New Event / New Reminder; both flows exist via the calendar drawer but need to be reachable from the global add affordance. Queued.
- **Unread badge count showing incorrect total.** Sidebar / topbar unread badge surfaces a number that doesn't match the actual unread thread count — likely an off-by-one or stale-cache issue in the count source. Needs an audit pass against the Gmail unread query + Quo unread count + reminder due count to identify which input is drifting. Queued.
- **Mac PWA not appearing in System Settings > Notifications** (Chrome PWA registration quirk on macOS — not code-related).

## Next Task
Design overhaul polish pass is substantially complete after Ace 50.0 (dark token rebuild, tables/lists, segmented controls, spacing + border reduction, dashboard cards, candidate profile polish, outbound bubble colors). Ace 51 opens on **Vercel Blob migration** as the first numbered priority. Order after that:
1. **Vercel Blob migration** — move uploaded resumes / agreements / candidate files off Postgres-stored bytes onto Vercel Blob storage with signed URLs.
2. **S3 backup cron** — nightly Neon → S3 dump for disaster recovery before we open the door to real client data.
3. **Template send-as-draft** — when sending from a template, write to Gmail Drafts instead of Send so Andrew can eyeball before launch.
4. **Quo setup wizard** (future) — first-run flow for Quo API key + default inbox selection + outbound number assignment, so new orgs aren't editing env vars.
5. **Teams interviews** — Microsoft Teams meeting link generation on Interview create (currently Google Meet only).
6. **Resizable split view** — drag-to-resize divider between the candidate list and the candidate detail pane on `/candidates`.
7. **Invite flow polish** — finish the invite flow back-button preservation work started in Ace 35.x.
8. **Bulk email to candidates** — multi-select on candidate list with a "Email selected" action that opens a composer with all addresses BCC'd.
9. **LinkedIn import via RapidAPI** (future) — backfill candidate profiles from a LinkedIn URL via a RapidAPI scraper provider.

## What Shipped in Ace 48.0 (2026-05-15)

### BD Engine — approval cards, settings, replies
- **BD history on approval cards.** Each company row on `/bd/launch` now shows a prior-outreach count pulled from the BDRun + BDActivity history so the same target doesn't re-enter the queue silently. Surfaces above the approve button so the recruiter can spot recycled targets at a glance.
- **Fresh contact suggestions on approval cards with remove/swap.** Inline preview of Apollo-matched contacts for each company on the approval card with remove + swap affordances before the recruiter clicks Approve & Enroll. Andrew can drop a Partner that's already been hit and swap in someone untouched without leaving the queue.
- **Real Apollo mailbox data in Sending Domains.** Reputation bar (hardcoded `85` since Phase 3) is gone. New `src/lib/bd/apollo-email-accounts.ts` fetches `GET /api/v1/email_accounts` with `X-Api-Key: APOLLO_API_KEY` on the BD settings server render. Each `SendingDomain` row matches by domain part of the Apollo email and renders Connected/Disconnected pill + Daily limit + Sent today. Silent degrade to "—" when the call fails or no key is configured.
- **Verticals & Saved Searches simplified.** `SavedSearchCriteria` stripped from 7 fields down to 2: `apolloSequenceId` + optional `locationOverride` (blank = nationwide). Form drops Target Titles chip input, City/State/Radius, Company Size min/max, Boolean Keywords, and Min Posting Freshness. `coerceCriteria` silently ignores legacy JSON fields so existing rows load without breaking. Section description updated to "the morning TheirStack discovery run."
- **Contact Targeting editable in Settings > BD.** New `BdContactTargeting` table (org + vertical scoped) replaces the hardcoded title tiers. Three editable tiers (Primary / Small-firm fallback / Practice-specific) + Max per firm. `apollo-contacts.ts` reads from the DB at runtime with the hardcoded defaults as fallback. Enforcement unchanged: prefer primary, small-firm only when no primary returned, max 1 practice-specific.
- **Contact Targeting click-to-delete bug fixed.** Tag input restructured: wrapping `<label>` replaced with `<div>` + explicit row-click → input-focus. Removed `onBlur` auto-commit and Backspace-pops-last-tag so clicks on whitespace never delete a saved tag. X button uses `onMouseDown.preventDefault()` + `onClick.stopPropagation()`.
- **Open in Apollo URL fix.** Apollo sequence link renders `null` instead of a muted disabled span when `s.apolloId` is empty.
- **Test Connection button removed.** Apollo Integration section drops the Test Connection button + `/api/bd/apollo/test` route entirely. The button's ByteString error on env vars containing smart dashes was confusing; the Connected chip already reads the env directly.
- **Reply routing changed to "Prompt to create client on positive reply".** The Auto-create candidate toggle is gone. New `BdOrgConfig.replyPromptCreateClient` (default ON) drives an inline banner on the mail thread when (a) the toggle is on, (b) the thread has the user's "BD" Gmail label, and (c) `BdReplyPromptDismissal` doesn't already record an action. Yes creates a Client with Apollo enrichment (company name + extra contacts) and stamps `GmailThreadTag.clientId`; Skip records the dismissal. New `MailThreadDetail.labelIds` propagates the label set so the client can detect BD without an extra Gmail call.
- **Saved search renamed in DB.** "Public Accounting - Tax Partners - Ohio" → "Public Accounting - Nationwide" via `scripts/rename-public-accounting-savedsearch.ts` (1 row updated).

### Client Signal — fallback provider + Client Monitor scan
- **Client Signal CLIENT_MONITOR daily scan.** `syncClientSignals` (in `client-signal-sync.ts`) runs alongside the discovery cron and asks TheirStack for postings against every Client domain — surfaces an existing-client posting before a competitor does. Upserts under `ClientSignal { source: "CLIENT_MONITOR" }` so the badge separates organic discovery hits from existing-client monitoring.
- **JSearch RapidAPI fallback for Client Signal.** New `src/lib/bd/jsearch-provider.ts` queries JSearch when TheirStack returns nothing for a client domain. Filters returned rows to those whose `employer_website` / `job_apply_link` host matches the client's domain. Upserts under the same `CLIENT_MONITOR` source so the UI doesn't have to learn a new badge. `JSEARCH_API_KEY` added to Vercel project env. Silent degrade when the key is unset or no row matches.

### Clients — profile + Quiet tab + Quo activity
- **Quiet Clients tab on /clients.** New tab between Active and Inactive. Quiet = active client with prior ActivityLog history whose most-recent entry is past 21 days. Brand-new clients with zero log rows are excluded (no history = no signal that the client has gone quiet). Sub-tier chips on each card: 14–30 days quiet / 30–60 days quiet / 60+ days quiet (60+ also absorbs the never-recent set). Sorted stalest first. Server reads cover both Client cuid and stringified legacyRfId targetId conventions.
- **Client logo on profile page header.** Profile header now uses the same domain-based `ClientLogo` as the grid card (Google favicons + initials fallback) instead of the Clearbit-only variant gated on `logoUrl` being backfilled. Older clients without a stored logoUrl now show a real logo.
- **Client Quo call + SMS tagging.** Quo webhook's `message.received` and `call.completed` branches now fall through to a Contact phone match when the candidate lookup misses. New `src/lib/quo-contact-match.ts` scans `Contact.phoneNumbers` JSON (handles `[{number}]` and bare-string shapes) and returns the matching Contact's `clientId` + `organizationId`. Stamped at write-time so client-only conversations land on the client profile without manual tagging. `/api/sms` GET gains a `?clientId=` branch matching `/api/calls`. `<TextingExchanges>` accepts a discriminated `candidateId | clientId` prop matching `<CallLogs>`. Client profile Activity tab gains a "Calls & SMS" section holding both components scoped to clientId. One-shot `scripts/backfill-quo-clientid.ts` ran against the live DB and stamped 2 historical CallLog rows + 1 SmsMessage row.

### Misc
- **Green preview bar compact fix.** Inline preview chip on /bd/launch sizes to content (inline-flex / w-fit) instead of stretching the section width.
- **Vercel CLI bumped** from `51.5.0` → `54.0.0` in `package.json` (standalone commit, no functional change).

## Summary — Ace 47.0
Ace 47 ships the BD Engine Phase 4 + Phase 5 stack end-to-end. The desk now has a real outbound surface: TheirStack discovers public job postings every morning, the approval queue lets Andrew review what the cron found before any contact is touched, Apollo enriches + enrolls the approved companies into a sequence with a Claude-generated candidate-side summary, the TheirStack webhook handler verifies HMAC-SHA256 signatures, the BD engine can be paused with a one-toggle Active switch in Settings > BD, and the Client Signal surface now reads real TheirStack-routed client matches instead of an empty placeholder. Client logos auto-pull from Clearbit on client creation, BD page headers lose their subtitle paragraphs, and the visual-seed data inserted during the BD 3.x build is gone from Activity / Client Signals / Active Campaigns.

**TheirStack JobDiscoveryProvider abstraction.** New `src/lib/bd/job-discovery-provider.ts` defines `JobDiscoveryProvider` (`discoverJobs(params): Promise<DiscoveredCompany[]>`) + `DiscoveredCompany` (companyName / domain / jobTitle / jobLocation / jobPostingUrl / source / rawPayload). `src/lib/bd/theirstack-provider.ts` implements the interface against TheirStack's `/v1/jobs/search` endpoint with `THEIRSTACK_API_KEY` Bearer auth, posted-since filtering, and a 25-result cap. Provider lives behind the interface so we can swap in Indeed / Apollo job-search / a manual seed without rewriting the cron.

**BD discovery cron.** New `/api/cron/bd-discovery` route at `vercel.json` 10:00 UTC (6 AM ET). `CRON_SECRET` Bearer auth. Walks every org's BD settings, skips orgs with `BdOrgConfig.engineActive = false`, calls the provider, applies four filters in order: (1) Big4 + staffing-keyword exclusion (Deloitte / PwC / EY / KPMG / Accenture + Staffing / Recruiting / Talent / Search Group / Search Firm / Placement / Headhunt), (2) 30-day dedup against prior BDRun `discoveredPayload` fingerprints (`companyName|jobTitle` lowercased), (3) headcount filter (10 ≤ employees ≤ 300 via `company.num_employees` / `employee_count` / `employees` on the raw payload, with null = pass), (4) existing-client exclusion against normalized client names (strips `LLC` / `Inc` / `LLP` / `PLLC` / `PC` / `Co` / `& Associates` suffixes, then `includes` both ways so `Acme LLC` matches `Acme Inc`). Surviving rows land in a new `BDRun { status: AWAITING_APPROVAL, discoveryProvider: "theirstack", discoveredPayload, discoveredCount }` row. Client-matched rows now route to `ClientSignal` instead of being dropped (see Client Signal below). Returns a JSON summary of all four filter counts.

**Approval queue UI with Run Discovery Now.** `/bd/launch` reads pending `BDRun { status: AWAITING_APPROVAL }` rows and renders one approval card per run. Card shows discovered company count, discovery provider, created-at relative time, and a preview of the first 5 companies. Approve & Enroll button kicks `approveBDRun` which flips status to `APPROVED` then calls `enrollCompaniesInApollo`. Archive button flips to `DISMISSED` (tombstone-only — keeps BDActivity history but pulls the run out of Active Campaigns). New "Run Discovery Now" button on `/settings/bd` triggers `/api/cron/bd-discovery` with the configured `CRON_SECRET` so Andrew doesn't have to wait for the 6 AM tick to see what the provider would have surfaced today.

**Apollo enrollment with people search + Claude candidate summary.** `enrollCompaniesInApollo(runId, orgId)` reads the run's `discoveredPayload`, sums today's `enrolledCount` across all org BDRuns since ET midnight, caps at 75 contacts/day (configurable per-org via `BdOrgConfig.globalDailyCap`). For each surviving company: calls Apollo `/v1/mixed_people/search` filtered to the company domain + a small allowlist of accounting / audit / finance titles, picks up to N contacts under the remaining cap, then calls Apollo `/v1/emailer_campaigns/{id}/add_contact_ids` to push them into the sequence id stored in `BdOrgConfig.apolloSequenceId`. Each enrolled company gets a Claude-generated 2-3 sentence candidate-side summary (`buildCandidateSummary`) written into `BDRun.candidateSummary` so Andrew can see "this is what the candidate would read" before approving. Updates `BDRun { status: COMPLETE, enrolledCount, completedAt }` and writes one `BDActivity { kind: ENROLL }` row per company with `{ contacts, company }` metadata.

**TheirStack webhook handler with HMAC-SHA256 verification.** New `/api/webhooks/theirstack` route accepts POSTs from TheirStack's job-update / job-removal webhook. Verifies the `X-TheirStack-Signature` header as `HMAC-SHA256(THEIRSTACK_WEBHOOK_SECRET, rawBody)` using `crypto.timingSafeEqual` to dodge timing attacks. Rejects unsigned / invalid signatures with 401. Logs accepted payloads to `BDActivity { kind: SCAN_COMPLETE }` for now so we have the audit trail before downstream consumers attach.

**BD Engine Active toggle.** New `BdOrgConfig { engineActive: Boolean @default(true) }` column. `/settings/bd` gains an Active toggle pill at the top of the BD Engine card. When flipped off, `/api/cron/bd-discovery` skips the org and returns `{ skipped: true, reason: "BD engine inactive" }`. Pause-and-resume without touching env vars or unscheduling the cron.

**Client Signal wired to real TheirStack routing.** `ClientSignal` model restructured: `companyName String` (required, source-of-truth display name from the provider), `clientId String?` (optional — set when the fuzzy match resolved to a Client row, null on soft matches), `jobTitle String`, `jobLocation String?`, `jobPostingUrl String?`, `postedAt DateTime?`, `discoveredAt DateTime @default(now())`, `status ClientSignalStatus @default(NEW)`. Composite unique on `(organizationId, companyName, jobTitle)` so re-runs upsert cleanly. BD discovery cron now routes client-name fuzzy matches into ClientSignal via upsert instead of dropping them, resolving `clientId` via the same name-normalization logic used for the exclusion filter. `/bd/client-signal` queries real rows ordered by `discoveredAt desc`, with a four-tab strip (All / New this week / Acted on / Dismissed) carrying real counts, View listing / Reach out / Dismiss actions, and a click-through to the matched Client profile when present. Empty state updated.

**Client logo auto-pull via Clearbit.** New `Client.logoUrl String?` column. `createClient` derives the bare domain from the website field and stamps `https://logo.clearbit.com/{domain}` onto the row at insert time — no HEAD probe, since the broken-image fallback is cheaper than a synchronous round-trip on the create path. New `<ClientLogo>` client component renders the image with an initials-chip fallback for null URL or 404. `<PageHeader>` got an optional `leading` slot; client profile renders the logo at 40px next to the company name. Client Signal cards render the same component at 32px so the row pattern reads as one family with the profile header.

**Subtitle text removed from BD page headers.** Active Campaigns ("One row per BD run. Counters update as Apollo writes opens, replies, and bounces back via webhook."), Activity ("Scan completes, enrollments, opens, replies, bounces, and domain warm/cool events, newest first."), and Client Signal ("Daily Indeed scan flags clients posting publicly. That usually means they aren't filling it internally, so reach out before someone else does.") all lose their description paragraphs. Eyebrows + h2 headings stay; content tightens up to match the Clubhouse / Finances top-spacing rhythm.

**Seeded data removal.** One-shot `scripts/cleanup-bd-visual-data.ts` ran against Neon to remove the 3 ClientSignal, 8 BDActivity, 1 Campaign, and 72 CampaignEvent rows that `seed-bd-visual-data.ts` had inserted during the BD 3.x visual build. Vertical / SavedSearch / SendingDomain infrastructure rows + any real BDRun left alone. Activity / Client Signals / Active Campaigns all read clean empty-state UI until real TheirStack + Apollo traffic arrives. Seed script deleted.

**CLAUDE_MODEL normalization.** Every Claude API call in the BD engine path (candidate summary, Personal Trainer block resolution, future JD-style extractions) routes through the shared `CLAUDE_MODEL` constant in `src/lib/claude.ts` instead of hardcoded `claude-opus-4-7` / `claude-sonnet-4-6` strings. Single point to bump when the next model family ships.

## Summary — Ace 46.0
Ace 46 ships the Finances module consolidation, dashboard header cleanup, unified period selector, KPI tile unification, calendar header fix, global topbar date widget, expenses restructure with manual entries, mercury matcher fixes, placement lead source field, pipeline Placement button at Offer stage, candidate profile tab unification, P&L table, Goal Pacing move, Monthly Operating Cost table, Clubhouse activity period filter, and full topbar/UI polish across all six primary pages.

**Finances module.** New /finances route under OPS sidebar replaces the standalone Invoices entry and the Financial Performance dashboard tab. Three tabs: Revenue & Profitability (default), Invoices, Expenses. /invoices redirects to /finances?tab=invoices. Topbar title reads Finances / Invoices / Expenses per active tab. "+ New Invoice" button in topbar on Invoices tab only. All three tabs have matching green eyebrows: REVENUE, MARGINS & PROFITABILITY / BILLED, COLLECTED & OUTSTANDING / SUBSCRIPTIONS, TOOLS & SPEND.

**Dashboard header cleanup.** Scoreboard and Placements lost their SectionHero. Clubhouse keeps green eyebrow computed dynamically in ET. Scoreboard: DEAL FLOW & FORECAST. Placements: PLACEMENTS ON THE BOOKS. All six pages have identical top spacing and matching green eyebrow pattern.

**Unified period selector.** period-tabs-shared.ts exports DashboardPeriod, resolveDashboardPeriod, dashboardPeriodRange so server components import without RSC boundary crash. Four-option selector (YTD / This Quarter / Last Quarter / Next Quarter) on Scoreboard, Placements, and Finances Revenue & Profitability. Default: This Quarter.

**Clubhouse activity period filter.** Five-option period selector above the activity KPI strip (This Week / Last Week / This Month / Last Quarter / This Quarter). Default: This Week. Eyebrow text updates to match selected period. All six KPI values recompute for the selected window.

**KPI tile unification.** Canonical spec enforced: 26px Bricolage Grotesque bold value, 10px extrabold uppercase label, canonical shadow across Finances, Scoreboard, and Clubhouse. Invoices KPI tiles gained green circle icons (Clock / AlertTriangle / Receipt / CheckCircle).

**Topbar date widget.** Compact square widget (3-letter weekday abbreviation + month + large date number) in global topbar between weather and avatar. Clicking opens monthly calendar popover with event dots. Inline date widget removed from dashboard page body.

**P&L table.** Profit & Loss card in Finances Profitability section. Income / Expenses / Gross Profit / Net Margin. Gross Profit and Net Margin green when positive, red when negative. Total Expenses synced to same calculation as Expenses tab YTD footer via shared helper.

**Monthly Operating Cost table.** New card on Expenses tab below Subscriptions & tools. Shows every recurring tool as monthly equivalent (monthly as-is, annual / 12, every-3-years / 36). One-time charges excluded. Sorted descending by monthly equivalent. Total Monthly Run Rate footer.

**Goal Pacing moved.** Goal Pacing card moved from Finances Profitability to Scoreboard, replacing non-functional Stalled Deals card.

**Net Profit / Loss row.** Bottom of Expenses tab shows Total Money In minus YTD Expenses as Net Profit / Loss with green/red signal and margin percentage.

**Mercury matcher fixes.** Pin.com variants added and confirmed matched. Apollo matcher catches charges across all Mercury accounts and routes to Recurring Annual. Anthropic Claude Code matches $95-$115 range. TheirStack added at $58.95/month. Edit/delete icons hidden on all MATCHED rows — only manual unmatched rows show pencil/trash.

**Expenses restructure.** Four sections: Recurring Monthly, Recurring Annual, Every 3 Years (GoDaddy), One-Time. Manual entries folded into correct sections. Training Course duplicate deleted. ROI per tool scoped to Pin, Apollo, TheirStack, LinkedIn, Indeed only. Money In section shows placements + Mercury cashback. Responsive layout fixed for laptop viewports.

**Placement lead source.** Lead Source dropdown in placement edit drawer. Source column on placements ledger. Wires to By Source breakdown.

**Pipeline Placement button.** Green Placement button on pipeline rows at OFFER stage.

**Candidate profile tabs.** Profile / Game Plan / Notes replaced with shared TabStrip component.

**Stalled Deals.** Removed from Scoreboard. Added to non-urgent roadmap: requires placement stage-transition timestamp stamping.

**TheirStack subscribed.** $58.95/month, 1,500 API credits/month. THEIRSTACK_API_KEY to be added to Vercel before BD Phase 4 Prompt 1.

## Summary — Ace 44.0
Ace 44 closes Calendar Prompts 1-6 end-to-end, ships the full Financial Performance dashboard tab (revenue + expenses + profitability with live Mercury auto-match), overhauls the Clubhouse layout into a Billing Tower + Briefing split with a This Week widget under it, fixes the Analytics bar proportional scaling on both Deal Funnel and Offer-to-Start, restyles Offer to Start to match the Deal Funnel row pattern, merges Revenue by City into the Placements map card, condenses the Scoreboard, aligns Invoices KPI tiles to dashboard sizing, and captures the Public Jobs Board spec into the roadmap. /calendar now reads + writes against Google with full multi-calendar coverage, dedupes events across owners, surfaces Meet links inline, persists toggle state in localStorage, and runs an amber reminder toast site-wide. The Mercury connector lives in Settings > Connectors and auto-matches subscription spend against a 16-tool keyword matcher.

**Full Google Calendar sync.** `/api/calendar/sync` walks every readable Google Calendar for the signed-in recruiter — Andrew's primary plus every shared calendar (Austin's BreakPoint and Austin's Orca personal calendar both come through automatically with no name/email filter). Token refresh runs through the shared `getFreshAccessToken` helper so Calendar reuses the same Account row as Gmail. Sync captures `hangoutLink` / `conferenceData.entryPoints` / `htmlLink` into `meetLink` + `htmlLink` columns on `CalendarEvent` so the Meet URL no longer hides in the description.

**Neon models.** New `CalendarEvent` model (org-scoped, `(organizationId, googleEventId, calendarId)` unique so a meeting on both Andrew's and Austin's calendars upserts cleanly into two rows) and `AceReminder` model (org-scoped, with `userId`, `title`, `reminderAt`, `dismissed`).

**Team toggle + owner normalization.** New `src/lib/calendar/owner-key.ts` is the single source of truth mapping a calendar source OR a team member to a normalized owner key ("ak" for Andrew, "austin" for Austin). Both sides — `event.ownerKeys` and `teamMember.id` — run through the helper so the rail toggle and the event filter always agree. "My Calendar" / "Team" tabs and the left-rail checkboxes share one `hiddenMembers` state (the previous design had a scope filter that masked the left-rail clicks — "click Austin does nothing" was actually scope filtering Austin's events out before the rail filter saw them). Counts removed from the My Calendar / Team buttons.

**Austin calendar toggle fixed.** The Austin shared calendar surfaces under his personal email (`austin@orcacapital.io`) and his BreakPoint email — both produce `ownerKey: "austin"` via the helper. The 188 Austin events now hide cleanly when the rail Austin checkbox is unchecked.

**Event dedupe across calendars.** A meeting on both Andrew's and Austin's calendars (same `googleEventId`, different `calendarId` rows) collapses into one CalendarEvent with `ownerKeys: ["ak", "austin"]`. The canonical row is the copy on the signed-in user's own calendar so PATCH targets the calendar Andrew can write to. Week / day / month views hide an event only when *every* owner key is hidden, and team mode renders an overlapping avatar stack showing all owners.

**Native event drawer.** Title / Date / Starts / Ends / Location / Notes / Guests are real editable inputs. New `updateCalendarEventAction` + `deleteCalendarEventAction` server actions push to Google then mirror to Neon (`updateMany`/`deleteMany` keyed on `googleEventId` so dedup mirrors stay consistent), then `revalidatePath("/calendar")`. Three save modes: "Save · notify all" PATCHes with `sendUpdates=all`; "Save · notify new only" runs a silent field PATCH then an attendee-only PATCH with `sendUpdates=all` so only newly added guests are emailed; **Save just me** PATCHes with `sendUpdates=none` so no invite emails fire when the recruiter is tweaking notes / time on an event whose guests don't need to be re-pinged. `patchCalendarEventDetails` + `deleteCalendarEvent` accept `calendarId` so events on shared calendars target their actual calendar id. Drawer header surfaces an "Open in Google Calendar" link via `htmlLink`. Clicking a free slot pre-fills the drawer's date + start/end time from the clicked cell so a new event lands on the slot you actually clicked. Ace reminder toggle on the drawer defaults to ON so the recruiter doesn't have to opt in every time.

**Guest typeahead.** New `/api/calendar/people-search?q=` route (team users + candidates + contacts, scored exact-email > prefix > contains, team users ranked first). Drawer guest input is a real typeahead with arrow-key nav and removable pills. Dead Jordan Tate placeholder removed.

**Calendar toggle state persists.** Hidden members + view mode (week / day / month) + scope (My / Team) all persist in localStorage so a reload returns the recruiter to the exact filter set they had open.

**Calendar Prompts 5 + 6.** Month + day view polish (density, event-chip clamping, all-day banding, today + selected-day emphasis, hover affordances, multi-owner avatar stack on day view). New Clubhouse "This Week" widget on the dashboard surfaces today's + this week's events (with Meet links + owner avatars) alongside the rest of the briefing. Calendar icon date widget on the dashboard header reads today's date + day-of-week so the dashboard reads like a desk calendar before the recruiter scrolls.

**Site-wide reminder toast.** `ReminderToastProvider` mounted in the root layout polls `/api/reminders/due` every 60s; when a reminder's `reminderAt` slips past `now`, it fires an amber toast (matching the mail/text toast chrome — same border, shadow, `ActionChip`, theme tokens via `getStoredToastTheme()`, with Tailwind amber-500 / amber-50 / amber-700 accents). The toast fires on every page, not just `/calendar`. Single Dismiss button persists the dismiss server-side and closes the toast.

**Dashboard layout overhaul.** Clubhouse rebuilt as a Billing Tower + Today's Briefing split sitting side by side at equal column heights, with the new This Week calendar widget mounted below them. The briefing card carries a 2×2 companion mini-grid (Word / Quote / Chess / On This Day) so the daily companions live inside the briefing instead of as a separate strip. Financial strip compressed so the top-of-page summary sits in a single tight band. New `SectionHero` component standardizes section eyebrow + title + description across every dashboard tab (Clubhouse, Scoreboard, Placements, Invoicing, Financial Performance). Typography system tightened — Bricolage Grotesque continues as the wordmark / section serifs; body weight + size scale refined so KPI tiles, panel headers, and sublines read as one family.

**Financial Performance tab.** New Clubhouse tab at `/dashboard?tab=financials` (renamed from the placeholder "Financials"). Schema bumps: `ToolExpense` (org-scoped, name + cost + frequency + category + paidCount), `Placement.candidateSource` (lead provenance per placement), `Client.leadSource` (lead provenance per client). Tab structure:
- **KPI strip** — five tiles across the top: Total Revenue YTD, Gross Margin, Net Margin, Total Expenses YTD, Blended ROI.
- **Revenue section** — three panels: By Client (top earners + placements YTD with bar shares), By Source (revenue attribution by `candidateSource`), Trend (current-calendar-quarter monthly close-out vs $125k quarterly goal with linear pacing forecast).
- **Expenses section** — Subscriptions & tools card now splits into Recurring subscriptions (Mercury-matched 2+ times YTD; manual rows with Monthly / Quarterly frequency) and One-time charges (single-hit Mercury matches; manual Annual / One-time rows), with a `Show X more` / `Show fewer` ghost toggle on each section after 10 rows. ROI per tool card shows Spend vs Rev Attr vs ROI per tool plus blended ROI.
- **Profitability section** — Margins card (Gross / Contribution / Net with placeholder drags until Mercury feeds variable + ops costs), Goal pacing card (quarterly + annual progress bars with ET-explicit day-of-quarter and day-of-year so Vercel's UTC clock doesn't tick the day over at 8 PM ET), Budget vs. actual card (one row per ToolExpense with placeholder "No budget set" copy until the budget field lands).

**Mercury connector + auto-match.** Mercury added to Settings > Connectors with Bearer-token API key storage (`Organization.mercuryApiKey`). New `getMercuryTransactions(apiKey)` server-side helper in `src/lib/mercury.ts` (thin Bearer-auth fetch, `limit=500`, `revalidate=300` to cache 5 min and avoid hammering Mercury on dashboard reloads). 16-tool keyword matcher in `src/lib/mercury-matcher.ts` covers Apollo / Pin / Anthropic-Claude / Ringover / Vercel / OpenAI-ChatGPT / Slack / QuickBooks / GoDaddy / Amazon / Apple / Krispcall / Mercury subscription / Recruiterflow / Zoho / OpenPhone-Quo. Ignore list (`shouldIgnoreTransaction`) drops owner pay-outs (AEJ VENTURES, BRANZINO), Mercury IO Cashback, `IO AUTOPAY` exact bankDescription, and `ACCTVERIFY` micro-deposits so the Expenses card stays focused on real subscription spend.

**Analytics bar fixes.** Bar widths on Deal Funnel and Offer-to-Start scale against the row's max value rather than pinning every bar to the max — small numbers actually render small. Stage counts render inside the boxes (not floating above them). Offer to Start rows restyled to match the Deal Funnel row pattern so the two analytics surfaces read as one family.

**Placements tab tightening.** Revenue by City merged into the map card (right-side panel inside the same card surface). Map zoom level persists in localStorage so reload returns to the recruiter's last zoom. Tab layout reorganized + sections renamed so the ledger / breakdowns / map sequence reads cleanly.

**Scoreboard condensed.** Every Scoreboard card 20-25% more compact — KPI tile padding tightened, panel inner spacing reduced, histogram chrome shrunk — so the page reads at a glance without scrolling.

**Invoices KPI tiles.** Invoices page KPI strip aligned to the dashboard `KpiTile` sizing so the surface reads as part of the same family as Clubhouse / Scoreboard / Placements / Financial Performance.

**Public Jobs Board spec captured.** Full spec lives in ACE_ROADMAP.md under Active Build Sequence. Ace stays source of truth; the website reads a sanitized public API only; client names are never exposed; poster is always BreakPoint Talent.

**Ace Assistant file attachments.** Composer accepts attached files; stranded-drag bug fixed.

**Placements graph Court Mode tokens.** Hardcoded colors swept off the placements graph — every fill/stroke routes through `court-*` tokens.

**Invoicing copy.** Mercury sync language replaced with manual payment tracking copy across the invoicing surface: "Mercury sync" → "Manual payment tracking", "One click, attaches PDF + pay-link" → "One click, attaches invoice PDF", "Mercury webhook · auto" → "Manual paid check".

## Summary — Ace 43.0
Ace 43 lands the Placements dashboard tab, the Calendar shell, the Pipeline placement edit drawer, and a round of cross-tab visual unification. The Invoicing module that shipped in Ace 42 also gets its real downstream wiring this release.

**Invoicing follow-through.** The Placement → Invoice schema link is now actually used: Invoice rows carry `placementId`, the pipeline + placements dashboards both read invoice status off the join (PAID/SENT/DRAFT/no-invoice), and the dashboard "Cash Collected" metric is wired to the paid-invoice signal instead of static seed. Invoice detail view ships the PDF action, the mail composer pre-fill, and the OPS sidebar entry. Miles Atchison's placement is the live reference row — Network + Collected + base salary $62,400 — and resolves through the Pittsburgh, PA dot on the map.

**Placements dashboard tab.** `/dashboard?tab=placements` renders YTD/This-Quarter/Last-90-days ledger + breakdowns + map. Map switched from the SVG silhouette to a real Leaflet layer with OpenStreetMap tiles; CITY_COORDS gained Pittsburgh + 4-decimal precision on the Ohio cluster (Cleveland, Columbus, Cincinnati, Solon, Beachwood, Independence). Unknown cities skip rather than fall back to the US centroid so a misplaced pin can't read as real data. The lookup also aliases each "City, ST" entry under its city-only form so a placement stored as "Pittsburgh" (no state) still resolves. Bubble radius clamped 8-20 px. HQ pin / label / centroid-fallback removed. OSM tiles dim via `brightness(0.85) contrast(1.1)` in dark Court Modes, scoped to the tile pane only so bubbles stay vibrant. Ledger leads the tab, breakdowns sit below, map drops to the bottom.

**Interview edit.** Edit modal lands with two notify modes (notify everyone vs notify newly-added guests only), 15-min increment time picker, hydration fix for the time-string render (pre-formatted ET strings server-side so SSR matches hydration byte-for-byte).

**Calendar shell.** New `/calendar` route with week / day / month views, Mon-Fri only on the week view (weekends collapsed for desk use), event drawer that opens on click of any cell or event, dedicated reminders panel, sidebar entry under OPS. Currently renders against static seed — Google Calendar sync + Neon persistence ship in Session 1 next.

**Pipeline polish.** Job column quieted (job title smaller, 13px / `font-normal`). Hired-stage rows render an invoice status pill (Paid green / Sent blue / Draft amber / No invoice muted). Click on any hired row opens a new placement edit drawer (slide-in right, same chrome as the calendar event drawer) with candidate / client / job / stage read-only and start date, base salary, fee amount, fee percentage, notes editable. Save calls an org-scoped `updatePlacement` server action that revalidates `/pipeline` + the candidate page.

**Cross-tab visual unification.** Scoreboard + Placements + Invoices KPI tile chrome aligned to the Clubhouse `KpiTile` pattern (borderless, `rounded-2xl bg-court-surface px-3 py-2.5` soft long-shadow, 10px extrabold label, 26px serif value). The 5 Scoreboard tiles match the height of the 6 Clubhouse tiles. Scoreboard + Placements outer cards (Funnel, CashForecast, ListCard, StalledDeals, BreakdownCard, PlacementMixCard, MapCard, Ledger) upgraded to the big-panel Clubhouse chrome (`rounded-3xl p-5 0_12px_32px` shadow). Em-dashes dropped from subtitle copy (histogram labels, Billing Tower date hints). Placements outer column gap raised to `gap-7` to match Clubhouse.

**Sidebar compact.** Density tightened across all sections so OPS + CRM + INBOX rows sit closer together.

**Invoices filter tabs.** The `/invoices` All/Drafts/Sent/Overdue/Paid/Void filter row replaced with the shared `TabStrip` component — every filter pill row in the app now routes through one source.

## Summary — Ace 42.0
Ace 42 ships the full Invoicing module end-to-end: branded one-page PDF generator, real `/invoices` workspace (list + detail + status transitions + bank-detail-only payment instructions inside the PDF), auto-draft on Confirm Start, dashboard Invoicing tab wired to live data, and `/settings/billing` for company identity + ACH/wire/check details. The Mercury / pay-link language is gone from every surface (dashboard, scoreboard forecast, Confirm Start toast). Schema gained the `Invoice` model + `InvoiceStatus` enum (DRAFT / SENT / PAID / VOID) with relations on Organization / Candidate / Client / Placement; invoice numbers monotonic per workspace starting at INV-1051. Sent from "Accounts Receivable" — the AE signs the body, the PDF carries the ACH/Wire/Check blocks, no payment URLs anywhere. The detail page exposes a "Draft email in Gmail" action that opens a pre-filled mailto with the merged template body + PDF URL, and the sidebar gains an Invoices entry under CRM.

## Summary — Ace 41.0
Ace 41 cleared both workflow-blocking items from Ace 40 and shipped a full JD workflow overhaul, mail composer fixes, new job form redesign, and Candidate Recruit template wiring.

JD markdown unification: Path B (src/lib/claude.ts generateJobDescription) now emits GitHub-flavored markdown matching Path A. PlainProse deprecated and removed. react-markdown renders Job.description everywhere. Copy JD button writes text/html + text/plain ClipboardItem so pasting into Gmail or Word preserves bold headers. Mail composer HTML paste handler added — TipTap accepts text/html from clipboard, preprocesses h1-h6 to p+strong so heading tags survive TipTap parsing. Bold survives both in the composer and in the received Gmail email.

Job Description tab cleanup: stripped to a single card — JD rendered via react-markdown, Copy JD, Edit toggle (inline textarea + Save/Cancel), Regenerate with Claude. Source URL input, raw paste textarea, Internal Recruiter Notes, and duplicate Description card all removed.

New job form Source Material card: URL input + "or" divider + drag-drop upload zone + full-width Parse & Generate JD with Claude button consolidated into one Source Material card at the top of the form. Drag-and-drop file upload (PDF/DOCX) with dashed border highlight on hover. Parse & Generate JD with Claude fires parse-url (if URL present) → auto-fills Title/Location/SalaryLow/SalaryHigh/SalaryType → generates JD → extracts fields from generated markdown non-blocking and fills form fields. Source URL persists to Job.sourceJobUrl. Internal recruiter notes field wired to Job.internalRecruiterNotes via createJob. Indeed/LinkedIn blocked URLs show inline amber error with Save Link button that appends "Client Job Link: [url]" to recruiter notes. 529 overload on generation shows toast only, does not overwrite Description field. Field extraction improved: location prefers most specific (city/state/zip over region), salary type detects HOURLY vs SALARY from JD language.

Mail fixes: Reply All now correctly populates CC from original To + CC headers minus andrew@breakpointtalent.com. Duplicate signature block fixed via ACE_SIGNATURE_MARKER strip-and-append pattern. Thread messages toggle open/closed — click expanded header collapses it. Reply composer shows "Replying to [Name] · [date]" above TO field. Mail composer Use Template + Insert Field dropdowns open upward via side="top" so they no longer clip below the viewport.

Candidate Recruit template: merge fields wired end-to-end. Job picker appears when template is selected in mail composer. All variables resolve from live Job + Client + Candidate records. Job description sections (benefits, responsibilities, requirements) inject as HTML bullet lists not raw markdown. 1900 character limit enforced with truncation on longest bullet section first. Template visible and active in Settings > Templates.

## Summary — Ace 40.0
Ace 40 bundles the Night Court visual refresh, the BD Engine Phases 1-3 build-out, and a tail of workflow polish + bug fixes into a single named release. The four canonical themes from the Court Mode system are joined by Night Court Light (warm cream #FAF8F5 + forest sidebar + brand-green accents) and Night Court Dark — both shipped end-to-end with full token coverage. The Dashboard splits into three tabs (Dashboard / Scoreboard / Invoicing) on a new unified `TabStrip` component that is now the single source of truth for every tab strip in the app. The candidate profile collapses to a single unified layout (resume + action row on the left, contextual content on the right). Ace Assistant gains data-reset tools, the Deal Funnel scoreboard is decluttered, and a long list of workflow fixes lands underneath.

BD Engine moves from zero to three full phases: schema (9 models + 4 enums + the new `BdOrgConfig` row), sidebar nav, the `/bd` layout with 4 tabs, the Launch flow with the amber `Launch BD Run` CTA, Client Signal with stacked filterable rows, Active Campaigns with metric strips + domain health, Activity grouped chronologically, and a complete `/settings/bd` page with five CollapsibleSections (Verticals & Searches, Apollo, Sending Domains, Daily Limits, Reply Routing). Phase 3 also lit up the org-level `BdOrgConfig.pauseAll` toggle that gates the Launch CTA. Visual seed data (3 ClientSignals, 8 BDActivity rows, 1 Campaign with 72 CampaignEvents) ships alongside so every BD page renders with real content out of the gate. The hydration crash on `/bd/client-signal` was hotfixed via an explicit timezone in `Intl.DateTimeFormat` so server + browser ICU outputs match byte-for-byte.

JD pipeline fix: the `/jobs/[id]` JD preview no longer renders "Job Details" as plain body text. Two changes — `PlainProse` now skips blank lines when scanning for the "next content line" so a section header followed by a gap (the canonical Job Details layout) still qualifies, and the `/api/jobs/generate-jd` route gained a `normalizeJdHeadings` safety net that rewrites any bare canonical section name with the correct `## ` / `### ` prefix before save.

Placement fee correctness: backfilled Ethan Larocca's missing fee and added 5 fee guards at the offer / pending_start / hired stages so a placement can't advance without the fee fields populated. The /jobs `Last Edited` column now reads a derived `lastTouchedAt` rolled up across Job.updatedAt + Job.descriptionGeneratedAt + max(Placement.updatedAt) + max(ActivityLog.timestamp) per job, so a JD regen or pipeline stage move now bumps the column.

New-job redirect fix: `createJob` returns the Job cuid as the slug (never `legacyRfId`), and `/jobs` row clicks navigate via the cuid carried on `_aceJobId` instead of the synthetic negative djb2 hash that was minting `/jobs/-309396680` 404s. Salary type lands as a `SALARY | HOURLY` field wired end-to-end (schema column, /jobs/new toggle with label flip on the comp inputs, Overview edit form, JD generator branching the Salary line + compensation bullets). The Candidate Recruit template is seeded into the EmailTemplate table (manual-only, audience=candidate, category=outreach, body leans on `[Job Description]` for the structured content).

## What Shipped in Ace 40.0 (2026-05-12)
- **Night Court Light + Dark themes** — warm cream surface (#FAF8F5), forest-green sidebar, brand-green accents. Added as the 4th and 5th Court Mode options alongside the existing Hard / Clay / Grass surfaces. Full token coverage across every page.
- **Dashboard tabs** — `/dashboard` splits into Dashboard / Scoreboard / Invoicing, riding the new unified `TabStrip` component.
- **Unified `TabStrip` component** — new shared component at `src/components/ui/tab-strip.tsx`. Today's Briefing visual style (rounded-md tabs, thin brand-green border + bold brand-green text on the active pill, neutral inactive, count chips themed to state). Single source of truth — every tab strip in the app now routes through it.
- **Candidate profile unified layout** — collapses the previous three-card layout into one: resume anchored on the left with the action row above it; contextual content (overview, applied jobs, activity, etc.) on the right.
- **Ace Assistant data-reset tools** — Assistant can clear scoped chunks of in-conversation state (transcripts, draft buffers, picker selections) on request instead of forcing a full /clear.
- **Deal Funnel scoreboard cleanup** — Scoreboard tile cleaned up of stale fields and over-dense rows so the funnel reads at a glance.
- **JD header hierarchy fix** — `PlainProse` (`src/components/plain-prose.tsx`) heading detector now skips blank lines when scanning for the next content line, so "Job Details" (which is intentionally followed by a gap before its sub-sections) qualifies as a header alongside "A Bit About Us" / "Why Join Us". Plus a `normalizeJdHeadings` safety net in `/api/jobs/generate-jd/route.ts` that rewrites any bare canonical section name (e.g. "Job Details", "Key Responsibilities and Duties", "You Should Have Most of the Following") with the correct `## ` / `### ` prefix before save.
- **Ethan Larocca placement fee backfill + 5 fee guards** — backfilled the missing fee on Ethan Larocca's placement row and added 5 server-side guards at the offer / pending_start / hired stage transitions so a placement can't advance without the fee fields populated. Each guard returns a structured error the UI surfaces inline.
- **Salary type field (`SALARY | HOURLY` enum)** — `Job.salaryFrequency` wired end-to-end. New-job form has a Salary type toggle above the comp inputs; flipping to Hourly relabels the inputs to Hourly low / Hourly high and swaps placeholders to hourly figures. Overview edit form on `/jobs/[id]` carries the same toggle so existing jobs can be re-classified. JD generator branches the Salary header line and the "Why Join Us" compensation bullets on the explicit field (no more dollar-amount heuristics).
- **New-job redirect bug fix** — `createJob` server action now returns `slug: job.id` (the cuid) regardless of any `legacyRfId` on the row, so new Ace-native jobs never route through a numeric id. `/jobs` row clicks compute slug from `_aceJobId` (the cuid carried on the RFJobWithAce shim) when the synthetic numeric id is negative, instead of stringifying the negative djb2 hash that was minting `/jobs/-309396680` 404s.
- **Candidate Recruit template** — seeded into the EmailTemplate table via `ensureDefaultTemplates`. Manual-only (trigger=null, identified by name so the seed loop stays idempotent), audience=candidate, category=outreach. New "outreach" category surfaced in the Settings template editor dropdown. Body leans on the existing `[Job Description]` merge field so the generated JD carries the structured content.
- **Last Edited column on /jobs reading derived `lastTouchedAt`** — new `buildLastTouchedByJobCuid()` helper in `src/app/jobs/page.tsx` rolls up four signals per Job cuid: Job.updatedAt, Job.descriptionGeneratedAt, max(Placement.updatedAt) grouped by jobId, max(ActivityLog.timestamp) where targetType='job'. Three groupBy queries total (no per-row joins), org-scoped, computed on `/jobs` only so other `getRfJobsForOrg` callers don't pay for the work. Falls back to the legacy `last_opened/created_at` when the rollup is empty so truly-untouched rows still surface their created date.
- **BD Engine Phase 1** (originally Ace 39.1) — Prisma schema for the BD Engine: 9 models (Vertical, SavedSearch, SavedSearchVersion, SendingDomain, BDRun, Campaign, CampaignEvent, BDActivity, ClientSignal) + 4 enums + the new `BdOrgConfig` model (one row per organization, single source of truth for pause-all / daily-cap / blackout windows / reply routing). Sidebar BD entry. `/bd` layout shell with 4-tab strip (Today's Launch / Client Signal / Active Campaigns / Activity). `/bd/launch` with vertical segmented control + saved-search combobox + amber Launch BD Run CTA + confirmation modal + `POST /api/bd/runs` inserting BDRun status=QUEUED.
- **BD Engine Phase 2** (originally Ace 39.2) — `/bd/client-signal` with filter pills (All / New this week / Acted on / Dismissed) and stacked rows (logo placeholder, primary contact, job title + location + posted-relative, View listing + disabled Reach out stub). `/bd/campaigns` with BDRun rows showing vertical pill, Day X of Y eyebrow, campaign name from SavedSearch, sub-line, metric strip (Sent / Opened / Replied / Bounced / Unsub) from a single CampaignEvent groupBy, sparkline placeholder, domain health 5-dot strip, pause stub, chevron — plus Campaign detail stub at `/bd/campaigns/[id]`. `/bd/activity` with chronologically grouped events (Today / Yesterday / 2 days ago / Older), tone-colored glyphs per kind, metadata-derived event text, right-aligned timestamps, cursor pagination via `?before=`.
- **BD Engine Phase 3** (originally Ace 39.4) — `/settings/bd` with 5 CollapsibleSection cards (Verticals & Searches with inline edit + version history, Apollo Integration with masked key + Test connection button, Sending Domains with Add modal + inline edit, Daily Limits with pause-all toggle + global cap + per-vertical caps + 4 blackout-window pills, Reply Routing with webhook display + 3 routing toggles). Sticky in-page TOC at the top. `/bd/launch` now reads `pauseAll` and `globalDailyCap` from `BdOrgConfig` instead of hardcoded values.
- **Hydration crash hotfix on `/bd/client-signal`** (originally Ace 39.3) — every BD page now pre-formats date strings on the server using `Intl.DateTimeFormat` with explicit `"en-US"` locale + `timeZone: "America/New_York"` so server + browser ICU outputs match byte-for-byte. No `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` call survives in any rendered output. Plus fix for invalid nested interactive elements (Active Campaigns row had `<Link>` containing `<button>` — pause stub is now a `<span>` with `aria-label`).
- **BD visual seed data** — 3 ClientSignals, 8 BDActivity rows, 1 Campaign with 72 CampaignEvents seeded so every BD page renders with real content before Phase 4 cron + webhook light up live data.

## Summary — Ace 39.4
Real BD Settings page replaces the 39.3 placeholder. Five CollapsibleSection cards on `/settings/bd` covering Verticals + Saved Searches, Apollo Integration, Sending Domains, Daily Limits, and Reply Routing. Schema gained per-vertical caps, sending-domain inbox-owner, and a new org-level config row that the `/bd/launch` Launch CTA now reads instead of a hardcoded `false`/`80` pair.

Schema bumps (applied via `npm run db:push`):
- `Vertical.dailyCap Int?` — per-vertical contact cap override; null inherits from `BdOrgConfig.globalDailyCap`.
- `SendingDomain.inboxOwner String?` — Andrew / Austin per warmed slot, surfaced in the Sending Domains table.
- New `BdOrgConfig` model (one row per organization, keyed on organizationId): `globalDailyCap Int @default(80)`, `pauseAll Boolean @default(false)`, 4 blackout-window booleans (Weekends / US Federal Holidays / Before 7am / After 5:30pm), 3 reply-routing booleans (`replyForwardApollo` off by default, `replyAutoCreateCandidate` on, `replyOooFilter` on), plus `createdAt` + `updatedAt`. `Organization` got the inverse `bdOrgConfig BdOrgConfig?` relation.

Section 1 — Verticals & Saved Searches:
- Accordion per `Vertical`. Each expanded vertical lists its `SavedSearch` rows with name, criteria summary (target titles · top locations · company size), last-run timestamp from the most recent BDRun joined by savedSearchId, and a version chip showing the number of SavedSearchVersion rows for that search.
- The first search in the first vertical opens to its edit form by default so first-paint shows what edit/create looks like (per the BD Phase 3 brief).
- Edit form fields: Name (text), Mapped Apollo sequence (dropdown — hardcoded "BD Outbound v1" / "Public Accounting Cold Sequence" / "Legal Outreach v2" until Apollo sequence pull lands), Daily contact cap (number), Target titles (chip input — comma or Enter adds, Backspace on empty draft removes the last chip, x button on each chip removes), Locations (compound rows of City + State + Radius miles, "+ Add location"), Company size min/max, Boolean keywords (monospace textarea), Min posting freshness (3 / 7 / 14 / 30 days).
- Save button is brand-green and reads "Save · creates v{nextVersion}". Server action `updateSavedSearch` wraps the SavedSearch update + SavedSearchVersion create in a Prisma `$transaction` so either both writes land or neither — the version history is always in sync with the current row.
- `+ New saved search` button per vertical opens the same edit form in create mode (no version preview since the Phase 3 brief says first save is v1).
- `+ New vertical` form below the accordion list captures Name + Slug (slug auto-derives from name when left blank).
- `deleteVertical` server action blocks deletion if the vertical has any saved searches (button disabled with explanatory tooltip in the UI as well).

Section 2 — Apollo Integration:
- Connection status pill: brand-green "Connected" when `APOLLO_API_KEY` env var is set, red "Not connected" otherwise. Does not ping Apollo for the pill — just env presence (per the brief).
- API key row renders the masked value as `apl_{12 dots}{last 4 chars}` when configured, or "Not configured" otherwise.
- Test connection button calls new `GET /api/bd/apollo/test`, which hits Apollo's `https://api.apollo.io/api/v1/users/me` with the `X-Api-Key` header. Returns one of three envelopes: `{ ok: true, email, name }` on 200, `{ ok: false, error }` on non-2xx (with the upstream error trimmed), or 501 `{ ok: false, error: "not configured" }` when the env var is missing. Result renders inline below the button as a brand-tinted success card or a red-tinted error card.
- Rotate button is intentionally disabled with a tooltip pointing the user at Vercel project env — secure storage for the rotated key is deferred to a follow-up to avoid stashing API keys in plaintext rows.
- Mapped sequences table renders the three placeholder sequence names with Apollo ID column reading "Pending API connection" until Phase 4 pulls real sequence ids.

Section 3 — Sending Domains:
- Table queried from `SendingDomain` ordered by `lastUsedAt asc` so priority 1 (next in rotation) is on top. Columns: Priority (1-based row index), Domain (monospace), Status pill (HEALTHY = brand-green / WARMING = amber / COOLED = red), Reputation bar (hardcoded 85 in Phase 3 — real value comes from Instantly in Phase 4, color tier ≥80 brand-green / ≥50 amber / else red), Inbox owner, Last cooldown (currently always "—" since the column doesn't exist; derived from DOMAIN_COOLED BDActivity events in Phase 4).
- `+ Add domain` modal: Domain text input + Inbox owner dropdown (Andrew / Austin) + starting status radio (Warming / Healthy).
- Inline edit per row swaps the static cells for a small form (domain text input, status select, owner select) with Cancel / Save controls; server actions `createSendingDomain` / `updateSendingDomain` / `deleteSendingDomain` are tenant-scoped and revalidate every BD path.

Section 4 — Daily Limits:
- Pause all sends row at top: brand toggle that flips `BdOrgConfig.pauseAll`. When ON, the row's border + bg shifts to red ramp and a "Paused" pill renders next to the toggle. `/bd/launch/page.tsx` now reads `BdOrgConfig.pauseAll` instead of the hardcoded `false`, so flipping this toggle disables the Launch BD Run CTA on the next render.
- Global daily contact cap row: inline edit (pencil → number input + Save). Writes `BdOrgConfig.globalDailyCap`. `/bd/launch` reads this as the fallback contact cap when no `SavedSearch.contactCap` is set.
- Per-vertical caps grid (4-column on lg, 1-column on mobile). Each card shows the vertical name, the cap (or "inherits" when null), and an inline pencil → input → Save flow. Writes `Vertical.dailyCap`.
- Blackout windows row: 4 toggle pills (Weekends, US Federal Holidays, Before 7 AM ET, After 5:30 PM ET) wired to the matching `BdOrgConfig.blackout*` columns. On = brand-tint pill with Check icon, Off = mute pill with X.

Section 5 — Reply Routing:
- Confirmation banner in brand-tint: "All BD replies route into Ace Mail", webhook path `/api/webhooks/apollo/reply` rendered as monospace, last-reply timestamp queried from the most recent `BDActivity` row where `kind=REPLY` (falls back to "No replies yet"). Health pill is hardcoded "Healthy" since the route file exists — Phase 4 will swap to a real health check after the webhook handler ships.
- Three toggle pills below the banner: "Also forward to Apollo inbox" (off default), "Auto-create candidate on positive reply" (on default), "Out-of-office filter" (on default). All three persist via `updateBdOrgConfig` to `BdOrgConfig.reply*`.

Cross-section:
- In-page TOC at the top of `/settings/bd` (sticky pill row) using the existing `SettingsTocLink` component so clicking a pill scrolls + expands the matching CollapsibleSection. Pills: Verticals & Searches / Apollo / Sending Domains / Daily Limits / Reply Routing.
- All five sections wrapped in the existing `CollapsibleSection` chrome that other settings pages use, so the visual treatment matches Triggers / Templates / etc.
- Court Mode tokens exclusively — only Tailwind ramps allowed are amber and red where they map to existing button-variant semantics (Reject / Apply equivalents). No hardcoded green; the brand color comes from `court-brand` family.
- The `/settings/bd` left-rail entry from Ace 39.3 (between Triggers and Connectors) is unchanged.

## Summary — Ace 39.3
Production hotfix on top of 39.2. The /bd/client-signal page was crashing on hydration with React #418/#423/#425 the moment real ClientSignal rows existed in the DB. Two root causes addressed plus one supporting fix.

Hydration fix — pre-format every date string on the server:
- New `src/app/bd/date-format.ts` module exports `formatBdDate`, `formatBdTime`, `formatBdDateTime`, `formatDaysAgo`, and `bucketForOccurredAt`. Every formatter uses `Intl.DateTimeFormat` with explicit `"en-US"` locale + `timeZone: "America/New_York"` so Node's ICU output matches the browser's ICU output byte-for-byte. The "X days ago" + Today/Yesterday/2-days-ago bucket helpers take an explicit `nowMs` so a single Date.now() snapshot drives every row's relative-time math.
- All three BD pages (client-signal, campaigns, activity) now compute every date-derived string at the top of the page render and pass plain `postedLabel`, `startedLabel`, `timeLabel`, `titleLabel`, and `bucket` strings (never Date objects) to their inner row helpers. No locale-dependent `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` call survives in any rendered output.

Hydration fix — invalid nested interactive elements:
- The Active Campaigns row was a `<Link>` containing a `<button onClick={(e) => e.preventDefault()}>` (the pause stub). `<a>` cannot legally contain interactive descendants — browsers re-shuffle this DOM during hydration and React surfaces it as a mismatch. The pause stub is now a `<span>` with `aria-label`, same visual treatment, no nested interactive.
- Client-signal "View listing" swapped from Next `<Link>` to a plain `<a>` — external URLs (Indeed) don't need Next's client-side router, and the swap removes one client-component boundary from the row.

BD Settings placeholder:
- `/settings/bd` now exists. Server component using the existing `CollapsibleSection` chrome that the other Settings pages use, with a "shipping in next session" placeholder listing what BD Phase 3 will land (Verticals / SavedSearches / SendingDomains CRUD + the global pause toggle currently hardcoded false in `/bd/launch/page.tsx`).
- `SETTINGS_CATEGORIES` in `settings-nav.tsx` gained a `{ slug: "bd", label: "BD Engine" }` entry between Triggers and Connectors so the placeholder shows up in the Settings left rail and the BD Settings link from the /bd layout top-right no longer 404s.

## Summary — Ace 39.2
Second slice of the BD Engine block — three previously-placeholder pages built out. Still no Indeed / Apollo wiring; each page renders the empty state until Phase 4 cron + webhook lights up real data.

Client Signal (`/bd/client-signal`):
- Eyebrow + display title "Existing clients hiring publicly" + brand-tinted count badge "X new this week" + subtitle copy explaining the daily-scan workflow.
- Unified TabStrip filter pills: All / New this week / Acted on / Dismissed. Filter state lives in `?filter=` search param — pills are `<Link>` and server-render the filtered list, so the URL is shareable and reloads.
- Each row inside one parent `divide-y` card: square dark logo placeholder with 2-letter mono initials, client name + primary contact line (first Contact by lastActivityAt — name · title · email), middle column with job title + MapPin location + Clock "Posted X days ago · via Indeed", right column with View listing (links to `externalUrl` target=_blank) + disabled "Reach out" pill (tooltip "Mail composer pre-fill ships in Phase 4"; flips label to "Reached out" when status=ACTED).
- Empty state: "No new client job postings detected. We scan every morning at 6 AM."

Active Campaigns (`/bd/campaigns`):
- One row per BDRun, ordered newest-first, limit 100. Each row: vertical mute pill, Day X of Y eyebrow (saturates at 7), campaign name = SavedSearch.name, sub-line "Started {date} · Sequence {name}", inline metric strip (Sent / Opened · X% / Replied · X% (brand-green) / Bounced · X% (red >8%) / Unsub) computed from a single `prisma.campaignEvent.groupBy({ by: ['campaignId', 'kind'] })` query across every Campaign linked to a BDRun in the page, sparkline "—" placeholder, domain health 5-dot strip (looks up current SendingDomain.status by name from BDRun.plan.domains), disabled pause stub, chevron pointing into the detail page.
- Click row → `/bd/campaigns/[id]` detail stub: back link + vertical eyebrow + title + status/started line + BDRun.plan and BDRun.metrics rendered as pretty JSON in tokenized code blocks + "Contact list ships in Phase 4" placeholder.
- Empty state: "No active campaigns. Launch one from Today's Launch."

Activity (`/bd/activity`):
- Unified TabStrip filter pills: All / Sends (ENROLL) / Replies (REPLY) / Bounces (BOUNCE) / Domains (DOMAIN_COOLED + DOMAIN_RESUMED). Filter state in `?filter=`.
- Grouped chronologically into Today / Yesterday / 2 days ago / Older buckets (UTC-based); empty buckets are dropped so the page never shows a header with no rows.
- Each entry: 20px circular glyph (reply = brand-green tint, send = blue, info = neutral, warn = amber, bounce = red) + lucide icon matched to kind, payload-derived event text (e.g. `"Reply from ${contactName} at ${company}"`, `"Bounce on ${email}"`, `"${domain} cooled (${reason})"`), right-aligned hh:mm timestamp.
- Cursor pagination via `?before=<ISO>` — PAGE_SIZE+1 lookahead drives the "Load earlier activity" pill at the bottom without a second query.
- Empty state: "No BD activity yet. Activity will appear here once your first BD run completes."

Today's Launch preview chip copy:
- `~80 contacts` flipped to `up to 80 contacts` per the BD Phase 2 brief. The daily cap is a ceiling, not a target — actual contacts surfaced per run varies based on how many qualified contacts Apollo finds per company.

Court Mode + token discipline:
- Every BD page reads from court-* tokens (court-brand, court-brand-tint, court-brand-dark, court-surface, court-surface-subtle, court-border, court-border-soft, court-fg, court-fg-muted, court-fg-dim). Bounce-red and warn-amber on Activity glyphs are the Tailwind ramps already in use across the rest of the app (red-100/600 + amber-100/700 with the matching dark counterparts) — same as the Reject / Apply button variants on candidate profile pipeline rows.
- Amber #F59E0B remains scoped to the Today's Launch CTA exclusively. No new hardcoded hex landed in Phase 2.

## Summary — Ace 39.1
First slice of the BD Engine block — schema + UI shell + Launch flow. No Indeed / Apollo wiring yet; the morning cron, webhook, and reach-out composer are deferred to subsequent BD phases.

Prisma schema:
- New BD models, all org-scoped: Vertical, SavedSearch, SavedSearchVersion, SendingDomain, BDRun, Campaign, CampaignEvent, BDActivity, ClientSignal.
- New enums: BDRunStatus (QUEUED / RUNNING / COMPLETE / FAILED), SendingDomainStatus (HEALTHY / WARMING / COOLED), BDActivityKind (SCAN_COMPLETE / ENRICH / ENROLL / OPEN / REPLY / BOUNCE / UNSUB / DOMAIN_COOLED / DOMAIN_RESUMED), ClientSignalStatus (NEW / ACTED / DISMISSED).
- BDRun.plan / BDRun.metrics / Campaign event counters / CampaignEvent metadata stay as Json so shape can drift while Apollo wiring is being prototyped without per-iteration migrations.
- Schema applied via `prisma db push` (project convention — there is no `prisma/migrations` directory; `npm run db:push` is the canonical workflow).

Sidebar + /bd shell:
- BD entry added to the CRM group in `src/components/sidebar.tsx` (Megaphone icon, lucide-react) — sits after Clients, before the Inbox section break.
- `src/app/bd/layout.tsx` renders the unified TabStrip with 4 tabs (Today's Launch / Client Signal / Active Campaigns / Activity) plus a right-aligned BD Settings link to `/settings/bd` (route stub).
- `src/app/bd/page.tsx` redirects to `/bd/launch` so the sidebar BD entry lands on the default tab.
- Client Signal, Active Campaigns, and Activity tabs ship as minimal placeholder pages so the tab strip clicks don't 404; they pick up content as subsequent BD phases land.

Today's Launch page (`/bd/launch`):
- Server component reads verticals + saved searches + sending domains + last BDRun for the caller's org via `getCurrentOrg()`.
- Hero card with eyebrow, display title, right-aligned Last Run status chip, vertical segmented control, saved-search select, green preview chip (companies → contacts · sequence · 5 rotating domain dots), and amber Launch CTA.
- Confirmation modal opens on Launch click, re-renders the same preview chip, Cancel/Launch buttons.
- POST `/api/bd/runs` validates verticalId + savedSearchId belong to the caller's org, snapshots up to 5 HEALTHY sending domains by `lastUsedAt` into BDRun.plan, and inserts the row at status=QUEUED. Returns the new row id + createdAt for the client to render.
- Launch CTA disabled when no saved search is selected, when daily contact cap is hit (cap enforcement wired but inert in Phase 1 — `metrics.contacts` only populates after a real cron run completes), or when pause-all is on (hardcoded false until BD Settings ships).
- Amber #F59E0B / #D97706 is the only hardcoded hex in BD pages — reserved exclusively for the Launch CTA per the BD handoff. Everywhere else uses Court Mode tokens (court-brand, court-brand-tint, court-brand-dark, court-surface, court-border, court-fg families).

Browser verification depends on seeded data:
- The schema is live but no Verticals / SavedSearches / SendingDomains are seeded yet. To test the Launch flow end-to-end, open `npm run db:studio` and add at least one Vertical row (organizationId = `cmobj8dxz00012gliequ53kvc`, name + slug) and at least one SavedSearch row pointing at it (organizationId + verticalId + name + criteria `{}`). 5 SendingDomain rows are optional — the preview chip renders empty-outline dots when no domains exist.

## Summary — Ace 39.0
Polish + workflow round on the Candidate Sourcing Surface that shipped in 38.1, plus a full rebuild of the interview scheduler around native Google Calendar invites and a new Rejected tab on the job page.

Job overview + Matches polish:
- Job Overview collapsed into a single full-width inline-editable card. The previous two-column split was redundant.
- Matches tab cleaned up — Sort / Columns / Export pills removed (the filter rail already drives every cut), filter sidebar narrowed, bulk action bar simplified to the actions that fire (Apply to Job / Add to List / Reject / Clear).
- Jobs list row click navigates to the job only — the inline edit pencil moved into the Job Overview card so the row stops competing with itself.

Rejected tab + Reapply:
- New Rejected tab on `/jobs/[id]` surfacing every Placement at `stage="rejected"` for the job. Each row carries a Reapply button.
- Reapply is a clean-slate DELETE on the Placement row, not a stage flip. The candidate falls back to no-relationship for the job so the next Apply / Submit starts fresh. Mirrors `onUnrejectViaDelete` on the RF side; the Ace-native path got the same treatment via `reapplyLocalPlacement`.
- Bulk reject from the Matches tab now writes to Neon permanently instead of pop-from-local-state — the row stays rejected across reloads and the Rejected tab picks it up.

Button color sweep:
- Restored the semantic palette across every pipeline action surface: amber = Apply to Job, light blue = Keep, red = Reject, green = Submit. Reapply got its own soft-violet variant so the inverse of Reject reads as a different intent at a glance.
- Dark mode sidebar tokens on `/candidates` so the rail no longer reads near-white in Court Mode dark variants.

Candidates page columns + snippets:
- New sortable Last Apply + Last Action columns on `/candidates`. Header chevrons drive `ORDER BY`; nulls last.
- Null snippet cleanup — rows with no resume + no experience match render nothing under the row instead of the "no snippet" placeholder.
- Snippet now lives inline with the row, no internal divider — full-width divider only at the row boundary, mirroring the split-view chrome change below.

Geocoding + headers:
- Zip-code geocoding via Nominatim `postalcode` lookup. A pure zip pill ("44115") now geocodes to a real lat/lng + bounding box instead of degrading to a `location ILIKE` contains-match.
- Page headers bumped to 30px across the app. New-item buttons (New Candidate / New Job / New Client) shrunk so the page title carries the visual weight.

Bulk actions (candidates + matches):
- Apply to Job and Add to List exposed from the bulk action bar on `/candidates` and the per-job Matches tab. Apply to Job opens a job picker; Add to List opens the list picker. Both write per-candidate via the existing single-row server actions inside a `Promise.all`, with a single toast and a row-count summary.

Mail:
- Bulk move-to dropdown is now scrollable — the label list was overflowing the viewport for users with deep nested labels.
- Mail inbox auto-refreshes every 30 s. The poll fetches the inbox metadata, diffs against the rendered list, and reconciles in place so the scroll position survives.
- Drag a single thread (or any currently-selected thread set) onto a label in the sidebar to apply/move it. Mirrors the bulk move-to action.
- Email attachments display and download in the thread view. Inline rendering for images, download-on-click for everything else.

Interview scheduler v2:
- Timezone selector on the Schedule modal — the recruiter's profile timezone is the default but they can override per interview (e.g. scheduling for a candidate on the West Coast).
- Past date blocking — `DateTime15Picker` `blockPast` flag wired in so the recruiter can't accidentally schedule into yesterday. Reschedule still allows past times (correcting a previous mistake).
- "Open meeting (anyone can join)" toggle defaults ON when type is Video. Off locks the Meet to invited attendees only.
- Native Google Calendar invites per party: candidate and client get separate calendar events with party-tailored descriptions (candidate gets interview prep tips, client gets candidate details + résumé link), and both render the native Gmail Accept / Decline / Maybe block.
- Template pre-population for the invite composers — interview-scheduled templates from `Template` table seed the Subject + Body so the recruiter sees the configured copy first paint. Falls back to the hardcoded default on lookup failure.
- Meet settings deep link surfaced after a Video interview is scheduled so the recruiter can flip Meet's Trusted vs Open access if needed.
- Back button on the invite flow preserves values: pressing Back from the Candidate composer returns to the Schedule modal (which stays mounted) with every field intact; the in-flight calendar event is cancelled so a clean reschedule is possible.

Search-driven candidate profile:
- Search term highlighting in amber on the candidate profile when entered from the rail. Tokens come from `?q=` on the embed URL; the same client-side `<mark>`er used in the snippet runs against the resume PDF text overlay and the structured fields.
- Full-width split-view top divider so the candidate name list (left) and the profile column (right) read as one continuous chrome bar.

Reapply (Ace-native + RF):
- Reapply available on disqualified / rejected placement rows on both code paths. RF path deletes via `onUnrejectViaDelete` (stage="disqualified") or flips to "submitted" via `unrejectCandidateJob` (stage="rejected"). Ace-native path uses the new `reapplyLocalPlacement` server action (org-scoped DELETE on the row + ActionLog entry + revalidate by candidateId cuid). `LocalPlacementRows` now mirrors `jobs` into local state and threads an `onPlacementRemoved` callback so the row disappears immediately on success.

## Summary — Ace 38.1
The `/candidates` rail and the per-job Matches tab consolidated into a single sourcing surface. Postgres search indexes landed alongside it so the new faceted filters and bulk searches scale past the 30k-candidate roster without sequential scans.

Filter rail (shared between /candidates and Matches):
- Faceted filters: keyword/Boolean query, skills, job titles, min/max comp, locations with radius, employer (current-only or current+past via experience JSON), tenure at current employer, work auth, last apply, last action.
- Tag pills with per-pill include/exclude toggle on Job Titles, Skills, and Employer. Default include renders as a green check on a court-accent-tint background; click flips to a red minus on red-tint. Server emits `field=…` / `excludeField=…` pairs so the route AND-composes includes and AND-NOTs excludes uniformly.
- Geocoded radius search: each location pill geocodes through Nominatim with in-process cache, distance dropdown clamps at 500 mi, pills OR together via a bounding-box union; un-geocodable pills degrade to a `location ILIKE` contains-match so they never silently drop out.
- Keyword search spans resume text + experience/education JSON + structured columns. Per-token ID resolution UNIONs across three sources (structured `firstName/lastName/currentDesignation/currentOrganization/location/skills`, `experience::text` + `education::text` casts, and `CandidateResume.extractedText`); tokens AND together at the candidate level so a multi-word query honors "every token must hit at least one source".
- Resume snippet enrichment: one batched lookup per page of results returns the earliest 200-char window where every token appears in either the resume text or the experience JSON, surfaced under the row.
- Live debounced filter updates (300 ms), aborted in flight on the next keystroke so a slow earlier response can't overwrite a fresher result set.

Results + split-view:
- Sortable results table (name / title / employer / location / salary / last apply / last action / score).
- Bulk action bar: select rows via row checkboxes + select-all, hide selected from the visible list without a DB write.
- Split-view candidate profile: clicking a row collapses the rail and opens the profile in an iframe with prev/next stepper and an "All Candidates" return. Same split applies on the job Matches tab.
- Per-job Matches tab inherits the rail and adds Apply / Keep / Reject in the split-view chrome — Apply hits `/api/placements` at `APPLIED`, Reject creates a `stage="rejected"` Placement, Keep toggles `Candidate.tags`. Rejected candidates are then NOT-filtered out of subsequent search results (`NOT: { placements: { some: { jobId, stage: "rejected" } } }`) so the rejected list never resurfaces here. The dedicated Rejected tab UI ships next session.

Save search:
- `/candidates` parks up to 5 saved snapshots client-side in localStorage with a generated label; the saved-search pills row replaces the empty state once any save exists. Defensive coerce on load migrates pre-pill snapshots (skills/jobTitles as `string[]`, employer as a single string) into the new `Pill[]` shape.
- Job Matches tab persists one snapshot per job to `Job.savedSearchFilters` via a tenant-scoped server action so the same job restores its filter set on the next visit. Run Search button retired everywhere — the debounced filter useEffect runs the fetch.

Postgres search indexes:
- Indexes on `Candidate(firstName)`, `Candidate(lastName)`, `Candidate(email)` plus `Contact(name)` and the parameterized $queryRaw substring search into `Contact.emails[]` so bulk imports and the new typeahead routes stop sequential-scanning. Landed before the rail wiring so the filter sidebar wasn't built on slow scans.

## Summary — Ace 38.0
Polish day across Spotify, YouTube, Mail, and the candidate CSV import. No core schema changes; one new Json column was considered (Candidate.rawCv) but skipped because the existing experience/education columns already carry the data.

Spotify panel:
- Shuffle support. New PUT /api/spotify/shuffle proxies to /v1/me/player/shuffle. Panel reads shuffle_state from the Web Playback SDK player_state_changed event. New shuffle toggle in NowPlayingBar (right of Next, green when active). Playlist Play and individual playlist track click now push the toggle's state to Spotify before /play so order matches the toggle. Track click sends offset + position_ms: 0 for in-order resume.
- Robust drag/resize lifecycle modeled on the YouTube panel. Single endSessionRef holds the live gesture; cancelActiveSession ends drag before starting resize and vice versa. Pointer capture plus a window/document safety net (pointerup, mouseup, blur, visibilitychange, lostpointercapture) so a swallowed release can never strand the panel chasing the cursor. Body, BottomNav, and NowPlayingBar each get pointer-events: none for the duration of the gesture so controls can't eat pointerup. Resize commit re-clamps position so the panel never lands half off-screen.
- Recency-derived playlists + artists. /api/spotify/recently-played now also returns recentPlaylistIds (deduped, recency order, max 10) and recentArtists (hydrated via one batched /v1/artists call, max 10). New /api/spotify/playlists-meta?ids=... fetches metadata for up to 10 playlist IDs the recruiter doesn't follow (Spotify-curated mixes etc.). Home shows a compact "Recently played playlists" 2-col grid above the existing tracks row. Library Playlists tab pulls recents (matched against the user's library) to the top while keeping every other playlist visible. Library Artists tab puts recent artists first (including non-followed) followed by the existing followed list, deduped.

YouTube panel:
- Search modes Top / Recent / Popular as pills under the search input. Default Top matches the original relevance order; Recent maps to order=date, Popular to order=viewCount. Long mode was added then removed per Andrew. Pills auto-rerun the active surface immediately on click — channel browse if you're inside a channel, otherwise the last searched query. Channel branch in /api/youtube/search now respects mode (was hard-coded to order=date). Channel-view load-more pins the mode that produced the page so pagination doesn't drift.
- Duration badges on every result thumbnail. After search.list returns, a single batched videos.list call hydrates each video with contentDetails.duration. ISO 8601 parsed and formatted as 8:42 / 1:12:04. Hidden when null (live streams, hydration failure). Channel-view videos get the same badge for free since they share VideoRow. Minimized dock shows the duration of the playing video next to the title when available.

Mail composer:
- To-field typeahead with three sources merged in parallel: Ace Candidates (firstName / lastName / email), Ace Contacts (firstName / lastName / name + every entry in emails[]), and Gmail Sent recipients. All org-scoped. Up to 8 deduped { name, email } items, priority-sorted (exact email match → local-part-prefix or name-prefix → substring-anywhere; Ace sources outrank Gmail history at ties).
- Gmail Sent recipients pulled via a snapshot strategy. New src/lib/gmail-recipients.ts. getGmailSentRecipients(userId) pages through up to 500 recent sent message IDs, fetches metadata-only headers in parallel, parses To/Cc/Bcc address lists, dedupes by lowercased email. Cached 30 min in-process per user. Stale-while-revalidate up to 24h. Concurrent refreshes coalesce on a single Promise. No new OAuth scope — gmail.readonly already granted. The earlier per-keystroke live-search approach was scrapped because Gmail's to: operator does prefix-of-token, not substring — typing "merc" couldn't reliably find receipts@mercury.com.
- AddressRow component upgraded with an opt-in serverSearch flag. 200ms debounce, AbortController to drop stale responses, Arrow up/down/Enter/Escape keyboard nav, mouse hover follows the same activeIndex. To row passes serverSearch; CC/BCC unchanged.

Candidate CSV import:
- Skip rules tightened. Experiences now drop rows where both title AND company are empty (date-only noise rows out). Educations drop rows where school is empty. linkedin column dropped from experience capture (no reader uses it).
- Profile WORK HISTORY + EDUCATION sections render year-only ("Title at Company (2020 – 2024)" / "Degree in Major, School (2024)") via a regex pull on raw startDate/endDate when from_year/to_year aren't pre-extracted. Court Mode tokens preserved.

## Summary — Ace 37.2
Web Playback SDK doesn't reliably auto-advance through a context_uri (artist / playlist) on its own — playback would just stop after each track. Wired track-end detection into the existing `player_state_changed` listener:
- Remember the previous state's trackUri + paused via `prevPlayerStateRef` so we can distinguish "track ended" from initial connect / user pause / seek-to-zero.
- When prev state was actively playing a track (paused=false + trackUri) and the new state matches end-of-track shape (paused=true + position=0), POST /api/spotify/next with the current device_id.
- `autoSkipInFlightRef` debounces the burst of player_state_changed events the /next call itself triggers so we never double-skip.
- No changes to artist/playlist fetch code or auth code.

## Summary — Ace 37.1
After 37.0 Andrew confirmed artists work, but his "Lifting" playlist (which he owns) renders 0 songs with no error message. Added two things to /api/spotify/playlist-tracks/[id] without touching playback or YouTube:
- Embedded-items fallback: when /v1/playlists/{id}/tracks fails or returns no projected rows, harvest the same shape from the header response's `tracks.items[]` so an owned playlist doesn't strand on 0 songs because a single sub-call broke. Same projectTrack handles either source.
- Diagnostics on both surfaces: server logs raw header / tracks / me responses (truncated 600 chars), plus a structured "decision" line with ownerId, meId, ownerMatchesMe, embeddedItemsCount, projectedTracks, tracksSource. Response now ships a small `debug` envelope to the client; the panel's playlist fetcher console.logs it on every response so the recruiter can copy a single console line back.
- trackCount priority adjusted: header.tracks.total → totalFromTracks → tracks.length so we never display "0 songs" above a non-empty row list.

## Summary — Ace 37.0
Three Spotify fixes — no playback or YouTube code touched:
- Artist Popular section no longer hits `/v1/artists/{id}/top-tracks` (403 in dev mode). New flow: fetch `/v1/artists/{id}/albums?include_groups=single,album&market=US&limit=5`, take the first album, fetch `/v1/albums/{firstAlbumId}/tracks?market=US&limit=5`, project the first 3-5 rows for Popular. If anything in that chain 403s the section hides silently with no error state.
- Discography continues to use `/v1/artists/{id}/albums?include_groups=album,single&limit=20&market=US`. Limit is hardcoded to 20 (Spotify min 1, max 50). The diagnostic empty-state block from 36.9 is removed — both Popular and Discography hide silently when empty per the brief.
- `classifyPlaylistTracksError` returns null on 403 + ownerId === meId so the recruiter's own playlists never show a restriction or auth-refresh message; Spotify's status (403 vs 404 vs other) still flows through `tracksStatus` so the panel can decide. Followed-but-not-owned playlists keep showing "Spotify's API restricts access to playlists you didn't create. Open in Spotify to listen."

## Summary — Ace 36.9
Andrew was still seeing 0 followers / no Popular / no Discography on artist pages even after 36.5's followers/null fix and 36.7's market=US revert. Added diagnostics (no behavior changes to playlist code or playback):
- /api/spotify/artist/[id] logs the raw artist + top-tracks + albums responses (truncated to 600 chars each) to Vercel server logs and ships a `debug` envelope on the response with `headerStatus`, `topTracksStatus`, `topTracksError`, `rawTopTracksCount`, `albumsStatus`, `albumsError`, `rawAlbumsCount`, and a `followersField` tag of `missing | null | ok | no-total`.
- Panel artist fetcher now `console.log`s the response with the debug envelope so the recruiter can read what Spotify actually returned without going to Vercel logs.
- ArtistView renders an inline error block above the Popular / Discography sections when sub-calls returned >=400 OR came back empty (raw count == 0 AND projected count == 0). Distinguishes "Spotify returned X status" from "Spotify returned an empty list" so we can tell the difference between dev-mode denial and a genuinely empty response.
- Followers handling unchanged from 36.5 — already correctly returns `number | null` and the panel hides the row when null. Logs will show whether Spotify actually returned `followers.total` or stripped the field.

## Summary — Ace 36.8
- Spotify minimized pill is draggable across the whole viewport again. The drag handler used to write coordinates into the un-minimized panel `position` while the pill was rendered with `right`/`bottom` anchors — release "snapped" the pill back to its dock corner. Added a separate local `dockPosition` state and branched the drag handler on `minimized`: when minimized we read/write the dock's local left/top with DOCK_W/DOCK_H clamping; when not minimized the original behavior is preserved. Pill now stays where the recruiter drops it.
- Disconnect Spotify: new `DELETE /api/auth/spotify` route expires the access / refresh / expires-at / state cookies (maxAge:0). Added a "Disconnect Spotify" row to Settings → Connectors with a button that hits the new route and toasts success. The floating panel's next `/api/spotify/token` call returns 401 and falls back to the Connect-Spotify CTA exactly like a fresh user.

## Summary — Ace 36.7
Re-applied the wide-screen breathing room on the AppShell `<main>` after the 36.6 revert. Andrew specified `max-w-[1600px]` (slightly wider than 36.6's `max-w-screen-2xl` = 1536px) as the cap so wide monitors get more table real estate before centering kicks in. Audited tables and grids:
- All four list-page tables (candidates / clients / jobs / pipeline) already use `w-full` inside their wrappers, so they fill the new 1600px cap automatically — no per-table changes needed.
- Dashboard KPI strip is already `md:grid-cols-6` for its 6 KPI tiles; bumping to xl:grid-cols-7 would create an empty cell. Billing Tower's body is `sm:grid-cols-2` for 2 metrics; same logic. No grid changes needed.
- AppShell main now: `... md:p-8 md:pl-4 md:pt-4 xl:mx-auto xl:w-full xl:max-w-[1600px] xl:px-8 2xl:px-12`. md and below untouched per the brief.

## Summary — Ace 36.5
Two distinct Spotify bugs the recruiter flagged after 36.4:

Bug 1 — artist page showing "0 followers" + Play not working:
- Artist endpoint now returns `followers: number | null` instead of defaulting missing fields to `0`. Panel hides the row entirely when null and only renders a count when Spotify explicitly provided one (including an explicit zero).
- Artist Play already routes through `playContext` → `PUT /api/spotify/play` with `{ context_uri }`; the fallback to `spotify:artist:${id}` is now applied in both the route and the panel button so we never hand Spotify an empty context_uri.
- /api/spotify/play passes the upstream HTTP status through verbatim instead of collapsing every non-2xx to 502. The panel branches distinct toasts off 401 (session expired / reconnect), 403 (Premium / device / scope — no playlist-ownership copy), 404 (artist or context not found), and other (generic).

Bug 2 — Andrew's own playlists ("Lifting") wrongly showing the API restriction copy:
- /api/spotify/playlist-tracks/[id] now fetches /v1/me alongside the header + tracks calls and returns `ownerId`, `meId`, and `tracksStatus` (real upstream HTTP status, not collapsed). The route no longer composes a user-facing message server-side — that path can't tell whether the playlist is the recruiter's own.
- Added `classifyPlaylistTracksError(status, ownerId, meId)` in SpotifyPanel.tsx as the single source of truth for the inline message: 401 → reconnect, 404 → "couldn't find this playlist or its tracks", 403+owner≠me → dev-mode restriction copy, 403+owner=me → auth/permission refresh copy, other → generic with status code. Court Mode styling preserved; only the message text changes.

## Summary — Ace 36.4
Two follow-ups requested after the 36.3 deploy:
- Weather widget WMO dispatch unified behind a single `bucketFor(code)` switch with an explicit `WeatherBucket` enum so icon / color / description can't drift apart again. All Open-Meteo WMO codes (0, 1, 2, 3, 45, 48, 51-57, 61-67, 71-77, 80-86, 95-99) have explicit cases; anything outside the chart lands in an `unknown` bucket and emits a `console.warn` so we notice if Open-Meteo expands the chart. Replaced the bulk JSON dump with a focused `console.log` of the current weathercode + dispatch decision + first 6 hourly + first 7 daily codes, so verifying a wrong icon takes one console line instead of expanding a tree.
- YouTube panel: drag handle was a 280x36 sliver (the hover pill) which the recruiter found hard to grab. Added an always-on transparent drag strip spanning `top-0 left-0` to ~200px from the right edge at z-[6] — sits above the iframe so its pointerdown wins, but below the hover pill at z-10 so pill buttons still take priority where they overlap. The 200px right-side channel leaves YouTube's top-right native chrome (volume / CC / settings) fully clickable.

## Summary — Ace 36.3
Round-3 fixes after Andrew flagged that the cream header in 36.2 broke the premium feel and that artist pages had regressed:
- YouTube panel: full-bleed iframe restored. The 36.2 header bar above the iframe is gone; controls now live in a single hover-only glass pill anchored top-LEFT (rounded, semi-transparent black, backdrop blur, ring-1 white/10) with `pointer-events-none` when invisible so it never swallows clicks meant for the iframe. Anchored left so the YouTube native chrome at the top-RIGHT (volume / CC / settings) is fully clickable; channel-avatar / Subscribe are intentionally covered since the recruiter never reaches for them from inside Ace. Bottom-left 200x64 click-blocker for Share + Watch-Later still in place.
- Spotify artist endpoint: reverted `market=from_token` (deprecated by Spotify in 2025, returns 400) back to `market=US` for top-tracks and added `market=US` back to the albums sub-call. This was the actual cause of "0 followers / empty top tracks / empty discography" — `from_token` 400ed and the panel rendered the empty arrays. Playlist + album detail routes also restored to `market=US` since stripping it had no observable benefit.
- Spotify 403 inline message rewritten: the dev-mode restriction is broader than just editorial / algorithmic playlists — it covers ANY playlist not owned by the authenticated user. Wording now reflects that ("Spotify limits API access to playlists you didn't create yourself").

## Summary — Ace 36.2
Follow-up after Andrew confirmed the 36.1 fixes only partially solved things:
- YouTube panel chrome lifted out of the iframe entirely. Our header bar (back / title / rewind / forward / speed / minimize / close) now lives ABOVE the iframe in a real flex slot at the top of the panel; the iframe occupies the area below `top-9`. Volume / CC / Settings (which YouTube actually places at the top-right of the iframe, not the bottom) are no longer obscured by our chrome. The legacy h-12 w-[160px] click-blocker that was sitting on top of those native buttons is removed; a smaller 200x64 click-blocker now covers the bottom-left Share + Watch-Later pills since YouTube doesn't expose params to remove them. The iframe is forced to 100%/100% via getIframe in onReady so the wrapper resize is honored.
- Spotify playlist/album detail route stops hard-failing on tracks-subcall errors. The header still loads; `tracksError` is included in the response and the panel renders a friendly "Spotify restricts API access to its editorial / algorithmic playlists" message + an Open-in-Spotify CTA in place of the empty list. This addresses the actual root cause of the recurring 0-tracks bug: Spotify's Nov 2024 dev-mode restrictions on API access to Spotify-owned playlists.
- CSP `connect-src` adds `https://api-bdc.io` (the BigDataCloud short-form host the SDK actually requests) alongside the existing bigdatacloud.net entry so the weather widget reverse-geocode lookup stops being blocked.

## Summary — Ace 36.1
Regression sweep on the floating panels and dashboard cards reported after the Ace 36.0 deploy:
- YouTube panel hover overlay split into two compact corner pills with `pointer-events-none` when hidden so the invisible bar no longer swallows clicks meant for YouTube's native CC/volume/settings controls or popup menus.
- Spotify playlist/album detail route hard-fails when the tracks subcall errors instead of silently rendering "0 songs"; market hardcoding dropped (`market=US` removed; artist endpoint switched to `market=from_token`) so Spotify resolves the market off the token instead of filtering legitimately playable rows out.
- Dashboard `Billing Tower`, `Today's Briefing`, and `Upcoming interviews` headings unified to 18px / 12px subtitle. Billing Tower and Upcoming Interviews are now collapsible with the same chevron + localStorage convention Today's Briefing already used.
- CSP `connect-src` adds `https://api.bigdatacloud.net` so the weather widget's reverse-geocode call (lat/lng → city) is no longer blocked.

## Summary — Ace 36.0
Floating YouTube + Spotify panels, daily-companion dashboard pills (Word, Quote, Chess, On This Day, Horoscope), Apple-News briefing redesign with cron pre-warm, weather widget, premium dashboard pass, and the final RF string sweep:
- Floating media panels for YouTube and Spotify with full draggable / resizable / minimize-with-audio shells.
- Six daily-companion pills on the dashboard bottom bar wired to Claude or public APIs and cached in Neon.
- News feed redesigned in Apple-News editorial style with a 6 AM ET Vercel cron pre-warm and NewsAPI replacing the prior Claude web search.
- Dashboard premium redesign (green tint surface, sage KPI tiles, Billing Tower, ambient shadow, tabular numbers).
- Weather widget on the topbar (Open-Meteo + geolocation, hover popover with current / 6-hour / 7-day forecast).
- Final user-facing RecruiterFlow string removed from the UI.

## Next Task
Next session opens a NEW CHAT and starts BD Engine Phase 4. This is the gate into Ace 45.

- **SESSION 1 (next)**: BD Engine Phase 4 — ASK ALL SCOPING QUESTIONS FIRST. Full rules below.

### BD Phase 4 Rules — Session 1 (PERMANENT — see ACE_RULES.md)
**CRITICAL**: Before writing a single BD Phase 4 prompt, Claude MUST stop and ask Andrew a full set of scoping questions. Do not skip this even if Andrew says "start BD Phase 4" or "let's go." Ask the questions first, always.

Andrew's standing direction: "BD has at least a usable launch version I would ship. BD Phase 4 carefully, but maybe not every automation. Discovery + Client Signals + approval queue matters more than fully automated send magic."

Required questions before any BD Phase 4 code:
1. Which specific parts of Phase 4 do you want for launch vs defer?
2. Do you want the full cron auto-enrollment or manual approval queue only?
3. Is TheirStack access confirmed and credentials available?
4. What does "usable launch version" mean to you specifically for BD?
5. Any changes to the approval queue flow since it was originally designed?
6. Do you want Client Signals to surface before or after the approval queue?
7. Any budget or rate limit concerns with Apollo enrollment volume?

Do not write any BD Phase 4 code prompts until Andrew has answered all of these in the new chat.

## What Shipped in Ace 39.4 (2026-05-12)
- **Schema bumps** (applied via `npm run db:push`): `Vertical.dailyCap Int?` (per-vertical override on the BD contact cap), `SendingDomain.inboxOwner String?` (free-form so Andrew/Austin can both own slots without enum churn), new `BdOrgConfig` model keyed on organizationId with `globalDailyCap Int @default(80)`, `pauseAll Boolean @default(false)`, 4 blackout booleans (`blackoutWeekends` / `blackoutHolidays` / `blackoutBefore7am` / `blackoutAfter530pm`), and 3 reply-routing booleans (`replyForwardApollo` default false, `replyAutoCreateCandidate` default true, `replyOooFilter` default true). `Organization` gained the inverse `bdOrgConfig BdOrgConfig?` relation.
- **`/settings/bd` server page** (`src/app/settings/bd/page.tsx`): one server render fetches verticals + their saved searches with criteria, sending domains ordered by `lastUsedAt asc`, `BdOrgConfig` (null on first visit until first save creates the row), most-recent REPLY BDActivity for the Reply Routing banner, version counts per saved search (`prisma.savedSearchVersion.groupBy` by savedSearchId), and last-run timestamps per saved search (`prisma.bDRun.groupBy` by savedSearchId with `_max.createdAt`). All five sections receive plain-data props (no Date objects cross client boundaries) — same hydration discipline established in Ace 39.3.
- **Sticky in-page TOC** (`src/app/settings/bd/in-page-nav.tsx`): horizontal pill row at the top using `SettingsTocLink` so each section id (`verticals`, `apollo`, `sending-domains`, `daily-limits`, `reply-routing`) gets a scroll-and-expand link without disrupting the main Settings left rail.
- **Section 1 — Verticals & Saved Searches** (`verticals-section.tsx`): accordion per Vertical with chevron toggle + saved-search count chip + Delete vertical button (disabled when vertical has any saved searches, tooltip explains why). Each expanded vertical renders its saved-search rows with a compact header (name, criteria summary, last-run timestamp, version chip "vN") + Edit pencil + Delete trash. Edit form ships with chip input (`,` / Enter / Backspace), compound location rows (City + State + Radius), monospace boolean keywords textarea, freshness dropdown (3/7/14/30), Save button reading "Save · creates v{n+1}". `+ New saved search` per vertical and `+ New vertical` modal at the page bottom.
- **Section 2 — Apollo Integration** (`apollo-section.tsx`): Connected/Not connected pill driven solely by `APOLLO_API_KEY` env presence (no Apollo ping for the pill itself), masked-key row, Test connection button hitting `/api/bd/apollo/test`, Rotate disabled with tooltip, mapped sequences table with Apollo ID column reading "Pending API connection" until Phase 4 wires real ids.
- **Section 3 — Sending Domains** (`domains-section.tsx`): table of domains with Priority (1-5 from `lastUsedAt asc`), Domain (monospace), Status pill (Healthy / Warming / Cooled), Reputation bar (hardcoded 85 with brand-green/amber/red tiers), Inbox owner, Last cooldown (currently always "—" — derived from DOMAIN_COOLED BDActivity events in Phase 4). Inline edit + Add domain modal + Remove confirmation.
- **Section 4 — Daily Limits** (`limits-section.tsx`): Pause-all toggle at top (brand toggle, flips to red surface + "Paused" pill when ON), Global daily cap row with inline edit, per-vertical caps grid (4-col on lg), 4 blackout-window pills (brand-tint + Check when ON, mute + X when OFF). Every toggle writes via `updateBdOrgConfig` server action; `router.refresh()` re-pulls `BdOrgConfig` so the state survives navigation.
- **Section 5 — Reply Routing** (`reply-routing-section.tsx`): brand-tint banner with webhook path `/api/webhooks/apollo/reply` as monospace, last-reply timestamp from BDActivity, hardcoded "Healthy" pill, three downstream-behavior toggle pills (forward to Apollo / auto-create candidate / OOO filter).
- **`/api/bd/apollo/test`** (`route.ts`): GET endpoint that pings Apollo's `/v1/users/me` with `X-Api-Key`. Returns `{ ok: true, email, name }` on 200, `{ ok: false, error, status }` on non-2xx, or 501 `{ ok: false, error: "APOLLO_API_KEY not set in environment" }` when env is missing. Auth-gated via `getServerSession`.
- **Server actions** (`actions.ts`): `createVertical`, `updateVerticalDailyCap`, `deleteVertical` (blocks when vertical has saved searches), `createSavedSearch` (also writes v1 SavedSearchVersion so history starts on creation, not first edit), `updateSavedSearch` (transactional update + SavedSearchVersion append, returns new version number for the toast), `deleteSavedSearch` (hard delete — schema has no `deletedAt` column yet), `createSendingDomain` / `updateSendingDomain` / `deleteSendingDomain`, and the catch-all `updateBdOrgConfig(patch)` that upserts the org's `BdOrgConfig` row. Every action is tenant-scoped via `getCurrentOrg()` and revalidates `/settings/bd`, `/bd/launch`, `/bd/campaigns`, `/bd/client-signal`, `/bd/activity`.
- **`/bd/launch` Pause-all wiring**: `src/app/bd/launch/page.tsx` now reads `BdOrgConfig.pauseAll` + `BdOrgConfig.globalDailyCap` via a parallel `findUnique`, passes the values through to `LaunchView`. The hardcoded `PAUSE_ALL = false` and `DEFAULT_DAILY_CONTACT_CAP` constants are gone — toggling Pause all sends in Section 4 disables the Launch BD Run CTA on the next render.

## What Shipped in Ace 39.3 (2026-05-12)
- **`src/app/bd/date-format.ts`**: shared formatter module for the BD module. Exports `formatBdDate` / `formatBdTime` / `formatBdDateTime` (Intl.DateTimeFormat with explicit `"en-US"` locale + `timeZone: "America/New_York"` so Node + browser ICU emit identical text), `formatDaysAgo(d, nowMs)` (pure integer day math against an explicit reference), and `bucketForOccurredAt(d, nowMs)` (Today / Yesterday / 2 days ago / Older via en-CA `YYYY-MM-DD` ET date keys).
- **`/bd/client-signal` hydration hardening**: every date-derived string is now pre-computed at page level against a single `nowMs = Date.now()` reference and passed to `SignalRow` as a plain `postedLabel` string. Row component no longer receives a Date object. The "View listing" affordance swapped from Next `<Link>` to a native `<a target="_blank" rel="noopener noreferrer">` since the destination is always external. Unused `Link` import dropped.
- **`/bd/campaigns` hydration hardening**: `startedLabel` and `dayNumber` are pre-computed at page level via `formatBdDate(run.createdAt)` and `computeDayNumber(run.createdAt, nowMs)`. The pause stub flipped from `<button disabled onClick={(e) => e.preventDefault()}>` (illegally nested inside the row's `<Link>`) to a non-interactive `<span aria-label="Pause campaign">` — same visual, but no more invalid nested-interactive DOM that browsers were re-shuffling during hydration. Metric values render `.toString()` instead of `.toLocaleString()` so number formatting is locale-independent too.
- **`/bd/activity` hydration hardening**: `timeLabel`, `titleLabel`, and `bucket` are pre-computed per row using the shared formatters; row component receives plain strings. `groupByBucket` now keys off the pre-computed `bucket` field instead of recomputing from `occurredAt` at render time. The `<time>` element keeps `dateTime` as ISO and renders the pre-formatted ET hh:mm label.
- **`/settings/bd` placeholder**: new page at `src/app/settings/bd/page.tsx` using the existing `CollapsibleSection` chrome. Renders a "BD Settings — shipping in next session" callout with a bullet list of what Phase 3 covers (Verticals / SavedSearches / SendingDomains CRUD + global pause toggle), a workaround note pointing at `npm run db:studio` and the Today's Launch flow, and a Back-to-BD link.
- **Settings nav**: `SETTINGS_CATEGORIES` in `src/app/settings/settings-nav.tsx` gained `{ slug: "bd", label: "BD Engine" }` between Triggers and Connectors so the placeholder shows in the Settings left rail and the BD Settings link from `/bd`'s top-right no longer 404s.

## What Shipped in Ace 39.2 (2026-05-12)
- **Client Signal page (`/bd/client-signal`)**: Replaces the Phase 1 placeholder. Server component reads `ClientSignal` rows via `getCurrentOrg()` with `?filter=` search-param-driven where clause (`all` / `new-week` for status=NEW and detectedAt within 7 days / `acted` / `dismissed`). Unified `TabStrip` filter pills with per-bucket counts. Each row inside one `divide-y` card: square dark `LogoMark` placeholder with 2-letter mono initials, client name + primary contact summary (first `Contact` ordered by `lastActivityAt desc`, rendered as `name · currentDesignation · firstEmail`), `jobTitle` + MapPin `location` + Clock "Posted X days ago · via Indeed", right column with `View listing` (`externalUrl`, target=_blank, rel=noopener) + disabled "Reach out" pill (tooltip "Mail composer pre-fill ships in Phase 4"; flips to "Reached out" when row.status !== NEW). Empty state copy "No new client job postings detected. We scan every morning at 6 AM."
- **Active Campaigns page (`/bd/campaigns`)**: Replaces the Phase 1 placeholder. Server component lists newest-first `BDRun`s scoped to org (limit 100), each row carrying its vertical mute pill, "Day X of Y" eyebrow (saturates at `SEQUENCE_DAYS = 7`), `SavedSearch.name` as the campaign label, sub-line "Started {date} · Sequence {name}" (sequence name falls back to "BD Outbound v1" until a real Campaign row exists), and an inline metric strip (Sent / Opened · % / Replied · % / Bounced · % / Unsub) computed from a single `prisma.campaignEvent.groupBy({ by: ['campaignId', 'kind'], _count: { _all: true } })` across every Campaign linked to the page's BDRuns. Replied % uses `text-court-brand-dark`; Bounced % flips to red ramp above 8% (`BOUNCE_RED_THRESHOLD`). Trailing sparkline "—" placeholder. Domain health 5-dot strip overlays current `SendingDomain.status` (looked up by name from `BDRun.plan.domains`) — HEALTHY = brand green, WARMING = brand/40, COOLED = red-500, empty slot = transparent ring. Disabled pause stub (`<button disabled title="Pause/resume ships in Phase 4">`), chevron with hover translate. Whole row is a `<Link>` to `/bd/campaigns/[id]`. Empty state: "No active campaigns. Launch one from Today's Launch."
- **Campaign detail stub (`/bd/campaigns/[id]`)**: New route. Server component scoped to org (404s for foreign BDRuns), back link to Active Campaigns, vertical eyebrow + SavedSearch name as title + status/started subtitle, `BDRun.plan` and `BDRun.metrics` rendered as pretty JSON inside tokenized `<pre>` code blocks (`bg-court-surface-subtle`), and a dashed-border note "Contact list ships in Phase 4."
- **Activity page (`/bd/activity`)**: Replaces the Phase 1 placeholder. Server component reads `BDActivity` rows scoped to org with `?filter=` mapped to enum kinds (`sends` → ENROLL, `replies` → REPLY, `bounces` → BOUNCE, `domains` → DOMAIN_COOLED + DOMAIN_RESUMED) and `?before=<ISO>` cursor for pagination. Unified `TabStrip` filter pills. Rows grouped client-side into Today / Yesterday / 2 days ago / Older buckets (UTC start-of-day math); empty buckets are dropped so the page never renders a header over nothing. Each entry is a 20px circular glyph + payload-aware event text + right-aligned hh:mm timestamp. Glyph tone palette: reply → `bg-court-brand-tint text-court-brand-dark`, send → blue-100/700 (dark blue-950/40 / blue-200), info → court-surface-subtle / court-fg-muted, warn → amber-100/700, bounce → red-100/600. `PAGE_SIZE+1` (51) lookahead drives a "Load earlier activity" pill that links to `?before=<oldest.occurredAt>` so no second count query is needed. Empty state: "No BD activity yet. Activity will appear here once your first BD run completes."
- **Today's Launch preview chip copy fix**: `src/app/bd/launch/launch-view.tsx` — the green preview chip now reads `up to 80 contacts` instead of `~80 contacts`. The contact cap is a ceiling, not a target; actual contacts surfaced per run varies based on how many qualified contacts Apollo finds per company.
- **Court Mode token discipline**: every new BD page reads exclusively from court-* tokens. Bounce-red + warn-amber glyph tones on Activity use the Tailwind ramps already established by the Reject / Apply button variants. Amber `#F59E0B` is still scoped to the Today's Launch CTA only — no new hardcoded hex landed in Phase 2.

## What Shipped in Ace 39.1 (2026-05-11)
- **BD Prisma schema (Phase 1)**: 9 new models (`Vertical`, `SavedSearch`, `SavedSearchVersion`, `SendingDomain`, `BDRun`, `Campaign`, `CampaignEvent`, `BDActivity`, `ClientSignal`) and 4 enums (`BDRunStatus`, `SendingDomainStatus`, `BDActivityKind`, `ClientSignalStatus`) all `organizationId`-scoped per architecture rule 8. Inverse relations on `Organization` (9 new) and `Client` (1 new — `clientSignals`). `BDRun.plan` and `BDRun.metrics` stay as `Json` so the cron-side shape can drift while Apollo wiring is prototyped. `(organizationId, slug)` unique on `Vertical`, `(organizationId, domain)` on `SendingDomain`, `(organizationId, externalUrl)` on `ClientSignal`. Schema applied via `prisma db push` — there is no `prisma/migrations/` directory in this project, the canonical workflow is `npm run db:push` (caught and avoided `prisma migrate dev` which would have offered to reset the live Neon database).
- **Sidebar BD entry**: `src/components/sidebar.tsx` CRM group now `Jobs → Clients → BD` (Megaphone icon from lucide-react). Sits in the CRM group between Jobs and the Inbox section break per the brief.
- **`/bd` layout shell**: `src/app/bd/layout.tsx` renders the unified `TabStrip` with 4 tabs (Today's Launch / Client Signal / Active Campaigns / Activity) plus a right-aligned BD Settings link to `/settings/bd` (route stub — page lands in BD Phase 2). `usePathname()` resolves the active tab. `src/app/bd/page.tsx` redirects to `/bd/launch`. Note: the prompt called for `src/app/(app)/bd/layout.tsx`, but no `(app)` route group exists in this codebase — every other route sits directly under `src/app/`, so BD matches that convention at `src/app/bd/`.
- **Tab placeholder pages**: `client-signal`, `campaigns`, `activity` ship as minimal "coming soon" pages so the tab strip click navigation never 404s while the real surfaces are deferred.
- **Today's Launch page (`/bd/launch`)**: `src/app/bd/launch/page.tsx` (server component) loads verticals + saved searches + first 5 sending domains + the most recent BDRun for the caller's org via `getCurrentOrg()`. Renders `LaunchView` (`src/app/bd/launch/launch-view.tsx`, client component) with vertical segmented control (chip-style toggle group with active-state Court Mode brand-tint surface), saved-search `<select>` filtered to the active vertical, preview chip (companies → contacts · sequence · 5 rotating domain dots; empty-outline dots fill the slot count when fewer than 5 domains exist), and amber Launch CTA. On launch click a confirmation modal opens with the same preview chip and Cancel/Launch buttons.
- **`POST /api/bd/runs`**: `src/app/api/bd/runs/route.ts` validates `verticalId` and `savedSearchId` both belong to the caller's org (cross-tenant guard), snapshots up to 5 HEALTHY sending domains by `lastUsedAt` into the BDRun.plan blob, and inserts the row at status=QUEUED. Returns `{ id, createdAt, status }` so the client can confirm. The morning cron (BD Phase 3) will pick up QUEUED rows and walk them through Indeed → Apollo.
- **Court Mode compliance**: only one hardcoded hex in BD pages — amber #F59E0B + hover #D97706 on the Launch CTA (reserved per the BD handoff and BreakPoint button-color convention). Every other surface in BD uses Court Mode tokens (`court-brand`, `court-brand-tint`, `court-brand-dark`, `court-surface`, `court-border`, `court-fg`, `court-fg-muted`, `court-fg-dim`).
- **Daily contact cap + pause-all toggle scaffold**: the Launch CTA disables when `contactsUsedToday >= contactCap` (cap reads from `SavedSearch.contactCap` with a default of 80) and when `PAUSE_ALL` is on (hardcoded `false` in Phase 1 — lifts to a `Setting` row when `/settings/bd` ships in Phase 2). `metrics.contacts` is only populated after a real cron run completes, so the cap-hit branch never trips in Phase 1.

## What Shipped in Ace 39.0 (2026-05-11)
- **Job Overview single card**: full-width inline-editable card on `/jobs/[id]?tab=overview`. Two-column split retired — single Edit / Save / Cancel toggle drives every field.
- **Matches tab cleanup**: Sort / Columns / Export pills removed from the per-job Matches tab (filter rail already drives every cut). Filter sidebar narrowed. Bulk action bar simplified to Apply to Job / Add to List / Reject / Clear.
- **Jobs row click**: clicking a row on `/jobs` navigates to the job. Inline edit moved into the Job Overview card so the row stops competing with itself.
- **Rejected tab on `/jobs/[id]`**: new tab listing every Placement at `stage="rejected"` for the job. Each row carries a Reapply button.
- **Reapply = clean-slate DELETE**: Reapply on the new Rejected tab and on the candidate profile deletes the Placement row entirely rather than flipping the stage. The candidate falls back to no-relationship for the job so the next Apply / Submit starts fresh. RF path uses the existing `onUnrejectViaDelete` (stage="disqualified") + `unrejectCandidateJob` (stage="rejected"). Ace-native path uses the new `reapplyLocalPlacement` server action — org-scoped, validates `stage === "rejected"`, deletes the row, writes an `ActionLog` (`actionType: "reapply_local_placement"`), revalidates `/candidates/{id}` and `/pipeline`.
- **`LocalPlacementRows` local state**: jobs prop mirrored into `jobsState` with `useEffect` sync; new `onPlacementRemoved(placementId)` callback threaded into `LocalJobActionRow` filters the row out of local state on Reapply success so it disappears without waiting for `router.refresh()` (which would race the Postgres commit).
- **Bulk reject permanent**: the bulk-reject action on the Matches tab now writes to Neon permanently instead of popping rows from local state. The row stays rejected across reloads and the new Rejected tab picks it up.
- **Button color sweep**: amber = Apply to Job, light blue = Keep, red = Reject, green = Submit restored across the candidate profile pipeline rows + the Matches tab split-view chrome + the per-job pipeline rows. New `reapply` variant in `src/components/ui/button.tsx` uses the soft violet ramp (`bg-violet-50 text-violet-700 border border-violet-200`, dark counterpart `bg-violet-950/40 text-violet-200 border-violet-900`) so the inverse of Reject reads as a different intent at a glance — cooler than the offer/pending-start purple so the two intents don't blur.
- **Dark mode sidebar tokens on `/candidates`**: filter rail rewired to `bg-court-surface-subtle` + `border-court-border` + `text-court-fg` so it tracks Court Mode dark variants instead of reading near-white.
- **Sortable Last Apply + Last Action on `/candidates`**: new header chevrons drive `ORDER BY lastApplyAt` and `ORDER BY lastActionAt` (nulls last). Same sort state survives filter changes.
- **Null snippet cleanup**: rows with no resume hit + no experience-JSON match render nothing under the row instead of an empty placeholder line.
- **Snippet inline with row, no internal divider**: snippet sits flush under the row title with no internal divider; full-width horizontal divider only fires at the row boundary. Pairs with the full-width split-view top divider so the candidate name list (left) and the profile column (right) read as one continuous chrome bar.
- **Zip-code geocoding via Nominatim postalcode lookup**: a pill that looks like a 5-digit zip ("44115") geocodes via Nominatim's `postalcode` parameter to a real lat/lng + bounding box. Falls back to city-name lookup on miss, and to `location ILIKE` contains-match on geocode failure.
- **Page header sizing**: page-title fonts bumped to 30px across the app. New-item buttons (New Candidate / New Job / New Client) shrunk so the page title carries the visual weight.
- **Bulk Apply to Job + Add to List**: both actions exposed from the bulk action bar on `/candidates` and the per-job Matches tab. Apply to Job opens a job picker (only jobs the recruiter has access to); Add to List opens the list picker. Each writes per-candidate via the existing single-row server actions wrapped in `Promise.all`, with one toast summarizing the row-count outcome.
- **Mail bulk move-to scrollable**: the move-to dropdown on the mail bulk action bar now scrolls when the label list exceeds the viewport. Was overflowing for users with deep nested labels.
- **Mail inbox auto-refresh (30 s)**: `/mail/inbox` polls the inbox metadata every 30 s, diffs against the rendered list, and reconciles in place so the scroll position survives a refresh.
- **Drag-to-label in mail sidebar**: drag a single thread (or any currently-selected thread set) onto a label in the mail sidebar to apply/move it. Mirrors the bulk move-to action.
- **Mail attachment display + download**: thread view now renders inline images and shows download chips for non-image attachments. Click downloads the original file.
- **Interview scheduler timezone selector**: Schedule modal picks up the recruiter's profile timezone as the default and allows per-interview override (e.g. scheduling for a West Coast candidate).
- **Interview scheduler past date blocking**: `DateTime15Picker` `blockPast` flag wired in on the Schedule path so the picker disables dates in the past. Reschedule deliberately still allows past times so a recruiter can correct a previous mistake.
- **Open meeting toggle on Video interviews**: "Open meeting (anyone can join)" checkbox defaults ON for Video interviews. Off locks the Meet to invited attendees only.
- **Native Google Calendar invites per party**: candidate and client get separate calendar events with party-tailored descriptions — candidate event includes interview prep tips, client event includes candidate details + résumé link. Both render the native Gmail Accept / Decline / Maybe block.
- **Template pre-population for invite composers**: interview-scheduled templates pre-fetched via `getInterviewSchedulingTemplates()` and threaded into both Candidate and Client composers so the recruiter sees configured Subject + Body first paint. Falls back to the hardcoded default on lookup failure.
- **Meet settings link after Video schedule**: after a Video interview saves, a banner / toast surfaces a deep link to Google Meet's Trusted vs Open access settings so the recruiter can flip the meeting's access mode without leaving the flow.
- **Back button preserves invite-flow state**: pressing Back from the Candidate composer returns to the Schedule modal (which stays mounted) with every field intact. The in-flight calendar event is cancelled at that point so a clean reschedule is possible. Back from the Client composer steps to the Candidate composer (re-PATCH is idempotent).
- **Search term highlighting on candidate profile**: when the profile opens from the rail with `?q=`, query tokens are `<mark>`-highlighted in amber on the structured fields (name, current title, current organization, location). Same tokenizer that powers the snippet enrichment so highlights stay in lockstep with what drove the row in.

## What Shipped in Ace 38.1 (2026-05-11)
- **Postgres search indexes**: indexes on `Candidate(firstName)`, `Candidate(lastName)`, `Candidate(email)` plus `Contact(name)` and the substring-into-`Contact.emails[]` lookup so the rail + bulk imports + the mail typeahead routes stop sequential-scanning. Landed first so the rest of the surface wasn't built on slow scans.
- **Candidate Sourcing Surface — left rail**: faceted filter sidebar shared between `/candidates` and `/jobs/[id]?tab=matches`. Fields: keyword/Boolean (`q`), Skills, Job titles, Min/Max comp, Locations (multi-pill, pipe-delimited, OR'd as bounding boxes via Nominatim geocoder, in-process cache, fallback to text contains), Distance (10/25/50/100 mi, clamps at 500), Employer (multi-pill, scope toggle Current only / Current + Past), Tenure at current employer (`lt1` / `1to3` / `3to5` / `gt5`), Work authorization (accepted but no-op until schema gains a column), Last apply, Last action.
- **Tag pills with include/exclude**: every Skills / Job titles / Employer pill carries its own `{ value, exclude }`. UI: leading toggle button — green Check on `bg-court-accent-tint` (include) flips to red Minus on `bg-red-100` (exclude). Server side: `field=…` and `excludeField=…` ride on separate params; route AND-composes includes (via `OR(contains, …)` for titles, `hasSome` for skills, `OR(currentOrganization contains, …)` for employer current-scope, raw-SQL ID resolve for employer any-scope) and AND-NOTs excludes via the symmetric `NOT(...)` clause shape.
- **Geocoded radius search**: each location pill geocodes through Nominatim with module-level cache + 5s timeout + user-agent string. Distance pill emits a degree-per-mile bounding box (1° lat ≈ 69 mi, 1° lng shrinks with cos(lat)); pills OR together so a candidate matches if they fall in any resolved box. Un-geocodable pills (e.g. "Remote") degrade to a `location ILIKE` contains-match.
- **Keyword / Boolean search**: per-token UNION across structured columns (`firstName/lastName/currentDesignation/currentOrganization/location` ILIKE, `unnest(skills)` ILIKE), `experience::text` + `education::text` casts ILIKE (Prisma can't ILIKE jsonb directly so this branch is raw SQL), and `CandidateResume.extractedText` ILIKE. Tokens AND together at the candidate level via per-token `id: { in: [...] }` clauses so multi-word queries honor "every token in at least one source". Boolean stopwords `and` / `or` are tokenizer-dropped so "tax AND ohio" and "tax ohio" return the same set. LIKE-escape on `%`, `_`, `\` so a recruiter pasting "100%" doesn't trigger a wildcard sweep.
- **Resume snippet enrichment**: one batched `candidateResume.findMany` per result page returns the most recent extracted text per candidate where every token co-occurs; 200-char window centered on the earliest hit, leading/trailing ellipses indicate truncation. Falls back to a snippet built off `experience::text` when no resume matches all tokens. Tokens are `<mark>`-highlighted client-side using the same tokenizer mirror so the highlights stay in lockstep with what drove the row in.
- **Split-view profile**: clicking a result row collapses the rail to 0 and opens the candidate profile in an iframe with a prev/next stepper, "All Candidates" return, and Close X. Same pattern on the job Matches tab; iframe sources `/candidates/[id]?embed=true` so the embedded view drops chrome.
- **Job-specific Matches tab actions**: split-view chrome on `/jobs/[id]?tab=matches` adds Apply to Job, Keep, and Reject. Apply hits `/api/placements` at `stage="APPLIED"` via the existing `applyLocalCandidateToJob` server action (auth, org scope, dupe check, ActivityLog, applied-confirmation email trigger all live there). Reject creates a `stage="rejected"` Placement (or bumps an existing one), `syncedToRf: false`, `source: "recruiter_rejected"`, with an ActivityLog entry. Keep toggles `Candidate.tags` containing "kept". Rejected candidates are then NOT-filtered out of subsequent rail searches scoped to that job via `NOT: { placements: { some: { jobId, stage: "rejected" } } }` so they don't resurface here. Dedicated Rejected tab UI ships next session.
- **Save search**: `/candidates` parks up to 5 snapshots in localStorage (`ace.saved-searches`); generateSearchLabel composes a "Tax Manager · Cleveland · Frito Lay" label from the most distinctive include fields. Saved-search pills replace the empty state once any save exists. Defensive `coerceFilters` migrates legacy snapshots (`skills: string[]`, `jobTitles: string[]`, `employer: "X"`) into the new `Pill[]` shape on load. Job Matches tab persists one snapshot per job to `Job.savedSearchFilters` via `saveJobSearchFilters`, a tenant-scoped server action; `coerceFilters` on the matches tab does the same migration on read. Run Search button retired — the debounced filter useEffect handles every fetch.
- **Employer scope toggle (Current only / Current + Past)**: Current branch uses Prisma `currentOrganization: { contains, mode: insensitive }`. Any branch runs raw SQL ILIKE against `currentOrganization` and `experience::text` so former-employer matches surface. New `resolveEmployerAnyIds` helper joins per-value patterns with `Prisma.join(orParts, " OR ")` (separator must be a plain string, not Sql); excludes for any-scope route through `id: { notIn: ids }`.
- **Bulk action bar**: row checkboxes on every result row + indeterminate-aware select-all. When >0 selected the action bar lifts above the table with a Clear button and a "Remove from results" reject-variant that drops the selected rows from local `rows[]` / `total` state. No DB write — this is recruiter view-state, not a soft-delete.
- **Sidebar pinned to viewport**: rail uses `h-[calc(100vh-72px)]` + sticky `Save search` + `Saved Lists` footer so the Save block stays visible no matter how long the result list runs.

## What Shipped in Ace 36.0 (2026-05-07)
- **YouTube floating player**: draggable + resizable panel via YouTubePanelProvider, topbar Music-icon toggle, YouTube Data API v3 search proxied through `/api/youtube/search` (server-side API key, tenant-scoped), video-first playing state with iframe full-bleed, hover overlay controls (back / minimize / close), viewport boundary clamping on drag + window resize, minimize keeps the iframe mounted so audio continues, CSP fix adding youtube.com + youtube-nocookie.com to frame-src, 50 results per search with View More pagination via `?pageToken=`, channel search and channel view (`?channelId=` filter, `order=date`).
- **Spotify floating panel**: full Spotify-mobile-style UI, OAuth login via `/api/auth/spotify` with token + refresh cookies and transparent refresh through `spotifyApiProxy`, 3-tab bottom nav (Home / Search / My Library), Recently Played row on Home, Library tab with filter pills (All / Playlists / Albums / Artists / Podcasts) backed by `/api/spotify/playlists` + `/api/spotify/saved-albums` + `/api/spotify/followed-artists`, PlaylistView and AlbumView via shared detail route, ArtistView with top tracks + discography, full-panel Now Playing view with album art that scales via `flex-1 + object-contain`, minimize keeps audio playing, X closes and pauses via `/api/spotify/pause` + SDK disconnect, draggable + resizable shell, Spotify dark palette intentionally hardcoded (#121212 / #181818 / #1DB954 etc) scoped to `src/components/spotify-panel/`.
- **Word of Day pill**: Claude-generated word + definition cached in Neon `WordOfDay` model, demand-triggered daily reset (regenerates if today's row missing), click-to-expand popover, lives on the dashboard bottom bar.
- **Quote of Day pill**: Claude-generated quote + author cached in Neon `QuoteOfDay` model, click-to-expand popover, lives on the dashboard bottom bar.
- **Chess puzzle pill**: Lichess `/api/puzzle/next?difficulty=easiest` (~961 average rating), `react-chessboard` render, hint + show-answer flow on a wrong move, rating chip in popover header, streak tracker in localStorage (`ace.chess.streak` + same-day-failed guard), Back button + click-to-move added late in the session, day-stable cache so the puzzle doesn't change mid-day.
- **On This Day pill**: Claude-generated historical event for today's ET date cached in Neon `ThisDay` model, lives on the dashboard bottom bar (initial chip used Wikipedia REST then later moved into the briefing header — both routes cached in Neon).
- **Daily Horoscope pill**: Claude-generated via server-side proxy to dodge horoscope-app-api CORS, cached in Neon `Horoscope` model, sign configurable, lives on the dashboard bottom bar.
- **Dashboard bottom bar**: 6 pills — Chess, Word, Quote, On This Day, Horoscope, plus a Today's Briefing scroll anchor — consolidated into one row at the bottom of the dashboard. Later in the session the Word / Quote / Chess / On This Day / Horoscope chips moved into the briefing header itself; the bottom bar component has since been retired.
- **News feed redesign**: Apple-News editorial style with 4px colored left border per tab, pill-style tabs with per-topic accent colors, 4 tabs (Front Page / Public Accounting / Recruiting / AI & Tech — Local News dropped), one lead story + 3 list rows, collapsible header with localStorage persistence.
- **News feed cron**: 6 AM ET Vercel cron job at `/api/cron/news-feed` pre-generates that day's `DailyNewsFeed` rows for every tab, `CRON_SECRET` Bearer auth, `NEWS_API_KEY` (NewsAPI.org) replacing the prior Claude `web_search` round-trip — sub-2s response per tab vs the previous 25s timeout window. Topic queries use `searchIn=title` + phrase quotes + press-release domain exclusion to keep noise out.
- **Weather widget**: Open-Meteo `/v1/forecast` with browser geolocation (Cleveland fallback when permission denied), hover popover with current conditions + 6-hour hourly strip + 7-day daily forecast, custom day/night WMO icon dispatch including 2-tone partly-cloudy glyphs, 30-minute refresh interval.
- **Dashboard premium redesign**: green-tint page background, KPI cards with sage-tinted icon chips, Billing Tower in sentence case with primary Q2 billed-revenue focal + secondary cash-collected card, ambient layered shadows, tabular numbers across all stat displays, Activity Dashboard topbar title in Bricolage Grotesque to match the new Ace wordmark.
- **RF string sweep**: final user-facing RecruiterFlow string removed from the UI (last visible one had survived the earlier sweeps).

## What Shipped in Ace 35.0 (2026-05-07)
- Game Plan Context Depth: resume text via pdf-parse, raw JD text, internal recruiter notes, and client pipeline candidate resumes injected into every ai-workspace and Ace Assistant prompt. Applies to candidate, job, and client Game Plans plus Ace Assistant panel everywhere.
- Ace Assistant Phase 4 Data Access: search_candidates, search_jobs, search_clients, get_pipeline tools wired to live Neon. OR-logic scoring with stop words and plural handling. Historical pipeline queries merging placements and interviews. Clickable candidate and job links in results. Show more when results exceed display limit. Fixed open jobs intent, stage normalization, and conversation memory override bugs.
- Ace Assistant Phase 5 Actions and History: move_candidate_stage, add_note, draft_email action tools with confirmation card UI showing real entity names. Confirm executes Prisma write, Cancel dismisses. Claude History tab in Settings groups by conversationId, cleared chats preserved in Neon as separate conversation entries.
- Job Close and Delete: Close Job and Delete Job buttons on job overview page with inline confirmation. Ace Assistant can close or delete jobs via confirmation card with real job and client names.

## What Shipped in Ace 34.0 (2026-05-07)
- src/app/jobs/[id]/page.tsx: 6-tab JOB_TABS array (Overview / Job Description / Matches / Game Plan / Promote / Activity) + parseTab helper, default Overview, lazy per-tab data loads, JobTabs renders all from one source. Pipeline + Billing tabs deleted; ?tab=pipeline / ?tab=billing fall back to Overview.
- src/app/jobs/[id]/job-overview-tab.tsx + job-overview-quick-actions.tsx: snapshot facts grid, stage-count chip row reusing STAGE_ORDER/STAGE_LABELS/STAGE_TONE in the green-brand progression, quick-actions row (Edit Job stub, Find Matches, Copy Public Apply Link with toast, Generate JD stub), Search Health placeholder.
- src/app/jobs/[id]/job-description-tab.tsx: lifted raw-textarea state, Source URL row with Save URL + Parse Link, Raw paste row with Save Raw, GeneratedJdPreview card (Last generated relative timestamp + Copy JD), Internal Recruiter Notes textarea with save-on-blur.
- src/app/api/jobs/parse-url/route.ts: tenant-scoped route that always saves the URL first, fetches the page with desktop UA + 20s timeout, strips tags, sends to Claude (claude-sonnet-4-6) for JSON extraction, returns plain-text formatted result.
- src/app/api/jobs/generate-jd/route.ts: reads Job.rawJobDescription + structured metadata, calls Claude with the BreakPoint format spec, saves to Job.description + descriptionGeneratedAt, logs activity (job_description_generated), revalidates both URL shapes.
- src/app/jobs/[id]/job-overview-actions.ts: saveJobSourceUrl, saveJobRawDescription, saveJobInternalRecruiterNotes — all tenant-scoped.
- prisma/schema.prisma: Job gained sourceJobUrl, rawJobDescription, descriptionGeneratedAt, internalRecruiterNotes; new JobBoardStatus model + JobBoardStatusValue enum (NOT_CONFIGURED / READY / POSTED / SKIPPED) with @@unique([jobId, boardName]) and Job + Organization relations.
- src/lib/job-boards-shared.ts (NEW): pure client-safe constants + types (MAJOR_BOARDS, STATUS_ORDER, nextStatusValue, JobBoardStatusValueShared, MajorBoardName, MajorBoardDef). Zero Prisma deps.
- src/lib/job-boards.ts: server-only ensureMajorBoardsSeeded + listJobBoardStatuses helpers; re-exports the shared constants for source-stable server imports.
- src/app/jobs/[id]/promote-tab.tsx: PublicApplyLinkCard + Major Boards checklist + Local & Niche Boards add/edit/remove + Suggest Boards with Claude stub. Imports only from @/lib/job-boards-shared so PrismaClient stays out of the client bundle (/jobs/[id] route bundle dropped from 34.9 kB → 16.5 kB).
- src/app/jobs/[id]/job-board-actions.ts: tenant-scoped server actions — updateJobBoardStatus (cycle), updateJobBoardFields (notes/url/boardName on blur), addLocalNicheBoard (rejects duplicates against the unique index), removeJobBoard (refuses to delete majors).
- src/app/jobs/[id]/matches-tab.tsx (NEW): debounced search input with in-flight seq counter, results table with name/title/location/skills, Apply to Job button hits /api/placements at stage=APPLIED.
- src/app/api/jobs/search-candidates/route.ts (NEW): tenant-scoped tokenized candidate search (firstName / lastName / currentDesignation / currentOrganization / location contains insensitive; skills via String[] has), AND across tokens, alreadyApplied annotation from a Placement preflight.
- src/components/activity-feed.tsx + src/app/api/activity/[entityType]/[entityId]/route.ts: entityType union extended to include "job"; route pulls placements + interviews by both jobId cuid and numeric jobRfId, adds job_description_generated label.
- src/app/jobs/new/actions.ts: createJob now calls ensureMajorBoardsSeeded after Job.create so new jobs render Promote with the 6 majors immediately.
- src/components/ui/button.tsx: CLAUDE_PILL_CLASS exported constant, used by Find Matches button + 6 inline duplicates (mail Generate with Claude reply, email Generate, Generate Submittal, Parse with Claude on candidate intake, Summarize Terms agreements, Generate Summary benefits) so every Claude pill renders identically.
- src/components/game-plan/find-matches-button.tsx: switched from black bg-court-fg pill to CLAUDE_PILL_CLASS.
- src/app/candidates/[id]/local-candidate-actions.tsx + KeepCandidateButton: candidate-level resume action row (Add to List / Keep / Apply to Job / Add Note) lifted out of the sticky toolbar; toggleCandidateKept action writes Candidate.tags + mirrors raw.tags. Submit-to-different-job retired (Apply to Job covers it).
- src/app/jobs/[id]/pipeline-row-actions.tsx: Schedule labels renamed to "Schedule Interview" everywhere; local-placement-rows.tsx Submit/Schedule/Reject migrated to shared Button variants.
- ClaudePanelProvider on the root layout (Phase 3): page-aware context from usePathname, entityType + entityId sent in POST body, context pill in the header shows entity name, getEntityDisplayName helper + /api/claude-panel/entity-name route. buildClientContext / buildCandidateContext / buildJobContext fully cuid-only (no RF fallbacks).
- Mail composer height fix; mail thread auto-scroll to TOP of latest message; INBOX eyebrow + large heading dropped from /mail; compact Inbox header sits directly under the TopBar.
- Phone + mail viewport fix; focus-state polish; stale-placeholder sweep across Jobs.

## What Shipped in Ace 33.0 (2026-05-06)
- Ace Assistant Panel Phase 1: ClaudePanelMessage table in Neon (org-scoped), GET/POST/DELETE /api/claude-panel/messages, floating draggable/resizable panel mirroring mail thread popup, ClaudePanelProvider at root layout (survives navigation), chat-bubble topbar toggle, message history rehydrates from Neon on open, clear chat wipes Neon rows.
- Ace Assistant Panel Phase 2: /api/claude-panel/chat streams claude-sonnet-4-6 via NDJSON, Personal Trainer rules injected, web_search_20250305 enabled, freshness mandate, pulsing brand-color cursor while streaming, stream errors toast + drop empty bubble.
- Copy button + Email this button on every assistant bubble (reuses Game Plan components).
- Branded as Ace Assistant in all user-facing copy; internal files remain ClaudePanel.*.
- assembleResumeFromRf and collectUniquePipelineCandidates deleted; dropped RF imports across ai-workspace-context.ts.
- settings.json: Bash(git push:*) whitelisted.

## What Shipped in Ace 32.0 (2026-05-05)
- Game Plan Phase 3 — Email Context: getRecentTaggedEmails helper, ai-workspace route injects Recent Email Context block, Job Game Plan gets client email context via clientId, silent degrade on miss.
- Email History UI: TaggedThreadList component, GET /api/candidates/[id]/email-threads, GET /api/clients/[id]/email-threads, both org-scoped and deduped, opens floating viewer.
- Personal Trainer: PersonalTrainerRule model in Neon, 15 default rules seeded, personal-trainer-actions.ts, real-time GitHub sync to docs/ace/PERSONAL_TRAINER.md, all 5 Claude routes updated with buildPersonalTrainerBlock, Settings UI with Trainer + Rules sub-tabs.
- Settings Refactor: left-nav + dedicated page per category, 7 routes (appearance/notifications/connectors/email/branding/templates/personal-trainer), Templates renamed to Templates/Triggers with 3-tab strip, Branding server-rendered signature preview, phone unread-badge regression fixed.
- Topbar Txt/Call button: opens dial pad directly without navigating to Phone tab.

## Older history
Everything pre-Ace 32.0 lives in `docs/ace/ACE_ARCHIVE_COMPLETED.md`.
