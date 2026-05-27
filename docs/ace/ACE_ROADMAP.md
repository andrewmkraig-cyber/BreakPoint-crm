# Ace Roadmap
Last updated: 2026-05-27 · Ace 67.9

## Active Build Sequence

### Session 57.0 Status
Reminder-system + calendar-drawer + dashboard-widget session as of Ace 57.0:
- DONE this session: full reminder system (grid + widget render, edit/delete, stacked lead notifications, FAB writes AceReminder, ET times), calendar drawer overhaul (interactive timezone + four US zones, quarter-hour pickers, duration pills, persist type + reminder state), dashboard This Week widget (FAB reminders, reminder/event lane split, freshness fix, up to 5/day), 36 (calendar auto-sync verified), 34 (bulk reject from Lists), 35 (interview auto-reminder), 33 (Templates + Triggers unified), 38 (Teams OAuth expiry + connector polish)
- DEFERRED (revisit after the sequence below): 28 (ToolExpense edit UI), 39 (calendar invite unknown-sender warning), 13 (date format refactor), 1 (PageWrapper / SectionCard chrome), 32 (BCC Austin clean fix)

### Session 60.0 Status
Toast/notification work (DONE Ace 60.0): reminder toast redesigned onto the shared SMS/email card structure in an amber palette; new In-app notification settings for duration (5s/10s/30s/Until dismissed, default 5s) and stack direction (Standard bottom-right vs Stack up top-right, position-based since sonner has no reverse-order prop); and a Dismiss All pill that shows when 2+ notification toasts are visible. New `src/lib/toast-prefs.ts` holds the prefs + active-toast counter. Awaiting Andrew's browser verification.

### Session 59.0 Status
Notification toast polish (DONE Ace 59.0): SMS toast `MessageSquare` icon, action buttons moved to a bottom row on both the SMS + email toasts to match the mockup, Mark as Read added to both (SMS via `markThreadReadAndBroadcast`, email via the `/read` route + `markThreadRead`), email toast Reply opens the floating thread straight into the focused reply composer (new `composerMode` open option), and the Settings phone "Try it" Call test removed. Awaiting Andrew's browser verification.

### Session 61.0 Status
Profile / pipeline regression close-out + features (DONE Ace 61.0): split-view candidate Delete restored; Apply / Keep / Reject real-time stage pill (optimistic, holds until server confirm) + the flash-then-disappear follow-on fixed; Add Note button removed from all four candidate profile locations; stage button visibility aligned to spec in `pipeline-row-actions.tsx`; phone thread auto-scroll to bottom on open; CalendarEventDrawer reminder mode (hides Guests / Location / Meeting type / All day / Timezone, ET hard-coded with a comment to pull per-user tz when multi-user ships); scheduled send (Send Later) on every email surface (`ScheduledEmail` table + per-minute Vercel cron + Retry toast); dark luxury login redesign; PWA badge auto-fire fix (`2d0081e`, null badgeCount in `unread-counts.ts`, sw.js cache `v5`); Auto Night Mode (`0dd1e41`, `UserProfile.autoNightMode`, 7pm/7am ET flip). Favicon / tab counter verified already correct. Awaiting Andrew's browser verification of scheduled send, the PWA badge, and Auto Night Mode.

### Next Up (after Ace 67.9)

- **Browser-verify the interview calendar fix.** Schedule a fresh interview, send client invite, send candidate invite, edit/reschedule once, then cancel. Confirm: Google shows one current event; Clubhouse + This Week each show one row per interview; Austin doesn't get a candidate-bodied "event updated" notification on the second send; cancelled events drop out of the widget + /calendar immediately without waiting for a manual sync.
- **Migrate Google `iCalUID` onto `CalendarEvent`.** Today's widget dedupe falls back to `title|start|end|meetLink` for cross-calendar duplicates because `iCalUID` isn't mirrored. Add `iCalUID String?` to `CalendarEvent`, populate it in `google-sync.ts`, then prefer it in `dedupeCalendarRows`. Once stable, drop the fallback key.

### Next Up (after Ace 67.8)

- **Browser-verify the offer popup + Edit Offer ship.** Confirm negative-salary / negative-fee-% rejection at input + submit; `($USD)` static label is visible and the dropdown is gone; fee % prefill is correct for clients with / without `feePct`; Edit Offer chip on /pipeline opens the popup prefilled and Save updates the same Placement row (count check); the chip only appears in the offer stage.

### Next Up (after Ace 67.7)

- **Wire invoice-detail to consume the seeded "Invoice Email" template.** Today the DB template row is visible + editable in /settings/templates, but `handleEmailDraft` still uses a literal in invoice-detail.tsx. Add `[Invoice Number]` / `[Fee Amount]` / `[Invoice Due Date]` to the merge-field system; have the invoice page server component fetch + merge the active template; pass to the client; fall back to the literal when the row is missing.
- **Editable trigger metadata (Event Name / Audience / Dispatch).** Currently read-only in the modal — code-coupled to the call-site, but the human-readable Event Name + Audience are pure DB metadata. A separate save action that accepts those fields would land cleanly without touching call-sites.
- **Create-new-trigger from the UI.** "+ New trigger" affordance on /settings/triggers that lets Andrew define a TriggerRule + tag a template without going through code. Note: the new trigger key still needs a code call-site somewhere to actually fire — UI-only creation produces a documentary row.

### Next Up (after Ace 67.6)

1. ~~**iOS-style input field pass.**~~ **DONE Ace 66.0** - shipped as the `court-input-frame` / `court-input-rect` system (pill on the search bar / SMS composer / Ace Assistant, rectangular on forms). See ACE_DESIGN.md, Input Field Treatment.
2. ~~**Liquid Glass floating-surface pass.**~~ **DONE Ace 66.0** - translucency + glass shadow stacks on the topbar, dropdowns, popovers, and modals (floating surfaces only).
Cancelled (Ace 66.0): QuickBooks standalone page, Quo setup wizard, and the APRO / job order worksheet - removed from the roadmap, not being built.

## Queued From Session
Items scoped during recent sessions. Each needs its own prompt before slotting into the active build sequence.

- **Unread badge count - Quo + reminder legs audit** - Gmail leg fixed in Ace 51 via push-driven refresh; the badge/title comprehensive fix (Next Up 1) covers the Quo + mail reliability legs. The reminder due-count leg still needs an audit pass before the aggregate badge is provably correct.
- **Search expansion map** - geocoded map visualization over the Candidate Sourcing Surface.
- **Mercury + QuickBooks integration follow-through** - Mercury feed live for the Finances module since Ace 46; QuickBooks sync + variable-cost categorization still pending.

Completed this session (Ace 63.0), moved out of this list: UnderlineTabLink canonical helper, the + New menu New Event + New Reminder entries, Notification read-state sync for Quo, tighter applied-jobs strip, JD/email markdown architecture verification, Bulk email Phase 2 (scheduled send + throttle), and the Admin edit UI for ToolExpense rows.

## Non-Urgent
Build soon, lower priority than the active sequence above.

- **CallLog read/unread model** - add a read/unread state to CallLog so missed calls can increment the Phone badge. No schema exists today (CallLog carries no read/unread field), so this needs a schema addition before the Phone badge can reflect missed calls.

Cancelled 2026-05-21 (Ace 63.0) - all other non-urgent backlog: reminders badge leg wiring, invite flow in Settings, LinkedIn import via RapidAPI, Slack sidebar panel, DocuSign auto-import, invoicing + QuickBooks + Mercury, GPT as second AI provider, Spotify podcasts tab, news feed per-tab refresh button, commission calculator, stock ticker strip, scoreboard widget, Ace launch countdown, Microsoft Teams video interviews, resume text view with search highlighting, resizable split-view divider on /candidates, Market Insights, Stalled Deals card.

## Queued Specs — Not Yet Prompted
Slotted in the Active Build Sequence but each needs a session-opening prompt before implementation. Full specs to be added next session; one-line stubs below for handoff.

_(none currently queued)_

## Cleanup
Do alongside other work.

- **Sentry N+1 fixes** — ACE-CRM-5 (37 events), ACE-CRM-6 (28), ACE-CRM-7 (2), ACE-CRM-9 (1), ACE-CRM-A (1). Fix via Prisma include eager-loading. **DONE Ace 65.0** - audit found 3 genuine N+1s (bulk-actions placement lookup, import-csv candidate lookup, match-by-name lookup), all converted to batched `findMany`.
- **Compound-unique widening** — 3 Placement compound uniques missing organizationId.
- **SmsMessage / CallLog / CallTranscript / AiWorkspaceMessage tenant-scoping**. **DONE Ace 65.0** - SmsMessage / CallLog covered by 9 query sites fixed across 5 files; CallTranscript / AiWorkspaceMessage scoping completed.
- **MANUAL** — delete `RECRUITERFLOW_API_KEY` from `.env.local` and GitHub Actions secrets.
- **MANUAL** — delete `src/lib/recruiterflow/` directory entirely. **DONE Ace 65.0** - confirmed nonexistent, no-op.
- **Postgres search indexes** — already in active sequence above; listed here for completeness.

## Future Ideas
Revisit at scale or workflow change — do not build now.

- Submittal tracker with read receipts.
- Counteroffer risk flag.
- Live placement probability score.
- Fee tracker with Austin auto-notify.
- Job fillability score.
- BD trigger alerts.
- Candidate re-engagement engine.
- Ace learning layer Phase 1 (replaced by client preference learning).
- Relationship graph + placement pattern learning.
- Settings fix generator.
- Activity-to-revenue analytics.
- Multi-recruiter permissions.
- Candidate profile full redesign.
- ARPO with call transcription auto-fill.
- **Email sequencing platform** — full multi-step sequencing UI (cadences, branch logic, A/B subject lines, drip enrollment, unenroll-on-reply) layered on top of the BD outbound infrastructure. Larger scope than the Phase 4 sequence engine ships; revisit when bulk email + BD outbound stabilize and recruiter workflow demands the full surface.

## Explicitly Killed — Do Not Build
- Stage-Triggered Template Actions System.
- AI Agent features (auto-suggestions, approve/dismiss, next-best-action).
- Candidate mood tracker.
- Help Docs Corpus.
- Per-org color theming.
- Demo mode / sandbox toggle.
- ZDR (Zero Data Retention).
- MCP Connection (Claude reads/writes Ace database directly).
- Co-recruiter splits.
- All SaaS / productization: BYOC, Stripe billing, public REST API, MCP server, SOC 2, external SSO, multi-tenant onboarding, marketing site.

---

## Completed - Ace 67.4 Gmail-native signature white-logo fix (May 27, 2026)

Fixed the Gmail settings version of the signature so Push to Gmail no longer writes a black-background logo into Gmail's native signature. The compact hosted asset path now explicitly uses `/brand/breakpoint_logo_signature.png` for the white-background BreakPoint logo, while the normal Ace-sent/copy path keeps inline base64 images. Andrew's primary Gmail SendAs signature was also repaired live with the compact white-logo HTML.

