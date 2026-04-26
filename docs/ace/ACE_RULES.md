# Ace - Architecture Rules and Operating Instructions

## 13 Architecture Non-Negotiables

1. RF is fully removed as of Phase 5 (shipped 4/24/2026). src/lib/recruiterflow.ts API half deleted. Types and normalizers live in src/lib/rf-payload-shapes.ts. Zero live RF API calls anywhere. candidateRfId stays as nullable historical reference only - never queried, filtered, joined, or referenced in new code.
2. Ace-native parity mandatory. Every workflow must work end-to-end for fresh Ace-native records. Imported-only equals broken.
3. Primary key is Neon cuid always. No numeric IDs, no RF IDs, no hybrid lookups, no fallback chains.
4. Banned vocabulary in all new code: RF overlay, RF enrichment, optional RF sync, supplemental RF, fall back to RF, RF as cache, hybrid lookup.
5. Mandatory Step 0 on every Claude Code prompt touching candidate/job/client/placement/pipeline: grep src/ for recruiterflow, RecruiterFlow, RfId, listAllCandidates, listAllClients, listAllJobs, fromRf, pipelineRowsFromRf, flattenPipeline, localByCandidate. Report counts before acting. Post-Phase-5 baseline: recruiterflow 2, RecruiterFlow 17, RfId 1070. The RfId baseline is approximate and may rise legitimately when new code reads schema columns (Placement composite key, Client.legacyRfId, Job.legacyRfId) for URL slugs, display, or historical reference. What is banned: any new active query, filter, branch, or API call that uses RfId values as live business logic. If a prompt's grep increase is purely Category A (schema column reads) or Category B (URL slug back-compat / display), the prompt is clean. If any line of the increase is Category D (active query/filter/branch on RfId values), abort and flag.
6. Ace-native verification is PRIMARY. Imported-record verification is regression check only.
7. No partial migrations. Every feature is atomic - works end-to-end or does not ship.
8. Every server action, query, and route touching tenant data MUST scope by organizationId. No exceptions. Prisma middleware is belt-and-suspenders - explicit scoping still required in every query.
9. Every Claude Code prompt includes a Regression Check listing adjacent features verified. Smoke must pass. Uncovered flows verified manually with evidence.
10. Help doc for every feature written alongside the code. Missing help doc equals feature not done.
11. Git author email: andrew@breakpointtalent.com or andrewmkraig@gmail.com - both authorized.
12. Every new component uses Court Mode design system tokens. Never hardcoded colors. No bg-white.
13. Pipeline stage source of truth: Neon only. JobApplication for applied state, Placement for post-submit stages. One Neon query per job page feeds all rows, bucket counts, and action buttons.

## Doc Hygiene Rule

At start of every session: identify stale rules, superseded plans, completed items still in active lists. Clean in one pass before other work. When a plan changes, replace - do not append. Completed items move to log only.

## Claude Code Prompt Rules

- Every prompt begins with the 5 RULES block. Prompt rejected without it.
- Before sending any prompt, state Rules I checked against this prompt with at least 4 rules listed. Fewer than 4 means rewrite.
- Max 3 items per prompt.
- Step 0 grep required on every prompt touching candidate/job/client/placement/pipeline.

### Grep Categories

A. Schema-derived: Prisma column access on existing tables (Placement.candidateRfId/jobRfId/clientRfId, Client.legacyRfId, Job.legacyRfId). Required by current schema. Allowed.
B. Slug / display back-compat: legacyRfId as URL slug, idOrRfId param naming, historical-tattoo reads for display. Allowed.
C. Comments and JSDoc: documentation references. Allowed.
D. Active rule violations: new query filters, branching logic, joins, or RF API calls keyed on RfId values. BANNED in new code.

When reporting Step 0 results: state the count, the delta from baseline, and which categories the delta falls into. Only Category D triggers an abort.

- Browser-verify before commit. State the URL tested. Report what was seen, not just done.
- Single terminal only. Never parallel Claude Code sessions.
- After every feature ships, stop and tell Andrew exactly what to test and how. Do not queue or suggest the next prompt until Andrew confirms the feature works or flags bugs.

## Communication Rules

