# Ace State

## Current version: Ace 23.0 - shipped (2026-04-27)

## Next task: Ace 24.0 - Phone Tab build (Phase 1 - foundation)

### Ace 23.0 Session Completed Ships (2026-04-27)

**Mail Tab batch: COMPLETE.** All items from the 23.0 mail-tab plan shipped.

#### Schema + auto-tagging
* GmailThreadTag table - new linking model joining Gmail threadIds to Candidate / Client / Organization. organizationId enforced, unique constraints on (threadId, candidateId) and (threadId, clientId).
* Auto-tag on send + on read - tagThreadByAddresses() fires on every thread open, send, and reply. Matches sender/recipient addresses against Candidate.email and Contact.emails (orgId-scoped). Idempotent upserts.
* Email Threads card on profiles - Ace-native AND RF-imported candidate paths both surface their auto-tagged threads. Same card on Client overview tab.

#### Mail sidebar redesign
* Premium Inbox card - rounded-2xl green border, Mail icon, white pill unread count.
* Gmail labels in sidebar with full nested hierarchy (parses "Foo/Bar" path syntax). Indented children, chevron expand/collapse per parent, Collapse all / Expand all toggle.
* localStorage persistence for collapsed state - survives navigation and tab close.
* Sent + Drafts system-label shortcuts.
* Search bar with full Gmail syntax (from:, to:, subject:, etc.). 300ms debounce. Searching from Inbox searches all mail (not just inbox); searching within a label scopes to that label.
* Refresh button on thread list - small ghost icon, spins while loading, preserves currently-open thread.
* Drag and drop emails from the thread list to user labels in the sidebar - drop target highlight, toast confirmation.

#### Mail composer
* BCC autocomplete from OrganizationMembership - Austin Barnard surfaces on focus.
* Click-to-add fix - dropdown selection now lands on a single mousedown (was requiring a second click).
* Non-blocking mode - FAB-launched composer skips the dark backdrop and lets pointer events pass through, so the user can keep navigating + dropping emails on labels while composing.
* Larger minimized composer pill - h-12, text-sm, easier to read and click.

#### Notifications
* Compact uniform mail/SMS/call toasts - 2px black border, font-bold title, 60-char truncate, fixed height.
* Phone icon for both SMS and call toasts (was MessageSquare for SMS).
* Mail toast auto-dismisses when the user opens that thread - keyed by stable id `mail-toast-{threadId}` via sonner's custom-id API.

#### Pop-out floating thread window
* Pop out button on the thread detail action bar.
* Portal-rendered draggable + resizable window. Defaults 680x520, min 480x400, centered on first open.
* Composer-style header (GripVertical icon + centered subject + minimize / X). Drag the header to move; bottom-right corner to resize.
* Full ThreadDetail rendered inside (refactored to a shared interface so MailView and FloatingThreadWindow use the same component). Reply / Archive / Move To all work from the floating window.
* Survives navigation away from /mail. Minimize collapses to header-only.

#### Brand
* Tennis ball "Ace" favicon - SVG with green ball, dark border, white seams, bold "Ace" wordmark. Mirrored in the auto-generated /icon PNG via next/og (text rendered via CSS, not SVG `<text>`, to avoid Satori prerender error).
* Brand mark in main sidebar - tennis ball icon next to "Ace" wordmark + "BREAKPOINT TALENT" subtitle.

#### Global Compose FAB
* Bottom-right floating action button on every signed-in page.
* 56x56 green circle, Plus icon, focus ring, tooltip.
* Context-aware: on /candidates/[id], prefills To with the candidate's email via /api/mail/candidate-context. Other pages open blank.
* Launches composer in non-blocking mode (see Mail composer section).

#### Other
* Austin Barnard (austin@breakpointtalent.com) added to BreakPoint Talent org as OrganizationMembership row, role=member. Membership row id: cmoh22lhx00012g3enihawa8v.
* Removed sidebar Compose button (redundant with FAB).
* /api/mail/threads route accepts q + labelIds, defaults to INBOX when neither passed but searches all mail when q is passed without labelIds.
* listGmailAllLabels helper in src/lib/gmail.ts - fetches every Gmail label with messagesTotal counts.

## Architecture state

* All 13 architecture non-negotiables holding.
* Grep baseline unchanged from 22.0 - no new active RF queries introduced.
* RF fully removed since Phase 5.
* Neon Postgres sole source of truth for all writes.
* Gmail OAuth scopes: gmail.readonly, gmail.modify, gmail.send - all active.
* MailContext is single source of truth for unread count.
* New GmailThreadTag model lives in Neon, scoped by organizationId per NN #8.
* Auto-tag write paths idempotent and try/catch-isolated so Gmail-side hiccups never break the underlying mail flow.
