# Ace Roadmap

## Completed - Ace 33.1 polish (May 6, 2026)

- Candidate profile job bar restructured to Submit / Schedule Interview / Reject (Schedule renamed; Client Sending Invite gated to Submitted/Interviewing only; Reject added at Applied stage).
- Candidate-level resume action row (Add to List / Keep / Apply to Job / Add Note) lifted out of the sticky toolbar and parked above the resume header. Submit-to-different-job button retired.
- New candidate-level toggleCandidateKept action + KeepCandidateButton component (writes Candidate.tags + mirrors raw.tags).

## In Progress / Needs Fix (top priority — Ace 33.0 candidate)

Ace 32.0 closed clean (May 5, 2026, last SHA 2e2faac). Game Plan Phase 3 live (last 5 tagged emails injected into the ai-workspace prompt for both candidate and client/job context, silent degrade on miss). Email history surfaces shipped on candidate Activity tab + client Email tab (shared TaggedThreadList opens the floating viewer). Personal Trainer rules engine live: PersonalTrainerRule schema + 15 default rules + Settings UI (Trainer / Rules sub-tabs) + GitHub sync to docs/ace/PERSONAL_TRAINER.md on every mutation + buildPersonalTrainerBlock injected into every Claude system prompt across Ace. Settings refactored to left-nav + per-category page layout (Appearance, Notifications, Personal Trainer, Branding, Templates, Triggers, Connectors); Email Preferences tab dropped; Templates split Active / Inactive; Triggers on its own page; Branding renders a server-rendered signature preview. Quo connector status simplified to "API key valid → connected" pending setup-wizard. Phone unread-badge regression fixed (markThreadRead now parses cand: / unk: id prefixes). New Text/Call button on the Phone page header so the dial pad is reachable from any thread. Open issues for 33.0:

- (none open — Ace 32.0 closed clean)

## Ace 33.0 — Next up

**Claude Panel (Phase 5) — Full Spec.** Persistent floating Claude chat inside Ace with web search, Personal Trainer rules, and full Ace data access. Three sequenced phases below; all three live in the same panel, web search available across all phases, conversation history sent with every message for full context.

### Phase 1 — Shell + persistence
- Claude logo icon in topbar next to the `+` and txt/call buttons. Icon color matches active Court Mode using CSS tokens (green on Hard, clay tone on Clay, grass tone on Grass, etc.).
- Click opens a floating, draggable, resizable panel — same behavior as the floating mail thread viewer.
- Panel persists across all pages — clicking around Ace does not close it.
- Minimize keeps the conversation alive; reopens exactly where left off.
- Conversation saved to Neon per session — persists across browser sessions.
- New `/api/claude-panel` route with web search + Personal Trainer rules injected.
- When a conversation gets long, Ace prompts: "This chat is getting long — start a new one?"
- Before clearing, the user can save — Ace generates a summary and stores it.

### Phase 2 — Ace data access (read)
- Tool calls wired to live Neon: search candidates, look up jobs / clients / pipeline stages / placements.
- Claude can answer "who is interviewing at Sheehan Brothers" or "find tax managers in Ohio" from live data.
- Web search remains available for external questions in the same conversation.

### Phase 3 — Actions + Claude History
- Claude can propose actions: move a candidate to a stage, send an email, add a note.
- Every proposed action shows a confirm / edit / cancel UI before executing — nothing fires without Andrew approval.
- Claude History tab in Settings: saved past conversations with AI-generated summaries, clickable to review old context.
- Claude can audit and manage Personal Trainer rules via the same server actions (propose changes, Andrew confirms).

After Claude Panel ships, the queue continues:

1. **Game Plan Phase 4** — "My Writing Style" setting in /settings, injected into every Claude API call across Ace (submittals, JDs, email generation, Game Plan).
2. **Game Plan context depth** — Send full resume text + full JD text into the ai-workspace prompt so Claude reasons against the actual content, not just metadata.

## Completed - Ace 32.0 (May 5, 2026)

All shipped 2026-05-05. Last SHA 2e2faac. See `docs/ace/ACE_STATE.md` for the full per-item log.

### Game Plan Phase 3 — email context
- `getRecentTaggedEmails` helper added to `src/lib/gmail.ts` (parallel `format=metadata` fetch, subject / from / snippet extraction, 400-char truncation, silent fail per thread).
- `/api/ai-workspace` resolves `GmailThreadTag` by `candidateId` or `clientId` (org-scoped, 5 most recent), pulls the user's Gmail access token, and injects a "Recent Email Context" block into the system prompt before formatting rules.
- Job Game Plan inherits client email context automatically via the job's `clientId`.
- Silent degrade if no threads / no Gmail scope / fetch fails.

### Email history UI — candidate Activity tab + client Email tab
- `candidate-activity-card.tsx` swapped the "Email history coming soon" placeholder for `TaggedThreadList`. Fetches `GET /api/candidates/[id]/email-threads`, opens the floating thread viewer on click.
- New routes `GET /api/candidates/[id]/email-threads` + `GET /api/clients/[id]/email-threads`. Org-scoped, deduped by `threadId`, enriched via `listTaggedThreadSummaries` (Gmail `format=metadata`).
- New **Email** tab on client profiles after the existing tabs.
- Shared `TaggedThreadList` component at `src/components/mail/tagged-thread-list.tsx` — skeleton loading, empty state, opens the floating viewer via `useFloatingThread().open()`. Pagination at 5 rows per page.
- Sort by latest email date.

