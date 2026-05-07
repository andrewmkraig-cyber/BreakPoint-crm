# ACE_ARCHIVE_COMPLETED.md

Long-form history archive. Started 2026-05-07 when ACE_STATE.md was trimmed to the last 3 versions (Ace 32.0, 33.0, 34.0) and ACE_ROADMAP.md was trimmed to completed history back to Ace 30.0. Everything older than those cutoffs lives here verbatim.

---

## ACE_STATE history (pre-Ace 32.0)

### What Shipped in Ace 31.0 (2026-05-05)
- Game Plan Phase 2 - Find Matches: Claude-powered candidate matching on job + client Game Plan surfaces, streaming NDJSON, 6-band score color system, clickable score badge with per-axis breakdown popover (title/location/experience/comp), Copy + Dismiss buttons, one-click Apply to pipeline, job picker on Client Game Plan, per-entity state scoping, CandidateMatch table in Neon, Matched tab on job pipeline page (paginated 5/page, live-refreshes), excludes already-matched candidates on re-run, Reject button on cards and Matched tab rows, pipeline candidates auto-pruned from Matched
- Job Game Plan chat: full AiWorkspace chat on /jobs/[id]
- Sticky composer: textarea + Send always visible on all three Game Plan surfaces
- Auto-scroll fix: clicking Game Plan tab no longer jumps page to bottom
- Reply composer layout: composer top 60%, quoted thread below 40%, auto-focuses on open
- Claude API rules across all 5 routes: em dashes banned, emojis banned, clean copy-paste to Gmail
- Game Plan chat bubble: green tint removed, white background in light mode
- Minimized composer tray: no longer covers Settings button
- scoreBreakdown schema fix: missing Neon column caused production crash on /jobs, fixed via db:push

### What Shipped in Ace 30.0 (2026-05-05)
- Candidate header reorder + profile tab redesign: Currently at X moved below title/location line, Profile/Game Plan/Notes tab row restyled bolder, mail label nesting indent tightened 16px to 8px per level
- Dashboard edit-and-resend invite popup: calendar icon on Upcoming Interviews opens inline popup, Client + Candidate invite forms pre-filled from live Google Calendar event, updateInterviewInvite server action patches or creates fresh event
- Square buttons + topbar restore + Post New Job: Button default flipped rounded-full to rounded-md, all pill CTAs squared across app, topbar date restored to leftmost slot + FAB moved next to search, Post New Job moved onto Active/Inactive tabs row on Jobs page
- Benefits and Agreements markdown rendering: MarkdownProse component with react-markdown + remark-gfm, Benefits + Agreements tabs render with bold headers and clean bullets
- Court Modes Palette v5: all 7 court mode CSS variable blocks replaced with finalized hex values, new tokens (border-soft, sidebar-bg, fg-dim, accent-light, accent-mid, accent-border, full badge token family)
- Smoke test selector fixes: fixed getByLabel Email collision with ComposeFAB aria-label, fixed Apply to Job button converted to Link, smoke tests 1/1 green in 39 seconds

---

## ACE_ROADMAP completed history (pre-Ace 30.0)

### Completed - Ace 29.0 (April 30, 2026)

All shipped 2026-04-30. See `docs/ace/ACE_STATE.md` for the full per-item log.

#### Game Plan / AI Workspace
- **Web search across all 5 Claude API call sites** (`web_search_20250305` tool registered on ai-workspace, mail/ai-compose, email/edit-with-claude, calls/summary, clients/new). Folds in the old standalone "Phase 3 — web search + internal blend" entry.
- Multi-block response handling fixed (was reading `content[0]` only; now walks the full block list); `max_tokens` lifted to 4096; markdown formatting instructions added to the system prompt.
- `react-markdown` + `remark-gfm` installed; chat bubbles render clickable hyperlinks. CopyButton flattens markdown links to bare URLs for SMS / iMessage paste.
- Model id normalized to `claude-sonnet-4-6` codebase-wide.
- "Email this" button on every assistant bubble — non-blocking in-app composer pre-filled with the bubble's clean HTML body.
- Email this v2: split Subject + body, drop signature; one ordered list per draft; **freshness mandate** (every external fact must be verified via web_search this turn; never hedge with "data may be old"; OMIT items that can't be verified).
- Email this v3: every click runs the bubble through `/api/ai-workspace/format-email` before opening the composer — generates Subject + `Hi <FirstName>,` body + strips recruiter-internal commentary. Recruiter no longer has to ask for a clean version.
- Game Plan card pinned to viewport (`sticky top-4`) so the textarea stays visible with a long pre-existing chat.
- Real chat-send error messages surfaced (was generic "try again"); `maxDuration` on `/api/ai-workspace` bumped 60s → 300s.
- No signoff / no signature anywhere — system prompt rule (candidate + client) + deterministic post-strip in format-email so "Best, Andrew Kraig BreakPoint Talent" can't leak into the composer (Ace appends Andrew's signature on send).

