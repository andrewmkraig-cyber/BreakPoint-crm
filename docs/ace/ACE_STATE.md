# ACE_STATE.md
Last updated: 2026-04-29 - Start of Ace 28.0

## Current Status
Current Version: Ace 28.0 (in progress)
Last Shipped: Ace 27.0 - April 28, 2026
Live at: ace.breakpointtalent.com
Current Status: Ace 28.0 open. Game Plan Phase 1 (web search tool on src/app/api/ai-workspace/route.ts) is the active task. Phases 2-6 queued behind it. All Ace 27.0 work shipped clean; no carry-overs open.

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

## Known Issues / Still In Progress (carry into Ace 28.0)
- (none open — all Ace 26.0 known issues closed in 27.0)

## Next Task for Ace 28.0
**Game Plan Phase 1** — Add web search tool to src/app/api/ai-workspace/route.ts. Claude auto-searches when the prompt requires it. See ACE_ROADMAP.md "Game Plan phases" under Week 2 for the full Phase 1-6 sequence (web search → Find Matches → external + internal blend → tagged-email context → My Writing Style setting → sidebar Claude panel).

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

## Known Issues / Still In Progress (carry into Ace 27.0)
- Text toast icon showing MessageSquare instead of Phone (regression after the toast chrome refactor — should match the Phone icon used on the Phone sidebar nav)
- Text toast showing "· Text" trailing label that should be removed (eyebrow already says SMS context, the dot-Text suffix is redundant)
- Reply button low contrast on some Court Mode themes — needs token rebind so it reads against tinted backgrounds
- Compose FAB still visible on /settings page (should be hidden — Settings has no surface that benefits from the launcher)
- Toast subtitle text rendering in ALL CAPS in some themes — likely a CSS uppercase rule applying too broadly to the eyebrow + subtitle slots
- Settings appearance section not yet matching Claude Design two-column layout (Court Mode + Notification Preferences should sit side-by-side at desktop widths)

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
- Resume toolbar collapsed to a single row: "Resume" eyebrow on the left, version dropdown + Edit Resume + Convert to PDF (DOCX) + Download + Upload + Delete on the right. Padding px-3 py-1.5. Filename / size / upload-date subline removed (info already in version dropdown label). No-wrap with overflow-x-auto so the row stays one line at any column width. KNOWN REGRESSION: click-to-rename UX is gone with the filename row — renameCandidateResume server action stays available for future re-wiring
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
