"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MailComposer, type AttachmentDraft } from "@/app/mail/mail-composer";
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
  // Carry-over fields used by the inline → modal pop-out so a started
  // reply doesn't lose typed BCC, body HTML, attachments, or an
  // already-saved Gmail draft id when it transitions into the modal
  // composer. Not used by the click-to-email or FAB launch paths.
  defaultBcc?: string;
  defaultBody?: string;
  defaultAttachments?: AttachmentDraft[];
  defaultDraftId?: string | null;
  invoiceId?: string | null;
  scheduledEmailId?: string | null;
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
  // When true, the modal renders without a backdrop and the wrapper
  // lets pointer events pass through, so the user can keep navigating
  // and interacting with the app while the composer is open. Used by
  // the global ComposeFAB. Defaults to false (full modal blocking).
  nonBlocking?: boolean;
  // Pre-selects the From dropdown to a specific verified "Send mail as"
  // alias. Used by surfaces with an opinion about the sender (e.g.
  // Invoice "Sent from"). Composer falls back to its own default
  // selection when this is null/unset or doesn't match a verified alias.
  defaultSendAsEmail?: string | null;
  // Optional To-field type-ahead source. The FAB pre-loads this with
  // the active client's contacts when launched from /clients/[id] so
  // the recruiter can start typing a name and pick from a dropdown.
  toSuggestions?: Array<{ name: string; email: string }>;
  // Carry-over for the "Replying to [Sender] · [date]" hint shown above
  // the To row. Set when an inline reply pops out into the modal so the
  // hint follows the draft into the popped window. Omitted for fresh
  // compose and Forward.
  replyingTo?: { senderName: string; dateIso: string | null };
  // Called after a successful send. The composer auto-closes on send,
  // so this is for parent-side bookkeeping (e.g., refreshing a list).
  onSent?: () => void;
  // Called after a successful Send Later. Defaults to onSent when
  // omitted so existing non-invoice composers keep their behavior.
  onScheduled?: () => void;
  // Called after Save Draft persists to Gmail/Ace. Used by invoice
  // launchers to refresh their server-loaded saved-draft payload.
  onDraftSaved?: (result: {
    draftId: string | null;
    invoiceEmailDraftId?: string | null;
    scheduledEmailId?: string | null;
  }) => void;
};

type Spec = OpenComposerInput & { id: string };

const ComposerManagerContext = createContext<{
  open: (input: OpenComposerInput) => string;
  close: (id: string) => void;
} | null>(null);

export function ComposerManagerProvider({ children }: { children: ReactNode }) {
  const [specs, setSpecs] = useState<Spec[]>([]);
  // Mirror of `specs` for synchronous reads inside open() so the dedupe
  // check below doesn't depend on a stale closure.
  const specsRef = useRef<Spec[]>([]);
  useEffect(() => {
    specsRef.current = specs;
  }, [specs]);

  const open = useCallback((input: OpenComposerInput): string => {
    // Dedupe draft-keyed opens: a draft id can only have ONE composer
    // open at a time. Without this, a single draft click that triggers
    // the open path more than once (e.g. an effect re-firing) would
    // stack two identical composers. Fresh (non-draft) composes are not
    // deduped — multiple New-Email windows are allowed by design.
    if (input.defaultDraftId) {
      const existing = specsRef.current.find(
        (s) => s.defaultDraftId === input.defaultDraftId,
      );
      if (existing) return existing.id;
    }
    const id = `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setSpecs((prev) => {
      // Re-check inside the updater to close the same-tick race where two
      // open() calls fire before specsRef has synced (functional updaters
      // chain, so `prev` already includes the first call's spec).
      if (
        input.defaultDraftId &&
        prev.some((s) => s.defaultDraftId === input.defaultDraftId)
      ) {
        return prev;
      }
      return [...prev, { id, ...input }];
    });
    return id;
  }, []);

  const close = useCallback((id: string) => {
    setSpecs((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Stable context value so consumers (e.g. the Mail draft hand-off
  // effect) don't see a new identity on every provider re-render — an
  // unstable value here re-fired that effect and stacked a second
  // composer.
  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <ComposerManagerContext.Provider value={value}>
      {children}
      {/* Open composers render OUTSIDE the page tree so they survive
          the page-component unmounting (e.g., user navigates from
          candidate A to candidate B with a draft minimized). */}
      {specs.map((s) => (
        <MailComposer
          key={s.id}
          asModal
          modalTitle={s.modalTitle ?? "New email"}
          nonBlocking={s.nonBlocking}
          defaultTo={s.defaultTo}
          defaultCc={s.defaultCc}
          defaultBcc={s.defaultBcc}
          defaultSubject={s.defaultSubject ?? ""}
          defaultBody={s.defaultBody}
          defaultAttachments={s.defaultAttachments}
          defaultDraftId={s.defaultDraftId}
          invoiceId={s.invoiceId}
          scheduledEmailId={s.scheduledEmailId}
          threadId={s.threadId}
          templates={s.templates}
          mergeContext={s.mergeContext}
          candidateRef={s.candidateRef}
          toSuggestions={s.toSuggestions}
          replyingTo={s.replyingTo}
          defaultSendAsEmail={s.defaultSendAsEmail}
          autoFocusTo
          onClose={() => close(s.id)}
          onSent={() => {
            s.onSent?.();
            close(s.id);
          }}
          onScheduled={() => {
            (s.onScheduled ?? s.onSent)?.();
            close(s.id);
          }}
          onDraftSaved={s.onDraftSaved}
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
