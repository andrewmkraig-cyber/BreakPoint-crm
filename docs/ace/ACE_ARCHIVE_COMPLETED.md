# ACE_ARCHIVE_COMPLETED.md

Long-form history archive. Started 2026-05-07 when ACE_STATE.md was trimmed to the last 3 versions (Ace 32.0, 33.0, 34.0) and ACE_ROADMAP.md was trimmed to completed history back to Ace 30.0. Everything older than those cutoffs lives here verbatim.

---

## Completed - Ace 38.0 (May 9, 2026)

Spotify/YouTube/Mail polish + CSV import tightening. Nine commits across four surfaces. No core schema changes; one new Json column was considered (Candidate.rawCv) but skipped because the existing experience/education columns already carry the data and all downstream readers (resume PDF, generate-resume action) depend on them.

- Spotify shuffle: PUT /api/spotify/shuffle, panel reads shuffle_state from SDK, NowPlayingBar toggle (right of Next, green when active), Playlist Play and individual track click push toggle state to Spotify before /play, track click sends offset + position_ms: 0.
- Spotify drag/resize lifecycle ported from YouTube. Single endSessionRef + window/document safety net (pointerup, mouseup, blur, visibilitychange, lostpointercapture). Body, BottomNav, NowPlayingBar get pointer-events: none for the gesture. Resize commit re-clamps position so the panel never lands half off-screen.
- Spotify recency-derived: /api/spotify/recently-played returns recentPlaylistIds + recentArtists (hydrated via one batched /v1/artists call, max 10 each). New /api/spotify/playlists-meta?ids=... fetches metadata for up to 10 playlist IDs the recruiter doesn't follow. Home shows a "Recently played playlists" 2-col grid above the tracks row. Library Playlists tab pulls recents (matched against the user's library) to the top; Library Artists tab puts recent artists first (including non-followed) followed by the existing followed list, deduped.
- YouTube search modes Top / Recent / Popular as pills. Long mode added then removed per Andrew. Pills auto-rerun the active surface immediately — channel browse if inside a channel, otherwise the last searched query. /api/youtube/search channelId branch now respects mode. Channel-view load-more pins the mode that produced the page.
- YouTube duration badges via batched videos.list (part=contentDetails). ISO 8601 parsed and formatted as 8:42 / 1:12:04. Bottom-right of thumbnail. Hidden when null. Minimized dock shows duration next to the title when available.
- Mail To-field typeahead with three sources in parallel (Ace candidates, Ace contacts, Gmail Sent recipients), all org-scoped, up to 8 deduped items, priority-sorted (exact email > local-part-prefix or name-prefix > substring-anywhere; Ace sources outrank Gmail at ties). New /api/mail/contacts-search?q= route. Contact.emails partial match via parameterized $queryRaw since Prisma can't substring-match into String[].
- Mail Gmail Sent recipients via new src/lib/gmail-recipients.ts. Snapshot of the last 500 sent messages — pages through messages.list, fetches metadata-only headers in parallel, parses To/Cc/Bcc address lists, dedupes by lowercased email. Cached 30 min in-process; stale-while-revalidate up to 24h; concurrent refreshes coalesce on one Promise. No new OAuth scope. Earlier per-keystroke live-search approach was scrapped because Gmail's to: operator does prefix-of-token, not substring.
- AddressRow upgrade: opt-in serverSearch flag. 200ms debounce, AbortController for stale-response drops, Arrow/Enter/Escape keyboard nav, mouse hover follows the same activeIndex. To row passes serverSearch; CC/BCC unchanged.
- Candidate CSV import skip rules tightened. Experiences drop when both title AND company empty. Educations drop when school empty. linkedin field dropped from experience capture.
- Candidate profile WORK HISTORY + EDUCATION sections render year-only via regex pull on raw start/end dates. Court Mode tokens preserved.

## Completed - Ace 37.0 / 37.1 / 37.2 (May 8, 2026)

Three-step Spotify thread the day before the 38.0 polish day.

- 37.0 — Three Spotify fixes, no playback or YouTube code touched. Artist Popular section no longer hits /v1/artists/{id}/top-tracks (403 in dev mode); new flow fetches /v1/artists/{id}/albums?include_groups=single,album&market=US&limit=5, takes the first album, fetches /v1/albums/{firstAlbumId}/tracks?market=US&limit=5, projects 3-5 rows for Popular; if anything 403s the section hides silently. Discography continues to use /v1/artists/{id}/albums?include_groups=album,single&limit=20&market=US (hardcoded 20). classifyPlaylistTracksError returns null on 403 + ownerId === meId so the recruiter's own playlists never show a restriction or auth-refresh message; followed-but-not-owned playlists keep the "Spotify's API restricts access to playlists you didn't create. Open in Spotify to listen." message.
- 37.1 — Andrew's "Lifting" playlist (which he owns) was rendering 0 songs with no error. /api/spotify/playlist-tracks/[id] gained an embedded-items fallback: when /v1/playlists/{id}/tracks fails or returns no projected rows, harvest the same shape from the header response's tracks.items[] so an owned playlist doesn't strand on 0 songs because a single sub-call broke. Server logs raw header / tracks / me responses (truncated 600 chars) plus a structured "decision" line with ownerId, meId, ownerMatchesMe, embeddedItemsCount, projectedTracks, tracksSource. Response ships a small debug envelope to the client; panel console.logs it on every response. trackCount priority adjusted: header.tracks.total → totalFromTracks → tracks.length so we never display "0 songs" above a non-empty row list.
- 37.2 — Web Playback SDK doesn't reliably auto-advance through a context_uri (artist / playlist) on its own — playback would just stop after each track. Wired track-end detection into the existing player_state_changed listener: prevPlayerStateRef remembers the previous state's trackUri + paused so we can distinguish "track ended" from initial connect / user pause / seek-to-zero. When prev state was actively playing a track (paused=false + trackUri) and the new state matches end-of-track shape (paused=true + position=0), POST /api/spotify/next with the current device_id. autoSkipInFlightRef debounces the burst of player_state_changed events the /next call itself triggers so we never double-skip.

