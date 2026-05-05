# ACE_STATE.md
Last updated: 2026-05-05 - Ace 31.0 closed (full session log)

## Current Status
Current Version: Ace 31.0 (complete)
Last Shipped: Ace 31.0 - May 5, 2026
Last SHA: f568e04
Live at: ace.breakpointtalent.com
Current Status: Ace 31.0 closed clean. Game Plan Phase 2 complete end-to-end (Find Matches streaming panel with 6-band scoring + per-axis score popover, dismiss + Reject + one-click Apply, job picker on client targets, per-entity panel scoping, persistent CandidateMatch table with scoreBreakdown, /jobs/[id] Matched tab with live refresh + 5/page pagination, server-side exclusion of already-matched + already-pipelined candidates on re-run). Job Game Plan chat live on /jobs/[id]?tab=game-plan. Floating thread reply composer body-first + 60% of popup + auto-focus. Em dash + emoji banned across all 5 Claude routes. AI chat bubble green tint dropped. Minimized-drafts tray docks right of sidebar. Two-column /jobs/[id] layout (Job Description / Game Plan tabs + 30% Overview sidebar with single-Edit-toggle inline editing + hourly/salary frequency toggle). Reject button matches /applicants styling everywhere. Apply / Reject from Matched persists jobRfId so /applicants + pipeline see the row. "Contingent · Full time" subtitle dropped on /jobs listing. Next active task: Ace 32.0 Jobs page layout overhaul. No carry-overs open.

## Known Issues / Still In Progress (carry into Ace 32.0)
- (none open — Ace 31.0 closed clean)

## Next Task for Ace 32.0
**Jobs page layout overhaul.** Deeper redesign of the /jobs listing surface beyond the salary-range column + condensed Apply-to-Job dropdown shipped in 26.0 / 27.0 and the row-subtitle + hourly/salary cleanup landed in 31.0. Scope to be specified at session open.

Remaining Ace 32.0+ sequence after the Jobs page overhaul:
1. **Game Plan Phase 3** — Feed last 5 tagged emails from candidate / client into the Game Plan prompt as context.
2. **Game Plan Phase 4** — "My Writing Style" setting in /settings, injected into every Claude API call across Ace (submittals, JDs, email generation, Game Plan).
3. **Game Plan Phase 5** — Sidebar Claude panel: persistent chat inside Ace with web search + full Ace data access.
4. **Game Plan context depth** — Send full resume text + full JD text into the ai-workspace prompt so Claude reasons against the actual content, not just metadata.
5. **CSV Import/Export** — bulk candidate / contact ingest path.
6. **Candidates Page UX** — full keyboard nav + prev/next from header search results (partial sweep landed in 27.0).
7. **Settings Fix Generator** — small utility surface inside Settings to repair common data issues without touching the DB.
8. **Daily Industry Briefing + Word of the Day** — Vercel Cron 6 AM EST.
9. **Market Insights Tab** — Tab 6 on client detail.
10. **BD Tab + Prospects Database** + **BD Automation Engine** — `/bd` surface, Prospect table, Indeed + Apollo daily cron, sequence engine via warmed burner domains.
11. **Docs handoff** — Push ACE docs to GitHub at session end (handoff hygiene).

## What Shipped in Ace 31.0 (2026-05-05)
Last SHA: f568e04

