# ACE_RULES.md
Last updated: 2026-05-22 · Ace 63.1

## How to Start Every Session
Every Ace session opens with this exact sequence:
1. Read ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md, and ACE_DESIGN.md from project files.
2. Apply the doc hygiene rule.
3. Recite all rules back to Andrew.
4. Confirm the next task from ACE_STATE.md.
5. Give the first prompt paste-ready.

Opening prompt format: "This is Ace X.0. Read ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md, and ACE_DESIGN.md from the project files. Apply doc hygiene rule. Recite all rules. Confirm next task from ACE_STATE.md and give the first prompt paste-ready. First task is [task]."

## How to Launch Claude Code
Always launch with: claude --dangerously-skip-permissions
Never omit this flag. Never suggest launching any other way.

## Communication Rules (All Responses)
- Always format URLs as clickable markdown hyperlinks. Never plain text.
- Explain everything in plain English before giving a prompt. Andrew is not a developer.
- Step-by-step explanations for anything technical. No developer jargon.
- Paste-ready prompt blocks only. Plain English explanation first, then a clean paste box.
- Concise. No fluff. No hedging. No em dashes. Use hyphens.

## Doc Hygiene Rule (Every Session Start)
At the start of every session, before any other work:
- Pull ACE_STATE.md and identify stale rules, superseded plans, completed items still in active lists.
- Clean in one pass. When a plan changes, replace - do not append.
- Completed items move to log only.

## Doc Update Cadence (Added 2026-05-07 · Ace 34.0)
Doc updates happen once at end of session only. Do not update ACE docs on every commit. Each commit edits product code or schema, never the four canonical docs (ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md, ACE_DESIGN.md). At session close, do one consolidated doc-update commit that reflects everything that shipped.
All time estimates calibrated against actual build pace: Game Plan Context Depth = 20-30 min, Ace Assistant Phase 4 = ~1 hr. Use these as baseline when estimating future prompts.

## Code Prompt Rules
- Max 3 items per prompt. No exceptions.
- Step 0 on every prompt touching candidate/job/client/placement/pipeline: grep for relevant files and report exact counts before writing any code.
- Browser-verify before every commit. Code must report what it saw, not just "done."
- Dual-file awareness: always name BOTH files when a feature touches more than one.
- Single terminal only. Never suggest parallel Claude Code sessions or multiple terminals.
- Always end every prompt with: git push origin main
- Never commit untested code.
- After every feature ships: stop and give Andrew a plain English test plan before moving to the next prompt. No exceptions.
- Before writing any prompt requiring specific context: ask Andrew the needed questions first.
- /clear between every two feature ships.
- Never run background /loop tasks during active feature work.
- After any compaction event in Code: next prompt must explicitly restate the in-progress task and reference any uncommitted local files.

## Git Rules
- Always push at the end of every prompt with git push origin main. Do not wait for Andrew to ask.
- Every feature ship must end with git push origin main. Never leave commits sitting locally. If the session ends without pushing, the next session must push before starting any new work.
- Git author email: andrew@breakpointtalent.com OR andrewmkraig@gmail.com.
- GitHub source of truth: https://github.com/andrewmkraig-cyber/BreakPoint-crm/main/docs/ace/
- Four canonical files: ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md, ACE_DESIGN.md.
- GitHub doc updates are additive-only. Never delete history.
- ACE_DESIGN.md is the 4th required fetch on every session open.
- If docs are not updated at session end, the handoff failed.
- After every task, commit and push immediately without waiting for confirmation. Use descriptive commit message. Never hold changes waiting for approval.

## Test Plan Rules
- Claude (chat, not Code) writes every post-ship test plan in plain English.
- Code verifies internally and reports results. User-facing test steps come from Claude only.
- When Code ships something, Claude translates what happened into plain English. Never pass through stack traces raw.
- Andrew must test and confirm before the next task ships.

