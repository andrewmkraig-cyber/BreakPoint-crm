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
cp .env.local.example .env.local   # fill in DATABASE_URL, DIRECT_URL, GOOGLE_CLIENT_ID/SECRET, NEXTAUTH_SECRET
npm install
npm run db:deploy                  # apply migrations to the database
npm run dev
```

## Changing the database schema

Ace uses Prisma Migrate. Every schema change is recorded as a numbered SQL file
under `prisma/migrations/`, so the database can be rebuilt and any change can be
read back later.

```bash
# 1. edit prisma/schema.prisma
npm run db:migrate -- short-name-for-the-change   # writes the SQL, applies nothing
# 2. read the SQL it prints
npm run db:deploy                                 # applies it
npm run db:status                                 # confirm nothing is pending
```

`npm run db:push` is retired: it changed the database without recording anything,
which is how Ace ended up with no migration history.

`DIRECT_URL` is the same Neon database as `DATABASE_URL` with `-pooler` removed
from the host. Migrations cannot run through the pooler. Only the `prisma migrate`
commands read it; the app always uses the pooled `DATABASE_URL`.

Open http://localhost:3000 and sign in with your `@breakpointtalent.com` Google account.

## Pages

- `/dashboard` — weekly activity, billing tower, placement + cash metrics
- `/candidates` — pool of sourced / applied candidates (not yet submitted)
- `/inbox` — live pipeline of submitted candidates across all jobs
- `/jobs` — active + inactive jobs with submittal / interview / hire counts
- `/clients` — client tiles, agreements, contacts
- `/settings` — email templates, triggers, user management
