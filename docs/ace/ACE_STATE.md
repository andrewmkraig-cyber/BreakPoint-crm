# ACE_STATE.md
Last updated: 2026-04-27 - End of Ace 24.0

## Current Status
Current Version: Ace 25.0
Last Session: Ace 24.0 - April 27, 2026
Current Status: All Ace 24.0 tasks complete. Ready for Ace 25.0.

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

## Next Task for Ace 25.0
1. Visual markup change (Andrew will provide spec at session start - Claude asks for instructions)
2. Phone Tab Phase 3:
   - Incoming text toast with inline reply (bottom-right, 8s auto-dismiss, hover pauses, expand to reply, Enter sends, logs to candidate/client)
   - Incoming call toast (persistent, Answer changes to Connected + timer + End Call, Voicemail sends to voicemail, all logged)
   - Auto-tagging: every call/text auto-links to candidate or client by phone number, surfaces on their profile activity
   - Search through text history in /phone
   - Read tracking: mark SmsMessage as read when thread is opened (add readAt field to schema)

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
