# Ace - Session Start

This is Ace, an internal recruiting CRM for BreakPoint Talent. Andrew is not a developer - explain in plain English, give paste-ready prompts, no jargon.

## On every session start, before doing anything:
1. Read all four canonical docs in docs/ace: ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md, ACE_DESIGN.md. These are the source of truth for state, rules, and what's been built.
2. ACE_STATE.md has the current version and the next task. Start there.
3. Follow every rule in ACE_RULES.md. Key ones: max 3 items per prompt, Step 0 grep before touching candidate/job/client/placement/pipeline code, browser-verify before commit, end every task with git push origin main, never commit untested code, no em dashes in user-facing copy.

## After a /clear:
Re-read docs/ace/ACE_STATE.md to recover the current task and state. The docs hold the memory, not the chat history. A clear does not lose context as long as these docs are current.

## Doc update cadence:
Product code commits never edit the four canonical docs. Docs update once, in one consolidated commit, at session end. Replace stale content, don't append.

## When state changes materially:
At session end, update ACE_STATE.md (what shipped), ACE_ROADMAP.md (mark done, set next), and ACE_RULES.md (any new permanent rule). Then this CLAUDE.md stays accurate because it just points here.
