// Canonical Lead Source options surfaced in every placement edit form
// (pipeline drawer + candidate-profile RecordPlacementModal). Stored as
// the display string so the Financial Performance "By Source" chart
// groups cleanly. Components that render the dropdown still preserve
// any legacy value (e.g. "Apollo BD", "Cold Outreach") that
// isn't in the list — see the source-not-in-list fallback near the
// <select>.
export const LEAD_SOURCES = [
  "Network",
  "Referral",
  "LinkedIn",
  "Inbound",
  "Indeed",
  "Pin",
  "Apollo",
  "ZipRecruiter",
  "ZoomInfo",
  "Other",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];