## Architecture Non-Negotiables (13)
1. RecruiterFlow is removed. No new RF dependencies.
2. Ace-native parity is mandatory.
3. Primary key is Neon cuid, always.
4. Banned vocabulary: RF overlay, RF enrichment, optional RF sync, fall back to RF, RF as cache, hybrid lookup.
5. Mandatory Step 0 grep on every prompt touching candidate/job/client/placement/pipeline.
6. Ace-native verification is the PRIMARY check.
7. No partial migrations. Refactors are atomic.
8. Every server action, query, and route touching tenant data MUST scope by organizationId.
9. Every Code prompt includes a Regression Check step.
10. Help docs - RELAXED to nice-to-have.
11. Git author email: andrew@breakpointtalent.com OR andrewmkraig@gmail.com.
12. Court Mode theme tokens. No hardcoded colors.
13. Pipeline stage source of truth: Neon only.

## BD Phase 4 Rule (added 2026-05-12 · Ace 41.0 — permanent, never skip)
Claude must ask Andrew a full set of scoping questions before writing any BD Phase 4 prompt. Do not skip this even if Andrew says "start BD Phase 4" or "let's go." Andrew's standing direction is that Discovery + Client Signals + approval queue matters more than fully automated send magic, and not every Phase 4 automation ships for launch. The required questions are listed in ACE_STATE.md under the BD Phase 4 Rules section of Next Task. Re-read that section every time the next session opens against BD Phase 4 — the questions are the gate, not a suggestion.

## BD Engine Rules (added 2026-05-12 · Ace 40.0)
- **Data provider stack**: TheirStack is the Phase 4 job-discovery provider. The architecture is the `JobDiscoveryProvider` abstraction — every discovery feed (TheirStack now, possibly more later) implements the same interface so swaps don't ripple through caller code. Adzuna is a possible later addition as a coverage benchmark. JSearch is fallback only. Indeed Publisher API is gated and likely rejected — do not block the BD roadmap on it. ZipRecruiter Partner application was sent in parallel; if it's approved, it slots in as a secondary provider behind the same abstraction.
- **Vercel cron uses UTC, not ET**. 6 AM ET = 10:00 UTC currently, 11:00 UTC after DST. Vercel does not retry failed crons — Ace owns retries via the BDRun state machine (status fields and explicit re-queue actions).
- **BD approval queue**: discovery runs surface companies, the BDRun stops at status `AWAITING_APPROVAL`, Andrew reviews on Today's Launch, Approve & Enroll fires Apollo. No silent auto-enroll.
- **Shared warmed domain pool**: bulk email to candidates and BD outbound share the same 5 warmed domains. Combined daily volume must stay under per-domain warm capacity (~30-50/day per domain). The send scheduler accounts for both queues — they do not have independent budgets.
- **Apollo API key**: stored in Vercel as `APOLLO_API_KEY`. Apollo Professional plan does not allow scoped keys, so the master key is the only option — name it "Ace BD Engine" so revocation has a clean audit trail.

