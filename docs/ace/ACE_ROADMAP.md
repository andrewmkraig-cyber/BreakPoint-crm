# Ace Roadmap
Last updated: 2026-05-07 · Ace 34.0

## Active Next Tasks (priority order)

### Launch Sprint (ship before May 15)
1. **Game Plan Context Depth** — full resume + JD text into every ai-workspace prompt so Claude reasons against the actual content, not just metadata.
2. **Ace Assistant Phase 4** — data access tool calls (search candidates, jobs, clients, pipeline from the floating panel).
3. **Ace Assistant Phase 5** — actions + Claude history tab in Settings (propose move, send email, add note with confirm/edit/cancel UI; saved past conversations with summaries in Settings).
4. **RF string sweep** — 17 RecruiterFlow visible strings still in UI (includes the public apply link showing the RF URL).
5. **CSV candidate import** — bulk upload candidates from CSV into Ace.
6. **Boolean candidate search** — AND/OR/NOT operators on the Matches tab and global candidate search (extends the text-only search shipped in Ace 34.0).

### BD Engine (highest revenue impact)
7. **Scheduled email send prerequisite** — Gmail API send-at timestamp.
8. **Background job queue prerequisite** — Job table + Vercel Cron.
9. **BD tab surface** — /bd page, Prospect table, BD feed.
10. **BD daily cron + Apollo pipeline** — daily 6 AM cron scans Indeed for last-24hr public-accounting jobs (filter by company name + JD signals; discard staffing agencies + corporate in-house), Apollo enriches one best contact per company, writes to Prospect table, auto-enrolls in sequence.
11. **Sequence engine + BD Settings screen** — sending + tracking inside Ace, not Apollo. Settings for keywords / titles / limit / sequence cadence.

### Platform Depth
12. **Submittal tracker with read receipts** — invisible to client; if implementation would notify recipient, kill the feature.
13. **Candidate re-engagement engine** — flag candidates placed/cold 12-18 months ago; auto-draft re-engagement email for review.
14. **One-click interview prep packet** — PDF for candidate (company background, role summary, likely questions, Andrew's coaching notes). Coexists with the rich-text editor on the scheduler.
15. **Interview scheduler enhancements** — edit + cancel/reschedule (date / time / interviewers / location, refresh Calendar event, re-send notifications, optional cancel reason).
16. **Calendar tab** — dedicated /calendar surface (month / week / day, Google Calendar read-write sync, create-meeting modal).
17. **Market Insights tab + daily industry briefing + word of the day** — market briefs per client + Vercel Cron 6 AM EST daily public-accounting brief + vocabulary card on the dashboard.

### Ace Intelligence
18. **Job fillability score** — per-job scoring blending market, client, and pipeline signals.
19. **APRO / job order worksheet** — structured intake form populated from call transcription auto-fill.
20. **Ace learning layer Phase 1** — captures the patterns Ace observes across recruiter actions.
21. **Auto-updating client preference memory** — surfaces sticky preferences (comp ranges, interviewer cadence, must-haves) on each client profile.
22. **Relationship graph + placement pattern learning** — visualize candidate / client / placement edges to surface hidden BD opportunities.

### Proprietary Differentiators
23. **Live placement probability score** — 1-100 score per pipeline candidate, updated real-time from response time, interview progression, comp alignment, time-in-stage. Red/yellow/green on pipeline + candidate profile.
24. **Counteroffer risk flag** — at offer stage, pulls tenure, comp jump %, employer size, flags high counteroffer risk automatically.
25. **Client heat map** — clients active / going cold / overdue for touchpoint based on last activity. Red/yellow/green. Lives on the dashboard or `/clients/heat-map`.
26. **Fee tracker with Austin auto-notify** — confirmed-start placement calculates gross fee + Andrew 75% / Austin 25% split, Slacks Austin (`U0AJB4AM631`) the breakdown when start date is confirmed. Triggers off the `placement_confirmed` ActivityLog event.
27. **BD trigger alerts** — monitor LinkedIn + Indeed for job postings from existing clients; alert when an existing client posts a role Andrew isn't engaged on.

### Cleanup (do alongside other work)
28. **Sentry N+1 fixes** — ACE-CRM-5 (37 events), ACE-CRM-6 (28), ACE-CRM-7 (2), ACE-CRM-9 (1), ACE-CRM-A (1). Fix via Prisma include eager-loading.
29. **Compound-unique widening** — 3 Placement compound uniques missing organizationId.
30. **SmsMessage / CallLog / CallTranscript / AiWorkspaceMessage tenant-scoping**.
31. **MANUAL** — delete `RECRUITERFLOW_API_KEY` from `.env.local` and GitHub Actions secrets.
32. **MANUAL** — delete `src/lib/recruiterflow/` directory entirely.
33. **Invite flow in Settings** for adding team members (reuses existing OrganizationMembership table; invite + role chip + revoke).
34. **Quo setup wizard** — guided in-app flow in Settings to connect Quo, configure webhook URL, verify inbound SMS/call routing, confirm transcription is live.

### Post-launch
35. **GPT as second AI provider behind Ace Assistant**.
36. **YouTube floating player**.
37. **DocuSign auto-import**.
38. **Invoicing + QuickBooks + Mercury** — invoicing workflow, QuickBooks sync, Mercury account integration.
39. **Slack sidebar panel**.
40. **PWA conversion** — manifest, service worker, push notifications.
41. **Activity-to-revenue analytics**.
42. **Vercel Blob migration** — CandidateResume audit + migrate file bytes from Postgres to Vercel Blob.
43. **Postgres search indexes** — tsvector + GIN for fast Boolean search as DB grows.
44. **MPC feature** — Most Placeable Candidates surfacing.
45. **Settings fix generator** — small Settings utility to repair common data issues without touching the DB by hand.

### Deferred
46. **Multi-recruiter permissions** — build when team grows. Schema (`ownerId` on Client + Job, CandidateAccessGrant join), invite flow + manage team page in Settings, per-row permission checks on every server action.
47. **Candidate profile full redesign** — Jobot-style three-column layout. Killed earlier; revisit if recruiter feedback warrants.
48. **Job order + ARPO templates with call transcription auto-fill** — Krispcall / Google Meet / Teams transcripts feed structured worksheet.

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
