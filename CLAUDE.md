# CLAUDE.md - Ace CRM Project Brain
# Loaded automatically every Code session. Do not delete or move this file.

## What This Project Is
Ace is a custom internal recruiting CRM for BreakPoint Talent (Andrew Kraig + Austin Barnard).
Internal use only. Not a SaaS product. Never add multi-tenancy, Stripe, public APIs, or
external-facing features. Build only what makes Andrew faster at recruiting.

Live: ace.breakpointtalent.com
GitHub: github.com/andrewmkraig-cyber/BreakPoint-crm
Stack: Next.js, Neon (Postgres), Prisma, Vercel, Gmail API, Quo (phone/SMS)

## Architecture Non-Negotiables (13 rules - enforced on every prompt)

1. RecruiterFlow is removed. No new RF dependencies. Ever.
2. Ace-native parity is mandatory. Every feature reads/writes Neon, not RF.
3. Primary key is Neon cuid everywhere. Never use numeric IDs as primary keys.
4. Banned vocabulary: "RF overlay", "RF enrichment", "optional RF sync", "fall back to RF", "RF as cache", "hybrid lookup". If you are about to write any of these, stop.
5. Step 0 grep is mandatory on every prompt touching candidate/job/client/placement/pipeline. Run grep before writing any code. Report counts. Do not proceed if counts look wrong.
6. Ace-native verification is the PRIMARY check. Never assume RF data is correct.
7. No partial migrations. Every refactor is atomic - ships complete or not at all.
8. Every server action, query, and route touching tenant data MUST scope by organizationId.
9. Every prompt includes a Regression Check step. Never skip it.
10. Help docs are nice-to-have, not blockers.
11. Git author email must be andrew@breakpointtalent.com or andrewmkraig@gmail.com.
12. Court Mode theme tokens only. No hardcoded hex colors anywhere in components.
13. Pipeline stage source of truth is Neon only. placement.stage is canonical.

## Step 0 Grep - Run Before Every Code Change

grep -r "recruiterflow" src/ --include="*.ts" --include="*.tsx" -l | wc -l
grep -r "RecruiterFlow" src/ --include="*.ts" --include="*.tsx" -l | wc -l
grep -r "RfId" src/ --include="*.ts" --include="*.tsx" -l | wc -l

Baseline: recruiterflow ~0, RecruiterFlow ~18, RfId ~1076
Report counts before writing any code. If counts increased from baseline, flag it.

## Code Prompt Rules
- Max 3 items per prompt. Never queue more.
- Read every file before editing it. Always.
- Always commit and push immediately after build succeeds (npm run build exits 0).
- Never hold changes waiting for browser verification.
- Browser verification is Andrew's responsibility after deploy, not a gate before push.
- Single terminal only. No parallel Claude Code sessions.
- Always end with: git push origin main
- Every feature ship must end with git push origin main. Never leave commits sitting locally. If the session ends without pushing, the next session must push before starting any new work.
- Dual-file awareness: when a feature spans two files, name both explicitly before editing.

## After Compaction
If "Compacting conversation" appears, the next prompt must:
1. Restate the in-progress task explicitly
2. Reference any uncommitted local files by name
3. Run git status before continuing
Never assume prior context survived compaction.

## Tenant Scoping
Every Prisma query touching these tables requires a WHERE organizationId clause:
Candidate, Client, Job, Placement, Interview, Contact, ActivityLog,
CandidateList, GmailThreadTag, CallLog, SmsMessage, CallTranscript

Default org: cmobj8dxz00012gliequ53kvc (BreakPoint Talent)
Austin user: cmo1ufmmn0000ib05eqk6hh32

## Design System
- Primary green: #5A9642 - hover: #3F7030
- Green used only for: primary buttons, active nav, active tabs, positive status chips
- Never: full-page green tinting, hardcoded hex in components
- Court Mode: data-surface (hard/clay/grass) + data-theme (light/dark) on html element
- All buttons use shared src/components/ui/button.tsx - no one-off button styling

## Key File Locations
- Phone webhook: /api/quo/webhook
- Mail AI compose: src/app/api/mail/ai-compose/route.ts
- Activity logging: src/lib/activity.ts
- Org helper: src/lib/auth/getCurrentOrg
- Placements: src/lib/placements.ts
- Interviews: src/lib/interviews.ts
- Contacts: src/lib/contacts.ts

## What NOT to Build (permanent)
- No Stripe, no billing, no pricing tiers
- No public REST API or MCP server
- No external SSO, SOC 2, or multi-tenant onboarding
- No AI agent features (auto-suggestions, approve/dismiss, next-best-action)
- No co-recruiter splits
- No candidate mood tracker
- No demo mode or sandbox toggle
