"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// Bridges the global Compose FAB (mounted at the app shell) to the
// New-Text and Call panels (mounted only inside /phone's PhoneView).
// Provider lives at the app shell so the FAB can fire open/close
// regardless of route; PhoneView reads state and renders the panels
// only when present. Navigating away from /phone unmounts the
// renderers but keeps state — clicking the FAB again from /phone
// resurfaces the panel exactly where it was.

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
};

const Context = createContext<PhonePanelsCtx | null>(null);

export function PhonePanelsProvider({ children }: { children: ReactNode }) {
  const [textOpen, setTextOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [contact, setContact] = useState<PhoneContact | null>(null);

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