- Always give Claude Code prompts and answers as exact paste-ready blocks with plain English explanation before them.
- No developer jargon. Explain every step as if Andrew has never coded.
- Never mix answers and explanations - context first, then the exact text to paste in a clean block.
- HYPERLINKS: Always format URLs as clickable markdown links using [text](url) format. Never plain text URLs. No exceptions. chrome:// URLs cannot be hyperlinked in Claude's interface - tell Andrew to copy/paste those manually.
- After every feature ships, Claude (this chat) explains what happened in plain English before summarizing Code's output. Never pass through Code's technical diagnosis raw. Translate it.
- All Claude Code prompts must end with: "Commit and push to prod first, then hand testing back to Andrew." Never hold commits pending browser verify - push to prod, Andrew tests on the live site.

## External Step Links (permanent)

When any task requires Andrew to do something outside Claude Code (Google Cloud Console, Vercel, GitHub settings, Stripe, DocuSign, Mac system settings, etc.), Claude must always provide the exact clickable URL. Never describe a navigation path without the link. Andrew is not a developer - every external step needs a direct URL plus step-by-step instructions written in plain English.

## Session Opening Protocol (22.0+)

Use the GitHub MCP integration to read these four files from the andrewmkraig-cyber/BreakPoint-crm repo, main branch, at the start of every session before any other work:
- docs/ace/ACE_RULES.md
- docs/ace/ACE_STATE.md
- docs/ace/ACE_ROADMAP.md
- docs/ace/ACE_DESIGN.md

After fetching, in order:
1. Apply doc hygiene rule
2. Recite all architecture non-negotiables plus prompt rules and communication rules
3. Confirm next task from ACE_STATE.md
4. Give the first Claude Code prompt paste-ready
5. Give a Session Brief: ships planned this session + realistic time estimate for Andrew's side only

Note: raw.githubusercontent.com is blocked in Claude chat. GitHub MCP reads private repos directly - no public URL needed.

## Session Transition Protocol

When drifting or tasks complete: update ACE_STATE.md and ACE_ROADMAP.md as part of the final commit, then open a new chat and paste the 17.0+ opening prompt. Versions follow 17.0, 18.0, etc. No canvas creation needed.

## Other Rules

- GitHub is the primary source of truth for cross-chat handoff. The four ACE_*.md files (ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md, ACE_DESIGN.md) are how each Ace chat hands off to the next. Slack canvases and printed PDFs are secondary references for Andrew only. Every Ace chat must end with a commit updating these docs. If the docs are not updated, the handoff failed and the next chat starts blind.
- Architectural decisions are made and documented by Claude in plain English with the why explained.
- Max 3 items per prompt. 7+ items result in incomplete implementation.
- Force fresh deploy when cache issues arise: npx vercel --prod --yes --force
- Resume session: cd /Users/andrewkraig/Projects/breakpoint-crm then claude --resume
- Comp conventions: contracting 79% markup (pay rate x 1.79 = bill rate), conversion fee 20% of first-year base, contract-to-hire 35% of bill rate x hours remaining until 520.

## Compaction Recovery + Hyperlink Rules (added 2026-04-25)

- After ANY compaction event in Code (when "Compacting conversation" appears), the next prompt MUST explicitly restate the in-progress task and reference any uncommitted local files. Do not assume Code remembers what it was working on.
- Never run background /loop tasks during active feature work.
- /clear in Code between every two feature ships. Do not chain features in one Code session.
- Sessions over 3 hours or 5+ feature ships approach compaction risk. Proactively /clear before that threshold.
- GitHub doc updates are additive-only. Deferred items stay verbatim in ACE_ROADMAP.md until Andrew explicitly cancels them.
- ACE_DESIGN.md is a 4th required fetch at session open alongside ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md.
- Architecture Non-Negotiable #10 (help docs required for every feature) is RELAXED to nice-to-have. Andrew is not selling Ace as SaaS. Code can write help docs when natural but does not gate-keep on missing help doc.

## Audit + Recovery Rules (added 2026-04-26)

- Cross-chat audits must read every Ace chat in full via conversation_search before pulling items into roadmap. Canvas content lags chat content by hours or days. Items promised in chat get half-recorded in canvas.
- Audit output must separate items Andrew explicitly requested from items Claude proposed. Anything Claude generated as a suggestion goes in a "Proposed by Claude" bucket, not the active roadmap.
