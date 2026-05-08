# ACE_RULES.md
Last updated: 2026-05-08 · Ace 36.6

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

## Design Rules
- Green #5A9642 only for: primary buttons, active nav, active tabs/pipeline stages, positive status chips.
- Never full-page green tinting or heavy green dark mode backgrounds.
- Reduce borders by ~40%, use spacing instead.
- Dark themes (Clay + Grass): charcoal/graphite base, NOT green. Green as accent only.
- No hardcoded colors anywhere.

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
