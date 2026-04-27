# ACE_STATE.md
Last updated: 2026-04-27 - End of Ace 23.0

## Current Status
Mail Tab: FULLY COMPLETE as of Ace 23.0.
Phone Tab: NOT STARTED. Quo/Ringover integration exists (CallLog, SmsMessage tables in Neon, webhooks wired) but there is NO /phone page UI. Building the phone tab is the next major feature.
Next task: Phone Tab Phase 1 - foundation build.

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

## Next Task: Phone Tab Phase 1
Build a dedicated /phone page with full UI similar to the mail tab.

Phase 1 - Foundation:
- /phone page with left sidebar: All Calls, Missed, Voicemail, SMS Threads
- Call log view pulling from existing CallLog table
- SMS thread view pulling from existing SmsMessage table
- Auto-match calls and texts to candidate/client profiles (same logic as GmailThreadTag)
- Show call/SMS history on candidate and client profile pages

Phase 2 - Notifications and actions:
- Inbound call notification with Answer and Send to Voicemail buttons
- Inbound SMS notification with inline reply box in the toast
- Click-to-call from anywhere in Ace (already partially exists - verify and expand)

Phase 3 - Full parity:
- Search across calls and texts
- Filter by type (missed, inbound, outbound)
- Full SMS thread conversation view
- Call recordings and transcripts surfaced on profile pages

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
