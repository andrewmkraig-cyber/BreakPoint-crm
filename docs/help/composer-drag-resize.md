# Composer drag, resize, and minimize

The popup email composer that opens on every click-to-email surface (candidate profile, client contacts tab, pipeline row, etc.) and on the `/mail` Reply flow now behaves like a native Gmail compose window. Phase 5A.1.

## Drag

- The composer's title bar (the row that says "New email" or "Reply" with the grip-vertical icon) is the drag handle.
- Hover the title bar — the cursor turns into a **grab** hand. Click and hold — it becomes a **grabbing** fist.
- Drag anywhere in the viewport. The composer can't be dragged off-screen; if you let go past an edge, it snaps to the nearest valid position.
- Position resets to centered each time you reopen the composer. There is no per-tab persistence yet (drag positions don't survive a refresh — by design for this release).

## Resize

- Bottom-right corner has a small diagonal-stripe **resize handle**. Drag it.
- **Minimum size**: 480×400 — won't shrink below that.
- **Maximum size**: viewport size minus a 40px margin on each side.
- Same lifecycle as drag: size resets when you close + reopen.

## Minimize

- The minimize button (a horizontal "−" icon, to the left of the X in the header) collapses the composer to a **pill** anchored at the bottom-left of the screen.
- Pill shows the email subject (or "New Email" if subject is blank), truncated to 30 characters.
- **Click the pill body** to restore the composer at its previous position and size with all draft content intact.
- **Click the X on the right of the pill** to discard the draft entirely. The composer fully unmounts; what you typed is gone.

## Multiple drafts

- You can have **multiple composers open at once**. Open one from a candidate, minimize, then open another from a client — both pills sit at the bottom-left, stacking horizontally to the right of the first.
- Clicking one pill restores that draft only — others stay minimized. You can have one composer expanded and several pills lined up.

## Backdrop behavior

- The dimmed backdrop **does not close the composer**. Click anywhere on the dimmed area outside the composer card and nothing happens — no close, no animation. This protects you from losing a half-typed draft to a mis-click.
- The only ways to close the composer:
  - Click the **X** button in the title bar.
  - Click the **X** on a minimized pill (discards entirely).

## Keyboard

- `Escape` is wired to the popup launcher's close handler in many surfaces; behavior is unchanged from previous releases. (If your host surface had Escape-to-close, that still works.)

## Lifetime

Minimized drafts persist as long as the browser tab is open. Close the tab → all minimized drafts are gone. There's no localStorage or server-side draft persistence in this release.

## Troubleshooting

**Composer flickers at the top-left when I open it.**
The composer waits one paint frame for the viewport size to compute, then centers itself. If you're seeing a flicker, hard-refresh the page; that paint-skip should be invisible after the cache settles.

**Minimize pill doesn't appear.**
The pill renders inside the global `MinimizedTray`, which is mounted in the top-level `Providers` shell. If you mounted a composer somewhere outside that tree (rare — only if a one-off route bypasses the layout), the pill won't show. Restoring the composer or closing it via the X still works.

**Drag stutters on a slow page.**
Drag uses document-level mousemove listeners that update React state every move event. On a heavily-loaded page (e.g. a giant resume preview rendering in the background) this can stutter. Closing other heavy surfaces typically resolves it; the composer itself never blocks.