## Completed - Ace 36.0 (May 7, 2026)

Floating media + dashboard daily companions + premium dashboard. Full per-bullet log lives in ACE_ROADMAP.md's Completed - Ace 36.0 section; rollup here for archive completeness.

- YouTube floating player (draggable + resizable, topbar Music-icon toggle, /api/youtube/search proxy, video-first iframe + hover overlay, viewport clamping, minimize-keeps-audio, CSP fix, 50 results + View More pagination, channel search + channel view).
- Spotify floating panel (full Spotify-mobile-style UI on top of the Web Playback SDK, OAuth via /api/auth/spotify with httpOnly cookies, transparent token refresh through spotifyApiProxy, 3-tab BottomNav, Recently Played row on Home, Library tab with filter pills backed by /api/spotify/playlists + /api/spotify/saved-albums + /api/spotify/followed-artists, PlaylistView + AlbumView via shared detail route, ArtistView with top tracks + discography, full-panel NowPlayingView, minimize keeps audio, X closes and pauses + SDK disconnect, Spotify dark palette intentionally hardcoded scoped to src/components/spotify-panel/).
- Word of Day, Quote of Day, Chess puzzle, On This Day, Daily Horoscope dashboard pills (cached in Neon).
- News feed redesign (Apple-News editorial style, 4 tabs, lead-story + 3-list-rows layout, collapsible).
- News feed cron (6 AM ET Vercel cron at /api/cron/news-feed pre-warms DailyNewsFeed for every tab, NEWS_API_KEY replacing the prior Claude web_search round-trip).
- Weather widget (Open-Meteo + geolocation, hover popover with current/6-hour/7-day forecast, custom WMO icon dispatch).
- Dashboard premium redesign (green-tint surface, sage KPI tile icons, Billing Tower with Q2 focal + cash-collected secondary, ambient layered shadows, tabular numbers, Activity Dashboard topbar in Bricolage Grotesque).
- Final user-facing RecruiterFlow string removed from the UI.

---

## Completed - Ace 35.0 (May 7, 2026)

- Game Plan Context Depth: extractResumeTextForCandidate helper in ai-workspace-context.ts. pdf-parse via dynamic import. Candidate context gets UPLOADED RESUME section (6k char cap) or "No resume on file". Job context gets RAW JOB DESCRIPTION and INTERNAL RECRUITER NOTES sections, skipped silently if null. Client context gets ACTIVE JOBS (up to 5 open jobs, 2k cap each) and PIPELINE CANDIDATES (10 most recent placements, 3k cap each, parallel pdf-parse).

- Ace Assistant Phase 4 Data Access: four tool definitions in /api/claude-panel/chat/route.ts. search_candidates: OR-logic tokenized scoring across name/title/employer/location/skills/tags, plural singularization, stop word removal, JS scoring with title=3/employer=2.5/location=2/skills=1.5/tags=1/name=1, top 15 returned with markdown links [Name](/candidates/id), show more line when total exceeds display. search_jobs: isOpenJobsIntent pre-pass returns all isOpen=true jobs when broad intent detected, temporal adverbs added to stop words, OR broad + ranked otherwise. search_clients: OR broad across name/industry/domain/tags with second pass over 200 rows for location JSON. get_pipeline: normalizeStage maps any phrasing to canonical, interviewing queries Interview table (all dates), offer/pending_start/hired query Placement table, clientName contains insensitive, historical flag merges all placements + all interviews sorted by date desc capped at 30. Tool-call loop caps at 4 rounds. Per-call audit log emitted to Vercel function logs.

- Ace Assistant Phase 5 Actions and History: three action tools (move_candidate_stage, add_note, draft_email) in chat route emit action_pending events instead of executing. /api/claude-panel/action route executes on confirm. ActionConfirmCard component in ClaudePanel.tsx with confirm/cancel handlers. Resolved payload includes candidateName, fromStage, toStage, jobTitle so card shows real names. placementId optional on move_candidate_stage, falls back to most recent non-rejected placement. add_note writes to ActivityLog with actionType note. draft_email opens Ace mail composer pre-filled, does not send. conversationId nullable column added to ClaudePanelMessage. Clear Chat rotates conversationId in localStorage instead of deleting rows. /settings/history groups by conversationId with legacy NULL rows bucketed by date. /settings/history/[key] thread view with delete per conversation.

- Job Close and Delete: closeJob and deleteJob server actions in job-overview-actions.ts, both org-scoped. Close Job sets isOpen=false, revalidates. Delete Job hard deletes and redirects to /jobs. UI buttons on job overview tab with inline confirmation for delete. close_job and delete_job action tools added to Ace Assistant with confirmation cards showing real job and client names.

- Manual cleanup: RECRUITERFLOW_API_KEY deleted from .env.local and Vercel. RECRUITERFLOW_BASE_URL deleted from .env.local. GITHUB_TOKEN deduplicated in .env.local.

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
