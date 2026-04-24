# Ace - Architecture Rules and Operating Instructions

## 13 Architecture Non-Negotiables

1. RF is fully removed as of Phase 5 (shipped 4/24/2026). src/lib/recruiterflow.ts API half deleted. Types and normalizers live in src/lib/rf-payload-shapes.ts. Zero live RF API calls anywhere. candidateRfId stays as nullable historical reference only - never queried, filtered, joined, or referenced in new code.
2. Ace-native parity mandatory. Every workflow must work end-to-end for fresh Ace-native records. Imported-only equals broken.
3. Primary key is Neon cuid always. No numeric IDs, no RF IDs, no hybrid lookups, no fallback chains.
4. Banned vocabulary in all new code: RF overlay, RF enrichment, optional RF sync, supplemental RF, fall back to RF, RF as cache, hybrid lookup.
5. Mandatory Step 0 on every Claude Code prompt touching candidate/job/client/placement/pipeline: grep src/ for recruiterflow, RecruiterFlow, RfId, listAllCandidates, listAllClients, listAllJobs, fromRf, pipelineRowsFromRf, flattenPipeline, localByCandidate. Report counts before acting. Post-Phase-5 expected baseline: recruiterflow 2, RecruiterFlow 17, RfId 1053. New code must not increase these counts.
6. Ace-native verification is PRIMARY. Imported-record verification is regression check only.
7. No partial migrations. Every feature is atomic - works end-to-end or does not ship.
8. Every server action, query, and route touching tenant data MUST scope by organizationId. No exceptions. Prisma middleware is belt-and-suspenders - explicit scoping still required in every query.
9. Every Claude Code prompt includes a Regression Check listing adjacent features verified. Smoke must pass. Uncovered flows verified manually with evidence.
10. Help doc for every feature written alongside the code. Missing help doc equals feature not done.
11. Git author email: andrew@breakpointtalent.com or andrewmkraig@gmail.com - both authorized.
12. Every new component uses Court Mode design system tokens. Never hardcoded colors. No bg-white.
13. Pipeline stage source of truth: Neon only. JobApplication for applied state, Placement for post-submit stages. One Neon query per job page feeds all rows, bucket counts, and action buttons.

## Session Opening (17.0+)

Fetch these three files at the start of every session before any other work:
https://raw.githubusercontent.com/andrewmkraig-cyber/BreakPoint-crm/main/docs/ace/ACE_RULES.md
https://raw.githubusercontent.com/andrewmkraig-cyber/BreakPoint-crm/main/docs/ace/ACE_STATE.md
https://raw.githubusercontent.com/andrewmkraig-cyber/BreakPoint-crm/main/docs/ace/ACE_ROADMAP.md

Apply doc hygiene rule, recite all rules, confirm next task and prompt ready to paste.

## Doc Hygiene Rule

At start of every session: identify stale rules, superseded plans, completed items still in active lists. Clean in one pass before other work. When a plan changes, replace - do not append. Completed items move to log only.

## Claude Code Prompt Rules

- Every prompt begins with the 5 RULES block. Prompt rejected without it.
- Before sending any prompt, state Rules I checked against this prompt with at least 4 rules listed. Fewer than 4 means rewrite.
- Max 3 items per prompt.
- Step 0 grep required on every prompt touching candidate/job/client/placement/pipeline.
- Browser-verify before commit. State the URL tested. Report what was seen, not just done.
- Single terminal only. Never parallel Claude Code sessions.
- After every feature ships, stop and tell Andrew exactly what to test and how. Do not queue or suggest the next prompt until Andrew confirms the feature works or flags bugs.

## Communication Rules

- Always give Claude Code prompts and answers as exact paste-ready blocks with plain English explanation before them.
- No developer jargon. Explain every step as if Andrew has never coded.
- Never mix answers and explanations - context first, then the exact text to paste in a clean block.

## Session Transition Protocol

When drifting or tasks complete: update ACE_STATE.md and ACE_ROADMAP.md as part of the final commit, then open a new chat and paste the 17.0+ opening prompt. Versions follow 17.0, 18.0, etc. No canvas creation needed.

## Other Rules

- Architectural decisions are made and documented by Claude in plain English with the why explained.
- Max 3 items per prompt. 7+ items result in incomplete implementation.
- Force fresh deploy when cache issues arise: npx vercel --prod --yes --force
- Resume session: cd /Users/andrewkraig/Projects/breakpoint-crm then claude --resume
- Comp conventions: contracting 79% markup (pay rate x 1.79 = bill rate), conversion fee 20% of first-year base, contract-to-hire 35% of bill rate x hours remaining until 520.
