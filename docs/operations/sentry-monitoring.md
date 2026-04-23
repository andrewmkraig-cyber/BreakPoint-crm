# Sentry monitoring

## What it does

Sentry captures every unhandled error, rejected promise, and failed request in Ace — both in the browser and on the server — and ships the stack trace, a session replay, and contextual metadata to the BreakPoint Talent Sentry org. It's our "something broke in prod" alarm: if a recruiter hits an error screen or a server action throws, we see it without them needing to report it.

The wizard wired up four entry points:

| File | Runtime | What it captures |
|---|---|---|
| `src/instrumentation-client.ts` | Browser | Unhandled JS errors, rejected promises, router-transition errors, 10% sampled session replays (100% when an error occurs) |
| `sentry.server.config.ts` | Node (server components, server actions, API routes) | Thrown exceptions, failed Prisma queries, unhandled Gmail/RF/Google Calendar errors |
| `sentry.edge.config.ts` | Edge (middleware, edge runtime routes) | Edge-runtime exceptions — we don't use the edge runtime heavily yet, but middleware errors land here |
| `src/app/global-error.tsx` | React error boundary | Renders a client-facing fallback when a page crashes, and reports the error to Sentry before showing it |

Source maps are uploaded at build time (Vercel build uses `SENTRY_AUTH_TOKEN` to push them), so stack traces resolve to readable file:line pointers in the Ace source instead of obfuscated production bundle code.

PII is enabled (`sendDefaultPii: true`) — Sentry captures cookies, IPs, and user-agent strings. That's acceptable for an internal CRM with a small team; revisit if external users ever hit this app.

## Where to find the dashboard

- **Org:** breakpoint-talent
- **Project:** ace-crm
- **URL:** <https://sentry.io/organizations/breakpoint-talent/issues/?project=ace-crm>

Sign in with the Google account tied to the BreakPoint Talent Sentry org. The Issues tab is the default view; Performance, Replays, and Logs tabs have the corresponding data.

## How to triage an alert

When a Sentry email lands:

1. **Click through to the issue.** The email links to a specific Sentry issue, not the dashboard home. Open that.
2. **Read the top-of-page summary:** error message, count in the last 24h, user count affected, first-seen / last-seen timestamps.
3. **Open the Session Replay.** If the error was in the browser and the replay sample caught it, watching the recruiter's last ~10 seconds before the crash is usually enough to reproduce it. Server errors have no replay; skip this step.
4. **Read the stack trace.** With source maps live, frames point at real files in `src/`. Top-of-stack is almost always the proximate cause.
5. **Check the breadcrumbs panel.** Shows the last ~20 events leading up to the error (clicks, route transitions, console logs, fetch calls). Usually the last 3 tell you what the user was doing.
6. **Tags + context blocks:**
   - `release` — which deploy did this ship in. Compare to `git log` to see what changed.
   - `url` — which page blew up.
   - `user.email` — who saw it (PII capture is on).
   - `transaction` — the Next.js route segment.
7. **Decide: real bug or noise?**
   - Real bug → create a fix branch, reference the Sentry issue URL in the commit message, resolve the issue in Sentry when the fix deploys.
   - Known / third-party noise (RF flakiness, Gmail rate limits that auto-retry, etc.) → mark the issue "Ignored" with a reason so it doesn't page again.
   - Can't repro → mark "Ignored until next occurrence" so it re-opens if it fires again.

## What triggers an email alert

Sentry's default rules for a new project:

- **A new issue is created** (first time Sentry sees this error signature). You get an email immediately.
- **An existing issue regresses** — was resolved, then fired again. Email immediately.
- **An issue affects >1% of sessions in a 10-minute window.** Spike alert; email immediately.

Rules can be edited at <https://sentry.io/organizations/breakpoint-talent/alerts/rules/>. If alert fatigue sets in, tune "new issue" to require a minimum event count (e.g. 3+ occurrences before emailing) — cuts the one-off errors that self-heal.

## Common operations

- **Silence an issue:** Issues → pick issue → Ignore → "Until it happens N more times" or "Forever." Use sparingly; ignored issues still accumulate events but stop paging.
- **Find errors for a specific user:** search bar → `user.email:andrew@breakpointtalent.com`. Also works with any other tag (`transaction:/candidates/[id]`, `release:<sha>`, etc.).
- **Check a recent deploy:** Releases tab → pick the release → see error count delta vs the prior release. Our release id is the Vercel deploy sha.
- **Replay a specific session manually:** Replays tab → filter by url / user / date. Useful when a recruiter says "it broke at 2:15 PM" and there's no explicit error.
- **Set up a recurring weekly digest:** Alerts → Subscriptions → enable the weekly summary. Cleaner than watching individual alerts.

## Troubleshooting

**"I'm getting no errors in the dashboard but I know the app is broken."**
- First check: did the deploy that introduced the bug actually include Sentry? If `next.config.mjs` or the instrumentation files were accidentally reverted, the bundle won't call `Sentry.init`. Run `npx next build` locally and grep the build output for `Sentry` to confirm.
- Second: check the DSN (`ba32183b35552fc5b40f5c3a0a275c1d@o4511269869649920.ingest.us.sentry.io/4511269883543552`) matches what the Sentry project dashboard shows under Settings → Client Keys. If it drifted, the wizard needs re-running.

**"Source maps aren't resolving — stack frames show minified code."**
- `SENTRY_AUTH_TOKEN` on Vercel expired or got removed. Regenerate at Sentry → Settings → Auth Tokens (scope: `project:releases` + `project:write`), paste into Vercel env (Production + Preview).

**"Alerts are firing for the same error I just resolved."**
- Likely a regression in a subsequent deploy. Check the release tag on the new event — if it's later than the one where you resolved, it's a new occurrence. If it's the same release, Sentry clock skew vs Vercel deploy order; re-resolve.

## Related files

- `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts` — init configs; edit sampling rates or integrations here.
- `src/app/global-error.tsx` — top-level React error boundary.
- `next.config.mjs` — `withSentryConfig` wrapper. Build-time upload of source maps lives here; don't remove `silent: true` without a reason (it mutes ok-status wizard messages, not real errors).
- `.env.sentry-build-plugin` — local-only auth token file for `next build` on your machine. Gitignored. Not used in CI (Vercel uses `SENTRY_AUTH_TOKEN` env var instead).