## Completed - Ace 67.3 PWA push notification self-heal (May 27, 2026)

Shipped the mobile PWA notification repair path. `src/lib/push-client.ts` now owns the client-side VAPID key conversion, push subscribe call, `/api/push/subscribe` POST, and granted-permission sync. `SwRegister` re-posts an existing PushSubscription on launch and auto-recreates a missing one when browser notification permission is already granted, which covers iOS PWA subscription expiry after idle/app close. `PushPermissionButton` uses the same sync so Settings > Connectors reflects the repaired state. A local per-device intent flag preserves explicit Disable and an in-flight guard prevents double-subscribe races between global registration and the Settings row.

## Completed - Ace 66.0 UI polish: input field treatment + Liquid Glass + New Job restructure + dark-mode buttons + list/table polish (May 23, 2026)

Shipped the input field treatment pass (the `court-input-frame` pill / `court-input-rect` rectangular system in `globals.css`, paired via `INPUT_FRAME_CLASS` / `INPUT_CONTROL_CLASS` - pill on the search bar / SMS composer / Ace Assistant, rectangular on forms) and the Liquid Glass floating-surface pass (backdrop-blur + glass shadow stacks on the topbar, dropdowns, popovers, and modals; heavier glow on the Ace Assistant / YouTube / briefing tiles; YouTube tabs moved to TabStrip). Restructured the New Job page into two numbered section cards with a TabStrip source toggle, a Save to Ace CTA, dark-fill green-ring number badges, and a top-aligned header. Swept dark-mode button fixes across invoice / note / call / connector buttons (invoice sent/paid + draft-row outlined, Draft Email blue, note Add/Save solid green), migrated the New Candidate flow onto Court Mode tokens, and added a `storage`-event listener so iframes re-skin on theme toggle. List/table polish: distinct table headers on pipeline / applicants / jobs, client card shadows + footer removal, pipeline + jobs search restyled to the clients style, uniform settings Save buttons (floppy icon), and the glass Contact Info panel. Full detail in ACE_STATE.md under What Shipped in Ace 66.0. Next up: QuickBooks standalone page (blocked on Intuit prod key) and the Quo setup wizard.

## Completed - Ace 65.0 Button/color standard cleanup + cleanup-queue clear + dark-mode polish + sidebar card token + PWA icon (May 23, 2026)

Closed the button/color standard cleanup (the fix pass the Ace 64.0 audit surfaced): removed `rounded-full` from text buttons, converted several one-offs to shared Button variants, and replaced the remaining hardcoded hex with Court Mode tokens; follow-up review fixes set phone Call buttons to solid filled green, squared the connector-banner Reconnect button to `rounded-md`, and set Upload Resume to the blue outline treatment. Cleared the deferred cleanup queue: deleted the abandoned `design/phase-1` branch (never merged), confirmed `src/lib/recruiterflow/` is already nonexistent (the MANUAL delete-directory item is a no-op), completed SmsMessage / CallLog tenant-scoping (9 query sites across 5 files, all org-scoped) plus CallTranscript / AiWorkspaceMessage scoping, and fixed 3 genuine Sentry N+1s (bulk-actions placement lookup, import-csv candidate lookup, match-by-name lookup, all batched to `findMany`). Shipped a dark-mode polish pass: glow added to floating popovers (briefing tiles, Ace Assistant, YouTube panel, + New dropdown) and tone-downs on skills chips, the candidate search selected row, and keyword highlight pills. Also added the `--court-sidebar-card` token across all 8 themes (fixes the washed-out sidebar profile card on Grass and Night Court) and regenerated the PWA icon to match the topbar Ace logomark (dark disc, green arc). The legacy render path retirement item was removed from the roadmap this session - abandoned, not being done. Full detail in ACE_STATE.md under What Shipped in Ace 65.0. Next up: the iOS-style input field pass.

## Completed - Ace 64.0 Push delivery + badge reliability fixes + connectors cleanup + mobile/topbar pass + button/color audit (May 22, 2026)

Shipped the push delivery regression fix (org fallback when `candidate.createdById` has zero push subscriptions, so notifications still land instead of silently dropping), the phone badge now counting unread messages instead of threads, and the badge reliability fix (the badge holds the last-known-good mail count when the live Gmail unread lookup fails, instead of resetting). Also shipped a Settings > Connectors cleanup (mobile overflow fixes + the Gmail Push Notifications connector removed), a mobile + topbar UI pass (mobile nav unread badges for Mail and Phone, mobile-only stat card compaction, profile card added to the PWA drawer, light-mode profile card fix for Grass and Night Court Light; topbar avatar removed, light/dark toggle + PWA Ace logo added, hamburger moved to the search row), and the weather fallback changed to Chagrin Falls OH. Closed the button/color audit: three doc-vs-code reconciliations captured in ACE_RULES.md + ACE_DESIGN.md (Generate-with-Claude buttons documented as solid-filled `ai-primary`, the AI-pill hex family added as a third documented hex exception scoped to `button.tsx` + `edit-with-claude-menu.tsx`, and the Spotify-panel `rounded-full` buttons documented as a shape exception); the remaining fix work - pill-shaped text buttons (1A/1B) + the 4 hardcoded hexes (2A) - is queued first in the active sequence. Also marked DONE this session: the multi-user login + permissions model, removed from Queued Specs. Full detail in ACE_STATE.md under What Shipped in Ace 64.0.

## Completed - Ace 63.0 Multi-user client ownership Steps 3-5 + push re-register UI + Quo webhook hardening + temp log cleanup + badge fixes (May 21, 2026)

Shipped multi-user client ownership Steps 3-5: read-only banner + hidden action buttons on non-owned clients with a claim flow for Available (owner-null) clients that stamps owner on claim; a Mine / Austin's / All dropdown on /jobs and /pipeline that defaults to the logged-in user's book and is URL-persisted (no locks on the detail pages); and a daily auto-release cron at /api/cron/client-release (8:00 UTC) with a 60-day createdAt grace floor and a last-activity line on the view-only banner. Also shipped: push notification re-registration UI (PushPermissionButton as a standalone Push Notifications row in Settings > Connectors with CONNECTED / DISCONNECTED status, fixes re-register after PWA reinstall); Quo webhook fromNumber hardening (new src/lib/quo-phone.ts pickPhone / redactPhone, inbound diagnostics, 14 unit tests); temp diagnostic log cleanup ([web-push][diag] and [badge-diag] removed); and the badge fallback fix (Quo SMS/call omit badgeCount when unreliable instead of sending 1). The comprehensive badge/title reliability fix shipped this session and carries into Next Up 1 for production confirmation. Also confirmed done by Andrew this session: UnderlineTabLink canonical helper, New Event + New Reminder in ComposeFAB, Quo read-state sync, tighter applied-jobs strip, JD/email markdown architecture verification, Bulk email Phase 2, and the Admin edit UI for ToolExpense rows. Full detail in ACE_STATE.md under What Shipped in Ace 62.0 and 63.0.

## Completed - Ace 61.0 Profile/pipeline regression close-out + scheduled send + login redesign + PWA badge fix + Auto Night Mode (May 20, 2026)

Closed the carried profile/pipeline regressions and shipped four features. Fixes: split-view candidate Delete restored; Apply / Keep / Reject real-time stage pill (optimistic, holds until server confirm) plus the flash-then-disappear follow-on; Add Note removed from all four candidate profile spots; stage button visibility aligned to spec in `pipeline-row-actions.tsx`; phone thread auto-scroll to bottom on open; CalendarEventDrawer reminder mode (hides Guests / Location / Meeting type / All day / Timezone, ET hard-coded with a comment to pull per-user tz once multi-user ships). Favicon / tab counter verified already correct. Features: scheduled send (Send Later) on every email surface (`ScheduledEmail` table in Neon, per-minute Vercel cron, failure toast with Retry); dark luxury login redesign (world map, Solon OH HQ, stats + Global Desk eyebrow removed); PWA badge auto-fire fix (`2d0081e` - numeric `badgeCount` in `unread-counts.ts`, sw.js cache `v4 -> v5`); Auto Night Mode (`0dd1e41` - `UserProfile.autoNightMode`, dark at 7:00 PM ET / light at 7:00 AM ET, profile-saved). Full detail in ACE_STATE.md under What Shipped in Ace 61.0. (Ace 58.0-60.0 detail also lives in ACE_STATE.md - SMS View popup, SMS + email toast redesign, reminder toast + duration / stack-direction settings + Dismiss All, plus the legacy-render Phase 0 audit.)

## Completed - Ace 57.0 Reminder system + calendar drawer overhaul + dashboard This Week widget (May 20, 2026)

Shipped the Ace-native reminder system end to end (calendar grid + dashboard widget render, panel edit/delete, stacked lead-time toasts, FAB writes AceReminder rows, ET times), overhauled the calendar create/edit drawer (interactive timezone limited to the four continental US zones, quarter-hour time pickers, duration pills, persisted event type + reminder toggle state), and built the dashboard This Week widget (FAB reminders surface, reminder/event time-slot collisions split into left/right lanes on week + day grids, compact day-view lane tiles, dashboard freshness via router-cache staleTime 0 + focus auto-refresh, up to 5 events per day before "+N more"). Closed items: 36 (calendar auto-sync verified), 34 (bulk reject from Lists), 35 (interview auto-reminder on scheduling), 33 (Templates + Triggers unified Settings page), 38 (Microsoft Teams OAuth expiry surfaced + connector status pills + focus-aware push suppression). Full detail in ACE_STATE.md under What Shipped in Ace 57.0.

## Completed - Ace 56.0 Polish queue close-out + outbound em-dash scrub + AI Workspace prose fix (May 19, 2026)

Closed the next slice of the backlog: StageAgePill extraction (22), news-feed mobile overflow (24), ClaudePanel touch fixes (25 + 25b), candidates panel resizer (26), PWA badge audit (30), em-dash scrub on outbound email (37), AI Workspace prose line breaks (41), plus font-weight reconciliation, PWA nav rebuild, email popup Mark as Read, and iMessage-style texting polish. Item 36 (calendar auto-sync after scheduling) is in progress and carries into Ace 57.0 as the first item.

### Pipeline + reusable UI
- **Item 22 — StageAgePill extracted to `src/components/ui/stage-age-pill.tsx`.** `pipeline-view.tsx` now consumes `<StageAgePill value={r.daysInStage} />`. Verbatim className, thresholds, null em-dash placeholder preserved.

### News feed mobile overflow
- **Item 24 — `news-feed.tsx:398` wrapper gets `overflow-x-auto`.** Four child pills wrapped in `min-w-0 overflow-hidden` divs so long entity strings don't blow out the row on narrow viewports. Desktop 2-col grid unchanged.

### Claude Panel touch
- **Item 25 — `ClaudePanel.tsx` drag + scroll touch.** Header drag div: `touchAction: none`. `onHeaderPointerDown` calls `stopPropagation` after `preventDefault`. `listRef` scroll container: `touchAction: pan-y`.
- **Item 25b — Composer affordances.** Close X button (`:1196`): `touchAction: auto`. Message textarea (`:1328`): `touchAction: manipulation`.