#### Quo auto-transcription / Phone tab
- `call.transcript.completed` + `call.summary.completed` webhook branches added; patched to real Quo v3 payload shape (callId at `body.object.data.object.callId`, transcript = dialogue array, summary = string array).
- Inline transcript / summary expand on call log rows + Client profile call log; truncates to 3 most recent + "Show all N calls"; redundant Generate Summary button removed.
- **Outbound call routing fixed** — replaced broken /call API (OpenPhone has no outbound call API) with a Quo deep link via `tel:` so Call buttons open Quo Desktop, not the Quo web app in a new tab.
- SMS send fix + call debug logging; wire Quo outbound call from the dialer; surface unknown-number activity with Add to Ace action.
- Quo connector trusts recent webhook activity over `/v1/webhooks` list endpoint.

#### Resume
- **Generate Resume button** on candidate profiles with no resume on file: pulls profile data, sends to Claude, renders professional HTML-to-PDF layout via `react-pdf/renderer`, saves as `CandidateResume` row with `displayName: "AI Generated"`.
- Plain-text PDF replaced with the professional HTML-to-PDF layout.
- Inline rename for the selected resume version + matching delete buttons (closes the Ace 25.0 click-to-rename regression).

#### Mail / composer
- Email body on forced-white card so dark Court Modes stay readable.
- Body spacing tightened to match Gmail; card softened to cream; TopBar FAB and avatar bumped to 40px.
- Floating thread window: GPU-composited drag + CSS containment for resize; smoother drag and narrow-width layout.
- Mail thread popup: consolidated chrome, tighter composer, more messages visible; body-first layout, tighter header, no nested card.
- Mail thread: "Open client" button when sender resolves to a CRM Client.
- Non-blocking composer pop-out + new icon, smart Reply All, white email cards.
- Inline composer: sticky footer + `max-h-[55vh]` so Send is always visible; carry-over text + save draft + delete.
- Mail compose: keep job-select chevron visible at narrow widths (`min-w-0` on select).

#### Court Mode / themes
- Grass Court Light: surfaces shifted to actual green tints (was reading off-white).
- Clay Light + Grass Light: white surfaces, accents only.
- Light-mode tints deepened so Hard, Clay, Grass read distinctly side-by-side.

#### Settings
- Connectors panel — Quo, Gmail, Calendar status visible at a glance; mail / phone banners surface when those connectors aren't live.
- Notification sound dropdowns + bold notification-style headers.
- Real Quo webhook check; Settings tab order tweaked; tennis-ball bounce affordance.

#### App shell / UI polish
- Sidebar resize-handle vertical seam killed; handle bg matches chrome only in top `h-24`.
- Ace logo links back to /dashboard.
- Distinct colors for Keep (teal), Offer (purple), Un-reject (indigo).
- Target / Send icons on Apply to Job + Submit to different job buttons.

#### Clients / Pipeline / Candidates
- Delete-client flow added (mirrors delete-candidate); button: quieter default, more breathing room.
- Client contacts: phone extension field.
- Client Notes tab: inline Add note instead of pointing at the topbar `+`.
- Pipeline: "Back to <client>" link when arriving from a client profile.
- LinkedIn URLs: normalize bare slugs into full hrefs on save and render.
- Candidate delete shipped.

### Completed - Ace 27.0 (April 28, 2026)

All shipped 2026-04-28. See `docs/ace/ACE_STATE.md` for the full per-item log.

