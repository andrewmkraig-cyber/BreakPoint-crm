# Ace Roadmap
Last updated: 2026-05-08 · Ace 36.8

## Active Build Sequence
In this order. Each item ships start-to-finish before the next begins unless an explicit prereq is called out inline.

1. **CSV candidate import** — 1-2 hr.
2. **Postgres search indexes** — 30-60 min. Build immediately after CSV import so indexes are present before bulk loads.
3. **Candidate Sourcing Surface** — 4-6 hr combined effort. Full redesign of `/candidates` to match the Jobot Jax Quick Search layout. Left-rail faceted filter sidebar (keyword/Boolean search, skills, job titles, min/max comp, locations with distance, current employer, employer tenure, work auth, last apply date, last action date). Results table with checkbox, name, title, employer with tenure, location, salary, last apply, last action, candidate score, eye icon. All columns sortable. Split-view: clicking a candidate opens the profile as a slide-over overlay, list stays visible behind it, independent scroll regions. Same split-view pattern applied to `/pipeline`. Boolean search with AND/OR/NOT/parens/quoted phrases. Live filter updates debounced 300 ms. Total candidate count displayed. Apply `ACE_DESIGN.md` rules throughout.
4. **PWA conversion** — 1.5-3 hr. Manifest, service worker, push notifications.
5. **Quiet Clients tab** — 1-2 hr. New tab on `/clients`. Lists clients where the last touchpoint exceeded threshold (default 21 days, configurable in Settings). Columns: client name, days since last activity, last activity type, last activity date. Sortable by days, default longest first. Tiers: Check in soon 14-30 days / Going cold 30-60 / Cold 60+. Optional Claude summary at tab open. Reads from existing ActivityLog, no new schema.
6. **BD Engine block** — 12-19 hr total. Claude Design pass first (1-2 hr) for BD tab + BD Settings + Sequence builder UI before any code. Then in order: Scheduled email send (Gmail API send-at), Background job queue (Job table + Vercel Cron), BD tab surface (`/bd` page, Prospect table, BD feed), Apollo enrichment helper as standalone before cron, BD daily cron (6 AM scan Indeed API for public-accounting firms matching criteria, Apollo finds best contact, writes to Prospect table, deduplicates), Sequence engine + BD Settings (outbound sequences from Ace using warmed domains, Settings for keywords/titles/limit/cadence).
7. **APRO / job order worksheet** — 2-3 hr. Structured intake form.
8. **Client preference learning system + Personal Trainer suggestions** — 6.5-9 hr combined. Replaces the killed auto-updating client preference memory and Ace learning layer Phase 1. Phases: Phase 0a client-side email thread tagging (1.5-2 hr prereq), Phase 0b client-side Quo call/SMS tagging (1-1.5 hr prereq), Phase 1 email preference scan + propose UI with daily cron and dashboard card (2-3 hr), Phase 2 Quo transcript preference scan (1.5-2 hr), Phase 3 note-write inline extraction (30-45 min), Personal Trainer rule suggestions bundled (1-1.5 hr). ClientPreference schema + right rail on client profile + submittal composer right rail. Monthly drift review first Monday of each month.
9. **Interview scheduler enhancements** — 1-2 hr. Edit/cancel/reschedule flows.
10. **One-click interview prep packet** — 1-2 hr. PDF for candidate pre-interview.
11. **Calendar tab** — 2-4 hr. Month/week/day, Google Calendar read-write sync, create-meeting modal.
12. **Market Insights + daily brief** — 2-4 hr. Word of day already built in Ace 36.0; this bundle covers the remaining market-insights pieces.

## Queued From Session
Items scoped during recent sessions. Each needs its own prompt before slotting into the active build sequence.

- **Master-detail candidates layout** — list pane stays visible on the left while the candidate profile loads on the right; both panes scroll independently. Mirrors the Jobot Jax pattern. Will land naturally inside the Candidate Sourcing Surface (item 5) — track here so it isn't lost if priorities shift.
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