### PWA — nav + manifest shortcuts
- **`mobile-nav.tsx` NAV_GROUPS rebuilt** to Clubhouse / Inbox / ATS / CRM / Ops / Scoreboard / Settings.
- **`manifest.json` shortcuts array** added with 14 long-press home-screen targets.

### Email popup Mark as Read
- **CheckCheck button in floating thread toolbar.** Renders only when the thread is UNREAD via a `useState<boolean>` gate. Only flips to `false` after the API resolves. No auto-mark on open. POSTs `/api/mail/threads/{id}/read` + fires Gmail `labelMessage`.

### Texting visual polish
- **iMessage-style layout in `phone-view.tsx`.** Inbound `bg-white rounded-bl-sm` left-aligned. Outbound `bg-court-brand text-white rounded-br-sm` right-aligned. Timestamps outside the bubbles. Date separator pills in `MON, APR 27` format. Closes the inbound SMS bubble color item raised at Ace 55.0 close.

### Candidates split view — resizable left panel
- **Item 26 — Drag handle between list and detail.** Min 200px, max 480px. Width persists to localStorage at `"ace-candidates-left-width"`. Default 256px.

### Notifications + badges
- **Item 30 — Audit only.** Gmail leg confirmed working, Quo leg confirmed working, Reminders leg intentionally not wired (toast-only for now). Stale `unreadCount:0` field at `src/app/api/phone/threads/route.ts:251` flagged for future cleanup. No code changes.

### Em dashes — outbound email scrub
- **Item 37 — Em dashes scrubbed.** Template seeds in `templates-actions.ts` cleaned. New `stripEmDashesFromTemplates` migration runs from `ensureDefaultTemplates` and scrubs existing DB rows. Runtime strip in `fireTemplatedEmail` (subject + body after `applyMergeFields`). Claude prompts cleaned in `claude.ts`, `format-email/route.ts`, `ai-workspace/route.ts`. Table cell em-dash placeholders for null/empty states preserved per `feedback_no_em_dashes` exception.

### Font-weight reconciliation
- **`kpi-tile.tsx` font-bold → font-extrabold.** Matches client profile `Stat`. Consistent across both surfaces.

### AI Workspace prose
- **Item 41 — `collapseProseHardBreaks` preprocessor.** Added to `MarkdownContent` in `AiWorkspace.tsx`. Strips CommonMark hard-break syntax (two trailing spaces + newline, backslash + newline). Paragraph breaks preserved. Scoped to AI Workspace + Claude Panel only.

### In progress
- **Item 36 — Calendar auto-sync after scheduling.** Helper `triggerCalendarSync(router)` extracted to `src/lib/calendar/trigger-sync.ts`. Wired into 4 schedule + 1 reschedule callsites in `local-placement-rows.tsx` + `placement-flows.tsx`, plus `CalendarEventDrawer` create + edit. Browser verification pending.

Ace 57.0 opens by finishing Item 36, then works through Item 34 (Bulk reject from Lists) and Item 35 (Interview auto-reminder) per the new Active Build Sequence.

---

## Completed - Ace 55.0 Polish queue close-out + visual token cleanup (May 18, 2026)

Closed 11 items from the polish queue carried out of Ace 54.0 — calendar create unification, ComposeFAB global drawer wiring, Delete button placement parity, Edit Interview button across all 4 pipeline surfaces, Scoreboard KPI subtext, PipelinePill Court Mode tokens + client profile Stat sizing, ExpenseMerchantLogo + favicons, Mark as Read on Quo thread, and Add Number SMS verified.

### Calendar + reminders
- **CreateEventModal removed (item 7).** All calendar create entry points unified into `CalendarEventDrawer` create mode. `allDay` toggle and meeting type picker (Google Meet / Teams / Phone / In Person) ported into the drawer; `GuestTypeahead` wired into the recipients field.
- **ComposeFAB New Reminder global drawer wiring (item 3).** The "New Reminder" entry now dispatches through `CalendarDrawerProvider` so the drawer opens inline on whatever page the recruiter is on. No navigation to `/calendar`.
- **FAB overlay fix.** ComposeFAB New Event and New Reminder both open the drawer as a true overlay on the current page via the global `CalendarDrawerProvider`. Previously the FAB navigated the recruiter to `/calendar` before opening the create surface.
- **Timezone fix.** `CalendarEventDrawer` create mode was persisting datetimes as UTC; fixed to write ET offset so a 3 PM ET event saves as 3 PM ET.

### Pipeline + interviews
- **Edit Interview button across 4 surfaces (item 19).** `pipeline-view.tsx` (tiny underline link on `/pipeline`), `pipeline-row-actions.tsx` (rounded-md outlined button on the job pipeline tab), `local-placement-rows.tsx` (Ace-native candidate profile rows), `placement-flows.tsx` (RF candidate profile rows). Consistent action across every surface that shows an interview.

### Candidate + job profile chrome
- **Delete button placement parity (item 9).** `DeleteCandidateButton` and `DeleteJobButton` moved to floating bottom-right matching the `DeleteClientButton` pattern. All three entity profiles now place the delete action in the same predictable spot.

### Dashboard + finances
- **ExpenseMerchantLogo + favicons (item 27).** `ExpenseMerchantLogo` component renders Google `s2/favicons` icons on every recurring/one-time expense row on the Finances Expenses tab. Domain colocated on each `KNOWN_TOOLS` entry and on each `RecurringCatalogEntry` so the favicon URL resolves from the tool name automatically. (Also appeared in the Ace 54.0 ship list — closed out in 55.0 with the catalog colocation pass.)
- **Scoreboard KPI subtext now visible (item 15).** `ScoreboardKpiTile`'s `sub` prop renders as a visible 10px muted line under the value (was hover-only via `title=`).
- **PipelinePill Court Mode tokens + Stat sizing (item 17).** `PipelinePill` stage dots swapped from hardcoded hex to Court Mode tokens (`court-brand-dark` for submitted, `court-brand` for hired) + canonical Tailwind hues for typed stages. Client profile `Stat` value sized to `text-[26px]` to match the canonical `KpiTile`.

### Phone + texting
- **Mark as Read on Quo thread (item 29).** `ThreadDetailPane` header renders a manual "Mark as read" button (CheckCheck icon) when the current thread has `hasUnread: true`. Reuses `markThreadRead` + `refreshUnread`.
- **Add Number inline on SMS composer (item 21).** Verified working in browser; shipped in Ace 54.0, no code changes needed this session.

### New backlog items raised this session
- **Inbound SMS bubble color** — inbound bubbles should render grey (currently brand-green); outbound stays brand-green.
- **font-bold vs font-extrabold reconciliation** — minor cleanup between `KpiTile` (font-bold) and client profile `Stat` (font-extrabold).

Ace 56.0 opens with polish queue items 22, 24, 25 (see backlog PDF for descriptions).

---

## Completed - Ace 54.0 Polish queue close-out + Notes feature build (May 18, 2026)

Closed most of the 30-item polish queue carried out of Ace 53.0 and shipped the standalone Notes feature end-to-end.

### Candidate search + profile
- Boolean AND search on `/candidates` — multi-token queries require every term to hit; replaces the implicit OR.
- Keyword highlighting on the candidate profile resume — search tokens carry into the embed and `<mark>` every hit inside the resume text.
- Candidate inline editing for top-of-profile fields (name, title, employer, location, email, phone, LinkedIn) — save-on-blur.
- Tabs on `/candidates` for filtering, matching `/applicants` + `/pipeline` chrome.
- Job pill renders immediately after Apply without a reload.
- Resume highlight right panel removed from embed view (was crowding the resume).
- Submit modal renders as a true viewport overlay via portal so the candidate split-view iframe can't clip it.

### Composer + AI
- Custom Edit with Claude — freeform instruction input instead of a fixed preset menu.
- Generate with Claude chevron flipped to match sibling toolbar buttons.

### Dashboard + finances
- TrendCard zero-revenue fallback (clean 3-col text layout instead of three flat `$0` bars).
- Momentum widget excludes rejected placements.
- Goal Pacing padding + internal type scaled down to match canonical big-panel chrome.
- Invoice empty cells render em-dash placeholders.

### Settings + triggers
- Trigger warning banners on Settings ▸ Triggers when a rule is enabled but its template is missing/inactive or sendAsDraft is on without an email account connected.

### Phone + texting
- Outbound SMS bubble polish across `/phone` and the candidate sidebar.
- Add Number inline affordance on SMS composer when the candidate has no phone on file.

### Mail + phone layout
- `/mail` and `/phone` content surfaces extend full viewport width on wide displays.

### Sidebar + chrome
- Sidebar restructure: Inbox → ATS → CRM → Ops → Scoreboard, with Inbox pinned high; items within ATS and CRM alphabetized.
- White X bar anchored correctly so it stops floating over content at the topbar / app-shell seam.

### Buttons + TabStrip + visual unification
- Submit button unified across `/candidates`, `/applicants`, `/pipeline`, candidate profile, and embed view (rounded-md, filled brand green, white text).
- Final per-page tab strips converted to the canonical `TabStrip` component.
- `/applicants` table shows linked job title inline on each row.

### Notes feature — full build
- **Schema** — new `Note` Prisma model (org-scoped, per-user-private) with implicit many-to-many relations to Candidate / Client / Job; one note can attach to any combination at once. Back-relations named `noteEntries` on each entity to avoid collision with the existing `Candidate.notes` / `Client.notes` text columns. Prisma manages the three join tables.
- **/notes page** — composer-first layout. Always-visible doc-style composer with optional title, required body, and an Attach button that expands an inline multi-select picker (no popover — the initial popover overflowed the viewport on narrow surfaces). TabStrip filter (All Notes / My Notes / Attached) sits above the composer with live counts. Saved notes render below as NoteCard rows with hover toolbar (pin / re-attach / edit / delete).
- **Server actions + queries** — `createNote / updateNote / deleteNote / attachNote / setPinned` in `src/app/notes/actions.ts`, all scoped by `organizationId AND createdById`. Attachment payloads carry arrays per kind; the action verifies every id belongs to the same org before connecting. Queries in `src/lib/notes/queries.ts` use Prisma `some` / `none` on each relation.
- **ComposeFAB** — root menu collapsed to the six canonical entries in order: New Email → New Call → New Text → New Note → New Event → New Reminder. New Note opens a popup with title + body + inline multi-select picker. New Reminder dispatches `ace:calendar:new-reminder` to mirror the TopBar reminder affordance.
- **Activity feed integration** — `EntityNotesSection` server component reads notes attached to the current entity and renders above the existing `ActivityFeed` on `/clients/[id]` + `/jobs/[id]` activity tabs, and inline below `CandidateActivityCard` in the candidate-profile right rail. Cross-attachment chips link to every other profile the same note also lives on.
- **Sidebar** — new `/notes` entry under Ops with the StickyNote lucide icon, replacing the NotebookPen stub.
- **TopBar** — `/notes` title wired through `top-bar-page-title.tsx` under the Ops group breadcrumb.

