# ACE_STATE.md
Last updated: 2026-05-07 · Ace 35.0

## Current Status
Current Version: Ace 35.0 (Game Plan depth + Ace Assistant Phase 4/5 + Job lifecycle)
Last Shipped: Ace 35.0 — May 7, 2026
Live at: ace.breakpointtalent.com

## Summary — Ace 35.0
Game Plan context, Ace Assistant data tools + actions, and Job lifecycle controls:
- Game Plan Context Depth: resume text via pdf-parse, raw JD text, internal recruiter notes, and client pipeline candidate resumes injected into every ai-workspace and Ace Assistant prompt. Applies to candidate, job, and client Game Plans plus Ace Assistant panel everywhere.
- Ace Assistant Phase 4 Data Access: search_candidates, search_jobs, search_clients, get_pipeline tools wired to live Neon. OR-logic scoring with stop words and plural handling. Historical pipeline queries merging placements and interviews. Clickable candidate and job links in results. Show more when results exceed display limit. Fixed open jobs intent, stage normalization, and conversation memory override bugs.
- Ace Assistant Phase 5 Actions and History: move_candidate_stage, add_note, draft_email action tools with confirmation card UI showing real entity names. Confirm executes Prisma write, Cancel dismisses. Claude History tab in Settings groups by conversationId, cleared chats preserved in Neon as separate conversation entries.
- Job Close and Delete: Close Job and Delete Job buttons on job overview page with inline confirmation. Ace Assistant can close or delete jobs via confirmation card with real job and client names.

## Known Issues
None open. Browser verification of the new flows is Andrew's after deploy.

## Next Task
YouTube floating player (15-30 min).

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