### Game Plan Phase 2 — Internal Candidate Matching (complete)
- **Find Matches button + streaming NDJSON panel** — portal-rendered, draggable + resizable, per-entity scoping via FindMatchesContext (panel state survives navigation; opens cached results on return). State hoisted to the providers shell same way the floating thread window is.
- **Streaming Claude scoring** with 6-band tone (95+ / 90+ / 85+ / 80+ / 70+ / <70) so a 92 reads visibly stronger than an 86 even though both are "green." Hardcoded color names — intentional brand signals identical across all six Court modes.
- **Score popover** with per-axis breakdown (Title Match / Location Fit / Experience Fit / Compensation Fit / Overall Summary). Bold uppercase headers. Portal-rendered into document.body so it never clips against the panel's overflow-hidden container; positioning recomputes on scroll/resize. Copy button flattens to plaintext for clipboard.
- **ScoreBadge clickable everywhere** — extracted to `src/components/game-plan/score-badge.tsx`; both the Find Matches panel cards and the /jobs/[id] Matched-tab rows render the same component. `normalizeBreakdown(scoreBreakdown, rationale)` falls back to a synthetic breakdown whose overallSummary echoes the rationale on legacy rows.
- **Dismiss-X removed; one-click Reject in its place** — bottom-of-card Reject button (Button variant="danger" + UserX icon) on both panel ActionRow and pipeline MatchedRowItem. Same styling as `/applicants`.
- **One-click Apply** — POSTs `/api/placements` with stage APPLIED, no modal, no nav. Auto-dismisses the card and bumps the per-job tick so the Matched tab refetches.
- **Job picker on client-context Find Matches** — client targets with 2+ open jobs surface an `awaiting_pick` event and the panel renders a picker; single-open-job clients auto-pick. Picked job re-runs the stream against the chosen role.
- **CandidateMatch persistence** — Prisma model with score + rationale + scoreBreakdown JSON. Stream upserts on every Claude match event; tenant-scoped; unique on (jobId, candidateId) so re-runs upsert instead of duplicating.
- **/jobs/[id] Matched tab** — chip on the compact pipeline strip, expanded panel with View Profile / Apply / Submit / Reject row actions, paginated 5/page (Prev / "Page X of Y" / Next, hidden ≤5 rows, page resets to 1 on tab re-open via component unmount/remount).
- **Live refresh** — FindMatchesContext exposes `notifyMatchesSaved(jobId)` which bumps a per-job tick. Both the page-level Matched count and the tab list refetch from `GET /api/game-plan/matched-candidates?jobId=X` without a server-component reload. Panel calls it after Apply / Reject so the tab updates without leaving the panel host page.
- **Excludes already-matched on re-run** — preflight `fetchExistingMatchIds` seeds excludeIds before the stream kicks for both initial mount and post-pickJob.
- **Server-side exclusion of any pipelined candidate** — find-matches route unions Placement candidate cuids (any stage) into the exclude Set after target resolution, so applying / rejecting a candidate prevents Claude from re-scoring them as a "new" match on the next run regardless of what the client sent.
- **Auto-prune Matched on any Placement** — both the page-level fetch and the matched-candidates API exclude any candidate with a Placement on this job, regardless of stage. So Apply, Submit, Reject — and any future stage move — all converge on the same rule: acted-on candidates leave Matched on the next read.
- **/api/placements REJECTED branch + jobRfId fix** — route accepts stage=REJECTED (upserts a Placement to stage=rejected when none exists, otherwise bumps an existing row); both APPLIED and REJECTED now pass `job.legacyRfId` instead of hardcoded null so the Placement carries both identity keys (RF-imported job pipeline reads scope by jobRfId; /applicants joins job display via the legacy RF lookup — null jobRfId left rows invisible to both surfaces).

### Job Game Plan chat
- **AiWorkspace mounted on /jobs/[id]?tab=game-plan** — same `entityType="job"` workspace candidate profiles already use. FindMatchesButton sits to the right of the JobTabs row regardless of which tab is active.
- **Game Plan card pinned** to the viewport via the existing sticky-top + bounded height + flex-1 internal scroll set used elsewhere.
- **Auto-scroll fix** — chat scrolls to the latest assistant bubble on every new message append.

### Reply composer / floating thread layout
- **Body-first reply layout in the floating thread popup** — composer ABOVE quoted history; recruiter lands in the body field with prior thread one scroll away. Inline /mail composer untouched (still pinned to bottom).
- **Composer body grows to ~60% of popup height** — added `growToFill` prop on MailComposer; FloatingThreadWindow's ThreadDetail passes `growToFill={isFloating}` and the quoted-history pane drops to `basis-2/5 shrink min-h-0`. Editor body autofocus on mount.
- Composer node lifted out of JSX into a single variable so the same instance moves between the two layout slots without unmount/remount churn (autofocus + draft state survive).

### Sticky composer + content-rule sweep
- **Em dash + emoji banned across all 5 Claude routes** — system prompts on `/api/ai-workspace`, `/api/mail/ai-compose`, `/api/email/edit-with-claude`, `/api/calls/summary`, `/api/clients/new` carry the rule. Deterministic post-strip on format-email walks the body and removes em dashes and emoji that slipped through.
- **AI chat bubble green tint dropped** — bubbles render on the neutral surface; only the assistant accent stripe carries brand color.
- **Minimized-drafts tray docks right of the sidebar** — tray slides flush against the resized sidebar instead of overlapping it; survives sidebar resize via the same width-persistence key the AppShell uses.

