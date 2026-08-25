"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SidebarTabVisibility } from "@/components/nav-items";

// Shares the sidebar tab visibility overrides with the two nav surfaces.
// A context (rather than props) because the desktop Sidebar takes its
// props from AppShell while the mobile drawer is nested inside TopBar,
// which takes none — threading would mean adding pass-through props to a
// component that has no other reason to have them.
//
// The value is seeded from the server in app/layout.tsx, so the first
// paint already knows which rows to draw and a hidden tab never flashes
// in before hydration. Mirrors how CourtModeProvider takes its
// initialAutoNightMode.
//
// setTabVisible is the optimistic local update the Settings toggle
// calls, so the sidebar re-renders the instant the switch flips instead
// of waiting on the server round trip.

type SidebarTabsContextValue = {
  visibility: SidebarTabVisibility;
  setTabVisible: (key: string, shown: boolean) => void;
};

// Empty default = every tab falls back to its own default in
// nav-items.ts. That's the correct read for any tree rendered outside
// the provider (e.g. the unauthenticated /sign-in surface).
const SidebarTabsContext = createContext<SidebarTabsContextValue>({
  visibility: {},
  setTabVisible: () => {},
});

export function SidebarTabsProvider({
  initialVisibility,
  children,
}: {
  initialVisibility: SidebarTabVisibility;
  children: ReactNode;
}) {
  const [visibility, setVisibility] = useState<SidebarTabVisibility>(initialVisibility);

  const setTabVisible = useCallback((key: string, shown: boolean) => {
    setVisibility((prev) => ({ ...prev, [key]: shown }));
  }, []);

  const value = useMemo(
    () => ({ visibility, setTabVisible }),
    [visibility, setTabVisible],
  );

  return (
    <SidebarTabsContext.Provider value={value}>
      {children}
    </SidebarTabsContext.Provider>
  );
}

export function useSidebarTabs(): SidebarTabsContextValue {
  return useContext(SidebarTabsContext);
}
