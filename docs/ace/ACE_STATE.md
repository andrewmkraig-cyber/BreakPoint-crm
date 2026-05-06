# ACE_STATE.md
Last updated: 2026-05-06 - Ace 34.0a job detail tab shell + Overview tab

## Current Status
Current Version: Ace 34.0a (Jobs Page Layout Overhaul - first slice)
Last Shipped: Ace 34.0a - May 6, 2026
Live at: ace.breakpointtalent.com
Current Status: Ace 34.0a opens the Jobs Page Layout Overhaul. /jobs/[id] now renders an 8-tab shell (Overview, Job Description, Pipeline, Matches, Game Plan, Promote, Activity, Billing) using the existing UnderlineTabs segmented control + Court Mode tokens. Overview is the default landing tab. Existing Job Description and Game Plan content was relocated into their new tab slots (no rebuild). Pipeline / Matches / Promote / Activity / Billing render a "Coming soon" stub. Overview body shows snapshot facts (employment, location, status, compensation, fee %, openings, last edited), a stage-count chip row from Neon pipelineRows, four quick-action buttons (Edit Job stub, real Find Matches, Copy Public Apply Link, Generate JD with Claude stub), and a Search Health "Coming soon" placeholder. Right-rail EditableJobOverview stays sticky across tabs.

## What Shipped in Ace 34.0a (2026-05-06)
- src/app/jobs/[id]/page.tsx: 8-tab JOB_TABS array + parseTab helper, default Overview, JobTabs renders all 8 from one source, TabStub for unbuilt tabs, formatCompSummary + extractFeePct helpers (fee % parsed from Client.customFields, no schema change)
- src/app/jobs/[id]/job-overview-tab.tsx: new server component, snapshot facts grid, stage-count chip row reusing STAGE_ORDER/STAGE_LABELS/STAGE_TONE in same green-brand progression, quick-actions section, Search Health placeholder
- src/app/jobs/[id]/job-overview-quick-actions.tsx: new client component, FindMatchesButton wired through, Copy Public Apply Link writes navigator.clipboard with toast feedback, Edit Job + Generate JD stubs toast a hint

## Known Issues
None open. Browser verification of the 8 tabs is Andrew's after deploy.

## Next Task for Ace 34.0
Continue Jobs Page Layout Overhaul — flesh out Pipeline / Matches / Promote / Activity / Billing tab bodies, then Indeed Direct Phase 1 + Appcast syndication Phase 2. Game Plan Submit Button + Game Plan Context Depth follow.

## What Shipped in Ace 33.1 (2026-05-06)

## What Shipped in Ace 33.1 (2026-05-06)
- Candidate profile job bar: Submit / Schedule Interview / Reject ordering, Schedule label renamed (was "Schedule"), Reject added at Applied stage, Client Sending Invite gated to Submitted/Interviewing only
- Candidate-level resume action row above the resume: Add to List / Keep / Apply to Job / Add Note using shared Button variants secondary/keep/apply/secondary
- New toggleCandidateKept server action (writes Candidate.tags + mirrors to candidate.raw.tags) and KeepCandidateButton component
- Submit-to-different-job button retired from sticky toolbar - Apply to Job covers that workflow
- pipeline-row-actions.tsx Schedule labels renamed to "Schedule Interview" everywhere
- local-placement-rows.tsx Submit/Schedule/Reject migrated to shared Button variants

## Known Issues
None open.

## Next Task for Ace 34.0
Jobs Page Layout Overhaul + Job Board Integration (Indeed Direct Phase 1, Appcast syndication Phase 2), followed by Game Plan Submit Button, Game Plan Context Depth, then Ace Assistant Phase 4 (data access).