### Personal Trainer
- New `PersonalTrainerRule` model in `prisma/schema.prisma` (`id`, `organizationId`, `text`, `createdAt`, `updatedAt`, indexed on `(organizationId, createdAt)`). `prisma db push` ran clean.
- `src/lib/personal-trainer-seed.ts` — 15 default rules extracted from all 5 Claude routes (no em dashes, no emojis, no signoff, freshness mandate, no fabrication, no code fences, no preamble, merge-field preservation, no greeting invention, write-like-a-real-recruiter, paste-ready, no bold in outreach, bullets only when format calls for it, hyphen bullets for lists, descriptive link text).
- `src/app/settings/personal-trainer-actions.ts` — `seedDefaultRules`, `getRules`, `addRule`, `updateRule`, `deleteRule`. Mutations fire `syncToGitHub` (silent fail). Seed is idempotent.
- GitHub sync via Contents API using `GITHUB_TOKEN` env var; reads / writes `docs/ace/PERSONAL_TRAINER.md` real-time on every add / update / delete (GET 404 → PUT 201 on first run).
- `GITHUB_TOKEN` added to `.env.local`. Vercel Production + Preview env vars still need to be set for the prod sync path.
- `buildPersonalTrainerBlock(orgId)` helper in `src/lib/personal-trainer.ts` queries Neon for the org's rules, builds the numbered "PERSONAL TRAINER RULES (apply to every response without exception)" appendix, appended to the system prompt on every call across all 5 Claude routes (`/api/ai-workspace`, `/api/mail/ai-compose`, `/api/email/edit-with-claude`, `/api/calls/summary`, `/api/clients/new` actions). Hardcoded style rules removed from those routes.
- Personal Trainer UI in Settings: two sub-tabs — **Trainer** (textarea + Add Rule, seeds defaults on first load) and **Rules** (list with inline edit + delete, confirm dialog on delete, rule count in tab label).
- `docs/ace/PERSONAL_TRAINER.md` created live with the 15 seeded rules. Real-time sync confirmed via 3 live commits observed during testing.

### Settings refactor — left-nav + per-category pages
- `src/app/settings/layout.tsx` two-column shell; `src/app/settings/settings-nav.tsx` active-state nav using Court Mode tokens only (`border-court-accent`, `bg-court-surface-subtle`, `text-court-fg`).
- `/settings` redirects to `/settings/appearance`.
- Category routes: `appearance`, `notifications`, `personal-trainer`, `branding`, `templates`, `triggers`, `connectors`. Each is a server component fetching only its own data.
- Email Preferences tab removed — phone + signature owned by Branding; auto-send toggle moved to Triggers.
- Branding renders a server-rendered signature preview block at the bottom (uses `renderSignatureHtml` — same path `/reply` and `/send` use).
- Templates panel split into **Active** and **Inactive** sub-tabs (counts integrated). New-template button only on Active.
- Triggers on its own category page (auto-send candidate confirmation toggle today; built to grow).
- Quo connector status simplified to "API key valid → connected" until the setup-wizard ships.

### Phone fixes
- Phone unread-badge regression fixed — `markThreadRead` parses prefixed thread ids: `cand:<cuid>` updates by `candidateId`, `unk:<digits>` raw-SQL matches on the last-10 digits of `fromNumber`. Optimistic local clear matches by `t.id` instead of `t.candidateId`.
- New Text/Call header button at the top-right of `PhoneView` (Plus icon next to the label, same green pill style as Create-New buttons on other tabs). Opens a centered dial-pad modal reachable from any open thread. Inline empty-state DialPad disables its document keystroke listener while the modal is open.
- Global topbar version of the txt/call button NOT yet built — only the Phone-page header version landed this round.

## Completed - Ace 31.0 (May 5, 2026)

All shipped 2026-05-05. Last SHA f568e04. See `docs/ace/ACE_STATE.md` for the full per-item log.

### Game Plan Phase 2 — Internal Candidate Matching (complete)
- Find Matches button + portal-rendered streaming NDJSON panel; per-entity scoping via FindMatchesContext (state survives navigation, opens cached results on return).
- 6-band scoring tone (95+ / 90+ / 85+ / 80+ / 70+ / <70) with hardcoded brand colors identical across all six Court modes.
- Score popover with per-axis breakdown (Title Match / Location Fit / Experience Fit / Compensation Fit / Overall Summary), bold uppercase headers, portal rendering, scroll-tracked positioning, plaintext copy button.
- ScoreBadge extracted to `src/components/game-plan/score-badge.tsx`; clickable everywhere (Find Matches panel + /jobs/[id] Matched tab). normalizeBreakdown falls back to rationale on legacy rows.
- Dismiss-X removed; Reject button (Button variant="danger" + UserX icon) added on both panel ActionRow and pipeline MatchedRowItem — same styling as `/applicants`.
- One-click Apply via `/api/placements`. Auto-dismisses + bumps the per-job tick so the Matched tab refetches.
- Job picker on client-context Find Matches (`awaiting_pick` event when client has 2+ open jobs; auto-pick when single open job).
- CandidateMatch persistence (Prisma model with score + rationale + scoreBreakdown JSON; tenant-scoped; unique on (jobId, candidateId) so re-runs upsert).
- /jobs/[id] Matched tab — chip on the compact pipeline strip, paginated panel (5/page, Prev / "Page X of Y" / Next, hidden ≤5 rows, page resets to 1 on tab re-open).
- Live refresh: `notifyMatchesSaved(jobId)` ticks per-job; both badge count and tab list refetch from `GET /api/game-plan/matched-candidates?jobId=X`.
- Excludes already-matched on re-run via panel preflight `fetchExistingMatchIds`.
- Server-side exclusion of any pipelined candidate (find-matches route unions Placement candidate cuids of every stage into exclude Set after target resolution).
- Auto-prune Matched on any Placement (page fetch + matched-candidates API exclude any candidate with a Placement on the job, regardless of stage).
- /api/placements REJECTED branch added (upsert to stage=rejected); both APPLIED + REJECTED now persist `job.legacyRfId` so /applicants and pipeline find the row.

