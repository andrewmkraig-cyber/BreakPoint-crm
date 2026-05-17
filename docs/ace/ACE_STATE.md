# ACE_STATE.md
Last updated: 2026-05-17 · Ace 53.0

## Current Status
Current Version: Ace 53.0
Last Shipped: 2026-05-17
Live at: ace.breakpointtalent.com

## What Shipped in Ace 53.0 (2026-05-17)

Settings surfaces unified on the new card + row spec (closes the
"all settings" entry in the queued Ace 52 redesign prompts 11-17).

### Settings visual redesign (`ebd23c3`)
Every settings page now renders against the same chrome:

- **Page bg** — `bg-court-surface-subtle` wraps the layout so the
  white section cards pop.
- **Sidebar nav** — wrapped in a `rounded-2xl bg-court-surface
  shadow-sm p-3` card. Active items: `bg-court-accent-tint
  text-court-brand-dark font-semibold` in `h-9 rounded-lg` pills;
  inactive: `text-court-fg-muted hover:bg-court-surface-subtle`.
- **Section cards** — `CollapsibleSection` default + bd variants
  collapsed into one chrome: `rounded-2xl border-0 bg-court-surface
  shadow-sm p-6 mb-4` with `10px tracking-[0.18em]
  text-court-brand-dark` eyebrow above an `18px font-bold
  font-serif` title and `12px text-court-fg-muted` description.
- **Eyebrows** — each page passes a category eyebrow (Display,
  Alerts, AI Rules, Identity, Email, Automation, Integrations).
- **Row pattern** — Notifications, Triggers, Personal Trainer,
  Connectors, and Templates lists render as `divide-y
  divide-court-border-soft`, `py-3.5` rows with `13px font-medium`
  labels and `11px text-court-fg-muted` helper text.
- **Inputs** — `h-10 rounded-xl border-court-border` with
  `focus:ring-2 focus:ring-court-accent/10`. Branding, Templates,
  Triggers, Personal Trainer, Mercury all converged on this.
- **Primary buttons** — `h-9 rounded-full bg-court-accent text-white
  text-[12.5px] font-semibold`. Secondary: same shape, surface bg,
  `border-court-border hover:border-court-accent/40`.
- **Action buttons** in rows — `h-8 rounded-full` (templates edit /
  trash, personal-trainer rule actions).
- **Connected status chip** — `rounded-full bg-court-accent-tint
  text-court-brand-dark text-[10px] font-semibold px-3 h-6` for
  every connector that reports `Connected` (Gmail, Teams, Mercury,
  Gmail Push). Disconnect / degraded keep their existing semantic
  colors.

Per rule 12, every value lands on a Court Mode token — no hex
literals. Templates ditched the bordered card layout for a row;
body preview moved out of the list (still in the modal editor) so
the per-row info density matches the rest of the settings surface.

## What Shipped in Ace 52.0 (2026-05-17)

Same-day follow-on ship after Ace 51.0 closed in the morning. Visual redesign pass covering ten surfaces, bulk email extended to Candidate Lists, calendar create flow lands end-to-end (grid slot click, ComposeFAB New Event + New Reminder, TO/CC/BCC with autocomplete, Teams OAuth reconnected), and a stack of UI fixes that came out of the redesign work.

### Visual redesign pass — Prompts 1-10
Court Mode tokens enforced throughout per rule 12. Each surface was retuned to a screenshot-driven visual spec (hex literals mapped to `court-*` tokens before write). Surfaces covered in this batch:

1. **Dashboard / Clubhouse** (`cdf7ece`) — KPI tile chrome, Today's Briefing card, panel surfaces.
2. **Pipeline** (`9e08beb`) — table-stays-default, kanban-spec applied to row/column surfaces.
3. **Candidates search** (`b09ab5e`) — surfaces only, layout untouched; row chrome, snippet line, rail.
4. **Candidate profile** (`da8992d`) — surfaces only; header + sections + tab strip.
5. **Jobs grid + detail** (`ba38673`) — surfaces only; card chrome + detail panels.
6. **Job Description tab** (`2dfb72c`, `5629d89`) — JD surfaces; Copy JD button shrunk to `h-8 / text-[12px]`.
7. **Clients directory + detail** (`a987d66`) — list + profile chrome.
8. **BD dashboard** — surfaces only; carried in the same chain.
9. **BD settings panels** (`5327215`) — Settings ▸ BD card chrome retuned.
10. **Mail UI** (`76292b6`) — folder sidebar, thread list, reader pane retuned. Hex literals on Inbox/Sent/Drafts swapped for Court Mode tokens. Sender / subject / preview sizes bumped to spec; reader subject to `text-[20px] font-bold`; 6 reader-pane action buttons standardized to `h-8 px-3 rounded-lg text-[12px] hover:border-court-accent/40`. Deferred (no plumbing today): per-row unread dot, per-row label chip, iframe message-body typography, Playfair → font-serif mapping (Bricolage Grotesque), reader-pane Move To sizing (shared `MoveToMenu` component used by bulk toolbar).

Prompts 11-17 still pending (phone, appearance, placements, all settings, scoreboard, applicants, finances) — queued on the roadmap.

### Bulk email — Candidate Lists extension (`0b9ba57`)
Same `BulkEmailDialog` from the search-surface implementation now wired into the Candidate Lists surface. Recruiter can send to a saved list without rebuilding the recipient set. Inherits per-recipient merge field resolution and the >25 confirm gate from the prior implementation. Closes the Ace 51 known issue.

### Calendar create flow — grid slot + ComposeFAB
- **Calendar New Event modal with meeting type + provider routing** (`2efad52`). New event modal with meetingType (Google Meet / Microsoft Teams) and provider-aware Graph API / Google routing on save.
- **Grid slot click + ComposeFAB wired into new event modal** (`a0971e1`). Clicking a slot in week/day view pre-fills date + start/end time; ComposeFAB `+ New ▸ New Event` opens the same modal.
- **CC chip field on create event modal + tighter client picker mapping** (`c47f88c`). CC row added; client picker resolves to the right Client record across both cuid and legacyRfId conventions.
- **Candidate / Client typeaheads replaced with TO/CC/BCC chip inputs** (`8c0729f`). Event guest entry uses the same chip pattern as the mail composer To/Cc/Bcc rows.
- **Typeahead contact suggestions on TO/CC/BCC chip inputs** (`f56b6be`). Same 3-source merge (Ace Candidates / Ace Contacts / Gmail Sent recipients) the mail composer uses, dropped into the event modal chip inputs.
- **New Reminder entry in ComposeFAB** (`d710390`). ComposeFAB now surfaces New Event + New Reminder alongside the existing actions; closes the "+ New menu — New Event + New Reminder entries" queued item from Ace 51.
- **Teams OAuth reconnected** — the Microsoft Teams meeting branch shipped in Ace 51 needed a reconnect after the Settings UI refactor moved the connector card.

### Calendar + UI fixes
- **Mini calendar prev/next month buttons wired** (`8f0e0ab`). Mini cal navigation arrows previously no-op; now drive the visible month state.
- **Drop-up fix on typeahead** — TO/CC/BCC autocomplete dropdown flips upward when it would clip the viewport bottom (mail composer + event modal share the same input component).
- **Applied-jobs strip tightened** (`d710390`). Dense layout pass on the per-candidate applied-jobs row; closes the "Tighter applied-jobs strip" queued item.
- **Resume PDF viewer no longer clips** (`823ff9d`). Height cap on the candidate-profile embed PDF viewer removed; recruiter can read the full first page without scrolling against the iframe bounds.
- **DeleteClientButton fix** (`823ff9d`). Inlined the delete button to fix the missing-import error on `/clients/[id]`.
- **Unused imports / params cleanup after applied-jobs refactor** (`755f91b`).
- **KPI tile label alignment** (`9e8da16`). KPI tile label container gets `min-h-[32px]` so single-line and double-line labels align on the baseline across the dashboard strip.

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