## What Shipped in Ace 33.0 (2026-05-06)
- Ace Assistant Panel Phase 1: ClaudePanelMessage table in Neon (org-scoped), GET/POST/DELETE /api/claude-panel/messages, floating draggable/resizable panel mirroring mail thread popup, ClaudePanelProvider at root layout (survives navigation), chat-bubble topbar toggle, message history rehydrates from Neon on open, clear chat wipes Neon rows
- Ace Assistant Panel Phase 2: /api/claude-panel/chat streams claude-sonnet-4-6 via NDJSON, Personal Trainer rules injected, web_search_20250305 enabled, freshness mandate, pulsing brand-color cursor while streaming, stream errors toast + drop empty bubble
- Ace Assistant Panel Phase 3: page-aware context from usePathname, entityType + entityId sent in POST body, buildCandidateContext/buildClientContext/buildJobContext called server-side, context pill in header shows entity name, getEntityDisplayName helper + /api/claude-panel/entity-name route
- buildClientContext fully rewritten: all legacyRfId / RF fallback logic removed, cuid-only, returns clear error on miss
- buildCandidateContext and buildJobContext also cleaned of RF references
- Route boundaries (/api/claude-panel/chat, /api/claude-panel/entity-name, /api/ai-workspace/route.ts) pre-resolve numeric slugs to cuids via getClientByIdentifier / getCandidateByIdentifier / getJobByIdentifier
- assembleResumeFromRf, collectUniquePipelineCandidates deleted; dropped RF imports across ai-workspace-context.ts
- Copy button + Email this button on every assistant bubble (reuses Game Plan components)
- Branded as Ace Assistant in all user-facing copy; internal files remain ClaudePanel.*
- settings.json: Bash(git push:*) whitelisted

## What Shipped in Ace 32.0 (2026-05-05)
- Game Plan Phase 3 - Email Context: getRecentTaggedEmails helper, ai-workspace route injects Recent Email Context block, Job Game Plan gets client email context via clientId, silent degrade on miss
- Email History UI: TaggedThreadList component, GET /api/candidates/[id]/email-threads, GET /api/clients/[id]/email-threads, both org-scoped and deduped, opens floating viewer
- Personal Trainer: PersonalTrainerRule model in Neon, 15 default rules seeded, personal-trainer-actions.ts, real-time GitHub sync to docs/ace/PERSONAL_TRAINER.md, all 5 Claude routes updated with buildPersonalTrainerBlock, Settings UI with Trainer + Rules sub-tabs
- Settings Refactor: left-nav + dedicated page per category, 7 routes (appearance/notifications/connectors/email/branding/templates/personal-trainer), Templates renamed to Templates/Triggers with 3-tab strip, Branding server-rendered signature preview, phone unread-badge regression fixed
- Topbar Txt/Call button: opens dial pad directly without navigating to Phone tab

## What Shipped in Ace 31.0 (2026-05-05)
- Game Plan Phase 2 - Find Matches: Claude-powered candidate matching on job + client Game Plan surfaces, streaming NDJSON, 6-band score color system, clickable score badge with per-axis breakdown popover (title/location/experience/comp), Copy + Dismiss buttons, one-click Apply to pipeline, job picker on Client Game Plan, per-entity state scoping, CandidateMatch table in Neon, Matched tab on job pipeline page (paginated 5/page, live-refreshes), excludes already-matched candidates on re-run, Reject button on cards and Matched tab rows, pipeline candidates auto-pruned from Matched
- Job Game Plan chat: full AiWorkspace chat on /jobs/[id]
- Sticky composer: textarea + Send always visible on all three Game Plan surfaces
- Auto-scroll fix: clicking Game Plan tab no longer jumps page to bottom
- Reply composer layout: composer top 60%, quoted thread below 40%, auto-focuses on open
- Claude API rules across all 5 routes: em dashes banned, emojis banned, clean copy-paste to Gmail
- Game Plan chat bubble: green tint removed, white background in light mode
- Minimized composer tray: no longer covers Settings button
- scoreBreakdown schema fix: missing Neon column caused production crash on /jobs, fixed via db:push

## What Shipped in Ace 30.0 (2026-05-05)
- Candidate header reorder + profile tab redesign: Currently at X moved below title/location line, Profile/Game Plan/Notes tab row restyled bolder, mail label nesting indent tightened 16px to 8px per level
- Dashboard edit-and-resend invite popup: calendar icon on Upcoming Interviews opens inline popup, Client + Candidate invite forms pre-filled from live Google Calendar event, updateInterviewInvite server action patches or creates fresh event
- Square buttons + topbar restore + Post New Job: Button default flipped rounded-full to rounded-md, all pill CTAs squared across app, topbar date restored to leftmost slot + FAB moved next to search, Post New Job moved onto Active/Inactive tabs row on Jobs page
- Benefits and Agreements markdown rendering: MarkdownProse component with react-markdown + remark-gfm, Benefits + Agreements tabs render with bold headers and clean bullets
- Court Modes Palette v5: all 7 court mode CSS variable blocks replaced with finalized hex values, new tokens (border-soft, sidebar-bg, fg-dim, accent-light, accent-mid, accent-border, full badge token family)
- Smoke test selector fixes: fixed getByLabel Email collision with ComposeFAB aria-label, fixed Apply to Job button converted to Link, smoke tests 1/1 green in 39 seconds
