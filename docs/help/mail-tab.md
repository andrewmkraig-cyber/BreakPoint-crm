# Mail Tab — read-only inbox + thread view

Ships the first piece of the Mail Tab (Phase 6.0). You can now open your Gmail inbox inside Ace without leaving the app. Reading only in this release — reply composer is next.

## What it does

- **Inbox list** — left rail on `/mail` shows your 50 most recent Gmail threads. For each thread you see the sender name, the subject, a one-line snippet, and a relative timestamp (`12m`, `3h`, `2d`).
- **Thread detail** — clicking a thread in the left rail opens the full conversation on the right. Messages are ordered oldest → newest, with the sender, recipients, and timestamp on each message.
- **Sidebar nav entry** — a new **Mail** item appears in the left sidebar below **Clients**. Clicking it routes to `/mail`.

## When to use it

- You want to read a candidate's latest email reply without Alt-Tabbing to Gmail.
- You want to audit what was last said on a thread before opening the Submittal Composer.
- You want a read-only inbox you can keep glancing at while working inside Ace.

Don't use it yet for replying — that comes in the next ship.

## How to use it

1. Click **Mail** in the left sidebar (or go straight to `/mail`).
2. The left rail shows your 50 most recent threads. Unread threads show their sender in **bold**.
3. Click any thread. The right pane loads that thread's messages in order. Messages render as HTML (formatting preserved) or, for plain-text emails, as pre-wrapped text.
4. Click another thread to switch. Your position in the list is preserved.

## First-time setup — one-time re-sign-in required

The Mail Tab needs read access to your Gmail (`gmail.readonly` scope). Ace has always requested `gmail.send` (for outbound email) but `gmail.readonly` is new in this release. **If you signed in before this release**, you'll need to sign out and sign back in once to grant the new scope.

1. Click your avatar / sign-out link.
2. Sign in again with Google. The consent screen will show a new permission — "View your email messages and settings."
3. Approve. You're back in with the updated scope.
4. `/mail` should now load your inbox.

If the consent screen doesn't show the new permission, Google may be using a cached grant. Fix: visit `https://myaccount.google.com/permissions`, revoke **BreakPoint Talent / Ace**, then sign in again. Google will re-prompt consent from scratch.

## How scope + tenant isolation works

- Every Gmail API call uses **your** refresh token — the one NextAuth stored on your `Account` row at first sign-in. There is no shared service account, no admin read, no cross-user impersonation.
- Cross-tenant isolation is a non-issue here because your Gmail account is the tenant boundary for mail reads — the Mail Tab literally cannot return messages from someone else's Gmail.
- The thread detail route (`/api/mail/threads/[id]`) looks up your user id from the session cookie before touching Gmail, so a forged thread id from a malicious client still can't read mail without a valid session for an authenticated user (and even then, only that user's own mail).

## What's rendered + what's stripped

Email HTML is sanitized server-side via `sanitize-html` before it reaches the browser:

- **Kept** — links, formatting (bold/italic/lists/tables), inline images, basic color via the legacy `<font>` tag, line breaks.
- **Stripped** — `<script>`, event handlers (`onclick`, `onload`, etc.), inline `style` attributes, and any tag/attribute outside the safe allowlist.
- Every link is forced to `target="_blank" rel="noopener noreferrer"` so clicking a link in mail never hijacks your Ace session.

Plain-text emails render inside a `<pre>` block so whitespace and line breaks are preserved exactly.

## Limits + known behavior

- **50 threads on initial load.** No pagination yet — the next ship will add "Load more" + search.
- **INBOX label only.** The list filters by `labelIds=INBOX` right now. Sent / Drafts / Starred are not in scope for this release.
- **No writes.** No mark-as-read, no reply, no forward, no delete. The next release adds a reply composer wired through `gmail.send` (which you already have).
- **Per-call auth overhead.** Each thread list call hits Google 1× for the thread index and 50× for per-thread metadata headers. That's ~50 concurrent HTTP calls per page load. Gmail's per-user rate limits are generous enough that this is fine for a single user; if it becomes a bottleneck we'll fold down to the thread-index snippet + skip per-thread metadata.

## Troubleshooting

**"Couldn't load your inbox." at the top of `/mail`.**
Almost always a missing-scope issue on the first load after this release ships. Sign out, revoke Ace at `myaccount.google.com/permissions`, sign in, re-approve the new `gmail.readonly` permission. If the error persists, check the browser network panel — the 502 body will have the underlying Gmail API error message.

**Mail item doesn't appear in the sidebar.**
Force-refresh the page (⌘ / Ctrl + Shift + R). The sidebar component is client-side and can cache across deploys until you reload.

**Thread detail shows "Couldn't load this thread."**
The thread id Gmail returned in the list call has expired or you've been signed out. Refresh `/mail` to get a fresh list.

**A message renders as a blank pane.**
The message body was either empty, or it used a mime type outside `text/html` / `text/plain` (rare — encrypted attachments, for example). The message header still renders; the body area shows `(no body content)`.

## Related features

- **Sign out / sign in** — needed once after this release to pick up the new `gmail.readonly` scope.
- **Email sending** (`gmail.send` scope) — already wired through `sendGmail()` in `src/lib/gmail.ts`; unchanged by this release.
- **Google Calendar** (`calendar.events` scope) — uses the same per-user refresh token plumbing; the interview-invite flow is unaffected.
