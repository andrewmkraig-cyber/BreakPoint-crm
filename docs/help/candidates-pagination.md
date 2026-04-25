# Candidates page pagination

The `/candidates` list now loads **25 candidates per page** instead of dumping all ~700 in a single render. Phase 5A.3.

## What you'll see

Below the candidate table:

- **Page X of Y (a–b of N candidates)** — current page, total pages, and the absolute index range showing on this page.
- **Previous** button (disabled on page 1).
- **Next** button (disabled on the last page).
- **Go to #** input — type a page number, press Enter, jump there. Out-of-range entries clamp silently to the nearest valid page (type `999` on a 28-page result, you land on page 28).

Page size is fixed at 25 for now. A configurable size is on the cosmetic-polish backlog.

## URL state

The current page lives in the address bar as `?page=N`. Direct-navigating to `https://ace.breakpointtalent.com/candidates?page=5` lands on page 5. Refresh keeps you put. Browser back / forward walks the page history correctly.

Search query lives in the same URL as `?q=…`. Combined: `https://ace.breakpointtalent.com/candidates?q=andrew&page=2` opens page 2 of the "andrew" filter.

## How search interacts

- Typing in the search box debounces 300ms, then pushes the new query to the URL with **page reset to 1** (the URL drops `?page=` so you don't land on page 5 of the new filter).
- Page count + "X of N candidates" reflect the **filtered set**, not the full ~700.
- Clearing the search returns you to the unfiltered set, page 1.

## Page transitions

When you click Next / Previous / Jump-to-page:

- The table dims slightly while the new server render fetches.
- The page scrolls back to the top automatically.
- Existing rows stay visible during the transition (no blank flash).

The dim + spinner is React's `useTransition` showing the pending state — the new rows replace cleanly when the server returns.

## Tenant isolation

Every paginated query is scoped by `organizationId` (rule 8). The total count + the page slice both come from the same `WHERE` clause, so you never see another tenant's candidates in the count or in the rows.

## Edge cases

**Type `?page=999` directly into the URL.**
The server query returns no rows (skip past the end of the table). The view shows "No candidates" with the search box still functional and the pagination still active so you can jump back to a valid page.

**Search returns 0 rows.**
The "No candidates match your search" empty state shows. The pagination block hides because `total` is 0.

**Header global search is unaffected.**
That dropdown is its own surface and pagination doesn't apply — it caps at 8 results across Candidates / Clients / Contacts as before.
