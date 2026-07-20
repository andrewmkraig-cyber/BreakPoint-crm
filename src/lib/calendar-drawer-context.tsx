"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import type { CalendarEventType } from "@/lib/calendar/types";

// Hoists the create-mode CalendarEventDrawer to the providers layer
// so the ComposeFAB can pop it as an overlay on /mail, /candidates,
// /pipeline — anywhere — without navigating to /calendar. Same trick
// the floating thread window, find-matches panel, and Claude panel
// use: one shared open/close state, a single drawer instance mounted
// at the root, every page's call site routes through this hook.
//
// Edit-mode drawer is intentionally NOT in here — /calendar owns that
// instance since it's the only place the full event list is in scope.

export type CalendarDrawerPrefill = {
  date: Date;
  hour?: number;
  minute?: number;
};

export type CalendarDrawerCandidatePrefill = {
  id: string;
  name: string;
  email: string;
};

type Ctx = {
  isOpen: boolean;
  prefill: CalendarDrawerPrefill | null;
  prefillType: CalendarEventType | null;
  prefillCandidate: CalendarDrawerCandidatePrefill | null;
  open: (opts?: {
    prefill?: CalendarDrawerPrefill;
    type?: CalendarEventType;
    candidate?: CalendarDrawerCandidatePrefill | null;
  }) => void;
  close: () => void;
};

const Context = createContext<Ctx | null>(null);

export function CalendarDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState<CalendarDrawerPrefill | null>(null);
  const [prefillType, setPrefillType] = useState<CalendarEventType | null>(
    null,
  );
  const [prefillCandidate, setPrefillCandidate] =
    useState<CalendarDrawerCandidatePrefill | null>(null);

  const open = useCallback(
    (opts?: {
      prefill?: CalendarDrawerPrefill;
      type?: CalendarEventType;
      candidate?: CalendarDrawerCandidatePrefill | null;
    }) => {
      setPrefill(opts?.prefill ?? null);
      setPrefillType(opts?.type ?? null);
      setPrefillCandidate(opts?.candidate ?? null);
      setIsOpen(true);
    },
    [],
  );

  const close = useCallback(() => setIsOpen(false), []);

  return (
    <Context.Provider
      value={{ isOpen, prefill, prefillType, prefillCandidate, open, close }}
    >
      {children}
    </Context.Provider>
  );
}

export function useCalendarDrawer(): Ctx {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error(
      "useCalendarDrawer must be used inside CalendarDrawerProvider",
    );
  }
  return ctx;
}
