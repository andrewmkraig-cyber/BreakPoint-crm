# ACE_STATE.md
Last updated: 2026-05-08 · Ace 36.7

## Current Status
Current Version: Ace 36.7 (Wide-screen content cap at 1600px)
Last Shipped: Ace 36.7 — May 8, 2026
Live at: ace.breakpointtalent.com

## Summary — Ace 36.7
Re-applied the wide-screen breathing room on the AppShell `<main>` after the 36.6 revert. Andrew specified `max-w-[1600px]` (slightly wider than 36.6's `max-w-screen-2xl` = 1536px) as the cap so wide monitors get more table real estate before centering kicks in. Audited tables and grids:
- All four list-page tables (candidates / clients / jobs / pipeline) already use `w-full` inside their wrappers, so they fill the new 1600px cap automatically — no per-table changes needed.
- Dashboard KPI strip is already `md:grid-cols-6` for its 6 KPI tiles; bumping to xl:grid-cols-7 would create an empty cell. Billing Tower's body is `sm:grid-cols-2` for 2 metrics; same logic. No grid changes needed.
- AppShell main now: `... md:p-8 md:pl-4 md:pt-4 xl:mx-auto xl:w-full xl:max-w-[1600px] xl:px-8 2xl:px-12`. md and below untouched per the brief.

## Summary — Ace 36.5
Two distinct Spotify bugs the recruiter flagged after 36.4:

Bug 1 — artist page showing "0 followers" + Play not working:
- Artist endpoint now returns `followers: number | null` instead of defaulting missing fields to `0`. Panel hides the row entirely when null and only renders a count when Spotify explicitly provided one (including an explicit zero).
- Artist Play already routes through `playContext` → `PUT /api/spotify/play` with `{ context_uri }`; the fallback to `spotify:artist:${id}` is now applied in both the route and the panel button so we never hand Spotify an empty context_uri.
- /api/spotify/play passes the upstream HTTP status through verbatim instead of collapsing every non-2xx to 502. The panel branches distinct toasts off 401 (session expired / reconnect), 403 (Premium / device / scope — no playlist-ownership copy), 404 (artist or context not found), and other (generic).

Bug 2 — Andrew's own playlists ("Lifting") wrongly showing the API restriction copy:
- /api/spotify/playlist-tracks/[id] now fetches /v1/me alongside the header + tracks calls and returns `ownerId`, `meId`, and `tracksStatus` (real upstream HTTP status, not collapsed). The route no longer composes a user-facing message server-side — that path can't tell whether the playlist is the recruiter's own.
- Added `classifyPlaylistTracksError(status, ownerId, meId)` in SpotifyPanel.tsx as the single source of truth for the inline message: 401 → reconnect, 404 → "couldn't find this playlist or its tracks", 403+owner≠me → dev-mode restriction copy, 403+owner=me → auth/permission refresh copy, other → generic with status code. Court Mode styling preserved; only the message text changes.

## Summary — Ace 36.4
Two follow-ups requested after the 36.3 deploy:
- Weather widget WMO dispatch unified behind a single `bucketFor(code)` switch with an explicit `WeatherBucket` enum so icon / color / description can't drift apart again. All Open-Meteo WMO codes (0, 1, 2, 3, 45, 48, 51-57, 61-67, 71-77, 80-86, 95-99) have explicit cases; anything outside the chart lands in an `unknown` bucket and emits a `console.warn` so we notice if Open-Meteo expands the chart. Replaced the bulk JSON dump with a focused `console.log` of the current weathercode + dispatch decision + first 6 hourly + first 7 daily codes, so verifying a wrong icon takes one console line instead of expanding a tree.
- YouTube panel: drag handle was a 280x36 sliver (the hover pill) which the recruiter found hard to grab. Added an always-on transparent drag strip spanning `top-0 left-0` to ~200px from the right edge at z-[6] — sits above the iframe so its pointerdown wins, but below the hover pill at z-10 so pill buttons still take priority where they overlap. The 200px right-side channel leaves YouTube's top-right native chrome (volume / CC / settings) fully clickable.

## Summary — Ace 36.3
Round-3 fixes after Andrew flagged that the cream header in 36.2 broke the premium feel and that artist pages had regressed:
- YouTube panel: full-bleed iframe restored. The 36.2 header bar above the iframe is gone; controls now live in a single hover-only glass pill anchored top-LEFT (rounded, semi-transparent black, backdrop blur, ring-1 white/10) with `pointer-events-none` when invisible so it never swallows clicks meant for the iframe. Anchored left so the YouTube native chrome at the top-RIGHT (volume / CC / settings) is fully clickable; channel-avatar / Subscribe are intentionally covered since the recruiter never reaches for them from inside Ace. Bottom-left 200x64 click-blocker for Share + Watch-Later still in place.
- Spotify artist endpoint: reverted `market=from_token` (deprecated by Spotify in 2025, returns 400) back to `market=US` for top-tracks and added `market=US` back to the albums sub-call. This was the actual cause of "0 followers / empty top tracks / empty discography" — `from_token` 400ed and the panel rendered the empty arrays. Playlist + album detail routes also restored to `market=US` since stripping it had no observable benefit.
- Spotify 403 inline message rewritten: the dev-mode restriction is broader than just editorial / algorithmic playlists — it covers ANY playlist not owned by the authenticated user. Wording now reflects that ("Spotify limits API access to playlists you didn't create yourself").

## Summary — Ace 36.2
Follow-up after Andrew confirmed the 36.1 fixes only partially solved things:
- YouTube panel chrome lifted out of the iframe entirely. Our header bar (back / title / rewind / forward / speed / minimize / close) now lives ABOVE the iframe in a real flex slot at the top of the panel; the iframe occupies the area below `top-9`. Volume / CC / Settings (which YouTube actually places at the top-right of the iframe, not the bottom) are no longer obscured by our chrome. The legacy h-12 w-[160px] click-blocker that was sitting on top of those native buttons is removed; a smaller 200x64 click-blocker now covers the bottom-left Share + Watch-Later pills since YouTube doesn't expose params to remove them. The iframe is forced to 100%/100% via getIframe in onReady so the wrapper resize is honored.
- Spotify playlist/album detail route stops hard-failing on tracks-subcall errors. The header still loads; `tracksError` is included in the response and the panel renders a friendly "Spotify restricts API access to its editorial / algorithmic playlists" message + an Open-in-Spotify CTA in place of the empty list. This addresses the actual root cause of the recurring 0-tracks bug: Spotify's Nov 2024 dev-mode restrictions on API access to Spotify-owned playlists.
- CSP `connect-src` adds `https://api-bdc.io` (the BigDataCloud short-form host the SDK actually requests) alongside the existing bigdatacloud.net entry so the weather widget reverse-geocode lookup stops being blocked.

## Summary — Ace 36.1
Regression sweep on the floating panels and dashboard cards reported after the Ace 36.0 deploy:
- YouTube panel hover overlay split into two compact corner pills with `pointer-events-none` when hidden so the invisible bar no longer swallows clicks meant for YouTube's native CC/volume/settings controls or popup menus.
- Spotify playlist/album detail route hard-fails when the tracks subcall errors instead of silently rendering "0 songs"; market hardcoding dropped (`market=US` removed; artist endpoint switched to `market=from_token`) so Spotify resolves the market off the token instead of filtering legitimately playable rows out.
- Dashboard `Billing Tower`, `Today's Briefing`, and `Upcoming interviews` headings unified to 18px / 12px subtitle. Billing Tower and Upcoming Interviews are now collapsible with the same chevron + localStorage convention Today's Briefing already used.
- CSP `connect-src` adds `https://api.bigdatacloud.net` so the weather widget's reverse-geocode call (lat/lng → city) is no longer blocked.

## Summary — Ace 36.0
Floating YouTube + Spotify panels, daily-companion dashboard pills (Word, Quote, Chess, On This Day, Horoscope), Apple-News briefing redesign with cron pre-warm, weather widget, premium dashboard pass, and the final RF string sweep:
- Floating media panels for YouTube and Spotify with full draggable / resizable / minimize-with-audio shells.
- Six daily-companion pills on the dashboard bottom bar wired to Claude or public APIs and cached in Neon.
- News feed redesigned in Apple-News editorial style with a 6 AM ET Vercel cron pre-warm and NewsAPI replacing the prior Claude web search.
- Dashboard premium redesign (green tint surface, sage KPI tiles, Billing Tower, ambient shadow, tabular numbers).
- Weather widget on the topbar (Open-Meteo + geolocation, hover popover with current / 6-hour / 7-day forecast).
- Final user-facing RecruiterFlow string removed from the UI.

## Known Issues
None open. Browser verification of the new flows is Andrew's after deploy.

## Next Task
CSV candidate import (1-2 hr).

## What Shipped in Ace 36.0 (2026-05-07)
- **YouTube floating player**: draggable + resizable panel via YouTubePanelProvider, topbar Music-icon toggle, YouTube Data API v3 search proxied through `/api/youtube/search` (server-side API key, tenant-scoped), video-first playing state with iframe full-bleed, hover overlay controls (back / minimize / close), viewport boundary clamping on drag + window resize, minimize keeps the iframe mounted so audio continues, CSP fix adding youtube.com + youtube-nocookie.com to frame-src, 50 results per search with View More pagination via `?pageToken=`, channel search and channel view (`?channelId=` filter, `order=date`).
- **Spotify floating panel**: full Spotify-mobile-style UI, OAuth login via `/api/auth/spotify` with token + refresh cookies and transparent refresh through `spotifyApiProxy`, 3-tab bottom nav (Home / Search / My Library), Recently Played row on Home, Library tab with filter pills (All / Playlists / Albums / Artists / Podcasts) backed by `/api/spotify/playlists` + `/api/spotify/saved-albums` + `/api/spotify/followed-artists`, PlaylistView and AlbumView via shared detail route, ArtistView with top tracks + discography, full-panel Now Playing view with album art that scales via `flex-1 + object-contain`, minimize keeps audio playing, X closes and pauses via `/api/spotify/pause` + SDK disconnect, draggable + resizable shell, Spotify dark palette intentionally hardcoded (#121212 / #181818 / #1DB954 etc) scoped to `src/components/spotify-panel/`.
- **Word of Day pill**: Claude-generated word + definition cached in Neon `WordOfDay` model, demand-triggered daily reset (regenerates if today's row missing), click-to-expand popover, lives on the dashboard bottom bar.
- **Quote of Day pill**: Claude-generated quote + author cached in Neon `QuoteOfDay` model, click-to-expand popover, lives on the dashboard bottom bar.
- **Chess puzzle pill**: Lichess `/api/puzzle/next?difficulty=easiest` (~961 average rating), `react-chessboard` render, hint + show-answer flow on a wrong move, rating chip in popover header, streak tracker in localStorage (`ace.chess.streak` + same-day-failed guard), Back button + click-to-move added late in the session, day-stable cache so the puzzle doesn't change mid-day.
- **On This Day pill**: Claude-generated historical event for today's ET date cached in Neon `ThisDay` model, lives on the dashboard bottom bar (initial chip used Wikipedia REST then later moved into the briefing header — both routes cached in Neon).
- **Daily Horoscope pill**: Claude-generated via server-side proxy to dodge horoscope-app-api CORS, cached in Neon `Horoscope` model, sign configurable, lives on the dashboard bottom bar.
- **Dashboard bottom bar**: 6 pills — Chess, Word, Quote, On This Day, Horoscope, plus a Today's Briefing scroll anchor — consolidated into one row at the bottom of the dashboard. Later in the session the Word / Quote / Chess / On This Day / Horoscope chips moved into the briefing header itself; the bottom bar component has since been retired.
- **News feed redesign**: Apple-News editorial style with 4px colored left border per tab, pill-style tabs with per-topic accent colors, 4 tabs (Front Page / Public Accounting / Recruiting / AI & Tech — Local News dropped), one lead story + 3 list rows, collapsible header with localStorage persistence.
- **News feed cron**: 6 AM ET Vercel cron job at `/api/cron/news-feed` pre-generates that day's `DailyNewsFeed` rows for every tab, `CRON_SECRET` Bearer auth, `NEWS_API_KEY` (NewsAPI.org) replacing the prior Claude `web_search` round-trip — sub-2s response per tab vs the previous 25s timeout window. Topic queries use `searchIn=title` + phrase quotes + press-release domain exclusion to keep noise out.
- **Weather widget**: Open-Meteo `/v1/forecast` with browser geolocation (Cleveland fallback when permission denied), hover popover with current conditions + 6-hour hourly strip + 7-day daily forecast, custom day/night WMO icon dispatch including 2-tone partly-cloudy glyphs, 30-minute refresh interval.
- **Dashboard premium redesign**: green-tint page background, KPI cards with sage-tinted icon chips, Billing Tower in sentence case with primary Q2 billed-revenue focal + secondary cash-collected card, ambient layered shadows, tabular numbers across all stat displays, Activity Dashboard topbar title in Bricolage Grotesque to match the new Ace wordmark.
- **RF string sweep**: final user-facing RecruiterFlow string removed from the UI (last visible one had survived the earlier sweeps).

## What Shipped in Ace 35.0 (2026-05-07)
- Game Plan Context Depth: resume text via pdf-parse, raw JD text, internal recruiter notes, and client pipeline candidate resumes injected into every ai-workspace and Ace Assistant prompt. Applies to candidate, job, and client Game Plans plus Ace Assistant panel everywhere.
- Ace Assistant Phase 4 Data Access: search_candidates, search_jobs, search_clients, get_pipeline tools wired to live Neon. OR-logic scoring with stop words and plural handling. Historical pipeline queries merging placements and interviews. Clickable candidate and job links in results. Show more when results exceed display limit. Fixed open jobs intent, stage normalization, and conversation memory override bugs.
- Ace Assistant Phase 5 Actions and History: move_candidate_stage, add_note, draft_email action tools with confirmation card UI showing real entity names. Confirm executes Prisma write, Cancel dismisses. Claude History tab in Settings groups by conversationId, cleared chats preserved in Neon as separate conversation entries.
- Job Close and Delete: Close Job and Delete Job buttons on job overview page with inline confirmation. Ace Assistant can close or delete jobs via confirmation card with real job and client names.

## What Shipped in Ace 34.0 (2026-05-07)
- src/app/jobs/[id]/page.tsx: 6-tab JOB_TABS array (Overview / Job Description / Matches / Game Plan / Promote / Activity) + parseTab helper, default Overview, lazy per-tab data loads, JobTabs renders all from one source. Pipeline + Billing tabs deleted; ?tab=pipeline / ?tab=billing fall back to Overview.
- src/app/jobs/[id]/job-overview-tab.tsx + job-overview-quick-actions.tsx: snapshot facts grid, stage-count chip row reusing STAGE_ORDER/STAGE_LABELS/STAGE_TONE in the green-brand progression, quick-actions row (Edit Job stub, Find Matches, Copy Public Apply Link with toast, Generate JD stub), Search Health placeholder.
- src/app/jobs/[id]/job-description-tab.tsx: lifted raw-textarea state, Source URL row with Save URL + Parse Link, Raw paste row with Save Raw, GeneratedJdPreview card (Last generated relative timestamp + Copy JD), Internal Recruiter Notes textarea with save-on-blur.
- src/app/api/jobs/parse-url/route.ts: tenant-scoped route that always saves the URL first, fetches the page with desktop UA + 20s timeout, strips tags, sends to Claude (claude-sonnet-4-6) for JSON extraction, returns plain-text formatted result.
- src/app/api/jobs/generate-jd/route.ts: reads Job.rawJobDescription + structured metadata, calls Claude with the BreakPoint format spec, saves to Job.description + descriptionGeneratedAt, logs activity (job_description_generated), revalidates both URL shapes.
- src/app/jobs/[id]/job-overview-actions.ts: saveJobSourceUrl, saveJobRawDescription, saveJobInternalRecruiterNotes — all tenant-scoped.
- prisma/schema.prisma: Job gained sourceJobUrl, rawJobDescription, descriptionGeneratedAt, internalRecruiterNotes; new JobBoardStatus model + JobBoardStatusValue enum (NOT_CONFIGURED / READY / POSTED / SKIPPED) with @@unique([jobId, boardName]) and Job + Organization relations.
- src/lib/job-boards-shared.ts (NEW): pure client-safe constants + types (MAJOR_BOARDS, STATUS_ORDER, nextStatusValue, JobBoardStatusValueShared, MajorBoardName, MajorBoardDef). Zero Prisma deps.
- src/lib/job-boards.ts: server-only ensureMajorBoardsSeeded + listJobBoardStatuses helpers; re-exports the shared constants for source-stable server imports.
- src/app/jobs/[id]/promote-tab.tsx: PublicApplyLinkCard + Major Boards checklist + Local & Niche Boards add/edit/remove + Suggest Boards with Claude stub. Imports only from @/lib/job-boards-shared so PrismaClient stays out of the client bundle (/jobs/[id] route bundle dropped from 34.9 kB → 16.5 kB).
- src/app/jobs/[id]/job-board-actions.ts: tenant-scoped server actions — updateJobBoardStatus (cycle), updateJobBoardFields (notes/url/boardName on blur), addLocalNicheBoard (rejects duplicates against the unique index), removeJobBoard (refuses to delete majors).
- src/app/jobs/[id]/matches-tab.tsx (NEW): debounced search input with in-flight seq counter, results table with name/title/location/skills, Apply to Job button hits /api/placements at stage=APPLIED.
- src/app/api/jobs/search-candidates/route.ts (NEW): tenant-scoped tokenized candidate search (firstName / lastName / currentDesignation / currentOrganization / location contains insensitive; skills via String[] has), AND across tokens, alreadyApplied annotation from a Placement preflight.
- src/components/activity-feed.tsx + src/app/api/activity/[entityType]/[entityId]/route.ts: entityType union extended to include "job"; route pulls placements + interviews by both jobId cuid and numeric jobRfId, adds job_description_generated label.
- src/app/jobs/new/actions.ts: createJob now calls ensureMajorBoardsSeeded after Job.create so new jobs render Promote with the 6 majors immediately.
- src/components/ui/button.tsx: CLAUDE_PILL_CLASS exported constant, used by Find Matches button + 6 inline duplicates (mail Generate with Claude reply, email Generate, Generate Submittal, Parse with Claude on candidate intake, Summarize Terms agreements, Generate Summary benefits) so every Claude pill renders identically.
- src/components/game-plan/find-matches-button.tsx: switched from black bg-court-fg pill to CLAUDE_PILL_CLASS.
- src/app/candidates/[id]/local-candidate-actions.tsx + KeepCandidateButton: candidate-level resume action row (Add to List / Keep / Apply to Job / Add Note) lifted out of the sticky toolbar; toggleCandidateKept action writes Candidate.tags + mirrors raw.tags. Submit-to-different-job retired (Apply to Job covers it).
- src/app/jobs/[id]/pipeline-row-actions.tsx: Schedule labels renamed to "Schedule Interview" everywhere; local-placement-rows.tsx Submit/Schedule/Reject migrated to shared Button variants.
- ClaudePanelProvider on the root layout (Phase 3): page-aware context from usePathname, entityType + entityId sent in POST body, context pill in the header shows entity name, getEntityDisplayName helper + /api/claude-panel/entity-name route. buildClientContext / buildCandidateContext / buildJobContext fully cuid-only (no RF fallbacks).
- Mail composer height fix; mail thread auto-scroll to TOP of latest message; INBOX eyebrow + large heading dropped from /mail; compact Inbox header sits directly under the TopBar.
- Phone + mail viewport fix; focus-state polish; stale-placeholder sweep across Jobs.

## What Shipped in Ace 33.0 (2026-05-06)
- Ace Assistant Panel Phase 1: ClaudePanelMessage table in Neon (org-scoped), GET/POST/DELETE /api/claude-panel/messages, floating draggable/resizable panel mirroring mail thread popup, ClaudePanelProvider at root layout (survives navigation), chat-bubble topbar toggle, message history rehydrates from Neon on open, clear chat wipes Neon rows.
- Ace Assistant Panel Phase 2: /api/claude-panel/chat streams claude-sonnet-4-6 via NDJSON, Personal Trainer rules injected, web_search_20250305 enabled, freshness mandate, pulsing brand-color cursor while streaming, stream errors toast + drop empty bubble.
- Copy button + Email this button on every assistant bubble (reuses Game Plan components).
- Branded as Ace Assistant in all user-facing copy; internal files remain ClaudePanel.*.
- assembleResumeFromRf and collectUniquePipelineCandidates deleted; dropped RF imports across ai-workspace-context.ts.
- settings.json: Bash(git push:*) whitelisted.

## What Shipped in Ace 32.0 (2026-05-05)
- Game Plan Phase 3 — Email Context: getRecentTaggedEmails helper, ai-workspace route injects Recent Email Context block, Job Game Plan gets client email context via clientId, silent degrade on miss.
- Email History UI: TaggedThreadList component, GET /api/candidates/[id]/email-threads, GET /api/clients/[id]/email-threads, both org-scoped and deduped, opens floating viewer.
- Personal Trainer: PersonalTrainerRule model in Neon, 15 default rules seeded, personal-trainer-actions.ts, real-time GitHub sync to docs/ace/PERSONAL_TRAINER.md, all 5 Claude routes updated with buildPersonalTrainerBlock, Settings UI with Trainer + Rules sub-tabs.
- Settings Refactor: left-nav + dedicated page per category, 7 routes (appearance/notifications/connectors/email/branding/templates/personal-trainer), Templates renamed to Templates/Triggers with 3-tab strip, Branding server-rendered signature preview, phone unread-badge regression fixed.
- Topbar Txt/Call button: opens dial pad directly without navigating to Phone tab.

## Older history
Everything pre-Ace 32.0 lives in `docs/ace/ACE_ARCHIVE_COMPLETED.md`.