### Job Game Plan chat
- AiWorkspace mounted on `/jobs/[id]?tab=game-plan` (same `entityType="job"` workspace candidate profiles use).
- FindMatchesButton sits to the right of the JobTabs row regardless of which tab is active.
- Game Plan card pinned + auto-scroll to latest assistant bubble.

### Reply composer / floating thread
- Body-first reply layout in the floating thread popup (composer above quoted history). Inline /mail composer untouched (still pinned bottom).
- Composer body grows to ~60% of popup via `growToFill` prop; quoted-history pane drops to `basis-2/5 shrink min-h-0`. Editor body autofocus on mount.
- Composer node lifted out of JSX so the same instance moves between layout slots without unmount/remount churn.

### Sticky composer + content rules
- Em dash + emoji banned across all 5 Claude API routes. Deterministic post-strip on format-email cleans up anything that slips through.
- AI chat bubble green tint dropped; bubbles render on neutral surface with assistant accent stripe only.
- Minimized-drafts tray docks flush right of the sidebar; survives sidebar resize via the same width-persistence key the AppShell uses.

### /jobs/[id] two-column layout overhaul
- Dropped the 4 stat boxes; pipeline summary lives directly above main content as a compact chip strip.
- Two-column grid (lg:grid-cols-10): left col-7 = JobTabs (Job Description default, Game Plan via `?tab=game-plan`) + content; right col-3 = EditableJobOverview sidebar.
- Single Edit toggle on the Overview card flips every editable row at once (Compensation / Location / Openings / Status / Employment Type); single Save commits via one `updateJobOverview` call; single Cancel discards the entire draft set; one inline red banner for validation errors.
- Compensation Hourly / Salary radio toggle persisted via `salaryFrequency`; display suffixes ` / yr` or ` / hr`.
- "Contingent · Full time" subtitle dropped on /jobs listing — title alone identifies the job.

## Completed - Ace 30.0 (May 5, 2026)

All shipped 2026-05-05. Last SHA 7265ba8. See `docs/ace/ACE_STATE.md` for the full per-item log.

- **Candidate header reorder + bolder tabs** — header layout reshuffled on candidate profiles for better hierarchy; Profile / Game Plan underline tabs bolder; mail label indent tightened in the same pass.
- **Dashboard edit-and-resend invite popup** — edit invite content inline before resending instead of delete + recreate; mail label spacing tightened alongside.
- **Square buttons + topbar layout restore** — buttons squared off across the app, topbar layout restored after recent regressions, Post New Job button repositioned.
- **Benefits + Agreements rendered as markdown** — both summaries now render with bold / bullets / hyperlinks instead of leaking raw text into the UI.
- **Smoke test fixes** — unbroke the Email field collision (selector hitting two inputs) + Apply/Submit Link selectors after the topbar/buttons restore.
- **Court Modes palette v5 across all 7 modes** — full token surface refreshed, sidebar + brand rewired to v5, tinted accent per mode, purple reserved for Grass. Closes the Generate-with-Claude visibility regressions on Clay Dark + the broader dark-mode contrast work that was open at end of 29.0.

## Completed - Ace 29.0 (April 30, 2026)

All shipped 2026-04-30. See `docs/ace/ACE_STATE.md` for the full per-item log.

### Game Plan / AI Workspace
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

### Quo auto-transcription / Phone tab
- `call.transcript.completed` + `call.summary.completed` webhook branches added; patched to real Quo v3 payload shape (callId at `body.object.data.object.callId`, transcript = dialogue array, summary = string array).
- Inline transcript / summary expand on call log rows + Client profile call log; truncates to 3 most recent + "Show all N calls"; redundant Generate Summary button removed.
- **Outbound call routing fixed** — replaced broken /call API (OpenPhone has no outbound call API) with a Quo deep link via `tel:` so Call buttons open Quo Desktop, not the Quo web app in a new tab.
- SMS send fix + call debug logging; wire Quo outbound call from the dialer; surface unknown-number activity with Add to Ace action.
- Quo connector trusts recent webhook activity over `/v1/webhooks` list endpoint.

### Resume
- **Generate Resume button** on candidate profiles with no resume on file: pulls profile data, sends to Claude, renders professional HTML-to-PDF layout via `react-pdf/renderer`, saves as `CandidateResume` row with `displayName: "AI Generated"`.
- Plain-text PDF replaced with the professional HTML-to-PDF layout.
- Inline rename for the selected resume version + matching delete buttons (closes the Ace 25.0 click-to-rename regression).

### Mail / composer
- Email body on forced-white card so dark Court Modes stay readable.
- Body spacing tightened to match Gmail; card softened to cream; TopBar FAB and avatar bumped to 40px.
- Floating thread window: GPU-composited drag + CSS containment for resize; smoother drag and narrow-width layout.
- Mail thread popup: consolidated chrome, tighter composer, more messages visible; body-first layout, tighter header, no nested card.
- Mail thread: "Open client" button when sender resolves to a CRM Client.
- Non-blocking composer pop-out + new icon, smart Reply All, white email cards.
- Inline composer: sticky footer + `max-h-[55vh]` so Send is always visible; carry-over text + save draft + delete.
- Mail compose: keep job-select chevron visible at narrow widths (`min-w-0` on select).

### Court Mode / themes
- Grass Court Light: surfaces shifted to actual green tints (was reading off-white).
- Clay Light + Grass Light: white surfaces, accents only.
- Light-mode tints deepened so Hard, Clay, Grass read distinctly side-by-side.

### Settings
- Connectors panel — Quo, Gmail, Calendar status visible at a glance; mail / phone banners surface when those connectors aren't live.
- Notification sound dropdowns + bold notification-style headers.
- Real Quo webhook check; Settings tab order tweaked; tennis-ball bounce affordance.

