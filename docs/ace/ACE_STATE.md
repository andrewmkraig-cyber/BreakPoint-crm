# Ace - Current State

## Last Session
Date: 2026-04-24
Session: Ace 16.0
Last commit: 61e220f

## Phases Complete
- Phase 0: Project scaffolding, Neon DB, NextAuth Google OAuth
- Phase 1: Candidate management, resume parsing, email infrastructure
- Phase 2: Job management, pipeline, submittal workflow
- Phase 3: Client management, placement lifecycle, file storage
- Phase 4: Interview scheduling, dual Google Calendar invites, Meet links
- Phase 5: RF fully removed. recruiterflow.ts API half deleted. Types moved to rf-payload-shapes.ts. Hard tenancy enforced across all 20 models.

## Grep Baseline
- recruiterflow: 2
- RecruiterFlow: 17
- RfId: 1053
- listAllCandidates / listAllClients / listAllJobs: 0

## What Shipped in Ace 16.0
- Candidate page search bar: 300ms debounced, filters in place, no page reload, empty state
- Global header quick search: candidates + clients + contacts in grouped dropdown, keyboard nav, Escape closes, contact results land on Contacts tab
- docx resume preview via mammoth server-side
- Game Plan context depth: full resume + full JD sent to Claude, client loop capped at 10k chars per candidate
- Game Plan model ID routed through CLAUDE_MODEL constant in src/lib/claude.ts
- Editable contact card slide-over on client Contacts tab: 7 fields, Save/Cancel, updates in place without page reload
- Three GitHub doc files created: ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md

## Next Task
Week 2 sprint. Start with Mail Tab - Gmail integration inside Ace.

## Environment
- Repo: https://github.com/andrewmkraig-cyber/BreakPoint-crm
- Prod: https://ace.breakpointtalent.com
- Stack: Next.js 14, TypeScript, Tailwind, shadcn/ui, Prisma, Neon Postgres, NextAuth Google OAuth, Vercel
- Deploy: npx vercel --prod --yes --force (auto-deploy from GitHub broken due to account mismatch)
- Local: cd /Users/andrewkraig/Projects/breakpoint-crm then claude --resume
