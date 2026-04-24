# Candidate, client & contact search

## What it does

Ace has two places to search, both filtering the same underlying data set:

1. **Candidates page search bar** — the input at the top of `/candidates`. Filters the candidate table in place as you type.
2. **Global quick-search** — the input in the TopBar (visible on every route). Opens a grouped dropdown with up to 8 matches total across three groups — **Candidates, Clients, and Contacts** — allocated round-robin. Clicking or pressing Enter navigates straight to the selected profile.

The candidate-page search covers name, email, current employer, and current title. The global quick-search extends that to client companies (by name) and contacts (by first name, last name, or any of the contact's emails). Matching is case-insensitive substring (Postgres ILIKE), scoped by your organization.

## When to use it

- **Candidates page search** — you're already on `/candidates` and want to narrow the table. Best for browsing, comparing, filtering by a partial match across the whole pool.
- **Global quick-search** — you know (roughly) who or what company you want and need to jump there from anywhere in the app. Best for "I'm on the pipeline and need to open Jane Doe's profile", "jump to the Acme client page", or "pull up Patrick's contact so I can see which client he sits under" — one keystroke, not a navigation + scroll.

Either surface is fine; they're designed to complement, not duplicate.

## How to use it

### Candidates page search bar

1. Navigate to `/candidates`.
2. Click the **Search** input at the top (or press Tab from the page header).
3. Type a query. After 300ms of no typing the list refreshes in place — no page reload, no URL change.
4. Clear the input to see the full list again.

### Global quick-search

1. Click the **Search candidates & clients…** input in the top bar (works on any route).
2. Type a query. After 300ms a dropdown shows up to 8 matches total, grouped into three sections:
   - **Candidates** — name + current title + current employer
   - **Clients** — company name + city
   - **Contacts** — full name + the company they work at
   The 8 slots are allocated round-robin across the three groups, so each gets a fair share. If one group has fewer matches than its share, the others absorb the slack; the dropdown never comes back short when more matches exist elsewhere.
3. Either:
   - **Click** a row to navigate — candidate rows open `/candidates/[id]`, client rows open `/clients/[slug]`, contact rows open the **parent client profile** (contacts live on client pages, not their own profile).
   - **Arrow keys** — ArrowDown / ArrowUp walk the flat list in group order (candidates → clients → contacts), Enter opens the highlighted row.
   - **Escape** — close the dropdown and clear the input without navigating.
   - **Click outside** — close the dropdown; input keeps whatever you typed.

## Fields explained

Candidates (both surfaces):

| Field | Source column | Example match |
|---|---|---|
| **Name (first + last)** | `Candidate.firstName`, `Candidate.lastName` | "smith" → Jane Smith, John Smithers |
| **Email** | `Candidate.email` | "@acme.com" → everyone with an Acme address |
| **Current employer** | `Candidate.currentOrganization` | "goog" → every Google / Googler / Goog- match |
| **Current title** | `Candidate.currentDesignation` | "senior engineer" → every title containing that phrase |

Clients (global quick-search only):

| Field | Source column | Example match |
|---|---|---|
| **Company name** | `Client.name` | "acme" → Acme Corp, Acme Industries |

Contacts (global quick-search only):

| Field | Source column | Example match |
|---|---|---|
| **First name** | `Contact.firstName` | "patrick" → Patrick Sheehan |
| **Last name** | `Contact.lastName` | "sheehan" → Patrick Sheehan |
| **Legacy combined name** | `Contact.name` | for RF-imported contacts where first/last weren't split out |
| **Email** | `Contact.emails[]` | "@sheehanbros.com" → every contact with an email at that domain |

Matching is:
- **Case-insensitive** — "acme" matches "Acme" matches "ACME".
- **Substring** — "smith" matches "Smith", "Smithers", "Blacksmith". If you want a whole-word match, add a space on either side of the query.
- **ILIKE (`%q%`)** — a standard Postgres operator. Pattern chars (`%`, `_`) in your query are treated literally.

## Common questions

**Why doesn't the candidates-page search update the URL?**
In-place filtering is deliberately URL-free so tab-switching and deep-linking don't bounce around. If you want to share a filtered view, the page still accepts `?q=<query>` on initial load — e.g. `/candidates?q=senior` renders the filtered list server-side.

**Why only 8 results in the quick-search dropdown?**
A quick-search dropdown with 100 rows isn't quick. If 8 isn't enough, type more — the match list shortens fast. Or use the candidates-page search which shows the full result set in a table.

**Can I search by skills, location, or LinkedIn URL?**
Not today. The four fields above were picked because they're the ones recruiters search on most. Richer Boolean / field-targeted search (`skills:python`, `location:ohio`) is on the Day-5 list.

**Does the search include candidates I rejected / deleted?**
It includes every Candidate row in your tenant — there's no soft-delete flag on Candidate today. Rejection is a Placement stage, not a Candidate flag; rejected candidates are still candidates.

**What about candidates on other teams' orgs?**
Never. Every search is scoped by `organizationId` on the server, enforced by both explicit `where` clauses and the tenant-scope Prisma extension. See `docs/operations/multi-tenancy.md`.

## Troubleshooting

**I typed something and nothing happened.**
Search is 300ms-debounced — if you paused less than 300ms, wait a beat. If after a full second there's no result, check the browser console / Network panel for a failed server action. The `Loader2` spinner at the right of the input shows while a request is in flight.

**I see "No candidates match your search" but I know the candidate exists.**
- Typo check: both surfaces do substring match, not fuzzy. "Smth" won't find "Smith".
- The candidate might be in a different tenant (if you've been switched between orgs).
- Try a shorter fragment: "jane" instead of the full name.

**The quick-search dropdown closes when I click the scrollbar.**
Known quirk — the click-outside detector doesn't distinguish scrollbar clicks from content clicks. Use ArrowDown/ArrowUp to navigate results instead, or click back into the input to reopen.

**Global search input is cut off on mobile.**
The TopBar layout hides `Internal Ops · <date>` on small screens to keep the search input visible; the input itself stretches to whatever's available. If it looks squeezed, rotate landscape or use the candidates-page search instead.

## Related features

- **Candidates page** — full browseable list with column sort + pagination; search lives at the top of that page.
- **/pipeline** — filtered view of candidates by placement stage. Different purpose (stage view) than candidate search (identity view).
- **/applicants** — inbound applicants specifically. Search on applicants is a separate filter because the row shape is different (one row per (candidate, job) pair, not per candidate).
- **Candidate profile** — where every search result links to. Both surfaces navigate to `/candidates/[id]`, which auto-dispatches between RF-imported (`page.tsx`) and Ace-native (`local-profile.tsx`) views by reading `Candidate.rfId`.
