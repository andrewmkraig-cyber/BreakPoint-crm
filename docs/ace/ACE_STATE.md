# Ace State

## Current version: Ace 18.0 (in progress, session 1 of N)

## Last session: Ace 17.0 - shipped

### Ace 17.0 Completed Ships

Phase 6 - Mail Tab fully integrated:
- /mail route with inbox list (50 most recent threads), thread detail view, sidebar nav entry
- Sidebar reorder: Dashboard, Mail, Pipeline, Applicants, Candidates, Clients, Jobs, Settings (Settings pinned to bottom)
- Thread detail shows newest message at top, oldest at bottom
- Archive button per thread (icon-only on hover in left rail, plus button in thread header) - removes INBOX label via gmail.modify
- Full reply composer: To/CC/BCC, rich text (bold/italic/underline/lists/links), file upload, drag-drop attachments, inline image paste, threaded replies preserving Re: chain via In-Reply-To + References headers
- Default To on Reply auto-fills with the OTHER party in the thread (never current user)
- Settings > Branding & Signature section: Full Name, Job Title, Phone, Website, Email (read-only), Logo upload (base64 stored in DB, default fallback in src/lib/default-brand-logo.ts)
- HTML email signature renders to match Andrew's Gmail signature: logo on left (white background, ~120px), vertical green divider, name in serif bold, MANAGING PARTNER & FOUNDER in green caps, horizontal divider, three contact rows with green-circle PNG icons (envelope, phone, globe) - icons stored as base64 in src/lib/signature-icons.ts
- Template picker (Use Template button) - lists all active templates from user's library
- Insert Field dropdown - 15 merge fields total: candidate.first_name, candidate.last_name, candidate.full_name, candidate.email, candidate.current_title, candidate.current_company, job.title, job.client_name, job.city, job.state, job.description, client.name, client.primary_contact_first_name, user.first_name, user.full_name
- Generate with Claude button: small textarea + Generate. User types prompt, Claude API drafts email body using existing CLAUDE_MODEL constant. Streams into body, edit before send. Auto-signature appended.
- Universal click-to-email popup: every email address in the app (candidate profiles, client contacts, pipeline rows, etc.) opens the modal composer in-app. No more mailto handoffs to external Gmail/Outlook.
- ENOENT logo bug fixed: signature renderer reads logo from compiled-in base64 constant (src/lib/default-brand-logo.ts) - zero filesystem reads at runtime, works on Vercel serverless
- Modal portals to <body>, full-screen backdrop blocks click-through, all composer interactions captured by composer not page underneath
- CC/BCC toggles: + CC and + BCC buttons reveal editable rows, free-text comma-separated, - to collapse and clear

### Known Issues / Backlog Items NOT shipped in 17.0
These got identified in 17.0 testing but are queued for 18.0 or later:

1. Logo + signature contact icons render with broken image boxes inside Ace's own /mail thread view. They render correctly in real Gmail received messages (proven by Andrew's screenshot of received email). Bug is in Ace's HTML rendering of stored thread bodies, not in the signature itself.
2. Threads opened in /mail or via the popup composer do NOT mark as read in Gmail on Google's side. Need bidirectional sync: open thread in Ace → Gmail markRead.
3. No notifications or unread count badge on Mail sidebar item.
4. CC field on popup composer does not autocomplete with other contacts at the same client org. BCC does not autocomplete with teammates (Austin Barnard).
5. Popup composer closes when clicking the backdrop. Andrew wants X-button-only close behavior.
6. Popup composer cannot be dragged or resized. Andrew wants Gmail-style drag, resize, and minimize-to-tray behavior so he can see data behind the composer and have multiple drafts open.
7. Templates imported from RecruiterFlow use [Bracket Format] tokens like [Candidate First Name]. Ace's merge field resolver only handles {{double.curly}} format. Old RF templates pass through as literal text. Andrew wants dual-format parser so both syntaxes resolve to the same data.
8. When popup opens from a candidate profile, Ace passes candidate context only. If the merge field references {{job.*}} or {{client.*}}, those don't resolve because no job context is loaded. Need smart context resolution: if candidate has 1 active job, auto-load it. If multiple, show "Which job is this email about?" dropdown above the body.
9. Templates need rebuilding in proper format: Submittal Confirmation to Candidate ("Great News - You've Been Submitted!"), Application Received, Acceptance of Offer (subject "Acceptance of Offer - [Candidate Name] - [Client Name]").
10. Settings sidebar entry scrolls out of view when on Candidates and Jobs pages because those pages are tall. Sidebar should be sticky/fixed, Settings always visible.
11. Replace Archive button with "Move To" label dropdown - lets Andrew pick a Gmail label (e.g. "!Active Clients", "Sheehan Brothers", "Placements", "Done Deals") and applies that label + removes INBOX in one action. Mirrors how Andrew triages email manually in Gmail today.
12. ENOENT for logo on serverless was fixed once but came back intermittently when sending from popup. Worth a re-audit to confirm all signature render paths use the base64 import, not file reads.
13. Auto-tagging emails to candidate/client profiles by sender/recipient address - threads should surface on the candidate or client they relate to. Not yet built.

