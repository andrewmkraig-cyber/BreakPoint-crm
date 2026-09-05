# ACE


Internal recruiting CRM for BreakPoint Talent.

Neon Postgres is the sole system of record: candidates, jobs, clients, contacts,
placements, invoices, and everything else live there and nowhere else. Ace is the
full-desk workflow end to end — sourcing, pipeline, submittals, interviews,
placements, invoicing, and goals — not a UI layer over another system.

## Stack


- Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui primitives
- Prisma ORM + Neon Postgres
- NextAuth (Google OAuth, restricted to `@breakpointtalent.com`)
- Google Calendar + Gmail APIs (interview invites, outbound email)
- Quo (OpenPhone) webhook + REST API (click-to-call / text, call + message sync)
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

- `/dashboard` — Clubhouse home. Also hosts the Placements, Metrics, and Goals
  tabs via `?tab=` (`placements` / `scoreboard` / `goals`)
- `/pipeline` — live pipeline of submitted candidates across all jobs
- `/candidates` — candidate pool, search rail, lists, bulk actions
- `/jobs` — active + inactive jobs with submittal / interview / hire counts
- `/clients` — client tiles, agreements, contacts
- `/mail` — Gmail inbox, composer, templates, scheduled sends
- `/phone` — Quo calls and texts
- `/calendar` — interviews and events
- `/campaigns` — bulk candidate email
- `/invoices` — invoices and retained searches
- `/expenses` — tool expenses and subscriptions
- `/notes` — free-form notes attached to candidates, jobs, and clients
- `/settings` — email templates, triggers, appearance, connectors, user management

`/bd` (business development) also exists and is fully live, but ships hidden in
the sidebar — see the note in `src/components/nav-items.ts`.
