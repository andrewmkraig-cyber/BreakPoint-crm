# Ace Roadmap
Last updated: 2026-05-11 · Ace 38.1

## Active Build Sequence
In this order. Each item ships start-to-finish before the next begins unless an explicit prereq is called out inline.

1. **BD Engine block** — 12-19 hr total. Claude Design pass first (1-2 hr) for BD tab + BD Settings + Sequence builder UI before any code. Then in order: Scheduled email send (Gmail API send-at), Background job queue (Job table + Vercel Cron), BD tab surface (`/bd` page, Prospect table, BD feed), Apollo enrichment helper as standalone before cron, BD daily cron (6 AM scan Indeed API for public-accounting firms matching criteria, Apollo finds best contact, writes to Prospect table, deduplicates), Sequence engine + BD Settings (outbound sequences from Ace using warmed domains, Settings for keywords/titles/limit/cadence).
2. **Search expansion map** — geocoded map visualization over the Candidate Sourcing Surface. Render the candidates returned by the current filter set as pins on an interactive map so the recruiter can see geographic spread at a glance and lasso a region to refine. Pairs with the radius pills already shipped — same `lat`/`lng` columns power both.
3. **Bulk email** — multi-candidate email send from the new search surface. Drives off the row-checkbox / bulk action bar shipped in 38.1; composes a single Gmail draft per selected candidate with merge fields, sends through the existing Gmail send path. Activity-logged per recipient. Builds on the scheduled-send / queue infrastructure landing in the BD Engine block.
4. **PWA conversion** — 1.5-3 hr. Manifest, service worker, push notifications.
5. **Quiet Clients tab** — 1-2 hr. New tab on `/clients`. Lists clients where the last touchpoint exceeded threshold (default 21 days, configurable in Settings). Columns: client name, days since last activity, last activity type, last activity date. Sortable by days, default longest first. Tiers: Check in soon 14-30 days / Going cold 30-60 / Cold 60+. Optional Claude summary at tab open. Reads from existing ActivityLog, no new schema.
6. **APRO / job order worksheet** — 2-3 hr. Structured intake form.
7. **Client preference learning system + Personal Trainer suggestions** — 6.5-9 hr combined. Replaces the killed auto-updating client preference memory and Ace learning layer Phase 1. Phases: Phase 0a client-side email thread tagging (1.5-2 hr prereq), Phase 0b client-side Quo call/SMS tagging (1-1.5 hr prereq), Phase 1 email preference scan + propose UI with daily cron and dashboard card (2-3 hr), Phase 2 Quo transcript preference scan (1.5-2 hr), Phase 3 note-write inline extraction (30-45 min), Personal Trainer rule suggestions bundled (1-1.5 hr). ClientPreference schema + right rail on client profile + submittal composer right rail. Monthly drift review first Monday of each month.
8. **Interview scheduler enhancements** — 1-2 hr. Edit/cancel/reschedule flows.
9. **One-click interview prep packet** — 1-2 hr. PDF for candidate pre-interview.
10. **Calendar tab** — 2-4 hr. Month/week/day, Google Calendar read-write sync, create-meeting modal.
11. **Market Insights + daily brief** — 2-4 hr. Word of day already built in Ace 36.0; this bundle covers the remaining market-insights pieces.

## Queued From Session
Items scoped during recent sessions. Each needs its own prompt before slotting into the active build sequence.

- **Candidate Rejected tab** — dedicated list on `/jobs/[id]` surfacing candidates with a `stage="rejected"` Placement for the job. The exclusion filter that hides them from the Matches list already shipped in 38.1; this tab gives the recruiter a place to revisit / un-reject without leaving the job surface.
- **Tighter applied-jobs strip** — PlacementActionsIsland refactor required first; needs its own scoped prompt.
- **Skills/keywords field on Job Description tab** — feeds Find Matches scoring and Boolean search. Add to the Boolean search prompt when that ships.

## Non-Urgent
Build soon, lower priority than the active sequence above.