- Toast fixes (MessageSquare → Phone, dropped "· Text" label, Reply button contrast lifted across themes), Compose FAB hidden on /settings, ALL CAPS subtitle leak fixed, Settings Appearance two-column layout — all six 26.0 carry-overs closed.
- Mail thread HTML rendering fix — sanitizer now preserves email-layout style attrs + table cell attrs; allowedStyles whitelists a layout-only subset; img.onerror handlers collapse failed remote images so broken CDN banners stop reserving empty rectangles.
- /mail full revamp — three-pane CSS-grid + drag handles + width persistence (ace-mail-column-widths); AppShell sidebar drag-resize + persistence (ace-sidebar-width); Inbox card slimmed; label list spacing + font weight bumped; synthetic parent labels match real labels' weight; "Communications" header renamed to "Inbox"; page-header "Compose new email" button matches /jobs / /candidates / /clients style; sidebar/content gap tightened across the app.
- Multi-message thread dropdown + per-message Reply / Reply All / Forward buttons. Composer state resets on detail.id change.
- Gmail label creation from Ace — standalone "+ New label" entry in labels sidebar AND "New label…" inside Move To dropdown. Both sync via /api/mail/labels (gmail.modify scope).
- CC + BCC fixes — removed the "+ Contact" picker that was overlaying CC + Subject rows and eating clicks; typeahead now folds in pickerOptions.
- /phone full revamp — dial pad replaces empty state (clickable + keyboard input, US-formatted display, Call + Text dispatch); FAB phone search offers an "ad-hoc number" row when ≥7 typed digits don't match a saved contact; notes person-search rebuilt (multi-token AND across firstName / lastName / email / phone); Quick Note placeholder reworded to "Search in Ace".
- TopBar avatar contact-card dropdown (email / work number / LinkedIn URL with copy buttons); standalone name + email block + sign-out button removed.
- Candidate page UX sweep, Job page additional polish, Client page FAB prefill fix, Experience auto-summary, DOCX resume preview.
- Design system rebuild + branding refresh.
- Stage tag on templates; merged bracket + double-curly merge field styles; city / state comma formatting fix; dead Anthropic model id replaced with claude-sonnet-4-6.
- **Night Court mode** — fourth Court Mode; charcoal surface, brand green as accent only; Settings picker rebuilt as card grid with two-tone swatches and accent dot on Night.
- **Favicon + brand mark revamp** — Serve Arc lockup; full favicon set; Playfair 22px wordmark with italic "by BreakPoint Talent" subline that recolors per surface (lifted on grass for legibility).
- Sidebar bottom-left "BreakPoint Talent / Solon, OH · Est. 2026" footer removed.
- Dashboard left padding fixed (dropped legacy -mx-2 / md:-mx-4 so it inherits the same gutter as every other page).

### Completed - Ace 26.0 (April 28, 2026)

All shipped 2026-04-28. See docs/ace/ACE_STATE.md for the full per-item log.

- canonicalStage root cause fix: client card counters for pending_start and cancelled now read Neon Placement.stage instead of leaking through RF stage_name.
- Stage chip label leak fixed: RF JobActionRow no longer renders RF payload's stage_name in the StageBadge label; label derives off Placement.stage.
- Clickable job counter pills on client detail — each per-stage pill is a Link to /pipeline filtered by client + stage.
- Email Threads raw ID section removed from client detail (matches the same removal on candidate profiles in 25.0).
- Reject button restored on candidate profile job rows (Submitted / Interviewing / Offer / Pending Start).
- Reject button added to /pipeline view rows for Submitted + Interviewing stages.
- Schedule Interview button on Submitted pipeline rows.
- Offer button on Interviewing pipeline rows.
- Clients page full redesign: ClientLogo, PipelinePill, grid-vs-list toggle, per-client stage counters, sort + filter row.
- Unnamed RF stub client deleted (legacyRfId 24).
- Phone Tab Phase 3:
  - Auto-tagging on every inbound + outbound SMS / call — matches against Candidate.phone (last 10 digits) AND Contact.phoneNumbers; SmsMessage.candidateId / CallLog.candidateId / clientId stamped on the write path.
  - Open Profile button on /phone thread header navigates to the matched candidate or client.
  - Read tracking via SmsMessage.isRead — sidebar Phone unread badge + thread-list "Needs reply" count both read this field.
  - Global header search expanded to email + phone in addition to name.