Ace 55.0 opens with a full button + color audit (item 1 in the new Active Build Sequence) before any further visual work.

---

## Completed - Ace 53.0 Visual redesign attempt + full revert + surgical restoration (May 17, 2026)

Session attempted Prompts 1-17 of a sweeping visual redesign across every surface; result was inconsistent and broke too many pages at once. Pivoted to a full revert of all 41 redesign commits back to `f56b6be`, then surgically cherry-picked the three commits that were unambiguously good and applied them on top.

- **Full revert (`2a6b463`)** - single revert commit unwound the 41-commit range from `f56b6be..HEAD`. 82 files, -3,744 / +2,443 lines. Original commits remain in git history for selective cherry-pick.
- **Batch 1 restoration (`4c915b1`, from `50f2c54`)** - unified table system: `DataTableBody` + `DataTableRow` exports added to `src/components/ui/data-table.tsx`. `applicants-view.tsx`, `jobs-view.tsx`, `pipeline-view.tsx` switched to the shared body/row components, `px-5 → px-4` cell padding tightening, applicants action-row gap `1.5 → 2`, pipeline PendingStartCells action buttons restyled to spec (`flex-row gap-2`, `h-8 rounded-full text-[12px]`, no all-caps). Skipped `placements-tab.tsx` - `50f2c54`'s diff there only re-skinned a KpiTile block from a reverted commit.
- **Batch 2 restoration (`32d4c44`, from `793f33c`)** - ComposeFAB order Email → Call → Text → Note → Event (Reminder queued separately - never landed on the post-revert base). Stage chip per-stage tonal palette replaces the green-brand progression on `pipeline-summary.tsx`. Mail + phone thread row padding `py-3 → py-2.5`. Billing Tower padding `p-5 → p-4`, stat values `26px → 32px`. GoalPacingCard padding `p-5 → p-4`. TrendCard zero-revenue fallback grid. Internal Recruiter Notes card removed from JD tab (`saveJobInternalRecruiterNotes` import + `initialInternalNotes` prop both gone).
- **Sub-revert (`1e3054a`)** - dropped the colorful A-Z client avatar palette from batch 2. Client grid cards restored to `<ClientLogo>` favicon-or-initials chain; everything else from `32d4c44` stayed intact.
- **Batch 3 restoration (`e4af7b2`, from `b194adc`)** - `placement-flows.tsx` gained `finally { router.refresh() }` after the optimistic submit IIFE so pipeline / applicants / jobs reconcile without a manual reload. `bulk-dialogs.tsx` swapped byte-for-byte to the `b194adc` version (1,130 lines, +461 / -299) - rebuilt modal layout with FROM row. `candidates/page.tsx` (outer split view) - wrapper gets `bg-court-surface-subtle`, filter aside drops its own `bg-court-surface`, iframe section becomes a contained card with soft long-shadow.
- **Final fix-up (`bebbe50`)** - candidate split view column widths set to spec: outer left list `w-64 flex-shrink-0` (drop `listWidth` state, drag handlers, resizer, `pointerEvents` override, unused `useCallback`). Embed-mode right aside `w-72 flex-shrink-0` with `<ResumeMatchesRail>` between CompactOverview and EditableSkills - highlighting now stacks below candidate info instead of beside the resume. `editable-resume.tsx` stripped of the inline highlighting aside, helpers, and the `[height:calc(100vh-200px)]` max-height cap on PdfCanvasViewer / DocxPreview so the resume iframe fills its container. New `resume-matches-rail.tsx` houses the moved highlighting panel. Scoreboard KPI tiles each gained a lucide icon in the canonical `bg-court-brand-tint` chip top-left: Pipeline Value=TrendingUp, Avg Fee Size=DollarSign, Placements=Users, Win Rate=Target, Avg Days to Fill=Clock. Scoreboard now reads as one family with the Clubhouse / Finances `KpiTile`.

30 outstanding items queued in the new Active Build Sequence at the top of this roadmap. Next session opens with shared `PageWrapper` + `SectionCard` primitives before any per-page visual work.

---

## Completed - Ace 51.0 Vercel Blob + bulk email + Gmail push + Teams + Triggers + Find Matches keywords + mobile polish (May 17, 2026)

Closes the Vercel Blob migration, template send-as-draft, and Gmail push items from the Ace 50 active sequence. Bulk email to candidates lands end-to-end on the search surface and Matches tab (Lists extension queued for Ace 52 verification pass). Microsoft Teams + meeting-type selector ship alongside Triggers UI + searchKeywords-driven Find Matches scoring.

- **Vercel Blob migration** — `CandidateResume.blobUrl` + `redactedBlobUrl` columns, upload + brand + generate paths upload to Blob, delete cleans up Blob first. New `getResumeBytes` helper resolves blobUrl-first with Postgres-bytes fallback; private Blob reads use `get(url, { access: "private" })`. Backfill script migrates existing rows and nulls inline data columns.
- **Bulk email to candidates** — new `BulkEmailDialog` wraps EmailComposer with hidden recipient inputs, > 25 confirm gate, recipients-panel toggle, AI prompt panel + Generate / Edit with Claude, job picker for templates with job-context tokens. Wired into `/candidates` search surface and `/jobs/[id]?tab=matches`. Template picker rebuilt to match individual composer style (`384b60c`): imperative `applyDraftRef` replaced with declarative `externalDraft` prop; anchored Use Template popover with in-popover job picker; `applyTemplateDraft` pre-resolves `[Job Title]` / `[Client Company Name]` via `applyMergeFields`. Pending Andrew's browser verification.
- **Gmail push notifications** — `/api/webhooks/gmail` Pub/Sub receiver decodes the envelope, runs a history-id delta against `Account.gmailHistoryId`, fires `sendPushToUser` per new thread. `users.watch` registration + auto-renew cron at `/api/cron/gmail-watch-renew`. Settings ▸ Notifications toggle. Service worker posts `GMAIL_PUSH` to visible clients so mail context bumps the unread query immediately instead of waiting on the 30s poll.
- **Microsoft Teams OAuth + meeting type selector** — `MicrosoftToken` Prisma model (org-scoped, access + refresh + expires + scope). `/api/auth/microsoft/start` + `/callback` run the Graph consent flow. Teams connector card in Settings. Interview scheduler `meetingType` field defaults to Google Meet; Teams branch hits `POST /me/onlineMeetings` and embeds the join link the same way as Meet. Eliminates the Meet anonymous-access workaround for MS-shop clients.
- **Triggers UI** — `TriggerRule` model (per-org, per-trigger). Settings ▸ Triggers renders the available triggers with enable/disable, template selector, and approve-before-send checkbox per rule.
- **Template send-as-draft** — `sendAsDraft` rule flag routes template sends to `createGmailDraft` instead of `sendGmail` when on. Andrew can stage a template, draft it for review, then send manually.
- **Find Matches keyword scoring** — new `Job.searchKeywords String[]` column, editable on the JD tab as a tag-input. Find Matches scoring weights candidates whose resume / experience text overlaps these keywords. Same field seeds the Boolean search default for that job. Replaces the implicit "description text drives matching" signal with an explicit recruiter knob. Candidate search route ranks by explicit-keyword overlap when searching from a job context.
- **Internal notes on Job Description tab** — free-text Internal Recruiter Notes block on the JD tab (org-private; never exposed to candidates or the public board). Save-on-blur, same pattern as Overview Notes.
- **Candidate search row polish + PDF keyword highlighting + resume snippets** — row vertical padding bumped, name heavier, snippet line at body weight. Resume PDF viewer overlays `<mark>`-style highlights via pdfjs text layer (word-boundary match, reduced opacity, multiply blend mode). Falls back to extractedText snippet panel for scanned-image PDFs. Snippets panel renders beside the PDF, multi-color per keyword.
- **Settings nav mobile pill strip** — closes Ace 50 known issue. All 11 Settings categories render as a horizontal scrollable pill strip below `lg`, matching the `MobileBucketTabs` pattern from `/phone`. BD tab also added to the mobile PWA BottomNav; Boolean search input clipping fixed on `/candidates` mobile filter sheet.

## Completed - Ace 49.0 PWA infrastructure + web push + mobile UX pass + composer Claude fixes (May 15, 2026)

Closes the PWA item from the Ace 48 active sequence. Ace now installs as a real PWA with the actual Ace logo on the home screen, a service-worker offline shell, and web push notifications wired to every existing in-app toast trigger (mail / Quo SMS / Quo call / calendar reminder) so the recruiter doesn't need both phones open.