- **Invite flow in Settings** — reuses OrganizationMembership; invite + role chip + revoke.
- **Quo setup wizard** — guided Settings flow to connect Quo, configure webhook URL, verify inbound SMS/call routing, confirm transcription is live.
- **Slack sidebar panel**.
- **DocuSign auto-import** — ~2-3 hr via DocuSign Connect webhook.
- **Invoicing + QuickBooks + Mercury** — invoicing workflow, QuickBooks sync, Mercury account integration.
- **GPT as second AI provider** behind Ace Assistant.
- **Spotify podcasts tab** — wire `/me/shows` into the Library Podcasts filter (currently shows the empty-state placeholder).
- **News feed per-tab refresh button** — manual re-pull of a single tab without waiting for the 6 AM cron.
- **Commission calculator** — recruiter-side fee/split math sandbox on the dashboard.
- **Stock ticker strip** — small dashboard strip (S&P, NASDAQ, Dow, plus configurable watchlist).
- **Scoreboard widget** — daily/weekly placement + submittal scoreboard tile.
- **Ace launch countdown** — countdown chip on the dashboard until 2026-05-15.

## Cleanup
Do alongside other work.

- **Sentry N+1 fixes** — ACE-CRM-5 (37 events), ACE-CRM-6 (28), ACE-CRM-7 (2), ACE-CRM-9 (1), ACE-CRM-A (1). Fix via Prisma include eager-loading.
- **Compound-unique widening** — 3 Placement compound uniques missing organizationId.
- **SmsMessage / CallLog / CallTranscript / AiWorkspaceMessage tenant-scoping**.
- **MANUAL** — delete `RECRUITERFLOW_API_KEY` from `.env.local` and GitHub Actions secrets.
- **MANUAL** — delete `src/lib/recruiterflow/` directory entirely.
- **Vercel Blob migration** — CandidateResume audit + migrate file bytes from Postgres to Vercel Blob.
- **Postgres search indexes** — already in active sequence above; listed here for completeness.

## Future Ideas
Revisit at scale or workflow change — do not build now.

- Submittal tracker with read receipts.
- Counteroffer risk flag.
- Live placement probability score.
- Fee tracker with Austin auto-notify.
- Job fillability score.
- BD trigger alerts.
- Candidate re-engagement engine.
- Ace learning layer Phase 1 (replaced by client preference learning).
- Relationship graph + placement pattern learning.
- Settings fix generator.
- Activity-to-revenue analytics.
- Multi-recruiter permissions.
- Candidate profile full redesign.
- ARPO with call transcription auto-fill.

## Explicitly Killed — Do Not Build
- Stage-Triggered Template Actions System.
- AI Agent features (auto-suggestions, approve/dismiss, next-best-action).
- Candidate mood tracker.
- Help Docs Corpus.
- Per-org color theming.
- Demo mode / sandbox toggle.
- ZDR (Zero Data Retention).
- MCP Connection (Claude reads/writes Ace database directly).
- Co-recruiter splits.
- All SaaS / productization: BYOC, Stripe billing, public REST API, MCP server, SOC 2, external SSO, multi-tenant onboarding, marketing site.

---

## Completed - Ace 38.1 Candidate Sourcing Surface (May 11, 2026)

Closed prior items 1 (Postgres search indexes) and 2 (Candidate Sourcing Surface) from the active sequence. The `/candidates` rail and the per-job Matches tab now share the same faceted filter surface.

