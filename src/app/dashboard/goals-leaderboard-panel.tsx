"use client";

import { useState } from "react";

import {
  GoalsClientLeaderboard,
  type ClientLeaderboardRowView,
  type LeaderboardScope,
} from "@/app/dashboard/goals-client-leaderboard";

// Holds the This period / All time toggle. Both datasets are resolved
// server-side and handed down together, so flipping the toggle is instant
// and never re-queries - the leaderboard is a handful of rows either way,
// and a round trip per toggle would be the slower design.
export function GoalsLeaderboardPanel({
  periodRows,
  allTimeRows,
  periodLabel,
}: {
  periodRows: ClientLeaderboardRowView[];
  allTimeRows: ClientLeaderboardRowView[];
  periodLabel: string;
}) {
  const [scope, setScope] = useState<LeaderboardScope>("PERIOD");
  return (
    <GoalsClientLeaderboard
      rows={scope === "ALL_TIME" ? allTimeRows : periodRows}
      scope={scope}
      onScopeChange={setScope}
      periodLabel={periodLabel}
    />
  );
}
