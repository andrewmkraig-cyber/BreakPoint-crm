# ACE_STATE.md
Last updated: 2026-04-27 - End of Ace 25.0

## Current Status
Current Version: Ace 26.0
Last Session: Ace 25.0 - April 27, 2026
Current Status: All Ace 25.0 tasks complete. Ready for Ace 26.0.

## What Shipped in Ace 25.0 (2026-04-27)
- Quo SMS fix: krispcall.ts dead code deleted, /api/krispcall/webhook moved to /api/quo/webhook (OpenPhone webhook URL must be updated in provider settings), error message in SmsComposer points at Quo env vars
- SmsMessage candidateId consistency fix: candidate profile (RF page) was passing the numeric RF id stringified to SmsComposer/TextingExchanges; both inbound webhook writes and outbound POST /api/sms now key on the Neon cuid. One-shot UPDATE backfilled 2 orphaned rows
- Quo deep link: GET /api/quo/conversation?phoneNumber=... resolves an OpenPhone conversationId and returns my.quo.com/inbox/{phoneNumberId}/c/{id}; falls back to inbox URL on miss. "Quo" button on candidate SMS composer + Phone tab thread header opens the deep link in a new tab
- Activity tab moved into a sidebar Activity card on candidate profiles. Email/Call/Text underline sub-tabs, default Text. TextingExchanges + CallLogs got a defaultOpen prop so they auto-expand inline. ActivityFeed left intact at /api/activity for future reuse
- Candidate profile full redesign: 48px avatar+initials header (no email/phone duplication below name), header has exactly Add to List + Apply to Job + Submit to Job. Two-column main: 70% resume column with Profile/Game Plan underline tabs + Skills/Experience/Education/Notes accordions; 30% sidebar in order Contact → Activity → Employment
- Pipeline section: single "Pipeline · N" label in text-xs uppercase muted, no duplicate "JOBS (N)" or "Linked jobs (N)" headers
- Compact pipeline rows (RF placement-flows.tsx + Ace local-placement-rows.tsx): card wrapper per row removed, parent uses divide-y inside one rounded-xl border. Single flex row per job, py-1.5 px-3, briefcase + title + · company + StageBadge all left-aligned, action buttons right-aligned only. Per-row Hired chip removed (StageBadge already shows it)
- Universal stage chip colors via stage-badge.tsx BUCKET_CLASS map (single source of truth). New mapping: Submitted=emerald, Interviewing=blue, Applied=amber, Sourced=neutral surface-subtle, Offer/PendingStart=purple, Hired=darker emerald (100/800/300), Rejected/Cancelled=red, Kept=amber-100/800/300. Pill base shrunk to px-2 py-0.5 text-[10px] font-semibold (was h-6 min-w px-3 text-[11px] font-bold). Applied to /pipeline + candidate profile + Ace local rows automatically since all consume StageBadge
- Header Apply/Submit on Ace path wired via URL deep-links: ?openApply=1 / ?openSubmit=1 trigger the existing modals inside LocalCandidateActions, which now accepts a hideButtons prop so its standalone button row can be suppressed while modals stay mounted. RF path uses href="#pipeline" anchor scroll (per-row buttons remain the actual modal entry points; modal extraction from placement-flows.tsx is deferred)
- TextingExchanges: max-h-64 overflow-y-auto scroll-smooth on the bubble list + auto-scroll-to-bottom useEffect on mount and on every messages update
- BillingTower (dashboard): sparkline removed; Q2 card uses left-aligned label/value/hint stack
- Email Threads sections removed from candidate profiles (raw thread-id list was useless without subject/preview); TODO comment in place. gmailThreadTag fetch dropped from page.tsx Promise.all and from local-profile.tsx candidate select
- Vercel build fixes shipped through the day: prefer-const on jobId in activity API; unused-vars cleanup after removing Hired chip and badgeSuffixFor helper

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

## Next Task for Ace 26.0 — Phone Tab Phase 3
- Auto-tagging: every inbound/outbound call and text auto-links to candidate (by phone number lookup) or client contact (by phone match against Contact.phoneNumbers JSON). Surfaces on their profile Activity card automatically
- Read tracking: add readAt field to SmsMessage. Mark inbound rows as read when the thread is opened in the candidate Activity card sub-tab or in the /phone right-pane detail. Sidebar unread badge + thread-list "Needs reply" count both read this field
- Incoming text toast: bottom-right, 8s auto-dismiss with hover-to-pause, click to expand inline reply, Enter sends, all logs to candidate/client thread automatically
- Incoming call toast: persistent until dismissed. Answer turns the toast into a "Connected" card with running timer + End Call. Voicemail forwards to VM. Every action logs to CallLog
- Search through text + call history in /phone (top of thread list, debounced, server-side LIKE on body / phone number / candidate name)

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
- NONE of this has a dedicated /phone UI page

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