### App shell / UI polish
- Sidebar resize-handle vertical seam killed; handle bg matches chrome only in top `h-24`.
- Ace logo links back to /dashboard.
- Distinct colors for Keep (teal), Offer (purple), Un-reject (indigo).
- Target / Send icons on Apply to Job + Submit to different job buttons.

### Clients / Pipeline / Candidates
- Delete-client flow added (mirrors delete-candidate); button: quieter default, more breathing room.
- Client contacts: phone extension field.
- Client Notes tab: inline Add note instead of pointing at the topbar `+`.
- Pipeline: "Back to <client>" link when arriving from a client profile.
- LinkedIn URLs: normalize bare slugs into full hrefs on save and render.
- Candidate delete shipped.

## Completed - Ace 27.0 (April 28, 2026)

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

## Completed - Ace 26.0 (April 28, 2026)

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

## Completed - Ace 25.0 (Candidate profile redesign + Quo SMS fixes)

All shipped 2026-04-27. See docs/ace/ACE_STATE.md for the full per-item log.

- Quo SMS: dead krispcall.ts deleted, webhook moved to /api/quo/webhook (provider URL must be updated), error message updated, SmsMessage candidateId fix + 2-row backfill
- Quo deep link: GET /api/quo/conversation route + "Quo" button on SMS composer and Phone tab thread header
- Candidate profile full redesign across both RF and Ace-native paths: avatar header with three actions (Add to List + Apply + Submit), two-column main (resume left + Contact/Activity/Employment sidebar), Profile + Game Plan underline tabs, Skills/Experience/Education/Notes accordions, sidebar Activity card with Email/Call/Text sub-tabs replacing the old Activity top-level tab
- Pipeline rows: compact divide-y list inside a single rounded card, briefcase + title + · company + StageBadge on the left, actions on the right, ~36px row height
- Stage chip colors unified across /pipeline + candidate profile + Ace local rows via stage-badge.tsx single source of truth (Submitted=emerald, Interviewing=blue, Applied=amber, Sourced=neutral, Offer/PendingStart=purple, Hired=darker emerald, Rejected/Cancelled=red, Kept=amber-100)
- Header Apply/Submit on Ace wired via ?openApply=1 / ?openSubmit=1 URL deep-links into LocalCandidateActions (new hideButtons prop suppresses the legacy standalone button row while modals stay mounted)
- TextingExchanges: 256px scroll cap with auto-scroll to latest
- Email Threads raw-id list removed (TODO until auto-tagging surfaces subject + preview)

## Ace 24.0 — Phone Tab build (Phase 1 + 2 SHIPPED)

### Phase 1 - Foundation [SHIPPED]
1. New /phone page in the main nav. Two-pane layout similar to /mail. — SHIPPED
2. Call log pulled from Quo (formerly Krispcall) - timestamp, direction, candidate/client match, duration, status. — SHIPPED
3. SMS threads from Quo - one thread per phone number, message history, ordered by most recent activity. — SHIPPED
4. Match every call + SMS thread to a Candidate or Contact by phone number lookup. Unmatched ones surface in an "Unknown" bucket. — SHIPPED in 26.0 (auto-tagging on the write path).
5. Read paths only in Phase 1 - no inbound notifications or reply UI yet. — SHIPPED

### Phase 2 - Inbound notifications + click-to-call [SHIPPED]
1. New Text + Call panels triggered from FAB; POST /api/sms wired through. — SHIPPED
2. Schema migration adding organizationId + clientId to SmsMessage / CallLog. — SHIPPED
3. Click-to-call entry points exist on candidate profile + Phone tab. Outbound call API wiring SHIPPED 29.0 (Quo Desktop deep link via `tel:`).

### Phase 3 - Auto-tagging, read tracking, search, toasts [SHIPPED 26.0]

All four items shipped:
1. Auto-tagging — write-path stamps candidateId / clientId on every inbound + outbound SMS / call. Open Profile button on /phone thread header navigates to the match.
2. Read tracking via SmsMessage.isRead. Sidebar Phone unread badge + thread-list "Needs reply" count both read this field.
3. Incoming SMS toast (Subtle / Tint / Ink chrome). Incoming call toast still TBD — see "In Progress / Needs Fix" at top.
4. Global header search expanded to email + phone in addition to name (lighter-weight than the dedicated /phone search box originally specced; full-text search on body remains backlog).

## Future — Multi-recruiter permissions

Originally slotted as Ace 25.0 but deferred. Carry these items forward.

1. Schema additions: ownerId on Client and Job (nullable, FK to User). Existing rows backfilled to Andrew. Permission rules: a recruiter sees clients/jobs they own + any explicitly shared with them.
2. Shared candidates - many-to-many join (CandidateAccessGrant?) so candidates can be shared across recruiters without duplicating rows. Grant types: read, edit.
3. Invite flow in /settings - "Invite recruiter" form: email + name + role (admin / recruiter). Sends a magic-link sign-up email; new user lands in BreakPoint Talent org with role=member. Reuses existing OrganizationMembership table.
4. Settings → "Manage team" page - list of org members, role chips, "Resend invite" / "Revoke access" buttons.
5. Per-row permission checks on every server action that reads or writes Client / Job / Candidate when ownerId or share grant doesn't match the current user.

## Completed - Ace 23.0 (Mail Tab batch)

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

## Ace 18.0 - Composer UX + Templates + Mail Tab Polish + Interview Scheduling Overhaul

Picks up the 13 backlog items from Ace 17.0 plus the Interview Scheduling Overhaul. Estimated 8-10 atomic prompts.

### Order of Execution (prompts numbered)