### /jobs/[id] two-column layout overhaul
- **Page restructured** — dropped the 4 stat boxes (Status / Submitted / Interviewing / Hired) at the top; pipeline summary now lives directly above the main content as a compact chip strip (single wrap-friendly row, smaller paddings, text-base count). Two-column grid mirrors the candidate profile (lg:grid-cols-10): left col-7 hosts JobTabs (Job Description default, Game Plan via `?tab=game-plan`) + content; right col-3 is the new EditableJobOverview sidebar.
- **EditableJobOverview** — single Edit toggle at the card header flips every editable row (Compensation / Location / Openings / Status / Employment Type) into its input simultaneously. One Save commits all changes via a single `updateJobOverview` server-action call. One Cancel discards the entire draft set. Validation runs once on Save, bails on the first failure with a single inline red banner.
- **Compensation hourly/salary toggle** — Salary / Hourly radio at the top of the comp form; persists via `salaryFrequency` on Job (column already in schema). Display suffixes ` / yr` or ` / hr`. Placeholders adapt to the selected frequency.
- **"Contingent · Full time" subtitle dropped on /jobs listing** — every BreakPoint job is contingent so the chip duplicated context that's true everywhere; title alone now identifies the job.

### Score popover restoration after schema sync
- **scoreBreakdown column on CandidateMatch** — additive nullable Json field; `prisma db push` synced live. Page-level fetch + `/api/game-plan/matched-candidates` + find-matches upsert all read/write the column. Legacy rows written before the column existed render the popover with rationale fallback only.



### Candidate / Dashboard / App shell polish
- **Candidate header reorder + bolder tabs** — header layout reshuffled on candidate profiles for better hierarchy; Profile / Game Plan underline tabs bolder for legibility; mail label indent tightened in the same pass.
- **Dashboard edit-and-resend invite popup** — edit invite content inline before resending instead of having to delete + recreate; mail label spacing tightened alongside.
- **Square buttons + topbar layout restore** — buttons squared off across the app, topbar layout restored after recent regressions, Post New Job button repositioned to its correct slot.

### Content rendering
- **Benefits + Agreements rendered as markdown** — both summaries now render with bold / bullets / hyperlinks instead of leaking raw text into the UI.

### Test stability
- **Smoke test fixes** — unbroken the Email field collision (selector was hitting two inputs) + Apply/Submit Link selectors that had drifted with the topbar/buttons restore.

### Court Mode / themes
- **Court Modes palette v5 adopted across all 7 modes** (SHA 7265ba8) — full token surface refreshed, sidebar + brand rewired to the v5 tokens, tinted accent per mode (each Court Mode has its own accent ramp), purple reserved exclusively for Grass. Closes the Generate-with-Claude button visibility regressions on Clay Dark + the broader dark-mode contrast work that was open at end of 29.0.

## What Shipped in Ace 29.0 (2026-04-30)