## Job + JD Rules (added 2026-05-12 · Ace 40.0)
- **Job slug is the cuid**. `createJob` returns `slug: job.id` (the cuid). `/jobs` row navigation routes via the cuid carried on `_aceJobId` (the RFJobWithAce shim's carry-along), never `legacyRfId` and never the synthetic negative djb2 hash of the cuid. The djb2 hash exists only as a numeric stand-in inside the `RFJob.id` field for shim compatibility — it must never appear in a URL.
- **JD generators both emit markdown**. Path A (`src/app/api/jobs/generate-jd/route.ts`) and Path B (`src/lib/claude.ts` `generateJobDescription`) both produce GitHub-flavored markdown with `##` / `###` headings and `-` bullets. Single renderer: `react-markdown` everywhere `Job.description` is displayed. The `PlainProse` renderer for `Job.description` is **deprecated** — do not introduce new callsites.

## Design Rules
- Green #5A9642 only for: primary buttons, active nav, active tabs/pipeline stages, positive status chips.
- Never full-page green tinting or heavy green dark mode backgrounds.
- Reduce borders by ~40%, use spacing instead.
- Dark themes (Clay + Grass): charcoal/graphite base, NOT green. Green as accent only.
- No hardcoded colors anywhere.

## Button Standard (added Ace 54.0 - DO NOT CHANGE)
- Action row buttons (Submit, Apply, Keep, Reject, Add Note, Add to List): rounded-md, outlined, colored border + text, transparent background.
- Toolbar buttons (Use Template, Insert Field, Edit with Claude, Delete, Save Draft, Send): rounded-md, outlined, NOT pill shaped.
- Generate with Claude / Generate Resume / Generate JD: rounded-md, dark green outlined (`border-court-brand-dark text-court-brand-dark`), NOT solid filled.
- Primary CTA (New Candidate, New Job, + New X at page tops, Save, Create): rounded-md, filled green (`bg-court-brand text-white`).
- Upload Resume: rounded-md, blue outlined (`border-blue-500 text-blue-600`).
- Tab strip active: `rounded-md border-court-brand text-court-brand font-semibold` transparent background.
- NEVER use `rounded-full` on any button. `rounded-full` is reserved for badges, chips, status pills, and avatars ONLY.

This rule supersedes the older "All buttons are rounded-full" line in the Ace 24.0 Button System section of ACE_DESIGN.md. ACE_DESIGN.md carries the same Button Standard block — both docs hold the same source of truth.

## UI Consistency Rules (added 2026-05-12 · Ace 43.0)
- **TabStrip is the single source of truth.** All tab strips and filter pill groups across the app route through `src/components/ui/tab-strip.tsx`. No one-off pill groups anywhere — if a new surface needs filter pills or a tabbed selector, use TabStrip (link mode for navigation, controlled mode for in-page state).
- **Clubhouse is the card-sizing reference.** Every dashboard / list-page card matches the Clubhouse tab's two-tier pattern: small KpiTile chrome (`rounded-2xl bg-court-surface px-3 py-2.5 shadow-[0_1px_2px..0_8px_20px..]`, 10px extrabold label, 26px serif value) for inline KPI rows; big-panel chrome (`rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px..0_12px_32px..]`) for everything else. No bordered `shadow-sm` panels on dashboard / placements / invoices surfaces.
- **No em dashes (—) in user-facing copy.** Hyphens (-) only. The em-dash placeholder for null values inside table cells stays (it's a typographic empty-state cue, not copy). This rule extends the Communication Rules ban into all rendered product copy — headers, subtitles, hints, tooltips, toasts, empty-state strings.

## Visual Work Rules (added 2026-05-17 · Ace 53.0)
- **Read actual file contents before writing any prompt.** The Ace 53 redesign attempt failed because prompts were written against assumed file shapes; the real files diverged and changes drifted. Every visual-pass prompt must start by reading the target file in full so the diff lands on the actual code, not the imagined code.
- **Build shared chrome components before any per-page visual work.** `PageWrapper` and `SectionCard` first. The Ace 53 redesign sweep broke because each page held its own chrome - a per-page edit looked right in isolation but drifted from siblings instantly. New rule: when a visual change touches more than one page, the shared primitive lands first and the per-page conversion is a separate prompt.

## Decisions Delegated to Claude
- Andrew delegates now/later build decisions to Claude.
- Regressions and workflow-blocking bugs fix immediately. Cosmetic items go to backlog.
- Tech decisions delegated to Claude. Claude decides, explains in plain English, documents in ACE_DESIGN.md.

## Killed Features (Do Not Build)
- Top tabs on candidate profile, header showing candidate/job notation
- Anonymize attachment checkbox, Notes for Client/Candidate on interview scheduler
- Send email separate from calendar invite checkboxes
- Recruiter Selector / Split with Recruiter
- Side tag on templates, co-recruiter splits
- Stage-Triggered Template Actions System
- MCP Connection, AI Agent features, candidate mood tracker
- All SaaS/productization: BYOC, Stripe, public REST API, MCP server, SOC 2, external SSO, demo mode, ZDR

## Audit Methodology Rule (Added 2026-04-26)
Cross-chat audits must read every Ace chat in full via conversation_search before pulling items into the roadmap. Audit output must separate items Andrew explicitly requested from items Claude proposed. Never bury Claude proposals as if they were Andrew requests.

## Product Context
- Ace is internal only. No productization.
- Live at: https://ace.breakpointtalent.com
- Launch target: 2026-05-15
- Build canvas: F0ATXA0ME9Z | BD vision: F0AUYBTPK4K | Recovery audit: F0AVDPEQQTW