#### Prompt 5A - Composer UX overhaul (resumes Ace 17.0 work) [SHIPPED in 5A.1, 5A.1-fix, 5A.2, 5A.2-fix]
1. Stop closing modal on backdrop click. Only X button closes. [SHIPPED 5A.1]
2. Drag and resize popup composer (Gmail-style). User can drag the title bar to reposition, drag corners to resize. [SHIPPED 5A.1]
3. Minimize button + bottom-of-screen tray. Minimized drafts show as small horizontal pills at the bottom of the Ace viewport. Click to restore. Multiple drafts can be minimized simultaneously. [SHIPPED 5A.1]
4. Dual-format merge field parser. Both [Bracket Format] and {{double.curly}} syntaxes resolve to the same data. Existing field map covers both forms. Insert Field dropdown defaults to inserting {{}} but parser handles both for backward compatibility with RF-imported templates. [SHIPPED 5A.2]
5. Smart context resolution. When popup opens from a candidate profile: if candidate has 1 active applied job, auto-load that job + its client as context. If 2+, show a small "Which job is this email about?" dropdown above the composer body. User picks, context loads, all merge fields resolve. [SHIPPED 5A.2 + 5A.2-fix — broadened to ANY non-terminal job association, body now visibly re-resolves on dropdown pick]
- Bonus shipped 5A.1-fix: Send button always visible at minimum composer size; sticky sidebar across long pages with Settings always reachable.
- Bonus shipped 5A.2-fix: multi-word full-name search ("andrew kraig" now finds candidate AND contact across header + /candidates page).

#### Prompt 5A.3 - Candidate page pagination [SHIPPED]
1. /candidates page paginates at 25 candidates per page. Add page controls (prev/next/jump-to-page) at the bottom of the candidate table. Default sort preserved. Search and filter operate across the full dataset; pagination applies to the result set. [SHIPPED]

#### Prompt 5A.4.a - Lists feature: schema migration [SHIPPED]
1. New Neon tables: CandidateList (id, organizationId, name, createdById, createdAt, updatedAt) and CandidateListMembership (id, listId, candidateId, addedAt). Both scoped by organizationId. Composite uniques on (organizationId, name) and (listId, candidateId). Cascade delete from list/candidate sides; RESTRICT on createdById to preserve attribution. [SHIPPED via npx prisma db push — see docs/help/lists-schema.md]

