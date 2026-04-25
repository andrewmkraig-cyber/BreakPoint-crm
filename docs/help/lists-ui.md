# Candidate lists — UI (5A.4.b)

Lists are recruiter-curated buckets of candidates ("Top Tax Candidates", "Q4 follow-ups", "Submitted to Sheehan"). They live in Neon, scoped to your organization, and surface across three places.

## 1. Add a candidate to a list

From any candidate profile (`/candidates/[id]`), the page header has an **Add to List** button (next to Kept badge and tags). Click it.

A modal opens with two tabs:

### Existing lists
- Lists for your org are shown alphabetically with current member counts.
- Lists this candidate is **already on** show pre-checked. Uncheck to remove the membership; check to add.
- Multi-select is fine — toggle as many lists as you want, then **Save**. Toast confirms what changed ("Added to Top Tax Candidates", "Added to 3 lists", "Removed from 1 list").
- Empty state: if you don't have any lists yet, the panel points you to the **New list** tab.

### New list
- Type a name (max 80 characters), click **Create & add**. The list is created and this candidate is added to it in one step.
- List names are unique per organization — `"Top Tax Candidates"` can't be reused inside the same org. Two different orgs can each have their own list with that name.

## 2. Filter the candidates page by list

The `/candidates` list page has a **Lists** dropdown next to the search box. Pick a list to filter the table to only candidates with a membership in that list. The candidate count in the indicator updates to the filtered total.

Filters compose:
- **Search + List** — type in the search box, the search matches *within* the selected list.
- **List + Pagination** — pages 1, 2, 3… walk the filtered set, not the full ~700.
- **All three at once** — `?q=andrew&list=cmXX...&page=2` is a valid URL and survives reload / shareable.

URL state lives in `?list=<listId>`. The dropdown's **All candidates** option clears the filter (URL drops `?list=`).

## 3. Manage lists

Click **Manage lists** (small gear icon next to the Lists dropdown), or go to `/candidates/lists` directly.

Per-row actions:
- **Rename** — click the list name, edit inline, press Enter to save (Escape cancels). Same uniqueness rule applies — renaming to a name that already exists in your org shows a friendly error.
- **Delete** — opens a confirmation modal. The text spells out the cascade: deleting the list also deletes its membership rows, but **does NOT delete the candidates themselves**. The candidates stay in your pool; only the bucket they were grouped into is gone.

Empty state if you don't have any lists yet: the page tells you to add a candidate to a list from any candidate profile to get started.

## How tenant isolation works

Every read and every write in this feature scopes by `organizationId` — both via the Prisma tenant-scope extension and explicitly in each server action's WHERE clause (Rule 8 belt-and-suspenders).

- A forged `listId` from another org returns zero results when used in a filter or in the popup; it can't escape the boundary.
- Cascade deletes from `Organization → CandidateList → CandidateListMembership` keep things tidy if an org is ever deleted.
- `Candidate.listMemberships` cascade-deletes too, so removing a candidate doesn't leave stale memberships pointing at nonexistent rows.

## Schema reference

The Phase 5A.4.a doc (`docs/help/lists-schema.md`) has the full schema details — table columns, indexes, foreign-key cascade rules.
