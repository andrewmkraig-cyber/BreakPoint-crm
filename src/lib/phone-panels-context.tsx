"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Bridges the global Compose FAB (mounted in the app shell) to the
// New-Text and Call floating panels (mounted globally in Providers
// via GlobalPhonePanels). Both the FAB and the panels live above the
// route tree so the recruiter can start a text or call from any page.
//
// /phone's PhoneView still cares about send completion so its thread
// list can refresh; it registers a callback via setAfterSend and the
// global panel calls triggerAfterSend after a successful send. Off
// /phone the callback is null and the trigger is a no-op.

export type PhoneContact = {
  // Candidate cuid when matched. null for unknown / new conversations.
  candidateId: string | null;
  name: string;
  phoneNumber: string;
  // Display tag — "Candidate" / "Client" / null. Phase 1 only emits
  // "Candidate" since the webhook doesn't write client-side rows yet.
  tag: "Candidate" | "Client" | null;
};

type PhonePanelsCtx = {
  textOpen: boolean;
  callOpen: boolean;
  contact: PhoneContact | null;
  openText: (contact?: PhoneContact | null) => void;
  openCall: (contact?: PhoneContact | null) => void;
  closeText: () => void;
  closeCall: () => void;
  // Switch from Call panel to Text panel preserving the selected
  // contact. Used by the "Call instead" / "Text instead" cross-links.
  switchToText: () => void;
  switchToCall: () => void;
  // After-send hook. PhoneView registers loadThreads here so the
  // global text panel can re-fetch the list once a message goes out.
  // Stored in a ref so registering doesn't re-render every consumer.
  setAfterSend: (cb: (() => void) | null) => void;
  triggerAfterSend: () => void;
  // Dial-pad modal state. Owned by this context so the topbar's
  // page-specific "+ New Text/Call" button on /phone can trigger the
  // same modal that PhoneView used to own internally.
  dialPadOpen: boolean;
  openDialPad: () => void;
  closeDialPad: () => void;
};

const Context = createContext<PhonePanelsCtx | null>(null);

export function PhonePanelsProvider({ children }: { children: ReactNode }) {
  const [textOpen, setTextOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [dialPadOpen, setDialPadOpen] = useState(false);
  const [contact, setContact] = useState<PhoneContact | null>(null);
  const afterSendRef = useRef<(() => void) | null>(null);

  const openDialPad = useCallback(() => setDialPadOpen(true), []);
  const closeDialPad = useCallback(() => setDialPadOpen(false), []);

  const openText = useCallback((c?: PhoneContact | null) => {
    if (c !== undefined) setContact(c ?? null);
    setCallOpen(false);
    setTextOpen(true);
  }, []);

  const openCall = useCallback((c?: PhoneContact | null) => {
    if (c !== undefined) setContact(c ?? null);
    setTextOpen(false);
    setCallOpen(true);
  }, []);

  const closeText = useCallback(() => {
    setTextOpen(false);
  }, []);

  const closeCall = useCallback(() => {
    setCallOpen(false);
  }, []);

  const switchToText = useCallback(() => {
    setCallOpen(false);
    setTextOpen(true);
  }, []);

  const switchToCall = useCallback(() => {
    setTextOpen(false);
    setCallOpen(true);
  }, []);

  const setAfterSend = useCallback((cb: (() => void) | null) => {
    afterSendRef.current = cb;
  }, []);

  const triggerAfterSend = useCallback(() => {
    afterSendRef.current?.();
  }, []);

  return (
    <Context.Provider
      value={{
        textOpen,
        callOpen,
        contact,
        openText,
        openCall,
        closeText,
        closeCall,
        switchToText,
        switchToCall,
        setAfterSend,
        triggerAfterSend,
        dialPadOpen,
        openDialPad,
        closeDialPad,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function usePhonePanels(): PhonePanelsCtx {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error("usePhonePanels must be used inside PhonePanelsProvider");
  }
  return ctx;
}
