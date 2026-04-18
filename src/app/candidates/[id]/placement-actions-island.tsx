"use client";

import dynamic from "next/dynamic";
import type {
  OpenJobOption,
  PlacementContextJob,
} from "@/app/candidates/[id]/placement-flows";

// Lazy-loaded client island for the action row + all its modals (Offer,
// Placement, Confirm Start, Schedule Interview, Reject, Cancel, Submit
// flow, Apply flow, Reference Check). Loading with `ssr: false` means the
// server HTML doesn't ship any of the action-row markup — it appears only
// after the client bundle arrives and hydrates.
//
// Rationale: placement-flows.tsx is the largest client island on the page
// (~1.9kloc of React + many modals). Taking it out of SSR removes it as a
// hydration-mismatch candidate and shrinks the server HTML. If anything in
// that island throws during render, the parent CandidateProfileBoundary
// catches it.
const PlacementActionsLazy = dynamic(
  () => import("@/app/candidates/[id]/placement-flows").then((m) => ({ default: m.PlacementActions })),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 px-5 py-4 text-xs text-muted-foreground">
        Loading actions…
      </div>
    ),
  },
);

export function PlacementActionsIsland(props: {
  candidateRfId: number;
  candidateFirstName: string;
  candidateLastName: string;
  candidateEmail: string;
  jobs: PlacementContextJob[];
  openJobs: OpenJobOption[];
}) {
  return <PlacementActionsLazy {...props} />;
}