- **PWA manifest + install prompt + service worker.** `public/manifest.json` (Ace by BreakPoint, brand-green theme, portrait-primary, standalone), `metadata.manifest` + `metadata.appleWebApp` + `viewport.themeColor` wired via Next 14 Metadata API in `src/app/layout.tsx`. New `<PwaInstallPrompt />` listens for `beforeinstallprompt`, gated mobile + non-standalone, dismissible bottom-of-screen banner. `public/sw.js` (cache `ace-shell-v1`): precache `["/", "/offline"]` on install, cache-first for `/_next/static/` + `/icons/`, network-first for `/api/`, network-first with `/offline` fallback for navigation, purge-stale + `clients.claim` on activate. New `src/app/offline/page.tsx`. `<SwRegister />` mounted in layout — silently re-syncs existing pushManager subscription when permission's already granted; never auto-prompts. Manifest URL bumped to `?v=3` and icon paths to `?v=2` to bust any cache that might be holding the placeholder green "A".
- **Real Ace icons.** Line-art tennis swoosh + ball-end dot from `public/ace-mark.svg` recolored white on the brand-green canvas, scaled to ~70% of canvas inside the 80% maskable safe zone. Generated by a one-off Node script (sharp installed `--no-save`, neither `package.json` nor the lockfile touched, script removed after run). Outputs at `public/icons/icon-{192,512}.png`.
- **Web push end-to-end.** New `PushSubscription` Prisma model (cuid, indexed userId + organizationId, unique endpoint, p256dh + auth, optional userAgent, createdAt) with User + Organization back-relations, synced via `prisma db push`. New API routes: `/api/push/subscribe` (upsert by endpoint, tenant-scoped), `/api/push/unsubscribe` (delete scoped to caller userId), `/api/push/fire` (client-fired relay used by mail + reminder triggers). `src/lib/web-push.ts` exports `sendPushToUser(userId, orgId, payload)` and `sendPushToOrg(orgId, payload)` — VAPID lazy-configured (missing env collapses to no-op), 410/404 auto-purges dead subscriptions, never throws to the caller.
- **Push wired alongside every existing in-app toast.** Quo SMS + inbound call branches in the webhook fire push (per-user via `Candidate.createdById` when a candidate matches the inbound number, fan-out via `sendPushToOrg` for shared-line / unknown numbers). Mail context POSTs to `/api/push/fire` after `renderNewMailToast`. Reminder toast provider POSTs to `/api/push/fire` after `fire(r)`. Each payload carries a stable `tag` (`sms-<candidateId|digits>`, `call-<callLogId>`, `mail-<threadId>`, `reminder-<reminderId>`) so subsequent pushes in the same thread replace rather than stack.
- **Enable / Disable toggle in Settings → Notifications.** `PushPermissionButton` distinguishes browser permission from server-side subscription presence. Granted + active subscription → green Check pill "Enabled on this device" + Disable button (server-first unsubscribe). Errored state shows "Couldn't enable notifications" + Try-again + "Check browser notification settings if this persists." hint and wins over the granted branch so a `/api/push/subscribe` non-2xx can't leave the UI claiming success. Section moved to be the first block inside the Notification Preferences collapsible.
- **Double-fire suppression in the SW.** Push handler calls `self.clients.matchAll({ type: "window", includeUncontrolled: true })` and short-circuits when any same-origin window is `visibilityState === "visible"` — recruiter looking at Ace gets only the in-app toast. `notificationclick` focuses + navigates an existing tab if one's open, otherwise opens a fresh window at the payload's deep-link.
- **VAPID base64url decode fix.** `urlBase64ToUint8Array` was already correct; defensive `.trim().replace(/^"|"$/g, "")` added at the call site so Vercel paste artifacts (trailing newline / wrapping quotes) can't surface as `atob` `InvalidCharacterError`.
- **Safari iOS push gesture fix.** `pushManager.subscribe()` was behind two `await`s in the click handler; iOS Safari rejected with NotAllowedError because the user-gesture flag was gone by the time subscribe ran. Restructure: cache `ServiceWorkerRegistration` in a `useRef` on mount, drop async/await in `enable()`, call `subscribe()` synchronously in the click frame (it handles the permission prompt internally), chain the rest via `.then()`.
- **Mobile UX pass.** Topbar collapses below md (icon row + full-width search line via `order-last w-full` — single TopBarSearch instance). Weather + date pill visible on mobile (temp text gated `min-[360px]:inline`), YouTube + Spotify hidden. Dashboard KPI grid 1-col on mobile (`my-dashboard.tsx` + `scoreboard.tsx`). Candidates split-view tap-to-expand (list + resizer `hidden md:flex` when a candidate is selected; iframe profile fills viewport). Mobile filter sheet on `/candidates` (Filters button with active-category count badge, full-screen sheet via `md:contents` wrapper with sticky Reset/Apply footer). Phone gets a horizontal `MobileBucketTabs` row for all 9 buckets, left sidebar hidden below lg, list/detail toggle on mobile, green FAB at bottom-right opens the dial pad (now full-screen on mobile). Mail composer renders as a full-screen sheet on mobile via `md:contents` wrapper (single instance, no duplicate editors). Settings nav was `hidden lg:block` — dropped so mobile users landing on `/settings` (redirects to `/settings/appearance`) can actually reach other categories.
- **Generate / Edit with Claude — multi-block response parsing.** `/api/mail/ai-compose` and `/api/email/edit-with-claude` were both reading `response.content[0]` and 502'ing "Claude returned no content" whenever Claude used the `web_search` tool (the first block in that case is `server_tool_use`, not `text`). Both now `.filter((b) => b.type === "text").map(b => b.text).join("\n\n")`. Empty-content branch logs `stop_reason` + block types and returns stop-reason-aware copy. Catch block logs full SDK errors. Explicit `ANTHROPIC_API_KEY` env-presence check added so misconfigured Vercel surfaces useful copy instead of a generic 401.
- **Generate with Claude — chevron flipped.** Trailing chevron now matches sibling buttons (Use Template / Insert Field / Edit with Claude) on the composer row.
- **SMS thread font.** Pinned `font-sans` on both bubble surfaces (`texting-exchanges.tsx` and `phone-view.tsx`) — iOS Safari can drop the `next/font` CSS variable on first paint, falling back to `system-ui` which reads as a different / mono-ish font.
- **Pending-start row actions trimmed.** Cancel + Reject removed from `pending_start` branch in `pipeline-row-actions.tsx`. Only Edit Placement + Confirm render — cancellation flows through Edit Placement (which already has the reason picker the row-level Cancel never offered).

## Completed - Ace 48.0 BD approval cards + settings polish + Quiet tab + Client Quo + JSearch fallback (May 15, 2026)

Closes the BD-approval-card + BD-settings cleanup items from the Ace 47 active sequence and lands the Client Quo tagging + Quiet Clients tab + JSearch fallback work scoped during the session.

- **BD approval cards** — prior outreach count per company surfaces on each `/bd/launch` approval row so recycled targets are obvious before approve. Fresh contact suggestions render inline with remove/swap affordances so Andrew can drop a Partner already hit and swap in someone untouched without leaving the queue.
- **BD settings polish** — Sending Domains reputation bar replaced with real Apollo mailbox data (`/v1/email_accounts` lookup). Verticals & Saved Searches `SavedSearchCriteria` simplified from 7 fields to 2 (apolloSequenceId + locationOverride). Contact Targeting now editable via new `BdContactTargeting` table (3 tiers + max per firm) with the hardcoded defaults as fallback. Contact-Targeting tag-input click-to-delete bug fixed (whitespace clicks no longer drop tags; only the X removes). Open in Apollo URL fix. Test Connection button removed from Apollo Integration (ByteString-on-smart-dash error was confusing). Apollo contact priority rewrite (Primary / Small-firm fallback / Practice-specific tiers with title-keyword exclusion).
- **Reply routing — Prompt to create client on positive reply.** Auto-create candidate toggle replaced. New `BdOrgConfig.replyPromptCreateClient` (default ON) drives an inline banner on mail threads carrying the "BD" Gmail label. Yes creates a Client with Apollo enrichment (company name + extra contacts) + stamps GmailThreadTag.clientId. Skip records a `BdReplyPromptDismissal` row so the prompt only shows once per thread. `MailThreadDetail.labelIds` propagates so the client detects BD without an extra Gmail call.
- **Client Signal CLIENT_MONITOR scan + JSearch fallback** — `syncClientSignals` runs alongside the discovery cron and queries TheirStack for every Client domain, surfacing existing-client postings before competitors do. New `src/lib/bd/jsearch-provider.ts` queries JSearch via RapidAPI when TheirStack misses a client domain; filters returned rows to ones whose `employer_website` / `job_apply_link` host matches. Upserts under the same `CLIENT_MONITOR` source so the UI badge stays unified. `JSEARCH_API_KEY` env added to Vercel.
- **Quiet Clients tab on /clients** — third tab between Active and Inactive. Quiet = active client with prior ActivityLog history whose most-recent entry is past 21 days. Brand-new clients with zero ActivityLog rows are excluded (no history = no signal that the client has gone quiet). Sub-tier chips: 14–30 / 30–60 / 60+ days quiet. Server reads cover both Client cuid and stringified legacyRfId targetId conventions.
- **Client logo on profile page header** — profile now uses the domain-based ClientLogo variant (Google favicons + initials fallback) instead of the Clearbit-only variant that depended on `logoUrl` being backfilled. Older clients without a stored logoUrl now show a real logo.
- **Saved search renamed in DB** — "Public Accounting - Tax Partners - Ohio" → "Public Accounting - Nationwide" via `scripts/rename-public-accounting-savedsearch.ts` (1 row updated).
- **Client Quo call + SMS tagging** — Quo webhook stamps `CallLog.clientId` / `SmsMessage.clientId` at write-time by matching toNumber/fromNumber against `Contact.phoneNumbers` (new `src/lib/quo-contact-match.ts`). `/api/sms` GET supports `?clientId=` mirroring `/api/calls`. `<TextingExchanges>` accepts a discriminated `candidateId | clientId` prop. Client profile Activity tab gains a "Calls & SMS" section with both CallLogs and TextingExchanges scoped to clientId. One-shot `scripts/backfill-quo-clientid.ts` stamped 2 historical CallLog rows + 1 SmsMessage row from the existing 7-number Contact phone index.
- **Green preview bar compact fix** — `/bd/launch` inline preview chip sizes to content (inline-flex / w-fit) instead of stretching the section width.
- **Vercel CLI bumped** 51.5.0 → 54.0.0.

## Completed - Ace 47.0 BD Engine Phase 4 + Phase 5 + Client Signal + Clearbit logos + BD header polish (May 14, 2026)

Closes BD Engine Phase 4 and Phase 5 from the active sequence. BD now has a real end-to-end outbound surface: TheirStack discovers, Andrew approves, Apollo enrolls, webhooks report back.

- **BD Engine Phase 4** — `JobDiscoveryProvider` interface + `TheirStackProvider` implementation, `/api/cron/bd-discovery` route on 6 AM ET (`vercel.json` 10:00 UTC) with `CRON_SECRET` Bearer auth, four-filter pipeline (Big4/staffing exclusion → 30-day fingerprint dedup → headcount 10–300 → existing-client exclusion), `BDRun { status: AWAITING_APPROVAL }` rows for surviving discoveries, `/bd/launch` approval queue with Approve & Enroll + Archive actions, "Run Discovery Now" button on `/settings/bd` that hits the cron route on demand, Apollo people search + sequence enrollment via `/v1/mixed_people/search` + `/v1/emailer_campaigns/{id}/add_contact_ids` capped at 75 contacts/day, Claude-generated candidate-side summary on each enrolled BDRun, `/api/webhooks/theirstack` HMAC-SHA256 verification using `crypto.timingSafeEqual`.
- **BD Engine Phase 5** — `BdOrgConfig.engineActive` toggle so the BD engine can be paused without unscheduling the cron, Client Signal dismiss / acted-on flows wired through `markSignalActed` + `markSignalDismissed` server actions, Apollo sequence id stored on `BdOrgConfig.apolloSequenceId` for per-org mapping.
- **Client Signal wired to real TheirStack data** — `ClientSignal` model restructured (`companyName`, optional `clientId`, `jobPostingUrl`, `jobLocation`, `postedAt`, `discoveredAt`, composite unique on org+companyName+jobTitle). Discovery cron upserts a ClientSignal row whenever a TheirStack hit fuzzy-matches an existing client (previously dropped). `/bd/client-signal` queries real rows with All / New this week / Acted on / Dismissed tabs and working Reach out / Dismiss buttons.
- **Client logo auto-pull** — `Client.logoUrl` derived from domain at create time via `https://logo.clearbit.com/{domain}`. New `<ClientLogo>` client component renders the image with an initials-chip fallback. `<PageHeader>` got an optional `leading` slot — client profile shows the logo at 40px, Client Signal cards at 32px.
- **BD header subtitles removed** — Active Campaigns, Activity, and Client Signal all lose their description paragraphs. Eyebrows + headings stay; top spacing matches Clubhouse / Finances.
- **Seeded data removal** — one-shot `cleanup-bd-visual-data.ts` ran against Neon to remove the 3 ClientSignal, 8 BDActivity, 1 Campaign, and 72 CampaignEvent rows seeded during BD 3.x. `seed-bd-visual-data.ts` deleted. Activity / Client Signals / Active Campaigns all read clean empty-state UI until real traffic arrives.
- **CLAUDE_MODEL normalization** — every BD-engine Claude call routes through the shared constant in `src/lib/claude.ts` instead of hardcoded model strings.

