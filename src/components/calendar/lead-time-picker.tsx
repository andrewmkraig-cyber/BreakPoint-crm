"use client";

import { Plus, X } from "lucide-react";

// Shared notification lead-time picker used by both the reminders panel
// (create + edit) and the calendar event drawer's reminder mode, so the
// two surfaces stay literally identical instead of drifting. Renders the
// stackable pill UI only - each caller supplies its own "Notify" heading.

// Leads the editor offers, soonest-window first. 0 is not offered here
// (reserved for event/interview-linked rows that fire at the exact time).
export const LEAD_PRESETS: Array<{ value: number; label: string }> = [
  { value: 15, label: "15 min before" },
  { value: 30, label: "30 min before" },
  { value: 60, label: "1 hr before" },
  { value: 120, label: "2 hr before" },
  { value: 1440, label: "1 day before" },
];

export function leadLabel(value: number): string {
  return LEAD_PRESETS.find((p) => p.value === value)?.label ?? `${value} min before`;
}

export function leadsSummary(leads: number[]): string {
  if (leads.length === 0) return "No notifications";
  return (
    leads
      .slice()
      .sort((a, b) => b - a)
      .map((l) => leadLabel(l).replace(" before", ""))
      .join(" · ") + " before"
  );
}

export function LeadTimePicker({
  leads,
  onChange,
  max = 3,
}: {
  leads: number[];
  onChange: (next: number[]) => void;
  max?: number;
}) {
  const sortedLeads = leads.slice().sort((a, b) => b - a);
  const available = LEAD_PRESETS.filter((p) => !leads.includes(p.value));
  const canAdd = leads.length < max && available.length > 0;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {sortedLeads.map((l) => (
          <span
            key={l}
            className="inline-flex items-center gap-1 rounded-full border border-court-brand/40 bg-court-brand-tint/50 px-2 py-0.5 text-[11px] font-semibold text-court-brand-dark"
          >
            {leadLabel(l)}
            <button
              type="button"
              aria-label={`Remove ${leadLabel(l)}`}
              onClick={() => onChange(leads.filter((x) => x !== l))}
              className="text-court-brand-dark/70 hover:text-court-brand-dark"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      {canAdd && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {available.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange([...leads, p.value])}
              className="inline-flex items-center gap-1 rounded-full border border-court-border bg-court-surface px-2 py-0.5 text-[11px] font-medium text-court-fg-muted transition hover:border-court-brand/40 hover:text-court-brand-dark"
            >
              <Plus className="h-2.5 w-2.5" />
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
