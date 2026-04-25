# Sticky sidebar

Across every route in Ace, the left sidebar now stays in place as you scroll the main content. Settings is always one click away no matter how long the current page is.

## What changed

- Previously the sidebar flowed with the page: scroll a long candidates list, the sidebar scrolled away with it, and the **Settings** entry at the bottom went off-screen.
- Now the sidebar is **sticky to the viewport top**. It stays put as the page content scrolls. Settings is always visible at the bottom of the sidebar.

## How it behaves

- **Tall page** (e.g. `/candidates` with 200 rows, `/jobs` with the full requisition list): the main content scrolls; the sidebar sits put. Settings always visible at the bottom.
- **Short page** (e.g. `/dashboard`): no scroll happens, sidebar looks the same as before.
- **Short viewport** (very small browser height): if the sidebar's own content is taller than the viewport, the **main nav block scrolls internally**. The Settings footer + BreakPoint Talent blurb stay pinned at the bottom of the sidebar's visible area, so Settings is reachable even if you have to scroll inside the sidebar to see, say, the Jobs link.

## What this fixes

- The Phase 6 Mail Tab introduced a Settings tab that was hard to reach when on a deeply-scrolled Candidates or Jobs page. The sidebar would scroll out of view and Settings would only be visible if you scrolled back to the top.
- Auto-deploys flagged this as a usability gap in Ace 17.0 testing. Phase 5A.1-fix addresses it.

## Notes for power users

- Mobile (< md breakpoint): the sidebar is hidden on small screens — same as before. There's no sticky behavior because there's no sidebar showing.
- The Mail Tab inbox + thread panes have their own internal scroll behavior; sticky-sidebar doesn't change that.
- If the sidebar ever doesn't stick (e.g., on a route that wraps content in `overflow-hidden`), file a ticket — the sticky behavior depends on the parent flex container not having an overflow constraint.
