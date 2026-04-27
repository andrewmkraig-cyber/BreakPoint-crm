"use client";

import { useState } from "react";
import { ActivityFeed } from "@/components/activity-feed";
import { TextingExchanges } from "@/components/texting-exchanges";
import { CallLogs } from "@/components/call-logs";
import { cn } from "@/lib/utils";

type Filter = "all" | "texts" | "calls" | "emails";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "texts", label: "Texts" },
  { value: "calls", label: "Calls" },
  { value: "emails", label: "Emails" },
];

// Activity tab body. `All` stacks ActivityFeed + Texts + Calls in
// source-grouped sections rather than a single timestamp-merged stream
// — each child fetches independently and a true interleave would
// require a unified server endpoint that joins ActivityLog +
// SmsMessage + CallLog and emits a single chronological list. Marked
// TODO for when the auto-tagging + email feed lands; today the
// recruiter still gets every event, just grouped by source.
export function ActivityTabContent({ candidateId }: { candidateId: string }) {
  const [filter, setFilter] = useState<Filter>("all");

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap gap-1 rounded-lg border border-court-border bg-court-surface p-1 shadow-sm">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              filter === f.value
                ? "bg-court-accent-tint text-court-accent-dark"
                : "text-court-fg-muted hover:bg-court-surface-subtle",
            )}
            aria-pressed={filter === f.value}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filter === "all" && (
        <div className="space-y-4">
          <ActivityFeed entityType="candidate" entityId={candidateId} />
          <TextingExchanges candidateId={candidateId} />
          <CallLogs candidateId={candidateId} />
        </div>
      )}
      {filter === "texts" && <TextingExchanges candidateId={candidateId} />}
      {filter === "calls" && <CallLogs candidateId={candidateId} />}
      {filter === "emails" && (
        <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
          <p className="text-sm text-court-fg-muted">Email history coming soon.</p>
        </section>
      )}
    </div>
  );
}