## Completed - Ace 44.0 Calendar Prompts 1-6 + Financial Performance tab + Dashboard layout overhaul + Analytics fixes + polish (May 13, 2026)

- **Calendar Prompts 1-6** — full Google Calendar sync covering every readable calendar including shared (Austin BreakPoint + Austin Orca surface automatically), shared `getFreshAccessToken` helper reusing the Gmail Account row, `CalendarEvent` + `AceReminder` Neon models, `meetLink` + `htmlLink` columns capturing `hangoutLink` / `conferenceData.entryPoints`, dedupe across owners via `(organizationId, googleEventId, calendarId)` unique with `ownerKeys: string[]`, single-source-of-truth `src/lib/calendar/owner-key.ts` helper for both event ownerKeys and team-toggle ids ("au" → Austin every time), Austin toggle fix (188 events hide cleanly when the rail Austin checkbox is unchecked), counts removed from My Calendar / Team buttons. Native event drawer with editable title / date / starts / ends / location / notes / guests; `updateCalendarEventAction` + `deleteCalendarEventAction` push to Google then mirror to Neon via `updateMany`/`deleteMany` keyed on `googleEventId`; three save modes (notify all / notify new only / **Save just me** with `sendUpdates=none`); slot click pre-fills date + start/end time; Ace reminder toggle defaults ON; "Open in Google Calendar" header bridge via `htmlLink`. Guest typeahead via `/api/calendar/people-search` (team users + candidates + contacts, scored exact-email > prefix > contains). Calendar toggle state (hidden members + view mode + scope) persists in localStorage. Month + day view polish (density, event chip clamping, all-day banding, today emphasis, multi-owner avatar stack on day view). New Clubhouse "This Week" widget on the dashboard surfaces today's + this week's events alongside the rest of the briefing. Calendar icon date widget on the dashboard header.
- **Site-wide reminder toast** — `ReminderToastProvider` mounted in the root layout polls `/api/reminders/due` every 60s and fires an amber-tinted toast (matching the mail/text toast chrome with Tailwind amber accents) on every page, not just `/calendar`.
- **Analytics bar fixes** — proportional scaling on Deal Funnel and Offer-to-Start (bar widths scale against the row max, not the global max). Stage counts render inside the boxes. Offer to Start rows restyled to match the Deal Funnel row pattern so the two surfaces read as one family.
- **Financial Performance tab** — new Clubhouse tab at `/dashboard?tab=financials`. Schema: `ToolExpense` (org-scoped recurring tool spend), `Placement.candidateSource`, `Client.leadSource`. KPI strip: Total Revenue YTD / Gross Margin / Net Margin / Total Expenses YTD / Blended ROI. Revenue section: By Client / By Source / Trend (quarterly close-out vs $125k quarterly goal with linear pacing forecast). Expenses section: Subscriptions & tools split into Recurring subscriptions and One-time charges with a `Show X more` ghost toggle, plus ROI per tool. Profitability section: Margins (Gross / Contribution / Net with placeholder drags), Goal pacing (quarterly + annual with ET-explicit day counters), Budget vs. actual.
- **Mercury connector** — Mercury added to Settings > Connectors with Bearer-token API key storage on `Organization.mercuryApiKey`. New `getMercuryTransactions(apiKey)` server-side helper in `src/lib/mercury.ts` (Bearer auth, `limit=500`, 5-min cache). 16-tool keyword matcher in `src/lib/mercury-matcher.ts` (Apollo, Pin, Anthropic-Claude, Ringover, Vercel, OpenAI-ChatGPT, Slack, QuickBooks, GoDaddy, Amazon, Apple, Krispcall, Mercury subscription, Recruiterflow, Zoho, OpenPhone-Quo). `shouldIgnoreTransaction` filters owner pay-outs (AEJ VENTURES, BRANZINO), Mercury IO Cashback, `IO AUTOPAY`, and `ACCTVERIFY` micro-deposits.
- **Dashboard layout overhaul** — Clubhouse rebuilt as a Billing Tower + Today's Briefing split sitting side by side at equal column heights, with the new This Week calendar widget mounted below. Briefing card carries a 2×2 companion mini-grid (Word / Quote / Chess / On This Day). Financial strip compressed. New `SectionHero` component standardizes section eyebrow + title + description across every dashboard tab. Typography system tightened.
- **Placements tab tightening** — Revenue by City merged into the map card. Map zoom level persists in localStorage. Layout reorganized; sections renamed for clarity.
- **Scoreboard condensed** — every Scoreboard card 20-25% more compact (KPI tile padding, panel inner spacing, histogram chrome).
- **Invoices KPI tiles** — Invoices page KPI strip aligned to the dashboard `KpiTile` sizing.
- **Public Jobs Board spec** — captured in Active Build Sequence as item 3 with full safe-fields list and Phase 2 application-routing note.
- **Ace Assistant file attachments** — composer accepts attached files; stranded-drag bug fixed.
- **Placements graph Court Mode tokens** — hardcoded colors swept off the placements graph; every fill/stroke routes through `court-*` tokens.
- **Invoicing copy** — Mercury sync copy replaced with manual payment tracking across the invoicing surface ("Mercury sync" → "Manual payment tracking", "One click, attaches PDF + pay-link" → "One click, attaches invoice PDF", "Mercury webhook · auto" → "Manual paid check").

## Completed - Ace 43.0 Placements tab + Calendar shell + Pipeline placement edit drawer + cross-tab card density (May 12, 2026)

- **Invoicing follow-through** — Placement→Invoice FK actually used: pipeline + placements dashboards read invoice status off the join (PAID/SENT/DRAFT/no-invoice), Clubhouse "Cash Collected" tile wired to the paid-invoice signal (not seed). Invoice detail surface picked up PDF action + mail composer pre-fill + OPS sidebar entry. Miles Atchison placement linked end-to-end: Network + Collected + base salary $62,400 + Pittsburgh, PA on the map.
- **Placements dashboard tab** (`/dashboard?tab=placements`) — YTD / This-Quarter / Last-90-days ledger + breakdowns + map. Map upgraded from SVG silhouette to a real Leaflet layer with OpenStreetMap tiles. CITY_COORDS added Pittsburgh + 4-decimal precision on the Ohio cluster (Cleveland, Columbus, Cincinnati, Solon, Beachwood, Independence). Unknown cities skip instead of falling back to the US centroid. Lookup also aliases each "City, ST" under its city-only form so "Pittsburgh" (no state) resolves. Bubble radius clamped 8-20 px. HQ pin / label / centroid-fallback removed. OSM tiles dim `brightness(0.85) contrast(1.1)` in dark Court Modes, scoped to the tile pane only. Ledger leads, breakdowns mid, map at bottom.
- **Interview edit modal** — edit / cancel / reschedule modal with two notify modes (everyone vs newly-added guests only), 15-min increment time picker, hydration fix on the time-string render.
- **Calendar shell** (`/calendar`) — week / day / month views, Mon-Fri only on week, event drawer that opens on click, reminders panel, OPS sidebar entry. Renders against static seed; Google Calendar sync + Neon persistence ship next session.
- **Pipeline placement edit drawer** — clicking a hired-stage row opens a right-side slide-in drawer (same chrome as the calendar event drawer) with candidate / client / job / stage read-only and start date / base salary / fee amount / fee percentage / notes editable. Save calls org-scoped `updatePlacement` server action, revalidates `/pipeline` + candidate page.
- **Pipeline polish** — Hired-stage rows render an invoice status pill (Paid green / Sent blue / Draft amber / No invoice muted). Job column quieted (13px / `font-normal`).
- **Invoices filter tabs** — All/Drafts/Sent/Overdue/Paid/Void filter row replaced with the shared `TabStrip` component so the page reads like the rest of Ace.
- **Cross-tab card density unification** — Scoreboard + Placements + Invoices KPI tiles aligned to the Clubhouse `KpiTile` chrome (borderless, `rounded-2xl px-3 py-2.5`, soft long-shadow, 10px extrabold label, 26px serif value). Scoreboard + Placements outer panels upgraded to the big-panel Clubhouse chrome (`rounded-3xl p-5 0_12px_32px` shadow). Em-dashes dropped from subtitle copy (histogram labels, Billing Tower date hints). Placements outer column gap `gap-7` to match Clubhouse.
- **Sidebar compact** — density tightened across OPS + CRM + INBOX sections so rows sit closer together.

## Completed - Ace 42.0 Invoicing module end-to-end (May 12, 2026)

Branded one-page Invoice PDF, `/invoices` workspace with list + detail + status transitions (DRAFT → SENT → PAID, VOID escape hatch), auto-draft on Confirm Start, `Invoice` model + `InvoiceStatus` enum, workspace-monotonic INV-#### numbering starting at 1051, `/settings/billing` for company identity + ACH/wire/check details. "Sent from Accounts Receivable", AE signs the body, PDF carries the ACH/Wire/Check blocks, no Mercury / pay-link language anywhere. Detail page exposes a "Draft email in Gmail" action that opens a pre-filled mailto with the merged template + PDF URL. Sidebar gains an Invoices entry under CRM. Dashboard "Invoicing" tab wired to live data.

## Completed - Ace 41.0 JD markdown unification + mail composer fixes + new job form redesign + Candidate Recruit template wiring (May 12, 2026)

JD markdown unification (Path B emits markdown, PlainProse deprecated, Copy JD HTML clipboard). Job Description tab cleanup (single card). New job form Source Material card (URL + drag-drop + Parse & Generate JD consolidated, field extraction, hourly detection, location specificity, 529 safe fallback, Indeed/LinkedIn Save Link). Mail Reply All CC fix. Duplicate signature fix. Thread collapse/expand toggle. Reply clarity header. Mail composer HTML paste (h1-h6 to strong preprocessing). Use Template + Insert Field dropdowns open upward. Candidate Recruit template merge fields wired end-to-end with job picker and HTML injection.

## Completed - Ace 40.0 Night Court themes + BD Engine Phases 1-3 + dashboard tabs + workflow polish (May 12, 2026)

Night Court Light + Dark themes, unified TabStrip component, Dashboard / Scoreboard / Invoicing tabs, candidate profile unified layout, Ace Assistant data-reset tools, Deal Funnel cleanup, JD header hierarchy fix, Ethan Larocca placement fee backfill + 5 fee guards, Salary type field (SALARY|HOURLY) wired end-to-end, new-job redirect bug fix, Candidate Recruit template seeded, /jobs Last Edited reads derived lastTouchedAt, BD Engine Phases 1-3 (schema, sidebar nav, /bd layout, Launch flow, Client Signal, Active Campaigns, Activity, /settings/bd with 5 CollapsibleSections, visual seed data), hydration crash hotfix on /bd/client-signal.

