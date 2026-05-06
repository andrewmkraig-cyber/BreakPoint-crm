"use client";

import { useCallback, useEffect, useState } from "react";

// Shared monotonic z-index counter so the user can click between
// floating windows (Claude Panel, MailComposer, future popouts) and
// have whichever they touched last sit on top. Starts above the
// composer's pre-existing z-[100] baseline and increments on every
// focus event — the most-recently-clicked surface always wins.
//
// Why a module-level counter and not context: every floating surface
// is mounted via different providers (composer-manager, claude-panel-
// context). A counter doesn't need to be synchronized through React
// state — the only thing that matters is that the last increment
// produces the highest number, and increments are always serialized
// by the JS event loop.

let counter = 1000;

export function nextZ(): number {
  counter += 1;
  return counter;
}

// Hook for floating surfaces. Returns the current z-index and a
// `bringToFront` callback the surface should fire on pointerdown.
// `active` controls whether the surface should claim a fresh z when
// it (re)mounts or transitions visible — pass the surface's "is the
// user looking at this" boolean (e.g. ClaudePanel.open). When it
// flips from false to true, the hook bumps z so the just-shown
// surface lands on top of whatever was previously on top.
export function useFloatingZ(active: boolean = true) {
  const [z, setZ] = useState<number>(() => (active ? nextZ() : 0));

  const bringToFront = useCallback(() => {
    setZ(nextZ());
  }, []);

  useEffect(() => {
    if (active) setZ(nextZ());
    // Intentionally only react to the active flag — bumping on every
    // render would defeat the "click to focus" intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { z, bringToFront };
}