- Notification toast redesign: Subtle / Tint / Ink styles, court-token bound, shared ActionChip + DismissBtn components.
- Settings notifications section: NotifStylePicker with three style cards, Try-it buttons that emit a sample toast, Quiet hours toggle. localStorage-backed so the picker takes effect on the next toast.
- CLAUDE.md created at repo root — permanent project-brain rules file, auto-loaded every Code session.
- Calendar Tab added to Week 3 roadmap (see Week 3 section below).
- Jobs page: salary range column + condensed Apply-to-Job dropdown (shipped mid-session).

### Completed - Ace 25.0 (Candidate profile redesign + Quo SMS fixes)

All shipped 2026-04-27. See docs/ace/ACE_STATE.md for the full per-item log.

- Quo SMS: dead krispcall.ts deleted, webhook moved to /api/quo/webhook (provider URL must be updated), error message updated, SmsMessage candidateId fix + 2-row backfill
- Quo deep link: GET /api/quo/conversation route + "Quo" button on SMS composer and Phone tab thread header
- Candidate profile full redesign across both RF and Ace-native paths: avatar header with three actions (Add to List + Apply + Submit), two-column main (resume left + Contact/Activity/Employment sidebar), Profile + Game Plan underline tabs, Skills/Experience/Education/Notes accordions, sidebar Activity card with Email/Call/Text sub-tabs replacing the old Activity top-level tab
- Pipeline rows: compact divide-y list inside a single rounded card, briefcase + title + · company + StageBadge on the left, actions on the right, ~36px row height
- Stage chip colors unified across /pipeline + candidate profile + Ace local rows via stage-badge.tsx single source of truth (Submitted=emerald, Interviewing=blue, Applied=amber, Sourced=neutral, Offer/PendingStart=purple, Hired=darker emerald, Rejected/Cancelled=red, Kept=amber-100)
- Header Apply/Submit on Ace wired via ?openApply=1 / ?openSubmit=1 URL deep-links into LocalCandidateActions (new hideButtons prop suppresses the legacy standalone button row while modals stay mounted)
- TextingExchanges: 256px scroll cap with auto-scroll to latest
- Email Threads raw-id list removed (TODO until auto-tagging surfaces subject + preview)

### Ace 24.0 — Phone Tab build (Phase 1 + 2 SHIPPED)

#### Phase 1 - Foundation [SHIPPED]
1. New /phone page in the main nav. Two-pane layout similar to /mail. — SHIPPED
2. Call log pulled from Quo (formerly Krispcall) - timestamp, direction, candidate/client match, duration, status. — SHIPPED
3. SMS threads from Quo - one thread per phone number, message history, ordered by most recent activity. — SHIPPED
4. Match every call + SMS thread to a Candidate or Contact by phone number lookup. Unmatched ones surface in an "Unknown" bucket. — SHIPPED in 26.0 (auto-tagging on the write path).
5. Read paths only in Phase 1 - no inbound notifications or reply UI yet. — SHIPPED

#### Phase 2 - Inbound notifications + click-to-call [SHIPPED]
1. New Text + Call panels triggered from FAB; POST /api/sms wired through. — SHIPPED
2. Schema migration adding organizationId + clientId to SmsMessage / CallLog. — SHIPPED
3. Click-to-call entry points exist on candidate profile + Phone tab. Outbound call API wiring SHIPPED 29.0 (Quo Desktop deep link via `tel:`).

#### Phase 3 - Auto-tagging, read tracking, search, toasts [SHIPPED 26.0]

All four items shipped:
1. Auto-tagging — write-path stamps candidateId / clientId on every inbound + outbound SMS / call. Open Profile button on /phone thread header navigates to the match.
2. Read tracking via SmsMessage.isRead. Sidebar Phone unread badge + thread-list "Needs reply" count both read this field.
3. Incoming SMS toast (Subtle / Tint / Ink chrome). Incoming call toast still TBD — see "In Progress / Needs Fix" at top.
4. Global header search expanded to email + phone in addition to name (lighter-weight than the dedicated /phone search box originally specced; full-text search on body remains backlog).

### Completed - Ace 23.0 (Mail Tab batch)

