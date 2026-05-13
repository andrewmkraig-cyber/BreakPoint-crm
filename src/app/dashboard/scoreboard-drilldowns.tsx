"use client";

import { useState, type ReactNode } from "react";

import {
  PlacementDrilldownDialog,
  type DrilldownQuery,
} from "@/components/dashboard/placement-drilldown-dialog";

// Client-side trigger wrappers used inside Scoreboard's Top Clients
// and Top Roles cards. The cards themselves stay in the server file;
// only the click + dialog state lives here so the heavy data fetch
// stays server-side.

export function ClientDrilldownTrigger({
  clientId,
  clientName,
  children,
}: {
  clientId: string;
  clientName: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!clientId) {
    // Legacy RF-only client aggregate without an Ace cuid — render
    // the row inert rather than promising a click target that can't
    // resolve. The eventual RF-removal phase will eliminate this
    // branch entirely.
    return <div className="block w-full text-left">{children}</div>;
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full cursor-pointer rounded-lg text-left transition hover:bg-court-brand-tint/30 focus:outline-none focus:ring-2 focus:ring-court-brand/40"
      >
        {children}
      </button>
      {open && (
        <PlacementDrilldownDialog
          eyebrow="Top Client"
          title={clientName}
          query={{ kind: "client", id: clientId } as DrilldownQuery}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function RoleDrilldownTrigger({
  roleTitle,
  children,
}: {
  roleTitle: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full cursor-pointer rounded-lg text-left transition hover:bg-court-brand-tint/30 focus:outline-none focus:ring-2 focus:ring-court-brand/40"
      >
        {children}
      </button>
      {open && (
        <PlacementDrilldownDialog
          eyebrow="Top Role"
          title={roleTitle}
          query={{ kind: "role", id: roleTitle } as DrilldownQuery}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
