"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// In-memory registry of minimized composer drafts. Each open
// MailComposer registers itself with a stable id; when the user
// minimizes the composer, we add a `subject` + restore/discard
// callbacks to that entry. The MinimizedTray reads the registry to
// render pills at the bottom-left of the viewport.
//
// Lifetime: only as long as the tab. Closing the browser drops every
// minimized draft. The composer keeps ALL its internal state (body,
// attachments, recipients, etc.) because we toggle the modal's
// visibility rather than unmounting it — minimize/restore is a
// display flip, not a state migration.

export type MinimizedDraft = {
  id: string;
  // Subject as it currently reads, truncated for display in the pill.
  subject: string;
  // Restore lifts the composer back to its prior position + size.
  onRestore: () => void;
  // Discard fully unmounts the composer (caller's onClose) and drops
  // the draft from the tray.
  onDiscard: () => void;
};

type MinimizedDraftsCtx = {
  drafts: MinimizedDraft[];
  // Add or update an entry by id. Idempotent — repeated calls with
  // the same id replace the previous record (keeps the subject in
  // sync as the user types in a minimized draft once they restore + edit).
  upsert: (draft: MinimizedDraft) => void;
  // Remove an entry by id (called on restore + on discard).
  remove: (id: string) => void;
};

const Context = createContext<MinimizedDraftsCtx | null>(null);

export function MinimizedDraftsProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<MinimizedDraft[]>([]);

  const upsert = useCallback((draft: MinimizedDraft) => {
    setDrafts((prev) => {
      const idx = prev.findIndex((d) => d.id === draft.id);
      if (idx === -1) return [...prev, draft];
      const next = prev.slice();
      next[idx] = draft;
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  return (
    <Context.Provider value={{ drafts, upsert, remove }}>{children}</Context.Provider>
  );
}

export function useMinimizedDrafts(): MinimizedDraftsCtx {
  const ctx = useContext(Context);
  if (!ctx) {
    // Return a no-op context so a stray composer mounted outside the
    // provider doesn't crash; minimize won't work but the composer
    // itself still renders.
    return {
      drafts: [],
      upsert: () => {},
      remove: () => {},
    };
  }
  return ctx;
}

// Tiny helper for the composer's lifecycle: deregister on unmount.
// Keeps the tray free of stale entries when a composer hard-closes
// without going through onDiscard.
export function useUnregisterOnUnmount(id: string | null) {
  const { remove } = useMinimizedDrafts();
  useEffect(() => {
    return () => {
      if (id) remove(id);
    };
  }, [id, remove]);
}