## Completed - Ace 39.0 Sourcing Polish + Interview Scheduler v2 + Rejected tab (May 11, 2026)

Closed the candidate Rejected tab follow-up from 38.1 and the interview-scheduler queue item. Reapply landed as a clean-slate DELETE on both code paths.

- **Job Overview single full-width card** with one Edit / Save / Cancel toggle.
- **Matches tab cleanup** — Sort / Columns / Export pills removed (rail drives every cut), sidebar narrowed, bulk action bar trimmed to Apply / Add to List / Reject / Clear.
- **Rejected tab on `/jobs/[id]`** — surfaces every `stage="rejected"` Placement for the job. Reapply on each row.
- **Reapply = clean-slate DELETE** on every surface. RF path: `onUnrejectViaDelete` (stage="disqualified") + `unrejectCandidateJob` (stage="rejected"). Ace-native path: new `reapplyLocalPlacement` server action, org-scoped, deletes the row + writes ActionLog (`reapply_local_placement`) + revalidates by candidateId cuid. `LocalPlacementRows` mirrors jobs into local state and threads `onPlacementRemoved` so the row vanishes without waiting on `router.refresh()`.
- **Bulk reject permanent** — Matches-tab bulk reject now writes to Neon instead of popping from local state.
- **Button color sweep restored** — amber = Apply, light blue = Keep, red = Reject, green = Submit. New `reapply` Button variant uses soft violet (`bg-violet-50/100`, dark `bg-violet-950/40`) so the inverse of Reject reads as a different intent.
- **Dark mode sidebar tokens on `/candidates`** so the rail tracks Court Mode dark variants.
- **Sortable Last Apply + Last Action columns** on `/candidates`, nulls last.
- **Null snippet cleanup** — rows with no snippet match render nothing instead of an empty placeholder.
- **Zip-code geocoding via Nominatim `postalcode`** — 5-digit zip pills resolve to a real bounding box. Falls back to city-name lookup, then to `location ILIKE`.
- **Page headers bumped to 30px**; new-item buttons shrunk so the title carries the weight.
- **Bulk Apply to Job + Add to List** on both `/candidates` and the per-job Matches tab. Per-candidate writes through the existing single-row server actions wrapped in `Promise.all`, single toast summarizing the outcome.
- **Mail bulk move-to dropdown scrollable** for deep label trees.
- **Mail inbox auto-refresh every 30 s** with in-place reconciliation so scroll position survives.
- **Drag-to-label** in the mail sidebar — single thread or current selection drops onto a label to apply/move.
- **Mail attachment display + download** in the thread view — inline images, download chips for everything else.
- **Interview scheduler v2** — timezone selector (defaults to recruiter profile), past date blocking on Schedule (Reschedule still allows past), "Open meeting (anyone can join)" toggle defaulting ON for Video, native Google Calendar invites per party (candidate gets prep tips; client gets candidate details + résumé link; both get Accept / Decline / Maybe), template pre-population for both Candidate + Client composers via `getInterviewSchedulingTemplates()`, Meet settings deep link after a Video schedule, Back button preserving values (Schedule modal stays mounted; in-flight calendar event cancelled on Back).
- **Search term highlighting on the candidate profile** when entered from the rail (`?q=`) — same tokenizer that powers snippet enrichment.
- **Snippet inline with row, no internal divider**; full-width divider only at the row boundary; full-width split-view top divider so name list + profile column read as one chrome bar.

## Completed - Ace 38.1 Candidate Sourcing Surface (May 11, 2026)

Closed prior items 1 (Postgres search indexes) and 2 (Candidate Sourcing Surface) from the active sequence. The `/candidates` rail and the per-job Matches tab now share the same faceted filter surface.

