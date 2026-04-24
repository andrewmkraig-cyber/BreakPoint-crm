# Mail Tab — inbox, archive, and reply composer

Updated in Phase 6.1. The Mail Tab now handles read, archive, and full rich-text reply — a usable two-way inbox inside Ace.

## What it does

- **Inbox list** — left rail on `/mail` shows your 50 most recent Gmail threads. For each thread you see the sender name, the subject, a one-line snippet, and a relative timestamp (`12m`, `3h`, `2d`). **Hover a row** and an archive icon appears on the right edge — one click archives that thread without opening it.
- **Thread detail** — clicking a thread opens the full conversation on the right pane. **Newest message is at the top**, older replies below. Each message shows sender, recipients, and timestamp. The top bar has **Reply** and **Archive** buttons.
- **Archive** — removes the `INBOX` label on Gmail (native archive). The thread disappears from Ace's inbox list immediately; it's still searchable in Gmail via All Mail or any label you kept. A "Archived" toast confirms.
- **Reply composer** — inline, slides in below the thread messages.
  - **To** pre-filled with the sender of the most recent inbound message. **CC** and **BCC** start collapsed; click `+ CC` / `+ BCC` to show.
  - **Subject** pre-filled with `Re: ...` (skipped if the thread subject already starts with `Re:`).
  - **Rich text body**: Bold, Italic, Underline, Bulleted list, Numbered list, Link. Keyboard shortcuts work (⌘/Ctrl + B, I, U).
  - **Paste images inline** — screenshot → ⌘/Ctrl + V straight into the body; the image embeds as a `data:` URL so it renders in Gmail / Apple Mail / Outlook.
  - **Attachments** — click **Attach** or drag files onto the body. PDF, DOC/DOCX, and any image type are accepted. Each attachment shows filename + size with a remove button.
  - **Use Template** — the first button in the composer add-on toolbar. Opens a dropdown listing every active template from Settings → Templates. Click one; its subject + body drop into the composer (confirmation prompt if you already started typing).
  - **Insert Field** — the second toolbar button. Drops a handlebars-style merge tag at the caret of whichever input was last focused (Subject or Body). 14 tags available — see the field list below.
  - **Generate with Claude** — the sparkly third button. Opens a small textarea; describe what you want to say ("tell Linda her interview moved to Monday and apologize for the late notice") and Claude writes the body for you, with the current thread as context. Replaces whatever is in the body (with a confirm prompt if you already started typing). Signature auto-appends on send; Claude never writes one.
  - **Threading** — Gmail threads replies via `threadId`; we also set `In-Reply-To` and `References` headers so external clients thread them too.
  - **Signature** — the full Gmail-style signature block is auto-appended (logo + name + title + email/phone/website rows with green-circle icons). Edit the pieces in **Settings → Branding & Signature**.
  - **Default To** — the composer pre-fills **To** with the "other party" on the latest message: if you sent that message, the To recipients get it (minus you); if someone else sent it, the reply goes back to them. Your own email address never auto-fills into To or CC.
  - After the reply sends, the composer closes, the thread detail re-fetches, and the sent message appears at the top.

### Merge fields (Insert Field dropdown)

Tags use handlebars-style `{{dot.path}}` form. On send, every tag is resolved against the composer's context — if a tag can't be resolved (missing context branch, empty value), the composer shows a confirm prompt listing the unresolved tags before sending. The Mail Tab today always has your user context available (so `{{user.first_name}}` and `{{user.full_name}}` always resolve), but candidate/job/client context is populated when the composer is opened from an entity profile (that wiring lands in a future release).

| Tag | What it inserts |
|---|---|
| `{{candidate.first_name}}` | Candidate's first name |
| `{{candidate.last_name}}` | Candidate's last name |
| `{{candidate.full_name}}` | `First Last` (or `First` if no last) |
| `{{candidate.email}}` | Candidate email |
| `{{candidate.current_title}}` | Candidate's current job title |
| `{{candidate.current_company}}` | Candidate's current employer |
| `{{job.title}}` | Job title you're filling |
| `{{job.client_name}}` | Client company on the job |
| `{{job.city}}` / `{{job.state}}` | Job location parts |
| `{{job.description}}` | Full job description text (long — insert then edit down) |
| `{{client.name}}` | Client company name |
| `{{client.primary_contact_first_name}}` | Main contact at the client |
| `{{user.first_name}}` / `{{user.full_name}}` | Your name (from Branding settings) |

Templates stored in Settings → Templates can mix the two conventions; the Mail Tab only resolves `{{dot.path}}` tags, while the legacy `[Square Bracket]` tokens pass through untouched. Update any old templates you want Mail Tab to resolve to the new convention.

## Click-to-email popup (Phase 6.4)

Every email address across Ace is a click → full Mail composer popup now (no more `mailto:` handoff to external Gmail). The popup is the **same composer** as `/mail`, opened as a centered modal over whatever page you were on. Same rich text, same attachments, same inline-image paste, same templates, same Insert Field picker, same Claude Generate — and the signature always appends.

Click-to-email surfaces + the merge context they pass:

