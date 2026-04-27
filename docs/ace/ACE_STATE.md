# ACE_STATE.md
Last updated: 2026-04-27 · End of Ace 23.0

## Current Status
Mail Tab batch: FULLY COMPLETE as of Ace 23.0.
Next up: Phone Tab Phase 1 - foundation build.

## What Shipped in Ace 23.0 (2026-04-27)
- Auto-tagging emails to candidate/client profiles by sender/recipient address
- GmailThreadTag schema table added to Neon
- Email threads surfaced on candidate profiles (both Ace-native and RF-imported)
- Email threads surfaced on client profiles
- Gmail labels in mail sidebar with nested hierarchy + collapse/expand
- Collapse state persisted to localStorage
- Mail page redesign - premium Inbox card, Sent/Drafts tabs, sidebar improvements
- Global sidebar icon fixes (Applicants=User, Dashboard=LayoutGrid, etc.)
- Tennis ball favicon + Ace brand mark in header
- Compact uniform notifications with bold border
- Phone icon for SMS/call notifications
- Bigger minimized composer bar
- Pop-out email thread - floating, draggable, resizable, full reply/archive/move functionality
- Global Compose FAB - bottom-right, non-blocking, context-aware prefill on candidate pages
- Compose button removed from mail sidebar (FAB handles this globally)
- Small refresh button added to thread list header
- Mail search bar with Gmail syntax support, searches all mail from inbox, scoped search within labels
- Drag and drop emails from thread list to sidebar labels
- BCC autocomplete with Austin Barnard
- Click-to-add bug fix on To/CC/BCC dropdown
- RF-imported candidates now show email threads on profile
- Notification toast dismisses when matching thread is opened
- Austin Barnard added to BreakPoint Talent org (OrganizationMembership inserted)
- ACE_RULES.md consolidated with all standing instructions

## What Shipped in Ace 22.0 (2026-04-26)
- Mail Tab batch Phase 1: Gmail inbox inside Ace
- Mark thread read on open (removeLabel UNREAD)
- Unread badge on Mail sidebar
- Browser notifications Gmail-style
- Move To label dropdown
- Logo and signature render fix in thread view

## Current Phase
All Phases 0-5 complete. RF fully removed. Mail Tab complete.

## Next Task
Phone Tab - Phase 1 foundation build:
- /phone page with sidebar: All Calls, Missed, Voicemail, SMS Threads
- Call log from Ringover API (data already in CallLog table)
- SMS threads from Ringover (data already in SmsMessage table)
- Auto-match calls/texts to candidate and client profiles
- Same address-matching logic used for email auto-tagging

## On the Horizon
- Phone Tab Phase 2: inbound call notifications (Answer/Voicemail buttons), SMS inline reply, click-to-call from anywhere
- Phone Tab Phase 3: search, filter, SMS thread view, call recordings on profile pages
- Multi-recruiter permissions: ownerId on Client/Job, shared candidate pool
- Invite flow in Settings for adding team members
- Client page FAB prefill (primary contact auto-fill when composing from client profile)
- Full site UX redesign (mail page redesign is template - apply to all pages)
- Create new Gmail labels from within Ace

## Austin Barnard Org Access
- User ID: cmo1ufmmn0000ib05eqk6hh32
- OrganizationMembership ID: cmoh22lhx00012g3enihawa8v
- Role: member
- Org: BreakPoint Talent (cmobj8dxz00012gliequ53kvc)
