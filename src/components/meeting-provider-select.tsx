"use client";

import type { MeetingProvider } from "@/app/candidates/[id]/interview-actions";

// Shared "Meeting Link" dropdown rendered by both interview scheduler
// dialogs. Teams is locked off until the org connects a Microsoft
// account in Settings → Connectors; we surface that via a disabled
// option and a hint line rather than hiding it, so the recruiter knows
// the path exists.
export function MeetingProviderSelect({
  value,
  onChange,
  teamsConnected,
}: {
  value: MeetingProvider;
  onChange: (v: MeetingProvider) => void;
  teamsConnected: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Meeting Link</span>
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value as MeetingProvider;
          if (next === "teams" && !teamsConnected) return;
          onChange(next);
        }}
        title={!teamsConnected ? "Connect Microsoft in Settings" : undefined}
        className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      >
        <option value="google">Google Meet</option>
        <option value="teams" disabled={!teamsConnected}>
          Microsoft Teams{!teamsConnected ? " (connect in Settings)" : ""}
        </option>
      </select>
      {!teamsConnected && (
        <span className="mt-1 block text-[11px] text-court-fg-muted">
          Connect Microsoft in Settings → Connectors to enable Teams links.
        </span>
      )}
    </label>
  );
}
