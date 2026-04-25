"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { MailComposer } from "@/app/mail/mail-composer";
import type { ActiveTemplateSummary } from "@/app/email/actions";
import type { MailMergeContext } from "@/lib/mail-merge-fields";

// Hoists open composers up to the application shell so they survive
// page navigations. Without this, navigating away from the candidate
// profile that originally launched a composer would unmount the
// composer (and drop any minimized pill from the tray). With this, the
// launcher only registers a "spec" in the provider; the provider is
// the one that actually renders the MailComposer instances.
//
// Each open composer is a MailComposer mounted as a sibling of the
// children. Closing or discarding removes it from the list. Multiple
// composers can be open simultaneously — the user can have one expanded
// and several pinned to the bottom-of-screen tray.

export type OpenComposerInput = {
  defaultTo: string;
  defaultCc?: string;
  defaultSubject?: string;
  threadId?: string;
  templates: ActiveTemplateSummary[];
  mergeContext: MailMergeContext;
  modalTitle?: string;
  // Triggers smart context resolution (Phase 5A.2). The composer
  // fetches /api/mail/candidate-context/[candidateRef] on mount and
  // populates {{job.*}} / {{client.*}} merge fields from the
  // candidate's active applied jobs. Path segment may be cuid or
  // legacy numeric rfId — the API resolves both.
  candidateRef?: string;
  // Called after a successful send. The composer auto-closes on send,
  // so this is for parent-side bookkeeping (e.g., refreshing a list).
  onSent?: () => void;
};

type Spec = OpenComposerInput & { id: string };

const ComposerManagerContext = createContext<{
  open: (input: OpenComposerInput) => string;
  close: (id: string) => void;
} | null>(null);

export function ComposerManagerProvider({ children }: { children: ReactNode }) {
  const [specs, setSpecs] = useState<Spec[]>([]);

  const open = useCallback((input: OpenComposerInput): string => {
    const id = `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setSpecs((prev) => [...prev, { id, ...input }]);
    return id;
  }, []);

  const close = useCallback((id: string) => {
    setSpecs((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return (
    <ComposerManagerContext.Provider value={{ open, close }}>
      {children}
      {/* Open composers render OUTSIDE the page tree so they survive
          the page-component unmounting (e.g., user navigates from
          candidate A to candidate B with a draft minimized). */}
      {specs.map((s) => (
        <MailComposer
          key={s.id}
          asModal
          modalTitle={s.modalTitle ?? "New email"}
          defaultTo={s.defaultTo}
          defaultCc={s.defaultCc}
          defaultSubject={s.defaultSubject ?? ""}
          threadId={s.threadId}
          templates={s.templates}
          mergeContext={s.mergeContext}
          candidateRef={s.candidateRef}
          onClose={() => close(s.id)}
          onSent={() => {
            s.onSent?.();
            close(s.id);
          }}
        />
      ))}
    </ComposerManagerContext.Provider>
  );
}

export function useComposerManager() {
  const ctx = useContext(ComposerManagerContext);
  if (!ctx) {
    // Defensive no-op so a stray launcher mounted outside the provider
    // doesn't crash the page; click-to-email simply won't open one.
    return {
      open: () => "",
      close: () => {},
    };
  }
  return ctx;
}
