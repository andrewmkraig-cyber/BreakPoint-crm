# Smoke tests

## What it does

Playwright drives a real Chromium instance through the core recruiting happy-path on every push to `main`. The single spec at `tests/smoke/happy-path.spec.ts` walks the flow a recruiter takes 20 times a day: create a candidate, apply them to a job, confirm the row shows up on the job's Applied bucket and on `/applicants`, open the Submit and Schedule Interview composers, confirm they populate, and clean up behind itself.

This is the last safety net before merge. Every regression from Phase 1 onward (Apply-to-Job invisible on Job page, Submit modal empty dropdown, /applicants skipping Ace-native rows) would have been caught by this spec had it existed. It exists now.

## What's covered

The 11 steps, in order:

1. **Forged session cookie** — computes a valid NextAuth JWT for `andrew@breakpointtalent.com` via `next-auth/jwt` `encode` and injects it into the Playwright browser context. No Google OAuth round-trip, no test-only auth branch in `src/lib/auth.ts`.
2. **Create candidate** — visits `/candidates/new`, fills first/last/email, waits for the dup-check's "Available" hint, clicks Save to Ace, and asserts the redirect to `/candidates/<cuid>`.
3. **Candidate list** — searches `/candidates?q=<timestamp>` and asserts the new name is visible.
4. **Apply to Job** — opens the `Apply to Job` modal, picks the first non-disabled job from the `<select>`, confirms with the modal's `Apply` button.
5. **Job pipeline** — navigates to `/jobs/<jobRfId>` (resolved via a Prisma query on the Placement that step 4 wrote), opens the Applied bucket, asserts the candidate's name appears.
6. **Applicants tab** — navigates to `/applicants`, asserts the candidate shows up.
7. **Submit composer** — opens `Submit to Job`, picks a different open job from the `<select>`.
8. **Contact picker populates** — clicks the To picker, asserts at least one `<li><button>…@…>` contact renders (regression guard for Phase 1.5 Bug 2).
9. **Schedule Interview trigger** — back on the profile, clicks the `Schedule Interview` button if present. The assertion is soft — layout variability between row states is tolerated here; a dedicated interview spec can cover this more rigorously later.
10. **Interview composer renders** — covered by step 9's visibility check on the opened modal.
11. **Cleanup** — `finally` block deletes the test candidate from Neon (Placements + Interviews cascade; ActionLog rows are deleted explicitly since they have no FK). Stale rows from prior failed runs are wiped at the top of the test too.

## How to run locally

```bash
# From the repo root, with .env.local populated:
npx playwright test

# Headed (watch it run):
npx playwright test --headed

# One step debugged in the Playwright Inspector:
npx playwright test --debug

# Open the trace viewer on a past failure:
npx playwright show-trace test-results/<run-dir>/trace.zip
```

The spec auto-starts `next dev -p 3456` via the Playwright `webServer` block. First run cold-compiles the app and takes ~30s; subsequent runs reuse the dev server if one is already open (the `reuseExistingServer` flag).

Database: runs against whatever `DATABASE_URL` is set in `.env.local`. That's usually main on a local dev machine — the cleanup step makes that safe, but CI uses a dedicated Neon branch (`CI_SMOKE_DATABASE_URL` secret) so CI writes never touch production data.

## RF independence

The smoke test does **not** depend on the RecruiterFlow API being reachable. Pages that used to pull Jobs / Clients / Contacts from RF (`/candidates/[id]` Ace-native profile, `/jobs/[id]`, `/applicants`) now read the same data from Neon via the `getRfJobsForOrg` / `getRfClientsForOrg` / `getRfContactsForOrg` shims in `src/lib/candidates.ts`. The shims return RF-shaped payloads out of the `Job.raw` / `Client.raw` / `Contact.raw` columns Phase 0 populated, so downstream callers that consume `RFJob[]` / `RFClient[]` / `RFContact[]` keep working unchanged.

CI additionally seeds a dedicated **Smoke Test Inc** + **Smoke Test Field Engineer** + **Smoke Test Contact** row into the `ci-smoke` Neon branch before the Playwright run — see `scripts/seed-smoke-data.ts` — so the test targets deterministic data instead of whichever of the 13 imported production jobs happens to sort first in the dropdown. The seed is idempotent (upsert by sentinel `legacyRfId`), so re-running the workflow on the same branch is safe.

## CI secrets required

Before the first successful CI run, the following GitHub Actions secrets must be configured at **Settings → Secrets and variables → Actions**:

| Secret | Purpose | Notes |
|---|---|---|
| `CI_SMOKE_DATABASE_URL` | Neon branch dedicated to smoke test writes | Create a `ci-smoke` Neon branch from main; paste its pooled connection string. Never point at the prod branch — CI writes + deletes per run. |
| `NEXTAUTH_SECRET` | Signs the forged JWT the smoke test injects | **Must match** the value the running Next.js server uses, otherwise the cookie fails to verify and every page redirects to `/sign-in`. Easiest: reuse the same secret as production. |
| `NEXTAUTH_URL` | Base URL NextAuth thinks it's running under | Set to `http://localhost:3456` — matches the port the workflow starts `next start` on. |
| `GOOGLE_CLIENT_ID` | Google OAuth provider init | Required at boot by the Google provider in `src/lib/auth.ts` even though the smoke bypasses real OAuth. Any valid client id for the BreakPoint Talent Cloud project works — the smoke never hits Google's endpoints. |
| `GOOGLE_CLIENT_SECRET` | Same as above | Same rationale. |
| `RECRUITERFLOW_API_KEY` | Server still reads RF for Jobs/Clients/Contacts until Phases 2–4 | The profile pages + Applicants/Pipeline need this to render. Omit it and the test's navigation steps fail on a 500. |
| `ANTHROPIC_API_KEY` | Optional | The smoke skips Claude resume parsing by filling the form manually. Stub or omit. |