- **Postgres search indexes**: `Candidate(firstName)`, `Candidate(lastName)`, `Candidate(email)` plus `Contact(name)` and the `Contact.emails[]` substring lookup. Bulk imports + the mail typeahead routes + the new rail no longer sequential-scan.
- **Filter rail** shared by `/candidates` and `/jobs/[id]?tab=matches`: keyword/Boolean, Skills, Job titles, Min/Max comp, Locations (multi-pill), Distance (10/25/50/100 mi, clamped 500), Employer (multi-pill), Employer scope (Current only / Current + Past), Tenure (`lt1` / `1to3` / `3to5` / `gt5`), Work auth (accepted, no-op until schema gains a column), Last apply, Last action.
- **Tag pills with include/exclude** on Job Titles, Skills, Employer. Per-pill `{ value, exclude }`; UI flips a green Check on court-accent-tint to a red Minus on red-tint. Server emits `field=…` / `excludeField=…` separately; route AND-composes includes and AND-NOTs excludes uniformly.
- **Geocoded radius search**: pills geocode through Nominatim (in-process cache, 5s timeout, custom UA), distance dropdown drives a bounding-box union via `lat`/`lng` columns; un-geocodable pills fall back to `location ILIKE` contains-match.
- **Keyword search spans resume + experience/education + structured columns**: per-token UNION across structured (`firstName/lastName/currentDesignation/currentOrganization/location/skills`), `experience::text` + `education::text` casts (raw SQL — Prisma can't ILIKE jsonb), and `CandidateResume.extractedText`. Tokens AND together at the candidate level. `and` / `or` are tokenizer-dropped stopwords. LIKE-escape on `%`, `_`, `\` so a recruiter pasting "100%" doesn't trigger a wildcard.
- **Resume snippet enrichment**: one batched lookup per page returns a 200-char window where every token co-occurs, with experience-JSON fallback when no resume matches. `<mark>` highlights mirror the same tokenizer.
- **Split-view profile**: clicking a row collapses the rail and opens the candidate profile in an iframe with prev/next stepper + Close X. Same pattern on the job Matches tab.
- **Job Matches tab Apply / Keep / Reject**: split-view chrome on `/jobs/[id]?tab=matches` posts to `/api/placements` (APPLIED via the existing `applyLocalCandidateToJob` action; REJECTED upserts a `stage="rejected"` Placement with `syncedToRf: false` and `source: "recruiter_rejected"`). Keep toggles `Candidate.tags`. Rejected candidates are NOT-filtered out of subsequent rail searches scoped to that job (`NOT: { placements: { some: { jobId, stage: "rejected" } } }`). Dedicated Rejected tab UI queued for next session.
- **Save search**: `/candidates` parks up to 5 snapshots in localStorage (`ace.saved-searches`), generateSearchLabel builds a "Tax Manager · Cleveland · Frito Lay" label; saved-search pills replace the empty state once any save exists. Job Matches tab persists one snapshot per job to `Job.savedSearchFilters` via tenant-scoped `saveJobSearchFilters`. Both loaders coerce legacy snapshot shapes (`skills: string[]`, `jobTitles: string[]`, `employer: "X"`) into the new `Pill[]` shape. Run Search button retired everywhere — the debounced useEffect handles every fetch.
- **Employer scope toggle**: Current branch uses Prisma `currentOrganization` contains-insensitive. Any branch routes through `resolveEmployerAnyIds`, which ORs ILIKE patterns across `currentOrganization` and `experience::text` via `Prisma.join(orParts, " OR ")` (separator must be a plain string, not Sql) and plugs the ID set into the where via `id: { in/notIn: … }`.
- **Bulk action bar**: row checkboxes + indeterminate-aware select-all, "Remove from results" pops selected rows from local state (no DB write — recruiter view-state shortcut).
- **Sidebar pinned to viewport**: rail uses `h-[calc(100vh-72px)]` + sticky Save search / Saved Lists footer so the Save block stays visible regardless of result-list length.

## Completed - Ace 38.0 Spotify/YouTube/Mail polish + CSV import tightening (May 9, 2026)

Polish day. Nine commits across four surfaces. No core schema changes.

- **Spotify shuffle**: PUT /api/spotify/shuffle proxies to /v1/me/player/shuffle. Panel reads shuffle_state from the Web Playback SDK player_state_changed event. Shuffle toggle in NowPlayingBar (right of Next, green when active). Playlist Play and individual playlist track click push the toggle's state to Spotify before /play so order matches the toggle. Track click sends offset + position_ms: 0.
- **Spotify drag/resize lifecycle**: ported the YouTube panel's robust pattern. endSessionRef holds the live gesture; cancelActiveSession ends drag before starting resize and vice versa. Pointer capture plus window/document safety net (pointerup, mouseup, blur, visibilitychange, lostpointercapture). Body, BottomNav, NowPlayingBar each get pointer-events: none for the gesture so controls can't eat pointerup. Resize commit re-clamps position so the panel never lands half off-screen.
- **Spotify recency-derived playlists + artists**: /api/spotify/recently-played returns recentPlaylistIds (deduped, recency-ordered, max 10) and recentArtists (hydrated via one batched /v1/artists call, max 10). New /api/spotify/playlists-meta?ids=... fetches metadata for up to 10 playlist IDs the recruiter doesn't follow. Home shows a compact "Recently played playlists" 2-col grid above the existing tracks row. Library Playlists tab pulls recents (matched against the user's library) to the top while keeping every other playlist visible. Library Artists tab puts recent artists first (including non-followed) followed by the existing followed list, deduped.
- **YouTube search modes**: Top / Recent / Popular pills under the search input. Default Top maps to relevance, Recent to order=date, Popular to order=viewCount. Long mode added then removed per Andrew. Pills auto-rerun the active surface immediately on click — channel browse if you're inside a channel, otherwise the last searched query. /api/youtube/search channelId branch now respects mode (was hard-coded to order=date). Channel-view load-more pins the mode that produced the page so pagination doesn't drift.
- **YouTube duration badges**: after search.list returns, a single batched videos.list call hydrates each video with contentDetails.duration. ISO 8601 parsed and formatted as 8:42 / 1:12:04. Black badge anchored bottom-right of the thumbnail (YouTube convention). Hidden when null (live streams, hydration failure). Channel-view videos get the same badge for free since they share VideoRow. Minimized dock shows the duration of the playing video next to the title when available.
- **Mail composer To-field typeahead**: three sources merged in parallel — Ace Candidates (firstName/lastName/email), Ace Contacts (firstName/lastName/name + emails[] via parameterized $queryRaw since Prisma can't substring-match into String[]), and Gmail Sent recipients. All org-scoped. Up to 8 deduped { name, email } items, priority-sorted (exact email > local-part-prefix or name-prefix > substring-anywhere; Ace sources outrank Gmail history at ties).
- **Mail Gmail Sent recipients**: new src/lib/gmail-recipients.ts. getGmailSentRecipients(userId) pages through up to 500 recent sent message IDs, fetches metadata-only headers in parallel, parses To/Cc/Bcc address lists, dedupes by lowercased email. Cached 30 min in-process per user. Stale-while-revalidate up to 24h. Concurrent refreshes coalesce on a single Promise. No new OAuth scope — gmail.readonly already granted. Earlier per-keystroke live-search approach was scrapped because Gmail's to: operator does prefix-of-token, not substring.
- **AddressRow upgrade**: opt-in serverSearch flag. 200ms debounce, AbortController to drop stale responses, Arrow up/down/Enter/Escape keyboard nav, mouse hover follows the same activeIndex. To row passes serverSearch; CC/BCC unchanged.
- **Candidate CSV import**: skip rules tightened. Experiences drop rows where both title AND company are empty (date-only noise rows out). Educations drop rows where school is empty. linkedin column dropped from experience capture (no reader uses it).
- **Candidate profile WORK HISTORY + EDUCATION sections** render year-only ("Title at Company (2020 – 2024)" / "Degree in Major, School (2024)") via a regex pull on raw startDate/endDate when from_year/to_year aren't pre-extracted. Court Mode tokens preserved.

## Completed - Ace 36.0 Floating media + dashboard daily companions + premium dashboard (May 7, 2026)

- **YouTube floating player** (item 1 from prior sequence): draggable + resizable shell, topbar Music-icon toggle, YouTube Data API v3 search proxied through `/api/youtube/search`, video-first playing state with iframe full-bleed + hover overlay (back / minimize / close), viewport boundary clamping, minimize keeps audio playing because the iframe stays mounted, CSP fix adding youtube.com + youtube-nocookie.com to frame-src, 50 results per search with View More pagination, channel search (`?channelId=` filter, `order=date`) with dedicated channel view + back arrow.
- **Spotify floating panel**: full Spotify-mobile-style UI on top of the Web Playback SDK, OAuth login via `/api/auth/spotify` with httpOnly token + refresh cookies, transparent token refresh through `spotifyApiProxy`, 3-tab BottomNav (Home / Search / My Library), Recently Played row on Home, Library tab with filter pills (All / Playlists / Albums / Artists / Podcasts) backed by `/api/spotify/playlists` + `/api/spotify/saved-albums` + `/api/spotify/followed-artists`, PlaylistView and AlbumView via shared detail route, ArtistView with top tracks + discography, full-panel NowPlayingView with album art that scales via `flex-1 + object-contain`, minimize keeps audio, X closes and pauses via `/api/spotify/pause` + SDK disconnect. Spotify dark palette intentionally hardcoded (#121212 / #181818 / #1DB954 etc) scoped to `src/components/spotify-panel/` only.
- **Word of Day pill** (item 2 from prior sequence): Claude-generated word + definition cached in Neon `WordOfDay`, demand-triggered daily reset, click-to-expand popover.
- **Quote of Day pill**: Claude-generated quote cached in Neon `QuoteOfDay`, click-to-expand popover.
- **Chess puzzle pill**: Lichess `/api/puzzle/next?difficulty=easiest` (~961 average rating), `react-chessboard` render, hint + show-answer flow, rating chip, streak tracker in localStorage, day-stable cache, Back button + click-to-move added late in the session.
- **On This Day pill**: Claude-generated historical event for today's ET date cached in Neon `ThisDay`.
- **Daily Horoscope pill**: Claude-generated via server-side proxy (CORS workaround), cached in Neon `Horoscope`, sign configurable.
- **Dashboard daily-companion pills**: 6 chips (Chess, Word, Quote, On This Day, Horoscope, Today's Briefing scroll anchor) — Word/Quote/Chess/On This Day/Horoscope later moved into the briefing header itself; the standalone bottom-bar component has since been retired.
- **News feed redesign**: Apple-News editorial style with 4px colored left border per tab, pill-style tabs, 4 tabs (Front Page / Public Accounting / Recruiting / AI & Tech — Local News dropped), one lead story + 3 list rows, collapsible header.
- **News feed cron**: 6 AM ET Vercel cron at `/api/cron/news-feed` pre-warms `DailyNewsFeed` rows for every tab, `CRON_SECRET` Bearer auth, `NEWS_API_KEY` (NewsAPI.org) replacing the prior Claude `web_search` round-trip — sub-2s response per tab vs the prior 25s timeout window.
- **Weather widget**: Open-Meteo geolocation (Cleveland fallback), hover popover with current + 6-hour + 7-day forecast, custom day/night WMO icon dispatch.
- **Dashboard premium redesign**: green-tint surface, sage-tinted KPI tile icons, Billing Tower in sentence case with primary Q2 billed-revenue focal + secondary cash-collected card, ambient layered shadows, tabular numbers, Activity Dashboard topbar title in Bricolage Grotesque to match the new Ace wordmark. Dashboard hex exceptions (#F6FAF4 / #EFF5EB / #1F6A3A / #F3F8EF) intentionally hardcoded and scoped to dashboard components.
- **RF string sweep**: final user-facing RecruiterFlow string removed from the UI.

## Completed - Ace 34.0 Jobs page command center (May 7, 2026)

Three-prompt arc closed clean. Last SHA pushed to main 1cc12e0.

- 6-tab job detail shell on /jobs/[id] (Overview, Job Description, Matches, Game Plan, Promote, Activity). Pipeline + Billing tabs removed; chip strip at the top of the page covers stage-aware viewing.
- Overview tab: facts grid, search-health placeholder, public apply link copy/open icons.
- Job Description tab: source URL input + Save URL + Parse Link (Claude page extraction → plain text into the raw textarea), raw JD textarea + Save Raw, Generate with Claude (BreakPoint format spec), generated JD preview card with Copy + Last generated timestamp, Internal Recruiter Notes save-on-blur.
- Matches tab: free-text candidate search across name / title / current employer / skills / location, results table, Apply to Job button hits /api/placements at stage=APPLIED, alreadyApplied guard.
- Promote tab: 6 major boards (LinkedIn, Indeed, ZipRecruiter, Glassdoor, SimplyHired, Monster) with status chip cycle + Account Needed indicator + notes + external URL, Local & Niche Boards add/edit/remove, Suggest Boards with Claude stub, JobBoardStatus schema, lazy seed for legacy jobs.
- Prisma client-side error fixed by splitting @/lib/job-boards into client-safe shared module (job-boards-shared.ts) + server-only helpers. /jobs/[id] route bundle dropped from 34.9 kB → 16.5 kB.
- Activity tab wired to ActivityFeed for entityType="job" (api route now supports job; pulls placements + interviews by both jobId cuid and numeric jobRfId).
- CLAUDE_PILL_CLASS constant + emerald/court-token button sweep across mail composer, email composer, candidate intake, agreements, benefits, candidate submittal, find matches.
- Candidate profile rebuild + action cleanup: Submit / Schedule Interview / Reject ordering, Reject at Applied, candidate-level resume action row, toggleCandidateKept action + KeepCandidateButton.
- Ace Assistant Phase 3: page-aware context, entity name pill, server-side buildCandidateContext / buildClientContext / buildJobContext (cuid-only).
- Phone / mail viewport fix; focus-state polish; mail composer height fix; mail thread collapse + auto-scroll to TOP of latest message; mail header redesign (INBOX eyebrow + large heading removed); stale placeholder sweep.

## Completed - Ace 33.0 Ace Assistant Panel + Settings refactor + Court Mode v5 absorbed (May 6, 2026)

- **Ace Assistant Panel** — Phase 1 (shell + Neon persistence + draggable/resizable floating panel + topbar toggle + clear chat) and Phase 2 (NDJSON streaming via /api/claude-panel/chat with Personal Trainer rules + web_search_20250305 + freshness mandate). Phase 3 page-aware context shipped in 34.0.
- **Game Plan Phase 4 — Personal Trainer**: PersonalTrainerRule schema, 15 seeded default rules, Settings UI (Trainer + Rules sub-tabs), real-time GitHub sync to docs/ace/PERSONAL_TRAINER.md, buildPersonalTrainerBlock injected into all 5 Claude routes.
- **Settings refactor**: left-nav + per-category page layout (Appearance, Notifications, Personal Trainer, Branding, Templates, Triggers, Connectors); Email Preferences tab dropped; Templates split Active/Inactive; Triggers on its own page; Branding server-rendered signature preview; phone unread-badge regression fixed.

## Completed - Ace 32.0 Game Plan Phase 2 + Phase 3 + Court Mode v5 (May 5, 2026)

- **Game Plan Phase 2 — Find Matches**: Claude-powered candidate matching on job + client Game Plan surfaces, streaming NDJSON, 6-band score color system, clickable score badge with per-axis breakdown, one-click Apply, job picker on Client Game Plan, CandidateMatch table in Neon, Matched tab on /jobs/[id], live refresh, exclude-already-pipelined.
- **Game Plan Phase 3 — email context**: getRecentTaggedEmails helper, ai-workspace injects Recent Email Context block, Job Game Plan inherits client email context via clientId, silent degrade on miss.
- Email History UI: TaggedThreadList component, GET /api/candidates/[id]/email-threads, GET /api/clients/[id]/email-threads, both org-scoped and deduped, opens floating viewer.
- Topbar Txt/Call button: opens dial pad directly without navigating to /phone.
- **Court Mode palette v5** absorbed across all 7 modes: full token surface refreshed, sidebar + brand rewired, tinted accent per mode, purple reserved for Grass.

## Completed - Ace 31.0 Find Matches stack + /jobs two-column overhaul (May 5, 2026)

Header items only — full per-item log lives in `docs/ace/ACE_ARCHIVE_COMPLETED.md`.

- Game Plan Phase 2 build that became the foundation for the Matched tab. ScoreBadge extracted to shared component.
- /jobs/[id] two-column overhaul (left col-7 tabs + content; right col-3 EditableJobOverview sidebar with single Edit/Save/Cancel toggle).
- Em dash + emoji bans across all 5 Claude API routes; deterministic post-strip on format-email.
- Sticky composer rules + minimized-drafts tray + reply composer body-first layout.
- /api/placements REJECTED branch added.

## Completed - Ace 30.0 Court Mode palette v5 baseline (May 5, 2026)

Header items only — full per-item log in `docs/ace/ACE_ARCHIVE_COMPLETED.md`.

- Candidate header reorder + Profile/Game Plan tab restyle; mail label nesting tightened.
- Dashboard edit-and-resend invite popup (live Google Calendar pre-fill).
- Square buttons across the app + topbar layout restore + Post New Job repositioned.
- Benefits + Agreements rendered as markdown via shared MarkdownProse.
- Court Mode palette v5 baseline (full hex refresh + new tokens — finalized in 32.0 sweep).
- Smoke test selector fixes (Apply to Job button → Link, Email field collision).

---

## Older completed history
Everything older than Ace 30.0 lives in `docs/ace/ACE_ARCHIVE_COMPLETED.md`. Includes Ace 29.0 / 27.0 / 26.0 / 25.0 / 24.0 / 23.0 / 18.0 with full per-prompt detail. Killed-feature list above already incorporates the bans from those earlier rounds (Stage-Triggered Template Actions, anonymize-attachment checkbox, top tabs on candidate profile, etc.).
