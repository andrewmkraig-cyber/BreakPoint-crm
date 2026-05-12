# Ace Roadmap
Last updated: 2026-05-12 · Ace 40.0

## Active Build Sequence (v5)
In this order, per Ace_Final_Roadmap_v5.pdf. Each item ships start-to-finish before the next begins unless an explicit prereq is called out inline.

1. **BD Engine Phase 4 — Apollo + TheirStack wiring** *(next session)*. Wire the live data plane behind the Phases 1-3 UI: TheirStack job-discovery feed (per the JobDiscoveryProvider abstraction), Apollo enrichment + sequence enrollment, 6 AM ET Vercel cron picking up QUEUED BDRuns, Apollo webhook for opens / replies / bounces writing CampaignEvent + BDActivity rows, Reach-out mail composer pre-fill from Client Signal, scheduled email send via Gmail API. Approval queue: discovered companies park the BDRun at status `AWAITING_APPROVAL`, Andrew reviews on Today's Launch, Approve & Enroll fires Apollo.
2. **BD Engine Phase 5 — cleanup**. Secure storage for `APOLLO_API_KEY` so the Rotate button can move it out of env, real Instantly reputation pull for the Sending Domains reputation bar, real domain-cooldown derivation from DOMAIN_COOLED BDActivity events, Client Signal dismiss / acted-on flows, mapped Apollo sequence id pull (replaces the Phase 3 placeholder list).
3. **JD/email markdown architecture unification** *(pulled forward as workflow-blocking)*. Path A (`/api/jobs/generate-jd`) and Path B (`src/lib/claude.ts` `generateJobDescription`) both emit markdown. Single renderer (`react-markdown`) everywhere — `PlainProse` for Job.description is deprecated. Copy JD button puts HTML on the clipboard alongside plain text so it pastes bold into Gmail / Word. `[Job Description]` merge field in the Candidate Recruit template (and every other template) injects the HTML version into the email body so the recruiter doesn't have to manually re-bold sections after pasting.
4. **Mail composer dropdown clipping fix** *(pulled forward as workflow-blocking)*. `Use Template` and `Insert Field` dropdowns currently open downward and clip below the composer viewport. Open upward (or portal out) when the composer is anchored near the bottom of the viewport.
5. **Invoicing backend + Mercury integration**. Real invoicing workflow behind the new Invoicing tab on the dashboard. Mercury account integration so cash collected reads from the live bank balance, not a manual entry.
6. **Bulk email to candidates** — multi-candidate email send from the search surface. Drives off the row-checkbox / bulk action bar shipped in 38.1; composes a single Gmail draft per selected candidate with merge fields. **Scheduled send + 30-60 sec throttle + 5-domain rotation sharing the same warmed pool as BD outbound** so per-domain warm capacity isn't blown by combined volume. Activity-logged per recipient. Builds on the scheduled-send / queue infrastructure from BD Phase 4.
7. **Search expansion map** — geocoded map visualization over the Candidate Sourcing Surface. Render the candidates returned by the current filter set as pins on an interactive map so the recruiter can see geographic spread at a glance and lasso a region to refine. Pairs with the radius pills already shipped — same `lat`/`lng` columns power both.
8. **PWA conversion** — 1.5-3 hr. Manifest, service worker, push notifications.
9. **Quiet Clients tab** — 1-2 hr. New tab on `/clients`. Lists clients where the last touchpoint exceeded threshold (default 21 days, configurable in Settings). Columns: client name, days since last activity, last activity type, last activity date. Sortable by days, default longest first. Tiers: Check in soon 14-30 days / Going cold 30-60 / Cold 60+. Optional Claude summary at tab open. Reads from existing ActivityLog, no new schema.
10. **APRO / job order worksheet** — 2-3 hr. Structured intake form.
11. **Client preference learning system + Personal Trainer suggestions** — 6.5-9 hr combined. Replaces the killed auto-updating client preference memory and Ace learning layer Phase 1. Phases: Phase 0a client-side email thread tagging (1.5-2 hr prereq), Phase 0b client-side Quo call/SMS tagging (1-1.5 hr prereq), Phase 1 email preference scan + propose UI with daily cron and dashboard card (2-3 hr), Phase 2 Quo transcript preference scan (1.5-2 hr), Phase 3 note-write inline extraction (30-45 min), Personal Trainer rule suggestions bundled (1-1.5 hr). ClientPreference schema + right rail on client profile + submittal composer right rail. Monthly drift review first Monday of each month.
12. **Interview scheduler enhancements** — 1-2 hr. Edit/cancel/reschedule flows. **Verify Ace 39 reschedule status first** before opening new work here.
13. **One-click interview prep packet** — 1-2 hr. PDF for candidate pre-interview.
14. **Calendar tab** — 2-4 hr. Month/week/day, Google Calendar read-write sync, create-meeting modal.
15. **Market Insights + daily brief** — 2-4 hr. Word of day already built in Ace 36.0; this bundle covers the remaining market-insights pieces.