Missing `CI_SMOKE_DATABASE_URL` or `NEXTAUTH_SECRET` will fail the workflow on the first Playwright step ("forged JWT rejected" or "user not found"). Missing `RECRUITERFLOW_API_KEY` will fail on step 5 or 6 when the job page tries to render the pipeline. Missing Google creds will fail at `next start` boot.

## How to add a step

1. Open `tests/smoke/happy-path.spec.ts`.
2. Pick a location — most additions land between an existing step and its successor.
3. Use Playwright's user-facing locators in preference order:
   - `page.getByRole("button", { name: /…/i })` for clickable elements
   - `page.getByLabel("…")` for form fields (the project's `<Field>` component wraps inputs in labels, so this works)
   - `page.getByText("…")` for visible assertions
   - `page.locator("css-selector")` only as a last resort
4. If a step adds a lasting side effect (new Placement, Interview, etc.), extend the `finally` cleanup block to cover it.
5. Run locally to confirm the step passes before pushing.

Avoid `page.waitForTimeout()` past the three existing uses — they're for known debounces (email dup-check, modal render settle). Replacing them with explicit `expect(...).toBeVisible()` waits is better when you can.

## What to do when a smoke test fails

1. **Open the Actions run.** GitHub's workflow page shows the failing step, the stdout, and the Playwright report artifact (`playwright-report/`) attached on failure with screenshots + video + trace.
2. **Download the trace.** `npx playwright show-trace playwright-report/trace.zip` opens the Playwright trace viewer — every step with its DOM snapshot. Faster than re-running the test with `--debug` unless the trace viewer isn't giving you what you need.
3. **Decide:**
   - **Selector drift** — a button label changed, a field got renamed, a modal restructured. Update the spec's selector to match, commit with a short rationale.
   - **Actual regression** — the test caught a real bug. Revert the offending commit, or land a fix that makes the test pass again. Do NOT relax the test to make it pass without understanding what broke.
   - **Flake** — test passes locally, fails on CI once, passes next run. Bump the `retries` count from 1 to 2 only if you've already checked whether the failing step has a race condition you can fix directly.
4. **Re-run the workflow** via the Actions page once the fix is committed.

## How to update fixtures

`tests/fixtures/smoke-test-resume.pdf` is a 1-page valid PDF generated with `pdf-lib`. To regenerate with different content:

```bash
node -e "
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Your replacement content', { x: 50, y: 720, size: 24, font });
  const bytes = await doc.save();
  fs.writeFileSync('tests/fixtures/smoke-test-resume.pdf', bytes);
})();
"
```

Keep the file small (~1 KB) — it's committed to the repo and every CI run downloads it.

## Troubleshooting

**"NEXTAUTH_SECRET not set — smoke tests can't forge a session."**
The helper refuses to guess. Populate `.env.local` (or the CI secret) with the same `NEXTAUTH_SECRET` the running dev server is using. If they diverge, the cookie won't verify and every page redirects to `/sign-in`.

**"Test owner andrew@breakpointtalent.com not found in Neon."**
You're pointed at a fresh DB (branch with no seed). Run `npx tsx scripts/seed-default-org.ts` first — it creates the User + Organization rows the smoke relies on.

**Everything passes locally, the workflow fails on CI.**
Open the workflow's log under "Run Playwright smoke." Most CI-only failures are: (a) a missing secret the local `.env.local` supplies, (b) the Neon branch `CI_SMOKE_DATABASE_URL` is stale on schema, (c) a network call to RF or Google that the test doesn't mock is failing in the restricted CI network. For (c), consider stubbing the dependency in the test instead of waiting on flaky third parties.

**Test creates a candidate but the cleanup doesn't fire.**
If Playwright force-exits mid-test (SIGKILL, CI timeout), the `finally` block is skipped. The next run's `cleanupStaleSmokeCandidates()` call at the top sweeps any leftover `Smoke Test*` rows — so it's eventually consistent. If you see the stale rows piling up, manually:
```
npx tsx -e "
import { prisma } from './src/lib/prisma';
(async () => { await prisma.candidate.deleteMany({ where: { firstName: { startsWith: 'Smoke' } } }); })().finally(() => prisma.\$disconnect());
"
```

## Related files

- `tests/smoke/happy-path.spec.ts` — the spec itself
- `tests/smoke/helpers.ts` — `signInAsOwner`, `cleanupStaleSmokeCandidates`, `deleteCandidateDeep`
- `tests/fixtures/smoke-test-resume.pdf` — 1-page PDF fixture
- `playwright.config.ts` — runner config, sets the port + webServer autorun
- `.github/workflows/smoke.yml` — CI workflow that runs the spec on push to main
- `docs/operations/sentry-monitoring.md` — sibling doc for the other safety net
