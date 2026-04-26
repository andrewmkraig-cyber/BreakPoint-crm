# Ace State

## Current version: Ace 22.0 - shipped (2026-04-26)

## Next task: Ace 23.0 - Mail Tab remaining items (see roadmap)

### Ace 22.0 Session Completed Ships (2026-04-26)

* Mark thread read on open - gmail.modify removeLabel UNREAD fires on thread open, local bold clears immediately
* Unread count badge on Mail sidebar nav item - green pill, hides at 0
* Browser tab title updates with unread count - "(N) Ace - BreakPoint Talent" format, updates every 30s via MailContext
* Favicon - BreakPoint logo added as src/app/icon.png, pulled forward from Week 4 backlog
* Move To label dropdown - single thread, fetches user Gmail labels, applies label + removes INBOX, toast confirms. Archive kept - Move To is additive.
* Bulk thread selection - checkboxes on hover, select-all, bulk Move To and bulk Archive with sequential 150ms delay, threads remove progressively
* Signature/logo CID image fix - Gmail inline images sent as cid: references now fetched and inlined as base64 data URIs before render
* Live unread badge polling - MailContext polls every 30s, no hard refresh needed, seeds from SSR. Sidebar badge and tab title both consume MailContext.
* In-app notification toasts - sonner toast in bottom-right, sender + subject + Reply + X, toggle in Settings, never marks read on dismiss. Browser Notification API removed entirely - in-app only.
* Bulk archive sequential fix - sequential with 150ms delay, threads remove one-by-one, same applied to bulk Move To
* Toast style picker - 4 themes in Settings: BreakPoint Green, Ohio State Buckeyes, Cleveland Browns, Dark Mode. Stored in localStorage as ace_toast_theme. Custom styled per mockup: circular icon left, bold sender, uppercase subject, themed border + glow, Reply + X buttons right.

## Architecture state

* All 13 architecture non-negotiables holding
* Grep baseline: recruiterflow 2, RecruiterFlow 10, RfId 1082. No Cat D violations.
* RF fully removed since Phase 5
* Neon Postgres sole source of truth for all writes
* Gmail OAuth scopes: gmail.readonly, gmail.modify, gmail.send - all active
* MailContext is single source of truth for unread count - sidebar badge and tab title both consume it