#### Prompt 5A.4.b - Lists feature: UI [NEXT]
1. Add "Add to List" button on candidate profile. Click opens popup composer with two options: "Create new list" (text input + Save) or "Add to existing list" (dropdown of lists for current user's org). Multi-select allowed - candidate can be on multiple lists at once.
2. /candidates page top search bar gets a "Lists" filter dropdown alongside existing search. Pick a list, candidates filter to only members of that list. "All candidates" option clears the filter. Lists dropdown sorted alphabetically.
3. Lists management: small page at /candidates/lists for renaming, deleting lists. Deleting a list removes the membership rows but does NOT delete the candidates.
4. All queries scope by organizationId (Rule 8).

#### Prompt 5B - Rebuild 3 core templates in {{}} format
1. Submittal Confirmation to Candidate ("Great News - You've Been Submitted!")
2. Application Received (matches the screenshot Andrew sent: "Hi {{candidate.first_name}}, I received your application to the {{job.title}} position you applied for in {{job.city}}, {{job.state}}. This is with {{client.name}}. What salary are you targeting? How is the commute for you to {{job.city}}? Why are you open to new opportunities at this time and what are you looking for in your next role?")
3. Acceptance of Offer (subject "Acceptance of Offer - {{candidate.full_name}} - {{client.name}}")

Each template tagged with side (candidate-facing vs client-facing) and stage (which pipeline stage this fires from).

#### Prompt 6 - CC/BCC autocomplete
1. CC dropdown autocompletes with other contacts at the same client org as the To recipient
2. BCC dropdown autocompletes with teammates from Andrew's org (Austin Barnard for now)
- (Sticky sidebar previously bundled with this prompt has already shipped via 5A.1-fix.)

#### Prompt 7 - Mail Tab polish + bidirectional read sync [SHIPPED 22.0 + 23.0]

SHIPPED 22.0:
- Open thread marks read in Gmail (removeLabel UNREAD)
- Unread count badge on Mail sidebar
- Browser tab title with unread count (live via MailContext)
- Move To label dropdown (Archive kept, Move To additive)
- Logo + signature contact icons CID render fix
- Favicon (pulled forward from Week 4)

SHIPPED 23.0:
- BCC autocomplete with org members (Austin Barnard surfaces on focus)
- Click-to-add dropdown bug fix (single-click selection now lands cleanly)
- Mail toast auto-dismisses when the matching thread is opened

REMAINING (low priority):
- Re-audit ENOENT logo on serverless

#### Prompt 8 - Auto-tagging emails to candidate/client profiles [SHIPPED 23.0]

All four items shipped:
1. Auto-tag fires on every thread open AND every send/reply via tagThreadByAddresses (src/lib/gmail.ts). Address match is case-insensitive substring against Candidate.email and Contact.emails (orgId-scoped).
2. Email Threads card on candidate profiles (BOTH Ace-native LocalCandidateProfile AND RF-imported page.tsx).
3. Email Threads card on client overview tab (separate gmailTags fetch in the page-level Promise.all, scoped by clientId + organizationId).
4. Bidirectional confirmed - sends from the FAB / Reply / candidate-popup composers all run through the same auto-tag write path.

### Interview Scheduling Overhaul (Prompts 9-13, larger work)

Replaced spec (2026-04-26):

#### Prompt 9 - Interview Scheduler Form UI (revised)

- Interview Type: Phone, Video, In-Person only
- Timezone selector — MANDATORY, currently missing entirely
- Interviewers multi-select with inline add-new-contact button
- Calendar Location / Instructions field (required)
- Smart subject line generation with Settings toggle. Uses template subject if template exists, otherwise generates from context.
- Rich text editor for client and candidate emails, pre-populated from Interview Confirmation templates, fully editable
- REWORK existing "Client Sending Invite Directly" button: when clicked opens a form to pick interviewer, date, time. Adds to Andrew's calendar only. No emails sent. For pipeline tracking only.

KILLED items (do not build):
- Anonymize attachment checkbox
- Notes for Client / Notes for Candidate fields
- Send email separate from calendar invite checkboxes
- Recruiter Selector / Split with Recruiter

#### Prompt 10 - Schedule Interview submission flow

On Schedule Interview button click:
1. Validate all required fields. If any missing, highlight field in red and scroll to it.
2. Create interview record in Neon: candidate_id, job_id, client_id, interview_type, start_time, end_time, timezone, interviewers (array), location_instructions, notes_client, notes_candidate, subject_client, subject_candidate, body_client, body_candidate, attachment_id, anonymize_attachment, recruiter_id, split_recruiter_id, client_will_manage_candidate_email, status="scheduled"
3. Send dual Google Calendar invites with Meet link (existing flow, already working in 17.0 - reuse)
4. Send candidate email (unless "Client will manage" checked) with attached resume
5. Send client email with attached resume + Notes for Client included in body
6. Move candidate-job pairing to "Interview Scheduled" stage in pipeline
7. Trigger any "On Interview Scheduled" stage actions registered in stage_action_templates table
8. Toast confirmation: "Interview scheduled. Calendar invites sent to {{interviewers}} and {{candidate.full_name}}."

#### Prompt 11 - Stage-Triggered Template Actions System [KILLED]

Killed. See "Explicitly Killed - Do Not Build" at the bottom of this file. Do not build.

#### Prompt 12 - Candidate Profile Layout Reorganization

Revised scope (2026-04-26):

- Match % column on Applied Jobs table, color-coded (90%+ green, 70-89% yellow, <70% red).
- Three-column layout:
  - Left sidebar: contact, comp, employer, work auth, education, recruiter notes with stage indicator and skip-outreach toggle.
  - Center 60% resume preview.
  - Right sidebar: pipeline state, contextual data.

KILLED:
- Top tabs (Profile / Notes / History / Skills & Answers / Splits) — keep current layout.
- Header candidate-job notation ("Christopher Boyle ↔ Tax Associate").
- Co-recruiter splits.

#### Prompt 13 - Template Library Enhancements

Revised scope (2026-04-26):

- Stage tag on each template
- Default attachments per template as optional setting
- Templates can reference {{interview.*}} merge fields when associated with interview-related stages: interview.type, interview.date, interview.start_time, interview.end_time, interview.timezone, interview.location, interview.interviewers, interview.meet_link

KILLED:
- Side tag (candidate-facing vs client-facing)

### Reference visual context
Andrew uploaded screenshots from a Jobot/Jax recruiting database during Ace 17.0 chat as visual reference. Key patterns to replicate:
- Modal forms with drag handles and structured field rows
- "Editing Not Ready: Choose one or more Contacts" placeholder pattern when prerequisites aren't met
- Two-column email body editors (one for client, one for candidate) with toolbar above each
- Word counts in bottom-right of rich text editors
- Pipeline action buttons rendered as a horizontal row of pill buttons
- Match percentage badges color-coded
- Resume preview in center column with dropdown selector for multiple resumes
- Compact left sidebar with candidate metadata
- Skip Outreach toggle on candidates with stage indicators

### Future (post-18.0) backlog
- **Calendar page** — dedicated /calendar surface (month / week / day views, Google Calendar read-write sync, create-meeting modal). Promoted out of Week 3 into a standalone backlog entry per Ace 27.0 close.
- **Job page full revamp** — deeper redesign beyond the salary-range column + condensed Apply-to-Job dropdown shipped 26.0 / 27.0. Scope TBD.
- MPC candidate features
- Daily industry briefing
- Closing sheet templates with call transcription auto-fill (Krispcall, Google Meet, Teams)
- Activity-to-revenue analytics
- Slack integration
- LinkedIn Chrome extension
- Job board aggregator integration
- QuickBooks integration
- DocuSign auto-import
- Google Drive backup to "ACE Database" shared drive with Austin
- PWA conversion (mobile)
- Remote shipping from mobile (voice/text → background Claude Code agent)
- Market Insights tab
- Client Strategy tab (Claude chat workspace per client)
- Cosmetic polish batch: any visual polish surfaced during 18.0 testing not already absorbed by the Court Modes palette v5 sweep (Ace 30.0).

## Recovered Backlog (audit 2026-04-25, refreshed end of Ace 31.0)

### Week 2 (remaining order — confirmed end of Ace 32.0)

**Active workstream: Ace 33.0 Claude Panel Phase 5 (Phase 1 — shell + persistence).** Full spec lives at the top of this file under "Ace 33.0 — Next up".

1. **Claude Panel Phase 5** — three-phase build (shell + persistence; Ace data read access; actions + Claude History). Fulfills the older "Ace Assistant Tab" entry.
2. **Game Plan Phase 4** — "My Writing Style" setting. New field in /settings, injected into every Claude API call across Ace (submittals, JDs, email generation, Game Plan).
3. **Game Plan context depth** — Send full resume text + full JD text into the ai-workspace prompt so Claude reasons against the actual content, not just metadata.

**Other Week 2 items (carry forward after Game Plan phases):**

5. **CSV Import/Export** — bulk candidate / contact ingest path.
6. **Candidates Page UX** — multi-select, prev/next, keyboard nav (left/right arrow keys when not focused on an input). Prev/Next respects current list/search filter and sort order. Also applies when navigating from global header search results. (Partial sweep landed in Ace 27.0; remaining items: full keyboard nav + prev/next from header search.)
7. **Settings Fix Generator** — small utility surface inside Settings to repair common data issues without touching the DB by hand.
8. **Daily Industry Briefing + Word of the Day** — Vercel Cron 6 AM EST. Daily public-accounting industry brief + a vocabulary card delivered in-app.
9. **Market Insights Tab** — Tab 6 on client detail. Generate market briefs inline. Save brief history per client. Pick recipients from contacts. Compose / auto-generate email, attach PDF, send from Ace.
10. **BD Tab + Prospects Database** — dedicated /bd surface and a Prospect table. Stores company / contact / title / email / LinkedIn / triggering job posting per prospect, sequence status, last touch.
11. **BD Automation Engine** — Daily 6 AM cron. Step 1 (Indeed API): scan last-24hr jobs, filter for public accounting firms by company name (CPA / Associates / Partners / Accounting / Advisory / Group) OR JD signals (audit / tax / public accounting). Discard staffing agencies and corporate in-house. Output 20 companies/day. Step 2 (Apollo API): one best contact per company — Managing Partner, Tax Partner, Controller, CFO, or HR Director. Step 3: Write each prospect to the Prospect table. Step 4: Auto-enroll in email sequence using warmed burner domains. All sending and tracking in Ace, not Apollo. BD Settings screen for keywords / titles / limit / sequence. BD feed showing overnight additions and sequence status. Apollo is data source only. Replaces Andrew's manual BD flow.

**Replaced / folded into the Game Plan phases above:**
- ~~Ace Assistant Tab~~ → Claude Panel Phase 5 — three-phase build (Ace 33.0 Phase 1: shell + persistence; Phase 2: Ace data read access; Phase 3: actions + Claude History).
- ~~Game Plan — Full DB + Web Access~~ → Game Plan Phases 1 (web search SHIPPED 29.0) + 2 (Find Matches SHIPPED 31.0) + 3 (tagged-email context SHIPPED 32.0).

#### Already shipped from earlier Week 2 plan:
- Phone Tab Phase 1 + 2 (Ace 24.0).
- Phone Tab Phase 3 (Ace 26.0).
- Phone Tab outbound call wiring via Quo Desktop deep link (Ace 29.0).
- Phone-page New Text/Call header button — dial pad reachable from any thread (Ace 32.0).
- Quo auto-transcription (Ace 29.0).
- Game Plan Phase 1 — web search across all 5 Claude call sites (Ace 29.0).
- Game Plan Phase 2 — Find Matches + CandidateMatch persistence + Matched tab (Ace 31.0).
- Game Plan Phase 3 — last 5 tagged emails injected into ai-workspace prompt (Ace 32.0).
- Email history UI — candidate Activity tab + client Email tab via shared TaggedThreadList (Ace 32.0).
- Personal Trainer rules engine — schema + 15 default rules + Settings UI + GitHub sync + buildPersonalTrainerBlock injected into every Claude system prompt (Ace 32.0).
- Settings refactor — left-nav + per-category page layout; Email tab dropped; Templates split Active/Inactive; Triggers on its own page; Branding signature preview (Ace 32.0).
- Generate Resume button (Ace 29.0).
- Mail / composer revamp (Ace 29.0).
- Connectors panel + Settings polish (Ace 29.0).
- Full brand system + court mode 6-palette overhaul (Ace 24.0).
- Dashboard premium redesign (Ace 24.0).
- Button system unified across app (Ace 24.0).
- Activity tab on candidate + client profiles (Ace 24.0).
- Visual markup change — addressed via the candidate profile redesign + clients page redesign (25.0 / 26.0).

#### Earlier Week 2 items rolled into the 1–13 ordering above:
- Daily Industry Briefing + Word of the Day → item 10.
- Market Insights Tab → item 11.
- Game Plan Web Search "Find Matches" button → item 2 (Phase 2).
- Claude-powered web search assistant panel (internal use only) → item 5 (Phase 5).
- Mail composer Generate-from-prompt input box → ships shipped under Generate with Claude in the composer; if there's a regression, surface in toast-fix sweep.
- Cosmetic polish pass (billing tower, h1 contrast, counter subtext, "Welcome back, Andrew" → "Activity Dashboard", remove INTERNAL OPS header, fix footer location) → shipped 24.0; Clay Dark Generate-with-Claude visibility absorbed by the Court Modes palette v5 sweep (Ace 30.0).
- Next/Previous navigation between candidate profiles → item 8.

### Week 3

- JD auto-generate Claude button on job page.
- Resume parser improvements (5-10 test resumes to tune).
- Quo auto-transcription webhook (call.transcript.completed, save transcript + Claude summary). [SHIPPED Ace 29.0 — 2026-04-30]
- Boolean candidate search - skills/location/title/employer/education with AND/OR/NOT.
- MPC (Most Placeable Candidates) feature.
- Sentry N+1 fixes: ACE-CRM-5 (37 events), ACE-CRM-6 (28 events), ACE-CRM-7 (2 events), ACE-CRM-9 (1 event), ACE-CRM-A (1 event). Plus one Hydration Error. Fix via Prisma include eager-loading.
- **Calendar Tab** (added end of Ace 26.0)
  - Dedicated /calendar page in the sidebar (between Pipeline and Applicants, or after Phone — Andrew to confirm position).
  - Month / week / day view of all scheduled interviews and meetings.
  - Google Calendar read/write sync with Andrew's calendar (Google account already connected). Existing scheduled interviews appear automatically (already on Google Calendar via the interview scheduler).
  - Create-meeting modal opened from the page header. Fields: title, date/time, duration, attendees (pull from Neon contacts — candidate + client picker), location / video link, notes.
  - One-click meeting creation for BD calls + intro calls + internal meetings without going through the full interview scheduler flow.

### Week 4

- Night Court mode (4th theme). [SHIPPED Ace 27.0]
- BP circle icon + Ace logo + favicon + footer cleanup. **(favicon SHIPPED 22.0; Ace logo + footer cleanup remain.)**
- YouTube floating player.
- DocuSign auto-import.
- Invoicing workflow with Slack-to-Austin trigger on confirmed start.
- Slack integration sidebar panel.
- PWA conversion - manifest, service worker, push notifications.
- Activity-to-Revenue Analytics.
- Job Order + ARPO templates with call transcription auto-fill.
- Demo mode (sandbox toggle).
- UX polish batch (15 items per audit canvas).

### Candidate Profile Redesign (Jobot-style)

- Tabs at top: Profile, Notes, History, Skills & Answers, Splits.
- Applied Jobs table near top (Client / Job / Compensation / Match% / Action buttons).
- Stage action buttons row directly below tabs.
- Resume display dropdown showing all uploaded resumes with timestamps.
- Cloud upload icon, three-dot menu (Brand, Anonymize, Delete, Download).
- Left sidebar: Contact, expected comp, current employer, work auth, education, Recruiter Notes with stage indicator + skip-outreach toggle.
- Resume preview center 60%.
- Right sidebar: contextual data.
- Stage-Triggered Action Buttons: Move to Offer Stage, Reject (with reason dropdown), Schedule Interview, Keep, Apply to Job, Add Note, Edit PDF Again.

### Interview Scheduler Redesign

17 fields from Ace 17 chat.

- **Edit interview** — modify date, time, interviewers, and location on an existing scheduled interview. Updates the Neon row, refreshes the Google Calendar event, and re-sends notifications to the client and candidate so they pick up the change.
- **Cancel / reschedule flow** — Cancel exposes an optional reason field; reschedule opens the scheduler pre-populated with the existing interview's data so Andrew only edits what changed. Both actions push updated notifications to the client and candidate.

### Template Library Enhancements

Stage tag, side tag (candidate-facing vs client-facing), bracket+merge syntax, attachment defaults.

### Infrastructure

- CandidateResume audit + migrate file bytes from Postgres to Vercel Blob.
- Background job queue (Job table + Vercel Cron) for any operation over 60 seconds.
- Postgres tsvector + GIN indexes for fast Boolean search as DB grows.
- ZDR (Anthropic Zero Data Retention) request on Andrew's API key.
- Quo setup wizard - guided in-app flow in Settings to connect Quo, configure webhook URL, verify inbound SMS/call routing, and confirm transcription is live.

### BD Sequencing

- Scheduled email send - Gmail API supports send-at timestamp. Build as prerequisite to BD sequence engine. User picks date/time in composer, Gmail holds and sends at that time.

### Communications / Webhooks

- Ringover/Quo in-app notifications - webhook on incoming call and SMS. Same sonner toast style as email notifications. Caller name/number for calls, message preview for texts. Build alongside call transcription webhook work already on roadmap.

### Phase 5 Carry List

- Copy sweep (17 RecruiterFlow user-visible strings).
- Compound-unique widening (3 Placement compound uniques don't include organizationId).
- SmsMessage / CallLog / CallTranscript / AiWorkspaceMessage tenant-scoping.
- Manual Andrew actions: delete RECRUITERFLOW_API_KEY from .env.local and GitHub Actions secrets, delete src/lib/recruiterflow/ entirely.

### Removed From Roadmap (productization deferred indefinitely)

- Help Docs Corpus (Architecture Non-Negotiable #10 relaxed).
- Per-org color theming.
- Ask Claude in-app support panel.
- BYOC, CustomerRequest table, Stripe billing, marketing site, trademark, legal review, code escrow, public REST API, MCP server v1, custom fields UI, hierarchical RBAC, demo accounts, external SSO, SOC 2.

## Proprietary Differentiators (approved Ace 16.0)

- **Live placement probability score**: 1-100 score per pipeline candidate, updated real-time based on response time, interview progression, comp alignment, time-in-stage. Color-coded red/yellow/green. Visible on pipeline view and candidate profile.
- **Counteroffer risk flag**: at offer stage, pulls tenure, comp jump %, employer size, flags high counteroffer risk automatically. Visible on candidate profile and offer-stage pipeline.
- **Client heat map**: visual showing clients active / going cold / overdue for touchpoint based on last activity. Red/yellow/green. Lives on dashboard or `/clients/heat-map`.
- **Candidate re-engagement engine**: flags candidates placed or went cold 12-18 months ago who are statistically likely open to a move. Auto-drafts re-engagement email for Andrew's review before send.
- **Fee tracker with Austin auto-notify**: confirmed-start placement calculates gross fee, Andrew 75% cut, Austin 25%, Slacks Austin (`U0AJB4AM631`) the breakdown when start date confirmed. Triggers off `placement_confirmed` ActivityLog event.

## Practical Differentiators (approved Ace 16.0)

- **One-click interview prep packet**: PDF for candidate with company background, role summary, likely interview questions, Andrew's coaching notes. Separate button after interview scheduled. COEXISTS with standard rich text editor on scheduler.
- **Submittal tracker with read receipts**: tracks whether client opened submittal email and how many times. Shows "opened 3x, no reply" on candidate profile or pipeline. CRITICAL: read tracking must be invisible to client. If implementation would notify recipient, kill the feature.
- **BD trigger alerts**: monitors LinkedIn and Indeed for job postings from existing clients. Alerts Andrew when existing client posts a new role he hasn't been engaged on. Catches BD opportunities before competing recruiters.

## Explicitly Killed - Do Not Build

- Stage-Triggered Template Actions System (Claude proposed, Andrew did not request).
- AI Agent features (auto-suggestions, approve/dismiss, next-best-action).
- Candidate mood tracker.
- Help Docs Corpus.
- Per-org color theming.
- Demo mode / sandbox toggle.
- ZDR (Zero Data Retention).
- MCP Connection (Claude reads/writes Ace database).
- Co-recruiter splits feature.