## Queued From Session
Items scoped during recent sessions. Each needs its own prompt before slotting into the active build sequence.

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
- **Microsoft Teams video interviews** — add "Microsoft Teams" as a second Type option in the interview scheduler alongside "Video (Google Meet)". Creates a Teams meeting via Microsoft Graph API and returns a Teams join link embedded in the calendar event. Requires Microsoft OAuth added to Settings > Connectors so the recruiter connects their Microsoft account. Eliminates the Google Meet Open vs Trusted access issue entirely since Teams allows anonymous join by default.
- **Resume text view with search highlighting** — add a "Text View" toggle button above the resume PDF on the candidate profile embed view. Switches from the PDF iframe to a styled HTML div rendering the candidate's extracted resume text from the DB (`CandidateResume.extractedText`). Search tokens from the active keyword / Boolean query are `<mark>`-highlighted in amber matching the search rail tokenizer (same one that drives the snippet enrichment). Toggle hidden when no extracted text exists.
- **Resizable split-view divider on `/candidates`** — drag handle on the boundary between the candidate name list (left) and the profile iframe (right) so the recruiter can make the name list narrower or wider to suit their screen size. Persist the chosen width in localStorage so it survives reloads.

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
- **Email sequencing platform** — full multi-step sequencing UI (cadences, branch logic, A/B subject lines, drip enrollment, unenroll-on-reply) layered on top of the BD outbound infrastructure. Larger scope than the Phase 4 sequence engine ships; revisit when bulk email + BD outbound stabilize and recruiter workflow demands the full surface.

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

## Completed - Ace 39.0 Sourcing Polish + Interview Scheduler v2 + Rejected tab (May 11, 2026)

Closed the candidate Rejected tab follow-up from 38.1 and the interview-scheduler queue item. Reapply landed as a clean-slate DELETE on both code paths.

- **Job Overview single full-width card** with one Edit / Save / Cancel toggle.
- **Matches tab cleanup** — Sort / Columns / Export pills removed (rail drives every cut), sidebar narrowed, bulk action bar trimmed to Apply / Add to List / Reject / Clear.
- **Rejected tab on `/jobs/[id]`** — surfaces every `stage="rejected"` Placement for the job. Reapply on each row.
- **Reapply = clean-slate DELETE** on every surface. RF path: `onUnrejectViaDelete` (stage="disqualified") + `unrejectCandidateJob` (stage="rejected"). Ace-native path: new `reapplyLocalPlacement` server action, org-scoped, deletes the row + writes ActionLog (`reapply_local_placement`) + revalidates by candidateId cuid. `LocalPlacementRows` mirrors jobs into local state and threads `onPlacementRemoved` so the row vanishes without waiting on `router.refresh()`.
- **Bulk reject permanent** — Matches-tab bulk reject now writes to Neon instead of popping from local state.
- **Button color sweep restored** — amber = Apply, light blue = Keep, red = Reject, green = Submit. New `reapply` Button variant uses soft violet (`bg-violet-50/100`, dark `bg-violet-950/40`) so the inverse of Reject reads as a different intent.
- **Dark mode sidebar tokens on `/candidates`** so the rail tracks Court Mode dark variants.
- **Sortable Last Apply + Last Action columns** on `/candidates`, nulls last.
- **Null snippet cleanup** — rows with no snippet match render nothing instead of an empty placeholder.
- **Zip-code geocoding via Nominatim `postalcode`** — 5-digit zip pills resolve to a real bounding box. Falls back to city-name lookup, then to `location ILIKE`.
- **Page headers bumped to 30px**; new-item buttons shrunk so the title carries the weight.
- **Bulk Apply to Job + Add to List** on both `/candidates` and the per-job Matches tab. Per-candidate writes through the existing single-row server actions wrapped in `Promise.all`, single toast summarizing the outcome.
- **Mail bulk move-to dropdown scrollable** for deep label trees.
- **Mail inbox auto-refresh every 30 s** with in-place reconciliation so scroll position survives.
- **Drag-to-label** in the mail sidebar — single thread or current selection drops onto a label to apply/move.
- **Mail attachment display + download** in the thread view — inline images, download chips for everything else.
- **Interview scheduler v2** — timezone selector (defaults to recruiter profile), past date blocking on Schedule (Reschedule still allows past), "Open meeting (anyone can join)" toggle defaulting ON for Video, native Google Calendar invites per party (candidate gets prep tips; client gets candidate details + résumé link; both get Accept / Decline / Maybe), template pre-population for both Candidate + Client composers via `getInterviewSchedulingTemplates()`, Meet settings deep link after a Video schedule, Back button preserving values (Schedule modal stays mounted; in-flight calendar event cancelled on Back).
- **Search term highlighting on the candidate profile** when entered from the rail (`?q=`) — same tokenizer that powers snippet enrichment.
- **Snippet inline with row, no internal divider**; full-width divider only at the row boundary; full-width split-view top divider so name list + profile column read as one chrome bar.

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