### Game Plan / AI Workspace
- **Web search across all 5 Claude API call sites** — `web_search_20250305` tool added to `src/app/api/ai-workspace/route.ts`, `src/app/api/mail/ai-compose/route.ts`, `src/app/api/email/edit-with-claude/route.ts`, `src/app/api/calls/summary/route.ts`, `src/app/clients/new/actions.ts`. Replaces the standalone "Game Plan Phase 1 + Phase 3 (web + internal blend)" entries.
- Multi-block response handling fixed in ai-workspace route (web_search returns `[text(preface), server_tool_use, web_search_tool_result, text(answer)]`; route was only reading `content[0]`, so the cited final answer was being discarded).
- `max_tokens` lifted to 4096.
- Markdown formatting instructions added to the system prompt (link form, bold headers, hyphen bullets).
- `react-markdown` + `remark-gfm` installed; chat bubbles render clickable hyperlinks.
- `CopyButton` flattens markdown links to bare URLs for SMS / iMessage paste (so links survive when pasted into a non-markdown surface).
- Model id normalized to `claude-sonnet-4-6` codebase-wide.
- **"Email this" button on every assistant bubble** — pops a non-blocking in-app composer pre-filled with the bubble (links + bullets preserved, no theme baggage in the body).
- **Email this v2** — split Subject + body, drop signature; one ordered list per draft (was producing six `1.` items because blank lines closed/reopened the `<ol>`); **freshness mandate** added to AI Workspace system prompt (every external fact must be verified via web_search THIS turn; never hedge with "data may be old"; OMIT items that can't be verified).
- **Email this v3** — every click runs the bubble through new `/api/ai-workspace/format-email` before opening the composer. Generates Subject line + `Hi <FirstName>,` body + strips recruiter-internal commentary ("Want me to draft outreach?", "Let me know which interests you"). Recruiter no longer has to ask for "a clean version".
- Game Plan card pinned to viewport (`sticky top-4` + bounded height + `flex-1` internal scroll on messages) so the textarea stays visible even with a long pre-existing chat.
- Real chat-send error messages surfaced (was generic "Failed to send - try again"); `maxDuration` on `/api/ai-workspace` bumped 60s → 300s so Sonnet + web_search on long threads stops timing out at the function ceiling.
- **No signoff / no signature** — both candidate + client system prompts now end with "NEVER end a response with a signoff or signature lines (Andrew Kraig / BreakPoint Talent). Andrew's signature is auto-appended by Ace on send." Deterministic post-strip in format-email walks back from the body and chops trailing signoff lines, "Andrew Kraig" / "BreakPoint Talent" lines, and inline "Best, Andrew Kraig BreakPoint Talent" runs — single model slip can't leak through.

### Quo auto-transcription / Phone tab (Ace 29.0)
- `call.transcript.completed` + `call.summary.completed` webhook branches added to `/api/quo/webhook`; patched to the real Quo v3 payload shape — `callId` at `body.object.data.object.callId`, `transcript` is a dialogue array, `summary` is a string array. Dialogue formatted as `M:SS [identifier]: [content]` per line; summary formatted as bullet lines + Next Steps section.
- Diagnostic logger on Quo webhook for transcript-path verification (kept for now while soaking new payloads).
- Inline transcript / summary expand on call log rows + Client profile call log.
- Call log truncates to 3 most recent + "Show all N calls".
- Redundant Generate Summary button removed (Quo handles automatically).
- **Phone tab outbound call routing fixed** — replaced the broken /call API (OpenPhone has no outbound call API) with a Quo deep link via `tel:` so Call buttons open Quo Desktop instead of the Quo web app in a new tab.
- SMS send fix (was not firing in some paths) + call debug logging.
- Wire Quo outbound call from the dialer.
- Phone tab: surface unknown-number activity with an Add to Ace action.
- Quo connector: trust recent webhook activity over `/v1/webhooks` list (list endpoint sometimes lies about active webhooks).

### Resume (Ace 29.0)
- **Generate Resume button** on candidate profiles with no resume on file — pulls profile data, sends to Claude, renders a professional HTML-to-PDF layout via `react-pdf/renderer`, saves as `CandidateResume` row with `displayName: "AI Generated"`.
- Plain-text PDF replaced with the professional HTML-to-PDF resume layout.
- Inline rename for the selected resume version + matching delete buttons (closes the Ace 25.0 click-to-rename regression that was open since the resume toolbar consolidation).

### Mail / composer (Ace 29.0)
- Email body rendered on forced-white card so dark Court Modes stay readable (no more dark-on-dark email bodies on Night / Hard Dark).
- Email body spacing tightened to match Gmail; card softened to cream; TopBar FAB and avatar bumped to 40px.
- Floating thread window — GPU-composited drag + CSS `contain` on resize for smoother behavior on long threads; layout holds at narrow widths.
- Mail thread popup: consolidated chrome, tighter composer, more messages visible at once; body-first layout, tighter header, no nested card.
- Mail thread: "Open client" button when the sender resolves to a CRM Client.
- Non-blocking composer pop-out + new icon; smart Reply All; white email cards.
- Inline composer: sticky footer + `max-h-[55vh]` so Send is always visible.
- Sticky composer footer + carry-over text + save draft + delete (Ace 28.0b set, rolled in).
- Mail compose: keep job-select chevron visible at narrow widths (`min-w-0` on the select).

### Court Mode / themes (Ace 29.0)
- Grass Court Light: surfaces shifted to actual green tints (was reading as off-white).
- Clay Light + Grass Light: white surfaces, accents only — over-tint regression fixed.
- Light-mode tints deepened so Hard, Clay, Grass read distinctly side-by-side in the Settings picker.

### Settings (Ace 29.0)
- **Connectors panel** — Quo, Gmail, Calendar status visible at a glance.
- Mail / Phone banners surface when those connectors aren't actually live.
- Notification sound dropdowns + bold notification-style headers.
- Real Quo webhook check (uses webhook activity, not the wrong `/v1/webhooks` list).
- Settings tab order tweaked; tennis-ball bounce affordance.

### App shell / UI polish (Ace 29.0)
- Sidebar resize-handle vertical seam killed; handle bg matches chrome only in the top `h-24` region.
- Ace logo links back to `/dashboard`.
- AI resume spacing fixed.
- Distinct colors for Keep (teal), Offer (purple), Un-reject (indigo) so the action row reads at a glance.
- Target / Send icons added to "Apply to Job" + "Submit to different job" buttons.

### Clients / Pipeline / Candidates (Ace 29.0)
- Delete-client flow added (mirrors delete-candidate).
- Delete client button: quieter default, more breathing room.
- Client contacts: phone extension field.
- Client Notes tab: inline "Add note" instead of pointing at the topbar `+`.
- Pipeline: "Back to <client>" link when arriving from a client profile.
- LinkedIn URLs: normalize bare slugs into full hrefs on save and render.
- Candidate delete (Ace 28.0a set, rolled in).

## What Shipped in Ace 27.0 (2026-04-28)
- Toast fixes: MessageSquare icon swap, removed redundant "· Text" trailing label, Reply button contrast lifted across themes
- Compose FAB hidden on /settings (Settings has no surface that benefits from the launcher)
- ALL CAPS toast subtitle bug fixed — uppercase rule scoped tighter so it no longer leaks into eyebrow + subtitle slots
- Settings Appearance section laid out as two-column at desktop widths (Court Mode + Notification Preferences side-by-side)
- Mail thread HTML rendering fix — sanitizer preserves email-layout style attrs and table cell attrs (cellpadding / align / valign / width / height / rowspan / colspan); allowedStyles whitelists a layout-only subset; signature avatars + Quo-style avatar+body layouts render correctly. MessageBlock attaches img.onerror handlers to collapse failed remote images so a broken CDN banner stops painting an empty rectangle
- /mail full revamp:
  - Three-pane layout converted to CSS-grid + drag handles between panes; widths persist (ace-mail-column-widths)
  - AppShell sidebar drag-resize + persistence (ace-sidebar-width)
  - Inbox card slimmed to a normal-height nav row (was border-2 / py-4 / h-6 icon)
  - Sidebar label list spacing + font weight bumped (space-y-1, font-medium / semibold on active)
  - Synthetic parent labels (Admin / BD / Candidates) now match real labels' color + weight
  - Sidebar section header "Communications" renamed to "Inbox"
  - Page-header "Compose new email" button on /mail matching primary-action style on /jobs / /candidates / /clients (routes through useComposerManager)
  - Sidebar/content gap tightened across the app (main left padding pl-3 / md:pl-4)
- Multi-message thread dropdown — pick which message in the thread the toolbar's Reply / Reply All / Forward act on. Defaults to latest; selecting an older message routes through that one's recipients + quoted body. Per-message Reply / Reply All / Forward buttons also in each MessageBlock header. Composer state resets on detail.id change (defensive against stale composerMode across thread switches)
- Gmail label creation from Ace — standalone "+ New label" entry in the labels sidebar (create without applying to a thread) AND "New label…" inside the Move To dropdown (create-and-apply). Both sync to Gmail via /api/mail/labels (gmail.modify scope)
- CC + BCC fixes in mail composer: + Contact picker button + dropdown removed (was overlaying the CC + Subject rows and eating clicks); typeahead now folds pickerOptions in so both fields accept typed addresses AND dropdown picks
- /phone full revamp:
  - Empty state replaced with a working dial pad — clickable 0-9 / * / # buttons, keyboard input, US-formatted display, Call + Text dispatch via usePhonePanels with candidateId=null
  - FAB phone search now offers an "ad-hoc number" row when the recruiter types ≥7 digits not matching a saved contact (text/call without first creating a contact)
  - Notes person-search rebuilt: ANDs whitespace-split tokens across firstName / lastName / email / phone (full-name search now works); phone added with digits + raw match. Quick Note placeholder reworded to "Search in Ace"
- TopBar avatar contact-card dropdown — removed standalone name + email block + sign-out button; click avatar opens compact dropdown with email / work number / LinkedIn, each with a copy button (and ext-link on LinkedIn). Click outside or Escape dismisses
- Candidate page UX improvements (full sweep)
- Job page enhancements (additional polish on top of 26.0's salary-range + condensed Apply-to-Job dropdown)
- Client page FAB prefill fix
- Experience section auto-summary on candidate profile
- DOCX resume preview
- Full design system rebuild
- Branding + identity refresh
- Stage tag on templates
- Merged bracket + double-curly merge field styles in legacy and new templates
- City / state comma formatting fix across the app
- Replaced dead Anthropic model id with claude-sonnet-4-6
- **Night Court mode** — fourth Court Mode (charcoal #141414 body / #1C1C1C surface; brand green #7BB85B as accent only). globals.css token block + court-mode.tsx surface union extension + Settings picker rebuilt as card grid with two-tone swatches; accent dot on the Night swatch telegraphs "green here is accent only"
- **Favicon + brand mark revamp** — Serve Arc lockup (black ball + green serve trajectory + green ball at end). public/ace-mark.svg, ace-mark-dark.svg, favicon-16/32/180.png, apple-touch-icon.png, multi-res favicon.ico. BrandMark wordmark moved to Playfair 22px with italic "by BreakPoint Talent" subline that recolors per surface; lifted on grass for legibility against the dark-green sidebar
- Sidebar bottom-left "BreakPoint Talent / Solon, OH · Est. 2026" footer removed
- Dashboard left padding fixed (dropped legacy -mx-2 / md:-mx-4 negative margins so it inherits the same gutter as every other page)

## What Shipped in Ace 26.0 (2026-04-28)
- canonicalStage root cause fix: client card counters for pending_start and cancelled now read from Neon Placement.stage (canonical) instead of leaking through the RF stage_name string. The bucket-driven counts on client detail are correct end-to-end now
- Stage chip label leak fixed: RF-imported candidate JobActionRow no longer renders the RF payload's stage_name in the StageBadge label. Label is derived off Placement.stage; bucket color was already right
- Clickable job counter pills on client detail: each per-stage pill is a Link to /pipeline filtered by client + stage so a single click jumps from "5 Submitted" on a client card to the filtered pipeline list
- Email Threads raw ID section removed from client detail: useless without subject/preview metadata; matches the same removal on candidate profiles in 25.0. TODO comment in place pending auto-tagging surfaces
- Reject button restored on candidate profile job rows: Submitted / Interviewing / Offer / Pending Start stages all have it again. Previously regressed during the compact-row sweep
- Reject button added to /pipeline view rows for Submitted + Interviewing stages — recruiters can reject straight from the pipeline list without bouncing to the candidate profile
- Schedule Interview button on Submitted pipeline rows: same one-click semantics as the candidate profile, fires the existing Schedule modal pre-filled with the row's candidate + job context
- Offer button on Interviewing pipeline rows: opens the Offer modal (existing flow) directly from the pipeline row
- Clients page full redesign: ClientLogo + PipelinePill components, grid-vs-list view toggle, per-client stage counters, sort + filter row at top. Single source of truth for the new visuals so any future client widget reuses the same components
- Unnamed RF stub client deleted (legacyRfId 24): one-shot DELETE to clear a placeholder row that was confusing the Clients list
- Phone Tab Phase 3:
  - Auto-tagging: every inbound + outbound SMS / call now matches against Candidate.phone (last 10 digits) AND Contact.phoneNumbers JSON; SmsMessage.candidateId / CallLog.candidateId / clientId stamped on the write path. Activity card on the matched profile picks them up automatically
  - Open Profile button on /phone thread header navigates to the matched candidate or client
  - Read tracking via SmsMessage.isRead: marked true when the thread opens in the candidate Activity card sub-tab OR in the /phone right-pane detail. Sidebar Phone unread badge + thread-list "Needs reply" count both read this field
  - Global header search expanded to email + phone in addition to name
- Notification toast redesign: Subtle / Tint / Ink styles, all court-token bound. Shared ActionChip + DismissBtn components; the new chrome is reused for the upcoming text + call toasts so style stays consistent
- Settings notifications section: NotifStylePicker with three style cards (Subtle / Tint / Ink), Try-it buttons that emit a sample toast, Quiet hours toggle. Style picker writes to localStorage so it takes effect on the very next toast — no reload, no remount
- CLAUDE.md created at repo root: permanent project-brain rules file, auto-loaded every Code session. Codifies the 13 architecture non-negotiables, banned vocabulary, Step 0 grep, tenant-scoping rules, design system, key file locations, and the "what NOT to build" list
- Calendar Tab added to Week 3 roadmap: month/week/day view, Google Calendar read/write sync, create-meeting modal for BD calls + intro calls without going through the full interview scheduler flow
- Jobs page: salary range column + condensed Apply-to-Job dropdown (shipped mid-session)

## What Shipped in Ace 25.0 (2026-04-27)
- Quo SMS fix: krispcall.ts dead code deleted, /api/krispcall/webhook moved to /api/quo/webhook (OpenPhone provider URL must be updated in settings), error message in SmsComposer points at Quo env vars. Webhook signature + write paths verified end-to-end with a real send
- SmsMessage candidateId consistency fix: candidate profile (RF page) was passing the numeric RF id stringified to SmsComposer/TextingExchanges; both inbound webhook writes and outbound POST /api/sms now key on the Neon cuid. One-shot UPDATE backfilled 2 orphaned rows
- Quo deep link: GET /api/quo/conversation?phoneNumber=... resolves an OpenPhone conversationId and returns my.quo.com/inbox/{phoneNumberId}/c/{id}; falls back to inbox URL on miss. "Quo" button on candidate SMS composer + Phone tab thread header opens the deep link in a new tab
- Activity tab moved into a sidebar Activity card on candidate profiles. Email/Call/Text underline sub-tabs, default Text. TextingExchanges + CallLogs got a defaultOpen prop so they auto-expand inline
- Candidate profile full redesign across both RF and Ace-native paths: 48px avatar+initials header (no email/phone duplication below name). Two-column main: 70% resume column with Profile/Game Plan underline tabs + Skills/Experience/Education/Notes accordions; 30% sidebar in order Contact → Activity → Employment
- Header action buttons (Add to List + Apply to Job + Submit to Job) moved out of the page header into a small toolbar above the resume column (between the underline tabs and the resume card, right-aligned). On RF the toolbar also carries Kept badge + display tags on the left
- Pipeline section: single "Pipeline · N" label in text-xs uppercase muted, no duplicate "JOBS (N)" or "Linked jobs (N)" headers
- Compact pipeline rows (RF placement-flows.tsx + Ace local-placement-rows.tsx): card wrapper per row removed, parent uses divide-y inside one rounded-xl border. Single flex row per job, py-1.5 px-3, briefcase + title + · company + StageBadge all left-aligned, action buttons right-aligned only. Per-row Hired chip removed (StageBadge already shows it). Past interviews hidden entirely; only the next-upcoming interview renders inline as "· Apr 19 · 8:59 AM · Video" after the stage chip
- Universal stage chip colors via stage-badge.tsx BUCKET_CLASS map (single source of truth). Mapping: Submitted=emerald, Interviewing=blue, Applied=amber, Sourced=neutral surface-subtle, Offer/PendingStart=purple, Hired=darker emerald (100/800/300), Rejected/Cancelled=red, Kept=amber-100/800/300. Pill base shrunk to px-2 py-0.5 text-[10px] font-semibold. Applied to /pipeline + candidate profile + Ace local rows automatically
- Header Apply/Submit wired via URL deep-links on both paths: ?openApply=1 / ?openSubmit=1 open the existing modals (LocalCandidateActions on Ace got a hideButtons prop; PlacementActions on RF got new useEffect handlers). The duplicate in-island "Jobs (N)" + Apply/Submit row in placement-flows.tsx PlacementActions was removed
- Resume toolbar collapsed to a single row: "Resume" eyebrow on the left, version dropdown + Edit Resume + Convert to PDF (DOCX) + Download + Upload + Delete on the right. Padding px-3 py-1.5. Filename / size / upload-date subline removed (info already in version dropdown label). No-wrap with overflow-x-auto so the row stays one line at any column width. KNOWN REGRESSION CLOSED IN 29.0: click-to-rename UX restored via inline rename on the selected version
- TextingExchanges: max-h-64 overflow-y-auto scroll-smooth on the bubble list + auto-scroll-to-bottom useEffect on mount and on every messages update
- BillingTower (dashboard): sparkline removed; Q2 card uses left-aligned label/value/hint stack
- Email Threads sections removed from candidate profiles (raw thread-id list was useless without subject/preview); TODO comment in place. gmailThreadTag fetch dropped from page.tsx Promise.all and from local-profile.tsx candidate select
- Vercel build fixes shipped through the day: prefer-const on jobId in activity API; unused-vars cleanup after removing Hired chip / badgeSuffixFor / InterviewList / InterviewRow / extensionFor / formatBytes / displayNameFor / Pencil + Check / Clock + MapPin + PhoneCall + Trash2 + Video / cancelInterview imports

## What Shipped in Ace 24.0 (2026-04-27)
- Phone Tab Phase 1: schema migration (organizationId + clientId on SmsMessage + CallLog), 3-pane page shell at /phone, thread list wired to real data, sidebar nav item, refresh button
- Phone Tab Phase 2: FAB with phone icon, start conversation popup, new text panel (POST /api/sms), call panel, webhook orgId fix, unread count fix, sidebar badge plumbing
- Brand system: Playfair Display + Inter fonts, ink/cream palette replacing navy, component token cleanup across 10+ files
- Shared Button component: src/components/ui/button.tsx with primary/secondary/danger/apply/schedule variants. Pill button sweep across 17 files.
- Court system: 6-mode palettes (Hard/Clay/Grass x Light/Dark), globals.css full rewrite, sun/moon toggle in Settings, Wimbledon forest green sidebar, Grass purple badge, pre-hydration script
- Dashboard redesign: Activity Dashboard header, THIS WEEK eyebrow, KPI subtext removed, Billing Tower prominent (BILLING TOWER large bold uppercase with green underline accent, $7.5k compact format, sparkline graphic, pale green card), Upcoming Interviews below Billing Tower, tighter layout
- Applicants + candidate profile buttons: Submit (green), Keep (slate), Reject (red), Apply (amber), Schedule Interview (blue), Client Sending Invite (grey) - unified across all pages
- Stage badge colors matching button system across all pages
- Generate/Edit with Claude buttons: dark background white text unified across all surfaces
- Activity tab: added to candidate and client profiles next to Game Plan, fetches ActivityLog via GET /api/activity/[entityType]/[entityId]/route.ts
- Vercel build errors fixed: ESLint prefer-const on jobId in activity API route

## What Shipped in Ace 23.0 (2026-04-27)
- GmailThreadTag schema table - links email threads to candidate/client profiles by address matching
- Auto-tagging emails to candidate/client profiles (tagThreadByAddresses in gmail.ts)
- Email threads surfaced on candidate profiles - both Ace-native and RF-imported paths
- Email threads surfaced on client profiles
- Gmail labels in mail sidebar with nested hierarchy and collapse/expand chevrons
- Collapse state persisted to localStorage (key: ace-mail-collapsed-labels)
- Mail page redesign - premium Inbox card (#EAF4E4 bg, #5A9642 border), Sent/Drafts tabs in sidebar
- Global app sidebar icon fixes - Applicants=User, Dashboard=LayoutGrid, Candidates=Users, Clients=Building2, Jobs=Briefcase
- Tennis ball favicon (public/favicon.svg) + Ace brand mark in header (BrandMark component)
- Compact uniform notifications - same height, 2px solid black border, 60 char truncation
- Phone icon for SMS and call notifications (text-notification-toast.tsx)
- Bigger minimized composer bar - h-12, text-sm, larger hit targets
- Pop-out email thread - floating window, draggable, resizable, full reply/archive/move/label functionality
- Global Compose FAB - fixed bottom-right, 56x56 green circle, non-blocking, context-aware prefill on candidate pages
- Compose button removed from mail sidebar (FAB replaces it globally)
- Small RefreshCw button added to thread list header
- Mail search bar - 300ms debounce, Gmail syntax support, searches ALL mail when on inbox, scoped search within labels
- Drag and drop emails from thread list to sidebar labels
- BCC autocomplete with Austin Barnard (austin@breakpointtalent.com)
- Click-to-add bug fix on To/CC/BCC suggestion dropdown (onMouseDown instead of onClick)
- RF-imported candidates now show Email Threads card on profile
- Mail notification toast auto-dismisses when matching thread is opened
- Austin Barnard added to BreakPoint Talent org as member
- ACE_RULES.md fully consolidated with all standing instructions including --dangerously-skip-permissions flag

## What Shipped in Ace 22.0 (2026-04-26)
- Gmail inbox inside Ace (/mail tab)
- Mark thread read on open
- Unread badge on Mail sidebar
- Browser notifications
- Move To label dropdown
- Signature and logo render fix in thread view

## Background: Quo/Ringover Integration (already exists, NOT a phone tab)
- CallLog table in Neon - stores call records
- SmsMessage table in Neon - stores SMS records
- CallTranscript table in Neon - stores transcripts
- Ringover webhooks wired for inbound events
- Click-to-call exists on candidate profiles
- Claude transcript summaries exist
- NONE of this has a dedicated /phone UI page (shipped 24.0/26.0 — the /phone tab is now the surface)

## On the Horizon
- Multi-recruiter permissions: ownerId on Client and Job, shared candidate pool, manager view
- Invite flow in Settings for adding team members
- Client page FAB prefill (primary contact auto-fill)
- Full site UX redesign (mail page redesign is the design template - apply to all pages)
- Create new Gmail labels from within Ace
- RF-imported candidate copy sweep (17 RecruiterFlow strings in UI)

## Key IDs (reference)
- Andrew org: cmobj8dxz00012gliequ53kvc (BreakPoint Talent)
- Austin user ID: cmo1ufmmn0000ib05eqk6hh32
- Austin membership ID: cmoh22lhx00012g3enihawa8v
- Austin role: member