## Current task: Ace 18.0 - Composer UX overhaul (mostly complete) + Lists feature (in progress)

Composer UX overhaul mostly shipped. Lists feature schema landed, UI next session.

### Ace 18.0 Session 1 Completed Ships (2026-04-25)

- 5A.1 - Composer UX: backdrop click ignored, drag and resize, minimize button + bottom-of-screen tray
- 5A.1-fix - Send button always visible at min composer size, sticky sidebar with Settings always reachable on long pages
- 5A.2 - Dual-format merge field parser ({{}} and []), smart context resolution with "Which job is this email about?" dropdown for 2+ associations, removed annoying "Send anyway?" dialog
- 5A.2-fix - Multi-word full-name search (was missing candidate when typing "andrew kraig"), context resolution uses any non-terminal job association not just "applied", picking a job from dropdown re-resolves merge fields in body
- 5A.3 - /candidates page paginates at 25 per page with prev/next/jump-to-page, search resets to page 1 with filtered count, URL-based page state
- 5A.4.a - Lists feature schema migration: candidate_list and candidate_list_membership tables in Neon with org scoping and cascade deletes
- Doc commits: ACE_RULES grep category framework (A/B/C/D), tightened 5A.3 scope, added 5A.4 to roadmap

## Last successful Vercel deploy: 638f261 (5A.4.a Lists schema migration)

## Architecture state
- All 13 architecture non-negotiables holding
- Grep baseline: recruiterflow 2, RecruiterFlow 18, RfId 1072
- RecruiterFlow drifted from 17 to 18 and RfId from 1070 to 1072 across the session, all Category A/B/C (no D violations). Per the new grep framework rule (ACE_RULES rule 5), this is allowed.
- RF fully removed since Phase 5
- Neon Postgres sole source of truth for all writes
- All Gmail OAuth scopes granted: gmail.readonly, gmail.modify, gmail.send

## Ace 19.0 close (2026-04-25)

5A.5.b deployed to ace.breakpointtalent.com but uncommitted. Three known bugs to fix as Ace 20.0 first task:

- (A) Resume upload broken with 500 "Chunk 1/1 failed" on all candidates - regression from candidateRfId-nullable plumbing in /candidates/new/actions.ts and local-profile.tsx lazy-backfill.
- (B) Brand and Redact don't persist together - only one saves, reproduced on Lesley Snell and Sidney Long.
- (C) Re-editing existing branded version doesn't load existing state, opens fresh Brand mode and Redact button doesn't work.

Local files uncommitted: prisma/schema.prisma (variant column), src/lib/default-brand-logo.ts, src/app/candidates/[id]/brand-resume-actions.ts, resume-brander.tsx, resume-editor.tsx, resume-redactor.tsx (refactored), editable-resume.tsx, page.tsx, local-profile.tsx, src/app/candidates/new/actions.ts, docs/help/resume-branding.md.