| Surface | Context included |
|---|---|
| Candidate profile sidebar / editable contact | `candidate.*` (name, email, title, company) |
| Client profile contacts tab | `client.name`, `client.primary_contact_first_name` |
| Pipeline placement row (billing contact) | `candidate.first_name`, `client.name`, `client.primary_contact_first_name`, `job.title` |
| Anywhere else the email renders | `user.*` always; other tags stay literal + warn on send |

The popup closes on the X button, the Cancel-adjacent close, or a click outside the composer panel.
- **Sidebar nav entry** — **Mail** item in the left sidebar routes to `/mail`.

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

## First-time setup — scopes + re-sign-in

The Mail Tab uses four Gmail-adjacent OAuth scopes. Two are new in Phase 6.1:

| Scope | Purpose | Added in |
|---|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | List + read threads | Phase 6.0 |
| `https://www.googleapis.com/auth/gmail.send` | Send replies, submittal emails | original |
| `https://www.googleapis.com/auth/gmail.modify` | Archive (remove `INBOX` label) | Phase 6.1 |
| `https://www.googleapis.com/auth/calendar.events` | Interview invites | original |

### Google Cloud Console — one-time config

For the app to request these scopes at consent, each has to be listed on the **Data Access** page of the OAuth consent screen in Google Cloud Console:

1. Go to https://console.cloud.google.com/apis/credentials/consent for the `BreakPoint Talent / Ace` project.
2. Click **Data Access** in the sidebar.
3. Click **Add or remove scopes**.
4. Confirm these scopes are checked (or add them):
   - `.../auth/gmail.readonly`
   - `.../auth/gmail.send`
   - `.../auth/gmail.modify`
   - `.../auth/calendar.events`
5. Save. Google will show a "changes saved" banner. No app verification review needed for internal-user apps.

### Re-sign-in on each user's end

Once the scope is listed on the consent screen, each user needs to sign out and back in once so Google re-issues a refresh token with the updated scope set:

1. Click your avatar / sign-out link.
2. Sign in again with Google. The consent screen will show new permissions — including "Send email on your behalf" and "Manage drafts and send emails" / "View and modify but not delete your email." Approve.
3. `/mail` now lets you archive + reply.

If the consent screen doesn't show new permissions (Google may be using a cached grant), visit `https://myaccount.google.com/permissions`, revoke **BreakPoint Talent / Ace**, then sign in fresh.

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
- **INBOX label only.** The list filters by `labelIds=INBOX` right now. Sent / Drafts / Starred are not surfaced in the left rail.
- **Archive is soft.** Archive removes the `INBOX` label only. Your messages stay in Gmail All Mail and in any label you've kept. To un-archive, re-apply the `Inbox` label from Gmail directly.
- **Inline pasted images travel as base64 `data:` URLs.** Gmail, Apple Mail, and Outlook all render them. A handful of mobile / webmail clients strip them silently; if someone reports "I don't see the screenshot," resend with a real attachment.
- **No mark-as-read yet.** Opening a thread inside Ace does not clear the UNREAD label; the bold treatment in the list is driven by Gmail's unread state. The next Mail ship will add mark-as-read on open.
- **Per-call auth overhead.** The thread list call hits Google 1× for the thread index and 50× for per-thread metadata headers. That's ~50 concurrent HTTP calls per page load. Gmail's per-user rate limits are generous enough for single-user traffic; if it becomes a bottleneck we'll fold to the thread-index snippet + skip per-thread metadata.

## Troubleshooting

**"Couldn't load your inbox." at the top of `/mail`.**
Almost always a missing-scope issue on the first load after a release. Sign out, revoke Ace at `myaccount.google.com/permissions`, sign in, re-approve the permissions. If the error persists, check the browser network panel — the 502 body will have the underlying Gmail API error message.

**"Couldn't archive" toast, or "Couldn't send reply."**
Same missing-scope story but for `gmail.modify` (archive) or `gmail.send` (reply). The scope you need is named in the toast description. Confirm it's on the Data Access consent screen in Google Cloud, then sign out + in again.

**Mail item doesn't appear in the sidebar.**
Force-refresh the page (⌘ / Ctrl + Shift + R). The sidebar component is client-side and can cache across deploys until you reload.

**Thread detail shows "Couldn't load this thread."**
The thread id Gmail returned in the list call has expired or you've been signed out. Refresh `/mail` to get a fresh list.

**A message renders as a blank pane.**
The message body was either empty, or it used a mime type outside `text/html` / `text/plain` (rare — encrypted attachments, for example). The message header still renders; the body area shows `(no body content)`.

**Sent reply doesn't appear at the top of the thread.**
The thread refreshes automatically after Send, but if Gmail hasn't finished indexing the outbound message it may take 1–2 seconds. Refresh `/mail` if you want to be certain.

## Related features

- **Sign out / sign in** — needed once after this release to pick up the new `gmail.readonly` scope.
- **Email sending** (`gmail.send` scope) — already wired through `sendGmail()` in `src/lib/gmail.ts`; unchanged by this release.
- **Google Calendar** (`calendar.events` scope) — uses the same per-user refresh token plumbing; the interview-invite flow is unaffected.
