# ACE


Internal recruiting CRM for BreakPoint Talent, built on top of RecruiterFlow.

RecruiterFlow (RF) is the system of record: all candidate / job / client / contact data lives there. ACE is the daily-driver UI — cleaner, faster, and tailored to the full-desk workflow. We read/write to RF via its REST API. Local Postgres (Neon) holds only what RF doesn't: email templates, settings, user accounts, KPI cache, call logs, action history.

## Stack


- Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui primitives
- Prisma ORM + Neon Postgres
- NextAuth (Google OAuth, restricted to `@breakpointtalent.com`)
- RecruiterFlow REST API (primary data source)
- Google Calendar + Gmail APIs (interview invites, outbound email)
- Krispcall OAuth 2.0 (click-to-call / text, call log sync)
- Vercel for hosting

## Getting started

```bash
cp .env.local.example .env.local   # fill in DATABASE_URL, GOOGLE_CLIENT_ID/SECRET, NEXTAUTH_SECRET
npm install
npx prisma db push                 # create tables in Neon
npm run dev
```

Open http://localhost:3000 and sign in with your `@breakpointtalent.com` Google account.

## Pages

- `/dashboard` — weekly activity, billing tower, placement + cash metrics
- `/candidates` — pool of sourced / applied candidates (not yet submitted)
- `/inbox` — live pipeline of submitted candidates across all jobs
- `/jobs` — active + inactive jobs with submittal / interview / hire counts
- `/clients` — client tiles, agreements, contacts
- `/settings` — email templates, triggers, user management