All five items from the original 23.0 plan shipped. See docs/ace/ACE_STATE.md for the full list with implementation notes.

1. Auto-tagging emails to candidate/client profiles - SHIPPED (GmailThreadTag table, tagThreadByAddresses on send + read, Email Threads card on Ace-native AND RF-imported candidate paths + Client overview).
2. BCC Austin auto-populate - SHIPPED (BCC autocomplete dropdown sourced from OrganizationMembership, Austin row inserted directly to Neon).
3. Click-to-add dropdown bug - SHIPPED (moved pick() from onClick to onMouseDown.preventDefault, single-click selection lands cleanly).
4. Mail tab sent view - SHIPPED (Sent + Drafts shortcuts in the new sidebar; both feed the same thread refetch with labelIds=SENT or =DRAFT).
5. Sent emails appearing in candidate/client activity - SHIPPED (auto-tag fires on send/reply too; Email Threads card surfaces them on the relevant profile).

Bonus 23.0 ships not on the original list:
- Mail sidebar redesign (premium Inbox card, nested labels, search, refresh, drag-and-drop)
- Pop-out floating thread window (drag, resize, full reply/archive/move support)
- Tennis ball "Ace" favicon + brand mark
- Global Compose FAB with non-blocking mode
- Mail toast auto-dismisses when the user opens the thread
- Compact uniform notifications with Phone icon for SMS/call

### Ace 18.0 - Composer UX + Templates + Mail Tab Polish + Interview Scheduling Overhaul

Picks up the 13 backlog items from Ace 17.0 plus the Interview Scheduling Overhaul. See ACE_ROADMAP.md history for the full prompt-by-prompt breakdown.

Highlights shipped under 18.0 + carryovers:
- 5A.1 / 5A.2 composer UX overhaul: drag/resize/minimize popup composer; dual-format merge field parser; smart context resolution.
- 5A.3 candidates page pagination (25/page).
- 5A.4 Lists feature: schema migration + UI + lists management page.
- 5B template rebuild in {{}} format (Submittal Confirmation, Application Received, Acceptance of Offer).
- Prompt 6 CC/BCC autocomplete.
- Prompt 7 Mail Tab polish + bidirectional read sync (closed under 22.0 + 23.0).
- Prompt 8 auto-tagging emails to profiles (closed under 23.0).
- Prompts 9-13 Interview Scheduling Overhaul (form UI revisions, submission flow, profile layout reorg, template library enhancements; Stage-Triggered Template Actions System killed).

---

## Deprecated backlog (pruned 2026-05-07 during ACE_ROADMAP rewrite)

Items that lived in the pre-Ace 34.0 ACE_ROADMAP backlog but are not in the new active list. Preserved here so nothing is permanently lost — recover into the active list if priorities shift.

- **LinkedIn Chrome extension** — browser extension to push profiles into Ace.
- **Job board aggregator integration** — Indeed Direct Phase 1, Appcast syndication Phase 2. Was queued behind the Jobs page command center; superseded by the Promote tab + JobBoardStatus model in Ace 34.0.
- **Google Drive backup to "ACE Database" shared drive** — periodic export of candidate / client / placement data to a shared Drive folder for Andrew + Austin.
- **Remote shipping from mobile** — voice / text → background Claude Code agent that can ship code without a laptop.
- **Client Strategy tab** — Claude chat workspace per client (overlaps with the existing Game Plan + Ace Assistant Panel; absorb into Ace Assistant Phase 4 if needed).
- **Resume parser improvements** — 5-10 test resumes to tune the parser's edge cases.
- **Ringover / Quo in-app notifications** — webhook toasts on incoming call. Incoming-SMS toast already shipped Ace 26.0; incoming-call toast remained TBD.
- **Cosmetic polish batch** — any visual polish surfaced during 18.0 testing not absorbed by the Court Modes palette v5 sweep (Ace 30.0).
- **Template Library Enhancements** — stage tag, default attachments per template, {{interview.*}} merge fields. Side-tag (candidate-facing vs client-facing) explicitly killed.
- **Candidate Profile Redesign (Jobot-style)** — three-column layout with applied jobs table + match % + stage action button row. Active list now references this as Deferred #47 ("Candidate profile full redesign — revisit if recruiter feedback warrants").