- **Postgres search indexes**: `Candidate(firstName)`, `Candidate(lastName)`, `Candidate(email)` plus `Contact(name)` and the `Contact.emails[]` substring lookup. Bulk imports + the mail typeahead routes + the new rail no longer sequential-scan.
- **Filter rail** shared by `/candidates` and `/jobs/[id]?tab=matches`: keyword/Boolean, Skills, Job titles, Min/Max comp, Locations (multi-pill), Distance (10/25/50/100 mi, clamped 500), Employer (multi-pill), Employer scope (Current only / Current + Past), Tenure (`lt1` / `1to3` / `3to5` / `gt5`), Work auth (accepted, no-op until schema gains a column), Last apply, Last action.
- **Tag pills with include/exclude** on Job Titles, Skills, Employer. Per-pill `{ value, exclude }`; UI flips a green Check on court-accent-tint to a red Minus on red-tint. Server emits `field=…` / `excludeField=…` separately; route AND-composes includes and AND-NOTs excludes uniformly.
- **Geocoded radius search**: pills geocode through Nominatim (in-process cache, 5s timeout, custom UA), distance dropdown drives a bounding-box union via `lat`/`lng` columns; un-geocodable pills fall back to `location ILIKE` contains-match.
- **Keyword search spans resume + experience/education + structured columns**: per-token UNION across structured (`firstName/lastName/currentDesignation/currentOrganization/location/skills`), `experience::text` + `education::text` casts (raw SQL — Prisma can't ILIKE jsonb), and `CandidateResume.extractedText`. Tokens AND together at the candidate level. `and` / `or` are tokenizer-dropped stopwords. LIKE-escape on `%`, `_`, `\` so a recruiter pasting "100%" doesn't trigger a wildcard.
- **Resume snippet enrichment**: one batched lookup per page returns a 200-char window where every token co-occurs, with experience-JSON fallback when no resume matches. `<mark>` highlights mirror the same tokenizer.
- **Split-view profile**: clicking a row collapses the rail and opens the candidate profile in an iframe with prev/next stepper + Close X. Same pattern on the job Matches tab.
- **Job Matches tab Apply / Keep / Reject**: split-view chrome on `/jobs/[id]?tab=matches` posts to `/api/placements` (APPLIED via the existing `applyLocalCandidateToJob` action; REJECTED upserts a `stage="rejected"` Placement with `syncedToRf: false` and `source: "recruiter_rejected"`). Keep toggles `Candidate.tags`. Rejected candidates are NOT-filtered out of subsequent rail searches scoped to that job (`NOT: { placements: { some: { jobId, stage: "rejected" } } }`). Dedicated Rejected tab UI queued for next session.
- **Save search**: `/candidates` parks up to 5 snapshots in localStorage (`ace.saved-searches`), generateSearchLabel builds a "Tax Manager · Cleveland · Frito Lay" label; saved-search pills replace the empty state once any save exists. Job Matches tab persists one snapshot per job to `Job.savedSearchFilters` via tenant-scoped `saveJobSearchFilters`. Both loaders coerce legacy snapshot shapes (`skills: string[]`, `jobTitles: string[]`, `employer: "X"`) into the new `Pill[]` shape. Run Search button retired everywhere — the debounced useEffect handles every fetch.
- **Employer scope toggle**: Current branch uses Prisma `currentOrganization` contains-insensitive. Any branch routes through `resolveEmployerAnyIds`, which ORs ILIKE patterns across `currentOrganization` and `experience::text` via `Prisma.join(orParts, " OR ")` (separator must be a plain string, not Sql) and plugs the ID set into the where via `id: { in/notIn: … }`.
- **Bulk action bar**: row checkboxes + indeterminate-aware select-all, "Remove from results" pops selected rows from local state (no DB write — recruiter view-state shortcut).
- **Sidebar pinned to viewport**: rail uses `h-[calc(100vh-72px)]` + sticky Save search / Saved Lists footer so the Save block stays visible regardless of result-list length.

## Completed - Ace 38.0 Spotify/YouTube/Mail polish + CSV import tightening (May 9, 2026)

Polish day. Nine commits across four surfaces. No core schema changes.

- **Spotify shuffle**: PUT /api/spotify/shuffle proxies to /v1/me/player/shuffle. Panel reads shuffle_state from the Web Playback SDK player_state_changed event. Shuffle toggle in NowPlayingBar (right of Next, green when active). Playlist Play and individual playlist track click push the toggle's state to Spotify before /play so order matches the toggle. Track click sends offset + position_ms: 0.
- **Spotify drag/resize lifecycle**: ported the YouTube panel's robust pattern. endSessionRef holds the live gesture; cancelActiveSession ends drag before starting resize and vice versa. Pointer capture plus window/document safety net (pointerup, mouseup, blur, visibilitychange, lostpointercapture). Body, BottomNav, NowPlayingBar each get pointer-events: none for the gesture so controls can't eat pointerup. Resize commit re-clamps position so the panel never lands half off-screen.
- **Spotify recency-derived playlists + artists**: /api/spotify/recently-played returns recentPlaylistIds (deduped, recency-ordered, max 10) and recentArtists (hydrated via one batched /v1/artists call, max 10). New /api/spotify/playlists-meta?ids=... fetches metadata for up to 10 playlist IDs the recruiter doesn't follow. Home shows a compact "Recently played playlists" 2-col grid above the existing tracks row. Library Playlists tab pulls recents (matched against the user's library) to the top while keeping every other playlist visible. Library Artists tab puts recent artists first (including non-followed) followed by the existing followed list, deduped.
- **YouTube search modes**: Top / Recent / Popular pills under the search input. Default Top maps to relevance, Recent to order=date, Popular to order=viewCount. Long mode added then removed per Andrew. Pills auto-rerun the active surface immediately on click — channel browse if you're inside a channel, otherwise the last searched query. /api/youtube/search channelId branch now respects mode (was hard-coded to order=date). Channel-view load-more pins the mode that produced the page so pagination doesn't drift.
- **YouTube duration badges**: after search.list returns, a single batched videos.list call hydrates each video with contentDetails.duration. ISO 8601 parsed and formatted as 8:42 / 1:12:04. Black badge anchored bottom-right of the thumbnail (YouTube convention). Hidden when null (live streams, hydration failure). Channel-view videos get the same badge for free since they share VideoRow. Minimized dock shows the duration of the playing video next to the title when available.
- **Mail composer To-field typeahead**: three sources merged in parallel — Ace Candidates (firstName/lastName/email), Ace Contacts (firstName/lastName/name + emails[] via parameterized $queryRaw since Prisma can't substring-match into String[]), and Gmail Sent recipients. All org-scoped. Up to 8 deduped { name, email } items, priority-sorted (exact email > local-part-prefix or name-prefix > substring-anywhere; Ace sources outrank Gmail history at ties).
- **Mail Gmail Sent recipients**: new src/lib/gmail-recipients.ts. getGmailSentRecipients(userId) pages through up to 500 recent sent message IDs, fetches metadata-only headers in parallel, parses To/Cc/Bcc address lists, dedupes by lowercased email. Cached 30 min in-process per user. Stale-while-revalidate up to 24h. Concurrent refreshes coalesce on a single Promise. No new OAuth scope — gmail.readonly already granted. Earlier per-keystroke live-search approach was scrapped because Gmail's to: operator does prefix-of-token, not substring.
- **AddressRow upgrade**: opt-in serverSearch flag. 200ms debounce, AbortController to drop stale responses, Arrow up/down/Enter/Escape keyboard nav, mouse hover follows the same activeIndex. To row passes serverSearch; CC/BCC unchanged.
- **Candidate CSV import**: skip rules tightened. Experiences drop rows where both title AND company are empty (date-only noise rows out). Educations drop rows where school is empty. linkedin column dropped from experience capture (no reader uses it).
- **Candidate profile WORK HISTORY + EDUCATION sections** render year-only ("Title at Company (2020 – 2024)" / "Degree in Major, School (2024)") via a regex pull on raw startDate/endDate when from_year/to_year aren't pre-extracted. Court Mode tokens preserved.

## Completed - Ace 36.0 Floating media + dashboard daily companions + premium dashboard (May 7, 2026)

- **YouTube floating player** (item 1 from prior sequence): draggable + resizable shell, topbar Music-icon toggle, YouTube Data API v3 search proxied through `/api/youtube/search`, video-first playing state with iframe full-bleed + hover overlay (back / minimize / close), viewport boundary clamping, minimize keeps audio playing because the iframe stays mounted, CSP fix adding youtube.com + youtube-nocookie.com to frame-src, 50 results per search with View More pagination, channel search (`?channelId=` filter, `order=date`) with dedicated channel view + back arrow.
- **Spotify floating panel**: full Spotify-mobile-style UI on top of the Web Playback SDK, OAuth login via `/api/auth/spotify` with httpOnly token + refresh cookies, transparent token refresh through `spotifyApiProxy`, 3-tab BottomNav (Home / Search / My Library), Recently Played row on Home, Library tab with filter pills (All / Playlists / Albums / Artists / Podcasts) backed by `/api/spotify/playlists` + `/api/spotify/saved-albums` + `/api/spotify/followed-artists`, PlaylistView and AlbumView via shared detail route, ArtistView with top tracks + discography, full-panel NowPlayingView with album art that scales via `flex-1 + object-contain`, minimize keeps audio, X closes and pauses via `/api/spotify/pause` + SDK disconnect. Spotify dark palette intentionally hardcoded (#121212 / #181818 / #1DB954 etc) scoped to `src/components/spotify-panel/` only.
- **Word of Day pill** (item 2 from prior sequence): Claude-generated word + definition cached in Neon `WordOfDay`, demand-triggered daily reset, click-to-expand popover.
- **Quote of Day pill**: Claude-generated quote cached in Neon `QuoteOfDay`, click-to-expand popover.
- **Chess puzzle pill**: Lichess `/api/puzzle/next?difficulty=easiest` (~961 average rating), `react-chessboard` render, hint + show-answer flow, rating chip, streak tracker in localStorage, day-stable cache, Back button + click-to-move added late in the session.
- **On This Day pill**: Claude-generated historical event for today's ET date cached in Neon `ThisDay`.
- **Daily Horoscope pill**: Claude-generated via server-side proxy (CORS workaround), cached in Neon `Horoscope`, sign configurable.
- **Dashboard daily-companion pills**: 6 chips (Chess, Word, Quote, On This Day, Horoscope, Today's Briefing scroll anchor) — Word/Quote/Chess/On This Day/Horoscope later moved into the briefing header itself; the standalone bottom-bar component has since been retired.
- **News feed redesign**: Apple-News editorial style with 4px colored left border per tab, pill-style tabs, 4 tabs (Front Page / Public Accounting / Recruiting / AI & Tech — Local News dropped), one lead story + 3 list rows, collapsible header.
- **News feed cron**: 6 AM ET Vercel cron at `/api/cron/news-feed` pre-warms `DailyNewsFeed` rows for every tab, `CRON_SECRET` Bearer auth, `NEWS_API_KEY` (NewsAPI.org) replacing the prior Claude `web_search` round-trip — sub-2s response per tab vs the prior 25s timeout window.
- **Weather widget**: Open-Meteo geolocation (Cleveland fallback), hover popover with current + 6-hour + 7-day forecast, custom day/night WMO icon dispatch.
- **Dashboard premium redesign**: green-tint surface, sage-tinted KPI tile icons, Billing Tower in sentence case with primary Q2 billed-revenue focal + secondary cash-collected card, ambient layered shadows, tabular numbers, Activity Dashboard topbar title in Bricolage Grotesque to match the new Ace wordmark. Dashboard hex exceptions (#F6FAF4 / #EFF5EB / #1F6A3A / #F3F8EF) intentionally hardcoded and scoped to dashboard components.
- **RF string sweep**: final user-facing RecruiterFlow string removed from the UI.

## Completed - Ace 34.0 Jobs page command center (May 7, 2026)

Three-prompt arc closed clean. Last SHA pushed to main 1cc12e0.

- 6-tab job detail shell on /jobs/[id] (Overview, Job Description, Matches, Game Plan, Promote, Activity). Pipeline + Billing tabs removed; chip strip at the top of the page covers stage-aware viewing.
- Overview tab: facts grid, search-health placeholder, public apply link copy/open icons.
- Job Description tab: source URL input + Save URL + Parse Link (Claude page extraction → plain text into the raw textarea), raw JD textarea + Save Raw, Generate with Claude (BreakPoint format spec), generated JD preview card with Copy + Last generated timestamp, Internal Recruiter Notes save-on-blur.
- Matches tab: free-text candidate search across name / title / current employer / skills / location, results table, Apply to Job button hits /api/placements at stage=APPLIED, alreadyApplied guard.
- Promote tab: 6 major boards (LinkedIn, Indeed, ZipRecruiter, Glassdoor, SimplyHired, Monster) with status chip cycle + Account Needed indicator + notes + external URL, Local & Niche Boards add/edit/remove, Suggest Boards with Claude stub, JobBoardStatus schema, lazy seed for legacy jobs.
- Prisma client-side error fixed by splitting @/lib/job-boards into client-safe shared module (job-boards-shared.ts) + server-only helpers. /jobs/[id] route bundle dropped from 34.9 kB → 16.5 kB.
- Activity tab wired to ActivityFeed for entityType="job" (api route now supports job; pulls placements + interviews by both jobId cuid and numeric jobRfId).
- CLAUDE_PILL_CLASS constant + emerald/court-token button sweep across mail composer, email composer, candidate intake, agreements, benefits, candidate submittal, find matches.
- Candidate profile rebuild + action cleanup: Submit / Schedule Interview / Reject ordering, Reject at Applied, candidate-level resume action row, toggleCandidateKept action + KeepCandidateButton.
- Ace Assistant Phase 3: page-aware context, entity name pill, server-side buildCandidateContext / buildClientContext / buildJobContext (cuid-only).
- Phone / mail viewport fix; focus-state polish; mail composer height fix; mail thread collapse + auto-scroll to TOP of latest message; mail header redesign (INBOX eyebrow + large heading removed); stale placeholder sweep.

## Completed - Ace 33.0 Ace Assistant Panel + Settings refactor + Court Mode v5 absorbed (May 6, 2026)

- **Ace Assistant Panel** — Phase 1 (shell + Neon persistence + draggable/resizable floating panel + topbar toggle + clear chat) and Phase 2 (NDJSON streaming via /api/claude-panel/chat with Personal Trainer rules + web_search_20250305 + freshness mandate). Phase 3 page-aware context shipped in 34.0.
- **Game Plan Phase 4 — Personal Trainer**: PersonalTrainerRule schema, 15 seeded default rules, Settings UI (Trainer + Rules sub-tabs), real-time GitHub sync to docs/ace/PERSONAL_TRAINER.md, buildPersonalTrainerBlock injected into all 5 Claude routes.
- **Settings refactor**: left-nav + per-category page layout (Appearance, Notifications, Personal Trainer, Branding, Templates, Triggers, Connectors); Email Preferences tab dropped; Templates split Active/Inactive; Triggers on its own page; Branding server-rendered signature preview; phone unread-badge regression fixed.

## Completed - Ace 32.0 Game Plan Phase 2 + Phase 3 + Court Mode v5 (May 5, 2026)

- **Game Plan Phase 2 — Find Matches**: Claude-powered candidate matching on job + client Game Plan surfaces, streaming NDJSON, 6-band score color system, clickable score badge with per-axis breakdown, one-click Apply, job picker on Client Game Plan, CandidateMatch table in Neon, Matched tab on /jobs/[id], live refresh, exclude-already-pipelined.
- **Game Plan Phase 3 — email context**: getRecentTaggedEmails helper, ai-workspace injects Recent Email Context block, Job Game Plan inherits client email context via clientId, silent degrade on miss.
- Email History UI: TaggedThreadList component, GET /api/candidates/[id]/email-threads, GET /api/clients/[id]/email-threads, both org-scoped and deduped, opens floating viewer.
- Topbar Txt/Call button: opens dial pad directly without navigating to /phone.
- **Court Mode palette v5** absorbed across all 7 modes: full token surface refreshed, sidebar + brand rewired, tinted accent per mode, purple reserved for Grass.

## Completed - Ace 31.0 Find Matches stack + /jobs two-column overhaul (May 5, 2026)

Header items only — full per-item log lives in `docs/ace/ACE_ARCHIVE_COMPLETED.md`.

- Game Plan Phase 2 build that became the foundation for the Matched tab. ScoreBadge extracted to shared component.
- /jobs/[id] two-column overhaul (left col-7 tabs + content; right col-3 EditableJobOverview sidebar with single Edit/Save/Cancel toggle).
- Em dash + emoji bans across all 5 Claude API routes; deterministic post-strip on format-email.
- Sticky composer rules + minimized-drafts tray + reply composer body-first layout.
- /api/placements REJECTED branch added.

## Completed - Ace 30.0 Court Mode palette v5 baseline (May 5, 2026)

Header items only — full per-item log in `docs/ace/ACE_ARCHIVE_COMPLETED.md`.

- Candidate header reorder + Profile/Game Plan tab restyle; mail label nesting tightened.
- Dashboard edit-and-resend invite popup (live Google Calendar pre-fill).
- Square buttons across the app + topbar layout restore + Post New Job repositioned.
- Benefits + Agreements rendered as markdown via shared MarkdownProse.
- Court Mode palette v5 baseline (full hex refresh + new tokens — finalized in 32.0 sweep).
- Smoke test selector fixes (Apply to Job button → Link, Email field collision).

---

## Older completed history
Everything older than Ace 30.0 lives in `docs/ace/ACE_ARCHIVE_COMPLETED.md`. Includes Ace 29.0 / 27.0 / 26.0 / 25.0 / 24.0 / 23.0 / 18.0 with full per-prompt detail. Killed-feature list above already incorporates the bans from those earlier rounds (Stage-Triggered Template Actions, anonymize-attachment checkbox, top tabs on candidate profile, etc.).
